//! Local controls for the separate stdio process. Never starts a listener.
use crate::{err, AppState, Result};
use serde_json::{json, Value};
use std::path::PathBuf;
fn executable() -> Option<PathBuf> {
    let filename = if cfg!(windows) {
        "talkkeeper-mcp.exe"
    } else {
        "talkkeeper-mcp"
    };
    let sibling = std::env::current_exe().ok()?.parent()?.join(filename);
    if sibling.is_file() {
        return Some(sibling);
    }
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths)
            .map(|p| p.join(filename))
            .find(|p| p.is_file())
    })
}
#[tauri::command]
pub fn mcp_data(
    state: tauri::State<'_, AppState>,
    action: String,
    payload: Value,
) -> Result<Value> {
    match action.as_str() {
        "status" => {
            let store = state.store.lock().map_err(err)?;
            let mut prefs = json!({});
            for key in ["enabled", "include_transcripts", "include_calendar"] {
                prefs[key] = json!(
                    store.get_setting(&format!("mcp.{key}")).map_err(err)? == Some(json!(true))
                );
            }
            Ok(
                json!({"preferences":prefs,"executable":executable(),"database":state.directory.join("talkkeeper.sqlite")}),
            )
        }
        "set" => {
            let key = payload["key"].as_str().ok_or("Missing preference")?;
            if !["enabled", "include_transcripts", "include_calendar"].contains(&key)
                || !payload["value"].is_boolean()
            {
                return Err("Invalid MCP preference".into());
            }
            state
                .store
                .lock()
                .map_err(err)?
                .set_setting(&format!("mcp.{key}"), &payload["value"])
                .map_err(err)?;
            Ok(Value::Null)
        }
        "check" => {
            talkkeeper_mcp::check(&state.directory.join("talkkeeper.sqlite")).map(|s| json!(s))
        }
        "recent" => Ok(json!(talkkeeper_mcp::access::recent(&state.directory)
            .map_err(err)?
            .into_iter()
            .map(|a| json!({"timestamp":a.timestamp,"tool":a.tool}))
            .collect::<Vec<_>>())),
        "clear" => {
            talkkeeper_mcp::access::clear(&state.directory).map_err(err)?;
            Ok(Value::Null)
        }
        _ => Err("Unknown MCP action".into()),
    }
}
