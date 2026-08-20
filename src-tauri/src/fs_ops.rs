use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const MARKDOWN_EXTS: [&str; 7] = ["md", "markdown", "mdown", "mkd", "mdx", "txt", "text"];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentPayload {
    pub path: String,
    pub name: String,
    pub content: String,
    /// Milliseconds since the Unix epoch, used to detect out-of-band edits.
    pub modified: u64,
    /// "crlf" when the file on disk used Windows line endings; content is always LF.
    pub line_ending: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_markdown: bool,
    pub has_children: bool,
    pub size: u64,
    pub modified: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteRequest {
    pub path: String,
    pub content: String,
    #[serde(default)]
    pub line_ending: Option<String>,
}

fn err(context: &str, e: impl std::fmt::Display) -> String {
    format!("{context}: {e}")
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn file_name_of(path: &Path) -> String {
    path.file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .map(|e| MARKDOWN_EXTS.contains(&e.as_str()))
        .unwrap_or(false)
}

fn is_hidden(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules" || name == "$RECYCLE.BIN"
}

/// Reads a text file, normalising line endings to LF and stripping any BOM.
#[tauri::command]
pub fn read_document(path: String) -> Result<DocumentPayload, String> {
    let p = PathBuf::from(&path);
    let bytes = fs::read(&p).map_err(|e| err("Could not read file", e))?;

    // Reject obvious binaries rather than filling the editor with control codes.
    if bytes.iter().take(8000).any(|b| *b == 0) {
        return Err("That file looks binary, not text.".into());
    }

    let mut text = String::from_utf8_lossy(&bytes).into_owned();
    if text.starts_with('\u{feff}') {
        text.remove(0);
    }

    let line_ending = if text.contains("\r\n") { "crlf" } else { "lf" };
    let content = text.replace("\r\n", "\n").replace('\r', "\n");

    let meta = fs::metadata(&p).map_err(|e| err("Could not stat file", e))?;

    Ok(DocumentPayload {
        name: file_name_of(&p),
        path: p.to_string_lossy().to_string(),
        content,
        modified: mtime_ms(&meta),
        line_ending: line_ending.to_string(),
    })
}

/// Writes a document back to disk, restoring its original line endings.
#[tauri::command]
pub fn write_document(req: WriteRequest) -> Result<u64, String> {
    let p = PathBuf::from(&req.path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| err("Could not create folder", e))?;
        }
    }

    let out = if req.line_ending.as_deref() == Some("crlf") {
        req.content.replace('\n', "\r\n")
    } else {
        req.content
    };

    fs::write(&p, out.as_bytes()).map_err(|e| err("Could not save file", e))?;
    let meta = fs::metadata(&p).map_err(|e| err("Could not stat file", e))?;
    Ok(mtime_ms(&meta))
}

/// Returns the on-disk mtime, or `None` when the file no longer exists.
#[tauri::command]
pub fn file_mtime(path: String) -> Option<u64> {
    fs::metadata(path).ok().map(|m| mtime_ms(&m))
}

#[tauri::command]
pub fn list_directory(path: String, show_all: bool) -> Result<Vec<Entry>, String> {
    let dir = PathBuf::from(&path);
    let read = fs::read_dir(&dir).map_err(|e| err("Could not open folder", e))?;

    let mut entries: Vec<Entry> = Vec::new();
    for item in read.flatten() {
        let name = item.file_name().to_string_lossy().to_string();
        if is_hidden(&name) {
            continue;
        }
        let Ok(meta) = item.metadata() else { continue };
        let p = item.path();
        let dir_like = meta.is_dir();
        let md = is_markdown(&p);
        if !show_all && !dir_like && !md {
            continue;
        }
        entries.push(Entry {
            name,
            path: p.to_string_lossy().to_string(),
            is_dir: dir_like,
            is_markdown: md,
            has_children: dir_like
                && fs::read_dir(&p)
                    .map(|mut it| it.next().is_some())
                    .unwrap_or(false),
            size: if dir_like { 0 } else { meta.len() },
            modified: mtime_ms(&meta),
        });
    }

    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

/// Recursively collects markdown files under `root` for the quick-open palette.
#[tauri::command]
pub fn scan_markdown_files(root: String, limit: usize) -> Result<Vec<Entry>, String> {
    let mut out: Vec<Entry> = Vec::new();
    let mut queue: Vec<PathBuf> = vec![PathBuf::from(&root)];
    let mut visited = 0usize;

    while let Some(dir) = queue.pop() {
        if out.len() >= limit || visited > 20_000 {
            break;
        }
        let Ok(read) = fs::read_dir(&dir) else { continue };
        for item in read.flatten() {
            visited += 1;
            let name = item.file_name().to_string_lossy().to_string();
            if is_hidden(&name) {
                continue;
            }
            let Ok(meta) = item.metadata() else { continue };
            let p = item.path();
            if meta.is_dir() {
                queue.push(p);
            } else if is_markdown(&p) {
                if out.len() >= limit {
                    break;
                }
                out.push(Entry {
                    name,
                    path: p.to_string_lossy().to_string(),
                    is_dir: false,
                    is_markdown: true,
                    has_children: false,
                    size: meta.len(),
                    modified: mtime_ms(&meta),
                });
            }
        }
    }

    // Newest first.
    out.sort_by_key(|e| std::cmp::Reverse(e.modified));
    Ok(out)
}

/// Full-text search across markdown files in a folder. Returns one hit per line.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub name: String,
    pub line: usize,
    pub text: String,
}

#[tauri::command]
pub fn search_in_folder(
    root: String,
    query: String,
    limit: usize,
) -> Result<Vec<SearchHit>, String> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Ok(vec![]);
    }

    let files = scan_markdown_files(root, 3000)?;
    let mut hits = Vec::new();

    for f in files {
        if hits.len() >= limit {
            break;
        }
        if f.size > 4_000_000 {
            continue;
        }
        let Ok(body) = fs::read_to_string(&f.path) else {
            continue;
        };
        for (i, line) in body.lines().enumerate() {
            if line.to_lowercase().contains(&needle) {
                hits.push(SearchHit {
                    path: f.path.clone(),
                    name: f.name.clone(),
                    line: i + 1,
                    text: line.trim().chars().take(220).collect(),
                });
                if hits.len() >= limit {
                    break;
                }
            }
        }
    }

    Ok(hits)
}

fn unique_path(dir: &Path, name: &str) -> PathBuf {
    let candidate = dir.join(name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| name.to_string());
    let ext = Path::new(name)
        .extension()
        .map(|s| format!(".{}", s.to_string_lossy()))
        .unwrap_or_default();
    for n in 2..1000 {
        let candidate = dir.join(format!("{stem} {n}{ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(name)
}

#[tauri::command]
pub fn create_document(dir: String, name: String) -> Result<String, String> {
    let target = unique_path(Path::new(&dir), &name);
    fs::write(&target, "").map_err(|e| err("Could not create file", e))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_folder(dir: String, name: String) -> Result<String, String> {
    let target = unique_path(Path::new(&dir), &name);
    fs::create_dir_all(&target).map_err(|e| err("Could not create folder", e))?;
    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub fn rename_entry(path: String, new_name: String) -> Result<String, String> {
    let from = PathBuf::from(&path);
    let parent = from
        .parent()
        .ok_or_else(|| "That item has no parent folder.".to_string())?;
    let to = parent.join(&new_name);
    if to.exists() {
        return Err(format!("\"{new_name}\" already exists here."));
    }
    fs::rename(&from, &to).map_err(|e| err("Could not rename", e))?;
    Ok(to.to_string_lossy().to_string())
}

/// Moves an entry to the OS trash so a mis-click is always recoverable.
#[tauri::command]
pub fn trash_entry(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| err("Could not move to trash", e))
}

#[tauri::command]
pub fn reveal_entry(path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    let dir = if p.is_dir() {
        p.clone()
    } else {
        p.parent().map(|x| x.to_path_buf()).unwrap_or(p.clone())
    };

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", p.display()))
            .spawn()
            .map_err(|e| err("Could not open Explorer", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &p.to_string_lossy()])
            .spawn()
            .map_err(|e| err("Could not open Finder", e))?;
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        std::process::Command::new("xdg-open")
            .arg(dir.as_os_str())
            .spawn()
            .map_err(|e| err("Could not open file manager", e))?;
    }

    let _ = dir;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupInfo {
    pub files: Vec<String>,
    pub home: String,
    pub documents: String,
    pub platform: String,
}

/// Files passed on the command line (double-clicking a `.md` in the OS shell).
#[tauri::command]
pub fn startup_info() -> StartupInfo {
    let files: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .filter(|a| Path::new(a).is_file())
        .collect();

    StartupInfo {
        files,
        home: dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        documents: dirs::document_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default(),
        platform: std::env::consts::OS.to_string(),
    }
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}
