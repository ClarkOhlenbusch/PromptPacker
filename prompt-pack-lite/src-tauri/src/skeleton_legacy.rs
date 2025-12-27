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
const MAX_JSX_PROP_NAMES: usize = 6;
const MAX_JS_INSIGHT_NAME_LEN: usize = 40;
const MAX_JS_INSIGHT_NODES: usize = 4000;
const MAX_JSX_RETURN_NODES: usize = 2000;
const MAX_JS_HOOKS: usize = 12;
const MAX_JS_EFFECTS: usize = 6;
const MAX_JS_FLOW_STEPS: usize = 6;
const MAX_JS_BOUNDARY_CALLS: usize = 8;
const MAX_JS_TIMER_CALLS: usize = 6;
const MAX_JS_PROTOCOL_STRINGS: usize = 8;
const MAX_JS_HOOK_INIT_LEN: usize = 28;
const MAX_CALL_EDGE_NAMES: usize = 6;
const MAX_CALL_EDGE_NAME_LEN: usize = 40;
const MAX_CALL_EDGE_NODES: usize = 3000;
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
    external_imports: Option<&'a HashSet<String>>, // Keeps components for filtering
    external_bindings: Option<&'a HashSet<String>>,
    entrypoint_mode: bool,
}

#[derive(Clone, Copy)]
struct PythonContext<'a> {
    external_bindings: Option<&'a HashSet<String>>,
    is_nested: bool,
}

struct JsTsExports {
    has_exports: bool,
    names: HashSet<String>,
}

struct JsTsExternalImports {
    modules: HashSet<String>,
    components: HashSet<String>,
    bindings: HashSet<String>,
}

struct CallEdgeList {
    entries: Vec<String>,
    truncated: bool,
    visited: usize,
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

/// Skeletonize with optional source path for entrypoint heuristics
pub fn skeletonize_with_path(
    content: &str,
    extension: &str,
    file_path: Option<&str>,
) -> SkeletonResult {
    let original_lines = content.lines().count();

    let language = SupportedLanguage::from_extension(extension);

    let mut skeleton = match language {
        Some(lang) => {
            match extract_skeleton(content, lang, file_path) {
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
fn extract_skeleton(
    content: &str,
    lang: SupportedLanguage,
    file_path: Option<&str>,
) -> Result<String, String> {
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
        SupportedLanguage::TypeScript
        | SupportedLanguage::TypeScriptTsx
        | SupportedLanguage::JavaScript
        | SupportedLanguage::JavaScriptJsx => {
            let exports = collect_js_ts_exports(root, source);
            let external_imports = collect_js_ts_external_imports(root, source);
            let entrypoint_mode = js_ts_is_entrypoint(root, source, file_path, lang);
            let ctx = JsTsContext {
                has_exports: exports.has_exports,
                in_export: false,
                exported_names: if exports.names.is_empty() {
                    None
                } else {
                    Some(&exports.names)
                },
                external_imports: if external_imports.components.is_empty() {
                    None
                } else {
                    Some(&external_imports.components)
                },
                external_bindings: if external_imports.bindings.is_empty() {
                    None
                } else {
                    Some(&external_imports.bindings)
                },
                entrypoint_mode,
            };
            if !external_imports.modules.is_empty() {
                let mut sorted: Vec<_> = external_imports.modules.iter().collect();
                sorted.sort();
                for ext in sorted {
                    output.push_str(&format!("// External: {}\n", ext));
                }
            }
            extract_js_ts_skeleton(&mut output, root, source, 0, ctx);
        }
        SupportedLanguage::Python => {
            let external_bindings = collect_python_imports(root, source);
            let ctx = PythonContext {
                external_bindings: if external_bindings.is_empty() {
                    None
                } else {
                    Some(&external_bindings)
                },
                is_nested: false,
            };
            extract_python_skeleton(&mut output, root, source, 0, ctx);
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
    let skip_non_export = ctx.has_exports
        && ctx.exported_names.is_some()
        && !ctx.in_export
        && depth == 0
        && !ctx.entrypoint_mode;

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
            emit_js_function_details(output, node, source, &indent, ctx);
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
                emit_js_function_details(output, node, source, &indent, ctx);
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
            } else if depth == 0 && !skip_non_export {
                // Keep top-level function calls (for scripts/extensions).
                if let Some(summary) = summarize_top_level_call(node, source) {
                    output.push_str(&indent);
                    output.push_str(&summary);
                    output.push('\n');
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
            emit_js_function_details(output, func_node, source, indent, ctx);
            emitted = true;
            continue;
        }

        if let Some(summary) = summarize_js_variable_declarator(child, source, keyword) {
            output.push_str(indent);
            output.push_str(export_prefix);
            output.push_str(&summary);
            output.push('\n');
            emit_js_ts_insights(
                output,
                child,
                source,
                indent,
                ctx.external_imports,
                ctx.external_bindings,
                true,
            );
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
                            // Check if the value is a class expression
                            let mut class_node = None;
                            let mut cursor = member.walk();
                            for child in member.children(&mut cursor) {
                                if matches!(child.kind(), "class_expression" | "class") {
                                    class_node = Some(child);
                                    break;
                                }
                            }
                            if let Some(class_node) = class_node {
                                output.push_str(&member_indent);
                                output.push_str(&summarize_js_property_definition(member, source));
                                output.push('\n');
                                extract_js_class_skeleton(output, class_node, source, depth + 1);
                            } else {
                                output.push_str(&member_indent);
                                output.push_str(&summarize_js_property_definition(member, source));
                                output.push('\n');
                            }
                        }
                        "method_definition" | "method_signature" => {
                            if let Some(sig) = extract_js_method_signature(member, source) {
                                output.push_str(&member_indent);
                                output.push_str(&sig);
                                output.push('\n');
                            }
                        }
                        "class_declaration" => {
                            extract_js_class_skeleton(output, member, source, depth + 1);
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
fn extract_python_skeleton(
    output: &mut String,
    node: Node,
    source: &[u8],
    depth: usize,
    ctx: PythonContext,
) {
    let indent = "    ".repeat(depth);

    match node.kind() {
        // Keep imports
        "import_statement" | "import_from_statement" => {
            if !ctx.is_nested {
                output.push_str(&truncate_line(&get_node_text(node, source), MAX_DEF_LINE_LEN));
                output.push('\n');
            }
        }

        // Function definitions
        "function_definition" => {
            extract_python_function_skeleton(output, node, source, depth, ctx);
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
                        extract_python_function_skeleton(output, child, source, depth, ctx);
                    }
                    "class_definition" => {
                        extract_python_class_skeleton(output, child, source, depth, ctx);
                    }
                    _ => {}
                }
            }
        }

        // Class definitions
        "class_definition" => {
            extract_python_class_skeleton(output, node, source, depth, ctx);
        }

        // Top-level assignments (constants, type aliases) or docstrings
        "assignment" | "expression_statement" => {
            let text = get_node_text(node, source);
            if node.kind() == "expression_statement" {
                if let Some(summary) = trim_docstring(&text) {
                    output.push_str(&indent);
                    output.push_str(&summary);
                    output.push('\n');
                    return;
                }
            }

            if is_simple_python_assignment(node, source, MAX_SIMPLE_ASSIGNMENT_LEN) {
                output.push_str(&indent);
                output.push_str(&text);
                output.push('\n');
            }
        }

        // Type alias (Python 3.12+)
        "type_alias_statement" => {
            if !ctx.is_nested {
                output.push_str(&indent);
                output.push_str(&get_node_text(node, source));
                output.push('\n');
            }
        }

        // Comments
        "comment" => {
            let text = get_node_text(node, source);
            // Keep important comments
            if text.starts_with("# type:") || text.starts_with("# noqa") ||
               text.starts_with("# TODO") || text.starts_with("# FIXME") {
                output.push_str(&indent);
                output.push_str(&truncate_line(&text, MAX_DEF_LINE_LEN));
                output.push('\n');
            }
        }

        // Root module
        "module" => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                extract_python_skeleton(output, child, source, depth, ctx);
            }
        }

        _ => {}
    }
}

fn is_simple_python_assignment(node: Node, source: &[u8], max_len: usize) -> bool {
    let text = get_node_text(node, source);
    if text.contains(":") {
        return true; // Keep type annotations
    }
    // Keep short assignments that don't look like complex logic (no parens usually)
    !text.contains("(") && text.len() < max_len
}

/// Extract Python function skeleton
fn extract_python_function_skeleton(
    output: &mut String,
    node: Node,
    source: &[u8],
    depth: usize,
    ctx: PythonContext,
) {
    let indent = "    ".repeat(depth);
    let body_indent = "    ".repeat(depth + 1);

    let mut cursor = node.walk();
    let mut signature = String::new();
    let mut docstring = None;
    let mut body_node = None;

    for child in node.children(&mut cursor) {
        match child.kind() {
            "async" => signature.push_str("async "),
            "def" => signature.push_str("def "),
            "identifier" | "name" => {
                if signature.ends_with("def ") {
                    signature.push_str(&get_node_text(child, source));
                }
            }
            "parameters" | "lambda_parameters" => {
                signature.push_str(&get_node_text(child, source));
            }
            "type" => {
                signature.push_str(" -> ");
                signature.push_str(&get_node_text(child, source));
            }
            "block" => {
                body_node = Some(child);
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

    if let Some(body) = body_node {
        emit_python_call_edges(output, body, source, &body_indent, ctx.external_bindings);

        // Recurse into body to find nested definitions
        let mut nested_ctx = ctx;
        nested_ctx.is_nested = true;
        let mut body_cursor = body.walk();
        for child in body.children(&mut body_cursor) {
            match child.kind() {
                "function_definition" | "class_definition" | "decorated_definition" => {
                    extract_python_skeleton(output, child, source, depth + 1, nested_ctx);
                }
                _ => {}
            }
        }
    }

    output.push_str(&body_indent);
    output.push_str("...\n");
}

fn emit_python_call_edges(
    output: &mut String,
    node: Node,
    source: &[u8],
    indent: &str,
    external_bindings: Option<&HashSet<String>>,
) {
    let calls = collect_python_calls(node, source, external_bindings);
    if calls.entries.is_empty() {
        return;
    }

    // Prioritize and Filter
    let mut prioritized = Vec::new();
    let mut local = Vec::new();

    for name in &calls.entries {
        let is_external = external_bindings.map_or(false, |eb| {
            let root = name.split('.').next().unwrap_or(name);
            eb.contains(root)
        });

        if is_external {
            if prioritized.len() < MAX_CALL_EDGE_NAMES {
                prioritized.push(name.clone());
            }
        } else {
            local.push(name.clone());
        }
    }

    // Fill remaining slots with local calls
    for name in local {
        if prioritized.len() >= MAX_CALL_EDGE_NAMES {
            break;
        }
        prioritized.push(name);
    }

    output.push_str(indent);
    output.push_str("# Calls: ");
    output.push_str(&prioritized.join(", "));
    if calls.truncated || calls.entries.len() > prioritized.len() {
        output.push_str(", ...");
    }
    output.push('\n');
}

fn collect_python_calls(
    node: Node,
    source: &[u8],
    external_bindings: Option<&HashSet<String>>,
) -> CallEdgeList {
    let mut list = CallEdgeList {
        entries: Vec::new(),
        truncated: false,
        visited: 0,
    };
    collect_python_calls_rec(node, source, &mut list, external_bindings);
    list
}

fn collect_python_calls_rec(
    node: Node,
    source: &[u8],
    list: &mut CallEdgeList,
    external_bindings: Option<&HashSet<String>>,
) {
    if list.truncated {
        return;
    }
    list.visited += 1;
    if list.visited > MAX_CALL_EDGE_NODES {
        list.truncated = true;
        return;
    }
    if let Some(name) = python_call_name(node, source) {
        if !list.entries.contains(&name) {
            // We'll collect and prioritize in emit_python_call_edges or similar,
            // but for now let's just push them all and we'll handle the "best" ones later.
            // Actually, to avoid blooming the list too much, we'll cap it at 2x the display limit.
            if list.entries.len() < MAX_CALL_EDGE_NAMES * 2 {
                list.entries.push(name);
            } else {
                list.truncated = true;
            }
        }

        if list.entries.len() >= MAX_CALL_EDGE_NAMES {
            // Don't truncate immediately if we might find more external calls,
            // but for simplicity we'll follow the same pattern as JS
            // No, let's keep searching for a bit if we haven't hit visited limit
        }
    }
    if python_is_scope_boundary(node.kind()) {
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_python_calls_rec(child, source, list, external_bindings);
        if list.truncated {
            break;
        }
    }
}

fn python_call_name(node: Node, source: &[u8]) -> Option<String> {
    if node.kind() != "call" {
        return None;
    }
    let func = node
        .child_by_field_name("function")
        .or_else(|| node.child(0))?;
    let (compact, _) = compact_text_prefix(get_node_text(func, source), MAX_CALL_EDGE_NAME_LEN);
    let name = compact.trim();
    if name.is_empty() {
        return None;
    }
    Some(truncate_line(name, MAX_CALL_EDGE_NAME_LEN))
}

fn python_is_scope_boundary(kind: &str) -> bool {
    matches!(kind, "function_definition" | "class_definition" | "lambda")
}

/// Extract Python class skeleton
fn extract_python_class_skeleton(
    output: &mut String,
    node: Node,
    source: &[u8],
    depth: usize,
    ctx: PythonContext,
) {
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
                            extract_python_function_skeleton(output, member, source, depth + 1, ctx);
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
                                        extract_python_function_skeleton(output, dec_child, source, depth + 1, ctx);
                                    }
                                    "class_definition" => {
                                        extract_python_class_skeleton(output, dec_child, source, depth + 1, ctx);
                                    }
                                    _ => {}
                                }
                            }
                        }
                        "expression_statement" | "assignment" => {
                            let text = get_node_text(member, source);
                            if member.kind() == "expression_statement" {
                                if let Some(summary) = trim_docstring(&text) {
                                    output.push_str(&member_indent);
                                    output.push_str(&summary);
                                    output.push('\n');
                                    continue;
                                }
                            }

                            if is_simple_python_assignment(member, source, MAX_CLASS_ATTR_LEN) {
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

fn collect_python_imports(root: Node, source: &[u8]) -> HashSet<String> {
    let mut names = HashSet::new();
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        match child.kind() {
            "import_statement" => {
                // import os, sys
                let mut sub_cursor = child.walk();
                for sub_child in child.children(&mut sub_cursor) {
                    if sub_child.kind() == "dotted_name" {
                        // For 'import os.path', we want 'os' as the binding root
                        let text = get_node_text(sub_child, source);
                        let root_part = text.split('.').next().unwrap_or(&text);
                        names.insert(root_part.to_string());
                    } else if sub_child.kind() == "aliased_import" {
                        if let Some(alias) = sub_child.child_by_field_name("alias") {
                            names.insert(get_node_text(alias, source).to_string());
                        } else if let Some(name) = sub_child.child_by_field_name("name") {
                            let text = get_node_text(name, source);
                            let root_part = text.split('.').next().unwrap_or(&text);
                            names.insert(root_part.to_string());
                        }
                    }
                }
            }
            "import_from_statement" => {
                // from typing import List
                // We need to collect names being imported into the current namespace
                let mut found_import = false;
                let mut sub_cursor = child.walk();
                for sub_child in child.children(&mut sub_cursor) {
                    if sub_child.kind() == "import" {
                        found_import = true;
                        continue;
                    }
                    if !found_import {
                        continue;
                    }

                    match sub_child.kind() {
                        "identifier" | "name" => {
                            names.insert(get_node_text(sub_child, source).to_string());
                        }
                        "aliased_import" => {
                            if let Some(alias) = sub_child.child_by_field_name("alias") {
                                names.insert(get_node_text(alias, source).to_string());
                            } else if let Some(name) = sub_child.child_by_field_name("name") {
                                names.insert(get_node_text(name, source).to_string());
                            }
                        }
                        "dotted_name" => {
                             // Usually not directly under from_statement except in specific tree-sitter versions, 
                             // but handle it for robustness.
                             names.insert(get_node_text(sub_child, source).to_string());
                        }
                        _ => {
                            // Recursively check for identifiers in complex from-imports (like in parentheses)
                            if sub_child.is_named() {
                                collect_python_import_identifiers(sub_child, source, &mut names);
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    names
}

fn collect_python_import_identifiers(node: Node, source: &[u8], names: &mut HashSet<String>) {
    match node.kind() {
        "identifier" | "name" => {
            names.insert(get_node_text(node, source).to_string());
        }
        "aliased_import" => {
            if let Some(alias) = node.child_by_field_name("alias") {
                names.insert(get_node_text(alias, source).to_string());
            } else if let Some(name) = node.child_by_field_name("name") {
                names.insert(get_node_text(name, source).to_string());
            }
        }
        _ => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if child.is_named() {
                    collect_python_import_identifiers(child, source, names);
                }
            }
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
        emit_rust_call_edges(output, node, source, &indent);
    } else {
        // No body (trait method signature)
        let signature = truncate_line(&text, MAX_DEF_LINE_LEN);
        output.push_str(&indent);
        output.push_str(&signature);
        output.push('\n');
        emit_rust_call_edges(output, node, source, &indent);
    }
}

fn emit_rust_call_edges(output: &mut String, node: Node, source: &[u8], indent: &str) {
    let Some(body) = node.child_by_field_name("body") else {
        return;
    };
    let calls = collect_rust_calls(body, source);
    if calls.entries.is_empty() {
        return;
    }
    output.push_str(indent);
    output.push_str("// Calls: ");
    output.push_str(&calls.entries.join(", "));
    if calls.truncated {
        output.push_str(", ...");
    }
    output.push('\n');
}

fn collect_rust_calls(node: Node, source: &[u8]) -> CallEdgeList {
    let mut list = CallEdgeList {
        entries: Vec::new(),
        truncated: false,
        visited: 0,
    };
    collect_rust_calls_rec(node, source, &mut list);
    list
}

fn collect_rust_calls_rec(node: Node, source: &[u8], list: &mut CallEdgeList) {
    if list.truncated {
        return;
    }
    list.visited += 1;
    if list.visited > MAX_CALL_EDGE_NODES {
        list.truncated = true;
        return;
    }
    if let Some(name) = rust_call_name(node, source) {
        add_unique_entry(&mut list.entries, name, MAX_CALL_EDGE_NAMES);
        if list.entries.len() >= MAX_CALL_EDGE_NAMES {
            list.truncated = true;
            return;
        }
    }
    if rust_is_scope_boundary(node.kind()) {
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_rust_calls_rec(child, source, list);
        if list.truncated {
            break;
        }
    }
}

fn rust_call_name(node: Node, source: &[u8]) -> Option<String> {
    if node.kind() != "call_expression" {
        return None;
    }
    let func = node.child_by_field_name("function")?;
    let (compact, _) = compact_text_prefix(get_node_text(func, source), MAX_CALL_EDGE_NAME_LEN);
    let name = compact.trim();
    if name.is_empty() {
        return None;
    }
    Some(truncate_line(name, MAX_CALL_EDGE_NAME_LEN))
}

fn rust_is_scope_boundary(kind: &str) -> bool {
    matches!(kind, "function_item" | "closure_expression")
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
                                emit_rust_call_edges(output, item, source, &member_indent);
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
                emit_go_call_edges(output, node, source, &indent);
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
                emit_go_call_edges(output, node, source, &indent);
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

fn emit_go_call_edges(output: &mut String, node: Node, source: &[u8], indent: &str) {
    let body = node
        .child_by_field_name("body")
        .or_else(|| node.child_by_field_name("block"));
    let Some(body) = body else {
        return;
    };
    let calls = collect_go_calls(body, source);
    if calls.entries.is_empty() {
        return;
    }
    output.push_str(indent);
    output.push_str("// Calls: ");
    output.push_str(&calls.entries.join(", "));
    if calls.truncated {
        output.push_str(", ...");
    }
    output.push('\n');
}

fn collect_go_calls(node: Node, source: &[u8]) -> CallEdgeList {
    let mut list = CallEdgeList {
        entries: Vec::new(),
        truncated: false,
        visited: 0,
    };
    collect_go_calls_rec(node, source, &mut list);
    list
}

fn collect_go_calls_rec(node: Node, source: &[u8], list: &mut CallEdgeList) {
    if list.truncated {
        return;
    }
    list.visited += 1;
    if list.visited > MAX_CALL_EDGE_NODES {
        list.truncated = true;
        return;
    }
    if let Some(name) = go_call_name(node, source) {
        add_unique_entry(&mut list.entries, name, MAX_CALL_EDGE_NAMES);
        if list.entries.len() >= MAX_CALL_EDGE_NAMES {
            list.truncated = true;
            return;
        }
    }
    if go_is_scope_boundary(node.kind()) {
        return;
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_go_calls_rec(child, source, list);
        if list.truncated {
            break;
        }
    }
}

fn go_call_name(node: Node, source: &[u8]) -> Option<String> {
    if node.kind() != "call_expression" {
        return None;
    }
    let func = node
        .child_by_field_name("function")
        .or_else(|| node.child(0))?;
    let (compact, _) = compact_text_prefix(get_node_text(func, source), MAX_CALL_EDGE_NAME_LEN);
    let name = compact.trim();
    if name.is_empty() {
        return None;
    }
    Some(truncate_line(name, MAX_CALL_EDGE_NAME_LEN))
}

fn go_is_scope_boundary(kind: &str) -> bool {
    matches!(kind, "func_literal" | "function_literal")
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
                    // Skip the colon
                    if probe.next().is_some() {
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

            let should_recurse = matches!(tag_name.as_str(), "html" | "head" | "body");

            if should_recurse {
                output.push('\n');
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    if child.kind() == "element" || child.kind() == "start_tag" || child.kind() == "end_tag" {
                        if child.kind() == "element" {
                            extract_html_skeleton(output, child, source, depth + 1);
                        }
                    }
                }
                output.push_str(&indent);
            } else if has_children {
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

struct JsHookEntries {
    entries: Vec<String>,
    truncated: bool,
}

struct JsHookModel {
    state: JsHookEntries,
    refs: JsHookEntries,
    reducers: JsHookEntries,
}

struct JsEffectSummary {
    name: String,
    deps: Option<String>,
    calls: JsInsightList,
}

struct JsLocalFunction<'a> {
    name: String,
    node: Node<'a>,
}

fn emit_js_function_details<'a>(
    output: &mut String,
    node: Node<'a>,
    source: &'a [u8],
    indent: &str,
    ctx: JsTsContext<'a>,
) {
    let jsx_node = find_jsx_return_node(node, source);
    let returns_jsx = jsx_node.is_some();

    if let Some(jsx_node) = jsx_node {
        if ctx.entrypoint_mode {
            emit_js_hook_model(output, node, source, indent);
            emit_js_effects(output, node, source, indent, ctx.external_bindings);
            emit_js_component_handlers(
                output,
                node,
                source,
                indent,
                ctx.external_bindings,
                jsx_node,
            );
        }
        let summary = summarize_jsx_outline(jsx_node, source, ctx.external_imports);
        output.push_str(indent);
        output.push_str("// Render: ");
        output.push_str(&summary);
        output.push('\n');
    } else {
        emit_js_flow_summary(output, node, source, indent);
    }

    emit_js_ts_insights(
        output,
        node,
        source,
        indent,
        ctx.external_imports,
        ctx.external_bindings,
        !returns_jsx,
    );
}

fn emit_js_hook_model(output: &mut String, node: Node, source: &[u8], indent: &str) {
    let hooks = collect_js_hook_model(node, source);
    if !hooks.state.entries.is_empty() {
        output.push_str(indent);
        output.push_str("// useState: ");
        output.push_str(&truncate_line(&format_hook_entries(&hooks.state), MAX_DEF_LINE_LEN));
        output.push('\n');
    }
    if !hooks.refs.entries.is_empty() {
        output.push_str(indent);
        output.push_str("// useRef: ");
        output.push_str(&truncate_line(&format_hook_entries(&hooks.refs), MAX_DEF_LINE_LEN));
        output.push('\n');
    }
    if !hooks.reducers.entries.is_empty() {
        output.push_str(indent);
        output.push_str("// useReducer: ");
        output.push_str(&truncate_line(&format_hook_entries(&hooks.reducers), MAX_DEF_LINE_LEN));
        output.push('\n');
    }
}

fn emit_js_effects(
    output: &mut String,
    node: Node,
    source: &[u8],
    indent: &str,
    external_bindings: Option<&HashSet<String>>,
) {
    let effects = collect_js_effects(node, source, external_bindings);
    for effect in effects.into_iter().take(MAX_JS_EFFECTS) {
        output.push_str(indent);
        output.push_str("// Effect: ");
        output.push_str(&effect.name);
        if let Some(deps) = effect.deps {
            output.push('(');
            output.push_str(&deps);
            output.push(')');
        } else {
            output.push_str("()");
        }
        if !effect.calls.entries.is_empty() {
            output.push_str(" -> ");
            output.push_str(&effect.calls.entries.join(", "));
            if effect.calls.truncated {
                output.push_str(", ...");
            }
        }
        output.push('\n');
    }
}

fn emit_js_component_handlers(
    output: &mut String,
    node: Node,
    source: &[u8],
    indent: &str,
    external_bindings: Option<&HashSet<String>>,
    jsx_node: Node,
) {
    let handler_names = collect_jsx_event_handlers(jsx_node, source);
    let handlers = collect_js_local_functions(node, source, &handler_names, external_bindings);
    for handler in handlers.into_iter().take(MAX_JS_HOOKS) {
        let sig = format_js_handler_signature(&handler.name, handler.node, source);
        if sig.is_empty() {
            continue;
        }
        let mut details: Vec<String> = Vec::new();
        let calls = collect_js_boundary_calls(handler.node, source, external_bindings, true);
        if !calls.entries.is_empty() {
            details.push(calls.entries.join(", "));
        }
        let timers = collect_js_timer_calls(handler.node, source);
        if !timers.entries.is_empty() {
            details.push(timers.entries.join(", "));
        }

        output.push_str(indent);
        output.push_str("// Handler: ");
        output.push_str(&sig);
        if !details.is_empty() {
            output.push_str(" -> ");
            output.push_str(&details.join(", "));
        }
        output.push('\n');
    }
}

fn emit_js_flow_summary(output: &mut String, node: Node, source: &[u8], indent: &str) {
    let steps = collect_js_flow_steps(node, source);
    for step in steps.iter() {
        output.push_str(indent);
        output.push_str("// Flow: ");
        output.push_str(step);
        output.push('\n');
    }

    let strings = collect_js_protocol_strings(node, source);
    if !strings.entries.is_empty() {
        output.push_str(indent);
        output.push_str("// Strings: ");
        output.push_str(&strings.entries.join(", "));
        if strings.truncated {
            output.push_str(", ...");
        }
        output.push('\n');
    }
}

fn emit_js_ts_insights(
    output: &mut String,
    node: Node,
    source: &[u8],
    indent: &str,
    external_imports: Option<&HashSet<String>>,
    external_bindings: Option<&HashSet<String>>,
    include_renders: bool,
) {
    if !ENABLE_JS_TS_INSIGHTS {
        return;
    }
    let mut invokes = collect_js_invokes(node, source, external_bindings);
    invokes.entries.retain(|entry| {
        let lower = entry.to_ascii_lowercase();
        !matches!(lower.as_str(), "listen" | "open" | "writetext")
            && !lower.contains("clipboard")
    });
    if !invokes.entries.is_empty() {
        output.push_str(indent);
        output.push_str("// Invokes: ");
        output.push_str(&invokes.entries.join(", "));
        if invokes.truncated {
            output.push_str(", ...");
        }
        output.push('\n');
    }

    let listens = collect_js_listens(node, source, external_bindings);
    if !listens.entries.is_empty() {
        output.push_str(indent);
        output.push_str("// Listens: ");
        output.push_str(&listens.entries.join(", "));
        if listens.truncated {
            output.push_str(", ...");
        }
        output.push('\n');
    }

    let opens = collect_js_opens(node, source, external_bindings);
    if !opens.entries.is_empty() {
        output.push_str(indent);
        output.push_str("// Opens: ");
        output.push_str(&opens.entries.join(", "));
        if opens.truncated {
            output.push_str(", ...");
        }
        output.push('\n');
    }

    let clipboard = collect_js_clipboard_calls(node, source, external_bindings);
    if !clipboard.entries.is_empty() {
        output.push_str(indent);
        output.push_str("// Clipboard: ");
        output.push_str(&clipboard.entries.join(", "));
        if clipboard.truncated {
            output.push_str(", ...");
        }
        output.push('\n');
    }

    if include_renders {
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

fn collect_js_invokes(
    node: Node,
    source: &[u8],
    external_bindings: Option<&HashSet<String>>,
) -> JsInsightList {
    let mut list = JsInsightList {
        entries: Vec::new(),
        truncated: false,
        visited: 0,
    };
    collect_js_invokes_rec(node, source, &mut list, external_bindings, true);
    list
}

fn collect_js_invokes_rec(
    node: Node,
    source: &[u8],
    list: &mut JsInsightList,
    external_bindings: Option<&HashSet<String>>,
    is_root: bool,
) {
    if list.truncated {
        return;
    }
    list.visited += 1;
    if list.visited > MAX_JS_INSIGHT_NODES {
        list.truncated = true;
        return;
    }
    let _ = is_root;
    if let Some(name) = js_invoke_name(node, source, external_bindings) {
        add_unique_entry(&mut list.entries, name, MAX_JS_INVOKES);
        if list.entries.len() >= MAX_JS_INVOKES {
            list.truncated = true;
            return;
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_js_invokes_rec(child, source, list, external_bindings, false);
        if list.truncated {
            break;
        }
    }
}

fn js_invoke_name(
    node: Node,
    source: &[u8],
    external_bindings: Option<&HashSet<String>>,
) -> Option<String> {
    if node.kind() != "call_expression" {
        return None;
    }
    let callee = node.child_by_field_name("function")?;
    if !js_callee_is_invoke(callee, source, external_bindings) {
        return None;
    }
    let callee_text = get_node_text(callee, source);
    if callee_text == "invoke" {
        let args = node.child_by_field_name("arguments")?;
        let mut cursor = args.walk();
        for child in args.children(&mut cursor) {
            if !child.is_named() {
                continue;
            }
            if let Some(name) = js_string_literal(child, source) {
                return Some(truncate_line(&name, MAX_JS_INSIGHT_NAME_LEN));
            }
            break;
        }
    }
    Some(truncate_line(&callee_text, MAX_JS_INSIGHT_NAME_LEN))
}

fn collect_js_listens(
    node: Node,
    source: &[u8],
    external_bindings: Option<&HashSet<String>>,
) -> JsInsightList {
    let mut list = JsInsightList {
        entries: Vec::new(),
        truncated: false,
        visited: 0,
    };
    collect_js_listens_rec(node, source, &mut list, external_bindings, true);
    list
}

fn collect_js_listens_rec(
    node: Node,
    source: &[u8],
    list: &mut JsInsightList,
    external_bindings: Option<&HashSet<String>>,
    is_root: bool,
) {
    if list.truncated {
        return;
    }
    list.visited += 1;
    if list.visited > MAX_JS_INSIGHT_NODES {
        list.truncated = true;
        return;
    }
    let _ = is_root;
    if let Some(name) = js_listen_name(node, source, external_bindings) {
        add_unique_entry(&mut list.entries, name, MAX_JS_INVOKES);
        if list.entries.len() >= MAX_JS_INVOKES {
            list.truncated = true;
            return;
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_js_listens_rec(child, source, list, external_bindings, false);
        if list.truncated {
            break;
        }
    }
}

fn js_listen_name(
    node: Node,
    source: &[u8],
    external_bindings: Option<&HashSet<String>>,
) -> Option<String> {
    if node.kind() != "call_expression" {
        return None;
    }
    let callee = node.child_by_field_name("function")?;
    if !js_callee_is_listen(callee, source, external_bindings) {
        return None;
    }
    let args = node.child_by_field_name("arguments")?;
    let mut cursor = args.walk();
    for child in args.children(&mut cursor) {
        if !child.is_named() {
            continue;
        }
        if let Some(name) = js_string_literal(child, source) {
            return Some(truncate_line(&name, MAX_JS_INSIGHT_NAME_LEN));
        }
        break;
    }
    Some("listen".to_string())
}

fn js_callee_is_listen(
    node: Node,
    source: &[u8],
    external_bindings: Option<&HashSet<String>>,
) -> bool {
    match node.kind() {
        "identifier" => {
            let name = get_node_text(node, source);
            if name != "listen" {
                return false;
            }
            external_bindings.map_or(true, |bindings| bindings.contains(name))
        }
        "member_expression" => {
            let Some(name) = js_member_expression_property_name(node, source) else {
                return false;
            };
            if name != "listen" {
                return false;
            }
            let root = js_member_expression_root_identifier(node, source);
            if let (Some(bindings), Some(root)) = (external_bindings, root) {
                if bindings.contains(root) {
                    return true;
                }
            }
            matches!(root, Some("window") | Some("globalThis") | Some("event"))
        }
        _ => false,
    }
}

fn collect_js_opens(
    node: Node,
    source: &[u8],
    external_bindings: Option<&HashSet<String>>,
) -> JsInsightList {
    let mut list = JsInsightList {
        entries: Vec::new(),
        truncated: false,
        visited: 0,
    };
    collect_js_opens_rec(node, source, &mut list, external_bindings, true);
    list
}

fn collect_js_opens_rec(
    node: Node,
    source: &[u8],
    list: &mut JsInsightList,
    external_bindings: Option<&HashSet<String>>,
    is_root: bool,
) {
    if list.truncated {
        return;
    }
    list.visited += 1;
    if list.visited > MAX_JS_INSIGHT_NODES {
        list.truncated = true;
        return;
    }
    let _ = is_root;
    if let Some(name) = js_open_name(node, source, external_bindings) {
        add_unique_entry(&mut list.entries, name, MAX_JS_INVOKES);
        if list.entries.len() >= MAX_JS_INVOKES {
            list.truncated = true;
            return;
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_js_opens_rec(child, source, list, external_bindings, false);
        if list.truncated {
            break;
        }
    }
}

fn js_open_name(
    node: Node,
    source: &[u8],
    external_bindings: Option<&HashSet<String>>,
) -> Option<String> {
    if node.kind() != "call_expression" {
        return None;
    }
    let callee = node.child_by_field_name("function")?;
    if !js_callee_is_open(callee, source, external_bindings) {
        return None;
    }
    Some("open".to_string())
}

fn js_callee_is_open(
    node: Node,
    source: &[u8],
    external_bindings: Option<&HashSet<String>>,
) -> bool {
    match node.kind() {
        "identifier" => {
            let name = get_node_text(node, source);
            if name != "open" {
                return false;
            }
            external_bindings.map_or(true, |bindings| bindings.contains(name))
        }
        "member_expression" => {
            let Some(name) = js_member_expression_property_name(node, source) else {
                return false;
            };
            if name != "open" {
                return false;
            }
            let root = js_member_expression_root_identifier(node, source);
            if let (Some(bindings), Some(root)) = (external_bindings, root) {
                if bindings.contains(root) {
                    return true;
                }
            }
            matches!(root, Some("window") | Some("globalThis") | Some("dialog"))
        }
        _ => false,
    }
}

fn collect_js_clipboard_calls(
    node: Node,
    source: &[u8],
    external_bindings: Option<&HashSet<String>>,
) -> JsInsightList {
    let mut list = JsInsightList {
        entries: Vec::new(),
        truncated: false,
        visited: 0,
    };
    collect_js_clipboard_rec(node, source, &mut list, external_bindings, true);
    list
}

fn collect_js_clipboard_rec(
    node: Node,
    source: &[u8],
    list: &mut JsInsightList,
    external_bindings: Option<&HashSet<String>>,
    is_root: bool,
) {
    if list.truncated {
        return;
    }
    list.visited += 1;
    if list.visited > MAX_JS_INSIGHT_NODES {
        list.truncated = true;
        return;
    }
    let _ = is_root;
    if let Some(name) = js_clipboard_name(node, source, external_bindings) {
        add_unique_entry(&mut list.entries, name, MAX_JS_INVOKES);
        if list.entries.len() >= MAX_JS_INVOKES {
            list.truncated = true;
            return;
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_js_clipboard_rec(child, source, list, external_bindings, false);
        if list.truncated {
            break;
        }
    }
}

fn js_clipboard_name(
    node: Node,
    source: &[u8],
    external_bindings: Option<&HashSet<String>>,
) -> Option<String> {
    if node.kind() != "call_expression" {
        return None;
    }
    let callee = node.child_by_field_name("function")?;
    if !js_callee_is_clipboard_write(callee, source, external_bindings) {
        return None;
    }
    match callee.kind() {
        "member_expression" => {
            let root = js_member_expression_root_identifier(callee, source);
            if matches!(root, Some("navigator") | Some("clipboard")) {
                return Some("clipboard.writeText".to_string());
            }
            Some(truncate_line(
                &get_node_text(callee, source),
                MAX_JS_INSIGHT_NAME_LEN,
            ))
        }
        _ => Some(truncate_line(
            &get_node_text(callee, source),
            MAX_JS_INSIGHT_NAME_LEN,
        )),
    }
}

fn js_callee_is_clipboard_write(
    node: Node,
    source: &[u8],
    external_bindings: Option<&HashSet<String>>,
) -> bool {
    match node.kind() {
        "identifier" => {
            let name = get_node_text(node, source);
            if !looks_like_clipboard_name(name) {
                return false;
            }
            external_bindings.map_or(true, |bindings| bindings.contains(name))
        }
        "member_expression" => {
            let Some(name) = js_member_expression_property_name(node, source) else {
                return false;
            };
            if name != "writeText" {
                return false;
            }
            let root = js_member_expression_root_identifier(node, source);
            if let (Some(bindings), Some(root)) = (external_bindings, root) {
                if bindings.contains(root) {
                    return true;
                }
            }
            matches!(root, Some("navigator") | Some("clipboard"))
        }
        _ => false,
    }
}

fn looks_like_clipboard_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.contains("clipboard") || lower == "writetext"
}

fn js_callee_is_invoke(
    node: Node,
    source: &[u8],
    external_bindings: Option<&HashSet<String>>,
) -> bool {
    let full_text = get_node_text(node, source);
    if matches!(full_text, "alert" | "fetch" | "invoke") {
        return true;
    }
    match node.kind() {
        "identifier" => {
            if let Some(bindings) = external_bindings {
                return bindings.contains(full_text);
            }
            false
        }
        "member_expression" => {
            let Some(name) = js_member_expression_property_name(node, source) else {
                return false;
            };
            let root = js_member_expression_root_identifier(node, source);
            if matches!(root, Some("window") | Some("globalThis"))
                && matches!(name.as_str(), "alert" | "fetch" | "invoke")
            {
                return true;
            }
            if let (Some(bindings), Some(root)) = (external_bindings, root) {
                if bindings.contains(root) {
                    return true;
                }
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

fn js_member_expression_root_identifier<'a>(node: Node<'a>, source: &'a [u8]) -> Option<&'a str> {
    let mut current = node;
    loop {
        let obj = current.child_by_field_name("object")?;
        if obj.kind() == "identifier" {
            return Some(get_node_text(obj, source));
        }
        if obj.kind() == "member_expression" {
            current = obj;
            continue;
        }
        return None;
    }
}

fn collect_js_boundary_calls(
    node: Node,
    source: &[u8],
    external_bindings: Option<&HashSet<String>>,
    skip_function_boundaries: bool,
) -> JsInsightList {
    let mut list = JsInsightList {
        entries: Vec::new(),
        truncated: false,
        visited: 0,
    };
    collect_js_boundary_calls_rec(
        node,
        source,
        &mut list,
        external_bindings,
        skip_function_boundaries,
        true,
    );
    list
}

fn collect_js_boundary_calls_rec(
    node: Node,
    source: &[u8],
    list: &mut JsInsightList,
    external_bindings: Option<&HashSet<String>>,
    skip_function_boundaries: bool,
    is_root: bool,
) {
    if list.truncated {
        return;
    }
    list.visited += 1;
    if list.visited > MAX_JS_INSIGHT_NODES {
        list.truncated = true;
        return;
    }
    if skip_function_boundaries && !is_root && is_js_function_boundary(node.kind()) {
        return;
    }
    if node.kind() == "call_expression" {
        let callee = node.child_by_field_name("function");
        if let Some(callee) = callee {
            if js_callee_is_invoke_call(callee, source, external_bindings) {
                if let Some(entry) = js_invoke_call_label(node, source) {
                    add_unique_entry(&mut list.entries, entry, MAX_JS_BOUNDARY_CALLS);
                }
            } else if js_callee_is_listen(callee, source, external_bindings) {
                if let Some(entry) = js_listen_call_label(node, source) {
                    add_unique_entry(&mut list.entries, entry, MAX_JS_BOUNDARY_CALLS);
                }
            } else if js_callee_is_open(callee, source, external_bindings) {
                add_unique_entry(&mut list.entries, "open".to_string(), MAX_JS_BOUNDARY_CALLS);
            } else if js_callee_is_clipboard_write(callee, source, external_bindings) {
                let entry = js_clipboard_call_label(callee, source);
                add_unique_entry(&mut list.entries, entry, MAX_JS_BOUNDARY_CALLS);
            }
            if list.entries.len() >= MAX_JS_BOUNDARY_CALLS {
                list.truncated = true;
                return;
            }
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_js_boundary_calls_rec(
            child,
            source,
            list,
            external_bindings,
            skip_function_boundaries,
            false,
        );
        if list.truncated {
            break;
        }
    }
}

fn js_callee_is_invoke_call(
    node: Node,
    source: &[u8],
    external_bindings: Option<&HashSet<String>>,
) -> bool {
    match node.kind() {
        "identifier" => get_node_text(node, source) == "invoke",
        "member_expression" => {
            let Some(name) = js_member_expression_property_name(node, source) else {
                return false;
            };
            if name != "invoke" {
                return false;
            }
            let root = js_member_expression_root_identifier(node, source);
            if let (Some(bindings), Some(root)) = (external_bindings, root) {
                if bindings.contains(root) {
                    return true;
                }
            }
            matches!(root, Some("window") | Some("globalThis"))
        }
        _ => false,
    }
}

fn js_invoke_call_label(node: Node, source: &[u8]) -> Option<String> {
    let arg = js_call_argument(node, 0)?;
    if let Some(name) = js_string_literal(arg, source) {
        return Some(truncate_line(&format!("invoke({})", name), MAX_JS_INSIGHT_NAME_LEN));
    }
    Some("invoke".to_string())
}

fn js_listen_call_label(node: Node, source: &[u8]) -> Option<String> {
    let arg = js_call_argument(node, 0);
    if let Some(arg) = arg {
        if let Some(name) = js_string_literal(arg, source) {
            return Some(truncate_line(&format!("listen({})", name), MAX_JS_INSIGHT_NAME_LEN));
        }
    }
    Some("listen".to_string())
}

fn js_clipboard_call_label(callee: Node, source: &[u8]) -> String {
    match callee.kind() {
        "member_expression" => {
            let root = js_member_expression_root_identifier(callee, source);
            if matches!(root, Some("navigator") | Some("clipboard")) {
                return "clipboard.writeText".to_string();
            }
            truncate_line(&get_node_text(callee, source), MAX_JS_INSIGHT_NAME_LEN)
        }
        _ => truncate_line(&get_node_text(callee, source), MAX_JS_INSIGHT_NAME_LEN),
    }
}

fn collect_js_timer_calls(node: Node, source: &[u8]) -> JsInsightList {
    let mut list = JsInsightList {
        entries: Vec::new(),
        truncated: false,
        visited: 0,
    };
    collect_js_timer_calls_rec(node, source, &mut list, true);
    list
}

fn collect_js_timer_calls_rec(node: Node, source: &[u8], list: &mut JsInsightList, is_root: bool) {
    if list.truncated {
        return;
    }
    list.visited += 1;
    if list.visited > MAX_JS_INSIGHT_NODES {
        list.truncated = true;
        return;
    }
    if !is_root && is_js_function_boundary(node.kind()) {
        return;
    }
    if let Some(name) = js_timer_call_name(node, source) {
        add_unique_entry(&mut list.entries, name, MAX_JS_TIMER_CALLS);
        if list.entries.len() >= MAX_JS_TIMER_CALLS {
            list.truncated = true;
            return;
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_js_timer_calls_rec(child, source, list, false);
        if list.truncated {
            break;
        }
    }
}

fn js_timer_call_name(node: Node, source: &[u8]) -> Option<String> {
    if node.kind() != "call_expression" {
        return None;
    }
    let callee = node.child_by_field_name("function")?;
    let name = match callee.kind() {
        "identifier" => get_node_text(callee, source).to_string(),
        "member_expression" => js_member_expression_property_name(callee, source)?,
        _ => return None,
    };
    match name.as_str() {
        "setTimeout" | "setInterval" => {
            if let Some(delay) = js_call_argument(node, 1).and_then(|arg| js_numeric_literal(arg, source)) {
                return Some(format!("{name}({delay})"));
            }
            Some(name)
        }
        "clearTimeout" | "clearInterval" => Some(name),
        _ => None,
    }
}

fn js_call_argument(node: Node, index: usize) -> Option<Node> {
    let args = node.child_by_field_name("arguments")?;
    let mut cursor = args.walk();
    let mut current = 0;
    for child in args.children(&mut cursor) {
        if !child.is_named() {
            continue;
        }
        if current == index {
            return Some(child);
        }
        current += 1;
    }
    None
}

fn js_numeric_literal(node: Node, source: &[u8]) -> Option<String> {
    let text = get_node_text(node, source).trim();
    if text.is_empty() {
        return None;
    }
    if text.chars().all(|ch| ch.is_ascii_digit() || ch == '.') {
        return Some(text.to_string());
    }
    None
}

fn summarize_top_level_call(node: Node, source: &[u8]) -> Option<String> {
    let mut budget = 200;
    let call_expr = find_call_expression(node, &mut budget)?;
    let callee = call_expr.child_by_field_name("function")?;
    let callee_label = if let Some(label) = summarize_iife_callee(callee, source) {
        label
    } else {
        let (compact, _) = compact_text_prefix(get_node_text(callee, source), MAX_DEF_LINE_LEN);
        let callee = compact.trim();
        if callee.is_empty() {
            return None;
        }
        callee.to_string()
    };
    let mut summary = String::new();
    if let Some(first_named) = node.named_child(0) {
        if first_named.kind() == "await_expression" {
            summary.push_str("await ");
        }
    }
    summary.push_str(&callee_label);
    summary.push_str("(...)");
    Some(truncate_line(&summary, MAX_DEF_LINE_LEN))
}

fn find_call_expression<'a>(node: Node<'a>, budget: &mut usize) -> Option<Node<'a>> {
    if *budget == 0 {
        return None;
    }
    *budget -= 1;
    if node.kind() == "call_expression" {
        return Some(node);
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if let Some(found) = find_call_expression(child, budget) {
            return Some(found);
        }
    }
    None
}

fn summarize_iife_callee(node: Node, _source: &[u8]) -> Option<String> {
    if matches!(node.kind(), "function" | "function_expression" | "arrow_function") {
        return Some(iife_label(node));
    }
    if node.kind() == "parenthesized_expression" {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if matches!(child.kind(), "function" | "function_expression" | "arrow_function") {
                return Some(iife_label(child));
            }
        }
    }
    None
}

fn iife_label(node: Node) -> String {
    if js_function_is_async(node) {
        "async IIFE".to_string()
    } else {
        "IIFE".to_string()
    }
}

fn collect_js_ts_external_imports(root: Node, source: &[u8]) -> JsTsExternalImports {
    let mut modules = HashSet::new();
    let mut components = HashSet::new();
    let mut bindings = HashSet::new();
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
        modules.insert(specifier);
        collect_imported_names(child, source, &mut components);
        collect_imported_bindings(child, source, &mut bindings);
    }
    JsTsExternalImports {
        modules,
        components,
        bindings,
    }
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

fn collect_imported_bindings(node: Node, source: &[u8], names: &mut HashSet<String>) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "import_specifier" => {
                if let Some(name) = child
                    .child_by_field_name("local")
                    .or_else(|| child.child_by_field_name("name"))
                {
                    names.insert(get_node_text(name, source).to_string());
                }
            }
            "namespace_import" => {
                if let Some(name) = child
                    .child_by_field_name("name")
                    .or_else(|| child.child_by_field_name("local"))
                {
                    names.insert(get_node_text(name, source).to_string());
                }
            }
            "import_clause" | "named_imports" => {
                collect_imported_bindings(child, source, names);
            }
            "identifier" => {
                names.insert(get_node_text(child, source).to_string());
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

fn collect_js_hook_model(node: Node, source: &[u8]) -> JsHookModel {
    let Some(body) = node.child_by_field_name("body") else {
        return JsHookModel {
            state: JsHookEntries {
                entries: Vec::new(),
                truncated: false,
            },
            refs: JsHookEntries {
                entries: Vec::new(),
                truncated: false,
            },
            reducers: JsHookEntries {
                entries: Vec::new(),
                truncated: false,
            },
        };
    };
    let mut model = JsHookModel {
        state: JsHookEntries {
            entries: Vec::new(),
            truncated: false,
        },
        refs: JsHookEntries {
            entries: Vec::new(),
            truncated: false,
        },
        reducers: JsHookEntries {
            entries: Vec::new(),
            truncated: false,
        },
    };
    let mut visited = 0;
    collect_js_hook_model_rec(body, source, &mut model, &mut visited, true);
    model
}

fn collect_js_hook_model_rec(
    node: Node,
    source: &[u8],
    model: &mut JsHookModel,
    visited: &mut usize,
    is_root: bool,
) {
    if model.state.truncated && model.refs.truncated && model.reducers.truncated {
        return;
    }
    *visited += 1;
    if *visited > MAX_JS_INSIGHT_NODES {
        model.state.truncated = true;
        model.refs.truncated = true;
        model.reducers.truncated = true;
        return;
    }
    if !is_root && is_js_function_boundary(node.kind()) {
        return;
    }
    if node.kind() == "variable_declarator" {
        if let Some(value) = node.child_by_field_name("value") {
            if value.kind() == "call_expression" {
                if let Some(name) = js_call_callee_name(value, source) {
                    let binding_names = js_declarator_binding_names(node, source);
                    let first_binding = binding_names.first().cloned();
                    if let Some(binding) = first_binding {
                        if name == "useState" {
                            add_hook_entry(&mut model.state, &binding, value, source);
                        } else if name == "useRef" {
                            add_hook_entry(&mut model.refs, &binding, value, source);
                        } else if name == "useReducer" {
                            add_hook_entry(&mut model.reducers, &binding, value, source);
                        }
                    }
                }
            }
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if !child.is_named() {
            continue;
        }
        collect_js_hook_model_rec(child, source, model, visited, false);
    }
}

fn add_hook_entry(entries: &mut JsHookEntries, name: &str, call: Node, source: &[u8]) {
    if entries.truncated {
        return;
    }
    if entries.entries.len() >= MAX_JS_HOOKS {
        entries.truncated = true;
        return;
    }
    let init = summarize_js_hook_init(call, source);
    let entry = if let Some(init) = init {
        format!("{}={}", name, init)
    } else {
        name.to_string()
    };
    entries.entries.push(truncate_line(&entry, MAX_DEF_LINE_LEN));
}

fn format_hook_entries(entries: &JsHookEntries) -> String {
    let mut out = entries.entries.join(", ");
    if entries.truncated {
        if !out.is_empty() {
            out.push_str(", ...");
        } else {
            out.push_str("...");
        }
    }
    out
}

fn summarize_js_hook_init(call: Node, source: &[u8]) -> Option<String> {
    let arg = js_call_argument(call, 0)?;
    let summary = summarize_js_value(arg, source);
    Some(truncate_line(&summary, MAX_JS_HOOK_INIT_LEN))
}

fn summarize_js_value(node: Node, source: &[u8]) -> String {
    match node.kind() {
        "object" | "object_pattern" => "{...}".to_string(),
        "array" | "array_pattern" => "[]".to_string(),
        "true" | "false" | "null" => get_node_text(node, source).to_string(),
        "number" | "number_literal" => get_node_text(node, source).to_string(),
        "string" | "template_string" => {
            if let Some(text) = js_string_literal(node, source) {
                format!("\"{}\"", truncate_line(&text, MAX_JS_HOOK_INIT_LEN))
            } else {
                "\"...\"".to_string()
            }
        }
        "new_expression" => truncate_line(get_node_text(node, source), MAX_JS_HOOK_INIT_LEN),
        "identifier" | "member_expression" | "call_expression" => {
            truncate_line(get_node_text(node, source), MAX_JS_HOOK_INIT_LEN)
        }
        _ => truncate_line(get_node_text(node, source), MAX_JS_HOOK_INIT_LEN),
    }
}

fn js_call_callee_name(node: Node, source: &[u8]) -> Option<String> {
    let callee = node.child_by_field_name("function")?;
    match callee.kind() {
        "identifier" => Some(get_node_text(callee, source).to_string()),
        "member_expression" => js_member_expression_property_name(callee, source),
        _ => None,
    }
}

fn collect_js_effects(
    node: Node,
    source: &[u8],
    external_bindings: Option<&HashSet<String>>,
) -> Vec<JsEffectSummary> {
    let Some(body) = node.child_by_field_name("body") else {
        return Vec::new();
    };
    let mut effects = Vec::new();
    let mut visited = 0;
    collect_js_effects_rec(
        body,
        source,
        external_bindings,
        &mut effects,
        &mut visited,
        true,
    );
    effects
}

fn collect_js_effects_rec(
    node: Node,
    source: &[u8],
    external_bindings: Option<&HashSet<String>>,
    effects: &mut Vec<JsEffectSummary>,
    visited: &mut usize,
    is_root: bool,
) {
    if effects.len() >= MAX_JS_EFFECTS {
        return;
    }
    *visited += 1;
    if *visited > MAX_JS_INSIGHT_NODES {
        return;
    }
    if !is_root && is_js_function_boundary(node.kind()) {
        return;
    }
    if node.kind() == "call_expression" {
        if let Some(name) = js_call_callee_name(node, source) {
            if name == "useEffect" || name == "useLayoutEffect" {
                let deps = js_effect_dependency(node, source);
                let calls = collect_js_boundary_calls(node, source, external_bindings, false);
                effects.push(JsEffectSummary { name, deps, calls });
            }
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if !child.is_named() {
            continue;
        }
        collect_js_effects_rec(
            child,
            source,
            external_bindings,
            effects,
            visited,
            false,
        );
        if effects.len() >= MAX_JS_EFFECTS {
            break;
        }
    }
}

fn js_effect_dependency(node: Node, source: &[u8]) -> Option<String> {
    let arg = js_call_argument(node, 1)?;
    let text = get_node_text(arg, source).trim().to_string();
    if text.is_empty() {
        None
    } else {
        Some(truncate_line(&text, MAX_DEF_LINE_LEN))
    }
}

fn collect_js_flow_steps(node: Node, source: &[u8]) -> Vec<String> {
    let Some(body) = node.child_by_field_name("body") else {
        return Vec::new();
    };
    let mut steps = Vec::new();
    let mut budget = MAX_JS_FLOW_STEPS;
    collect_js_flow_steps_rec(body, source, &mut steps, &mut budget, true);
    steps
}

fn collect_js_flow_steps_rec(
    node: Node,
    source: &[u8],
    steps: &mut Vec<String>,
    budget: &mut usize,
    is_root: bool,
) {
    if *budget == 0 {
        return;
    }
    if !is_root && is_js_function_boundary(node.kind()) {
        return;
    }
    if let Some(summary) = summarize_js_flow_node(node, source) {
        steps.push(summary);
        *budget = budget.saturating_sub(1);
        if *budget == 0 {
            return;
        }
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if !child.is_named() {
            continue;
        }
        collect_js_flow_steps_rec(child, source, steps, budget, false);
        if *budget == 0 {
            break;
        }
    }
}

fn summarize_js_flow_node(node: Node, source: &[u8]) -> Option<String> {
    match node.kind() {
        "if_statement" => {
            let cond = node
                .child_by_field_name("condition")
                .or_else(|| node.child_by_field_name("test"));
            let cond = cond.map(|c| get_node_text(c, source).to_string()).unwrap_or_else(|| "...".to_string());
            Some(truncate_line(&format!("if ({})", cond), MAX_DEF_LINE_LEN))
        }
        "for_statement" => {
            let init = node.child_by_field_name("initializer").map(|c| get_node_text(c, source)).unwrap_or("");
            let test = node.child_by_field_name("condition").or_else(|| node.child_by_field_name("test")).map(|c| get_node_text(c, source)).unwrap_or("");
            let update = node.child_by_field_name("update").map(|c| get_node_text(c, source)).unwrap_or("");
            let summary = format!("for ({}; {}; {})", init, test, update);
            Some(truncate_line(&summary, MAX_DEF_LINE_LEN))
        }
        "for_of_statement" => {
            let left = node.child_by_field_name("left").map(|c| get_node_text(c, source)).unwrap_or("...");
            let right = node.child_by_field_name("right").map(|c| get_node_text(c, source)).unwrap_or("...");
            Some(truncate_line(&format!("for ({} of {})", left, right), MAX_DEF_LINE_LEN))
        }
        "for_in_statement" => {
            let left = node.child_by_field_name("left").map(|c| get_node_text(c, source)).unwrap_or("...");
            let right = node.child_by_field_name("right").map(|c| get_node_text(c, source)).unwrap_or("...");
            Some(truncate_line(&format!("for ({} in {})", left, right), MAX_DEF_LINE_LEN))
        }
        "while_statement" => {
            let cond = node.child_by_field_name("condition").or_else(|| node.child_by_field_name("test"));
            let cond = cond.map(|c| get_node_text(c, source).to_string()).unwrap_or_else(|| "...".to_string());
            Some(truncate_line(&format!("while ({})", cond), MAX_DEF_LINE_LEN))
        }
        "do_statement" => {
            let cond = node.child_by_field_name("condition").or_else(|| node.child_by_field_name("test"));
            let cond = cond.map(|c| get_node_text(c, source).to_string()).unwrap_or_else(|| "...".to_string());
            Some(truncate_line(&format!("do/while ({})", cond), MAX_DEF_LINE_LEN))
        }
        "switch_statement" => {
            let value = node.child_by_field_name("value").or_else(|| node.child_by_field_name("condition"));
            let value = value.map(|c| get_node_text(c, source).to_string()).unwrap_or_else(|| "...".to_string());
            Some(truncate_line(&format!("switch ({})", value), MAX_DEF_LINE_LEN))
        }
        "try_statement" => Some("try/catch".to_string()),
        _ => None,
    }
}

fn collect_js_protocol_strings(node: Node, source: &[u8]) -> JsInsightList {
    let mut list = JsInsightList {
        entries: Vec::new(),
        truncated: false,
        visited: 0,
    };
    let Some(body) = node.child_by_field_name("body") else {
        return list;
    };
    collect_js_protocol_strings_rec(body, source, &mut list, true);
    list
}

fn collect_js_protocol_strings_rec(
    node: Node,
    source: &[u8],
    list: &mut JsInsightList,
    is_root: bool,
) {
    if list.truncated {
        return;
    }
    list.visited += 1;
    if list.visited > MAX_JS_INSIGHT_NODES {
        list.truncated = true;
        return;
    }
    if !is_root && is_js_function_boundary(node.kind()) {
        return;
    }
    if matches!(node.kind(), "string" | "template_string") {
        if let Some(value) = js_string_literal(node, source) {
            if looks_like_protocol_string(&value) {
                add_unique_entry(&mut list.entries, value, MAX_JS_PROTOCOL_STRINGS);
                if list.entries.len() >= MAX_JS_PROTOCOL_STRINGS {
                    list.truncated = true;
                    return;
                }
            }
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if !child.is_named() {
            continue;
        }
        collect_js_protocol_strings_rec(child, source, list, false);
        if list.truncated {
            break;
        }
    }
}

fn looks_like_protocol_string(value: &str) -> bool {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 30 {
        return false;
    }
    let is_upper = trimmed.chars().all(|ch| {
        ch.is_ascii_uppercase() || ch == '_' || ch == '-' || ch == ' '
    });
    if is_upper {
        return true;
    }
    trimmed.contains('_')
}

fn collect_js_local_functions<'a>(
    node: Node<'a>,
    source: &'a [u8],
    handler_names: &[String],
    external_bindings: Option<&HashSet<String>>,
) -> Vec<JsLocalFunction<'a>> {
    let Some(body) = node.child_by_field_name("body") else {
        return Vec::new();
    };
    let mut results = Vec::new();
    let mut visited = 0;
    let mut seen = HashSet::new();
    let handler_set: HashSet<&str> = handler_names.iter().map(|name| name.as_str()).collect();
    collect_js_local_functions_rec(
        body,
        source,
        external_bindings,
        &handler_set,
        &mut results,
        &mut seen,
        &mut visited,
        true,
    );
    results
}

fn collect_js_local_functions_rec<'a>(
    node: Node<'a>,
    source: &'a [u8],
    external_bindings: Option<&HashSet<String>>,
    handler_set: &HashSet<&str>,
    results: &mut Vec<JsLocalFunction<'a>>,
    seen: &mut HashSet<String>,
    visited: &mut usize,
    is_root: bool,
) {
    if *visited > MAX_JS_INSIGHT_NODES {
        return;
    }
    *visited += 1;
    if !is_root && is_js_function_boundary(node.kind()) {
        return;
    }
    match node.kind() {
        "function_declaration" => {
            if let Some(name) = js_declared_name(node, source) {
                maybe_add_local_function(
                    name,
                    node,
                    source,
                    external_bindings,
                    handler_set,
                    results,
                    seen,
                );
            }
        }
        "variable_declarator" => {
            if let Some(func_node) = js_declarator_function(node) {
                if let Some(name) = js_declarator_name(node, source) {
                    maybe_add_local_function(
                        name,
                        func_node,
                        source,
                        external_bindings,
                        handler_set,
                        results,
                        seen,
                    );
                }
            }
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if !child.is_named() {
            continue;
        }
        collect_js_local_functions_rec(
            child,
            source,
            external_bindings,
            handler_set,
            results,
            seen,
            visited,
            false,
        );
    }
}

fn maybe_add_local_function<'a>(
    name: String,
    func_node: Node<'a>,
    source: &'a [u8],
    external_bindings: Option<&HashSet<String>>,
    handler_set: &HashSet<&str>,
    results: &mut Vec<JsLocalFunction<'a>>,
    seen: &mut HashSet<String>,
) {
    if seen.contains(&name) {
        return;
    }
    let is_handler = handler_set.contains(name.as_str());
    let calls = collect_js_boundary_calls(func_node, source, external_bindings, true);
    let timers = collect_js_timer_calls(func_node, source);
    if is_handler || !calls.entries.is_empty() || !timers.entries.is_empty() {
        seen.insert(name.clone());
        results.push(JsLocalFunction { name, node: func_node });
    }
}

fn format_js_handler_signature(name: &str, node: Node, source: &[u8]) -> String {
    let params = js_function_parameters(node, source).unwrap_or_else(|| "()".to_string());
    let mut sig = String::new();
    if js_function_is_async(node) {
        sig.push_str("async ");
    }
    sig.push_str(name);
    sig.push_str(&params);
    truncate_line(&sig, MAX_DEF_LINE_LEN)
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

fn collect_jsx_event_handlers(node: Node, source: &[u8]) -> Vec<String> {
    let mut list = JsInsightList {
        entries: Vec::new(),
        truncated: false,
        visited: 0,
    };
    collect_jsx_event_handlers_rec(node, source, &mut list);
    list.entries
}

fn collect_jsx_event_handlers_rec(node: Node, source: &[u8], list: &mut JsInsightList) {
    if list.truncated {
        return;
    }
    list.visited += 1;
    if list.visited > MAX_JS_INSIGHT_NODES {
        list.truncated = true;
        return;
    }
    if node.kind() == "jsx_attribute" {
        if let Some(name_node) = node.child_by_field_name("name") {
            let name = get_node_text(name_node, source);
            if name.starts_with("on") {
                if let Some(value) = node.child_by_field_name("value") {
                    if let Some(handler) = jsx_handler_name_from_value(value, source) {
                        add_unique_entry(&mut list.entries, handler, MAX_JS_HOOKS);
                        if list.entries.len() >= MAX_JS_HOOKS {
                            list.truncated = true;
                            return;
                        }
                    }
                }
            }
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_jsx_event_handlers_rec(child, source, list);
        if list.truncated {
            break;
        }
    }
}

fn jsx_handler_name_from_value(node: Node, source: &[u8]) -> Option<String> {
    let expr = if node.kind() == "jsx_expression" {
        node.named_child(0)?
    } else {
        node
    };
    let mut budget = 200;
    find_handler_name_in_expr(expr, source, &mut budget)
}

fn find_handler_name_in_expr(node: Node, source: &[u8], budget: &mut usize) -> Option<String> {
    if *budget == 0 {
        return None;
    }
    *budget -= 1;
    match node.kind() {
        "identifier" => return Some(get_node_text(node, source).to_string()),
        "member_expression" => {
            if let Some(name) = js_member_expression_property_name(node, source) {
                return Some(name);
            }
            return Some(get_node_text(node, source).to_string());
        }
        "call_expression" => return js_call_callee_label(node, source),
        "arrow_function" | "function" | "function_expression" => {
            if let Some(body) = node.child_by_field_name("body") {
                let mut inner_budget = 200;
                if let Some(call_expr) = find_call_expression(body, &mut inner_budget) {
                    return js_call_callee_label(call_expr, source);
                }
            }
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if let Some(found) = find_handler_name_in_expr(child, source, budget) {
            return Some(found);
        }
    }
    None
}

fn js_call_callee_label(node: Node, source: &[u8]) -> Option<String> {
    if node.kind() != "call_expression" {
        return None;
    }
    let callee = node.child_by_field_name("function")?;
    match callee.kind() {
        "identifier" => Some(get_node_text(callee, source).to_string()),
        "member_expression" => {
            if let Some(name) = js_member_expression_property_name(callee, source) {
                return Some(name);
            }
            Some(get_node_text(callee, source).to_string())
        }
        _ => None,
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

fn js_ts_is_entrypoint(
    root: Node,
    source: &[u8],
    file_path: Option<&str>,
    lang: SupportedLanguage,
) -> bool {
    if !matches!(
        lang,
        SupportedLanguage::TypeScript
            | SupportedLanguage::TypeScriptTsx
            | SupportedLanguage::JavaScript
            | SupportedLanguage::JavaScriptJsx
    ) {
        return false;
    }
    if let Some(name) = file_path.and_then(js_file_name_lower) {
        if matches!(
            name.as_str(),
            "app.tsx" | "main.tsx" | "index.tsx" | "app.jsx" | "main.jsx" | "index.jsx"
        ) {
            return true;
        }
    }
    if js_ts_contains_create_root(root, source) {
        return true;
    }
    js_ts_has_default_exported_component(root, source)
}

fn js_file_name_lower(path: &str) -> Option<String> {
    let name = path.rsplit(|ch| ch == '/' || ch == '\\').next()?;
    if name.is_empty() {
        None
    } else {
        Some(name.to_ascii_lowercase())
    }
}

fn js_ts_contains_create_root(root: Node, source: &[u8]) -> bool {
    let mut budget = MAX_JS_INSIGHT_NODES;
    js_ts_contains_call_named(root, source, &mut budget, "createRoot")
}

fn js_ts_contains_call_named(
    node: Node,
    source: &[u8],
    budget: &mut usize,
    target: &str,
) -> bool {
    if *budget == 0 {
        return false;
    }
    *budget -= 1;
    if node.kind() == "call_expression" {
        if let Some(name) = js_call_callee_name(node, source) {
            if name == target {
                return true;
            }
        }
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if js_ts_contains_call_named(child, source, budget, target) {
            return true;
        }
    }
    false
}

fn js_ts_has_default_exported_component(root: Node, source: &[u8]) -> bool {
    let mut has_default_export = false;
    let mut has_component = false;
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        match child.kind() {
            "export_default_declaration" => {
                has_default_export = true;
                if export_decl_has_jsx_component(child, source) {
                    return true;
                }
            }
            "export_statement" | "export_declaration" => {
                let mut export_cursor = child.walk();
                for export_child in child.children(&mut export_cursor) {
                    if export_child.kind() == "default" {
                        has_default_export = true;
                        break;
                    }
                }
                if export_decl_has_jsx_component(child, source) {
                    return true;
                }
            }
            "function_declaration" => {
                if find_jsx_return_node(child, source).is_some() {
                    has_component = true;
                }
            }
            "lexical_declaration" | "variable_declaration" => {
                let mut decl_cursor = child.walk();
                for decl in child.children(&mut decl_cursor) {
                    if decl.kind() != "variable_declarator" {
                        continue;
                    }
                    if let Some(func_node) = js_declarator_function(decl) {
                        if find_jsx_return_node(func_node, source).is_some() {
                            has_component = true;
                        }
                    }
                }
            }
            _ => {}
        }
    }
    has_default_export && has_component
}

fn export_decl_has_jsx_component(node: Node, source: &[u8]) -> bool {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if matches!(
            child.kind(),
            "function_declaration" | "arrow_function" | "function" | "function_expression"
        ) && find_jsx_return_node(child, source).is_some()
        {
            return true;
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

fn find_jsx_return_node<'a>(node: Node<'a>, source: &'a [u8]) -> Option<Node<'a>> {
    let body = node.child_by_field_name("body")?;
    if let Some(jsx) = jsx_from_expression(body) {
        return Some(jsx);
    }
    if body.kind() == "statement_block" {
        let mut budget = MAX_JSX_RETURN_NODES;
        if let Some(jsx) = find_jsx_return_in_block(body, source, &mut budget) {
            return Some(jsx);
        }
    }
    None
}

fn jsx_from_expression(node: Node) -> Option<Node> {
    if matches!(
        node.kind(),
        "jsx_element" | "jsx_self_closing_element" | "jsx_fragment"
    ) {
        return Some(node);
    }
    if node.kind() == "parenthesized_expression" {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if matches!(
                child.kind(),
                "jsx_element" | "jsx_self_closing_element" | "jsx_fragment"
            ) {
                return Some(child);
            }
        }
    }
    None
}

fn find_jsx_return_in_block<'a>(
    node: Node<'a>,
    source: &'a [u8],
    budget: &mut usize,
) -> Option<Node<'a>> {
    if *budget == 0 {
        return None;
    }
    *budget -= 1;

    if node.kind() == "return_statement" {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() == "return" {
                continue;
            }
            if let Some(jsx) = jsx_from_expression(child) {
                return Some(jsx);
            }
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if is_js_function_boundary(child.kind()) {
            continue;
        }
        if let Some(found) = find_jsx_return_in_block(child, source, budget) {
            return Some(found);
        }
    }
    None
}

fn is_js_function_boundary(kind: &str) -> bool {
    matches!(
        kind,
        "function_declaration"
            | "function"
            | "function_expression"
            | "arrow_function"
            | "method_definition"
            | "class_declaration"
            | "class_body"
    )
}

fn summarize_jsx_outline(
    node: Node,
    source: &[u8],
    external_imports: Option<&HashSet<String>>,
) -> String {
    let root = jsx_outline_root_label(node, source);
    let mut list = JsInsightList {
        entries: Vec::new(),
        truncated: false,
        visited: 0,
    };
    collect_jsx_outline_entries(
        node,
        source,
        &mut list,
        external_imports,
        false,
        false,
        true,
    );
    if list.entries.is_empty() {
        return root;
    }
    let mut out = format!("{root} -> {}", list.entries.join(", "));
    if list.truncated {
        out.push_str(", ...");
    }
    out
}

fn jsx_outline_root_label(node: Node, source: &[u8]) -> String {
    match node.kind() {
        "jsx_fragment" => "Fragment".to_string(),
        "jsx_element" => {
            if let Some(open) = node
                .child_by_field_name("open_tag")
                .or_else(|| node.child_by_field_name("opening_element"))
            {
                if let Some(name) = jsx_tag_name(open, source) {
                    if is_jsx_component_name(&name) {
                        return name;
                    }
                }
            }
            "Layout".to_string()
        }
        "jsx_self_closing_element" => {
            if let Some(name) = jsx_tag_name(node, source) {
                if is_jsx_component_name(&name) {
                    return name;
                }
            }
            "Layout".to_string()
        }
        _ => "Layout".to_string(),
    }
}

fn collect_jsx_outline_entries(
    node: Node,
    source: &[u8],
    list: &mut JsInsightList,
    external_imports: Option<&HashSet<String>>,
    conditional: bool,
    repeated: bool,
    is_root_node: bool,
) {
    if list.truncated {
        return;
    }
    list.visited += 1;
    if list.visited > MAX_JS_INSIGHT_NODES {
        list.truncated = true;
        return;
    }

    if !is_root_node && matches!(node.kind(), "jsx_element" | "jsx_self_closing_element") {
        if let Some(entry) = jsx_outline_entry(node, source, external_imports, conditional, repeated) {
            add_unique_entry(&mut list.entries, entry, MAX_JSX_COMPONENTS);
            if list.entries.len() >= MAX_JSX_COMPONENTS {
                list.truncated = true;
                return;
            }
        }
    }

    if node.kind() == "jsx_expression" {
        let expr = node.named_child(0);
        let mut next_conditional = conditional;
        let mut next_repeated = repeated;
        if let Some(expr) = expr {
            if matches!(expr.kind(), "conditional_expression" | "logical_expression") {
                next_conditional = true;
            }
            if expr_contains_map_call(expr, source) {
                next_repeated = true;
            }
        }
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            collect_jsx_outline_entries(
                child,
                source,
                list,
                external_imports,
                next_conditional,
                next_repeated,
                false,
            );
            if list.truncated {
                break;
            }
        }
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_jsx_outline_entries(
            child,
            source,
            list,
            external_imports,
            conditional,
            repeated,
            false,
        );
        if list.truncated {
            break;
        }
    }
}

fn jsx_outline_entry(
    node: Node,
    source: &[u8],
    external_imports: Option<&HashSet<String>>,
    conditional: bool,
    repeated: bool,
) -> Option<String> {
    let name = match node.kind() {
        "jsx_element" => {
            let open = node
                .child_by_field_name("open_tag")
                .or_else(|| node.child_by_field_name("opening_element"))?;
            jsx_tag_name(open, source)?
        }
        "jsx_self_closing_element" => jsx_tag_name(node, source)?,
        _ => return None,
    };
    if !is_jsx_component_name(&name) {
        return None;
    }
    if let Some(external) = external_imports {
        if external.contains(&name) {
            return None;
        }
    }
    let mut label = name;
    if repeated {
        label.push('*');
    }
    if conditional {
        label.push('?');
    }
    let props = jsx_prop_names(node, source);
    if !props.entries.is_empty() {
        label.push('[');
        label.push_str(&props.entries.join(", "));
        if props.truncated {
            label.push_str(", ...");
        }
        label.push(']');
    }
    Some(label)
}

fn jsx_prop_names(node: Node, source: &[u8]) -> JsHookEntries {
    let mut entries = JsHookEntries {
        entries: Vec::new(),
        truncated: false,
    };
    let opening = if node.kind() == "jsx_element" {
        node.child_by_field_name("open_tag")
            .or_else(|| node.child_by_field_name("opening_element"))
    } else {
        Some(node)
    };
    let Some(opening) = opening else {
        return entries;
    };
    let mut cursor = opening.walk();
    for child in opening.children(&mut cursor) {
        if child.kind() == "jsx_attribute" {
            if let Some(name_node) = child.child_by_field_name("name") {
                let name = get_node_text(name_node, source);
                if matches!(name, "key" | "className" | "style") {
                    continue;
                }
                entries.entries.push(name.to_string());
                if entries.entries.len() >= MAX_JSX_PROP_NAMES {
                    entries.truncated = true;
                    break;
                }
            }
        }
    }
    entries
}

fn expr_contains_map_call(node: Node, source: &[u8]) -> bool {
    let mut budget = 200;
    expr_contains_map_call_rec(node, source, &mut budget)
}

fn expr_contains_map_call_rec(node: Node, source: &[u8], budget: &mut usize) -> bool {
    if *budget == 0 {
        return false;
    }
    *budget -= 1;
    if node.kind() == "call_expression" {
        if let Some(callee) = node.child_by_field_name("function") {
            if callee.kind() == "member_expression" {
                if let Some(name) = js_member_expression_property_name(callee, source) {
                    if name == "map" {
                        return true;
                    }
                }
            }
        }
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if expr_contains_map_call_rec(child, source, budget) {
            return true;
        }
    }
    false
}
