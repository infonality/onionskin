use serde_json::{json, Value};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn prefs_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("No config directory: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create config directory: {e}"))?;
    Ok(dir.join("preferences.json"))
}

/// Reads the persisted UI state. Missing or corrupt files fall back to `{}`
/// rather than blocking startup.
#[tauri::command]
pub fn load_prefs(app: AppHandle) -> Value {
    let Ok(path) = prefs_path(&app) else {
        return json!({});
    };
    fs::read_to_string(path)
        .ok()
        // A file hand-edited in a Windows editor starts with a BOM, which
        // serde_json refuses to parse. Silently losing every setting over
        // three bytes would be a nasty surprise.
        .and_then(|s| serde_json::from_str::<Value>(s.trim_start_matches('\u{feff}')).ok())
        .unwrap_or_else(|| json!({}))
}

#[tauri::command]
pub fn save_prefs(app: AppHandle, prefs: Value) -> Result<(), String> {
    let path = prefs_path(&app)?;
    let body = serde_json::to_string_pretty(&prefs)
        .map_err(|e| format!("Could not serialise preferences: {e}"))?;
    fs::write(path, body).map_err(|e| format!("Could not write preferences: {e}"))
}
