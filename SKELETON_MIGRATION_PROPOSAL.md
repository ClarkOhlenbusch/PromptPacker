# Skeleton Algorithm Migration Proposal

## Current State

### ColabPromptPack (TypeScript)
- **Location**: `ColabPromptPack/src/utils/promptGenerator.ts`
- **Approach**: Line-by-line parsing with regex patterns
- **Features**: Comment classification, docstring extraction, summary phrases, state contracts, path detection, small cell optimization

### prompt-pack-lite (Rust/Tauri)
- **Location**: `prompt-pack-lite/src-tauri/src/skeleton.rs`
- **Approach**: AST-based using tree-sitter
- **Languages**: TypeScript, JavaScript, Python, Rust, Go, JSON, CSS, HTML
- **Features**: Imports, function/class signatures, docstrings, call edges, type annotations

## Gap Analysis

| Feature | Colab (TS) | prompt-pack-lite (Rust) | Action |
|---------|------------|-------------------------|--------|
| **Comment Classification** | structural/explanatory/todo/trivial/disabled_code | Only keeps `# type:`, `# noqa`, `# TODO`, `# FIXME` | Expand |
| **Structural Comments** | `# --- Section ---`, `## Header` | Not detected | Add |
| **Docstring First Line** | Extracts summary line | Has `trim_docstring()` but different logic | Align |
| **Small Function Threshold** | Keep full body if ≤6 lines | Always skeletonizes | Add |
| **Summary Phrases** | 14 patterns for semantic intent | Has `# Calls:` for call edges | Add |
| **State Contract** | Defines/Reads/Writes | Not present | Add |
| **Path Detection** | Smart rejection of regex/f-strings | Not present | Add |
| **Print Intent** | Extracts meaning from print messages | Not present | Add |
| **Assignment Classification** | keep/summarize/remove | Only `is_simple_python_assignment` | Expand |

## Proposed Changes to `skeleton.rs`

### 1. Enhanced Comment Classification (All Languages)

```rust
enum CommentType {
    Structural,   // Section dividers: # --- Section ---
    Explanatory,  // Intent comments ≥15 chars
    Todo,         // TODO, FIXME, NOTE, HACK, XXX, BUG, WARNING
    Trivial,      // Short, non-meaningful
    DisabledCode, // Commented-out code
}

fn classify_comment(text: &str) -> CommentType {
    // Check for markdown headers: ## Header
    if text.starts_with("##") { return CommentType::Structural; }

    let content = text.trim_start_matches('#').trim();

    // Section dividers
    if content.starts_with("---") || content.ends_with("---") ||
       content.starts_with("===") || content.ends_with("===") {
        return CommentType::Structural;
    }

    // TODO variants
    if regex!(r"^(TODO|FIXME|NOTE|HACK|XXX|BUG|WARNING)\b").is_match(content) {
        return CommentType::Todo;
    }

    // Disabled code detection
    if looks_like_disabled_code(content) {
        return CommentType::DisabledCode;
    }

    // Trivial vs explanatory
    if content.len() < 15 && !content.ends_with(':') {
        return CommentType::Trivial;
    }

    CommentType::Explanatory
}
```

### 2. Small Function/Class Threshold

```rust
const SMALL_BODY_THRESHOLD: usize = 6;

fn should_keep_full_body(body_node: Node, source: &[u8]) -> bool {
    let text = get_node_text(body_node, source);
    let non_empty_lines = text.lines()
        .filter(|l| !l.trim().is_empty())
        .count();
    non_empty_lines <= SMALL_BODY_THRESHOLD
}
```

### 3. Summary Phrases (Python-specific, extensible to other languages)

```rust
struct SummaryPhrases;

impl SummaryPhrases {
    fn collect(text: &str) -> Vec<&'static str> {
        let lower = text.to_lowercase();
        let mut phrases = Vec::new();

        let patterns: &[(&str, &str)] = &[
            (r"torch\.load|load_state_dict|\.load\(", "loads checkpoint"),
            (r"torch\.save|np\.save|\.to_json|\.to_csv", "writes artifacts"),
            (r"pd\.read|np\.load|json\.load", "reads data files"),
            (r"tokenizer\.|\.tokenize|\.encode\(", "tokenizes text"),
            (r"\.train\(|\.fit\(|optimizer\.|\.backward\(", "runs training"),
            (r"\.eval\(|accuracy|metric", "evaluates metrics"),
            (r"plt\.|\.plot\(|seaborn", "plots figures"),
            (r"\.cuda\(|\.to\(device", "moves to device"),
            (r"DataLoader|\.batch\(", "builds dataloaders"),
            (r"!pip|pip install", "installs dependencies"),
            (r"!git clone|!wget|gdown", "downloads resources"),
        ];

        for (pattern, phrase) in patterns {
            if Regex::new(pattern).unwrap().is_match(&lower) {
                phrases.push(*phrase);
            }
        }

        phrases.dedup();
        phrases
    }
}
```

### 4. State Contract

```rust
struct StateContract {
    defines: Vec<String>,
    reads: Vec<String>,
    writes: Vec<String>,
}

fn build_state_contract(node: Node, source: &[u8]) -> StateContract {
    // Extract function/class names from definitions
    // Extract file paths from string literals
    // Classify as read/write based on context
}

fn emit_state_contract(output: &mut String, contract: &StateContract, indent: &str) {
    output.push_str(&format!("{}# Defines: {}\n", indent, format_list(&contract.defines)));
    output.push_str(&format!("{}# Reads: {}\n", indent, format_list(&contract.reads)));
    if !contract.writes.is_empty() {
        output.push_str(&format!("{}# Writes: {}\n", indent, format_list(&contract.writes)));
    }
}
```

### 5. Smart Path Detection

```rust
fn looks_like_path(value: &str) -> bool {
    if value.len() < 4 { return false; }

    // Reject regex patterns and escape sequences
    if value.starts_with('^') || value.starts_with('$') { return false; }
    if Regex::new(r"\\[snrtdwbDWSB]").unwrap().is_match(value) { return false; }
    if value.contains('{') && value.contains('}') { return false; } // f-strings
    if Regex::new(r"[*+?|()[\]]").unwrap().is_match(value) { return false; }

    // Check for path structure
    if value.contains('/') {
        return value.starts_with('.') || value.starts_with('/') ||
               value.starts_with('~') || value.ends_with_extension();
    }

    // Known file extensions
    KNOWN_EXTENSIONS.iter().any(|ext| value.ends_with(ext))
}

const KNOWN_EXTENSIONS: &[&str] = &[
    ".json", ".npy", ".pt", ".pth", ".ckpt", ".csv",
    ".parquet", ".txt", ".pkl", ".npz", ".tsv", ".jsonl"
];
```

### 6. Language-Agnostic Improvements

These concepts apply across languages:

| Concept | Python | JavaScript/TypeScript | Rust | Go |
|---------|--------|----------------------|------|-----|
| Structural comments | `# ---` | `// ---` | `// ---` | `// ---` |
| Small body threshold | 6 lines | 6 lines | 6 lines | 6 lines |
| Docstring first line | `"""..."""` | JSDoc `/** ... */` | `///` | `//` |
| Summary phrases | Python patterns | JS/TS patterns | Rust patterns | Go patterns |

## Implementation Order

1. **Phase 1**: Comment classification (all languages)
2. **Phase 2**: Small body threshold (Python first, then others)
3. **Phase 3**: Summary phrases (Python first)
4. **Phase 4**: State contract (Python)
5. **Phase 5**: Path detection improvements
6. **Phase 6**: Extend to JS/TS/Rust/Go

## Questions for Approval

1. **Scope**: Should we implement all features or prioritize a subset?
2. **Languages**: Start with Python only, or all languages simultaneously?
3. **State Contract**: Is the Defines/Reads/Writes contract valuable for desktop use, or is it Colab-specific?
4. **Summary Phrases**: Should these be language-specific or use a shared pattern registry?
5. **Testing**: Use the existing `skeleton_tests.rs` framework?

## Estimated Complexity

| Change | Lines of Code | Risk |
|--------|--------------|------|
| Comment classification | ~80 | Low |
| Small body threshold | ~30 | Low |
| Summary phrases | ~100 | Medium |
| State contract | ~150 | Medium |
| Path detection | ~50 | Low |
| **Total** | ~410 | Medium |

---

**Awaiting your approval before proceeding with implementation.**
