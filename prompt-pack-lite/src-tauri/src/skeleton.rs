//! Smart Skeleton: AST-based code compression
//!
//! This module extracts structural signatures from source code using tree-sitter.
//! It preserves imports, type definitions, and function signatures while stripping
//! implementation details to reduce token count for LLM context.

use tree_sitter::{Language, Parser, Node};

/// Supported languages for AST-based skeletonization
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum SupportedLanguage {
    TypeScript,
    TypeScriptTsx,
    JavaScript,
    JavaScriptJsx,
    Python,
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
            "ts" | "mts" | "cts" => Some(Self::TypeScript),
            "tsx" => Some(Self::TypeScriptTsx),
            "js" | "mjs" | "cjs" => Some(Self::JavaScript),
            "jsx" => Some(Self::JavaScriptJsx),
            "py" | "pyw" | "pyi" => Some(Self::Python),
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
            Self::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Self::TypeScriptTsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Self::JavaScript | Self::JavaScriptJsx => tree_sitter_javascript::LANGUAGE.into(),
            Self::Python => tree_sitter_python::LANGUAGE.into(),
            Self::Rust => tree_sitter_rust::LANGUAGE.into(),
            Self::Go => tree_sitter_go::LANGUAGE.into(),
            Self::Json => tree_sitter_json::LANGUAGE.into(),
            Self::Css => tree_sitter_css::LANGUAGE.into(),
            Self::Html => tree_sitter_html::LANGUAGE.into(),
        }
    }

}

/// Result of skeletonization
#[derive(Debug)]
pub struct SkeletonResult {
    pub skeleton: String,
    pub language: Option<SupportedLanguage>,
    pub original_lines: usize,
    pub skeleton_lines: usize,
}

/// Main entry point: skeletonize a file's content
pub fn skeletonize(content: &str, extension: &str) -> SkeletonResult {
    let original_lines = content.lines().count();

    let language = SupportedLanguage::from_extension(extension);

    let skeleton = match language {
        Some(lang) => {
            match extract_skeleton(content, lang) {
                Ok(s) => s,
                Err(_) => fallback_compress(content), // Parse failed, use fallback
            }
        }
        None => fallback_compress(content), // Unsupported language
    };

    let skeleton_lines = skeleton.lines().count();

    SkeletonResult {
        skeleton,
        language,
        original_lines,
        skeleton_lines,
    }
}

/// Extract skeleton using tree-sitter AST
fn extract_skeleton(content: &str, lang: SupportedLanguage) -> Result<String, String> {
    let mut parser = Parser::new();
    parser.set_language(&lang.tree_sitter_language())
        .map_err(|e| format!("Failed to set language: {}", e))?;

    let tree = parser.parse(content, None)
        .ok_or("Failed to parse content")?;

    let root = tree.root_node();
    let source = content.as_bytes();

    let mut output = String::new();

    match lang {
        SupportedLanguage::TypeScript | SupportedLanguage::TypeScriptTsx |
        SupportedLanguage::JavaScript | SupportedLanguage::JavaScriptJsx => {
            extract_js_ts_skeleton(&mut output, root, source, 0);
        }
        SupportedLanguage::Python => {
            extract_python_skeleton(&mut output, root, source, 0);
        }
        SupportedLanguage::Rust => {
            extract_rust_skeleton(&mut output, root, source, 0);
        }
        SupportedLanguage::Go => {
            extract_go_skeleton(&mut output, root, source, 0);
        }
        SupportedLanguage::Json => {
            // For JSON, just return a structure summary
            extract_json_skeleton(&mut output, root, source, 0);
        }
        SupportedLanguage::Css => {
            extract_css_skeleton(&mut output, root, source);
        }
        SupportedLanguage::Html => {
            // HTML: just show structure
            extract_html_skeleton(&mut output, root, source, 0);
        }
    }

    Ok(output.trim().to_string())
}

/// Extract JavaScript/TypeScript skeleton
fn extract_js_ts_skeleton(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "  ".repeat(depth);

    match node.kind() {
        // Keep imports verbatim
        "import_statement" | "import_declaration" => {
            output.push_str(&get_node_text(node, source));
            output.push('\n');
        }

        // Keep exports (but skeletonize what's exported)
        "export_statement" | "export_declaration" => {
            // Check if it's exporting a function/class
            let mut cursor = node.walk();
            let mut has_body = false;

            for child in node.children(&mut cursor) {
                if matches!(child.kind(), "function_declaration" | "class_declaration" |
                           "arrow_function" | "function") {
                    has_body = true;
                    // Handle the declaration specially
                    output.push_str("export ");
                    extract_js_ts_skeleton(output, child, source, depth);
                    break;
                }
            }

            if !has_body {
                output.push_str(&get_node_text(node, source));
                output.push('\n');
            }
        }

        // Type definitions - keep fully
        "type_alias_declaration" | "interface_declaration" | "enum_declaration" => {
            output.push_str(&get_node_text(node, source));
            output.push('\n');
        }

        // Function declarations - keep signature, skip body
        "function_declaration" | "function_signature" => {
            if let Some(sig) = extract_js_function_signature(node, source) {
                output.push_str(&indent);
                output.push_str(&sig);
                output.push_str(" { /* ... */ }\n");
            }
        }

        // Arrow functions at top level
        "lexical_declaration" | "variable_declaration" => {
            // Check if this declares a function
            let text = get_node_text(node, source);
            if text.contains("=>") || text.contains("function") {
                if let Some(sig) = extract_js_variable_function_signature(node, source) {
                    output.push_str(&indent);
                    output.push_str(&sig);
                    output.push('\n');
                }
            } else if is_top_level_const(node, source) {
                // Keep top-level constants
                output.push_str(&get_node_text(node, source));
                output.push('\n');
            }
        }

        // Class declarations
        "class_declaration" => {
            extract_js_class_skeleton(output, node, source, depth);
        }

        // Abstract class
        "abstract_class_declaration" => {
            extract_js_class_skeleton(output, node, source, depth);
        }

        // Comments at top level
        "comment" => {
            let text = get_node_text(node, source);
            // Keep JSDoc and important comments
            if text.starts_with("/**") || text.starts_with("///") {
                output.push_str(&text);
                output.push('\n');
            }
        }

        // Module/namespace declarations
        "module" | "namespace_declaration" | "ambient_declaration" => {
            output.push_str(&get_node_text(node, source));
            output.push('\n');
        }

        // Program root - recurse into children
        "program" => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                extract_js_ts_skeleton(output, child, source, depth);
            }
        }

        // Statement block at top level (rare but possible)
        "statement_block" => {
            // Skip - we handle this in function/class extraction
        }

        // Expression statements (like top-level function calls)
        "expression_statement" => {
            // Usually skip, but keep important ones
            let text = get_node_text(node, source);
            if text.starts_with("module.exports") || text.starts_with("exports.") {
                output.push_str(&text);
                output.push('\n');
            }
        }

        _ => {
            // For unknown nodes at top level, check if they have interesting children
            if node.child_count() > 0 {
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    extract_js_ts_skeleton(output, child, source, depth);
                }
            }
        }
    }
}

/// Extract a JS/TS function signature
fn extract_js_function_signature(node: Node, source: &[u8]) -> Option<String> {
    let mut parts = Vec::new();
    let mut cursor = node.walk();

    // Check for async keyword
    for child in node.children(&mut cursor) {
        match child.kind() {
            "async" => parts.push("async".to_string()),
            "function" => parts.push("function".to_string()),
            "identifier" | "property_identifier" => {
                parts.push(get_node_text(child, source));
            }
            "formal_parameters" | "call_signature" => {
                parts.push(get_node_text(child, source));
            }
            "type_annotation" => {
                parts.push(get_node_text(child, source));
            }
            "type_parameters" => {
                parts.push(get_node_text(child, source));
            }
            _ => {}
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" "))
    }
}

/// Extract signature from const/let arrow function
fn extract_js_variable_function_signature(node: Node, source: &[u8]) -> Option<String> {
    let text = get_node_text(node, source);

    // Find the arrow or opening brace
    if let Some(arrow_pos) = text.find("=>") {
        // Get everything up to and just after the arrow
        let sig = &text[..arrow_pos + 2];
        Some(format!("{} {{ /* ... */ }}", sig.trim()))
    } else if text.find("function").is_some() {
        // Extract up to the opening brace
        if let Some(brace_pos) = text.find('{') {
            let sig = &text[..brace_pos];
            Some(format!("{} {{ /* ... */ }}", sig.trim()))
        } else {
            None
        }
    } else {
        None
    }
}

/// Check if a variable declaration is a simple top-level constant
fn is_top_level_const(node: Node, source: &[u8]) -> bool {
    let text = get_node_text(node, source);
    // Simple heuristic: if it doesn't contain function-like things and is short
    !text.contains("=>") && !text.contains("function") && text.len() < 200
}

/// Extract JS/TS class skeleton
fn extract_js_class_skeleton(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "  ".repeat(depth);
    let member_indent = "  ".repeat(depth + 1);

    // Get class header (name, extends, implements)
    let mut header_parts = Vec::new();
    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        match child.kind() {
            "abstract" => header_parts.push("abstract".to_string()),
            "class" => header_parts.push("class".to_string()),
            "type_identifier" | "identifier" => {
                if header_parts.iter().any(|p| p == "class") {
                    header_parts.push(get_node_text(child, source));
                }
            }
            "type_parameters" => header_parts.push(get_node_text(child, source)),
            "class_heritage" | "extends_clause" | "implements_clause" => {
                header_parts.push(get_node_text(child, source));
            }
            "class_body" => {
                // Output header
                output.push_str(&indent);
                output.push_str(&header_parts.join(" "));
                output.push_str(" {\n");

                // Process class members
                let mut body_cursor = child.walk();
                for member in child.children(&mut body_cursor) {
                    match member.kind() {
                        "public_field_definition" | "property_definition" |
                        "field_definition" => {
                            output.push_str(&member_indent);
                            output.push_str(&get_node_text(member, source));
                            output.push('\n');
                        }
                        "method_definition" | "method_signature" => {
                            if let Some(sig) = extract_js_method_signature(member, source) {
                                output.push_str(&member_indent);
                                output.push_str(&sig);
                                output.push_str(" { /* ... */ }\n");
                            }
                        }
                        "constructor_definition" | "constructor" => {
                            if let Some(sig) = extract_js_constructor_signature(member, source) {
                                output.push_str(&member_indent);
                                output.push_str(&sig);
                                output.push_str(" { /* ... */ }\n");
                            }
                        }
                        "abstract_method_signature" => {
                            output.push_str(&member_indent);
                            output.push_str(&get_node_text(member, source));
                            output.push('\n');
                        }
                        "comment" => {
                            let text = get_node_text(member, source);
                            if text.starts_with("/**") {
                                output.push_str(&member_indent);
                                output.push_str(&text);
                                output.push('\n');
                            }
                        }
                        _ => {}
                    }
                }

                output.push_str(&indent);
                output.push_str("}\n");
            }
            _ => {}
        }
    }
}

/// Extract method signature
fn extract_js_method_signature(node: Node, source: &[u8]) -> Option<String> {
    let mut parts = Vec::new();
    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        match child.kind() {
            "accessibility_modifier" | "static" | "readonly" | "async" |
            "override" | "abstract" | "get" | "set" => {
                parts.push(get_node_text(child, source));
            }
            "property_identifier" | "identifier" | "private_property_identifier" => {
                parts.push(get_node_text(child, source));
            }
            "formal_parameters" | "call_signature" => {
                parts.push(get_node_text(child, source));
            }
            "type_annotation" => {
                parts.push(get_node_text(child, source));
            }
            "type_parameters" => {
                parts.push(get_node_text(child, source));
            }
            _ => {}
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(parts.join(" "))
    }
}

/// Extract constructor signature
fn extract_js_constructor_signature(node: Node, source: &[u8]) -> Option<String> {
    let mut parts = vec!["constructor".to_string()];
    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        match child.kind() {
            "accessibility_modifier" => {
                parts.insert(0, get_node_text(child, source));
            }
            "formal_parameters" => {
                parts.push(get_node_text(child, source));
            }
            _ => {}
        }
    }

    Some(parts.join(" "))
}

/// Extract Python skeleton
fn extract_python_skeleton(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "    ".repeat(depth);

    match node.kind() {
        // Keep imports
        "import_statement" | "import_from_statement" => {
            output.push_str(&get_node_text(node, source));
            output.push('\n');
        }

        // Function definitions
        "function_definition" => {
            extract_python_function_skeleton(output, node, source, depth);
        }

        // Async function
        "decorated_definition" => {
            // Get decorator
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                match child.kind() {
                    "decorator" => {
                        output.push_str(&indent);
                        output.push_str(&get_node_text(child, source));
                        output.push('\n');
                    }
                    "function_definition" => {
                        extract_python_function_skeleton(output, child, source, depth);
                    }
                    "class_definition" => {
                        extract_python_class_skeleton(output, child, source, depth);
                    }
                    _ => {}
                }
            }
        }

        // Class definitions
        "class_definition" => {
            extract_python_class_skeleton(output, node, source, depth);
        }

        // Top-level assignments (constants, type aliases)
        "assignment" => {
            let text = get_node_text(node, source);
            // Keep type annotations and simple assignments
            if text.contains(":") || (!text.contains("(") && text.len() < 150) {
                output.push_str(&text);
                output.push('\n');
            }
        }

        // Expression statements - check for docstrings
        "expression_statement" => {
            let text = get_node_text(node, source);
            // Keep docstrings
            if text.trim_start().starts_with("\"\"\"") || text.trim_start().starts_with("'''") {
                output.push_str(&text);
                output.push('\n');
            }
            // Keep type annotations and simple assignments
            else if text.contains(":") || (!text.contains("(") && text.len() < 150) {
                output.push_str(&text);
                output.push('\n');
            }
        }

        // Type alias (Python 3.12+)
        "type_alias_statement" => {
            output.push_str(&get_node_text(node, source));
            output.push('\n');
        }

        // Comments
        "comment" => {
            let text = get_node_text(node, source);
            // Keep important comments
            if text.starts_with("# type:") || text.starts_with("# noqa") ||
               text.starts_with("# TODO") || text.starts_with("# FIXME") {
                output.push_str(&text);
                output.push('\n');
            }
        }

        // Root module
        "module" => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                extract_python_skeleton(output, child, source, depth);
            }
        }

        _ => {}
    }
}

/// Extract Python function skeleton
fn extract_python_function_skeleton(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "    ".repeat(depth);
    let body_indent = "    ".repeat(depth + 1);

    let mut cursor = node.walk();
    let mut signature = String::new();
    let mut docstring = None;

    for child in node.children(&mut cursor) {
        match child.kind() {
            "async" => signature.push_str("async "),
            "def" => signature.push_str("def "),
            "identifier" | "name" => {
                if signature.ends_with("def ") {
                    signature.push_str(&get_node_text(child, source));
                }
            }
            "parameters" => {
                signature.push_str(&get_node_text(child, source));
            }
            "type" => {
                signature.push_str(" -> ");
                signature.push_str(&get_node_text(child, source));
            }
            "block" => {
                // Look for docstring - check first child of block
                if let Some(first_stmt) = child.child(0) {
                    if first_stmt.kind() == "expression_statement" {
                        if let Some(expr) = first_stmt.child(0) {
                            if expr.kind() == "string" {
                                let text = get_node_text(expr, source);
                                if text.starts_with("\"\"\"") || text.starts_with("'''") {
                                    docstring = Some(text);
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    output.push_str(&indent);
    output.push_str(&signature);
    output.push_str(":\n");

    if let Some(doc) = docstring {
        output.push_str(&body_indent);
        output.push_str(&doc);
        output.push('\n');
    }

    output.push_str(&body_indent);
    output.push_str("...\n");
}

/// Extract Python class skeleton
fn extract_python_class_skeleton(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "    ".repeat(depth);
    let member_indent = "    ".repeat(depth + 1);

    let mut cursor = node.walk();
    let mut header = String::new();

    for child in node.children(&mut cursor) {
        match child.kind() {
            "class" => header.push_str("class "),
            "identifier" | "name" => {
                if header.ends_with("class ") {
                    header.push_str(&get_node_text(child, source));
                }
            }
            "argument_list" | "superclasses" => {
                header.push_str(&get_node_text(child, source));
            }
            "block" | "class_body" => {
                output.push_str(&indent);
                output.push_str(&header);
                output.push_str(":\n");

                // Process class body
                let mut block_cursor = child.walk();
                for member in child.children(&mut block_cursor) {
                    match member.kind() {
                        "function_definition" => {
                            extract_python_function_skeleton(output, member, source, depth + 1);
                        }
                        "decorated_definition" => {
                            let mut dec_cursor = member.walk();
                            for dec_child in member.children(&mut dec_cursor) {
                                match dec_child.kind() {
                                    "decorator" => {
                                        output.push_str(&member_indent);
                                        output.push_str(&get_node_text(dec_child, source));
                                        output.push('\n');
                                    }
                                    "function_definition" => {
                                        extract_python_function_skeleton(output, dec_child, source, depth + 1);
                                    }
                                    _ => {}
                                }
                            }
                        }
                        "expression_statement" => {
                            // Class-level assignments or docstrings
                            let text = get_node_text(member, source);
                            if text.contains(":") && !text.contains("(") {
                                // Type annotation
                                output.push_str(&member_indent);
                                output.push_str(&text);
                                output.push('\n');
                            } else if text.starts_with("\"\"\"") || text.starts_with("'''") {
                                // Docstring
                                output.push_str(&member_indent);
                                output.push_str(&text);
                                output.push('\n');
                            }
                        }
                        "assignment" => {
                            // Class attributes
                            let text = get_node_text(member, source);
                            if !text.contains("(") || text.len() < 100 {
                                output.push_str(&member_indent);
                                output.push_str(&text);
                                output.push('\n');
                            }
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }
}

/// Extract Rust skeleton
fn extract_rust_skeleton(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let _indent = "    ".repeat(depth); // Used by helper functions via depth parameter

    match node.kind() {
        // Keep use statements
        "use_declaration" => {
            output.push_str(&get_node_text(node, source));
            output.push('\n');
        }

        // Module declarations
        "mod_item" => {
            let text = get_node_text(node, source);
            if text.contains('{') {
                // Inline module - extract contents
                extract_rust_mod_skeleton(output, node, source, depth);
            } else {
                // External module reference
                output.push_str(&text);
                output.push('\n');
            }
        }

        // Struct definitions
        "struct_item" => {
            output.push_str(&get_node_text(node, source));
            output.push('\n');
        }

        // Enum definitions
        "enum_item" => {
            output.push_str(&get_node_text(node, source));
            output.push('\n');
        }

        // Type aliases
        "type_item" => {
            output.push_str(&get_node_text(node, source));
            output.push('\n');
        }

        // Trait definitions
        "trait_item" => {
            extract_rust_trait_skeleton(output, node, source, depth);
        }

        // Impl blocks
        "impl_item" => {
            extract_rust_impl_skeleton(output, node, source, depth);
        }

        // Function definitions
        "function_item" => {
            extract_rust_function_skeleton(output, node, source, depth);
        }

        // Constants and statics
        "const_item" | "static_item" => {
            output.push_str(&get_node_text(node, source));
            output.push('\n');
        }

        // Macro definitions (keep signature)
        "macro_definition" => {
            let text = get_node_text(node, source);
            if let Some(brace_pos) = text.find('{') {
                output.push_str(&text[..brace_pos]);
                output.push_str("{ /* ... */ }\n");
            } else {
                output.push_str(&text);
                output.push('\n');
            }
        }

        // Attributes (keep them, they're important)
        "attribute_item" | "inner_attribute_item" => {
            output.push_str(&get_node_text(node, source));
            output.push('\n');
        }

        // Line/block comments with docs
        "line_comment" | "block_comment" => {
            let text = get_node_text(node, source);
            if text.starts_with("///") || text.starts_with("//!") ||
               text.starts_with("/**") || text.starts_with("/*!") {
                output.push_str(&text);
                output.push('\n');
            }
        }

        // Source file root
        "source_file" => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                extract_rust_skeleton(output, child, source, depth);
            }
        }

        _ => {
            // Check for children
            if node.child_count() > 0 {
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    extract_rust_skeleton(output, child, source, depth);
                }
            }
        }
    }
}

/// Extract Rust module skeleton
fn extract_rust_mod_skeleton(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "    ".repeat(depth);
    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        match child.kind() {
            "visibility_modifier" => {
                output.push_str(&indent);
                output.push_str(&get_node_text(child, source));
                output.push(' ');
            }
            "mod" => {
                if output.is_empty() || !output.ends_with(' ') {
                    output.push_str(&indent);
                }
                output.push_str("mod ");
            }
            "identifier" => {
                output.push_str(&get_node_text(child, source));
            }
            "declaration_list" => {
                output.push_str(" {\n");
                let mut list_cursor = child.walk();
                for item in child.children(&mut list_cursor) {
                    extract_rust_skeleton(output, item, source, depth + 1);
                }
                output.push_str(&indent);
                output.push_str("}\n");
            }
            _ => {}
        }
    }
}

/// Extract Rust function skeleton
fn extract_rust_function_skeleton(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "    ".repeat(depth);
    let text = get_node_text(node, source);

    // Find the function body start
    if let Some(brace_pos) = text.find('{') {
        let signature = text[..brace_pos].trim();
        output.push_str(&indent);
        output.push_str(signature);
        output.push_str(" { /* ... */ }\n");
    } else {
        // No body (trait method signature)
        output.push_str(&indent);
        output.push_str(&text);
        output.push('\n');
    }
}

/// Extract Rust trait skeleton
fn extract_rust_trait_skeleton(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "    ".repeat(depth);
    let member_indent = "    ".repeat(depth + 1);

    let mut cursor = node.walk();
    let mut header = String::new();

    for child in node.children(&mut cursor) {
        match child.kind() {
            "visibility_modifier" => {
                header.push_str(&get_node_text(child, source));
                header.push(' ');
            }
            "trait" => header.push_str("trait "),
            "type_identifier" => {
                if header.contains("trait ") {
                    header.push_str(&get_node_text(child, source));
                }
            }
            "type_parameters" => header.push_str(&get_node_text(child, source)),
            "trait_bounds" | "where_clause" => {
                header.push(' ');
                header.push_str(&get_node_text(child, source));
            }
            "declaration_list" => {
                output.push_str(&indent);
                output.push_str(&header);
                output.push_str(" {\n");

                let mut list_cursor = child.walk();
                for item in child.children(&mut list_cursor) {
                    match item.kind() {
                        "function_signature_item" | "function_item" => {
                            let text = get_node_text(item, source);
                            output.push_str(&member_indent);
                            if text.contains('{') {
                                if let Some(brace_pos) = text.find('{') {
                                    output.push_str(text[..brace_pos].trim());
                                    output.push_str(" { /* ... */ }");
                                }
                            } else {
                                output.push_str(&text);
                            }
                            output.push('\n');
                        }
                        "associated_type" | "const_item" => {
                            output.push_str(&member_indent);
                            output.push_str(&get_node_text(item, source));
                            output.push('\n');
                        }
                        _ => {}
                    }
                }

                output.push_str(&indent);
                output.push_str("}\n");
            }
            _ => {}
        }
    }
}

/// Extract Rust impl skeleton
fn extract_rust_impl_skeleton(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "    ".repeat(depth);
    let member_indent = "    ".repeat(depth + 1);

    let text = get_node_text(node, source);

    // Find impl header up to the opening brace
    if let Some(brace_pos) = text.find('{') {
        let header = text[..brace_pos].trim();
        output.push_str(&indent);
        output.push_str(header);
        output.push_str(" {\n");

        // Extract method signatures from the impl body
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() == "declaration_list" {
                let mut list_cursor = child.walk();
                for item in child.children(&mut list_cursor) {
                    match item.kind() {
                        "function_item" => {
                            let fn_text = get_node_text(item, source);
                            if let Some(fn_brace) = fn_text.find('{') {
                                output.push_str(&member_indent);
                                output.push_str(fn_text[..fn_brace].trim());
                                output.push_str(" { /* ... */ }\n");
                            }
                        }
                        "const_item" | "type_item" => {
                            output.push_str(&member_indent);
                            output.push_str(&get_node_text(item, source));
                            output.push('\n');
                        }
                        _ => {}
                    }
                }
            }
        }

        output.push_str(&indent);
        output.push_str("}\n");
    }
}

/// Extract Go skeleton
fn extract_go_skeleton(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "\t".repeat(depth);

    match node.kind() {
        // Package declaration
        "package_clause" => {
            output.push_str(&get_node_text(node, source));
            output.push('\n');
        }

        // Imports
        "import_declaration" => {
            output.push_str(&get_node_text(node, source));
            output.push('\n');
        }

        // Type declarations
        "type_declaration" => {
            output.push_str(&get_node_text(node, source));
            output.push('\n');
        }

        // Function declarations
        "function_declaration" => {
            let text = get_node_text(node, source);
            if let Some(brace_pos) = text.find('{') {
                output.push_str(&indent);
                output.push_str(text[..brace_pos].trim());
                output.push_str(" { /* ... */ }\n");
            }
        }

        // Method declarations
        "method_declaration" => {
            let text = get_node_text(node, source);
            if let Some(brace_pos) = text.find('{') {
                output.push_str(&indent);
                output.push_str(text[..brace_pos].trim());
                output.push_str(" { /* ... */ }\n");
            }
        }

        // Const/var declarations
        "const_declaration" | "var_declaration" => {
            output.push_str(&get_node_text(node, source));
            output.push('\n');
        }

        // Interface types
        "type_spec" => {
            output.push_str(&get_node_text(node, source));
            output.push('\n');
        }

        // Comments
        "comment" => {
            let text = get_node_text(node, source);
            if text.starts_with("//") && text.len() > 3 {
                output.push_str(&text);
                output.push('\n');
            }
        }

        // Source file
        "source_file" => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                extract_go_skeleton(output, child, source, depth);
            }
        }

        _ => {}
    }
}

/// Extract JSON skeleton (show structure)
fn extract_json_skeleton(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "  ".repeat(depth);

    match node.kind() {
        "document" => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                extract_json_skeleton(output, child, source, depth);
            }
        }
        "object" => {
            output.push_str(&indent);
            output.push_str("{\n");

            let mut cursor = node.walk();
            let mut count = 0;
            for child in node.children(&mut cursor) {
                if child.kind() == "pair" {
                    if count > 0 {
                        output.push_str(",\n");
                    }
                    extract_json_skeleton(output, child, source, depth + 1);
                    count += 1;
                }
            }

            if count > 0 {
                output.push('\n');
            }
            output.push_str(&indent);
            output.push('}');
        }
        "pair" => {
            let mut cursor = node.walk();
            let mut key = None;
            let mut value_kind = "unknown";

            for child in node.children(&mut cursor) {
                match child.kind() {
                    "string" => {
                        if key.is_none() {
                            key = Some(get_node_text(child, source));
                        }
                    }
                    "object" => value_kind = "{...}",
                    "array" => value_kind = "[...]",
                    "number" => value_kind = "number",
                    "true" | "false" => value_kind = "boolean",
                    "null" => value_kind = "null",
                    _ => {}
                }
            }

            if let Some(k) = key {
                output.push_str(&indent);
                output.push_str(&k);
                output.push_str(": ");
                output.push_str(value_kind);
            }
        }
        "array" => {
            output.push_str(&indent);
            output.push_str("[...]");
        }
        _ => {}
    }
}

/// Extract CSS skeleton (selectors and property groups)
fn extract_css_skeleton(output: &mut String, node: Node, source: &[u8]) {
    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        match child.kind() {
            "rule_set" => {
                // Get selector and property count
                let mut selector = String::new();
                let mut prop_count = 0;

                let mut rule_cursor = child.walk();
                for part in child.children(&mut rule_cursor) {
                    match part.kind() {
                        "selectors" => {
                            selector = get_node_text(part, source);
                        }
                        "block" => {
                            let mut block_cursor = part.walk();
                            for item in part.children(&mut block_cursor) {
                                if item.kind() == "declaration" {
                                    prop_count += 1;
                                }
                            }
                        }
                        _ => {}
                    }
                }

                output.push_str(&selector);
                output.push_str(&format!(" {{ /* {} properties */ }}\n", prop_count));
            }
            "media_statement" | "keyframes_statement" | "import_statement" => {
                output.push_str(&get_node_text(child, source));
                output.push('\n');
            }
            _ => {}
        }
    }
}

/// Extract HTML skeleton (tag structure)
fn extract_html_skeleton(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "  ".repeat(depth);

    match node.kind() {
        "document" | "fragment" => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                extract_html_skeleton(output, child, source, depth);
            }
        }
        "doctype" => {
            output.push_str(&get_node_text(node, source));
            output.push('\n');
        }
        "element" => {
            let mut cursor = node.walk();
            let mut tag_name = String::new();
            let mut has_children = false;
            let mut child_elements = 0;

            for child in node.children(&mut cursor) {
                match child.kind() {
                    "start_tag" => {
                        let mut tag_cursor = child.walk();
                        for part in child.children(&mut tag_cursor) {
                            if part.kind() == "tag_name" {
                                tag_name = get_node_text(part, source);
                                break;
                            }
                        }
                    }
                    "element" => {
                        has_children = true;
                        child_elements += 1;
                    }
                    "text" => {
                        let text = get_node_text(child, source).trim().to_string();
                        if !text.is_empty() {
                            has_children = true;
                        }
                    }
                    _ => {}
                }
            }

            output.push_str(&indent);
            output.push('<');
            output.push_str(&tag_name);
            output.push('>');

            if has_children {
                if child_elements > 0 {
                    output.push_str(&format!(" <!-- {} children -->", child_elements));
                } else {
                    output.push_str("...");
                }
            }

            output.push_str("</");
            output.push_str(&tag_name);
            output.push_str(">\n");
        }
        _ => {}
    }
}

/// Fallback compression for unsupported languages
pub fn fallback_compress(content: &str) -> String {
    let mut output = Vec::new();
    let mut prev_empty = false;

    for line in content.lines() {
        let trimmed = line.trim();

        // Skip empty lines (but keep one)
        if trimmed.is_empty() {
            if !prev_empty {
                output.push("");
                prev_empty = true;
            }
            continue;
        }
        prev_empty = false;

        // Keep structural lines
        let is_structural =
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
            trimmed.starts_with("@") ||
            trimmed.starts_with("#[") ||
            // Block endings (sometimes important)
            trimmed == "}" ||
            trimmed == "end" ||
            trimmed == "}" ||
            // Comments that look like docs
            trimmed.starts_with("///") ||
            trimmed.starts_with("//!") ||
            trimmed.starts_with("/**") ||
            trimmed.starts_with("* ") ||
            (trimmed.starts_with("# ") && !trimmed.starts_with("# "));

        if is_structural {
            output.push(line);
        }
    }

    output.join("\n")
}

/// Get text content of a tree-sitter node
fn get_node_text(node: Node, source: &[u8]) -> String {
    let start = node.start_byte();
    let end = node.end_byte();
    String::from_utf8_lossy(&source[start..end]).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_typescript_skeleton() {
        let code = r#"
import { User } from './user';

interface Config {
    name: string;
    value: number;
}

export class UserService {
    private users: User[] = [];

    constructor(private config: Config) {
        this.initialize();
    }

    async getUser(id: string): Promise<User | null> {
        const user = this.users.find(u => u.id === id);
        if (!user) {
            return null;
        }
        return user;
    }

    private initialize(): void {
        console.log('Initializing...');
        this.loadUsers();
    }
}

export function helper(x: number): number {
    return x * 2;
}
"#;

        let result = skeletonize(code, "ts");
        println!("Skeleton:\n{}", result.skeleton);
        assert!(result.skeleton.contains("import { User }"));
        assert!(result.skeleton.contains("interface Config"));
        assert!(result.skeleton.contains("class UserService"));
        assert!(result.skeleton.contains("getUser"));
        assert!(!result.skeleton.contains("console.log"));
    }

    #[test]
    fn test_python_skeleton() {
        let code = r#"
from typing import List, Optional
import json

class DataProcessor:
    """Processes data from various sources."""

    def __init__(self, config: dict):
        """Initialize the processor."""
        self.config = config
        self.data = []

    def process(self, items: List[str]) -> List[dict]:
        """Process a list of items."""
        results = []
        for item in items:
            result = self._transform(item)
            results.append(result)
        return results

    def _transform(self, item: str) -> dict:
        return json.loads(item)

def main():
    processor = DataProcessor({})
    processor.process([])
"#;

        let result = skeletonize(code, "py");
        println!("Skeleton:\n{}", result.skeleton);
        assert!(result.skeleton.contains("from typing import"));
        assert!(result.skeleton.contains("class DataProcessor"));
        assert!(result.skeleton.contains("def __init__"));
        assert!(result.skeleton.contains("def process"));
        assert!(!result.skeleton.contains("for item in"));
    }

    #[test]
    fn test_rust_skeleton() {
        let code = r#"
use std::collections::HashMap;

/// A cache for storing values
pub struct Cache<K, V> {
    data: HashMap<K, V>,
    capacity: usize,
}

impl<K: Eq + Hash, V> Cache<K, V> {
    /// Creates a new cache
    pub fn new(capacity: usize) -> Self {
        Cache {
            data: HashMap::new(),
            capacity,
        }
    }

    pub fn get(&self, key: &K) -> Option<&V> {
        self.data.get(key)
    }

    pub fn insert(&mut self, key: K, value: V) {
        if self.data.len() >= self.capacity {
            // Evict oldest
        }
        self.data.insert(key, value);
    }
}

pub fn helper() -> i32 {
    42
}
"#;

        let result = skeletonize(code, "rs");
        println!("Skeleton:\n{}", result.skeleton);
        assert!(result.skeleton.contains("use std::collections::HashMap"));
        assert!(result.skeleton.contains("pub struct Cache"));
        assert!(result.skeleton.contains("impl<K: Eq + Hash, V> Cache<K, V>"));
        assert!(result.skeleton.contains("pub fn new"));
        assert!(!result.skeleton.contains("HashMap::new()"));
    }

    #[test]
    fn test_fallback_compression() {
        let code = r#"
package main

import "fmt"

type User struct {
    Name string
    Age  int
}

func (u *User) Greet() string {
    greeting := fmt.Sprintf("Hello, %s!", u.Name)
    return greeting
}

func main() {
    user := User{Name: "Alice", Age: 30}
    fmt.Println(user.Greet())
}
"#;

        let result = skeletonize(code, "go");
        println!("Skeleton:\n{}", result.skeleton);
        assert!(result.skeleton.contains("package main"));
        assert!(result.skeleton.contains("type User struct"));
    }

    #[test]
    fn test_unsupported_language() {
        let code = "void main() { printf(\"hello\"); }";
        let result = skeletonize(code, "unknown");
        assert!(result.language.is_none());
    }
}
