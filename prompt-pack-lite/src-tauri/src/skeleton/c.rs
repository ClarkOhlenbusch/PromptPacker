//! C-specific skeleton extraction using tree-sitter AST.
//!
//! Handles C files (.c, .h) with focus on:
//! - Preprocessor directives (#include, #define, #ifdef)
//! - Function declarations and definitions  
//! - Struct, union, and enum definitions
//! - Typedefs
//! - Function call detection

use tree_sitter::Node;

use super::common::{
    get_node_text, truncate_line, collect_summary_phrases,
    CallEdgeList, MAX_DEF_LINE_LEN, MAX_CALL_EDGE_NAMES,
    MAX_CALL_EDGE_NAME_LEN, MAX_CALL_EDGE_NODES,
};

const MAX_C_INCLUDE_LINES: usize = 12;

// ============ Main Entry Point ============

pub fn extract_skeleton(_content: &str, root: Node, source: &[u8]) -> String {
    let mut output = String::new();
    extract_c_skeleton(&mut output, root, source, 0);
    output
}

fn extract_c_skeleton(output: &mut String, node: Node, source: &[u8], depth: usize) {
    let indent = "    ".repeat(depth);
    let kind = node.kind();

    match kind {
        // Root node - process children
        "translation_unit" => {
            emit_include_summary(output, node, source);
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                if child.kind() == "preproc_include" {
                    continue;
                }
                extract_c_skeleton(output, child, source, 0);
            }
        }

        // Preprocessor directives - always keep
        "preproc_include" | "preproc_def" | "preproc_function_def" => {
            output.push_str(&indent);
            output.push_str(&truncate_line(get_node_text(node, source), MAX_DEF_LINE_LEN));
            output.push('\n');
        }
        
        // Preprocessor conditionals - recurse into children
        "preproc_ifdef" | "preproc_ifndef" | "preproc_if" | "preproc_elif" | "preproc_else" => {
            // Output the directive line
            let text = get_node_text(node, source);
            let first_line = text.lines().next().unwrap_or("");
            output.push_str(&indent);
            output.push_str(first_line);
            output.push('\n');
            
            // Recurse into children to get nested directives
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                let ck = child.kind();
                if ck != "identifier" && ck != "preproc_arg" && ck != "#endif" {
                    extract_c_skeleton(output, child, source, depth);
                }
            }
            
            // Output closing #endif
            output.push_str(&indent);
            output.push_str("#endif\n");
        }
        
        "preproc_endif" => {
            // Handled by parent ifdef/ifndef
        }

        // Function definitions
        "function_definition" => {
            extract_function_skeleton(output, node, source, &indent);
        }

        // Declarations (includes function prototypes, variable declarations, struct/enum/typedef)
        "declaration" => {
            extract_declaration(output, node, source, &indent);
        }

        // Standalone struct/union/enum (rare, usually in declarations)
        "struct_specifier" | "union_specifier" | "enum_specifier" => {
            output.push_str(&indent);
            output.push_str(&summarize_composite_type(node, source));
            output.push('\n');
        }

        // Comments - keep doc comments and TODOs
        "comment" => {
            let text = get_node_text(node, source);
            if should_keep_comment(text) {
                output.push_str(&indent);
                output.push_str(text.trim());
                output.push('\n');
            }
        }

        // Skip other nodes but recurse into children
        _ => {
            let mut cursor = node.walk();
            for child in node.children(&mut cursor) {
                extract_c_skeleton(output, child, source, depth);
            }
        }
    }
}

// ============ Function Extraction ============

fn extract_function_skeleton(output: &mut String, node: Node, source: &[u8], indent: &str) {
    // Build signature from parts
    let mut sig_parts = Vec::new();
    
    // Get return type
    if let Some(type_node) = node.child_by_field_name("type") {
        sig_parts.push(get_node_text(type_node, source).to_string());
    }
    
    // Get declarator (name + params)
    if let Some(decl) = node.child_by_field_name("declarator") {
        sig_parts.push(get_node_text(decl, source).to_string());
    }
    
    let signature = sig_parts.join(" ");
    output.push_str(indent);
    output.push_str(&signature);
    output.push('\n');
    
    // Extract body info
    if let Some(body) = node.child_by_field_name("body") {
        let calls = collect_calls(body, source);
        let body_text = get_node_text(body, source);
        let summary = collect_summary_phrases(body_text);
        
        output.push_str(indent);
        output.push_str("{\n");
        
        if !calls.is_empty() {
            output.push_str(indent);
            output.push_str("    // Calls: ");
            output.push_str(&calls.join(", "));
            output.push('\n');
        }
        
        if !summary.is_empty() {
            output.push_str(indent);
            output.push_str("    // ");
            output.push_str(&summary.join(", "));
            output.push('\n');
        }
        
        if calls.is_empty() && summary.is_empty() {
            output.push_str(indent);
            output.push_str("    // ...\n");
        }
        
        output.push_str(indent);
        output.push_str("}\n");
    }
    
    output.push('\n');
}

// ============ Include Summary ============

fn emit_include_summary(output: &mut String, node: Node, source: &[u8]) {
    let mut includes = Vec::new();
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == "preproc_include" {
            includes.push(truncate_line(get_node_text(child, source), MAX_DEF_LINE_LEN));
        }
    }
    if includes.is_empty() {
        return;
    }

    let mut system = Vec::new();
    let mut local = Vec::new();
    for inc in includes.iter() {
        if inc.contains('<') {
            system.push(inc);
        } else if inc.contains('"') {
            local.push(inc);
        } else {
            system.push(inc);
        }
    }

    let total = includes.len();
    output.push_str(&format!(
        "// Includes: total={} system={} local={}\n",
        total,
        system.len(),
        local.len()
    ));

    let mut emitted = 0;
    for inc in system.iter() {
        if emitted >= MAX_C_INCLUDE_LINES {
            break;
        }
        output.push_str(inc);
        output.push('\n');
        emitted += 1;
    }
    if emitted < MAX_C_INCLUDE_LINES {
        for inc in local.iter() {
            if emitted >= MAX_C_INCLUDE_LINES {
                break;
            }
            output.push_str(inc);
            output.push('\n');
            emitted += 1;
        }
    }

    if total > emitted {
        output.push_str(&format!("// ... +{} more includes\n", total - emitted));
    }
}

// ============ Declaration Extraction ============

fn extract_declaration(output: &mut String, node: Node, source: &[u8], indent: &str) {
    let text = get_node_text(node, source);
    
    // Check what kind of declaration this is
    let mut cursor = node.walk();
    let children: Vec<_> = node.children(&mut cursor).collect();
    
    for child in &children {
        match child.kind() {
            // Typedef with struct/union/enum
            "type_definition" | "storage_class_specifier" if text.starts_with("typedef") => {
                output.push_str(indent);
                output.push_str(&summarize_typedef(node, source));
                output.push('\n');
                return;
            }
            
            // Struct/union/enum declaration
            "struct_specifier" | "union_specifier" | "enum_specifier" => {
                output.push_str(indent);
                output.push_str(&summarize_composite_type(*child, source));
                
                // Check for variable name after struct
                for c in &children {
                    if c.kind() == "identifier" || c.kind() == "init_declarator" {
                        output.push_str(" ");
                        output.push_str(get_node_text(*c, source));
                    }
                }
                output.push_str(";\n");
                return;
            }
            
            // Function pointer typedef
            "function_declarator" if text.contains("(*)") => {
                output.push_str(indent);
                output.push_str(&truncate_line(text, MAX_DEF_LINE_LEN));
                output.push('\n');
                return;
            }
            
            _ => {}
        }
    }
    
    // Function prototype (declaration with function_declarator)
    if text.contains('(') && text.ends_with(';') && !text.contains('=') {
        output.push_str(indent);
        output.push_str(&truncate_line(text, MAX_DEF_LINE_LEN));
        output.push('\n');
    }
}

// ============ Type Summarization ============

fn summarize_typedef(node: Node, source: &[u8]) -> String {
    let text = get_node_text(node, source);
    
    // Single line typedef - keep as is
    if !text.contains('\n') {
        return text.to_string();
    }
    
    // Multi-line typedef - find struct/union/enum and summarize
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        match child.kind() {
            "struct_specifier" | "union_specifier" | "enum_specifier" => {
                let type_summary = summarize_composite_type(child, source);
                
                // Find the typedef name (last identifier before semicolon)
                let lines: Vec<&str> = text.lines().collect();
                if let Some(last) = lines.last() {
                    let name = last.trim().trim_end_matches(';').trim_end_matches('}').trim();
                    if !name.is_empty() && !name.contains('{') {
                        return format!("typedef {} {};", type_summary, name);
                    }
                }
                return format!("typedef {};", type_summary);
            }
            _ => {}
        }
    }
    
    // Fallback: first and last line
    let lines: Vec<&str> = text.lines().collect();
    if lines.len() > 2 {
        format!("{} ... {}", lines[0].trim(), lines.last().unwrap().trim())
    } else {
        text.replace('\n', " ")
    }
}

fn summarize_composite_type(node: Node, source: &[u8]) -> String {
    let kind = node.kind();
    let name = node.child_by_field_name("name")
        .map(|n| get_node_text(n, source))
        .unwrap_or("");
    
    // Find body and count members
    let body = node.child_by_field_name("body");
    
    match kind {
        "struct_specifier" => {
            let fields = body.map(|b| count_children_of_kind(b, "field_declaration")).unwrap_or(0);
            if !name.is_empty() {
                if fields > 0 {
                    format!("struct {} {{ /* {} fields */ }}", name, fields)
                } else {
                    format!("struct {}", name)
                }
            } else if fields > 0 {
                format!("struct {{ /* {} fields */ }}", fields)
            } else {
                "struct { }".to_string()
            }
        }
        "union_specifier" => {
            let fields = body.map(|b| count_children_of_kind(b, "field_declaration")).unwrap_or(0);
            if !name.is_empty() {
                format!("union {} {{ /* {} members */ }}", name, fields)
            } else {
                format!("union {{ /* {} members */ }}", fields)
            }
        }
        "enum_specifier" => {
            let values = body.map(|b| count_children_of_kind(b, "enumerator")).unwrap_or(0);
            if !name.is_empty() {
                format!("enum {} {{ /* {} values */ }}", name, values)
            } else {
                format!("enum {{ /* {} values */ }}", values)
            }
        }
        _ => get_node_text(node, source).to_string()
    }
}

fn count_children_of_kind(node: Node, target_kind: &str) -> usize {
    let mut cursor = node.walk();
    node.children(&mut cursor)
        .filter(|n| n.kind() == target_kind)
        .count()
}

// ============ Call Collection ============

fn collect_calls(node: Node, source: &[u8]) -> Vec<String> {
    let mut list = CallEdgeList::new();
    collect_calls_rec(node, source, &mut list);
    list.entries
}

fn collect_calls_rec(node: Node, source: &[u8], list: &mut CallEdgeList) {
    if list.visited >= MAX_CALL_EDGE_NODES {
        return;
    }
    list.visited += 1;

    if node.kind() == "call_expression" {
        if let Some(func) = node.child_by_field_name("function") {
            let name = match func.kind() {
                "identifier" => get_node_text(func, source).to_string(),
                "field_expression" => {
                    func.child_by_field_name("field")
                        .map(|f| get_node_text(f, source).to_string())
                        .unwrap_or_default()
                }
                _ => String::new()
            };
            
            if !name.is_empty() 
                && name.len() <= MAX_CALL_EDGE_NAME_LEN 
                && list.entries.len() < MAX_CALL_EDGE_NAMES
                && !list.entries.contains(&name) 
            {
                list.entries.push(name);
            }
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_calls_rec(child, source, list);
    }
}

// ============ Comment Filtering ============

fn should_keep_comment(text: &str) -> bool {
    // Keep doc comments
    if text.starts_with("/**") || text.starts_with("/*!") || text.starts_with("///") {
        return true;
    }
    
    // Keep section dividers
    if text.contains("====") || text.contains("----") || text.contains("****") {
        return true;
    }
    
    // Keep TODOs
    let upper = text.to_uppercase();
    if upper.contains("TODO") || upper.contains("FIXME") || upper.contains("NOTE") 
        || upper.contains("HACK") || upper.contains("XXX") || upper.contains("BUG") {
        return true;
    }
    
    // Keep substantial comments (>20 chars of content)
    let content = text.trim_start_matches('/').trim_start_matches('*').trim();
    content.len() >= 20
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_module_compiles() {
        let _ = extract_skeleton;
    }
}
