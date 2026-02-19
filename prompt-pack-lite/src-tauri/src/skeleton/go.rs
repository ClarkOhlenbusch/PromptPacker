//! Go-specific skeleton extraction using tree-sitter.
//!
//! Handles: package declarations, imports, type definitions, functions, methods,
//! const/var declarations, interfaces, and doc comments.
//! 
//! Method family summarization: collapses repetitive accessor patterns like
//! GetString, GetInt, GetBool into a single summary line.

use std::collections::HashMap;
use tree_sitter::Node;

use crate::skeleton::common::{
    get_node_text, truncate_line, compact_text_prefix,
    CallEdgeList, MAX_DEF_LINE_LEN, MAX_CALL_EDGE_NAMES,
    MAX_CALL_EDGE_NAME_LEN, MAX_CALL_EDGE_NODES,
};

/// Minimum family size to trigger summarization
const MIN_FAMILY_SIZE: usize = 4;

// ============ Main Entry Point ============

/// Extract skeleton from Go source code
pub fn extract_skeleton(content: &str, root: Node, source: &[u8]) -> String {
    let _ = content;
    let mut output = String::new();
    extract_go_skeleton_with_families(&mut output, root, source);
    output
}

// ============ Core Extraction with Method Family Detection ============

fn extract_go_skeleton_with_families(output: &mut String, root: Node, source: &[u8]) {
    // First pass: collect all methods grouped by receiver type
    let mut methods_by_receiver: HashMap<String, Vec<MethodInfo>> = HashMap::new();
    
    let mut cursor = root.walk();
    for child in root.children(&mut cursor) {
        if child.kind() == "method_declaration" {
            if let Some(info) = extract_method_info(child, source) {
                methods_by_receiver
                    .entry(info.receiver.clone())
                    .or_default()
                    .push(info);
            }
        }
    }
    
    // Detect families and build set of variant method names to skip
    let families = detect_method_families(&methods_by_receiver);
    let skip_variants: std::collections::HashSet<(String, String)> = families
        .iter()
        .flat_map(|f| {
            f.variants
                .iter()
                .map(|v| (f.receiver.clone(), v.clone()))
        })
        .collect();
    
    // Second pass: emit skeleton, skipping variant methods and their doc comments
    let mut cursor = root.walk();
    let children: Vec<Node> = root.children(&mut cursor).collect();
    let mut i = 0;
    
    while i < children.len() {
        let child = children[i];

        // Skip contiguous doc comments for a summarized variant method.
        if child.kind() == "comment" {
            let mut j = i;
            while j < children.len() && children[j].kind() == "comment" {
                j += 1;
            }
            if let Some(next) = children.get(j) {
                if next.kind() == "method_declaration" {
                    if let Some(info) = extract_method_info(*next, source) {
                        if skip_variants.contains(&(info.receiver.clone(), info.name.clone())) {
                            // Skip all comments plus the variant method.
                            i = j + 1;
                            continue;
                        }
                    }
                }
            }
        }
        
        match child.kind() {
            "method_declaration" => {
                if let Some(info) = extract_method_info(child, source) {
                    if skip_variants.contains(&(info.receiver.clone(), info.name.clone())) {
                        i += 1;
                        continue;
                    }
                }
                emit_method_with_family_check(output, child, source, &families);
            }
            _ => extract_go_node(output, child, source, 0),
        }
        i += 1;
    }
}

struct MethodInfo {
    receiver: String,
    name: String,
    signature: String,
    call_edges: String,
}

fn extract_method_info(node: Node, source: &[u8]) -> Option<MethodInfo> {
    let receiver_node = node.child_by_field_name("receiver")?;
    let receiver = normalize_receiver(receiver_node, source);
    let name = node
        .child_by_field_name("name")
        .map(|n| get_node_text(n, source).to_string())?;
    
    let text = get_node_text(node, source);
    let signature = if let Some(brace_pos) = text.find('{') {
        truncate_line(text[..brace_pos].trim(), MAX_DEF_LINE_LEN)
    } else {
        truncate_line(text, MAX_DEF_LINE_LEN)
    };
    
    let call_edges = collect_call_edges_string(node, source);
    
    Some(MethodInfo {
        receiver,
        name,
        signature,
        call_edges,
    })
}

fn normalize_receiver(receiver_node: Node, source: &[u8]) -> String {
    let mut cursor = receiver_node.walk();
    for child in receiver_node.children(&mut cursor) {
        if child.kind() == "parameter_declaration" {
            if let Some(ty) = child.child_by_field_name("type") {
                return get_node_text(ty, source).to_string();
            }
        }
    }

    let raw = get_node_text(receiver_node, source);
    let raw = raw.trim().trim_start_matches('(').trim_end_matches(')').trim();
    let mut parts = raw.split_whitespace();
    let last = parts.next_back().unwrap_or(raw);
    last.to_string()
}

fn collect_call_edges_string(node: Node, source: &[u8]) -> String {
    let body = node.child_by_field_name("body");
    let Some(body) = body else { return String::new() };
    let calls = collect_go_calls(body, source);
    if calls.entries.is_empty() {
        return String::new();
    }
    let mut s = String::from("// Calls: ");
    s.push_str(&calls.entries.join(", "));
    if calls.truncated {
        s.push_str(", ...");
    }
    s
}

struct MethodFamily {
    prefix: String,
    receiver: String,
    base_method: String,
    variants: Vec<String>,
}

fn detect_method_families(methods_by_receiver: &HashMap<String, Vec<MethodInfo>>) -> Vec<MethodFamily> {
    let mut families = Vec::new();
    
    for (receiver, methods) in methods_by_receiver {
        // Common prefixes to detect families
        for prefix in &["Get", "Set", "Is", "Has", "With", "Must"] {
            let matching: Vec<&MethodInfo> = methods
                .iter()
                .filter(|m| m.name.starts_with(prefix) && m.name.len() > prefix.len())
                .collect();
            
            if matching.len() >= MIN_FAMILY_SIZE {
                // Find the base method (exact prefix match, e.g., "Get" for "GetString")
                let base = methods.iter().find(|m| m.name == *prefix);
                let base_name = base.map(|b| b.name.clone());
                let mut variants: Vec<String> = matching
                    .iter()
                    .filter(|m| m.name != *prefix)
                    .map(|m| m.name.clone())
                    .collect();

                if base_name.is_none() && !variants.is_empty() {
                    // Promote the first variant to be the base so the family still emits.
                    let promoted = variants.remove(0);
                    if variants.len() + 1 >= MIN_FAMILY_SIZE {
                        families.push(MethodFamily {
                            prefix: prefix.to_string(),
                            receiver: receiver.clone(),
                            base_method: promoted,
                            variants,
                        });
                    }
                    continue;
                }

                let Some(base_name) = base_name else {
                    continue;
                };

                if variants.len() >= MIN_FAMILY_SIZE {
                    families.push(MethodFamily {
                        prefix: prefix.to_string(),
                        receiver: receiver.clone(),
                        base_method: base_name,
                        variants,
                    });
                }
            }
        }
    }
    
    families
}

fn emit_method_with_family_check(
    output: &mut String,
    node: Node,
    source: &[u8],
    families: &[MethodFamily],
) {
    let Some(info) = extract_method_info(node, source) else {
        extract_go_function_skeleton(output, node, source, "");
        return;
    };
    
    // Check if this method is part of a family
    for family in families {
        if info.receiver == family.receiver {
            // If this is the base method, emit it with family summary
            if info.name == family.base_method {
                output.push_str(&info.signature);
                output.push('\n');
                if !info.call_edges.is_empty() {
                    output.push_str(&info.call_edges);
                    output.push('\n');
                }
                // Emit family summary
                output.push_str(&format!(
                    "// {} variants: {} ({} methods)\n",
                    family.prefix,
                    summarize_variants(&family.variants),
                    family.variants.len()
                ));
                return;
            }
            // If this is a variant, skip it (already summarized)
            if family.variants.contains(&info.name) {
                return;
            }
        }
    }
    
    // Not part of a family, emit normally
    output.push_str(&info.signature);
    output.push('\n');
    if !info.call_edges.is_empty() {
        output.push_str(&info.call_edges);
        output.push('\n');
    }
}

fn summarize_variants(variants: &[String]) -> String {
    if variants.len() <= 6 {
        variants.join(", ")
    } else {
        let first_five: Vec<&str> = variants.iter().take(5).map(|s| s.as_str()).collect();
        format!("{}, ... +{} more", first_five.join(", "), variants.len() - 5)
    }
}

fn extract_go_node(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "\t".repeat(depth);

    match node.kind() {
        "package_clause" => {
            output.push_str(get_node_text(node, source));
            output.push('\n');
        }

        "import_declaration" => {
            output.push_str(&truncate_line(get_node_text(node, source), MAX_DEF_LINE_LEN));
            output.push('\n');
        }

        "type_declaration" => {
            output.push_str(&truncate_line(get_node_text(node, source), MAX_DEF_LINE_LEN));
            output.push('\n');
        }

        "function_declaration" => {
            extract_go_function_skeleton(output, node, source, &indent);
        }

        "method_declaration" => {
            extract_go_function_skeleton(output, node, source, &indent);
        }

        "const_declaration" | "var_declaration" => {
            output.push_str(&truncate_line(get_node_text(node, source), MAX_DEF_LINE_LEN));
            output.push('\n');
        }

        "type_spec" => {
            output.push_str(&truncate_line(get_node_text(node, source), MAX_DEF_LINE_LEN));
            output.push('\n');
        }

        "comment" => {
            let text = get_node_text(node, source);
            if text.starts_with("//") && text.len() > 3 {
                output.push_str(&truncate_line(text, MAX_DEF_LINE_LEN));
                output.push('\n');
            }
        }

        "source_file" => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                extract_go_node(output, child, source, depth);
            }
        }

        _ => {}
    }
}

// ============ Function/Method Extraction ============

fn extract_go_function_skeleton(output: &mut String, node: Node, source: &[u8], indent: &str) {
    let text = get_node_text(node, source);
    if let Some(brace_pos) = text.find('{') {
        let signature = truncate_line(text[..brace_pos].trim(), MAX_DEF_LINE_LEN);
        output.push_str(indent);
        output.push_str(&signature);
        output.push('\n');
        emit_go_call_edges(output, node, source, indent);
    }
}

// ============ Call Edge Collection ============

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
    let mut list = CallEdgeList::new();
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
        add_unique_entry(&mut list.entries, name);
        if list.entries.len() >= MAX_CALL_EDGE_NAMES {
            list.truncated = true;
            return;
        }
    }

    // Don't descend into nested function literals
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

// ============ Utilities ============

fn add_unique_entry(entries: &mut Vec<String>, name: String) {
    if !entries.contains(&name) {
        entries.push(name);
    }
}

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;
    use tree_sitter::Parser;

    fn parse_go(code: &str) -> String {
        let mut parser = Parser::new();
        parser.set_language(&tree_sitter_go::LANGUAGE.into()).unwrap();
        let tree = parser.parse(code, None).unwrap();
        extract_skeleton(code, tree.root_node(), code.as_bytes())
    }

    #[test]
    fn test_go_package() {
        let code = "package main";
        let skeleton = parse_go(code);
        assert!(skeleton.contains("package main"));
    }

    #[test]
    fn test_go_imports() {
        let code = r#"package main

import (
    "fmt"
    "os"
)
"#;
        let skeleton = parse_go(code);
        assert!(skeleton.contains("import"));
        assert!(skeleton.contains("fmt"));
    }

    #[test]
    fn test_go_function() {
        let code = r#"package main

func hello(name string) string {
    return "Hello, " + name
}
"#;
        let skeleton = parse_go(code);
        assert!(skeleton.contains("func hello(name string) string"));
    }

    #[test]
    fn test_go_method() {
        let code = r#"package main

type Server struct {
    port int
}

func (s *Server) Start() error {
    fmt.Println("Starting server")
    return nil
}
"#;
        let skeleton = parse_go(code);
        assert!(skeleton.contains("type Server struct"));
        assert!(skeleton.contains("func (s *Server) Start() error"));
        assert!(skeleton.contains("// Calls: fmt.Println"));
    }

    #[test]
    fn test_go_interface() {
        let code = r#"package main

type Reader interface {
    Read(p []byte) (n int, err error)
}
"#;
        let skeleton = parse_go(code);
        assert!(skeleton.contains("type Reader interface"));
    }

    #[test]
    fn test_go_call_edges() {
        let code = r#"package main

func process() {
    data := readFile("input.txt")
    result := transform(data)
    writeFile("output.txt", result)
}
"#;
        let skeleton = parse_go(code);
        assert!(skeleton.contains("// Calls:"));
        assert!(skeleton.contains("readFile"));
        assert!(skeleton.contains("transform"));
        assert!(skeleton.contains("writeFile"));
    }

    #[test]
    fn test_go_method_family_summarization() {
        let code = r#"package main

type Context struct {
    data map[string]any
}

func (c *Context) Get(key string) any {
    return c.data[key]
}

func (c *Context) GetString(key string) string {
    return c.data[key].(string)
}

func (c *Context) GetInt(key string) int {
    return c.data[key].(int)
}

func (c *Context) GetBool(key string) bool {
    return c.data[key].(bool)
}

func (c *Context) GetFloat(key string) float64 {
    return c.data[key].(float64)
}

func (c *Context) Other() string {
    return "other"
}
"#;
        let skeleton = parse_go(code);
        println!("Skeleton:\n{}", skeleton);
        // Base Get method should be present
        assert!(skeleton.contains("func (c *Context) Get(key string) any"));
        // Family summary should be present
        assert!(skeleton.contains("Get variants:"));
        assert!(skeleton.contains("GetString"));
        // Individual variant methods should NOT be present as full signatures
        assert!(!skeleton.contains("func (c *Context) GetString"));
        assert!(!skeleton.contains("func (c *Context) GetInt"));
        // Non-family method should still be present
        assert!(skeleton.contains("func (c *Context) Other()"));
    }

    #[test]
    fn test_go_method_family_without_base() {
        let code = r#"package main

type Context struct {
    data map[string]any
}

func (c *Context) GetString(key string) string {
    return c.data[key].(string)
}

func (c *Context) GetInt(key string) int {
    return c.data[key].(int)
}

func (c *Context) GetBool(key string) bool {
    return c.data[key].(bool)
}

func (c *Context) GetFloat(key string) float64 {
    return c.data[key].(float64)
}
"#;
        let skeleton = parse_go(code);
        println!("Skeleton:\n{}", skeleton);
        // One variant should be promoted to base and emitted
        assert!(skeleton.contains("func (c *Context) GetString(key string) string"));
        // Family summary should be present
        assert!(skeleton.contains("Get variants:"));
        assert!(skeleton.contains("GetInt"));
        // Other variants should not appear as full signatures
        assert!(!skeleton.contains("func (c *Context) GetInt"));
        assert!(!skeleton.contains("func (c *Context) GetBool"));
    }
}
