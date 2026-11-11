//! The general pasteboard as a device service inside the bridge's tunnel, so it also works for the
//! remote pairing target. Used to save and restore the user's clipboard around a paste.
use super::Result;
use idevice::{
    RsdService,
    core_device::{GENERAL_PASTEBOARD, PasteboardPayload, PasteboardServiceClient},
    rsd::RsdHandshake,
    tcp::handle::AdapterHandle,
};
use serde_json::{Value, json};

const MAX_TEXT: usize = 1024 * 1024;

pub fn validate_pasteboard(action: &str, text: Option<&str>) -> Result<()> {
    match (action, text) {
        ("get" | "items", None) => Ok(()),
        ("set", Some(text)) if text.len() <= MAX_TEXT => Ok(()),
        ("set", Some(_)) => Err("text exceeds 1 MiB".into()),
        _ => Err("pasteboard action must be get, items, or set with text".into()),
    }
}

pub async fn pasteboard(
    adapter: &mut AdapterHandle,
    rsd: &mut RsdHandshake,
    action: &str,
    text: Option<&str>,
) -> Result<Value> {
    validate_pasteboard(action, text)?;
    let mut client = PasteboardServiceClient::connect_rsd(adapter, rsd).await?;
    if let Some(text) = text {
        client.set_text(text, GENERAL_PASTEBOARD).await?;
        return Ok(json!({"copied": true, "bytes": text.len()}));
    }
    let snapshot = client.get(GENERAL_PASTEBOARD).await?;
    if action == "get" {
        return Ok(json!({"text": snapshot.text()}));
    }
    let items: Vec<Value> = snapshot
        .items
        .iter()
        .flat_map(|item| {
            item.data.iter().map(|entry| {
                let (state, size) = match &entry.payload {
                    PasteboardPayload::Inline(bytes) => ("inline", Some(bytes.len() as i64)),
                    PasteboardPayload::Promised { size } => ("promised", *size),
                    PasteboardPayload::Error(_) => ("error", None),
                };
                json!({"index": item.index, "uti": entry.uti, "state": state, "size": size})
            })
        })
        .collect();
    Ok(json!({"items": items}))
}
