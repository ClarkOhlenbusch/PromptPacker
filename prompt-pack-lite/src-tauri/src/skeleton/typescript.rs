//! JavaScript/TypeScript-specific skeleton extraction using tree-sitter.
//!
//! Handles: imports, exports, functions, classes, interfaces, types, JSX components,
//! React hooks, effects, and various JS/TS patterns.

use std::collections::{HashMap, HashSet};
use tree_sitter::Node;

use crate::skeleton::common::{
    get_node_text, truncate_line, compact_text_prefix, trim_doc_comment,
    MAX_DEF_LINE_LEN, MAX_SIMPLE_CONST_LEN, MAX_CALL_EDGE_NAMES,
    MAX_CALL_EDGE_NAME_LEN, MAX_CALL_EDGE_NODES,
};

// ============ Constants ============

const MAX_JS_INVOKES: usize = 8;
const MAX_JSX_COMPONENTS: usize = 10;
const MAX_JS_INSIGHT_NODES: usize = 4000;
const MAX_JS_HOOKS: usize = 12;
const MAX_JS_EFFECTS: usize = 6;
const MAX_JS_HOOK_INIT_LEN: usize = 28;
const MAX_JS_INSIGHT_NAME_LEN: usize = 40;
const ENABLE_JS_TS_INSIGHTS: bool = true;
const MAX_JSX_RETURN_NODES: usize = 2000;
const MAX_IMPORT_SUMMARY_MODULES: usize = 20;
const MAX_IMPORT_SUMMARY_NAMES: usize = 12;

// ============ Context Types ============

#[derive(Clone, Copy)]
pub struct JsTsContext<'a> {
    pub has_exports: bool,
    pub in_export: bool,
    pub exported_names: Option<&'a HashSet<String>>,
    pub external_imports: Option<&'a HashSet<String>>,
    pub external_bindings: Option<&'a HashSet<String>>,
    pub entrypoint_mode: bool,
    pub import_summary_only: bool,
    pub unwrap_top_level_iife: bool,
}

pub struct JsTsExports {
    pub has_exports: bool,
    pub names: HashSet<String>,
}

pub struct JsTsExternalImports {
    pub modules: HashSet<String>,
    pub components: HashSet<String>,
    pub bindings: HashSet<String>,
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
    calls: CallEdgeList,
}

struct JsLocalFunction<'a> {
    name: String,
    node: Node<'a>,
}

struct CallEdgeList {
    entries: Vec<String>,
    truncated: bool,
    visited: usize,
}

// ============ Main Entry Point ============

/// Extract skeleton from JavaScript/TypeScript source code
pub fn extract_skeleton(
    content: &str,
    root: Node,
    source: &[u8],
    file_path: Option<&str>,
    is_tsx: bool,
) -> String {
    let exports = collect_js_ts_exports(root, source);
    let external_imports = collect_js_ts_external_imports(root, source);
    let entrypoint_mode = js_ts_is_entrypoint(root, source, file_path, is_tsx);
    let import_summary_only = js_ts_import_summary_only();
    let unwrap_top_level_iife = js_ts_should_unwrap_iife(content);

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
        import_summary_only,
        unwrap_top_level_iife,
    };

    let mut output = String::new();

    if import_summary_only {
        emit_import_summary(&mut output, root, source);
    } else {
        // Output external module imports
        if !external_imports.modules.is_empty() {
            let mut sorted: Vec<_> = external_imports.modules.iter().collect();
            sorted.sort();
            for ext in sorted {
                output.push_str(&format!("// External: {}\n", ext));
            }
        }
    }

    extract_js_ts_skeleton(&mut output, root, source, 0, ctx);
    output.trim().to_string()
}

fn js_ts_import_summary_only() -> bool {
    let Ok(value) = std::env::var("PROMPTPACK_IMPORT_SUMMARY_ONLY") else {
        return false;
    };
    let value = value.trim().to_ascii_lowercase();
    matches!(value.as_str(), "1" | "true" | "yes" | "on")
}

fn js_ts_should_unwrap_iife(content: &str) -> bool {
    let mut lines = 0usize;
    let mut total_len = 0usize;
    let mut max_len = 0usize;
    for line in content.lines() {
        let len = line.chars().count();
        if len == 0 {
            continue;
        }
        lines += 1;
        total_len += len;
        if len > max_len {
            max_len = len;
        }
    }
    if lines == 0 {
        return false;
    }
    let avg_len = total_len as f64 / lines as f64;
    lines >= 30 && avg_len <= 120.0 && max_len <= 400
}

struct ImportSummary {
    module: String,
    bindings: Vec<String>,
    type_only: bool,
    side_effect: bool,
}

fn emit_import_summary(output: &mut String, root: Node, source: &[u8]) {
    let summaries = collect_import_summaries(root, source);
    if summaries.is_empty() {
        return;
    }

    output.push_str("// Imports (summary)\n");
    for (idx, summary) in summaries.iter().enumerate() {
        if idx >= MAX_IMPORT_SUMMARY_MODULES {
            break;
        }
        let mut line = String::new();
        line.push_str("// Import");
        if summary.type_only {
            line.push_str(" (type)");
        }
        line.push_str(": ");
        line.push_str(&summary.module);
        if summary.side_effect || summary.bindings.is_empty() {
            line.push_str(" (side-effect)");
        } else {
            line.push_str(" -> ");
            line.push_str(&format_import_bindings(&summary.bindings));
        }
        output.push_str(&truncate_line(&line, MAX_DEF_LINE_LEN));
        output.push('\n');
    }

    if summaries.len() > MAX_IMPORT_SUMMARY_MODULES {
        output.push_str(&format!(
            "// ... +{} more imports\n",
            summaries.len() - MAX_IMPORT_SUMMARY_MODULES
        ));
    }
}

fn collect_import_summaries(root: Node, source: &[u8]) -> Vec<ImportSummary> {
    let mut summaries: Vec<ImportSummary> = Vec::new();
    let mut indices: HashMap<String, usize> = HashMap::new();
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
        let mut bindings = Vec::new();
        collect_import_bindings(child, source, &mut bindings);
        let type_only = js_import_is_type_only(child, source);
        let side_effect = bindings.is_empty();

        let entry = ImportSummary {
            module: specifier.clone(),
            bindings,
            type_only,
            side_effect,
        };

        if let Some(idx) = indices.get(&specifier).copied() {
            merge_import_summary(&mut summaries[idx], entry);
        } else {
            indices.insert(specifier.clone(), summaries.len());
            summaries.push(entry);
        }
    }

    summaries
}

fn js_import_is_type_only(node: Node, source: &[u8]) -> bool {
    let text = get_node_text(node, source);
    text.trim_start().starts_with("import type")
}

fn collect_import_bindings(node: Node, source: &[u8], bindings: &mut Vec<String>) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "import_specifier" => {
                if let Some(name) = child
                    .child_by_field_name("local")
                    .or_else(|| child.child_by_field_name("name"))
                {
                    add_unique_binding(bindings, get_node_text(name, source).to_string());
                }
            }
            "namespace_import" => {
                if let Some(name) = child
                    .child_by_field_name("name")
                    .or_else(|| child.child_by_field_name("local"))
                {
                    add_unique_binding(
                        bindings,
                        format!("* as {}", get_node_text(name, source)),
                    );
                }
            }
            "import_clause" | "named_imports" => {
                collect_import_bindings(child, source, bindings);
            }
            "identifier" => {
                add_unique_binding(bindings, get_node_text(child, source).to_string());
            }
            _ => {}
        }
    }
}

fn add_unique_binding(bindings: &mut Vec<String>, name: String) {
    if !bindings.contains(&name) {
        bindings.push(name);
    }
}

fn merge_import_summary(existing: &mut ImportSummary, incoming: ImportSummary) {
    for binding in incoming.bindings {
        add_unique_binding(&mut existing.bindings, binding);
    }
    existing.type_only = existing.type_only && incoming.type_only;
    existing.side_effect = existing.side_effect && incoming.side_effect;
}

fn format_import_bindings(bindings: &[String]) -> String {
    let mut out = String::new();
    for (idx, binding) in bindings.iter().enumerate() {
        if idx >= MAX_IMPORT_SUMMARY_NAMES {
            break;
        }
        if idx > 0 {
            out.push_str(", ");
        }
        out.push_str(binding);
    }
    if bindings.len() > MAX_IMPORT_SUMMARY_NAMES {
        if !out.is_empty() {
            out.push_str(", ");
        }
        out.push_str("...");
    }
    out
}

// ============ Core Extraction ============

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
            if ctx.import_summary_only {
                return;
            }
            output.push_str(&truncate_line(get_node_text(node, source), MAX_DEF_LINE_LEN));
            output.push('\n');
        }

        // Keep exports (but skeletonize what's exported)
        "export_statement" | "export_declaration" => {
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
                output.push_str(&truncate_line(get_node_text(node, source), MAX_DEF_LINE_LEN));
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

        // Variable declarations
        "lexical_declaration" | "variable_declaration" => {
            emit_js_variable_declarations(output, node, source, &indent, skip_non_export, ctx);
        }

        // Class declarations
        "class_declaration" | "abstract_class_declaration" => {
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
            if let Some(summary) = trim_doc_comment(text) {
                output.push_str(&summary);
                output.push('\n');
            }
        }

        // Module/namespace declarations
        "module" | "namespace_declaration" | "ambient_declaration" => {
            if skip_non_export && !js_ts_decl_is_exported(node, source, ctx) {
                return;
            }
            output.push_str(&summarize_block_declaration(get_node_text(node, source)));
            output.push('\n');
        }

        // Program root - recurse into children
        "program" => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                extract_js_ts_skeleton(output, child, source, depth, ctx);
            }
        }

        // Statement blocks and control flow - recurse to find nested declarations
        "statement_block" | "if_statement" | "else_clause" => {
            // Recurse to find function declarations inside guards like:
            // if (window.hasRunPromptPack) { ... } else { function foo() {} }
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                extract_js_ts_skeleton(output, child, source, depth, ctx);
            }
        }

        // Expression statements
        "expression_statement" => {
            let text = get_node_text(node, source);
            if text.starts_with("module.exports") || text.starts_with("exports.") {
                output.push_str(&truncate_line(text, MAX_DEF_LINE_LEN));
                output.push('\n');
            } else if depth == 0 && !skip_non_export {
                if ctx.unwrap_top_level_iife {
                    if let Some(iife_fn) = find_iife_function_in_statement(node, source) {
                        if emit_iife_body(output, iife_fn, source, depth, ctx) {
                            return;
                        }
                    }
                }
                if let Some(summary) = summarize_top_level_call(node, source) {
                    output.push_str(&indent);
                    output.push_str(&summary);
                    output.push('\n');
                }
            }
        }

        _ => {
            if node.child_count() > 0 {
                let mut cursor = node.walk();
                for child in node.children(&mut cursor) {
                    extract_js_ts_skeleton(output, child, source, depth, ctx);
                }
            }
        }
    }
}

// ============ Function Extraction ============

fn extract_js_function_signature(node: Node, source: &[u8]) -> Option<String> {
    let mut parts = Vec::new();
    let mut cursor = node.walk();

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

fn emit_js_function_details<'a>(
    output: &mut String,
    node: Node<'a>,
    source: &'a [u8],
    indent: &str,
    ctx: JsTsContext<'a>,
) {
    // Check for JSX return
    if let Some(jsx_node) = find_jsx_return_node(node, source) {
        emit_js_component_details(output, node, source, indent, ctx, jsx_node);
        return;
    }

    // Emit insights (includes Invokes, Listens, Opens, Render)
    emit_js_ts_insights(output, node, source, indent, ctx.external_imports, ctx.external_bindings, true);
}

fn emit_js_call_edges(output: &mut String, node: Node, source: &[u8], indent: &str) {
    // Use "Calls" format for internal calls (same as Go/Rust)
    let body = node
        .child_by_field_name("body")
        .or_else(|| node.child_by_field_name("block"));
    let Some(body) = body else {
        return;
    };
    let calls = collect_js_calls(body, source);
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

fn collect_js_calls(node: Node, source: &[u8]) -> CallEdgeList {
    let mut list = CallEdgeList {
        entries: Vec::new(),
        truncated: false,
        visited: 0,
    };
    collect_js_calls_rec(node, source, &mut list);
    list
}

fn collect_js_calls_rec(node: Node, source: &[u8], list: &mut CallEdgeList) {
    if list.truncated {
        return;
    }
    list.visited += 1;
    if list.visited > MAX_CALL_EDGE_NODES {
        list.truncated = true;
        return;
    }

    if let Some(name) = js_call_name(node, source) {
        add_unique_entry(&mut list.entries, name, MAX_CALL_EDGE_NAMES);
        if list.entries.len() >= MAX_CALL_EDGE_NAMES {
            list.truncated = true;
            return;
        }
    }

    // Don't descend into nested functions
    if is_js_function_boundary(node.kind()) {
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_js_calls_rec(child, source, list);
        if list.truncated {
            break;
        }
    }
}

fn js_call_name(node: Node, source: &[u8]) -> Option<String> {
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

fn is_js_function_boundary(kind: &str) -> bool {
    matches!(
        kind,
        "function_declaration"
            | "function_expression"
            | "arrow_function"
            | "method_definition"
            | "generator_function"
            | "generator_function_declaration"
    )
}

// ============ Variable Declarations ============

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

fn summarize_js_variable_declarator(node: Node, source: &[u8], keyword: &str) -> Option<String> {
    let text = get_node_text(node, source);
    if text.trim().is_empty() {
        return None;
    }
    let summary = summarize_assignment(text);
    let mut line = if keyword.is_empty() {
        summary
    } else {
        format!("{keyword} {summary}")
    };
    line = truncate_line(&line, MAX_DEF_LINE_LEN);
    Some(line)
}

fn summarize_js_variable_declaration(node: Node, source: &[u8]) -> String {
    summarize_assignment(get_node_text(node, source))
}

// ============ Class Extraction ============

fn extract_js_class_skeleton(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "  ".repeat(depth);
    let member_indent = "  ".repeat(depth + 1);

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
                output.push_str(&indent);
                output.push_str(&truncate_line(&header_parts.join(" "), MAX_DEF_LINE_LEN));
                output.push('\n');

                let mut body_cursor = child.walk();
                for member in child.children(&mut body_cursor) {
                    if js_member_is_private(member, source) {
                        continue;
                    }
                    match member.kind() {
                        "public_field_definition" | "property_definition" | "field_definition" => {
                            // Check if this is a nested class (static Inner = class {...})
                            if let Some(class_node) = js_property_class_expression(member) {
                                // Extract the property name and output as nested class
                                if let Some(name) = js_property_name(member, source) {
                                    output.push_str(&member_indent);
                                    output.push_str("static ");
                                    output.push_str(&name);
                                    output.push_str(" = class\n");
                                    // Extract nested class body
                                    extract_nested_class_body(output, class_node, source, depth + 2);
                                }
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
                            output.push_str(get_node_text(member, source));
                            output.push('\n');
                        }
                        "comment" => {
                            let text = get_node_text(member, source);
                            if let Some(summary) = trim_doc_comment(text) {
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

fn extract_js_method_signature(node: Node, source: &[u8]) -> Option<String> {
    let mut modifiers = Vec::new();
    let mut name = String::new();
    let mut type_params = String::new();
    let mut params = String::new();
    let mut return_type = String::new();
    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        match child.kind() {
            "accessibility_modifier" | "static" | "readonly" | "async" |
            "override" | "abstract" | "get" | "set" => {
                modifiers.push(get_node_text(child, source).to_string());
            }
            "property_identifier" | "identifier" | "private_property_identifier" => {
                name = get_node_text(child, source).to_string();
            }
            "formal_parameters" | "call_signature" => {
                params = get_node_text(child, source).to_string();
            }
            "type_annotation" => {
                return_type = get_node_text(child, source).to_string();
            }
            "type_parameters" => {
                type_params = get_node_text(child, source).to_string();
            }
            _ => {}
        }
    }

    if name.is_empty() {
        return None;
    }

    let mut sig = String::new();
    for modifier in modifiers {
        sig.push_str(&modifier);
        sig.push(' ');
    }
    sig.push_str(&name);
    if !type_params.is_empty() {
        sig.push_str(&type_params);
    }
    sig.push(' ');
    sig.push_str(&params);
    if !return_type.is_empty() {
        sig.push_str(&return_type);
    }

    Some(truncate_line(&sig, MAX_DEF_LINE_LEN))
}

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

fn summarize_js_property_definition(node: Node, source: &[u8]) -> String {
    let text = get_node_text(node, source);
    summarize_assignment(text)
}

fn js_property_class_expression(node: Node) -> Option<Node> {
    let value = node.child_by_field_name("value")?;
    if value.kind() == "class" {
        Some(value)
    } else {
        None
    }
}

fn js_property_name<'a>(node: Node<'a>, source: &'a [u8]) -> Option<String> {
    if let Some(name) = node.child_by_field_name("name") {
        return Some(get_node_text(name, source).to_string());
    }
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if matches!(child.kind(), "property_identifier" | "identifier") {
            return Some(get_node_text(child, source).to_string());
        }
    }
    None
}

fn extract_nested_class_body(output: &mut String, class_node: Node, source: &[u8], depth: usize) {
    let member_indent = "  ".repeat(depth);
    let body = class_node.child_by_field_name("body");
    let Some(body) = body else {
        // Try to find class_body in children
        let mut cursor = class_node.walk();
        for child in class_node.children(&mut cursor) {
            if child.kind() == "class_body" {
                extract_nested_class_body_inner(output, child, source, &member_indent);
                return;
            }
        }
        return;
    };
    extract_nested_class_body_inner(output, body, source, &member_indent);
}

fn extract_nested_class_body_inner(output: &mut String, body: Node, source: &[u8], indent: &str) {
    let mut cursor = body.walk();
    for member in body.children(&mut cursor) {
        match member.kind() {
            "method_definition" | "method_signature" => {
                if let Some(sig) = extract_js_method_signature(member, source) {
                    output.push_str(indent);
                    output.push_str(&sig);
                    output.push('\n');
                }
            }
            "constructor_definition" | "constructor" => {
                if let Some(sig) = extract_js_constructor_signature(member, source) {
                    output.push_str(indent);
                    output.push_str(&sig);
                    output.push('\n');
                }
            }
            _ => {}
        }
    }
}

// ============ JSX Handling ============

fn find_jsx_return_node<'a>(node: Node<'a>, source: &'a [u8]) -> Option<Node<'a>> {
    let body = node.child_by_field_name("body")?;
    find_jsx_return_in_body(body, source)
}

fn find_jsx_return_in_body<'a>(node: Node<'a>, source: &'a [u8]) -> Option<Node<'a>> {
    // Direct JSX return (arrow function body is JSX)
    if matches!(node.kind(), "jsx_element" | "jsx_self_closing_element" | "jsx_fragment") {
        return Some(node);
    }

    // Look for return statements
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "return_statement" {
            if let Some(jsx) = find_jsx_in_node(child) {
                return Some(jsx);
            }
        }
        // Recurse into blocks
        if matches!(child.kind(), "statement_block" | "block") {
            if let Some(jsx) = find_jsx_return_in_body(child, source) {
                return Some(jsx);
            }
        }
    }
    None
}

fn find_jsx_in_node(node: Node) -> Option<Node> {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if matches!(child.kind(), "jsx_element" | "jsx_self_closing_element" | "jsx_fragment") {
            return Some(child);
        }
        if matches!(child.kind(), "parenthesized_expression" | "jsx_expression") {
            if let Some(jsx) = find_jsx_in_node(child) {
                return Some(jsx);
            }
        }
    }
    None
}

fn emit_js_component_details<'a>(
    output: &mut String,
    node: Node<'a>,
    source: &'a [u8],
    indent: &str,
    ctx: JsTsContext<'a>,
    jsx_node: Node<'a>,
) {
    // Emit hooks
    emit_js_hooks(output, node, source, indent);

    // Emit effects
    emit_js_effects(output, node, source, indent, ctx.external_bindings);

    // Emit handlers (only in entrypoint mode)
    if ctx.entrypoint_mode {
        emit_js_component_handlers(output, node, source, indent, ctx.external_bindings, jsx_node);
    }

    // Emit Listens and Opens (in entrypoint mode)
    if ctx.entrypoint_mode {
        let listens = collect_js_listens(node, source, ctx.external_bindings);
        if !listens.entries.is_empty() {
            output.push_str(indent);
            output.push_str("// Listens: ");
            output.push_str(&listens.entries.join(", "));
            if listens.truncated {
                output.push_str(", ...");
            }
            output.push('\n');
        }

        let opens = collect_js_opens(node, source, ctx.external_bindings);
        if !opens.entries.is_empty() {
            output.push_str(indent);
            output.push_str("// Opens: ");
            output.push_str(&opens.entries.join(", "));
            if opens.truncated {
                output.push_str(", ...");
            }
            output.push('\n');
        }
    }

    // Emit JSX components rendered
    let mut components = collect_jsx_components(jsx_node, source);
    if let Some(external) = ctx.external_imports {
        components.entries.retain(|entry| !external.contains(entry));
    }
    if !components.entries.is_empty() {
        output.push_str(indent);
        output.push_str("// Render: ");
        output.push_str(&components.entries.join(", "));
        if components.truncated {
            output.push_str(", ...");
        }
        output.push('\n');
    }
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

    if let Some(name) = jsx_component_name(node, source) {
        add_unique_entry(&mut list.entries, name, MAX_JSX_COMPONENTS);
        if list.entries.len() >= MAX_JSX_COMPONENTS {
            list.truncated = true;
            return;
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

fn jsx_component_name(node: Node, source: &[u8]) -> Option<String> {
    if !matches!(node.kind(), "jsx_element" | "jsx_self_closing_element") {
        return None;
    }

    let name_node = node.child_by_field_name("name")
        .or_else(|| {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if child.kind() == "jsx_opening_element" {
                    return child.child_by_field_name("name");
                }
            }
            None
        });

    let Some(name_node) = name_node else {
        return Some("Layout".to_string());
    };

    let name = get_node_text(name_node, source);
    if is_jsx_component_name(name) {
        Some(name.to_string())
    } else {
        // Lowercase elements like <div>, <span> are represented as "Layout"
        Some("Layout".to_string())
    }
}

fn is_jsx_component_name(name: &str) -> bool {
    name.chars().next().map_or(false, |c| c.is_uppercase())
}

// ============ React Hooks and Effects ============

fn emit_js_hooks(output: &mut String, node: Node, source: &[u8], indent: &str) {
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

fn collect_js_hook_model(node: Node, source: &[u8]) -> JsHookModel {
    let Some(body) = node.child_by_field_name("body") else {
        return JsHookModel {
            state: JsHookEntries { entries: Vec::new(), truncated: false },
            refs: JsHookEntries { entries: Vec::new(), truncated: false },
            reducers: JsHookEntries { entries: Vec::new(), truncated: false },
        };
    };
    let mut model = JsHookModel {
        state: JsHookEntries { entries: Vec::new(), truncated: false },
        refs: JsHookEntries { entries: Vec::new(), truncated: false },
        reducers: JsHookEntries { entries: Vec::new(), truncated: false },
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

fn js_call_argument(node: Node, index: usize) -> Option<Node> {
    let args = node.child_by_field_name("arguments")?;
    let mut cursor = args.walk();
    let mut count = 0;
    for child in args.children(&mut cursor) {
        if !child.is_named() {
            continue;
        }
        if count == index {
            return Some(child);
        }
        count += 1;
    }
    None
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

fn collect_js_effects(
    node: Node,
    source: &[u8],
    _external_bindings: Option<&HashSet<String>>,
) -> Vec<JsEffectSummary> {
    let Some(body) = node.child_by_field_name("body") else {
        return Vec::new();
    };
    let mut effects = Vec::new();
    let mut visited = 0;
    collect_js_effects_rec(body, source, &mut effects, &mut visited, true);
    effects
}

fn collect_js_effects_rec(
    node: Node,
    source: &[u8],
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
                let calls = collect_effect_calls(node, source);
                effects.push(JsEffectSummary { name, deps, calls });
            }
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if !child.is_named() {
            continue;
        }
        collect_js_effects_rec(child, source, effects, visited, false);
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

fn collect_effect_calls(node: Node, source: &[u8]) -> CallEdgeList {
    let mut list = CallEdgeList {
        entries: Vec::new(),
        truncated: false,
        visited: 0,
    };

    // Get the callback argument (first argument)
    if let Some(callback) = js_call_argument(node, 0) {
        collect_js_calls_rec(callback, source, &mut list);
    }

    list
}

// ============ Handler Detection ============

fn emit_js_component_handlers<'a>(
    output: &mut String,
    node: Node<'a>,
    source: &'a [u8],
    indent: &str,
    external_bindings: Option<&HashSet<String>>,
    jsx_node: Node<'a>,
) {
    let handler_names = collect_jsx_event_handlers(jsx_node, source);
    let handlers = collect_js_local_functions(node, source, &handler_names, external_bindings);
    for handler in handlers.into_iter().take(MAX_JS_HOOKS) {
        let sig = format_js_handler_signature(&handler.name, handler.node, source);
        if sig.is_empty() {
            continue;
        }
        output.push_str(indent);
        output.push_str("// Handler: ");
        output.push_str(&sig);
        output.push('\n');
    }
}

fn collect_jsx_event_handlers(node: Node, source: &[u8]) -> HashSet<String> {
    let mut names = HashSet::new();
    collect_jsx_event_handlers_rec(node, source, &mut names, 0);
    names
}

fn collect_jsx_event_handlers_rec(
    node: Node,
    source: &[u8],
    names: &mut HashSet<String>,
    visited: usize,
) {
    if visited > MAX_JS_INSIGHT_NODES {
        return;
    }

    // Only check jsx_attribute nodes for event handlers
    if node.kind() == "jsx_attribute" {
        if let Some(handler_name) = extract_jsx_event_handler(node, source) {
            names.insert(handler_name);
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_jsx_event_handlers_rec(child, source, names, visited + 1);
    }
}

fn extract_jsx_event_handler(node: Node, source: &[u8]) -> Option<String> {
    if node.kind() != "jsx_attribute" {
        return None;
    }
    // Look for the attribute name (first identifier-like child)
    let mut cursor = node.walk();
    let mut attr_name = None;
    let mut value_node = None;

    for child in node.children(&mut cursor) {
        match child.kind() {
            "property_identifier" | "identifier" => {
                if attr_name.is_none() {
                    attr_name = Some(get_node_text(child, source));
                }
            }
            "jsx_expression" | "string" | "jsx_element" => {
                value_node = Some(child);
            }
            _ => {}
        }
    }

    let attr_name = attr_name?;
    if !attr_name.starts_with("on") {
        return None;
    }
    let value_node = value_node?;
    jsx_handler_name_from_value(value_node, source)
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
        "call_expression" => {
            if let Some(func) = node.child_by_field_name("function") {
                return find_handler_name_in_expr(func, source, budget);
            }
        }
        "arrow_function" | "function" | "function_expression" => {
            if let Some(body) = node.child_by_field_name("body") {
                let mut inner_budget = 200;
                if let Some(call_expr) = find_call_expression(body, &mut inner_budget) {
                    if let Some(func) = call_expr.child_by_field_name("function") {
                        return find_handler_name_in_expr(func, source, budget);
                    }
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

fn collect_js_local_functions<'a>(
    node: Node<'a>,
    source: &'a [u8],
    target_names: &HashSet<String>,
    _external_bindings: Option<&HashSet<String>>,
) -> Vec<JsLocalFunction<'a>> {
    let mut functions = Vec::new();
    let body = node.child_by_field_name("body");
    let search_node = body.unwrap_or(node);
    collect_js_local_functions_rec(search_node, source, target_names, &mut functions, true);
    functions
}

fn collect_js_local_functions_rec<'a>(
    node: Node<'a>,
    source: &'a [u8],
    target_names: &HashSet<String>,
    functions: &mut Vec<JsLocalFunction<'a>>,
    is_root: bool,
) {
    if !is_root && is_js_function_boundary(node.kind()) {
        return;
    }

    if node.kind() == "variable_declarator" {
        if let Some(name) = js_declarator_name(node, source) {
            if target_names.contains(&name) {
                if let Some(func_node) = js_declarator_function(node) {
                    functions.push(JsLocalFunction { name, node: func_node });
                }
            }
        }
    }

    if node.kind() == "function_declaration" {
        if let Some(name) = js_declared_name(node, source) {
            if target_names.contains(&name) {
                functions.push(JsLocalFunction { name, node });
            }
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_js_local_functions_rec(child, source, target_names, functions, false);
    }
}

fn format_js_handler_signature(name: &str, node: Node, _source: &[u8]) -> String {
    let is_async = js_function_is_async(node);
    let mut sig = String::new();
    if is_async {
        sig.push_str("async ");
    }
    sig.push_str(name);
    truncate_line(&sig, MAX_DEF_LINE_LEN)
}

// ============ JS/TS Insights ============

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

    if include_renders {
        let mut components = collect_jsx_components(node, source);
        if let Some(external) = external_imports {
            components.entries.retain(|entry| !external.contains(entry));
        }
        if !components.entries.is_empty() {
            output.push_str(indent);
            output.push_str("// Render: ");
            output.push_str(&components.entries.join(", "));
            if components.truncated {
                output.push_str(", ...");
            }
            output.push('\n');
        }
    }
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
    Some(truncate_line(callee_text, MAX_JS_INSIGHT_NAME_LEN))
}

fn js_callee_is_invoke(
    node: Node,
    source: &[u8],
    external_bindings: Option<&HashSet<String>>,
) -> bool {
    match node.kind() {
        "identifier" => {
            let name = get_node_text(node, source);
            // Match explicit Tauri invoke() or any external binding
            if name == "invoke" {
                return external_bindings.map_or(true, |bindings| bindings.contains(name));
            }
            // Also match calls to imported external bindings
            if let Some(bindings) = external_bindings {
                return bindings.contains(name);
            }
            false
        }
        "member_expression" => {
            // For member expressions like axios.get, window.alert
            let root = js_member_expression_root_identifier(node, source);
            // Match if root is an external binding (e.g., axios.get)
            if let (Some(bindings), Some(root_name)) = (external_bindings, root) {
                if bindings.contains(root_name) {
                    return true;
                }
            }
            // Also match window.* and globalThis.* calls
            matches!(root, Some("window") | Some("globalThis") | Some("tauri"))
        }
        _ => false,
    }
}

fn js_member_expression_property_name(node: Node, source: &[u8]) -> Option<String> {
    let prop = node.child_by_field_name("property")?;
    if matches!(prop.kind(), "property_identifier" | "identifier") {
        Some(get_node_text(prop, source).to_string())
    } else {
        None
    }
}

fn js_member_expression_root_identifier<'a>(node: Node<'a>, source: &'a [u8]) -> Option<&'a str> {
    let obj = node.child_by_field_name("object")?;
    if obj.kind() == "identifier" {
        Some(get_node_text(obj, source))
    } else if obj.kind() == "member_expression" {
        js_member_expression_root_identifier(obj, source)
    } else {
        None
    }
}

// ============ Listen/Open Detection ============

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

// ============ Exports and Imports ============

pub fn collect_js_ts_exports(root: Node, source: &[u8]) -> JsTsExports {
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

fn collect_js_ts_export_names(node: Node, source: &[u8], names: &mut HashSet<String>) {
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

fn js_ts_is_exported_name(ctx: JsTsContext<'_>, name: &str) -> bool {
    match ctx.exported_names {
        Some(names) => names.contains(name),
        None => false,
    }
}

fn js_ts_decl_is_exported(node: Node, source: &[u8], ctx: JsTsContext<'_>) -> bool {
    let Some(names) = ctx.exported_names else {
        return false;
    };
    let Some(name) = js_declared_name(node, source) else {
        return false;
    };
    names.contains(&name)
}

pub fn collect_js_ts_external_imports(root: Node, source: &[u8]) -> JsTsExternalImports {
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

// ============ Entrypoint Detection ============

fn js_ts_is_entrypoint(
    root: Node,
    source: &[u8],
    file_path: Option<&str>,
    is_tsx: bool,
) -> bool {
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
    if is_tsx {
        js_ts_has_default_exported_component(root, source)
    } else {
        false
    }
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

// ============ Utility Functions ============

fn js_string_literal(node: Node, source: &[u8]) -> Option<String> {
    let raw = get_node_text(node, source);
    if raw.contains("${") {
        return None;
    }
    strip_js_string_quotes(raw)
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

fn summarize_ts_declaration(node: Node, source: &[u8]) -> String {
    let text = get_node_text(node, source);
    match node.kind() {
        "type_alias_declaration" => summarize_type_alias(text),
        "interface_declaration" | "enum_declaration" => summarize_block_declaration(text),
        _ => truncate_line(text, MAX_DEF_LINE_LEN),
    }
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

fn summarize_assignment(text: &str) -> String {
    let text = text.trim();
    if text.len() <= MAX_SIMPLE_CONST_LEN {
        return truncate_line(text, MAX_DEF_LINE_LEN);
    }
    if let Some(eq_pos) = text.find('=') {
        let lhs = text[..eq_pos].trim_end();
        return truncate_line(&format!("{lhs} = ..."), MAX_DEF_LINE_LEN);
    }
    truncate_line(text, MAX_DEF_LINE_LEN)
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

fn find_iife_function_in_statement<'a>(node: Node<'a>, _source: &'a [u8]) -> Option<Node<'a>> {
    let mut budget = 200;
    let call_expr = find_call_expression(node, &mut budget)?;
    let callee = call_expr.child_by_field_name("function")?;
    find_iife_function(callee)
}

fn find_iife_function<'a>(node: Node<'a>) -> Option<Node<'a>> {
    match node.kind() {
        "function" | "function_expression" | "arrow_function" => return Some(node),
        "parenthesized_expression" | "unary_expression" | "await_expression" => {}
        _ => return None,
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if let Some(found) = find_iife_function(child) {
            return Some(found);
        }
    }
    None
}

fn emit_iife_body(
    output: &mut String,
    func_node: Node,
    source: &[u8],
    depth: usize,
    ctx: JsTsContext,
) -> bool {
    let body = func_node
        .child_by_field_name("body")
        .or_else(|| func_node.child_by_field_name("block"))
        .or_else(|| func_node.child_by_field_name("statement_block"));
    let Some(body) = body else {
        return false;
    };
    if body.kind() != "statement_block" {
        return false;
    }

    let indent = "  ".repeat(depth);
    output.push_str(&indent);
    output.push_str(&format!("{} {{\n", iife_label(func_node)));

    let mut cursor = body.walk();
    for child in body.named_children(&mut cursor) {
        extract_js_ts_skeleton(output, child, source, depth + 1, ctx);
    }

    output.push_str(&indent);
    output.push_str("}\n");
    true
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

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;
    use tree_sitter::Parser;

    fn parse_ts(code: &str) -> String {
        let mut parser = Parser::new();
        parser.set_language(&tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()).unwrap();
        let tree = parser.parse(code, None).unwrap();
        extract_skeleton(code, tree.root_node(), code.as_bytes(), None, false)
    }

    fn parse_tsx(code: &str) -> String {
        let mut parser = Parser::new();
        parser.set_language(&tree_sitter_typescript::LANGUAGE_TSX.into()).unwrap();
        let tree = parser.parse(code, None).unwrap();
        extract_skeleton(code, tree.root_node(), code.as_bytes(), None, true)
    }

    #[test]
    fn test_typescript_imports() {
        let code = r#"import { useState } from 'react';
import axios from 'axios';
"#;
        let skeleton = parse_ts(code);
        assert!(skeleton.contains("import { useState }"));
        assert!(skeleton.contains("import axios"));
    }

    #[test]
    fn test_typescript_function() {
        let code = r#"
export function greet(name: string): string {
    return `Hello, ${name}!`;
}
"#;
        let skeleton = parse_ts(code);
        assert!(skeleton.contains("export function greet"));
        assert!(skeleton.contains("(name: string)"));
    }

    #[test]
    fn test_typescript_interface() {
        let code = r#"
interface User {
    id: number;
    name: string;
    email: string;
}
"#;
        let skeleton = parse_ts(code);
        assert!(skeleton.contains("interface User"));
    }

    #[test]
    fn test_typescript_class() {
        let code = r#"
export class UserService {
    private api: string;

    constructor(api: string) {
        this.api = api;
    }

    async getUser(id: number): Promise<User> {
        return fetch(this.api + '/users/' + id);
    }
}
"#;
        let skeleton = parse_ts(code);
        assert!(skeleton.contains("export class UserService"));
        assert!(skeleton.contains("constructor"));
        assert!(skeleton.contains("getUser"));
    }

    #[test]
    fn test_react_component() {
        let code = r#"
import React, { useState } from 'react';

export function Counter(): JSX.Element {
    const [count, setCount] = useState(0);

    return <div>{count}</div>;
}
"#;
        let skeleton = parse_tsx(code);
        assert!(skeleton.contains("export function Counter"));
        assert!(skeleton.contains("useState"));
    }

    #[test]
    fn test_unwrap_iife_for_readable_files() {
        let mut code = String::from("(() => {\n");
        code.push_str("  const a = 1;\n");
        code.push_str("  function foo() {}\n");
        for i in 0..35 {
            code.push_str(&format!("  const v{} = {};\n", i, i));
        }
        code.push_str("})();\n");

        let skeleton = parse_ts(&code);
        assert!(skeleton.contains("IIFE {"));
        assert!(skeleton.contains("function foo"));
        assert!(skeleton.contains("const a"));
    }
}
