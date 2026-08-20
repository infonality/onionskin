mod fs_ops;
mod menu;
mod prefs;

use tauri::{Emitter, Manager, WindowEvent};

/// Closes the window for real. The close button only *asks* to close so the
/// frontend can prompt about unsaved work first; this is the confirmed path.
#[tauri::command]
fn confirm_close(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.destroy();
    }
}

/// Called once the UI has painted, so the user never sees a blank window.
#[tauri::command]
fn ready(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            ready,
            confirm_close,
            fs_ops::read_document,
            fs_ops::write_document,
            fs_ops::file_mtime,
            fs_ops::list_directory,
            fs_ops::scan_markdown_files,
            fs_ops::search_in_folder,
            fs_ops::create_document,
            fs_ops::create_folder,
            fs_ops::rename_entry,
            fs_ops::trash_entry,
            fs_ops::reveal_entry,
            fs_ops::startup_info,
            fs_ops::path_exists,
            prefs::load_prefs,
            prefs::save_prefs,
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            menu::install(app.handle())?;

            // Safety net: if the frontend fails to signal readiness, reveal the
            // window anyway rather than leaving an invisible process running.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(4000));
                if let Some(window) = handle.get_webview_window("main") {
                    if !window.is_visible().unwrap_or(true) {
                        let _ = window.show();
                    }
                }
            });

            Ok(())
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("menu-action", event.id().0.clone());
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("close-requested", ());
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Onionskin");
}
