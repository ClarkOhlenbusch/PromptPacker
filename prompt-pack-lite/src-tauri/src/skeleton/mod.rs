//! Smart Skeleton: Modular AST-based code compression
//!
//! This module provides language-specific skeleton extraction using tree-sitter.
//! Each language has its own submodule with tailored extraction logic.
//!
//! ## Architecture
//!
//! ```text
//! skeleton/
//! ├── mod.rs         - Entry point, language dispatch
//! ├── common.rs      - Shared types and utilities
//! ├── python.rs      - Python-specific extraction
//! └── (future)       - javascript.rs, rust_lang.rs, go.rs, etc.
//! ```
//!
//! ## Usage
//!
//! ```ignore
//! use skeleton::{skeletonize, SupportedLanguage, SkeletonResult};
//!
//! let result = skeletonize("def foo(): pass", "py", None);
//! println!("{}", result.skeleton);
//! ```

// Allow unused items - these are part of the public API
#![allow(dead_code)]

pub mod common;
pub mod config;
pub mod go;
pub mod python;
pub mod rust_lang;
pub mod typescript;

use tree_sitter::{Language, Parser};

// Re-export common types for public API
#[allow(unused_imports)]
pub use common::{
    CommentType, StateContract, CallEdgeList,
    classify_comment, should_keep_comment,
    looks_like_path, classify_read_write, ReadWriteIntent,
    collect_summary_phrases,
};

// ============ Constants ============

const MAX_SKELETON_LINES: usize = 200;
const MAX_SKELETON_CHARS: usize = 8000;

// ============ Supported Languages ============

/// Languages supported for AST-based skeletonization
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SupportedLanguage {
    Python,
    TypeScript,
    TypeScriptTsx,
    JavaScript,
    JavaScriptJsx,
    Rust,
    Go,
    Json,
    Css,
    Html,
}

impl SupportedLanguage {
    /// Detect language from file extension
    pub fn from_extension(ext: &str) -> Option<Self> {
        match ext.to_lowercase().as_str() {
            "py" | "pyw" | "pyi" => Some(Self::Python),
            "ts" | "mts" | "cts" => Some(Self::TypeScript),
            "tsx" => Some(Self::TypeScriptTsx),
            "js" | "mjs" | "cjs" => Some(Self::JavaScript),
            "jsx" => Some(Self::JavaScriptJsx),
            "rs" => Some(Self::Rust),
            "go" => Some(Self::Go),
            "json" | "jsonc" => Some(Self::Json),
            "css" | "scss" | "less" => Some(Self::Css),
            "html" | "htm" => Some(Self::Html),
            _ => None,
        }
    }

    /// Get the tree-sitter language for this file type
    fn tree_sitter_language(&self) -> Language {
        match self {
            Self::Python => tree_sitter_python::LANGUAGE.into(),
            Self::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Self::TypeScriptTsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Self::JavaScript | Self::JavaScriptJsx => tree_sitter_javascript::LANGUAGE.into(),
            Self::Rust => tree_sitter_rust::LANGUAGE.into(),
            Self::Go => tree_sitter_go::LANGUAGE.into(),
            Self::Json => tree_sitter_json::LANGUAGE.into(),
            Self::Css => tree_sitter_css::LANGUAGE.into(),
            Self::Html => tree_sitter_html::LANGUAGE.into(),
        }
    }

    /// Get the comment prefix for this language
    pub fn comment_prefix(&self) -> &'static str {
        match self {
            Self::Python => "#",
            Self::Html => "<!--",
            Self::Css => "/*",
            _ => "//",
        }
    }

    /// Get the truncation comment for this language
    pub fn truncation_comment(&self) -> &'static str {
        match self {
            Self::Python => "# ...",
            Self::Html => "<!-- ... -->",
            Self::Css => "/* ... */",
            _ => "// ...",
        }
    }
}

// ============ Result Type ============

/// Result of skeleton extraction
#[derive(Debug)]
pub struct SkeletonResult {
    pub skeleton: String,
    pub language: Option<SupportedLanguage>,
    pub original_lines: usize,
    pub skeleton_lines: usize,
}

impl SkeletonResult {
    /// Calculate compression ratio (0.0 to 1.0)
    pub fn compression_ratio(&self) -> f64 {
        if self.original_lines == 0 {
            return 0.0;
        }
        let diff = self.original_lines as f64 - self.skeleton_lines as f64;
        (diff / self.original_lines as f64).max(0.0)
    }
}

// ============ Main Entry Point ============

/// Skeletonize source code with optional file path for heuristics
pub fn skeletonize(
    content: &str,
    extension: &str,
    _file_path: Option<&str>,
) -> SkeletonResult {
    let original_lines = content.lines().count();
    let language = SupportedLanguage::from_extension(extension);

    let skeleton = match language {
        Some(lang) => {
            match extract_skeleton(content, lang, _file_path) {
                Ok(s) => s,
                Err(_) => fallback_compress(content, extension),
            }
        }
        None => fallback_compress(content, extension),
    };

    let skeleton = cap_output(&skeleton, language);
    let skeleton_lines = skeleton.lines().count();

    SkeletonResult {
        skeleton,
        language,
        original_lines,
        skeleton_lines,
    }
}

/// Extract skeleton using tree-sitter AST
fn extract_skeleton(content: &str, lang: SupportedLanguage, file_path: Option<&str>) -> Result<String, String> {
    let mut parser = Parser::new();
    parser.set_language(&lang.tree_sitter_language())
        .map_err(|e| format!("Failed to set language: {}", e))?;

    let tree = parser.parse(content, None)
        .ok_or("Failed to parse content")?;

    let root = tree.root_node();
    let source = content.as_bytes();

    match lang {
        SupportedLanguage::Python => {
            Ok(python::extract_skeleton(content, root, source))
        }
        SupportedLanguage::Rust => {
            Ok(rust_lang::extract_skeleton(content, root, source))
        }
        SupportedLanguage::Go => {
            Ok(go::extract_skeleton(content, root, source))
        }
        SupportedLanguage::Json => {
            Ok(config::extract_json_skeleton(content, root, source))
        }
        SupportedLanguage::Css => {
            Ok(config::extract_css_skeleton(content, root, source))
        }
        SupportedLanguage::Html => {
            Ok(config::extract_html_skeleton(content, root, source))
        }
        SupportedLanguage::TypeScript | SupportedLanguage::JavaScript => {
            Ok(typescript::extract_skeleton(content, root, source, file_path, false))
        }
        SupportedLanguage::TypeScriptTsx | SupportedLanguage::JavaScriptJsx => {
            Ok(typescript::extract_skeleton(content, root, source, file_path, true))
        }
    }
}

// ============ Legacy Compatibility ============

/// Re-export legacy skeletonize function for backward compatibility
/// This delegates to the legacy skeleton module for non-Python languages
pub fn skeletonize_with_path(
    content: &str,
    extension: &str,
    file_path: Option<&str>,
) -> SkeletonResult {
    // Try new implementation first for Python and Rust
    let language = SupportedLanguage::from_extension(extension);

    if matches!(
        language,
        Some(SupportedLanguage::Python)
            | Some(SupportedLanguage::Rust)
            | Some(SupportedLanguage::Go)
            | Some(SupportedLanguage::Json)
            | Some(SupportedLanguage::Css)
            | Some(SupportedLanguage::Html)
            | Some(SupportedLanguage::TypeScript)
            | Some(SupportedLanguage::TypeScriptTsx)
            | Some(SupportedLanguage::JavaScript)
            | Some(SupportedLanguage::JavaScriptJsx)
    ) {
        return skeletonize(content, extension, file_path);
    }

    // For all other languages, delegate to legacy
    let legacy_result = crate::skeleton_legacy::skeletonize_with_path(content, extension, file_path);

    SkeletonResult {
        skeleton: legacy_result.skeleton,
        language: legacy_result.language.map(|l| match l {
            crate::skeleton_legacy::SupportedLanguage::Python => SupportedLanguage::Python,
            crate::skeleton_legacy::SupportedLanguage::TypeScript => SupportedLanguage::TypeScript,
            crate::skeleton_legacy::SupportedLanguage::TypeScriptTsx => SupportedLanguage::TypeScriptTsx,
            crate::skeleton_legacy::SupportedLanguage::JavaScript => SupportedLanguage::JavaScript,
            crate::skeleton_legacy::SupportedLanguage::JavaScriptJsx => SupportedLanguage::JavaScriptJsx,
            crate::skeleton_legacy::SupportedLanguage::Rust => SupportedLanguage::Rust,
            crate::skeleton_legacy::SupportedLanguage::Go => SupportedLanguage::Go,
            crate::skeleton_legacy::SupportedLanguage::Json => SupportedLanguage::Json,
            crate::skeleton_legacy::SupportedLanguage::Css => SupportedLanguage::Css,
            crate::skeleton_legacy::SupportedLanguage::Html => SupportedLanguage::Html,
        }),
        original_lines: legacy_result.original_lines,
        skeleton_lines: legacy_result.skeleton_lines,
    }
}

/// Cap skeleton output to prevent excessive size
fn cap_output(skeleton: &str, lang: Option<SupportedLanguage>) -> String {
    if skeleton.is_empty() {
        return String::new();
    }

    let mut lines: Vec<&str> = skeleton.lines().collect();
    let mut truncated = false;

    if lines.len() > MAX_SKELETON_LINES {
        lines.truncate(MAX_SKELETON_LINES);
        truncated = true;
    }

    let mut result = lines.join("\n");
    if result.chars().count() > MAX_SKELETON_CHARS {
        result = truncate_to_char_limit(&result, MAX_SKELETON_CHARS);
        truncated = true;
    }

    if truncated {
        result.push('\n');
        result.push_str(lang.map_or("// ...", |l| l.truncation_comment()));
    }

    result
}

fn truncate_to_char_limit(input: &str, max_chars: usize) -> String {
    if input.chars().count() <= max_chars {
        return input.to_string();
    }

    let mut end = 0;
    let mut count = 0;
    for (idx, ch) in input.char_indices() {
        if count >= max_chars {
            break;
        }
        end = idx + ch.len_utf8();
        count += 1;
    }

    let mut out = input[..end].to_string();
    if let Some(pos) = out.rfind('\n') {
        out.truncate(pos);
    }
    out
}

// ============ Fallback Compression ============

/// Fallback compression for unsupported languages or parse failures
pub fn fallback_compress(content: &str, extension: &str) -> String {
    let ext = extension.to_lowercase();

    // Skip lock files entirely
    if ext == "lock" {
        return String::new();
    }

    let is_config = matches!(
        ext.as_str(),
        "toml" | "ini" | "cfg" | "conf" | "env" | "properties"
    );
    let is_markdown = matches!(ext.as_str(), "md" | "markdown");

    let mut output: Vec<String> = Vec::new();
    let mut prev_empty = false;
    let mut has_output = false;

    for line in content.lines() {
        let trimmed = line.trim();

        // Handle empty lines
        if trimmed.is_empty() {
            if has_output && !prev_empty {
                output.push(String::new());
                prev_empty = true;
            }
            continue;
        }
        prev_empty = false;

        // Keep structural lines
        let is_structural = is_structural_line(trimmed, is_config, is_markdown);

        if is_structural {
            output.push(common::truncate_line(line, common::MAX_FALLBACK_LINE_LEN));
            has_output = true;
        }
    }

    output.join("\n")
}

/// Check if a line is structural (should be kept in fallback mode)
fn is_structural_line(trimmed: &str, is_config: bool, is_markdown: bool) -> bool {
    // Import/module patterns
    trimmed.starts_with("import ") ||
    trimmed.starts_with("from ") ||
    trimmed.starts_with("export ") ||
    trimmed.starts_with("require(") ||
    trimmed.starts_with("use ") ||
    trimmed.starts_with("mod ") ||
    trimmed.starts_with("package ") ||
    trimmed.starts_with("#include") ||
    trimmed.starts_with("using ") ||
    // Definition patterns
    trimmed.starts_with("class ") ||
    trimmed.starts_with("struct ") ||
    trimmed.starts_with("enum ") ||
    trimmed.starts_with("interface ") ||
    trimmed.starts_with("trait ") ||
    trimmed.starts_with("type ") ||
    trimmed.starts_with("typedef ") ||
    // Function patterns
    trimmed.starts_with("fn ") ||
    trimmed.starts_with("func ") ||
    trimmed.starts_with("function ") ||
    trimmed.starts_with("def ") ||
    trimmed.starts_with("pub fn ") ||
    trimmed.starts_with("async fn ") ||
    trimmed.starts_with("pub async fn ") ||
    trimmed.contains("fn ") ||
    // Variable patterns
    trimmed.starts_with("const ") ||
    trimmed.starts_with("let ") ||
    trimmed.starts_with("var ") ||
    trimmed.starts_with("static ") ||
    trimmed.starts_with("final ") ||
    // Visibility modifiers
    trimmed.starts_with("pub ") ||
    trimmed.starts_with("public ") ||
    trimmed.starts_with("private ") ||
    trimmed.starts_with("protected ") ||
    // Decorators/attributes
    trimmed.starts_with('@') ||
    trimmed.starts_with("#[") ||
    // Block endings
    trimmed == "end" ||
    // Doc comments
    trimmed.starts_with("///") ||
    trimmed.starts_with("//!") ||
    trimmed.starts_with("/**") ||
    trimmed.starts_with("* ") ||
    (trimmed.starts_with('#') && !trimmed.starts_with("# ")) ||
    // Config-specific
    (is_config && is_config_line(trimmed)) ||
    // Markdown-specific
    (is_markdown && is_markdown_structural(trimmed))
}

fn is_config_line(trimmed: &str) -> bool {
    if trimmed.starts_with('#') || trimmed.starts_with(';') {
        return false;
    }
    if trimmed.starts_with('[') && trimmed.ends_with(']') {
        return true;
    }
    if trimmed.starts_with("export ") {
        return trimmed.contains('=');
    }
    trimmed.contains('=')
}

fn is_markdown_structural(trimmed: &str) -> bool {
    trimmed.starts_with('#') ||
    trimmed.starts_with("```") ||
    trimmed.starts_with("- ") ||
    trimmed.starts_with("* ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_language_detection() {
        assert_eq!(SupportedLanguage::from_extension("py"), Some(SupportedLanguage::Python));
        assert_eq!(SupportedLanguage::from_extension("ts"), Some(SupportedLanguage::TypeScript));
        assert_eq!(SupportedLanguage::from_extension("unknown"), None);
    }

    #[test]
    fn test_skeletonize_python() {
        let code = r#"
import os

def hello():
    """Say hello."""
    print("Hello, world!")
"#;
        let result = skeletonize(code, "py", None);
        assert!(result.skeleton.contains("import os"));
        assert!(result.skeleton.contains("def hello()"));
        assert!(result.skeleton.contains("\"\"\"Say hello.\"\"\""));
    }

    #[test]
    fn test_compression_ratio() {
        let result = SkeletonResult {
            skeleton: "def foo(): ...".to_string(),
            language: Some(SupportedLanguage::Python),
            original_lines: 100,
            skeleton_lines: 20,
        };
        assert!((result.compression_ratio() - 0.8).abs() < 0.01);
    }
}
