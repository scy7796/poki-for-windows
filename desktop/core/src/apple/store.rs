//! Where the Apple session lives between runs: the OS keychain (macOS Keychain, Windows
//! Credential Manager, Secret Service on Linux). The password is kept only when the person
//! turns on "Keep me signed in for weekly re-signing"; otherwise only the session tokens are.
use super::anisette::Source;
use super::gsa::{AppToken, Session};
#[cfg_attr(not(feature = "os-keychain"), allow(unused_imports))]
use crate::{Error, Result, paths};
use serde::{Deserialize, Serialize};

#[cfg(feature = "os-keychain")]
const SERVICE: &str = "nz.zheha.poki.setup";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Account {
    pub session: Option<Session>,
    pub xcode_token: Option<AppToken>,
    pub password: Option<String>,
    pub team_id: Option<String>,
    pub anisette: Option<Source>,
}

impl Account {
    pub fn apple_id(&self) -> Option<&str> { self.session.as_ref().map(|s| s.apple_id.as_str()) }
    pub fn display_name(&self) -> Option<String> {
        self.session.as_ref().map(|s| {
            let n = format!("{} {}", s.first_name, s.last_name).trim().to_string();
            if n.is_empty() { s.apple_id.clone() } else { n }
        })
    }
}

/// The host's vault (Poki on the iPhone) holds the account under this name.
const VAULT_NAME: &str = "apple-account";

/// A secret of Poki Setup's own: the host's vault when one is installed, else the system keychain
/// (macOS Keychain, Windows Credential Manager), or a 0600 file in file mode.
pub fn secret_get(name: &str) -> Option<String> {
    if let Some(v) = crate::vault::installed() {
        return v.get(name).ok().flatten().and_then(|b| String::from_utf8(b).ok()).filter(|s| !s.is_empty());
    }
    if file_mode() {
        return std::fs::read_to_string(paths::state_dir().ok()?.join(format!("{name}.secret"))).ok().filter(|s| !s.is_empty());
    }
    #[cfg(not(feature = "os-keychain"))]
    unreachable!("file_mode is always on without the OS keychain");
    #[cfg(feature = "os-keychain")]
    keyring::Entry::new(SERVICE, name).ok()?.get_password().ok().filter(|s| !s.is_empty())
}

pub fn secret_set(name: &str, value: &str) -> Result<()> {
    if let Some(v) = crate::vault::installed() {
        return v.set(name, value.as_bytes());
    }
    if file_mode() {
        let p = paths::state_dir()?.join(format!("{name}.secret"));
        std::fs::write(&p, value)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600))?;
        }
        return Ok(());
    }
    #[cfg(not(feature = "os-keychain"))]
    unreachable!("file_mode is always on without the OS keychain");
    #[cfg(feature = "os-keychain")]
    keyring::Entry::new(SERVICE, name).and_then(|e| e.set_password(value)).map_err(|e| Error::msg(format!("keychain: {e}")))
}

pub fn secret_delete(name: &str) -> Result<()> {
    if let Some(v) = crate::vault::installed() {
        return v.delete(name);
    }
    if file_mode() {
        let _ = std::fs::remove_file(paths::state_dir()?.join(format!("{name}.secret")));
        return Ok(());
    }
    #[cfg(not(feature = "os-keychain"))]
    unreachable!("file_mode is always on without the OS keychain");
    #[cfg(feature = "os-keychain")]
    match keyring::Entry::new(SERVICE, name).and_then(|e| e.delete_credential()) {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(Error::msg(format!("keychain: {e}"))),
    }
}

#[cfg(feature = "os-keychain")]
fn entry() -> Result<keyring::Entry> {
    keyring::Entry::new(SERVICE, "apple-account").map_err(|e| Error::msg(format!("keychain: {e}")))
}

/// Tests and headless machines: POKI_SETUP_FILE_SECRETS=1 keeps the account in a 0600 file.
fn file_mode() -> bool { !cfg!(feature = "os-keychain") || std::env::var("POKI_SETUP_FILE_SECRETS").map(|v| v == "1").unwrap_or(false) }

fn file_path() -> Result<std::path::PathBuf> { Ok(paths::state_dir()?.join("account.json")) }

pub fn load() -> Result<Account> {
    if let Some(v) = crate::vault::installed() {
        return Ok(v.get(VAULT_NAME)?.and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default());
    }
    if file_mode() {
        return Ok(std::fs::read_to_string(file_path()?).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default());
    }
    #[cfg(not(feature = "os-keychain"))]
    unreachable!("file_mode is always on without the OS keychain");
    #[cfg(feature = "os-keychain")]
    match entry()?.get_password() {
        Ok(json) => Ok(serde_json::from_str(&json).unwrap_or_default()),
        Err(keyring::Error::NoEntry) => Ok(Account::default()),
        Err(e) => Err(Error::msg(format!("Could not read the keychain: {e}"))),
    }
}

pub fn save(account: &Account) -> Result<()> {
    let json = serde_json::to_string(account)?;
    if let Some(v) = crate::vault::installed() {
        return v.set(VAULT_NAME, json.as_bytes());
    }
    if file_mode() {
        let p = file_path()?;
        std::fs::write(&p, &json)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o600))?;
        }
        return Ok(());
    }
    #[cfg(not(feature = "os-keychain"))]
    unreachable!("file_mode is always on without the OS keychain");
    #[cfg(feature = "os-keychain")]
    entry()?.set_password(&json).map_err(|e| Error::msg(format!("Could not write the keychain: {e}")))
}

pub fn clear() -> Result<()> {
    if let Some(v) = crate::vault::installed() {
        return v.delete(VAULT_NAME);
    }
    if file_mode() {
        let _ = std::fs::remove_file(file_path()?);
        return Ok(());
    }
    #[cfg(not(feature = "os-keychain"))]
    unreachable!("file_mode is always on without the OS keychain");
    #[cfg(feature = "os-keychain")]
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(Error::msg(format!("keychain: {e}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn file_round_trip() {
        let (_lock, _dir) = crate::paths::test_home();
        unsafe { std::env::set_var("POKI_SETUP_FILE_SECRETS", "1") };
        assert!(load().unwrap().session.is_none());
        let mut a = Account::default();
        a.team_id = Some("ABC".into());
        save(&a).unwrap();
        assert_eq!(load().unwrap().team_id.as_deref(), Some("ABC"));
        clear().unwrap();
        assert!(load().unwrap().team_id.is_none());
    }
}
