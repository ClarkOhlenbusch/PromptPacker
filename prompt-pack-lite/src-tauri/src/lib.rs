use serde::{Serialize, Deserialize};
use ignore::WalkBuilder;
use std::path::Path;
use std::fs::File;
use std::io::{self, Read};
use std::sync::Mutex;
use tauri::{State, Emitter, Manager};
use notify::{Watcher, RecommendedWatcher, RecursiveMode, Event};

mod skeleton;

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

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn scan_project(path: String) -> Result<Vec<FileEntry>, String> {
    let root_path = Path::new(&path);
    if !root_path.exists() {
        return Err("Path does not exist".to_string());
    }

    let walker = WalkBuilder::new(&path)
        .standard_filters(true)
        .filter_entry(|entry| {
            let name = entry.file_name().to_string_lossy();
            let name_lower = name.to_lowercase();

            // Directories to ignore
            if name == "node_modules" || 
               name == "target" || 
               name == "dist" || 
               name == "build" || 
               name == "out" || 
               name == ".git" || 
               name == ".vscode" || 
               name == ".idea" || 
               name == "__pycache__" || 
               name == ".DS_Store" {
                return false;
            }

            // Extensions to ignore (Images, Fonts, Binaries)
            let ignored_extensions = [
                ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".tiff",
                ".woff", ".woff2", ".ttf", ".eot", 
                ".exe", ".dll", ".so", ".dylib", ".bin", ".obj", ".o", ".a", ".lib",
                ".pdf", ".zip", ".tar", ".gz", ".7z", ".rar"
            ];

            for ext in ignored_extensions {
                if name_lower.ends_with(ext) {
                    return false;
                }
            }

            true
        })
        .build();

    let mut entries = Vec::new();

    for result in walker {
        match result {
            Ok(entry) => {
                let p = entry.path();
                if p == root_path { continue; } 
                
                let relative_res = p.strip_prefix(&path);
                if let Ok(relative) = relative_res {
                     let is_dir = p.is_dir();
                     let size = p.metadata().map(|m| m.len()).unwrap_or(0);
                     let mut line_count = None;
                     
                     if !is_dir && size < 10 * 1024 * 1024 {
                         line_count = count_lines(p);
                     }

                     entries.push(FileEntry {
                         path: p.to_string_lossy().to_string(),
                         relative_path: relative.to_string_lossy().to_string(),
                         is_dir,
                         size,
                         line_count,
                     });
                }
            }
            Err(err) => eprintln!("Error walking path: {}", err),
        }
    }
    
    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));

    Ok(entries)
}

#[tauri::command]
fn watch_project(app: tauri::AppHandle, path: String, state: State<'_, WatcherState>) -> Result<(), String> {
    let mut watcher_guard = state.watcher.lock().map_err(|_| "Failed to lock watcher state")?;
    
    // Stop existing watcher by dropping it (taking it out of the Option)
    let _ = watcher_guard.take();
    
    let app_handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        match res {
           Ok(_) => {
               // Emit simple event to trigger refresh
               let _ = app_handle.emit("project-change", ());
           }
           Err(e) => eprintln!("watch error: {:?}", e),
        }
    }).map_err(|e| e.to_string())?;
    
    watcher.watch(Path::new(&path), RecursiveMode::Recursive).map_err(|e| e.to_string())?;
    
    *watcher_guard = Some(watcher);
    
    Ok(())
}

#[tauri::command]
fn read_file_content(path: String) -> Result<String, String> {
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
fn skeletonize_file(path: String) -> Result<SkeletonResult, String> {
    // Read the file content
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;

    // Extract file extension
    let extension = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    // Run skeletonization
    let result = skeleton::skeletonize(&content, extension);

    // Calculate compression ratio
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
}

/// Batch skeletonize multiple files at once for efficiency
#[tauri::command]
fn skeletonize_files(paths: Vec<String>) -> Vec<Result<SkeletonResult, String>> {
    paths.into_iter().map(skeletonize_file).collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]

pub fn run() {

    tauri::Builder::default()

        .plugin(tauri_plugin_fs::init())

        .plugin(tauri_plugin_dialog::init())

        .plugin(tauri_plugin_opener::init())

        .setup(|app| {

            app.manage(WatcherState { watcher: Mutex::new(None) });

            Ok(())

        })

        .invoke_handler(tauri::generate_handler![greet, scan_project, read_file_content, watch_project, skeletonize_file, skeletonize_files])

        .run(tauri::generate_context!())

        .expect("error while running tauri application");

}
