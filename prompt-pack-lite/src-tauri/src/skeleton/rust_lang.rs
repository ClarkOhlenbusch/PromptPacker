//! Rust-specific skeleton extraction using tree-sitter AST.
//!
//! This module handles Rust files (.rs) with special handling for:
//! - Use statements
//! - Module declarations
//! - Struct and enum definitions
//! - Trait definitions and implementations
//! - Function signatures with call edges
//! - Doc comments (/// and //!)

use tree_sitter::Node;

use super::common::{
    get_node_text, truncate_line, compact_text_prefix, trim_doc_comment,
    CallEdgeList,
    MAX_DEF_LINE_LEN, MAX_SIMPLE_CONST_LEN, MAX_MEMBER_NAMES,
    MAX_CALL_EDGE_NAMES, MAX_CALL_EDGE_NAME_LEN, MAX_CALL_EDGE_NODES,
};

// ============ Main Entry Point ============

/// Extract skeleton from Rust source code
pub fn extract_skeleton(content: &str, root: Node, source: &[u8]) -> String {
    let _ = content; // Used for potential future enhancements
    let mut output = String::new();
    extract_rust_skeleton(&mut output, root, source, 0);
    output
}

/// Internal recursive skeleton extraction
fn extract_rust_skeleton(output: &mut String, node: Node, source: &[u8], depth: usize) {
    match node.kind() {
        // Keep use statements
        "use_declaration" => {
            output.push_str(&truncate_line(get_node_text(node, source), MAX_DEF_LINE_LEN));
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
                output.push_str(text);
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
            output.push_str(&summarize_assignment(get_node_text(node, source)));
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
            output.push_str(&summarize_assignment(get_node_text(node, source)));
            output.push('\n');
        }

        // Macro definitions (keep signature)
        "macro_definition" => {
            let text = get_node_text(node, source);
            if let Some(brace_pos) = text.find('{') {
                output.push_str(&truncate_line(text[..brace_pos].trim(), MAX_DEF_LINE_LEN));
                output.push('\n');
            } else {
                output.push_str(&truncate_line(text, MAX_DEF_LINE_LEN));
                output.push('\n');
            }
        }

        // Attributes (keep them, they're important)
        "attribute_item" | "inner_attribute_item" => {
            output.push_str(&truncate_line(get_node_text(node, source), MAX_DEF_LINE_LEN));
            output.push('\n');
        }

        // Line/block comments with docs
        "line_comment" | "block_comment" => {
            let text = get_node_text(node, source);
            if let Some(summary) = trim_doc_comment(text) {
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

// ============ Module Extraction ============

/// Extract Rust module skeleton
fn extract_rust_mod_skeleton(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "    ".repeat(depth);
    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        match child.kind() {
            "visibility_modifier" => {
                output.push_str(&indent);
                output.push_str(get_node_text(child, source));
                output.push(' ');
            }
            "mod" => {
                if output.is_empty() || !output.ends_with(' ') {
                    output.push_str(&indent);
                }
                output.push_str("mod ");
            }
            "identifier" => {
                output.push_str(get_node_text(child, source));
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

// ============ Function Extraction ============

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
        let signature = truncate_line(text, MAX_DEF_LINE_LEN);
        output.push_str(&indent);
        output.push_str(&signature);
        output.push('\n');
        emit_rust_call_edges(output, node, source, &indent);
    }
}

/// Emit call edges for a Rust function
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

/// Collect function calls from a Rust node
fn collect_rust_calls(node: Node, source: &[u8]) -> CallEdgeList {
    let mut list = CallEdgeList::new();
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
        if !list.entries.contains(&name) {
            if list.entries.len() < MAX_CALL_EDGE_NAMES {
                list.entries.push(name);
            } else {
                list.truncated = true;
                return;
            }
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

/// Extract the name of a Rust function call
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

/// Check if a node kind represents a scope boundary
fn rust_is_scope_boundary(kind: &str) -> bool {
    matches!(kind, "function_item" | "closure_expression")
}

// ============ Trait Extraction ============

/// Extract Rust trait skeleton
fn extract_rust_trait_skeleton(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "    ".repeat(depth);
    let member_indent = "    ".repeat(depth + 1);

    let mut cursor = node.walk();
    let mut header = String::new();

    for child in node.children(&mut cursor) {
        match child.kind() {
            "visibility_modifier" => {
                header.push_str(get_node_text(child, source));
                header.push(' ');
            }
            "trait" => header.push_str("trait "),
            "type_identifier" => {
                if header.contains("trait ") {
                    header.push_str(get_node_text(child, source));
                }
            }
            "type_parameters" => header.push_str(get_node_text(child, source)),
            "trait_bounds" | "where_clause" => {
                header.push(' ');
                header.push_str(get_node_text(child, source));
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
                                let signature = truncate_line(text, MAX_DEF_LINE_LEN);
                                output.push_str(&signature);
                            }
                            output.push('\n');
                        }
                        "associated_type" | "const_item" => {
                            output.push_str(&member_indent);
                            output.push_str(get_node_text(item, source));
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

// ============ Impl Extraction ============

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
                            output.push_str(get_node_text(item, source));
                            output.push('\n');
                        }
                        _ => {}
                    }
                }
            }
        }
    }
}

// ============ Summarization Helpers ============

/// Summarize an assignment or type alias
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

/// Summarize a Rust struct definition
fn summarize_rust_struct(node: Node, source: &[u8]) -> String {
    let text = get_node_text(node, source);
    if let Some(brace_pos) = text.find('{') {
        let header = text[..brace_pos].trim_end();
        let (names, truncated) = rust_collect_struct_fields(node, source);
        let body = if names.is_empty() {
            "...".to_string()
        } else {
            let mut joined = names.join(", ");
            if truncated {
                joined.push_str(", ...");
            }
            truncate_line(&joined, MAX_DEF_LINE_LEN)
        };
        return truncate_line(&format!("{header} {{ {body} }}"), MAX_DEF_LINE_LEN);
    }
    if let Some(paren_pos) = text.find('(') {
        let header = text[..paren_pos].trim_end();
        return truncate_line(&format!("{header} (...)"), MAX_DEF_LINE_LEN);
    }
    truncate_line(text, MAX_DEF_LINE_LEN)
}

/// Summarize a Rust enum definition
fn summarize_rust_enum(node: Node, source: &[u8]) -> String {
    let text = get_node_text(node, source);
    if let Some(brace_pos) = text.find('{') {
        let header = text[..brace_pos].trim_end();
        let (names, truncated) = rust_collect_enum_variants(node, source);
        let body = if names.is_empty() {
            "...".to_string()
        } else {
            let mut joined = names.join(", ");
            if truncated {
                joined.push_str(", ...");
            }
            truncate_line(&joined, MAX_DEF_LINE_LEN)
        };
        return truncate_line(&format!("{header} {{ {body} }}"), MAX_DEF_LINE_LEN);
    }
    truncate_line(text, MAX_DEF_LINE_LEN)
}

/// Collect field names from a Rust struct
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

/// Collect variant names from a Rust enum
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

#[cfg(test)]
mod tests {
    #[allow(unused_imports)]
    use super::*;

    #[test]
    fn test_module_compiles() {
        // Ensure the module compiles correctly
    }
}
