use serde::{Serialize, Deserialize};
use ignore::WalkBuilder;
use std::path::Path;
use std::fs::File;
use std::io::{self, Read};

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
            Err(_) => return None, // Binary or read error
        }
    }
    // If file is not empty and doesn't end with newline, we might miss one line? 
    // Usually line count = newlines. For 1 line file without \n, it is 0 newlines.
    // Editors display "1 line". 
    // Let's stick to newline count for simplicity, or add 1 if file > 0 size?
    // Let's just count newlines. 
    Some(count + 1) // Approximation: most files have content. Empty file 0 lines?
    // If size is 0, return 0.
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
                     
                     if !is_dir {
                         // Simple heuristic: skip large files or known binaries if needed
                         // For now, try to count everything.
                         if size < 10 * 1024 * 1024 { // Skip > 10MB for speed
                             if let Ok(file) = File::open(p) {
                                 // Check if binary roughly? 
                                 // We'll just count newlines. 
                                 // To avoid reading whole binary files, maybe skip if extension looks binary?
                                 // Let's rely on size limit.
                                 if size > 0 {
                                     let mut reader = io::BufReader::new(file);
                                     let mut buffer = [0; 8 * 1024];
                                     let mut count = 0;
                                     let mut valid = true;
                                     
                                     loop {
                                         match reader.read(&mut buffer) {
                                             Ok(0) => break,
                                             Ok(n) => {
                                                 // Check for binary bytes to bail early? 
                                                 // if buffer[..n].contains(&0) { valid = false; break; } 
                                                 
                                                 count += buffer[..n].iter().filter(|&&b| b == b'\n').count();
                                             }
                                             Err(_) => { valid = false; break; }
                                         }
                                     }
                                     if valid {
                                         line_count = Some(count + 1);
                                     }
                                 } else {
                                     line_count = Some(0);
                                 }
                             }
                         }
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
fn read_file_content(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, scan_project, read_file_content])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
