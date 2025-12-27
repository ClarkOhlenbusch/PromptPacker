//! Python-specific skeleton extraction using tree-sitter AST.
//!
//! This module handles Python files (.py, .pyw, .pyi) with special handling for:
//! - Function and class definitions with docstrings
//! - Import statements
//! - Type annotations
//! - Decorators
//! - Comment classification (structural, explanatory, TODO, etc.)
//! - Small body optimization (keep full body for small functions)

use std::collections::HashSet;
use tree_sitter::Node;

use super::common::{
    get_node_text, truncate_line, trim_docstring,
    classify_comment, should_keep_comment, collect_summary_phrases,
    CallEdgeList, StateContract,
    MAX_DEF_LINE_LEN, MAX_CLASS_ATTR_LEN, MAX_SIMPLE_ASSIGNMENT_LEN,
    MAX_CALL_EDGE_NAMES, MAX_CALL_EDGE_NAME_LEN, MAX_CALL_EDGE_NODES,
};

// ============ Context ============

/// Context for Python skeleton extraction
#[derive(Clone, Copy)]
pub struct PythonContext<'a> {
    pub external_bindings: Option<&'a HashSet<String>>,
    pub is_nested: bool,
}

impl<'a> PythonContext<'a> {
    pub fn new(external_bindings: Option<&'a HashSet<String>>) -> Self {
        Self {
            external_bindings,
            is_nested: false,
        }
    }

    pub fn nested(self) -> Self {
        Self {
            is_nested: true,
            ..self
        }
    }
}

// ============ Main Entry Point ============

/// Extract skeleton from Python source code
pub fn extract_skeleton(_content: &str, root: Node, source: &[u8]) -> String {
    let imports = collect_imports(root, source);
    let ctx = PythonContext::new(Some(&imports));

    let mut output = String::new();
    extract_python_skeleton(&mut output, root, source, 0, ctx);
    output
}

/// Internal recursive skeleton extraction
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
                output.push_str(&truncate_line(get_node_text(node, source), MAX_DEF_LINE_LEN));
                output.push('\n');
            }
        }

        // Function definitions
        "function_definition" => {
            extract_function_skeleton(output, node, source, depth, ctx);
        }

        // Decorated definitions (functions or classes with decorators)
        "decorated_definition" => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                match child.kind() {
                    "decorator" => {
                        output.push_str(&indent);
                        output.push_str(&truncate_line(get_node_text(child, source), MAX_DEF_LINE_LEN));
                        output.push('\n');
                    }
                    "function_definition" => {
                        extract_function_skeleton(output, child, source, depth, ctx);
                    }
                    "class_definition" => {
                        extract_class_skeleton(output, child, source, depth, ctx);
                    }
                    _ => {}
                }
            }
        }

        // Class definitions
        "class_definition" => {
            extract_class_skeleton(output, node, source, depth, ctx);
        }

        // Top-level assignments (constants, type aliases) or docstrings
        "assignment" | "expression_statement" => {
            let text = get_node_text(node, source);
            if node.kind() == "expression_statement" {
                if let Some(summary) = trim_docstring(text) {
                    output.push_str(&indent);
                    output.push_str(&summary);
                    output.push('\n');
                    return;
                }
            }

            if is_simple_assignment(node, source, MAX_SIMPLE_ASSIGNMENT_LEN) {
                output.push_str(&indent);
                output.push_str(text);
                output.push('\n');
            }
        }

        // Type alias (Python 3.12+)
        "type_alias_statement" => {
            if !ctx.is_nested {
                output.push_str(&indent);
                output.push_str(get_node_text(node, source));
                output.push('\n');
            }
        }

        // Comments - now with classification!
        "comment" => {
            let text = get_node_text(node, source);
            let comment_type = classify_comment(text, "#");

            if should_keep_comment(comment_type) {
                output.push_str(&indent);
                output.push_str(&truncate_line(text, MAX_DEF_LINE_LEN));
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

// ============ Function Extraction ============

/// Extract skeleton for a Python function definition
fn extract_function_skeleton(
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
                    signature.push_str(get_node_text(child, source));
                }
            }
            "parameters" | "lambda_parameters" => {
                signature.push_str(get_node_text(child, source));
            }
            "type" => {
                signature.push_str(" -> ");
                signature.push_str(get_node_text(child, source));
            }
            "block" => {
                body_node = Some(child);
                // Look for docstring - check first child of block
                if let Some(first_stmt) = child.child(0) {
                    if first_stmt.kind() == "expression_statement" {
                        if let Some(expr) = first_stmt.child(0) {
                            if expr.kind() == "string" {
                                let text = get_node_text(expr, source);
                                if let Some(summary) = trim_docstring(text) {
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

    // Output signature
    let signature = truncate_line(&signature, MAX_DEF_LINE_LEN);
    output.push_str(&indent);
    output.push_str(&signature);
    output.push_str(":\n");

    // Output docstring if found
    if let Some(doc) = &docstring {
        output.push_str(&body_indent);
        output.push_str(doc);
        output.push('\n');
    }

    if let Some(body) = body_node {
        let body_text = get_node_text(body, source);

        // Emit call edges
        emit_call_edges(output, body, source, &body_indent, ctx.external_bindings);

        // Emit summary phrases
        let phrases = collect_summary_phrases(body_text);
        if !phrases.is_empty() {
            output.push_str(&body_indent);
            output.push_str("# summary: ");
            output.push_str(&phrases.join(", "));
            output.push('\n');
        }

        // Recurse into body to find nested definitions
        let nested_ctx = ctx.nested();
        let mut body_cursor = body.walk();
        for child in body.children(&mut body_cursor) {
            match child.kind() {
                "function_definition" | "class_definition" | "decorated_definition" => {
                    extract_python_skeleton(output, child, source, depth + 1, nested_ctx);
                }
                _ => {}
            }
        }

        output.push_str(&body_indent);
        output.push_str("...\n");
    }
}

// ============ Class Extraction ============

/// Extract skeleton for a Python class definition
fn extract_class_skeleton(
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
                    header.push_str(get_node_text(child, source));
                }
            }
            "argument_list" | "superclasses" => {
                header.push_str(get_node_text(child, source));
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
                            extract_function_skeleton(output, member, source, depth + 1, ctx);
                        }
                        "decorated_definition" => {
                            let mut dec_cursor = member.walk();
                            for dec_child in member.children(&mut dec_cursor) {
                                match dec_child.kind() {
                                    "decorator" => {
                                        output.push_str(&member_indent);
                                        output.push_str(&truncate_line(get_node_text(dec_child, source), MAX_DEF_LINE_LEN));
                                        output.push('\n');
                                    }
                                    "function_definition" => {
                                        extract_function_skeleton(output, dec_child, source, depth + 1, ctx);
                                    }
                                    "class_definition" => {
                                        extract_class_skeleton(output, dec_child, source, depth + 1, ctx);
                                    }
                                    _ => {}
                                }
                            }
                        }
                        "expression_statement" | "assignment" => {
                            let text = get_node_text(member, source);
                            if member.kind() == "expression_statement" {
                                if let Some(summary) = trim_docstring(text) {
                                    output.push_str(&member_indent);
                                    output.push_str(&summary);
                                    output.push('\n');
                                    continue;
                                }
                            }

                            if is_simple_assignment(member, source, MAX_CLASS_ATTR_LEN) {
                                output.push_str(&member_indent);
                                output.push_str(text);
                                output.push('\n');
                            }
                        }
                        "comment" => {
                            let text = get_node_text(member, source);
                            let comment_type = classify_comment(text, "#");
                            if should_keep_comment(comment_type) {
                                output.push_str(&member_indent);
                                output.push_str(&truncate_line(text, MAX_DEF_LINE_LEN));
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

// ============ Call Edge Emission ============

/// Emit function call edges for a function body
fn emit_call_edges(
    output: &mut String,
    node: Node,
    source: &[u8],
    indent: &str,
    external_bindings: Option<&HashSet<String>>,
) {
    let calls = collect_calls(node, source, external_bindings);
    if calls.is_empty() {
        return;
    }

    // Prioritize external calls over local
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

/// Collect function calls from a node
fn collect_calls(
    node: Node,
    source: &[u8],
    external_bindings: Option<&HashSet<String>>,
) -> CallEdgeList {
    let mut list = CallEdgeList::new();
    collect_calls_rec(node, source, &mut list, external_bindings);
    list
}

fn collect_calls_rec(
    node: Node,
    source: &[u8],
    list: &mut CallEdgeList,
    _external_bindings: Option<&HashSet<String>>,
) {
    if list.truncated {
        return;
    }
    list.visited += 1;
    if list.visited > MAX_CALL_EDGE_NODES {
        list.truncated = true;
        return;
    }

    if let Some(name) = call_name(node, source) {
        if !list.entries.contains(&name) {
            if list.entries.len() < MAX_CALL_EDGE_NAMES * 2 {
                list.entries.push(name);
            } else {
                list.truncated = true;
            }
        }
    }

    if is_scope_boundary(node.kind()) {
        return;
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_calls_rec(child, source, list, _external_bindings);
        if list.truncated {
            break;
        }
    }
}

/// Extract the name of a function call
fn call_name(node: Node, source: &[u8]) -> Option<String> {
    if node.kind() != "call" {
        return None;
    }
    let func = node
        .child_by_field_name("function")
        .or_else(|| node.child(0))?;

    let text = get_node_text(func, source);
    let name = text.trim();
    if name.is_empty() {
        return None;
    }

    // Truncate if too long
    if name.len() > MAX_CALL_EDGE_NAME_LEN {
        Some(format!("{}...", &name[..MAX_CALL_EDGE_NAME_LEN]))
    } else {
        Some(name.to_string())
    }
}

/// Check if a node kind represents a scope boundary (stop recursing)
fn is_scope_boundary(kind: &str) -> bool {
    matches!(kind, "function_definition" | "class_definition" | "lambda")
}

// ============ Import Collection ============

/// Collect all imported names from a Python module
pub fn collect_imports(root: Node, source: &[u8]) -> HashSet<String> {
    let mut names = HashSet::new();
    let mut cursor = root.walk();

    for child in root.children(&mut cursor) {
        match child.kind() {
            "import_statement" => {
                collect_import_statement_names(child, source, &mut names);
            }
            "import_from_statement" => {
                collect_import_from_names(child, source, &mut names);
            }
            _ => {}
        }
    }
    names
}

fn collect_import_statement_names(node: Node, source: &[u8], names: &mut HashSet<String>) {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "dotted_name" {
            let text = get_node_text(child, source);
            let root_part = text.split('.').next().unwrap_or(text);
            names.insert(root_part.to_string());
        } else if child.kind() == "aliased_import" {
            if let Some(alias) = child.child_by_field_name("alias") {
                names.insert(get_node_text(alias, source).to_string());
            } else if let Some(name) = child.child_by_field_name("name") {
                let text = get_node_text(name, source);
                let root_part = text.split('.').next().unwrap_or(text);
                names.insert(root_part.to_string());
            }
        }
    }
}

fn collect_import_from_names(node: Node, source: &[u8], names: &mut HashSet<String>) {
    let mut found_import = false;
    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        if child.kind() == "import" {
            found_import = true;
            continue;
        }
        if !found_import {
            continue;
        }

        match child.kind() {
            "identifier" | "name" => {
                names.insert(get_node_text(child, source).to_string());
            }
            "aliased_import" => {
                if let Some(alias) = child.child_by_field_name("alias") {
                    names.insert(get_node_text(alias, source).to_string());
                } else if let Some(name) = child.child_by_field_name("name") {
                    names.insert(get_node_text(name, source).to_string());
                }
            }
            "dotted_name" => {
                names.insert(get_node_text(child, source).to_string());
            }
            _ => {
                if child.is_named() {
                    collect_import_identifiers_rec(child, source, names);
                }
            }
        }
    }
}

fn collect_import_identifiers_rec(node: Node, source: &[u8], names: &mut HashSet<String>) {
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
                    collect_import_identifiers_rec(child, source, names);
                }
            }
        }
    }
}

// ============ Helper Functions ============

/// Check if an assignment is simple enough to keep
fn is_simple_assignment(node: Node, source: &[u8], max_len: usize) -> bool {
    let text = get_node_text(node, source);

    // Keep type annotations
    if text.contains(':') {
        return true;
    }

    // Keep short assignments without complex expressions
    !text.contains('(') && text.len() < max_len
}

// ============ State Contract (Future Enhancement) ============

/// Build a state contract for a code block
/// TODO: Implement path extraction and read/write classification
#[allow(dead_code)]
pub fn build_state_contract(_node: Node, _source: &[u8]) -> StateContract {
    StateContract::new()
}

#[cfg(test)]
mod tests {
    #[allow(unused_imports)]
    use super::*;

    #[test]
    fn test_is_simple_assignment() {
        // This would need actual tree-sitter nodes to test properly
        // For now, just ensure the module compiles
    }
}
