use serde::{Serialize, Deserialize};
use ignore::WalkBuilder;
use std::collections::{HashSet, HashMap};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::{State, Emitter, Manager};
use notify::{Watcher, RecommendedWatcher, RecursiveMode, Event};
use tiktoken_rs::{cl100k_base, CoreBPE};
use similar::{ChangeTag, TextDiff};
use once_cell::sync::Lazy;
use rayon::prelude::*;

mod skeleton;
mod skeleton_legacy;

#[cfg(test)]
mod skeleton_tests;

// Initialize tokenizer once at startup to avoid blocking on first use
static TOKENIZER: Lazy<CoreBPE> = Lazy::new(|| {
    cl100k_base().expect("Failed to load tokenizer")
});

#[derive(Clone, Copy)]
struct TokenCacheEntry {
    file_size: u64,
    modified_unix_nanos: u128,
    token_count: usize,
}

#[derive(Clone)]
struct SkeletonCacheEntry {
    file_size: u64,
    modified_unix_nanos: u128,
    result: SkeletonResult,
}

static TOKEN_COUNT_CACHE: Lazy<Mutex<HashMap<String, TokenCacheEntry>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static SKELETON_CACHE: Lazy<Mutex<HashMap<String, SkeletonCacheEntry>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

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

struct SnapshotState {
    snapshot: Mutex<HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ScanMetrics {
    duration_ms: f64,
    file_count: usize,
    dir_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct TokenCountMetrics {
    duration_ms: f64,
    files_processed: usize,
    cache_hits: usize,
    cache_misses: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SkeletonFileMetrics {
    duration_ms: f64,
    cache_hit: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct SkeletonBatchMetrics {
    duration_ms: f64,
    files_processed: usize,
    cache_hits: usize,
    cache_misses: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct WatchMetrics {
    duration_ms: f64,
    dirs_watched: usize,
    used_cached_dirs: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct PerfMetrics {
    scan: Option<ScanMetrics>,
    token_count: Option<TokenCountMetrics>,
    skeleton_file: Option<SkeletonFileMetrics>,
    skeleton_batch: Option<SkeletonBatchMetrics>,
    watch: Option<WatchMetrics>,
    token_cache_size: usize,
    skeleton_cache_size: usize,
}

struct PerfMetricsState {
    metrics: Mutex<PerfMetrics>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct FileEntry {
    path: String,
    relative_path: String,
    is_dir: bool,
    size: u64,
    line_count: Option<usize>,
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

fn file_fingerprint(path: &Path) -> Option<(u64, u128)> {
    let metadata = path.metadata().ok()?;
    let modified_unix_nanos = metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    Some((metadata.len(), modified_unix_nanos))
}

fn scan_project_entries(path: &Path) -> Result<Vec<FileEntry>, String> {
    if !path.exists() {
        return Err("Path does not exist".to_string());
    }

    let root = path.to_path_buf();
    let (tx, rx) = std::sync::mpsc::channel::<FileEntry>();

    let walker = WalkBuilder::new(&root)
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
        .build_parallel();

    walker.run(|| {
        let tx = tx.clone();
        let root = root.clone();

        Box::new(move |result| {
            match result {
                Ok(entry) => {
                    let p = entry.path();
                    if p == root.as_path() {
                        return ignore::WalkState::Continue;
                    }

                    if let Ok(relative) = p.strip_prefix(&root) {
                        let is_dir = p.is_dir();
                        let size = p.metadata().map(|m| m.len()).unwrap_or(0);

                        let _ = tx.send(FileEntry {
                            path: p.to_string_lossy().to_string(),
                            relative_path: normalize_relative_path(relative),
                            is_dir,
                            size,
                            line_count: None,
                        });
                    }
                }
                Err(err) => eprintln!("Error walking path: {}", err),
            }

            ignore::WalkState::Continue
        })
    });

    // Drop the original sender so the channel closes once all walker threads finish.
    drop(tx);
    let mut entries: Vec<FileEntry> = rx.into_iter().collect();
	
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

    Ok(entries)
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn scan_project(path: String, perf: State<'_, PerfMetricsState>) -> Result<Vec<FileEntry>, String> {
    let start = Instant::now();
    let root_path = Path::new(&path);
    let entries = scan_project_entries(root_path)?;

    let file_count = entries.iter().filter(|e| !e.is_dir).count();
    let dir_count = entries.iter().filter(|e| e.is_dir).count();

    if let Ok(mut m) = perf.metrics.lock() {
        m.scan = Some(ScanMetrics {
            duration_ms: start.elapsed().as_secs_f64() * 1000.0,
            file_count,
            dir_count,
        });
        m.token_cache_size = TOKEN_COUNT_CACHE.lock().map(|c| c.len()).unwrap_or(0);
        m.skeleton_cache_size = SKELETON_CACHE.lock().map(|c| c.len()).unwrap_or(0);
    }

    Ok(entries)
}

#[tauri::command]
async fn watch_project(
    app: tauri::AppHandle,
    path: String,
    state: State<'_, WatcherState>,
    perf: State<'_, PerfMetricsState>,
) -> Result<(), String> {
    let start = Instant::now();
    let mut watcher_guard = state.watcher.lock().map_err(|_| "Failed to lock watcher state")?;

    // Drop the old watcher before creating a new one.
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
               let _ = app_handle.emit("project-change", ());
           }
           Err(e) => eprintln!("watch error: {:?}", e),
        }
    }).map_err(|e| e.to_string())?;

    // One recursive watcher on the root instead of one handle per directory.
    watcher.watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    *watcher_guard = Some(watcher);

    if let Ok(mut m) = perf.metrics.lock() {
        m.watch = Some(WatchMetrics {
            duration_ms: start.elapsed().as_secs_f64() * 1000.0,
            dirs_watched: 1,
            used_cached_dirs: false,
        });
    }

    Ok(())
}

#[tauri::command]
async fn read_file_content(path: String) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Result of skeleton extraction, returned to frontend
#[derive(Debug, Serialize, Deserialize, Clone)]
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
async fn skeletonize_file(path: String, perf: State<'_, PerfMetricsState>) -> Result<SkeletonResult, String> {
    let start = Instant::now();
    let mut cache_hit = false;

    let fingerprint = file_fingerprint(Path::new(&path));
    if let Some((file_size, modified_unix_nanos)) = fingerprint {
        let cached = SKELETON_CACHE
            .lock()
            .ok()
            .and_then(|cache| cache.get(&path).cloned());

        if let Some(entry) = cached {
            if entry.file_size == file_size && entry.modified_unix_nanos == modified_unix_nanos {
                cache_hit = true;
                if let Ok(mut m) = perf.metrics.lock() {
                    m.skeleton_file = Some(SkeletonFileMetrics {
                        duration_ms: start.elapsed().as_secs_f64() * 1000.0,
                        cache_hit,
                    });
                    m.skeleton_cache_size = SKELETON_CACHE.lock().map(|c| c.len()).unwrap_or(0);
                }
                return Ok(entry.result);
            }
        }
    }

    // Read the file content
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;

    // Extract file extension
    let extension = Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    // Run skeletonization
    let result = skeleton::skeletonize_with_path(&content, extension, Some(&path));

    // Calculate compression ratio
    let original_chars = content.len() as f32;
    let skeleton_chars = result.skeleton.len() as f32;
    let compression_ratio = if original_chars > 0.0 {
        1.0 - (skeleton_chars / original_chars)
    } else {
        0.0
    };

    let skeleton_result = SkeletonResult {
        skeleton: result.skeleton,
        language: result.language.map(|l| format!("{:?}", l)),
        original_lines: result.original_lines,
        skeleton_lines: result.skeleton_lines,
        compression_ratio,
    };

    if let Some((file_size, modified_unix_nanos)) = fingerprint {
        if let Ok(mut cache) = SKELETON_CACHE.lock() {
            cache.insert(
                path,
                SkeletonCacheEntry {
                    file_size,
                    modified_unix_nanos,
                    result: skeleton_result.clone(),
                },
            );
        }
    }

    if let Ok(mut m) = perf.metrics.lock() {
        m.skeleton_file = Some(SkeletonFileMetrics {
            duration_ms: start.elapsed().as_secs_f64() * 1000.0,
            cache_hit,
        });
        m.skeleton_cache_size = SKELETON_CACHE.lock().map(|c| c.len()).unwrap_or(0);
    }

    Ok(skeleton_result)
}

/// Batch skeletonize multiple files at once for efficiency
#[tauri::command]
async fn skeletonize_files(paths: Vec<String>, perf: State<'_, PerfMetricsState>) -> Result<Vec<Result<SkeletonResult, String>>, String> {
    let start = Instant::now();
    let files_processed = paths.len();
    let hit_counter = AtomicUsize::new(0);

    let results: Vec<Result<SkeletonResult, String>> = paths.into_par_iter().map(|p| {
        let fingerprint = file_fingerprint(Path::new(&p));
        if let Some((file_size, modified_unix_nanos)) = fingerprint {
            let cached = SKELETON_CACHE
                .lock()
                .ok()
                .and_then(|cache| cache.get(&p).cloned());

            if let Some(entry) = cached {
                if entry.file_size == file_size && entry.modified_unix_nanos == modified_unix_nanos {
                    hit_counter.fetch_add(1, Ordering::Relaxed);
                    return Ok(entry.result);
                }
            }
        }

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

        let skeleton_result = SkeletonResult {
            skeleton: result.skeleton,
            language: result.language.map(|l| format!("{:?}", l)),
            original_lines: result.original_lines,
            skeleton_lines: result.skeleton_lines,
            compression_ratio,
        };

        if let Some((file_size, modified_unix_nanos)) = fingerprint {
            if let Ok(mut cache) = SKELETON_CACHE.lock() {
                cache.insert(
                    p.clone(),
                    SkeletonCacheEntry {
                        file_size,
                        modified_unix_nanos,
                        result: skeleton_result.clone(),
                    },
                );
            }
        }

        Ok(skeleton_result)
    }).collect();

    let cache_hits = hit_counter.load(Ordering::Relaxed);
    if let Ok(mut m) = perf.metrics.lock() {
        m.skeleton_batch = Some(SkeletonBatchMetrics {
            duration_ms: start.elapsed().as_secs_f64() * 1000.0,
            files_processed,
            cache_hits,
            cache_misses: files_processed - cache_hits,
        });
        m.skeleton_cache_size = SKELETON_CACHE.lock().map(|c| c.len()).unwrap_or(0);
    }

    Ok(results)
}

/// Count tokens for given text using cl100k_base encoding (GPT-3.5/4 tokenizer)
#[tauri::command]
fn count_tokens(text: String) -> Result<usize, String> {
    Ok(TOKENIZER.encode_with_special_tokens(&text).len())
}

/// Count tokens for multiple file paths, reading content from disk
#[tauri::command]
async fn count_tokens_for_files(paths: Vec<String>, perf: State<'_, PerfMetricsState>) -> Result<usize, String> {
    let start = Instant::now();
    let files_processed = paths.len();

    let results: Vec<(usize, Option<(String, TokenCacheEntry)>)> = paths
        .par_iter()
        .map(|path| {
            let (file_size, modified_unix_nanos) = match file_fingerprint(Path::new(path)) {
                Some(fingerprint) => fingerprint,
                None => return (0, None),
            };

            let cached = TOKEN_COUNT_CACHE
                .lock()
                .ok()
                .and_then(|cache| cache.get(path).copied());

            if let Some(entry) = cached {
                if entry.file_size == file_size && entry.modified_unix_nanos == modified_unix_nanos {
                    return (entry.token_count, None);
                }
            }

            let content = match std::fs::read_to_string(path) {
                Ok(content) => content,
                Err(_) => return (0, None),
            };

            let token_count = TOKENIZER.encode_with_special_tokens(&content).len();

            (
                token_count,
                Some((
                    path.clone(),
                    TokenCacheEntry {
                        file_size,
                        modified_unix_nanos,
                        token_count,
                    },
                )),
            )
        })
        .collect();

    let total = results
        .iter()
        .map(|(token_count, _)| *token_count)
        .sum::<usize>();

    let new_entries: Vec<(String, TokenCacheEntry)> =
        results.into_iter().filter_map(|(_, entry)| entry).collect();

    let cache_misses = new_entries.len();
    let cache_hits = files_processed - cache_misses;

    if !new_entries.is_empty() {
        if let Ok(mut cache) = TOKEN_COUNT_CACHE.lock() {
            cache.extend(new_entries);
        }
    }

    if let Ok(mut m) = perf.metrics.lock() {
        m.token_count = Some(TokenCountMetrics {
            duration_ms: start.elapsed().as_secs_f64() * 1000.0,
            files_processed,
            cache_hits,
            cache_misses,
        });
        m.token_cache_size = TOKEN_COUNT_CACHE.lock().map(|c| c.len()).unwrap_or(0);
    }

    Ok(total)
}

#[derive(Debug, Serialize, Deserialize)]
struct DiffLine {
    #[serde(rename = "type")]
    line_type: String,
    line: String,
    old_line_num: Option<usize>,
    new_line_num: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize)]
struct FileDiff {
    path: String,
    relative_path: String,
    previous: String,
    current: String,
    diff: Vec<DiffLine>,
}

/// Take a snapshot of current file contents for diff comparison
#[tauri::command]
async fn take_snapshot(paths: Vec<String>, state: State<'_, SnapshotState>) -> Result<usize, String> {
    let mut snapshot = state.snapshot.lock().map_err(|_| "Lock error")?;
    snapshot.clear();
    
    for path in &paths {
        if let Ok(content) = std::fs::read_to_string(path) {
            snapshot.insert(path.clone(), content);
        }
    }
    
    Ok(snapshot.len())
}

/// Get diffs between snapshot and current file contents
#[tauri::command]
async fn get_diffs(paths: Vec<String>, root_path: String, state: State<'_, SnapshotState>) -> Result<Vec<FileDiff>, String> {
    let snapshot = state.snapshot.lock().map_err(|_| "Lock error")?;
    let root = Path::new(&root_path);
    let mut diffs = Vec::new();
    
    for path in paths {
        let Some(prev_content) = snapshot.get(&path) else { continue };
        let Ok(curr_content) = std::fs::read_to_string(&path) else { continue };
        
        if prev_content == &curr_content { continue; }
        
        let text_diff = TextDiff::from_lines(prev_content, &curr_content);
        let mut diff_lines = Vec::new();
        let mut old_line = 1usize;
        let mut new_line = 1usize;
        
        for change in text_diff.iter_all_changes() {
            let line = change.value().trim_end_matches('\n').to_string();
            match change.tag() {
                ChangeTag::Equal => {
                    diff_lines.push(DiffLine { line_type: "unchanged".into(), line, old_line_num: Some(old_line), new_line_num: Some(new_line) });
                    old_line += 1;
                    new_line += 1;
                }
                ChangeTag::Delete => {
                    diff_lines.push(DiffLine { line_type: "removed".into(), line, old_line_num: Some(old_line), new_line_num: None });
                    old_line += 1;
                }
                ChangeTag::Insert => {
                    diff_lines.push(DiffLine { line_type: "added".into(), line, old_line_num: None, new_line_num: Some(new_line) });
                    new_line += 1;
                }
            }
        }
        
        let relative_path = Path::new(&path).strip_prefix(root)
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| path.clone());
        
        diffs.push(FileDiff {
            path: path.clone(),
            relative_path,
            previous: prev_content.clone(),
            current: curr_content,
            diff: diff_lines,
        });
    }
    
    Ok(diffs)
}

#[tauri::command]
fn get_perf_metrics(perf: State<'_, PerfMetricsState>) -> PerfMetrics {
    let mut metrics = perf.metrics.lock().map(|m| m.clone()).unwrap_or_default();
    metrics.token_cache_size = TOKEN_COUNT_CACHE.lock().map(|c| c.len()).unwrap_or(0);
    metrics.skeleton_cache_size = SKELETON_CACHE.lock().map(|c| c.len()).unwrap_or(0);
    metrics
}

/// Clear the snapshot
#[tauri::command]
async fn clear_snapshot(state: State<'_, SnapshotState>) -> Result<(), String> {
    let mut snapshot = state.snapshot.lock().map_err(|_| "Lock error")?;
    snapshot.clear();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]

pub fn run() {
    // Force tokenizer initialization at startup (downloads vocab on first run)
    let _ = &*TOKENIZER;

    tauri::Builder::default()

        .plugin(tauri_plugin_fs::init())

        .plugin(tauri_plugin_dialog::init())

        .plugin(tauri_plugin_opener::init())

        .plugin(tauri_plugin_clipboard_manager::init())

        .setup(|app| {

            app.manage(WatcherState { watcher: Mutex::new(None) });
            app.manage(SnapshotState { snapshot: Mutex::new(HashMap::new()) });
            app.manage(PerfMetricsState { metrics: Mutex::new(PerfMetrics::default()) });

            Ok(())

        })

        .invoke_handler(tauri::generate_handler![greet, scan_project, read_file_content, watch_project, skeletonize_file, skeletonize_files, count_tokens, count_tokens_for_files, take_snapshot, get_diffs, clear_snapshot, get_perf_metrics])

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

        let entries = scan_project_entries(root).expect("scan project");
        assert!(entries.iter().any(|entry| entry.relative_path == "src/main.rs"));
    }
}
