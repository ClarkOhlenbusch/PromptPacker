//! Go-specific skeleton extraction using tree-sitter.
//!
//! Handles: package declarations, imports, type definitions, functions, methods,
//! const/var declarations, interfaces, and doc comments.

use tree_sitter::Node;

use crate::skeleton::common::{
    get_node_text, truncate_line, compact_text_prefix,
    CallEdgeList, MAX_DEF_LINE_LEN, MAX_CALL_EDGE_NAMES,
    MAX_CALL_EDGE_NAME_LEN, MAX_CALL_EDGE_NODES,
};

// ============ Main Entry Point ============

/// Extract skeleton from Go source code
pub fn extract_skeleton(content: &str, root: Node, source: &[u8]) -> String {
    let _ = content; // Reserved for future use (e.g., line counting)
    let mut output = String::new();
    extract_go_skeleton(&mut output, root, source, 0);
    output
}

// ============ Core Extraction ============

fn extract_go_skeleton(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "\t".repeat(depth);

    match node.kind() {
        // Package declaration
        "package_clause" => {
            output.push_str(get_node_text(node, source));
            output.push('\n');
        }

        // Imports
        "import_declaration" => {
            output.push_str(&truncate_line(get_node_text(node, source), MAX_DEF_LINE_LEN));
            output.push('\n');
        }

        // Type declarations
        "type_declaration" => {
            output.push_str(&truncate_line(get_node_text(node, source), MAX_DEF_LINE_LEN));
            output.push('\n');
        }

        // Function declarations
        "function_declaration" => {
            extract_go_function_skeleton(output, node, source, &indent);
        }

        // Method declarations
        "method_declaration" => {
            extract_go_function_skeleton(output, node, source, &indent);
        }

        // Const/var declarations
        "const_declaration" | "var_declaration" => {
            output.push_str(&truncate_line(get_node_text(node, source), MAX_DEF_LINE_LEN));
            output.push('\n');
        }

        // Type specs (interfaces, structs defined within type_declaration)
        "type_spec" => {
            output.push_str(&truncate_line(get_node_text(node, source), MAX_DEF_LINE_LEN));
            output.push('\n');
        }

        // Comments - keep doc comments
        "comment" => {
            let text = get_node_text(node, source);
            if text.starts_with("//") && text.len() > 3 {
                output.push_str(&truncate_line(text, MAX_DEF_LINE_LEN));
                output.push('\n');
            }
        }

        // Source file - recurse into children
        "source_file" => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                extract_go_skeleton(output, child, source, depth);
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
}
