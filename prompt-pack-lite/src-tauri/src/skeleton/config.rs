//! Config file skeleton extraction using tree-sitter.
//!
//! Handles: JSON, CSS, and HTML files.

use tree_sitter::Node;

use crate::skeleton::common::{get_node_text, truncate_line, MAX_DEF_LINE_LEN};

// ============ Constants ============

const MAX_JSON_DEP_ENTRIES: usize = 12;
const MAX_JSON_ENTRY_LEN: usize = 60;
const MAX_JSON_SCRIPT_ENTRIES: usize = 12;
const MAX_JSON_INLINE_ARRAY_ITEMS: usize = 4;
const MAX_JSON_LARGE_BYTES: usize = 2 * 1024 * 1024;
const MAX_JSON_LARGE_KEYS: usize = 12;

const JSON_DEP_KEYS: &[&str] = &[
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
];
const JSON_SCRIPT_KEY: &str = "scripts";

// ============ JSON Extraction ============

/// Extract skeleton from JSON source code
pub fn extract_json_skeleton(content: &str, root: Node, source: &[u8]) -> String {
    // Handle large JSON files without full parsing
    if content.len() > MAX_JSON_LARGE_BYTES {
        return summarize_large_json(content);
    }

    let mut output = String::new();
    extract_json_skeleton_rec(&mut output, root, source, 0);
    output.trim().to_string()
}

fn extract_json_skeleton_rec(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "  ".repeat(depth);

    match node.kind() {
        "document" => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                extract_json_skeleton_rec(output, child, source, depth);
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
                    extract_json_skeleton_rec(output, child, source, depth + 1);
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

fn json_string_value(node: Node, source: &[u8]) -> Option<String> {
    if node.kind() != "string" {
        return None;
    }
    let raw = get_node_text(node, source);
    Some(raw.trim_matches('\"').to_string())
}

fn is_json_dep_key(key: &str) -> bool {
    JSON_DEP_KEYS.iter().any(|candidate| *candidate == key)
}

fn is_json_script_key(key: &str) -> bool {
    key == JSON_SCRIPT_KEY
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

fn json_primitive_value(node: Node, source: &[u8]) -> Option<String> {
    match node.kind() {
        "string" => json_string_value(node, source).map(|val| {
            let clipped = truncate_line(&val, MAX_JSON_ENTRY_LEN);
            format!("\"{}\"", clipped)
        }),
        "number" | "true" | "false" | "null" => {
            Some(truncate_line(get_node_text(node, source), MAX_JSON_ENTRY_LEN))
        }
        _ => None,
    }
}

/// Summarize very large JSON files without full parsing
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

// ============ CSS Extraction ============

/// Extract skeleton from CSS source code
pub fn extract_css_skeleton(content: &str, root: Node, source: &[u8]) -> String {
    let _ = content; // Reserved for future use
    let mut output = String::new();
    extract_css_skeleton_rec(&mut output, root, source);
    output.trim().to_string()
}

fn extract_css_skeleton_rec(output: &mut String, node: Node, source: &[u8]) {
    let mut cursor = node.walk();

    for child in node.children(&mut cursor) {
        match child.kind() {
            "rule_set" => {
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
                output.push_str(&truncate_line(get_node_text(child, source), MAX_DEF_LINE_LEN));
                output.push('\n');
            }
            _ => {}
        }
    }
}

// ============ HTML Extraction ============

/// Extract skeleton from HTML source code
pub fn extract_html_skeleton(content: &str, root: Node, source: &[u8]) -> String {
    let _ = content; // Reserved for future use
    let mut output = String::new();
    extract_html_skeleton_rec(&mut output, root, source, 0);
    output.trim().to_string()
}

fn extract_html_skeleton_rec(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "  ".repeat(depth);

    match node.kind() {
        "document" | "fragment" => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                extract_html_skeleton_rec(output, child, source, depth);
            }
        }
        "doctype" => {
            output.push_str(get_node_text(node, source));
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
                    if child.kind() == "element" {
                        extract_html_skeleton_rec(output, child, source, depth + 1);
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

// ============ Tests ============

#[cfg(test)]
mod tests {
    use super::*;
    use tree_sitter::Parser;

    fn parse_json(code: &str) -> String {
        let mut parser = Parser::new();
        parser.set_language(&tree_sitter_json::LANGUAGE.into()).unwrap();
        let tree = parser.parse(code, None).unwrap();
        extract_json_skeleton(code, tree.root_node(), code.as_bytes())
    }

    fn parse_css(code: &str) -> String {
        let mut parser = Parser::new();
        parser.set_language(&tree_sitter_css::LANGUAGE.into()).unwrap();
        let tree = parser.parse(code, None).unwrap();
        extract_css_skeleton(code, tree.root_node(), code.as_bytes())
    }

    fn parse_html(code: &str) -> String {
        let mut parser = Parser::new();
        parser.set_language(&tree_sitter_html::LANGUAGE.into()).unwrap();
        let tree = parser.parse(code, None).unwrap();
        extract_html_skeleton(code, tree.root_node(), code.as_bytes())
    }

    #[test]
    fn test_json_object() {
        let code = r#"{
    "name": "my-package",
    "version": "1.0.0"
}"#;
        let skeleton = parse_json(code);
        assert!(skeleton.contains("name: my-package"));
        assert!(skeleton.contains("version: 1.0.0"));
    }

    #[test]
    fn test_json_dependencies() {
        let code = r#"{
    "dependencies": {
        "react": "^18.0.0",
        "lodash": "^4.17.0"
    }
}"#;
        let skeleton = parse_json(code);
        assert!(skeleton.contains("dependencies:"));
        assert!(skeleton.contains("react"));
    }

    #[test]
    fn test_css_rules() {
        let code = r#"
.container {
    display: flex;
    padding: 10px;
    margin: 0;
}
"#;
        let skeleton = parse_css(code);
        assert!(skeleton.contains(".container"));
        assert!(skeleton.contains("props=3"));
    }

    #[test]
    fn test_html_structure() {
        let code = r#"<!DOCTYPE html>
<html>
<head>
    <title>Test</title>
</head>
<body>
    <div>Hello</div>
</body>
</html>"#;
        let skeleton = parse_html(code);
        assert!(skeleton.contains("<html>"));
        assert!(skeleton.contains("<head>"));
        assert!(skeleton.contains("<body>"));
    }
}
