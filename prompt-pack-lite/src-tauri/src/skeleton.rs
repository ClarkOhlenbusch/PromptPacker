//! Smart Skeleton: AST-based code compression
//!
//! This module extracts structural signatures from source code using tree-sitter.
//! It preserves imports, type definitions, and function signatures while stripping
//! implementation details to reduce token count for LLM context.

use std::collections::HashSet;
use tree_sitter::{Language, Parser, Node};

// Threshold constants for determining whether to include full content
const MAX_SIMPLE_CONST_LEN: usize = 200;
const MAX_SIMPLE_ASSIGNMENT_LEN: usize = 150;
const MAX_CLASS_ATTR_LEN: usize = 100;
const MAX_DOC_LINE_LEN: usize = 120;
const MAX_DEF_LINE_LEN: usize = 180;
const MAX_SKELETON_LINES: usize = 200;
const MAX_SKELETON_CHARS: usize = 8000;
const MAX_MEMBER_NAMES: usize = 8;
const MAX_FALLBACK_LINE_LEN: usize = 200;
const MAX_JSON_DEP_ENTRIES: usize = 12;
const MAX_JSON_ENTRY_LEN: usize = 60;
const MAX_JSON_SCRIPT_ENTRIES: usize = 12;
const MAX_JSON_INLINE_ARRAY_ITEMS: usize = 4;
const MAX_JS_INVOKES: usize = 8;
const MAX_JSX_COMPONENTS: usize = 10;
const MAX_JS_INSIGHT_NAME_LEN: usize = 40;
const MAX_JS_INSIGHT_NODES: usize = 4000;
const MAX_JSON_LARGE_BYTES: usize = 2 * 1024 * 1024;
const MAX_JSON_LARGE_KEYS: usize = 12;
const ENABLE_JS_TS_INSIGHTS: bool = true;

const JSON_DEP_KEYS: &[&str] = &[
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
];
const JSON_SCRIPT_KEY: &str = "scripts";

#[derive(Clone, Copy)]
struct JsTsContext<'a> {
    has_exports: bool,
    in_export: bool,
    exported_names: Option<&'a HashSet<String>>,
    external_imports: Option<&'a HashSet<String>>,
}

struct JsTsExports {
    has_exports: bool,
    names: HashSet<String>,
}

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

    let mut skeleton = match language {
        Some(lang) => {
            match extract_skeleton(content, lang) {
                Ok(s) => s,
                Err(_) => fallback_compress(content, extension), // Parse failed, use fallback
            }
        }
        None => fallback_compress(content, extension), // Unsupported language
    };

    skeleton = cap_skeleton_output(&skeleton, language);
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

    if lang == SupportedLanguage::Json && content.len() > MAX_JSON_LARGE_BYTES {
        return Ok(summarize_large_json(content));
    }

    let tree = parser.parse(content, None)
        .ok_or("Failed to parse content")?;

    let root = tree.root_node();
    let source = content.as_bytes();

    let mut output = String::new();

    match lang {
        SupportedLanguage::TypeScript | SupportedLanguage::TypeScriptTsx |
        SupportedLanguage::JavaScript | SupportedLanguage::JavaScriptJsx => {
            let exports = collect_js_ts_exports(root, source);
            let external_imports = collect_js_ts_external_imports(root, source);
            let ctx = JsTsContext {
                has_exports: exports.has_exports,
                in_export: false,
                exported_names: if exports.names.is_empty() {
                    None
                } else {
                    Some(&exports.names)
                },
                external_imports: if external_imports.is_empty() {
                    None
                } else {
                    Some(&external_imports)
                },
            };
            extract_js_ts_skeleton(&mut output, root, source, 0, ctx);
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
fn extract_js_ts_skeleton<'a>(
    output: &mut String,
    node: Node<'a>,
    source: &'a [u8],
    depth: usize,
    ctx: JsTsContext<'a>,
) {
    let indent = "  ".repeat(depth);
    let skip_non_export = ctx.has_exports && ctx.exported_names.is_some() && !ctx.in_export && depth == 0;

    match node.kind() {
        // Keep imports verbatim
        "import_statement" | "import_declaration" => {
            output.push_str(&truncate_line(&get_node_text(node, source), MAX_DEF_LINE_LEN));
            output.push('\n');
        }

        // Keep exports (but skeletonize what's exported)
        "export_statement" | "export_declaration" => {
            // Check if it's exporting a function/class
            let mut has_default = false;
            let export_ctx = JsTsContext { in_export: true, ..ctx };
            let mut cursor = node.walk();
            let mut has_body = false;

            for child in node.children(&mut cursor) {
                if child.kind() == "default" {
                    has_default = true;
                }
                if matches!(
                    child.kind(),
                    "function_declaration"
                        | "class_declaration"
                        | "abstract_class_declaration"
                        | "interface_declaration"
                        | "enum_declaration"
                        | "type_alias_declaration"
                        | "lexical_declaration"
                        | "variable_declaration"
                        | "arrow_function"
                        | "function"
                ) {
                    has_body = true;
                    // Handle the declaration specially
                    if matches!(child.kind(), "lexical_declaration" | "variable_declaration") {
                        extract_js_ts_skeleton(output, child, source, depth, export_ctx);
                    } else {
                        if has_default {
                            output.push_str("export default ");
                        } else {
                            output.push_str("export ");
                        }
                        extract_js_ts_skeleton(output, child, source, depth, export_ctx);
                    }
                    break;
                }
            }

            if !has_body {
                output.push_str(&truncate_line(&get_node_text(node, source), MAX_DEF_LINE_LEN));
                output.push('\n');
            }
        }

        "export_default_declaration" => {
            let export_ctx = JsTsContext { in_export: true, ..ctx };
            let mut cursor = node.walk();
            let mut has_body = false;

            for child in node.children(&mut cursor) {
                if matches!(
                    child.kind(),
                    "function_declaration"
                        | "class_declaration"
                        | "abstract_class_declaration"
                        | "interface_declaration"
                        | "enum_declaration"
                        | "type_alias_declaration"
                        | "lexical_declaration"
                        | "variable_declaration"
                        | "arrow_function"
                        | "function"
                        | "function_expression"
                ) {
                    has_body = true;
                    output.push_str("export default ");
                    extract_js_ts_skeleton(output, child, source, depth, export_ctx);
                    break;
                }
            }

            if !has_body {
                output.push_str(&truncate_line(get_node_text(node, source), MAX_DEF_LINE_LEN));
                output.push('\n');
            }
        }

        "export_assignment" => {
            output.push_str(&truncate_line(get_node_text(node, source), MAX_DEF_LINE_LEN));
            output.push('\n');
        }

        // Type definitions - keep fully
        "type_alias_declaration" | "interface_declaration" | "enum_declaration" => {
            if skip_non_export && !js_ts_decl_is_exported(node, source, ctx) {
                return;
            }
            output.push_str(&summarize_ts_declaration(node, source));
            output.push('\n');
        }

        // Function declarations - keep signature, skip body
        "function_declaration" | "function_signature" => {
            if skip_non_export && !js_ts_decl_is_exported(node, source, ctx) {
                return;
            }
            if let Some(sig) = extract_js_function_signature(node, source) {
                output.push_str(&indent);
                output.push_str(&sig);
                output.push('\n');
            }
            if let Some(jsx_summary) = extract_jsx_return(node, source, &indent) {
                output.push_str(&jsx_summary);
                output.push('\n');
            }
            if node.kind() == "function_declaration" {
                emit_js_ts_insights(output, node, source, &indent, ctx.external_imports);
            }
        }

        "arrow_function" | "function_expression" => {
            if skip_non_export {
                return;
            }
            let sig = if node.kind() == "arrow_function" {
                js_arrow_function_signature(node, source)
            } else {
                extract_js_function_signature(node, source).unwrap_or_default()
            };
            let sig = truncate_line(&sig, MAX_DEF_LINE_LEN);
            if !sig.is_empty() {
                output.push_str(&indent);
                output.push_str(&sig);
                output.push('\n');
                if let Some(jsx_summary) = extract_jsx_return(node, source, &indent) {
                    output.push_str(&jsx_summary);
                    output.push('\n');
                }
                emit_js_ts_insights(output, node, source, &indent, ctx.external_imports);
            }
        }

        // Arrow functions at top level
        "lexical_declaration" | "variable_declaration" => {
            emit_js_variable_declarations(output, node, source, &indent, skip_non_export, ctx);
        }

        // Class declarations
        "class_declaration" => {
            if skip_non_export && !js_ts_decl_is_exported(node, source, ctx) {
                return;
            }
            extract_js_class_skeleton(output, node, source, depth);
        }

        // Abstract class
        "abstract_class_declaration" => {
            if skip_non_export && !js_ts_decl_is_exported(node, source, ctx) {
                return;
            }
            extract_js_class_skeleton(output, node, source, depth);
        }

        // Comments at top level
        "comment" => {
            if skip_non_export {
                return;
            }
            let text = get_node_text(node, source);
            if let Some(summary) = trim_doc_comment(&text) {
                output.push_str(&summary);
                output.push('\n');
            }
        }

        // Module/namespace declarations
        "module" | "namespace_declaration" | "ambient_declaration" => {
            if skip_non_export && !js_ts_decl_is_exported(node, source, ctx) {
                return;
            }
            output.push_str(&summarize_block_declaration(&get_node_text(node, source)));
            output.push('\n');
        }

        // Program root - recurse into children
        "program" => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                extract_js_ts_skeleton(output, child, source, depth, ctx);
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
                output.push_str(&truncate_line(&text, MAX_DEF_LINE_LEN));
                output.push('\n');
            } else if depth == 0 {
                // Keep top-level function calls (for scripts/extensions)
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.kind() == "call_expression" {
                        output.push_str(&truncate_line(&text, MAX_DEF_LINE_LEN));
                        output.push('\n');
                        break;
                    }
                }
            }
        }

        _ => {
            // For unknown nodes at top level, check if they have interesting children
            if node.child_count() > 0 {
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    extract_js_ts_skeleton(output, child, source, depth, ctx);
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
                parts.push(get_node_text(child, source).to_string());
            }
            "formal_parameters" | "call_signature" => {
                parts.push(get_node_text(child, source).to_string());
            }
            "type_annotation" => {
                parts.push(get_node_text(child, source).to_string());
            }
            "type_parameters" => {
                parts.push(get_node_text(child, source).to_string());
            }
            _ => {}
        }
    }

    if parts.is_empty() {
        None
    } else {
        Some(truncate_line(&parts.join(" "), MAX_DEF_LINE_LEN))
    }
}

fn js_ts_is_exported_name(ctx: JsTsContext<'_>, name: &str) -> bool {
    match ctx.exported_names {
        Some(names) => names.contains(name),
        None => false,
    }
}

fn js_ts_decl_is_exported<'a>(node: Node<'a>, source: &'a [u8], ctx: JsTsContext<'a>) -> bool {
    let Some(names) = ctx.exported_names else {
        return false;
    };
    let Some(name) = js_declared_name(node, source) else {
        return false;
    };
    names.contains(&name)
}

fn emit_js_variable_declarations<'a>(
    output: &mut String,
    node: Node<'a>,
    source: &'a [u8],
    indent: &str,
    skip_non_export: bool,
    ctx: JsTsContext<'a>,
) {
    let keyword = js_variable_decl_keyword(node);
    let export_prefix = if ctx.in_export { "export " } else { "" };
    let mut cursor = node.walk();
    let mut emitted = false;

    for child in node.children(&mut cursor) {
        if child.kind() != "variable_declarator" {
            continue;
        }

        let binding_names = js_declarator_binding_names(child, source);
        let is_exported = binding_names
            .iter()
            .any(|decl| js_ts_is_exported_name(ctx, decl));

        if skip_non_export && !is_exported {
            continue;
        }

        if let Some(func_node) = js_declarator_function(child) {
            let sig = format_js_variable_function_signature(child, func_node, source, keyword);
            if sig.is_empty() {
                continue;
            }
            output.push_str(indent);
            output.push_str(export_prefix);
            output.push_str(&sig);
            output.push('\n');
            if let Some(jsx_summary) = extract_jsx_return(func_node, source, indent) {
                output.push_str(&jsx_summary);
                output.push('\n');
            }
            emit_js_ts_insights(output, func_node, source, indent, ctx.external_imports);
            emitted = true;
            continue;
        }

        if let Some(summary) = summarize_js_variable_declarator(child, source, keyword) {
            output.push_str(indent);
            output.push_str(export_prefix);
            output.push_str(&summary);
            output.push('\n');
            emitted = true;
        }
    }

    if !emitted && !skip_non_export {
        let summary = summarize_js_variable_declaration(node, source);
        if !summary.is_empty() {
            output.push_str(indent);
            output.push_str(export_prefix);
            output.push_str(&summary);
            output.push('\n');
        }
    }
}

fn js_variable_decl_keyword(node: Node) -> &'static str {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "const" => return "const",
            "let" => return "let",
            "var" => return "var",
            _ => {}
        }
    }
    if node.kind() == "variable_declaration" {
        "var"
    } else {
        "const"
    }
}

fn js_declarator_name(node: Node, source: &[u8]) -> Option<String> {
    if let Some(name) = node.child_by_field_name("name") {
        if matches!(name.kind(), "identifier" | "property_identifier" | "type_identifier") {
            return Some(get_node_text(name, source).to_string());
        }
        return None;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if matches!(child.kind(), "identifier" | "property_identifier" | "type_identifier") {
            return Some(get_node_text(child, source).to_string());
        }
    }
    None
}

fn js_declarator_binding_names(node: Node, source: &[u8]) -> Vec<String> {
    if let Some(name) = node.child_by_field_name("name") {
        return js_pattern_binding_names(name, source);
    }
    if let Some(name) = js_declarator_name(node, source) {
        return vec![name];
    }
    Vec::new()
}

fn js_pattern_binding_names(node: Node, source: &[u8]) -> Vec<String> {
    let mut names = Vec::new();
    js_pattern_binding_names_rec(node, source, &mut names);
    names
}

fn js_pattern_binding_names_rec(node: Node, source: &[u8], names: &mut Vec<String>) {
    match node.kind() {
        "identifier"
        | "property_identifier"
        | "type_identifier"
        | "shorthand_property_identifier_pattern"
        | "shorthand_property_identifier" => {
            names.push(get_node_text(node, source).to_string());
            return;
        }
        "pair_pattern" => {
            if let Some(value) = node.child_by_field_name("value") {
                js_pattern_binding_names_rec(value, source, names);
            }
            return;
        }
        "assignment_pattern" => {
            if let Some(left) = node.child_by_field_name("left") {
                js_pattern_binding_names_rec(left, source, names);
            }
            return;
        }
        "rest_pattern" => {
            if let Some(arg) = node.child_by_field_name("argument") {
                js_pattern_binding_names_rec(arg, source, names);
            }
            return;
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if !child.is_named() {
            continue;
        }
        js_pattern_binding_names_rec(child, source, names);
    }
}

fn js_declarator_function(node: Node) -> Option<Node> {
    let value = node.child_by_field_name("value")?;
    if matches!(value.kind(), "arrow_function" | "function" | "function_expression") {
        Some(value)
    } else {
        None
    }
}

fn format_js_variable_function_signature(
    declarator: Node,
    func_node: Node,
    source: &[u8],
    keyword: &str,
) -> String {
    let Some(name) = js_declarator_name(declarator, source) else {
        return String::new();
    };
    let func_sig = if func_node.kind() == "arrow_function" {
        js_arrow_function_signature(func_node, source)
    } else {
        extract_js_function_signature(func_node, source).unwrap_or_else(|| "function".to_string())
    };

    let mut sig = String::new();
    if !keyword.is_empty() {
        sig.push_str(keyword);
        sig.push(' ');
    }
    sig.push_str(&name);
    sig.push_str(" = ");
    sig.push_str(&func_sig);
    truncate_line(&sig, MAX_DEF_LINE_LEN)
}

fn js_arrow_function_signature(node: Node, source: &[u8]) -> String {
    let mut sig = String::new();
    if js_function_is_async(node) {
        sig.push_str("async ");
    }
    let params = js_function_parameters(node, source).unwrap_or_else(|| "()".to_string());
    sig.push_str(&params);
    if let Some(ret) = js_function_return_type(node, source) {
        sig.push_str(&ret);
    }
    sig.push_str(" =>");
    sig
}

fn js_function_is_async(node: Node) -> bool {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "async" {
            return true;
        }
    }
    false
}

fn js_function_parameters(node: Node, source: &[u8]) -> Option<String> {
    let params = node
        .child_by_field_name("parameters")
        .or_else(|| node.child_by_field_name("formal_parameters"))
        .or_else(|| node.child_by_field_name("parameter"))
        .or_else(|| {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if matches!(child.kind(), "identifier" | "object_pattern" | "array_pattern") {
                    return Some(child);
                }
            }
            None
        });
    params.map(|params| get_node_text(params, source).to_string())
}

fn js_function_return_type(node: Node, source: &[u8]) -> Option<String> {
    node.child_by_field_name("return_type")
        .or_else(|| node.child_by_field_name("type_annotation"))
        .map(|ty| get_node_text(ty, source).to_string())
}

fn summarize_js_variable_declarator(node: Node, source: &[u8], keyword: &str) -> Option<String> {
    let text = get_node_text(node, source);
    if text.trim().is_empty() {
        return None;
    }
    let summary = summarize_assignment(&text);
    let mut line = if keyword.is_empty() {
        summary
    } else {
        format!("{keyword} {summary}")
    };
    line = truncate_line(&line, MAX_DEF_LINE_LEN);
    Some(line)
}

fn js_declared_name(node: Node, source: &[u8]) -> Option<String> {
    if let Some(name) = node.child_by_field_name("name") {
        return Some(get_node_text(name, source).to_string());
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if matches!(child.kind(), "identifier" | "property_identifier" | "type_identifier") {
            return Some(get_node_text(child, source).to_string());
        }
    }
    None
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
                    header_parts.push(get_node_text(child, source).to_string());
                }
            }
            "type_parameters" => header_parts.push(get_node_text(child, source).to_string()),
            "class_heritage" | "extends_clause" | "implements_clause" => {
                header_parts.push(get_node_text(child, source).to_string());
            }
            "class_body" => {
                // Output header
                output.push_str(&indent);
                output.push_str(&truncate_line(&header_parts.join(" "), MAX_DEF_LINE_LEN));
                output.push('\n');

                // Process class members
                let mut body_cursor = child.walk();
                for member in child.children(&mut body_cursor) {
                    if js_member_is_private(member, source) {
                        continue;
                    }
                    match member.kind() {
                        "public_field_definition" | "property_definition" |
                        "field_definition" => {
                            output.push_str(&member_indent);
                            output.push_str(&summarize_js_property_definition(member, source));
                            output.push('\n');
                        }
                        "method_definition" | "method_signature" => {
                            if let Some(sig) = extract_js_method_signature(member, source) {
                                output.push_str(&member_indent);
                                output.push_str(&sig);
                                output.push('\n');
                            }
                        }
                        "constructor_definition" | "constructor" => {
                            if let Some(sig) = extract_js_constructor_signature(member, source) {
                                output.push_str(&member_indent);
                                output.push_str(&sig);
                                output.push('\n');
                            }
                        }
                        "abstract_method_signature" => {
                            output.push_str(&member_indent);
                            output.push_str(&get_node_text(member, source));
                            output.push('\n');
                        }
                        "comment" => {
                            let text = get_node_text(member, source);
                            if let Some(summary) = trim_doc_comment(&text) {
                                output.push_str(&member_indent);
                                output.push_str(&summary);
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
        Some(truncate_line(&parts.join(" "), MAX_DEF_LINE_LEN))
    }
}

/// Extract constructor signature
fn extract_js_constructor_signature(node: Node, source: &[u8]) -> Option<String> {
    let mut parts = vec!["constructor".to_string()];
    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        match child.kind() {
            "accessibility_modifier" => {
                parts.insert(0, get_node_text(child, source).to_string());
            }
            "formal_parameters" => {
                parts.push(get_node_text(child, source).to_string());
            }
            _ => {}
        }
    }

    Some(truncate_line(&parts.join(" "), MAX_DEF_LINE_LEN))
}

/// Extract Python skeleton
fn extract_python_skeleton(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "    ".repeat(depth);

    match node.kind() {
        // Keep imports
        "import_statement" | "import_from_statement" => {
            output.push_str(&truncate_line(&get_node_text(node, source), MAX_DEF_LINE_LEN));
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
                        output.push_str(&truncate_line(&get_node_text(child, source), MAX_DEF_LINE_LEN));
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
            if text.contains(":") || (!text.contains("(") && text.len() < MAX_SIMPLE_ASSIGNMENT_LEN) {
                output.push_str(&text);
                output.push('\n');
            }
        }

        // Expression statements - check for docstrings
        "expression_statement" => {
            let text = get_node_text(node, source);
            if let Some(summary) = trim_docstring(&text) {
                output.push_str(&summary);
                output.push('\n');
            }
            // Keep type annotations and simple assignments
            else if text.contains(":") || (!text.contains("(") && text.len() < MAX_SIMPLE_ASSIGNMENT_LEN) {
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
                output.push_str(&truncate_line(&text, MAX_DEF_LINE_LEN));
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
                                if let Some(summary) = trim_docstring(&text) {
                                    docstring = Some(summary);
                                }
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }

    let signature = truncate_line(&signature, MAX_DEF_LINE_LEN);
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
                let header = truncate_line(&header, MAX_DEF_LINE_LEN);
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
                                        output.push_str(&truncate_line(&get_node_text(dec_child, source), MAX_DEF_LINE_LEN));
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
                            } else if let Some(summary) = trim_docstring(&text) {
                                output.push_str(&member_indent);
                                output.push_str(&summary);
                                output.push('\n');
                            }
                        }
                        "assignment" => {
                            // Class attributes
                            let text = get_node_text(member, source);
                            if !text.contains("(") || text.len() < MAX_CLASS_ATTR_LEN {
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
    // Note: indent is computed in helper functions from depth parameter

    match node.kind() {
        // Keep use statements
        "use_declaration" => {
            output.push_str(&truncate_line(&get_node_text(node, source), MAX_DEF_LINE_LEN));
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
            output.push_str(&summarize_rust_struct(node, source));
            output.push('\n');
        }

        // Enum definitions
        "enum_item" => {
            output.push_str(&summarize_rust_enum(node, source));
            output.push('\n');
        }

        // Type aliases
        "type_item" => {
            output.push_str(&summarize_assignment(&get_node_text(node, source)));
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
            output.push_str(&summarize_assignment(&get_node_text(node, source)));
            output.push('\n');
        }

        // Macro definitions (keep signature)
        "macro_definition" => {
            let text = get_node_text(node, source);
            if let Some(brace_pos) = text.find('{') {
                output.push_str(&truncate_line(text[..brace_pos].trim(), MAX_DEF_LINE_LEN));
                output.push('\n');
            } else {
                output.push_str(&truncate_line(&text, MAX_DEF_LINE_LEN));
                output.push('\n');
            }
        }

        // Attributes (keep them, they're important)
        "attribute_item" | "inner_attribute_item" => {
            output.push_str(&truncate_line(&get_node_text(node, source), MAX_DEF_LINE_LEN));
            output.push('\n');
        }

        // Line/block comments with docs
        "line_comment" | "block_comment" => {
            let text = get_node_text(node, source);
            if let Some(summary) = trim_doc_comment(&text) {
                output.push_str(&summary);
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
                output.push('\n');
                let mut list_cursor = child.walk();
                for item in child.children(&mut list_cursor) {
                    extract_rust_skeleton(output, item, source, depth + 1);
                }
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
        let signature = truncate_line(text[..brace_pos].trim(), MAX_DEF_LINE_LEN);
        output.push_str(&indent);
        output.push_str(&signature);
        output.push('\n');
    } else {
        // No body (trait method signature)
        let signature = truncate_line(&text, MAX_DEF_LINE_LEN);
        output.push_str(&indent);
        output.push_str(&signature);
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
                output.push_str(&truncate_line(&header, MAX_DEF_LINE_LEN));
                output.push('\n');

                let mut list_cursor = child.walk();
                for item in child.children(&mut list_cursor) {
                    match item.kind() {
                        "function_signature_item" | "function_item" => {
                            let text = get_node_text(item, source);
                            output.push_str(&member_indent);
                            if text.contains('{') {
                                if let Some(brace_pos) = text.find('{') {
                                    let signature = truncate_line(text[..brace_pos].trim(), MAX_DEF_LINE_LEN);
                                    output.push_str(&signature);
                                }
                            } else {
                                let signature = truncate_line(&text, MAX_DEF_LINE_LEN);
                                output.push_str(&signature);
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
        let header = truncate_line(text[..brace_pos].trim(), MAX_DEF_LINE_LEN);
        output.push_str(&indent);
        output.push_str(&header);
        output.push('\n');

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
                                let signature = truncate_line(fn_text[..fn_brace].trim(), MAX_DEF_LINE_LEN);
                                output.push_str(&member_indent);
                                output.push_str(&signature);
                                output.push('\n');
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
            output.push_str(&truncate_line(&get_node_text(node, source), MAX_DEF_LINE_LEN));
            output.push('\n');
        }

        // Type declarations
        "type_declaration" => {
            output.push_str(&truncate_line(&get_node_text(node, source), MAX_DEF_LINE_LEN));
            output.push('\n');
        }

        // Function declarations
        "function_declaration" => {
            let text = get_node_text(node, source);
            if let Some(brace_pos) = text.find('{') {
                let signature = truncate_line(text[..brace_pos].trim(), MAX_DEF_LINE_LEN);
                output.push_str(&indent);
                output.push_str(&signature);
                output.push('\n');
            }
        }

        // Method declarations
        "method_declaration" => {
            let text = get_node_text(node, source);
            if let Some(brace_pos) = text.find('{') {
                let signature = truncate_line(text[..brace_pos].trim(), MAX_DEF_LINE_LEN);
                output.push_str(&indent);
                output.push_str(&signature);
                output.push('\n');
            }
        }

        // Const/var declarations
        "const_declaration" | "var_declaration" => {
            output.push_str(&truncate_line(&get_node_text(node, source), MAX_DEF_LINE_LEN));
            output.push('\n');
        }

        // Interface types
        "type_spec" => {
            output.push_str(&truncate_line(&get_node_text(node, source), MAX_DEF_LINE_LEN));
            output.push('\n');
        }

        // Comments
        "comment" => {
            let text = get_node_text(node, source);
            if text.starts_with("//") && text.len() > 3 {
                output.push_str(&truncate_line(&text, MAX_DEF_LINE_LEN));
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

fn is_json_dep_key(key: &str) -> bool {
    JSON_DEP_KEYS.iter().any(|candidate| *candidate == key)
}

fn is_json_script_key(key: &str) -> bool {
    key == JSON_SCRIPT_KEY
}

fn json_string_value(node: Node, source: &[u8]) -> Option<String> {
    if node.kind() != "string" {
        return None;
    }
    let raw = get_node_text(node, source);
    Some(raw.trim_matches('\"').to_string())
}

fn json_primitive_value(node: Node, source: &[u8]) -> Option<String> {
    match node.kind() {
        "string" => json_string_value(node, source).map(|val| {
            let clipped = truncate_line(&val, MAX_JSON_ENTRY_LEN);
            format!("\"{}\"", clipped)
        }),
        "number" | "true" | "false" | "null" => {
            Some(truncate_line(&get_node_text(node, source), MAX_JSON_ENTRY_LEN))
        }
        _ => None,
    }
}

fn json_object_path_value(node: Node, source: &[u8]) -> Option<String> {
    if node.kind() != "object" {
        return None;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() != "pair" {
            continue;
        }
        let (key, value_node) = json_pair_key_value(child, source);
        if key.as_deref() != Some("path") {
            continue;
        }
        let Some(value) = value_node else {
            continue;
        };
        if value.kind() == "string" {
            return json_string_value(value, source);
        }
    }
    None
}

fn json_pair_key_value<'a>(node: Node<'a>, source: &'a [u8]) -> (Option<String>, Option<Node<'a>>) {
    let mut cursor = node.walk();
    let mut key: Option<String> = None;
    let mut value_node: Option<Node> = None;

    for child in node.children(&mut cursor) {
        if !child.is_named() {
            continue;
        }
        if key.is_none() && child.kind() == "string" {
            key = json_string_value(child, source);
            continue;
        }
        if key.is_some() && value_node.is_none() {
            value_node = Some(child);
            break;
        }
    }

    (key, value_node)
}

fn summarize_json_dependency_object(node: Node, source: &[u8]) -> String {
    let mut entries: Vec<String> = Vec::new();
    let mut count = 0;
    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        if child.kind() != "pair" {
            continue;
        }
        count += 1;
        if entries.len() >= MAX_JSON_DEP_ENTRIES {
            continue;
        }
        let (key, value_node) = json_pair_key_value(child, source);
        let Some(name) = key else {
            continue;
        };
        let value = match value_node {
            Some(v) if v.kind() == "string" => json_string_value(v, source).unwrap_or_default(),
            Some(v) if matches!(v.kind(), "number" | "true" | "false" | "null") => {
                get_node_text(v, source).to_string()
            }
            Some(v) => v.kind().to_string(),
            None => String::new(),
        };
        let item = if value.is_empty() {
            name
        } else {
            format!("{}@{}", name, value)
        };
        entries.push(truncate_line(&item, MAX_JSON_ENTRY_LEN));
    }

    if entries.is_empty() {
        return "{}".to_string();
    }

    let mut summary = entries.join(", ");
    if count > entries.len() {
        summary.push_str(&format!(", ... (+{})", count - entries.len()));
    }
    summary
}

fn summarize_json_scripts_object(node: Node, source: &[u8]) -> String {
    let mut entries: Vec<String> = Vec::new();
    let mut count = 0;
    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        if child.kind() != "pair" {
            continue;
        }
        count += 1;
        if entries.len() >= MAX_JSON_SCRIPT_ENTRIES {
            continue;
        }
        let (key, _) = json_pair_key_value(child, source);
        let Some(name) = key else {
            continue;
        };
        entries.push(truncate_line(&name, MAX_JSON_ENTRY_LEN));
    }

    if entries.is_empty() {
        return "{}".to_string();
    }

    let mut summary = entries.join(", ");
    if count > entries.len() {
        summary.push_str(&format!(", ... (+{})", count - entries.len()));
    }
    summary
}

fn summarize_json_array(node: Node, source: &[u8]) -> String {
    let count = node.named_child_count();
    if count == 0 {
        return "[]".to_string();
    }
    if count <= MAX_JSON_INLINE_ARRAY_ITEMS {
        let mut items: Vec<String> = Vec::new();
        let mut object_paths: Vec<String> = Vec::new();
        let mut has_object = false;
        let mut has_non_object = false;
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if !child.is_named() {
                continue;
            }
            if child.kind() == "object" {
                has_object = true;
                if let Some(path) = json_object_path_value(child, source) {
                    let clipped = truncate_line(&path, MAX_JSON_ENTRY_LEN);
                    object_paths.push(format!("\"{}\"", clipped));
                } else {
                    has_non_object = true;
                }
                continue;
            }
            has_non_object = true;
            let Some(value) = json_primitive_value(child, source) else {
                return format!("array[{}]", count);
            };
            items.push(value);
        }
        if has_object && !has_non_object && !object_paths.is_empty() {
            return format!("[{}]", object_paths.join(", "));
        }
        return format!("[{}]", items.join(", "));
    }

    format!("array[{}]", count)
}

fn summarize_large_json(content: &str) -> String {
    let trimmed = content.trim_start();
    if trimmed.starts_with('[') {
        return "array[...]".to_string();
    }

    let mut keys: Vec<String> = Vec::new();
    let mut depth = 0usize;
    let mut in_string = false;
    let mut escape = false;
    let mut chars = content.chars().peekable();

    while let Some(ch) = chars.next() {
        if in_string {
            if escape {
                escape = false;
                continue;
            }
            match ch {
                '\\' => escape = true,
                '"' => in_string = false,
                _ => {}
            }
            continue;
        }

        match ch {
            '{' => depth += 1,
            '}' => {
                if depth > 0 {
                    depth -= 1;
                }
            }
            '"' if depth == 1 => {
                let mut key = String::new();
                let mut key_escape = false;
                while let Some(kch) = chars.next() {
                    if key_escape {
                        key.push(kch);
                        key_escape = false;
                        continue;
                    }
                    match kch {
                        '\\' => key_escape = true,
                        '"' => break,
                        _ => key.push(kch),
                    }
                }

                while let Some(next) = chars.peek() {
                    if next.is_whitespace() {
                        chars.next();
                    } else {
                        break;
                    }
                }

                if let Some(':') = chars.peek().copied() {
                    let mut probe = chars.clone();
                    let mut value_kind = "value";
                    while let Some(next) = probe.next() {
                        if next.is_whitespace() {
                            continue;
                        }
                        value_kind = match next {
                            '{' => "object",
                            '[' => "array",
                            '"' => "string",
                            '-' | '0'..='9' => "number",
                            't' | 'f' => "boolean",
                            'n' => "null",
                            _ => "value",
                        };
                        break;
                    }
                    let key = truncate_line(&key, MAX_JSON_ENTRY_LEN);
                    keys.push(format!("{key}: {value_kind}"));
                    if keys.len() >= MAX_JSON_LARGE_KEYS {
                        break;
                    }
                }
            }
            '"' => in_string = true,
            _ => {}
        }
    }

    if keys.is_empty() {
        return String::new();
    }

    let mut output = keys.join("\n");
    if keys.len() >= MAX_JSON_LARGE_KEYS {
        output.push_str("\n...");
    }
    output
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
            let mut cursor = node.walk();
            let mut count = 0;
            for child in node.children(&mut cursor) {
                if child.kind() == "pair" {
                    if count > 0 {
                        output.push('\n');
                    }
                    extract_json_skeleton(output, child, source, depth + 1);
                    count += 1;
                }
            }
        }
        "pair" => {
            let (key, value_node) = json_pair_key_value(node, source);
            let Some(key) = key else {
                return;
            };

            let line = match value_node {
                Some(value) if is_json_dep_key(&key) && value.kind() == "object" => {
                    let summary = summarize_json_dependency_object(value, source);
                    format!("{}: {}", key, summary)
                }
                Some(value) if is_json_script_key(&key) && value.kind() == "object" => {
                    let summary = summarize_json_scripts_object(value, source);
                    format!("{}: {}", key, summary)
                }
                Some(value) if value.kind() == "string" => {
                    let val = json_string_value(value, source).unwrap_or_default();
                    format!("{}: {}", key, val)
                }
                Some(value) if matches!(value.kind(), "number" | "true" | "false" | "null") => {
                    format!("{}: {}", key, get_node_text(value, source))
                }
                Some(value) if value.kind() == "array" => {
                    format!("{}: {}", key, summarize_json_array(value, source))
                }
                Some(value) if value.kind() == "object" => {
                    format!("{}: object", key)
                }
                Some(value) => format!("{}: {}", key, value.kind()),
                None => format!("{}: unknown", key),
            };

            output.push_str(&indent);
            output.push_str(&truncate_line(&line, MAX_DEF_LINE_LEN));
        }
        "array" => {
            output.push_str(&indent);
            output.push_str(&summarize_json_array(node, source));
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
                            selector = get_node_text(part, source).to_string();
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

                let selector = truncate_line(&selector, MAX_DEF_LINE_LEN);
                output.push_str(&selector);
                output.push_str(&format!(" props={}\n", prop_count));
            }
            "media_statement" | "keyframes_statement" | "import_statement" => {
                output.push_str(&truncate_line(&get_node_text(child, source), MAX_DEF_LINE_LEN));
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
                                tag_name = get_node_text(part, source).to_string();
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

struct JsInsightList {
    entries: Vec<String>,
    truncated: bool,
    visited: usize,
}

fn emit_js_ts_insights(
    output: &mut String,
    node: Node,
    source: &[u8],
    indent: &str,
    external_imports: Option<&HashSet<String>>,
) {
    if !ENABLE_JS_TS_INSIGHTS {
        return;
    }
    let invokes = collect_js_invokes(node, source);
    if !invokes.entries.is_empty() {
        output.push_str(indent);
        output.push_str("// Invokes: ");
        output.push_str(&invokes.entries.join(", "));
        if invokes.truncated {
            output.push_str(", ...");
        }
        output.push('\n');
    }

    let mut components = collect_jsx_components(node, source);
    if let Some(external) = external_imports {
        components.entries.retain(|entry| !external.contains(entry));
    }
    if !components.entries.is_empty() {
        output.push_str(indent);
        output.push_str("// Renders: ");
        output.push_str(&components.entries.join(", "));
        if components.truncated {
            output.push_str(", ...");
        }
        output.push('\n');
    }
}

fn add_unique_entry(entries: &mut Vec<String>, value: String, cap: usize) -> bool {
    if entries.iter().any(|entry| entry == &value) {
        return false;
    }
    if entries.len() < cap {
        entries.push(value);
        return true;
    }
    false
}

fn collect_js_invokes(node: Node, source: &[u8]) -> JsInsightList {
    let mut list = JsInsightList {
        entries: Vec::new(),
        truncated: false,
        visited: 0,
    };
    collect_js_invokes_rec(node, source, &mut list);
    list
}

fn collect_js_invokes_rec(node: Node, source: &[u8], list: &mut JsInsightList) {
    if list.truncated {
        return;
    }
    list.visited += 1;
    if list.visited > MAX_JS_INSIGHT_NODES {
        list.truncated = true;
        return;
    }
    if let Some(name) = js_invoke_name(node, source) {
        add_unique_entry(&mut list.entries, name, MAX_JS_INVOKES);
        if list.entries.len() >= MAX_JS_INVOKES {
            list.truncated = true;
            return;
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_js_invokes_rec(child, source, list);
        if list.truncated {
            break;
        }
    }
}

fn js_invoke_name(node: Node, source: &[u8]) -> Option<String> {
    if node.kind() != "call_expression" {
        return None;
    }
    let callee = node.child_by_field_name("function")?;
    if !js_callee_is_invoke(callee, source) {
        return None;
    }
    let args = node.child_by_field_name("arguments")?;
    let mut cursor = args.walk();
    for child in args.children(&mut cursor) {
        if !child.is_named() {
            continue;
        }
        return js_string_literal(child, source)
            .map(|name| truncate_line(&name, MAX_JS_INSIGHT_NAME_LEN));
    }
    None
}

fn js_callee_is_invoke(node: Node, source: &[u8]) -> bool {
    match node.kind() {
        "identifier" => get_node_text(node, source) == "invoke",
        "member_expression" => {
            if let Some(name) = js_member_expression_property_name(node, source) {
                return name == "invoke";
            }
            false
        }
        _ => false,
    }
}

fn js_member_expression_property_name(node: Node, source: &[u8]) -> Option<String> {
    if let Some(property) = node.child_by_field_name("property") {
        return Some(get_node_text(property, source).to_string());
    }
    let mut cursor = node.walk();
    let mut last_named = None;
    for child in node.children(&mut cursor) {
        if child.is_named() {
            last_named = Some(child);
        }
    }
    last_named.map(|child| get_node_text(child, source).to_string())
}

fn collect_js_ts_external_imports(root: Node, source: &[u8]) -> HashSet<String> {
    let mut names = HashSet::new();
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        if !matches!(child.kind(), "import_statement" | "import_declaration") {
            continue;
        }
        let Some(source_node) = child.child_by_field_name("source") else {
            continue;
        };
        let Some(specifier) = js_string_literal(source_node, source) else {
            continue;
        };
        if specifier.starts_with("./") || specifier.starts_with("../") {
            continue;
        }
        collect_imported_names(child, source, &mut names);
    }
    names
}

fn collect_imported_names(node: Node, source: &[u8], names: &mut HashSet<String>) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "import_specifier" => {
                if let Some(name) = child
                    .child_by_field_name("name")
                    .or_else(|| child.child_by_field_name("local"))
                {
                    let name = get_node_text(name, source);
                    if is_jsx_component_name(name) {
                        names.insert(name.to_string());
                    }
                }
            }
            "import_clause" | "named_imports" | "namespace_import" => {
                collect_imported_names(child, source, names);
            }
            "identifier" => {
                let name = get_node_text(child, source);
                if is_jsx_component_name(name) {
                    names.insert(name.to_string());
                }
            }
            _ => {}
        }
    }
}

fn js_string_literal(node: Node, source: &[u8]) -> Option<String> {
    let raw = get_node_text(node, source);
    if raw.contains("${") {
        return None;
    }
    strip_js_string_quotes(&raw)
}

fn strip_js_string_quotes(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.len() < 2 {
        return None;
    }
    let first = trimmed.chars().next().unwrap();
    let last = trimmed.chars().last().unwrap();
    if (first == '"' && last == '"') || (first == '\'' && last == '\'') || (first == '`' && last == '`') {
        return Some(trimmed[1..trimmed.len() - 1].to_string());
    }
    None
}

fn collect_jsx_components(node: Node, source: &[u8]) -> JsInsightList {
    let mut list = JsInsightList {
        entries: Vec::new(),
        truncated: false,
        visited: 0,
    };
    collect_jsx_components_rec(node, source, &mut list);
    list
}

fn collect_jsx_components_rec(node: Node, source: &[u8], list: &mut JsInsightList) {
    if list.truncated {
        return;
    }
    list.visited += 1;
    if list.visited > MAX_JS_INSIGHT_NODES {
        list.truncated = true;
        return;
    }
    if matches!(node.kind(), "jsx_opening_element" | "jsx_self_closing_element") {
        if let Some(name) = jsx_tag_name(node, source) {
            if is_jsx_component_name(&name) {
                add_unique_entry(&mut list.entries, name, MAX_JSX_COMPONENTS);
                if list.entries.len() >= MAX_JSX_COMPONENTS {
                    list.truncated = true;
                    return;
                }
            }
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_jsx_components_rec(child, source, list);
        if list.truncated {
            break;
        }
    }
}

fn jsx_tag_name(node: Node, source: &[u8]) -> Option<String> {
    if let Some(name_node) = node.child_by_field_name("name") {
        return Some(truncate_line(
            &get_node_text(name_node, source),
            MAX_JS_INSIGHT_NAME_LEN,
        ));
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if matches!(
            child.kind(),
            "jsx_identifier" | "identifier" | "jsx_member_expression" | "jsx_namespace_name"
        ) {
            return Some(truncate_line(
                &get_node_text(child, source),
                MAX_JS_INSIGHT_NAME_LEN,
            ));
        }
    }
    None
}

fn is_jsx_component_name(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return false;
    }
    for part in trimmed.split(|ch| ch == '.' || ch == ':') {
        if let Some(ch) = part.chars().next() {
            if ch.is_uppercase() {
                return true;
            }
        }
    }
    false
}

fn collect_js_ts_exports<'a>(root: Node<'a>, source: &'a [u8]) -> JsTsExports {
    let mut exports = JsTsExports {
        has_exports: false,
        names: HashSet::new(),
    };
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        if matches!(
            child.kind(),
            "export_statement"
                | "export_declaration"
                | "export_default_declaration"
                | "export_assignment"
        ) {
            exports.has_exports = true;
            collect_js_ts_export_names(child, source, &mut exports.names);
        }
    }
    exports
}

fn collect_js_ts_export_names<'a>(node: Node<'a>, source: &'a [u8], names: &mut HashSet<String>) {
    if node.kind() == "export_default_declaration" {
        if let Some(name) = js_export_default_name(node, source) {
            names.insert(name);
        }
        return;
    }

    let has_source = node.child_by_field_name("source").is_some();
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "function_declaration"
            | "class_declaration"
            | "abstract_class_declaration"
            | "interface_declaration"
            | "enum_declaration"
            | "type_alias_declaration" => {
                if let Some(name) = js_declared_name(child, source) {
                    names.insert(name);
                }
            }
            "lexical_declaration" | "variable_declaration" => {
                for name in js_variable_declared_names(child, source) {
                    names.insert(name);
                }
            }
            "export_clause" => {
                if !has_source {
                    collect_export_clause_names(child, source, names);
                }
            }
            "export_specifier" => {
                if !has_source {
                    if let Some(name) = export_specifier_local_name(child, source) {
                        names.insert(name);
                    }
                }
            }
            _ => {}
        }
    }
}

fn js_export_default_name(node: Node, source: &[u8]) -> Option<String> {
    if let Some(decl) = node.child_by_field_name("declaration") {
        if decl.kind() == "identifier" {
            return Some(get_node_text(decl, source).to_string());
        }
        if let Some(name) = js_declared_name(decl, source) {
            return Some(name);
        }
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if matches!(child.kind(), "identifier" | "property_identifier" | "type_identifier") {
            return Some(get_node_text(child, source).to_string());
        }
    }
    None
}

fn collect_export_clause_names(node: Node, source: &[u8], names: &mut HashSet<String>) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "export_specifier" {
            if let Some(name) = export_specifier_local_name(child, source) {
                names.insert(name);
            }
        }
    }
}

fn export_specifier_local_name(node: Node, source: &[u8]) -> Option<String> {
    if let Some(name) = node.child_by_field_name("name") {
        return Some(get_node_text(name, source).to_string());
    }
    if let Some(local) = node.child_by_field_name("local") {
        return Some(get_node_text(local, source).to_string());
    }
    if node.child_by_field_name("alias").is_some() {
        return None;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if matches!(child.kind(), "identifier" | "property_identifier" | "type_identifier") {
            return Some(get_node_text(child, source).to_string());
        }
    }
    None
}

fn js_variable_declared_names(node: Node, source: &[u8]) -> Vec<String> {
    let mut names = Vec::new();
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "variable_declarator" {
            names.extend(js_declarator_binding_names(child, source));
        }
    }
    names
}

fn js_member_is_private(member: Node, source: &[u8]) -> bool {
    let mut cursor = member.walk();
    for child in member.children(&mut cursor) {
        match child.kind() {
            "private_property_identifier" => return true,
            "accessibility_modifier" => {
                if get_node_text(child, source) == "private" {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn summarize_ts_declaration(node: Node, source: &[u8]) -> String {
    let text = get_node_text(node, source);
    match node.kind() {
        "type_alias_declaration" => summarize_type_alias(&text),
        "interface_declaration" | "enum_declaration" => summarize_block_declaration(&text),
        _ => truncate_line(&text, MAX_DEF_LINE_LEN),
    }
}

fn compact_text_prefix(text: &str, max_chars: usize) -> (String, bool) {
    let mut out = String::new();
    let mut count = 0;
    for ch in text.chars() {
        if count >= max_chars {
            return (out, true);
        }
        let normalized = if ch == '\n' || ch == '\r' { ' ' } else { ch };
        out.push(normalized);
        count += 1;
    }
    (out, false)
}

fn summarize_type_alias(text: &str) -> String {
    let (compact, truncated) = compact_text_prefix(text, MAX_SIMPLE_CONST_LEN + 1);
    let trimmed = compact.trim_end();
    if !truncated && trimmed.len() <= MAX_SIMPLE_CONST_LEN {
        return truncate_line(trimmed, MAX_DEF_LINE_LEN);
    }
    if let Some(eq_pos) = trimmed.find('=') {
        let header = trimmed[..eq_pos].trim_end();
        return truncate_line(&format!("{header} = ..."), MAX_DEF_LINE_LEN);
    }
    if truncated {
        return truncate_line(&format!("{trimmed}..."), MAX_DEF_LINE_LEN);
    }
    truncate_line(trimmed, MAX_DEF_LINE_LEN)
}

fn summarize_block_declaration(text: &str) -> String {
    let (compact, truncated) = compact_text_prefix(text, MAX_SIMPLE_CONST_LEN + 1);
    let trimmed = compact.trim_end();
    if !truncated && trimmed.len() <= MAX_SIMPLE_CONST_LEN {
        return truncate_line(trimmed, MAX_DEF_LINE_LEN);
    }
    if let Some(brace_pos) = trimmed.find('{') {
        let header = trimmed[..brace_pos].trim_end();
        return truncate_line(&format!("{header} {{...}}"), MAX_DEF_LINE_LEN);
    }
    if truncated {
        return truncate_line(&format!("{trimmed}..."), MAX_DEF_LINE_LEN);
    }
    truncate_line(trimmed, MAX_DEF_LINE_LEN)
}

fn summarize_js_variable_declaration(node: Node, source: &[u8]) -> String {
    summarize_assignment(&get_node_text(node, source))
}

fn summarize_js_property_definition(node: Node, source: &[u8]) -> String {
    summarize_assignment(&get_node_text(node, source))
}

fn summarize_assignment(text: &str) -> String {
    let (compact, truncated) = compact_text_prefix(text, MAX_SIMPLE_CONST_LEN + 1);
    let trimmed = compact.trim_end();
    if !truncated && trimmed.len() <= MAX_SIMPLE_CONST_LEN {
        return truncate_line(trimmed, MAX_DEF_LINE_LEN);
    }
    if let Some(eq_pos) = trimmed.find('=') {
        let header = trimmed[..eq_pos].trim_end();
        return truncate_line(&format!("{header} = ..."), MAX_DEF_LINE_LEN);
    }
    if truncated {
        return truncate_line(&format!("{trimmed}..."), MAX_DEF_LINE_LEN);
    }
    truncate_line(trimmed, MAX_DEF_LINE_LEN)
}

fn summarize_rust_struct(node: Node, source: &[u8]) -> String {
    let text = get_node_text(node, source);
    if let Some(brace_pos) = text.find('{') {
        let header = text[..brace_pos].trim_end();
        let (names, truncated) = rust_collect_struct_fields(node, source);
        let mut body = if names.is_empty() {
            "...".to_string()
        } else {
            let mut joined = names.join(", ");
            if truncated {
                joined.push_str(", ...");
            }
            joined
        };
        body = truncate_line(&body, MAX_DEF_LINE_LEN);
        return truncate_line(&format!("{header} {{ {body} }}"), MAX_DEF_LINE_LEN);
    }
    if let Some(paren_pos) = text.find('(') {
        let header = text[..paren_pos].trim_end();
        return truncate_line(&format!("{header} (...)"), MAX_DEF_LINE_LEN);
    }
    truncate_line(&text, MAX_DEF_LINE_LEN)
}

fn summarize_rust_enum(node: Node, source: &[u8]) -> String {
    let text = get_node_text(node, source);
    if let Some(brace_pos) = text.find('{') {
        let header = text[..brace_pos].trim_end();
        let (names, truncated) = rust_collect_enum_variants(node, source);
        let mut body = if names.is_empty() {
            "...".to_string()
        } else {
            let mut joined = names.join(", ");
            if truncated {
                joined.push_str(", ...");
            }
            joined
        };
        body = truncate_line(&body, MAX_DEF_LINE_LEN);
        return truncate_line(&format!("{header} {{ {body} }}"), MAX_DEF_LINE_LEN);
    }
    truncate_line(&text, MAX_DEF_LINE_LEN)
}

fn rust_collect_struct_fields(node: Node, source: &[u8]) -> (Vec<String>, bool) {
    let mut names = Vec::new();
    let mut total = 0;
    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        if child.kind() == "field_declaration_list" {
            let mut list_cursor = child.walk();
            for field in child.children(&mut list_cursor) {
                if field.kind() != "field_declaration" {
                    continue;
                }
                total += 1;
                let mut field_cursor = field.walk();
                let mut name = None;
                for fchild in field.children(&mut field_cursor) {
                    if fchild.kind() == "identifier" {
                        name = Some(get_node_text(fchild, source).to_string());
                        break;
                    }
                }
                if names.len() < MAX_MEMBER_NAMES {
                    if let Some(name) = name {
                        names.push(name);
                    }
                }
            }
        }
    }

    let truncated = total > names.len();
    (names, truncated)
}

fn rust_collect_enum_variants(node: Node, source: &[u8]) -> (Vec<String>, bool) {
    let mut names = Vec::new();
    let mut total = 0;
    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        if child.kind() == "enum_variant_list" {
            let mut list_cursor = child.walk();
            for variant in child.children(&mut list_cursor) {
                if variant.kind() != "enum_variant" {
                    continue;
                }
                total += 1;
                let mut var_cursor = variant.walk();
                for vchild in variant.children(&mut var_cursor) {
                    if vchild.kind() == "identifier" && names.len() < MAX_MEMBER_NAMES {
                        names.push(get_node_text(vchild, source).to_string());
                        break;
                    }
                }
            }
        }
    }

    let truncated = total > names.len();
    (names, truncated)
}

fn trim_doc_comment(text: &str) -> Option<String> {
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

fn trim_docstring(text: &str) -> Option<String> {
    let trimmed = text.trim();
    let (quote, inner) = if trimmed.starts_with("\"\"\"") && trimmed.ends_with("\"\"\"") {
        ("\"\"\"", trimmed.trim_start_matches("\"\"\"").trim_end_matches("\"\"\""))
    } else if trimmed.starts_with("'''") && trimmed.ends_with("'''") {
        ("'''", trimmed.trim_start_matches("'''").trim_end_matches("'''"))
    } else if trimmed.starts_with('"') && trimmed.ends_with('"') {
        ("\"", trimmed.trim_matches('"'))
    } else if trimmed.starts_with('\'') && trimmed.ends_with('\'') {
        ("'", trimmed.trim_matches('\''))
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

fn truncate_line(line: &str, max_len: usize) -> String {
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

fn cap_skeleton_output(skeleton: &str, lang: Option<SupportedLanguage>) -> String {
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
        result.push_str(truncation_comment(lang));
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

fn truncation_comment(lang: Option<SupportedLanguage>) -> &'static str {
    match lang {
        Some(SupportedLanguage::Python) => "# ...",
        Some(SupportedLanguage::Html) => "<!-- ... -->",
        Some(SupportedLanguage::Css) => "/* ... */",
        _ => "// ...",
    }
}

/// Fallback compression for unsupported languages
pub fn fallback_compress(content: &str, extension: &str) -> String {
    let ext = extension.to_lowercase();
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

        // Skip empty lines (but keep one after some output)
        if trimmed.is_empty() {
            if has_output && !prev_empty {
                output.push(String::new());
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
            trimmed == "end" ||
            // Comments that look like docs
            trimmed.starts_with("///") ||
            trimmed.starts_with("//!") ||
            trimmed.starts_with("/**") ||
            trimmed.starts_with("* ") ||    
            (trimmed.starts_with("#") && !trimmed.starts_with("# ")) ||
            (is_config && is_config_line(trimmed)) ||
            (is_markdown && (trimmed.starts_with('#') ||
                trimmed.starts_with("```") ||
                trimmed.starts_with("- ") ||
                trimmed.starts_with("* ")));
        if is_structural {
            output.push(truncate_line(line, MAX_FALLBACK_LINE_LEN));
            has_output = true;
        }
    }

    output.join("\n")
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

/// Get text content of a tree-sitter node
fn get_node_text<'a>(node: Node, source: &'a [u8]) -> &'a str {
    let start = node.start_byte();
    let end = node.end_byte();
    let slice = source.get(start..end).unwrap_or(&[]);
    match std::str::from_utf8(slice) {
        Ok(text) => text.trim_end_matches(|ch| ch == '\n' || ch == '\r'),
        Err(_) => "",
    }
}

fn extract_jsx_return(node: Node, source: &[u8], indent: &str) -> Option<String> {
    // Check immediate body (for arrow functions like `() => <div />`)
    if let Some(body) = node.child_by_field_name("body") {
        if matches!(
            body.kind(),
            "jsx_element" | "jsx_self_closing_element" | "jsx_fragment"
        ) {
            return Some(format!(
                "{}// Returns: {}",
                indent,
                summarize_jsx(body, source)
            ));
        }
        // Handle `() => (<div />)`
        if body.kind() == "parenthesized_expression" {
            let mut inner_cursor = body.walk();
            for child in body.children(&mut inner_cursor) {
                if matches!(
                    child.kind(),
                    "jsx_element" | "jsx_self_closing_element" | "jsx_fragment"
                ) {
                    return Some(format!(
                        "{}// Returns: {}",
                        indent,
                        summarize_jsx(child, source)
                    ));
                }
            }
        }
        // Handle block body `{ return ... }`
        if body.kind() == "statement_block" {
            let mut block_cursor = body.walk();
            for child in body.children(&mut block_cursor) {
                if child.kind() == "return_statement" {
                    let mut ret_cursor = child.walk();
                    for ret_child in child.children(&mut ret_cursor) {
                        if ret_child.kind() == "return" {
                            continue;
                        }
                        if ret_child.kind() == "parenthesized_expression" {
                            let mut inner_cursor = ret_child.walk();
                            for inner in ret_child.children(&mut inner_cursor) {
                                if matches!(
                                    inner.kind(),
                                    "jsx_element" | "jsx_self_closing_element" | "jsx_fragment"
                                ) {
                                    return Some(format!(
                                        "{}// Returns: {}",
                                        indent,
                                        summarize_jsx(inner, source)
                                    ));
                                }
                            }
                        } else if matches!(
                            ret_child.kind(),
                            "jsx_element" | "jsx_self_closing_element" | "jsx_fragment"
                        ) {
                            return Some(format!(
                                "{}// Returns: {}",
                                indent,
                                summarize_jsx(ret_child, source)
                            ));
                        }
                    }
                }
            }
        }
    }
    None
}

fn summarize_jsx(node: Node, source: &[u8]) -> String {
    // Just get the tag name for now. e.g. <div ... /> or <Component ...>
    // For fragments: <>
    match node.kind() {
        "jsx_fragment" => "<>...</>".to_string(),
        "jsx_element" => {
            if let Some(open) = node.child_by_field_name("open_tag") {
                if let Some(name) = open.child_by_field_name("name") {
                    return format!("<{} ... />", get_node_text(name, source));
                }
            }
            "<...>".to_string()
        }
        "jsx_self_closing_element" => {
            if let Some(name) = node.child_by_field_name("name") {
                return format!("<{} ... />", get_node_text(name, source));
            }
            "<...>".to_string()
        }
        _ => "<...>".to_string(),
    }
}

