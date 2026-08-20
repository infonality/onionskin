//! Native application menu.
//!
//! Only installed on macOS, where the menu bar lives outside the window. On
//! Windows and Linux the window is undecorated and the frontend renders its own
//! menu inside the custom title bar.

#![cfg(target_os = "macos")]

use tauri::menu::{
    AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder,
};
use tauri::{AppHandle, Wry};

macro_rules! item {
    ($app:expr, $id:expr, $label:expr) => {
        MenuItemBuilder::with_id($id, $label).build($app)?
    };
    ($app:expr, $id:expr, $label:expr, $accel:expr) => {
        MenuItemBuilder::with_id($id, $label)
            .accelerator($accel)
            .build($app)?
    };
}

pub fn install(app: &AppHandle<Wry>) -> tauri::Result<()> {
    let about = AboutMetadataBuilder::new()
        .name(Some("Onionskin"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .comments(Some("A clean, modern Markdown editor."))
        .build();

    let app_menu = SubmenuBuilder::new(app, "Onionskin")
        .about(Some(about))
        .separator()
        .item(&item!(app, "settings", "Settings…", "CmdOrCtrl+,"))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&item!(app, "new", "New", "CmdOrCtrl+N"))
        .item(&item!(app, "open", "Open…", "CmdOrCtrl+O"))
        .item(&item!(app, "open-folder", "Open Folder…", "CmdOrCtrl+Shift+O"))
        .separator()
        .item(&item!(app, "save", "Save", "CmdOrCtrl+S"))
        .item(&item!(app, "save-as", "Save As…", "CmdOrCtrl+Shift+S"))
        .separator()
        .item(&item!(app, "export-html", "Export as HTML…"))
        .item(&item!(app, "export-pdf", "Print / Export PDF…", "CmdOrCtrl+P"))
        .separator()
        .item(&item!(app, "reveal", "Reveal in Finder"))
        .separator()
        .item(&item!(app, "close-tab", "Close Tab", "CmdOrCtrl+W"))
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .separator()
        .item(&item!(app, "find", "Find…", "CmdOrCtrl+F"))
        .item(&item!(app, "replace", "Find and Replace…", "CmdOrCtrl+Alt+F"))
        .separator()
        .item(&item!(app, "palette", "Command Palette…", "CmdOrCtrl+Shift+P"))
        .item(&item!(app, "quick-open", "Quick Open…", "CmdOrCtrl+K"))
        .build()?;

    let heading_menu = SubmenuBuilder::new(app, "Heading")
        .item(&item!(app, "h1", "Heading 1", "CmdOrCtrl+1"))
        .item(&item!(app, "h2", "Heading 2", "CmdOrCtrl+2"))
        .item(&item!(app, "h3", "Heading 3", "CmdOrCtrl+3"))
        .item(&item!(app, "h4", "Heading 4", "CmdOrCtrl+4"))
        .item(&item!(app, "h5", "Heading 5", "CmdOrCtrl+5"))
        .item(&item!(app, "h6", "Heading 6", "CmdOrCtrl+6"))
        .separator()
        .item(&item!(app, "paragraph", "Paragraph", "CmdOrCtrl+0"))
        .build()?;

    let format_menu = SubmenuBuilder::new(app, "Format")
        .item(&item!(app, "bold", "Bold", "CmdOrCtrl+B"))
        .item(&item!(app, "italic", "Italic", "CmdOrCtrl+I"))
        .item(&item!(app, "strike", "Strikethrough", "CmdOrCtrl+Shift+X"))
        .item(&item!(app, "inline-code", "Inline Code", "CmdOrCtrl+E"))
        .item(&item!(app, "highlight", "Highlight", "CmdOrCtrl+Shift+H"))
        .separator()
        .item(&heading_menu)
        .separator()
        .item(&item!(app, "link", "Insert Link", "CmdOrCtrl+L"))
        .item(&item!(app, "image", "Insert Image…"))
        .item(&item!(app, "table", "Insert Table", "CmdOrCtrl+Shift+T"))
        .item(&item!(app, "code-block", "Code Block", "CmdOrCtrl+Shift+K"))
        .item(&item!(app, "quote", "Blockquote", "CmdOrCtrl+Shift+Q"))
        .item(&item!(app, "hr", "Horizontal Rule", "CmdOrCtrl+Shift+R"))
        .separator()
        .item(&item!(app, "list-bullet", "Bulleted List", "CmdOrCtrl+Shift+8"))
        .item(&item!(app, "list-ordered", "Numbered List", "CmdOrCtrl+Shift+9"))
        .item(&item!(app, "list-task", "Task List", "CmdOrCtrl+Shift+0"))
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&item!(app, "toggle-sidebar", "Toggle Sidebar", "CmdOrCtrl+\\"))
        .item(&item!(app, "toggle-outline", "Toggle Outline", "CmdOrCtrl+Shift+\\"))
        .separator()
        .item(&item!(app, "toggle-source", "Source Mode", "CmdOrCtrl+/"))
        .item(&item!(app, "toggle-focus", "Focus Mode", "CmdOrCtrl+Shift+F"))
        .item(&item!(app, "toggle-typewriter", "Typewriter Mode"))
        .separator()
        .item(&item!(app, "theme-toggle", "Toggle Dark Mode", "CmdOrCtrl+Shift+D"))
        .separator()
        .item(&item!(app, "zoom-in", "Zoom In", "CmdOrCtrl+="))
        .item(&item!(app, "zoom-out", "Zoom Out", "CmdOrCtrl+-"))
        .item(&item!(app, "zoom-reset", "Actual Size", "CmdOrCtrl+Shift+="))
        .separator()
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&item!(app, "shortcuts", "Keyboard Shortcuts"))
        .item(&item!(app, "markdown-guide", "Markdown Reference"))
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &format_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ])
        .build()?;

    app.set_menu(menu)?;
    Ok(())
}
