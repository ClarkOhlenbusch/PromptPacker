use serde::{Serialize, Deserialize};
use ignore::WalkBuilder;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::fs::File;
use std::io::{self, Read};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{State, Emitter, Manager};
use notify::{Watcher, RecommendedWatcher, RecursiveMode, Event};

mod skeleton;
mod skeleton_legacy;

#[cfg(test)]
mod skeleton_tests;

const IGNORED_DIR_NAMES: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".git",
    ".hg",
    ".svn",
    ".vscode",
    ".idea",
    ".cache",
    ".parcel-cache",
    ".turbo",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".astro",
    ".vite",
    ".vercel",
    ".netlify",
    ".expo",
    ".gradle",
    ".cxx",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".tox",
    ".nyc_output",
    "__pycache__",
    "__pypackages__",
    "coverage",
    "tmp",
    "temp",
    "logs",
    "log",
    "vendor",
    "venv",
    ".venv",
    "bower_components",
    "jspm_packages",
    ".pnpm-store",
    ".yarn",
    "pods",
    "deriveddata",
];

const IGNORED_FILE_NAMES: &[&str] = &[
    ".ds_store",
    "thumbs.db",
    "desktop.ini",
];

const IGNORED_FILE_SUFFIXES: &[&str] = &[
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".tiff", ".svg", ".psd", ".ai", ".heic", ".avif",
    ".woff", ".woff2", ".ttf", ".eot", ".otf",
    ".exe", ".dll", ".so", ".dylib", ".bin", ".obj", ".o", ".a", ".lib", ".class", ".jar", ".war", ".ear", ".pdb", ".wasm", ".node",
    ".pdf", ".zip", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".7z", ".rar", ".iso", ".dmg", ".pkg", ".deb", ".rpm",
    ".mp4", ".mov", ".mkv", ".avi", ".webm", ".wmv", ".mpg", ".mpeg",
    ".mp3", ".wav", ".flac", ".aac", ".m4a", ".ogg",
    ".csv", ".tsv", ".parquet", ".arrow", ".db", ".sqlite", ".sqlite3", ".duckdb", ".rdb", ".pkl", ".pickle",
    ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".key", ".pages", ".numbers",
    ".log", ".map", ".cache", ".min.js", ".min.css", ".bak", ".lock", ".icns",
];

struct WatcherState {
    watcher: Mutex<Option<RecommendedWatcher>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct FileEntry {
    path: String,
    relative_path: String,
    is_dir: bool,
    size: u64,
    line_count: Option<usize>,
}

fn count_lines(path: &Path) -> Option<usize> {
    let file = File::open(path).ok()?;
    let mut reader = io::BufReader::new(file);
    let mut buffer = [0; 32 * 1024];
    let mut count = 0;

    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(n) => {
                count += buffer[..n].iter().filter(|&&b| b == b'\n').count();
            }
            Err(_) => return None,
        }
    }
    Some(count + 1)
}

fn is_ignored_dir(name_lower: &str, path: &Path) -> bool {
    if IGNORED_DIR_NAMES.iter().any(|dir| dir == &name_lower) {
        return true;
    }
    if name_lower == "icons" && path_has_component(path, "src-tauri") {
        return true;
    }
    false
}

fn path_has_component(path: &Path, component: &str) -> bool {
    path.components().any(|part| {
        part.as_os_str()
            .to_str()
            .map(|s| s.eq_ignore_ascii_case(component))
            .unwrap_or(false)
    })
}

fn is_ignored_file(name_lower: &str) -> bool {
    if IGNORED_FILE_NAMES.iter().any(|name| name == &name_lower) {
        return true;
    }
    IGNORED_FILE_SUFFIXES.iter().any(|ext| name_lower.ends_with(ext))
}

fn should_emit(event: &Event) -> bool {
    use notify::event::ModifyKind;

    match event.kind {
        notify::EventKind::Access(_) => false,
        notify::EventKind::Modify(ModifyKind::Metadata(_)) => false,
        _ => true,
    }
}

fn normalize_relative_path(relative: &Path) -> String {
    relative.to_string_lossy().replace('\\', "/")
}

fn scan_project_entries(path: &Path) -> Result<(Vec<FileEntry>, Vec<PathBuf>), String> {
    if !path.exists() {
        return Err("Path does not exist".to_string());
    }

    let walker = WalkBuilder::new(path)
        .standard_filters(true)
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            let name_lower = name.to_lowercase();
            let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);

            if is_dir {
                return !is_ignored_dir(&name_lower, entry.path());
            }

            if is_ignored_file(&name_lower) {
                return false;
            }

            !is_ignored_dir(&name_lower, entry.path())
        })
        .build();

    let mut entries = Vec::new();
    let mut dirs_to_watch: Vec<PathBuf> = Vec::new();

    for result in walker {
        match result {
            Ok(entry) => {
                let p = entry.path();
                if p.is_dir() {
                    dirs_to_watch.push(p.to_path_buf());
                }
                if p == path {
                    continue;
                }

                let relative_res = p.strip_prefix(path);
                if let Ok(relative) = relative_res {
                    let is_dir = p.is_dir();
                    let size = p.metadata().map(|m| m.len()).unwrap_or(0);
                    let mut line_count = None;

                    if !is_dir && size < 10 * 1024 * 1024 {
                        line_count = count_lines(p);
                    }

                    entries.push(FileEntry {
                        path: p.to_string_lossy().to_string(),
                        relative_path: normalize_relative_path(relative),
                        is_dir,
                        size,
                        line_count,
                    });
                }
            }
            Err(err) => eprintln!("Error walking path: {}", err),
        }
    }

    let mut keep_dirs: HashSet<String> = HashSet::new();
    for entry in entries.iter().filter(|e| !e.is_dir) {
        let mut current = Path::new(&entry.path).parent();
        while let Some(dir) = current {
            if dir == path {
                break;
            }
            keep_dirs.insert(dir.to_string_lossy().to_string());
            current = dir.parent();
        }
    }

    entries.retain(|entry| !entry.is_dir || keep_dirs.contains(&entry.path));
    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

    Ok((entries, dirs_to_watch))
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn scan_project(path: String, state: State<'_, WatcherState>) -> Result<Vec<FileEntry>, String> {
    let root_path = Path::new(&path);
    let (entries, dirs_to_watch) = scan_project_entries(root_path)?;

    if let Ok(mut watcher_guard) = state.watcher.lock() {
        if let Some(watcher) = watcher_guard.as_mut() {
            for dir in dirs_to_watch {
                let _ = watcher.watch(&dir, RecursiveMode::NonRecursive);
            }
        }
    }

    Ok(entries)
}

#[tauri::command]
async fn watch_project(app: tauri::AppHandle, path: String, state: State<'_, WatcherState>) -> Result<(), String> {
    let mut watcher_guard = state.watcher.lock().map_err(|_| "Failed to lock watcher state")?;
    
    // Stop existing watcher by dropping it (taking it out of the Option)
    let _ = watcher_guard.take();
    
    let debounce = Duration::from_millis(500);
    let last_emit = Arc::new(Mutex::new(Instant::now()));
    let last_emit_for_cb = last_emit.clone();
    let app_handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        match res {
           Ok(event) => {
               if !should_emit(&event) {
                   return;
               }

               let mut last_emit = match last_emit_for_cb.lock() {
                   Ok(guard) => guard,
                   Err(poisoned) => poisoned.into_inner(),
               };
               if last_emit.elapsed() < debounce {
                   return;
               }
               *last_emit = Instant::now();
               // Emit simple event to trigger refresh
               let _ = app_handle.emit("project-change", ());
           }
           Err(e) => eprintln!("watch error: {:?}", e),
        }
    }).map_err(|e| e.to_string())?;
    
    // Use ignore::WalkBuilder to find all valid directories to watch
    // This avoids watching massive ignored directories like node_modules which causes freezes
    let walker = WalkBuilder::new(&path)
        .standard_filters(true)
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            let name_lower = name.to_lowercase();
            !is_ignored_dir(&name_lower, entry.path())
        })
        .build();

    for result in walker {
        if let Ok(entry) = result {
            if entry.path().is_dir() {
                let _ = watcher.watch(entry.path(), RecursiveMode::NonRecursive);
            }
        }
    }
    
    *watcher_guard = Some(watcher);
    
    Ok(())
}

#[tauri::command]
async fn read_file_content(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Result of skeleton extraction, returned to frontend
#[derive(Debug, Serialize, Deserialize)]
struct SkeletonResult {
    skeleton: String,
    language: Option<String>,
    original_lines: usize,
    skeleton_lines: usize,
    compression_ratio: f32,
}

/// Skeletonize a file using AST-based extraction
/// Returns structural signatures (imports, types, function signatures) without implementation details
#[tauri::command]
async fn skeletonize_file(path: String) -> Result<SkeletonResult, String> {
    use std::time::Instant;
    
    let start = Instant::now();
    eprintln!("[SKELETON] Starting: {}", path);
    
    // Read the file content
    let read_start = Instant::now();
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    eprintln!("[SKELETON] Read {} bytes in {:?}", content.len(), read_start.elapsed());

    // Extract file extension
    let extension = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    // Run skeletonization
    let skel_start = Instant::now();
    let result = skeleton::skeletonize_with_path(&content, extension, Some(&path));
    eprintln!("[SKELETON] Skeletonized in {:?} (lang: {:?})", skel_start.elapsed(), result.language);

    // Calculate compression ratio
    let original_chars = content.len() as f32;
    let skeleton_chars = result.skeleton.len() as f32;
    let compression_ratio = if original_chars > 0.0 {
        1.0 - (skeleton_chars / original_chars)
    } else {
        0.0
    };

    eprintln!("[SKELETON] Total time for {}: {:?}", path, start.elapsed());

    Ok(SkeletonResult {
        skeleton: result.skeleton,
        language: result.language.map(|l| format!("{:?}", l)),
        original_lines: result.original_lines,
        skeleton_lines: result.skeleton_lines,
        compression_ratio,
    })
}

/// Batch skeletonize multiple files at once for efficiency
#[tauri::command]
async fn skeletonize_files(paths: Vec<String>) -> Vec<Result<SkeletonResult, String>> {
    paths.into_iter().map(|p| {
        // Can't directly await in map, so we'll just execute synchronously inside the async wrapper
        // or actually, since we are largely CPU bound, spawning threads might be better but
        // simply making the command async offloads it from the main UI thread.
        // Re-using the logic from skeletonize_file but synchronized is fine here
        // as long as the outer command is async.
        
        // However, since we call skeletonize_file (which is now async) we can't call it directly easily.
        // Let's just inline the synchronous logic or extraction.
        let content = std::fs::read_to_string(&p).map_err(|e| e.to_string())?;
         let extension = Path::new(&p)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        let result = skeleton::skeletonize_with_path(&content, extension, Some(&p));
        
        let original_chars = content.len() as f32;
        let skeleton_chars = result.skeleton.len() as f32;
        let compression_ratio = if original_chars > 0.0 {
            1.0 - (skeleton_chars / original_chars)
        } else {
            0.0
        };
        
        Ok(SkeletonResult {
            skeleton: result.skeleton,
            language: result.language.map(|l| format!("{:?}", l)),
            original_lines: result.original_lines,
            skeleton_lines: result.skeleton_lines,
            compression_ratio,
        })
    }).collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]

pub fn run() {

    tauri::Builder::default()

        .plugin(tauri_plugin_fs::init())

        .plugin(tauri_plugin_dialog::init())

        .plugin(tauri_plugin_opener::init())

        .plugin(tauri_plugin_clipboard_manager::init())

        .setup(|app| {

            app.manage(WatcherState { watcher: Mutex::new(None) });

            Ok(())

        })

        .invoke_handler(tauri::generate_handler![greet, scan_project, read_file_content, watch_project, skeletonize_file, skeletonize_files])

        .run(tauri::generate_context!())

        .expect("error while running tauri application");

}

#[cfg(test)]
mod lib_tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(prefix: &str) -> Self {
            let mut path = std::env::temp_dir();
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            path.push(format!("{}_{}_{}", prefix, std::process::id(), now));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn normalize_relative_path_replaces_backslashes() {
        let path = Path::new("foo\\bar\\baz.txt");
        assert_eq!(normalize_relative_path(path), "foo/bar/baz.txt");
    }

    #[test]
    fn scan_project_entries_collects_dirs_and_paths() {
        let temp = TestDir::new("prompt_pack_lite_scan");
        let root = temp.path();
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::write(root.join("src").join("main.rs"), "fn main() {}\n").unwrap();

        let (entries, dirs) = scan_project_entries(root).expect("scan project");

        assert!(dirs.iter().any(|dir| dir == &root.join("src")));
        assert!(entries.iter().any(|entry| entry.relative_path == "src/main.rs"));
    }
}
