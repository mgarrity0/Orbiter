use std::path::PathBuf;
use std::sync::Mutex;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

struct WatcherState(Mutex<Option<RecommendedWatcher>>);

// Start watching the patterns directory. The path is computed server-side
// from `project_root()` + "patterns" rather than trusted from the caller
// so webview code can't redirect the watcher at `C:\Windows` or
// `/etc` and generate a flood of unrelated events.
#[tauri::command]
fn watch_patterns_dir(
    app: AppHandle,
    watcher_state: State<'_, WatcherState>,
) -> Result<(), String> {
    let mut guard = watcher_state.0.lock().map_err(|e| e.to_string())?;
    *guard = None; // drop any previous watcher

    let root = project_root()?;
    let patterns_path = PathBuf::from(&root).join("patterns");
    // Make sure the directory exists before we try to watch it, otherwise
    // notify returns an error on machines where the user hasn't created
    // patterns/ yet. setup() already does this at startup, but double-
    // guarding costs nothing.
    let _ = std::fs::create_dir_all(&patterns_path);

    let emitter = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        if let Ok(event) = res {
            let paths: Vec<String> = event
                .paths
                .iter()
                .map(|p| p.to_string_lossy().to_string())
                .collect();
            let _ = emitter.emit(
                "patterns-changed",
                serde_json::json!({
                    "kind": format!("{:?}", event.kind),
                    "paths": paths,
                }),
            );
        }
    })
    .map_err(|e| e.to_string())?;

    watcher
        .watch(patterns_path.as_path(), RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    *guard = Some(watcher);
    Ok(())
}

#[tauri::command]
fn list_patterns() -> Result<Vec<String>, String> {
    let root = project_root()?;
    let patterns_dir = PathBuf::from(&root).join("patterns");
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&patterns_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".js") || name.ends_with(".mjs") {
                out.push(name);
            }
        }
    }
    out.sort();
    Ok(out)
}

#[tauri::command]
fn read_pattern(name: String) -> Result<String, String> {
    // Guard against path traversal; patterns are expected to be flat files
    // directly under {project_root}/patterns.
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("invalid pattern name".into());
    }
    let root = project_root()?;
    let path = PathBuf::from(&root).join("patterns").join(&name);
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

// Save a pattern file. Used by the in-app editor. `name` must end in .js
// or .mjs and must not contain path separators. The notify watcher on
// patterns/ will fire immediately after this write, so the frontend gets
// its normal hot-reload path "for free" — no separate reload emit here.
#[tauri::command]
fn write_pattern(name: String, content: String) -> Result<String, String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("invalid pattern name".into());
    }
    if !(name.ends_with(".js") || name.ends_with(".mjs")) {
        return Err("pattern filename must end in .js or .mjs".into());
    }
    let root = project_root()?;
    let dir = PathBuf::from(&root).join("patterns");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&name);
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[derive(Deserialize)]
struct ExportFile {
    filename: String,
    content: String,
}

// Write a batch of files to a user-chosen directory. The frontend picks
// the directory via the dialog plugin and then hands us the list; we
// validate filenames (no path separators) and create the destination
// directory if it doesn't exist.
#[tauri::command]
fn write_export_files(dest_dir: String, files: Vec<ExportFile>) -> Result<Vec<String>, String> {
    let dir = PathBuf::from(&dest_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut written = Vec::with_capacity(files.len());
    for f in files {
        if f.filename.contains('/') || f.filename.contains('\\') || f.filename.contains("..") {
            return Err(format!("invalid export filename: {}", f.filename));
        }
        let path = dir.join(&f.filename);
        std::fs::write(&path, f.content.as_bytes()).map_err(|e| e.to_string())?;
        written.push(path.to_string_lossy().to_string());
    }
    Ok(written)
}

#[tauri::command]
fn list_projects() -> Result<Vec<String>, String> {
    let root = project_root()?;
    let dir = PathBuf::from(&root).join("projects");
    let mut out = Vec::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.ends_with(".json") {
                out.push(name);
            }
        }
    }
    out.sort();
    Ok(out)
}

#[tauri::command]
fn read_project(name: String) -> Result<String, String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("invalid project name".into());
    }
    let root = project_root()?;
    let path = PathBuf::from(&root).join("projects").join(&name);
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_project(name: String, content: String) -> Result<String, String> {
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("invalid project name".into());
    }
    let root = project_root()?;
    let dir = PathBuf::from(&root).join("projects");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&name);
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
fn project_root() -> Result<String, String> {
    // Patterns and projects live at the project-root level (sibling to src-tauri).
    //
    // Resolution order:
    //   1. `ORBITER_PROJECT_ROOT` env var — explicit override for bundled
    //      installs where the user wants patterns/ in, e.g., Documents. This
    //      also lets packagers point at a per-user AppData path without
    //      relying on the ancestor walk.
    //   2. Walk up from the exe looking for a `package.json` marker — works
    //      in `tauri dev` where the exe lives under `target/…/deps/`.
    //   3. Fall back to the exe's directory.
    //
    // The ancestor walk has a pitfall: if the exe is installed under a tree
    // that happens to contain a `package.json` somewhere above (a dev user
    // keeping their binary under ~/code/), that path wins even though it's
    // not the real project root. The env override exists specifically to
    // escape that case.
    if let Ok(v) = std::env::var("ORBITER_PROJECT_ROOT") {
        if !v.is_empty() {
            return Ok(v);
        }
    }

    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe.parent().ok_or("no exe parent")?.to_path_buf();

    let mut cursor = exe_dir.clone();
    for _ in 0..6 {
        if cursor.join("package.json").exists() {
            return Ok(cursor.to_string_lossy().to_string());
        }
        match cursor.parent() {
            Some(p) => cursor = p.to_path_buf(),
            None => break,
        }
    }
    Ok(exe_dir.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // No tauri-plugin-fs: all fs access goes through our custom commands
        // (read_pattern, write_pattern, read_project, write_project,
        // write_export_files). They sanitize names and confine writes to the
        // project root — arbitrary pattern code in the webview can't use them
        // to read /etc/passwd or write to ~/.ssh.
        .plugin(tauri_plugin_dialog::init())
        .manage(WatcherState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            watch_patterns_dir,
            project_root,
            list_patterns,
            read_pattern,
            write_pattern,
            write_export_files,
            list_projects,
            read_project,
            write_project
        ])
        .setup(|_app| {
            if let Ok(root) = project_root() {
                let root = PathBuf::from(root);
                let _ = std::fs::create_dir_all(root.join("patterns"));
                let _ = std::fs::create_dir_all(root.join("projects"));
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
