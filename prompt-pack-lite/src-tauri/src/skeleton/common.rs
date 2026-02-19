//! Common types and utilities shared across all language skeletonizers.

// Allow unused items - these are part of the public API for future language implementations
#![allow(dead_code)]

use tree_sitter::Node;

// ============ Threshold Constants ============

pub const MAX_SIMPLE_CONST_LEN: usize = 200;
pub const MAX_SIMPLE_ASSIGNMENT_LEN: usize = 150;
pub const MAX_CLASS_ATTR_LEN: usize = 100;
pub const MAX_DOC_LINE_LEN: usize = 120;
pub const MAX_DEF_LINE_LEN: usize = 180;
pub const MAX_SKELETON_LINES: usize = 200;
pub const MAX_SKELETON_CHARS: usize = 8000;
pub const MAX_MEMBER_NAMES: usize = 8;
pub const MAX_FALLBACK_LINE_LEN: usize = 200;
pub const MAX_CALL_EDGE_NAMES: usize = 6;
pub const MAX_CALL_EDGE_NAME_LEN: usize = 40;
pub const MAX_CALL_EDGE_NODES: usize = 3000;

/// Threshold for keeping full function/class body (if <= this many non-empty lines)
pub const SMALL_BODY_THRESHOLD: usize = 6;

// ============ Comment Classification ============

/// Types of comments for classification
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum CommentType {
    /// Section dividers: # --- Section --- or ## Header
    Structural,
    /// Intent/explanatory comments (≥15 chars)
    Explanatory,
    /// TODO, FIXME, NOTE, HACK, XXX, BUG, WARNING
    Todo,
    /// Short, non-meaningful comments
    Trivial,
    /// Commented-out code
    DisabledCode,
}

/// Classify a comment by its content and purpose
pub fn classify_comment(text: &str, comment_prefix: &str) -> CommentType {
    let trimmed = text.trim();

    // Check for markdown-style headers: ## Header or ### Header
    if trimmed.starts_with("##") && trimmed.chars().nth(2).map_or(false, |c| c == '#' || c == ' ') {
        return CommentType::Structural;
    }

    // Strip the comment prefix to get content
    let content = trimmed
        .trim_start_matches(comment_prefix)
        .trim_start_matches(|c: char| c == '#' || c == '/' || c == '*')
        .trim();

    // Section dividers: --- or ===
    if content.starts_with("---") || content.ends_with("---") ||
       content.starts_with("===") || content.ends_with("===") ||
       content.starts_with("***") || content.ends_with("***") {
        return CommentType::Structural;
    }

    // TODO variants (case-insensitive check)
    let upper = content.to_uppercase();
    if upper.starts_with("TODO") || upper.starts_with("FIXME") ||
       upper.starts_with("NOTE") || upper.starts_with("HACK") ||
       upper.starts_with("XXX") || upper.starts_with("BUG") ||
       upper.starts_with("WARNING") {
        return CommentType::Todo;
    }

    // Disabled code detection
    if looks_like_disabled_code(content) {
        return CommentType::DisabledCode;
    }

    // Trivial vs explanatory (by length)
    if content.len() < 15 && !content.ends_with(':') {
        return CommentType::Trivial;
    }

    CommentType::Explanatory
}

/// Check if comment content looks like disabled code
fn looks_like_disabled_code(content: &str) -> bool {
    let c = content.trim();
    if c.is_empty() {
        return false;
    }

    // Common code patterns
    // Function/method call: func() or obj.method()
    if c.contains('(') && c.contains(')') && !c.contains(' ') {
        return true;
    }

    // Assignment: x = y (but not comparison descriptions)
    if let Some(eq_pos) = c.find('=') {
        if eq_pos > 0 && eq_pos < c.len() - 1 {
            let before = c.chars().nth(eq_pos - 1);
            let after = c.chars().nth(eq_pos + 1);
            // Not == or != or <= or >=
            if before != Some('=') && before != Some('!') &&
               before != Some('<') && before != Some('>') &&
               after != Some('=') {
                // Check if left side looks like identifier
                let left = c[..eq_pos].trim();
                if left.chars().all(|c| c.is_alphanumeric() || c == '_' || c == '.') {
                    return true;
                }
            }
        }
    }

    // Import/from statements
    if c.starts_with("import ") || c.starts_with("from ") ||
       c.starts_with("require(") || c.starts_with("use ") {
        return true;
    }

    // Control flow
    if c.starts_with("if ") || c.starts_with("for ") ||
       c.starts_with("while ") || c.starts_with("return ") {
        return true;
    }

    // Definition
    if c.starts_with("def ") || c.starts_with("class ") ||
       c.starts_with("fn ") || c.starts_with("func ") ||
       c.starts_with("function ") {
        return true;
    }

    false
}

/// Check if a comment type should be kept in skeleton
pub fn should_keep_comment(comment_type: CommentType) -> bool {
    matches!(
        comment_type,
        CommentType::Structural | CommentType::Explanatory | CommentType::Todo
    )
}

// ============ Call Edge Collection ============

/// Collected function/method calls from a scope
pub struct CallEdgeList {
    pub entries: Vec<String>,
    pub truncated: bool,
    pub visited: usize,
}

impl CallEdgeList {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            truncated: false,
            visited: 0,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }
}

impl Default for CallEdgeList {
    fn default() -> Self {
        Self::new()
    }
}

// ============ State Contract ============

/// Represents what a code block defines, reads, and writes
#[derive(Debug, Default)]
pub struct StateContract {
    pub defines: Vec<String>,
    pub reads: Vec<String>,
    pub writes: Vec<String>,
}

impl StateContract {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn is_empty(&self) -> bool {
        self.defines.is_empty() && self.reads.is_empty() && self.writes.is_empty()
    }
}

// ============ Path Detection ============

/// Known file extensions that indicate a path
const KNOWN_FILE_EXTENSIONS: &[&str] = &[
    ".json", ".npy", ".pt", ".pth", ".ckpt", ".csv", ".parquet",
    ".txt", ".pkl", ".npz", ".tsv", ".jsonl", ".yaml", ".yml",
    ".toml", ".xml", ".html", ".md", ".py", ".js", ".ts", ".rs",
];

/// Check if a string value looks like a file path
pub fn looks_like_path(value: &str) -> bool {
    if value.len() < 4 {
        return false;
    }

    // Reject strings that look like regex patterns
    if value.starts_with('^') || value.starts_with('$') {
        return false;
    }

    // Reject regex escape sequences
    if value.contains("\\s") || value.contains("\\d") || value.contains("\\w") ||
       value.contains("\\b") || value.contains("\\n") || value.contains("\\t") ||
       value.contains("\\r") {
        return false;
    }

    // Reject f-string interpolations
    if value.contains('{') && value.contains('}') {
        return false;
    }

    // Reject regex metacharacters
    if value.contains('*') || value.contains('+') || value.contains('?') ||
       value.contains('|') || value.contains('[') || value.contains(']') ||
       value.contains('(') && value.contains(')') && !value.contains('/') {
        return false;
    }

    // Check for path structure with /
    if value.contains('/') {
        // Should start with common path prefixes or end with extension
        if value.starts_with('.') || value.starts_with('/') ||
           value.starts_with('~') || value.starts_with("./") ||
           value.starts_with("../") {
            return true;
        }
        // Or end with known extension
        for ext in KNOWN_FILE_EXTENSIONS {
            if value.ends_with(ext) {
                return true;
            }
        }
        return false;
    }

    // Check for known file extensions (without path separator)
    for ext in KNOWN_FILE_EXTENSIONS {
        if value.ends_with(ext) {
            return true;
        }
    }

    false
}

/// Classify if a line with a path is a read or write operation
pub fn classify_read_write(text: &str) -> ReadWriteIntent {
    let lower = text.to_lowercase();

    // Write patterns
    if lower.contains("save") || lower.contains("dump") || lower.contains("write") ||
       lower.contains("to_csv") || lower.contains("to_json") || lower.contains("to_parquet") ||
       lower.contains("torch.save") || lower.contains("np.save") || lower.contains("pickle.dump") {
        return ReadWriteIntent::Write;
    }

    // File mode patterns
    if lower.contains("open(") && lower.contains("\"w") ||
       lower.contains("mode=\"w") || lower.contains("mode='w") {
        return ReadWriteIntent::Write;
    }

    // Read patterns
    if lower.contains("read") || lower.contains("load") || lower.contains("torch.load") ||
       lower.contains("np.load") || lower.contains("json.load") ||
       lower.contains("pd.read") || lower.contains("wget") || lower.contains("curl") ||
       lower.contains("gdown") || lower.contains("gsutil") {
        return ReadWriteIntent::Read;
    }

    ReadWriteIntent::Read // Default to read
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ReadWriteIntent {
    Read,
    Write,
}

// ============ Text Utilities ============

/// Get text content of a tree-sitter node
pub fn get_node_text<'a>(node: Node, source: &'a [u8]) -> &'a str {
    let start = node.start_byte();
    let end = node.end_byte();
    let slice = source.get(start..end).unwrap_or(&[]);
    match std::str::from_utf8(slice) {
        Ok(text) => text.trim_end_matches(|ch| ch == '\n' || ch == '\r'),
        Err(_) => "",
    }
}

/// Truncate a line to a maximum length, adding "..." if truncated
pub fn truncate_line(line: &str, max_len: usize) -> String {
    let mut out = String::new();
    let mut count = 0;
    let mut truncated = false;
    for ch in line.chars() {
        if count >= max_len {
            truncated = true;
            break;
        }
        out.push(ch);
        count += 1;
    }
    if truncated {
        out.push_str("...");
    }
    out
}

/// Compact text to a prefix with optional truncation indicator
pub fn compact_text_prefix(text: &str, max_chars: usize) -> (String, bool) {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max_chars {
        return (trimmed.to_string(), false);
    }
    let prefix: String = trimmed.chars().take(max_chars).collect();
    (prefix, true)
}

/// Trim a Python docstring to its first meaningful line
pub fn trim_docstring(text: &str) -> Option<String> {
    let trimmed = text.trim();
    let (quote, inner) = if trimmed.starts_with("\"\"\"") && trimmed.ends_with("\"\"\"") {
        ("\"\"\"", trimmed.trim_start_matches("\"\"\"").trim_end_matches("\"\"\""))
    } else if trimmed.starts_with("'''") && trimmed.ends_with("'''") {
        ("'''", trimmed.trim_start_matches("'''").trim_end_matches("'''"))
    } else if trimmed.starts_with('"') && trimmed.ends_with('"') && trimmed.len() > 2 {
        ("\"", &trimmed[1..trimmed.len()-1])
    } else if trimmed.starts_with('\'') && trimmed.ends_with('\'') && trimmed.len() > 2 {
        ("'", &trimmed[1..trimmed.len()-1])
    } else {
        return None;
    };

    for line in inner.lines() {
        let cleaned = line.trim();
        if !cleaned.is_empty() {
            let summary = truncate_line(cleaned, MAX_DOC_LINE_LEN);
            return Some(format!("{quote}{summary}{quote}"));
        }
    }
    None
}

/// Trim a doc comment (/// or /** */) to its first meaningful line
pub fn trim_doc_comment(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.starts_with("///") || trimmed.starts_with("//!") {
        return Some(truncate_line(trimmed, MAX_DOC_LINE_LEN));
    }
    if trimmed.starts_with("/**") || trimmed.starts_with("/*!") {
        let inner = trimmed
            .trim_start_matches("/**")
            .trim_start_matches("/*!")
            .trim_end_matches("*/");
        for line in inner.lines() {
            let cleaned = line.trim().trim_start_matches('*').trim();
            if !cleaned.is_empty() {
                let summary = truncate_line(cleaned, MAX_DOC_LINE_LEN);
                return Some(format!("/** {} */", summary));
            }
        }
    }
    None
}

/// Format a list of items with optional truncation
pub fn format_list(items: &[String], limit: usize) -> String {
    if items.is_empty() {
        return "(none)".to_string();
    }

    let display: Vec<&str> = items.iter().take(limit).map(|s| s.as_str()).collect();
    let mut result = display.join(", ");

    if items.len() > limit {
        result.push_str(", ...");
    }

    result
}

/// Count non-empty lines in text
pub fn count_non_empty_lines(text: &str) -> usize {
    text.lines().filter(|l| !l.trim().is_empty()).count()
}

/// Check if a function/class body should be kept in full (small body optimization)
pub fn should_keep_full_body(body_text: &str) -> bool {
    count_non_empty_lines(body_text) <= SMALL_BODY_THRESHOLD
}

// ============ Summary Phrases ============

/// Collect semantic summary phrases from code text
pub fn collect_summary_phrases(text: &str) -> Vec<&'static str> {
    let lower = text.to_lowercase();
    let mut phrases = Vec::new();

    let patterns: &[(&[&str], &str)] = &[
        (&["torch.load", "load_state_dict", ".load("], "loads checkpoint"),
        (&["torch.save", "np.save", "save_pretrained", ".to_json", ".to_csv", "pickle.dump"], "writes artifacts"),
        (&["pd.read", "np.load", "json.load", "open("], "reads data files"),
        (&["tokenizer.", ".tokenize", ".encode(", ".decode("], "tokenizes text"),
        (&["augment", "shuffle(", ".sample("], "applies augmentation"),
        (&[".train(", ".fit(", "optimizer.", ".backward(", "loss."], "runs training"),
        (&[".eval(", "accuracy", "top_k", "topk", "metric", "precision", "recall"], "evaluates metrics"),
        (&["plt.", ".plot(", "seaborn", "sns."], "plots figures"),
        (&[".cuda(", ".to(device", ".to(\"cuda", ".to('cuda"], "moves to device"),
        (&["dataloader", ".batch(", "collate_fn"], "builds dataloaders"),
        (&[".logits", "softmax(", ".argmax("], "computes logits"),
        (&["!pip", "pip install", "requirements.txt"], "installs dependencies"),
        (&["!git clone", "!wget", "!curl", "gdown"], "downloads resources"),
        (&["pad_sequence", ".pad(", "max_length=", "attention_mask"], "prepares inputs/masks"),
        (&["gsutil", "kaggle"], "downloads external data"),
    ];

    for (keywords, phrase) in patterns {
        if keywords.iter().any(|kw| lower.contains(kw)) {
            if !phrases.contains(phrase) {
                phrases.push(*phrase);
            }
        }
    }

    // Extract print intent
    if let Some(intent) = extract_print_intent(text) {
        if !phrases.contains(&intent) {
            phrases.push(intent);
        }
    }

    phrases
}

/// Extract semantic intent from print statements
pub fn extract_print_intent(text: &str) -> Option<&'static str> {
    let lower = text.to_lowercase();
    
    // Look for print statements
    if !lower.contains("print(") {
        return None;
    }

    // Extract message content from print statements
    if lower.contains("build") || lower.contains("creat") || lower.contains("generat") {
        return Some("building/generating");
    }
    if lower.contains("load") || lower.contains("read") {
        return Some("loading");
    }
    if lower.contains("sav") || lower.contains("writ") {
        return Some("saving");
    }
    if lower.contains("train") || lower.contains("epoch") {
        return Some("training progress");
    }
    if lower.contains("process") {
        return Some("processing");
    }
    if lower.contains("done") || lower.contains("finish") || lower.contains("complete") {
        return Some("completion");
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_classify_comment_structural() {
        assert_eq!(
            classify_comment("# ---------- Section ----------", "#"),
            CommentType::Structural
        );
        assert_eq!(
            classify_comment("## Header", "#"),
            CommentType::Structural
        );
        assert_eq!(
            classify_comment("# ============", "#"),
            CommentType::Structural
        );
    }

    #[test]
    fn test_classify_comment_todo() {
        assert_eq!(
            classify_comment("# TODO: fix this", "#"),
            CommentType::Todo
        );
        assert_eq!(
            classify_comment("# FIXME: broken", "#"),
            CommentType::Todo
        );
    }

    #[test]
    fn test_classify_comment_disabled_code() {
        assert_eq!(
            classify_comment("# print(x)", "#"),
            CommentType::DisabledCode
        );
        assert_eq!(
            classify_comment("# x = 5", "#"),
            CommentType::DisabledCode
        );
    }

    #[test]
    fn test_classify_comment_explanatory() {
        assert_eq!(
            classify_comment("# This function processes the input data and returns results", "#"),
            CommentType::Explanatory
        );
    }

    #[test]
    fn test_looks_like_path() {
        assert!(looks_like_path("./data/file.json"));
        assert!(looks_like_path("/home/user/data.csv"));
        assert!(looks_like_path("model.pth"));
        assert!(!looks_like_path("^\\s*$")); // regex
        assert!(!looks_like_path("{variable}")); // f-string
        assert!(!looks_like_path("a+b*c")); // regex
    }

    #[test]
    fn test_collect_summary_phrases() {
        let code = "model.train()\noptimizer.step()\nloss.backward()";
        let phrases = collect_summary_phrases(code);
        assert!(phrases.contains(&"runs training"));
    }
}
