use super::{Request, Result, execute_connected};
use idevice::{
    remote_pairing::{
        RemotePairingClient, RpPairingFile, RpPairingSocket, connect_tls_psk_tunnel_native,
    },
    rsd::RsdHandshake,
    tcp::handle::AdapterHandle,
};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{io::Write, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    net::TcpStream,
};

#[derive(Deserialize)]
struct Config {
    id: String,
    host: String,
    port: u16,
    pairing_file: String,
}

type Control = RemotePairingClient<RpPairingSocket<TcpStream>>;

struct Session {
    config: Config,
    control: Option<Control>,
    connection: Option<(AdapterHandle, RsdHandshake)>,
}

impl Session {
    async fn connect(&mut self) -> Result<()> {
        if self.control.is_none() {
            let socket = TcpStream::connect((self.config.host.as_str(), self.config.port)).await
                .map_err(|_| "Remote pairing is unreachable. Keep Tailscale connected; reconnect the iPhone to Wi-Fi to establish a new session.")?;
            socket.set_nodelay(true)?;
            let mut control = RemotePairingClient::new(RpPairingSocket::new(socket), "poki-mcp");
            let mut record = RpPairingFile::read_from_file(&self.config.pairing_file).await?;
            control.attempt_pair_verify().await?;
            // Never fall back to pairing or request consent during an ordinary operation.
            control.validate_pairing(&mut record).await?;
            self.control = Some(control);
        }
        let control = self.control.as_mut().unwrap();
        let port = match control.create_tcp_listener().await {
            Ok(port) => port,
            Err(error) => {
                self.control = None;
                return Err(format!("The remote pairing control connection closed: {error}. Reconnect the iPhone to Wi-Fi, then reconnect the device.").into());
            }
        };
        let socket = TcpStream::connect((self.config.host.as_str(), port)).await
            .map_err(|_| "The iPhone refused a new tunnel. Reconnect it to Wi-Fi, then reconnect the device.")?;
        socket.set_nodelay(true)?;
        let tunnel = connect_tls_psk_tunnel_native(socket, control.encryption_key()).await?;
        let info = tunnel.info.clone();
        let mut adapter = idevice::tcp::adapter::Adapter::new(
            Box::new(tunnel.into_inner()),
            info.client_address.parse()?,
            info.server_address.parse()?,
        )
        .to_async_handle();
        let rsd = RsdHandshake::new(adapter.connect(info.server_rsd_port).await?).await?;
        if rsd
            .properties
            .get("UniqueDeviceID")
            .and_then(plist::Value::as_string)
            != Some(self.config.id.as_str())
        {
            return Err("Remote device identity does not match the configured iPhone".into());
        }
        self.connection = Some((adapter, rsd));
        Ok(())
    }

    async fn request(&mut self, request: Value) -> Result<Value> {
        // Keep the working tunnel until its replacement has actually connected.
        // A failed reconnect must not destroy the only usable cellular session.
        if self.connection.is_none() || request["op"] == "reconnect" {
            let result = tokio::time::timeout(Duration::from_secs(25), self.connect()).await;
            match result {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    self.control = None;
                    return Err(error);
                }
                Err(error) => {
                    self.control = None;
                    return Err(error.into());
                }
            }
        }
        if request["op"] == "connect" || request["op"] == "reconnect" {
            return Ok(
                json!({"connected":true,"transport":"remote_pairing","device":self.config.id}),
            );
        }
        let request: Request = serde_json::from_value(request)?;
        request.validate()?;
        if matches!(
            request,
            Request::InstallApp { .. } | Request::UninstallApp { .. }
        ) {
            return Err("App installation over remote pairing is not supported".into());
        }
        let (adapter, rsd) = self.connection.as_mut().unwrap();
        let result = tokio::time::timeout(
            Duration::from_secs(90),
            execute_connected(adapter, rsd, None, request),
        )
        .await;
        match result {
            Ok(Ok(value)) => Ok(value),
            failure => {
                // A service or file error does not imply the shared tunnel died.
                // bind_udp checks the adapter task locally without opening a phone service.
                if adapter.bind_udp(0).await.is_err() {
                    self.connection = None;
                }
                // Delivery can be ambiguous: the caller must inspect, never replay automatically.
                let message = match failure {
                    Ok(Err(e)) => e.to_string(),
                    Err(_) => "Remote operation timed out".into(),
                    _ => unreachable!(),
                };
                Err(format!(
                    "{message}. Input may have been delivered; inspect the screen before retrying."
                )
                .into())
            }
        }
    }
}

fn load(path: &str) -> Result<Session> {
    Ok(Session {
        config: serde_json::from_slice(&std::fs::read(path)?)?,
        control: None,
        connection: None,
    })
}

async fn reply(session: &mut Session, line: &str) -> Value {
    let response = if line.len() > 2 * 1024 * 1024 {
        Err("Remote request exceeds size limit".into())
    } else {
        match serde_json::from_str::<Value>(line) {
            Ok(request) => session.request(request).await,
            Err(e) => Err(e.into()),
        }
    };
    response.unwrap_or_else(|e| json!({"isError":true,"transport_error":true,"error":e.to_string(),"screen_change_verified":false}))
}

pub async fn serve(path: &str) -> Result<Value> {
    let mut session = load(path)?;
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Some(line) = lines.next_line().await? {
        // The socket form bounds a request at 2 MiB; this form had no bound at all, so a
        // client could grow the buffer without limit. Answer a too-large request the same way
        // the socket form refuses one instead of dropping the connection.
        if line.len() > 2 * 1024 * 1024 {
            println!("{}", json!({"isError":true,"error":"Remote request exceeds size limit","screen_change_verified":false}));
            std::io::stdout().flush()?;
            continue;
        }
        println!("{}", reply(&mut session, &line).await);
        std::io::stdout().flush()?;
    }
    Ok(json!({"closed":true}))
}

// A remote helper talks to its client over a Unix domain socket with mode 0600, which
// Windows has neither of. The stdin form of the same helper (`--remote`) works there, so
// only this transport is gated; see the stub below.
#[cfg(unix)]
pub async fn serve_socket(path: &str, socket_path: &str) -> Result<Value> {
    use std::os::unix::fs::PermissionsExt;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let mut session = load(path)?;
    let listener = tokio::net::UnixListener::bind(socket_path)?;
    std::fs::set_permissions(socket_path, std::fs::Permissions::from_mode(0o600))?;
    println!("{}", json!({"ready":true}));
    std::io::stdout().flush()?;
    loop {
        let (mut socket, _) = listener.accept().await?;
        let hello = format!("{}\n", json!({"pid":std::process::id()}));
        if socket.write_all(hello.as_bytes()).await.is_err() {
            continue;
        }
        let mut stream = BufReader::new(socket);
        let mut line = String::new();
        // The local directory is private. Bound incomplete requests so an abandoned client cannot hold the device.
        if !matches!(tokio::time::timeout(Duration::from_secs(5), (&mut stream).take(2 * 1024 * 1024 + 1).read_line(&mut line)).await, Ok(Ok(n)) if n > 0)
        {
            continue;
        }
        if line.len() > 2 * 1024 * 1024 {
            continue;
        }
        if serde_json::from_str::<Value>(&line)
            .ok()
            .is_some_and(|v| v["op"] == "disconnect")
        {
            stream
                .get_mut()
                .write_all(b"{\"disconnected\":true}\n")
                .await?;
            break;
        }
        let request = serde_json::from_str::<Request>(&line);
        let screenshot_path = match &request {
            Ok(Request::Screenshot { path }) => Some(path),
            _ => None,
        };
        let read_only = matches!(
            &request,
            Ok(Request::AxTree { .. }
                | Request::Screenshot { .. }
                | Request::DeviceInfo
                | Request::DisplayInfo
                | Request::ListApps)
        );
        let mut byte = [0u8; 1];
        let (output, abandoned) = if read_only {
            // Draining an observation preserves service framing when its caller stops waiting.
            let response = reply(&mut session, &line);
            tokio::pin!(response);
            tokio::select! {
                biased;
                _ = stream.read(&mut byte) => (response.await, true),
                output = &mut response => (output, false),
            }
        } else {
            tokio::select! {
                biased;
                _ = stream.read(&mut byte) => continue,
                output = reply(&mut session, &line) => (output, false),
            }
        };
        let mut bytes = serde_json::to_vec(&output)?;
        bytes.push(b'\n');
        let delivered = !abandoned && stream.get_mut().write_all(&bytes).await.is_ok();
        if !delivered && output["saved"] == true {
            if let Some(path) = screenshot_path {
                let _ = tokio::fs::remove_file(path).await;
            }
        }
    }
    let _ = std::fs::remove_file(socket_path);
    Ok(json!({"closed":true}))
}

/// Windows has no Unix domain socket and no file mode bits to protect one with, so the
/// socket transport is unavailable there. The same helper over stdin is not, and that is
/// what the daemon uses when no socket can be created.
#[cfg(not(unix))]
pub async fn serve_socket(_path: &str, _socket_path: &str) -> Result<Value> {
    Err("A remote helper socket needs a Unix domain socket. Windows runs this helper over stdin instead.".into())
}
