//! Tests for the skeleton module
//!
//! These tests verify AST-based code skeletonization for various languages.

use crate::skeleton::{skeletonize_with_path, SkeletonResult};
use std::fs;
use std::path::Path;

fn skeletonize(content: &str, extension: &str) -> SkeletonResult {
    skeletonize_with_path(content, extension, None)
}

fn skeletonize_with_fixture_path(path: &Path) -> SkeletonResult {
    let content = fs::read_to_string(path)
        .unwrap_or_else(|err| panic!("Failed to read fixture {}: {}", path.display(), err));
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    let path_str = path.to_string_lossy();
    skeletonize_with_path(&content, ext, Some(path_str.as_ref()))
}

#[test]
fn test_typescript_skeleton() {
    let code = r#"
import { User } from './user';

interface Config {
    name: string;
    value: number;
}

export class UserService {
    private users: User[] = [];

    constructor(private config: Config) {
        this.initialize();
    }

    async getUser(id: string): Promise<User | null> {
        const user = this.users.find(u => u.id === id);
        if (!user) {
            return null;
        }
        return user;
    }

    private initialize(): void {
        console.log('Initializing...');
        this.loadUsers();
    }
}

export function helper(x: number): number {
    return x * 2;
}
"#;

    let result = skeletonize(code, "ts");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("import { User }"));
    assert!(result.skeleton.contains("class UserService"));
    assert!(result.skeleton.contains("getUser"));
    assert!(!result.skeleton.contains("console.log"));
}

#[test]
fn test_python_skeleton() {
    let code = r#"
from typing import List, Optional
import json

class DataProcessor:
    """Processes data from various sources."""

    def __init__(self, config: dict):
        """Initialize the processor."""
        self.config = config
        self.data = []

    def process(self, items: List[str]) -> List[dict]:
        """Process a list of items."""
        results = []
        # Line 1
        # Line 2
        # Line 3
        # Line 4
        # Line 5
        for item in items:
            result = self._transform(item)
            results.append(result)
        return results

    def _transform(self, item: str) -> dict:
        return json.loads(item)
"#;

    let result = skeletonize(code, "py");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("from typing import"));
    assert!(result.skeleton.contains("class DataProcessor"));
    assert!(result.skeleton.contains("def __init__"));
    assert!(result.skeleton.contains("def process"));
    // Verify it was skeletonized
    assert!(result.skeleton.contains("..."));
    assert!(!result.skeleton.contains("for item in"));
}

#[test]
fn test_rust_skeleton() {
    let code = r#"
use std::collections::HashMap;

/// A cache for storing values
pub struct Cache<K, V> {
    data: HashMap<K, V>,
    capacity: usize,
}

impl<K: Eq + Hash, V> Cache<K, V> {
    /// Creates a new cache
    pub fn new(capacity: usize) -> Self {
        Cache {
            data: HashMap::new(),
            capacity,
        }
    }

    pub fn get(&self, key: &K) -> Option<&V> {
        self.data.get(key)
    }

    pub fn insert(&mut self, key: K, value: V) {
        if self.data.len() >= self.capacity {
            // Evict oldest
        }
        self.data.insert(key, value);
    }
}

pub fn helper() -> i32 {
    42
}
"#;

    let result = skeletonize(code, "rs");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("use std::collections::HashMap"));
    assert!(result.skeleton.contains("pub struct Cache"));
    assert!(result.skeleton.contains("impl<K: Eq + Hash, V> Cache<K, V>"));
    assert!(result.skeleton.contains("pub fn new"));
    assert!(!result.skeleton.contains("HashMap::new()"));
}

#[test]
fn test_fallback_compression() {
    let code = r#"
package main

import "fmt"

type User struct {
    Name string
    Age  int
}

func (u *User) Greet() string {
    greeting := fmt.Sprintf("Hello, %s!", u.Name)
    return greeting
}

func main() {
    user := User{Name: "Alice", Age: 30}
    fmt.Println(user.Greet())
}
"#;

    let result = skeletonize(code, "go");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("package main"));
    assert!(result.skeleton.contains("type User struct"));
}

#[test]
fn test_unsupported_language() {
    let code = "void main() { printf(\"hello\"); }";
    let result = skeletonize(code, "unknown");
    println!("Skeleton (unknown):\n{}", result.skeleton);
    assert!(result.language.is_none());
}

#[test]
fn test_typescript_export_assignment() {
    let code = r#"
class Foo {
  value: number;
}

export = Foo;
"#;

    let result = skeletonize(code, "ts");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("class Foo"));
    assert!(result.skeleton.contains("export = Foo"));
}

#[test]
fn test_typescript_destructured_export() {
    let code = r#"
const { foo, bar: baz } = config;
export { foo, baz };
"#;

    let result = skeletonize(code, "ts");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("const { foo"));
}

#[test]
fn test_typescript_export_alias_keeps_local_decl() {
    let code = r#"
const foo = (value: string) => value;
export { foo as bar };
"#;

    let result = skeletonize(code, "ts");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("const foo"));
    assert!(result.skeleton.contains("export { foo as bar"));
}

#[test]
fn test_typescript_arrow_signature_truncation() {
    let code = r#"
export default (
  p1: string, p2: string, p3: string, p4: string, p5: string,
  p6: string, p7: string, p8: string, p9: string, p10: string,
  p11: string, p12: string, p13: string, p14: string, p15: string,
  p16: string, p17: string, p18: string, p19: string, p20: string,
  p21: string, p22: string, p23: string, p24: string, p25: string,
  p26: string, p27: string, p28: string, p29: string, p30: string
) => {};
"#;

    let result = skeletonize(code, "ts");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("export default"));
    assert!(result.skeleton.contains("..."));
}

#[test]
fn test_script_skeleton() {
    let code = r#"
const id = "123";
console.log("Setting up listener");

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg === "ping") {
        sendResponse("pong");
    }
});

function helper() {
    return true;
}
"#;
    let result = skeletonize(code, "js");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("const id"));
    assert!(result.skeleton.contains("console.log"));
    assert!(result.skeleton.contains("chrome.runtime.onMessage.addListener(...)"));
    assert!(!result.skeleton.contains("sendResponse"));
    assert!(result.skeleton.contains("function helper"));
}

#[test]
fn test_nested_functions_in_guard() {
    // Common pattern in content scripts: guard with if/else containing function declarations
    let code = r#"
function isValid() {
    return true;
}

if (window.alreadyLoaded) {
    console.log("skip");
} else {
    function requestCells() {
        return [];
    }

    function handleQuickCopy(cells) {
        console.log(cells);
    }

    async function copyToClipboard(text) {
        await navigator.clipboard.writeText(text);
    }
}
"#;
    let result = skeletonize(code, "js");
    println!("Skeleton:\n{}", result.skeleton);
    // Top-level function should be extracted
    assert!(result.skeleton.contains("function isValid"));
    // Functions inside else block should also be extracted
    assert!(result.skeleton.contains("function requestCells"));
    assert!(result.skeleton.contains("function handleQuickCopy"));
    assert!(result.skeleton.contains("async function copyToClipboard"));
}

#[test]
fn test_react_component_skeleton() {
    let code = r#"
import React from 'react';

export function MyComponent({ title }: { title: string }) {
    const [count, setCount] = React.useState(0);

    return (
        <div className="container">
            <h1>{title}</h1>
            <button onClick={() => setCount(count + 1)}>
                Count: {count}
            </button>
        </div>
    );
}

export const ArrowComp = () => <span />;
"#;
    let result = skeletonize(code, "tsx");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("function MyComponent"));
    assert!(result.skeleton.contains("// Render: Layout"));
    assert!(result.skeleton.contains("const ArrowComp"));
    assert!(result.skeleton.contains("// Render: Layout"));
}

#[test]
fn test_react_component_conditional_return() {
    let code = r#"
export const Conditional = ({ ok }: { ok: boolean }) => {
    if (!ok) {
        return <Fallback />;
    }
    return (
        <div>
            <Content />
        </div>
    );
};
"#;
    let result = skeletonize(code, "tsx");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("const Conditional"));
    assert!(
        result.skeleton.contains("// Render: Fallback")
            || result.skeleton.contains("// Render: Layout")
    );
}

#[test]
fn test_react_entrypoint_hooks_and_effects() {
    let code = r#"
import { useState, useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

export default function App() {
    const [count, setCount] = useState(0);
    const ref = useRef(false);
    useEffect(() => {
        listen("project-change", () => {});
    }, [count]);
    const handleOpen = async () => {
        await open({ directory: true });
    };
    return <button onClick={handleOpen}>Hi</button>;
}
"#;
    let result = skeletonize(code, "tsx");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("// useState: count=0"));
    assert!(result.skeleton.contains("// useRef: ref"));
    assert!(result.skeleton.contains("// Effect: useEffect([count])"));
    assert!(result.skeleton.contains("// Handler: async handleOpen"));
    assert!(result.skeleton.contains("// Listens: project-change"));
    assert!(result.skeleton.contains("// Opens: open"));
    assert!(result.skeleton.contains("// Render:"));
}

#[test]
fn test_iife_skeleton() {
    let code = r#"
(function() {
    console.log("hello");
})();

(async () => {
    await doThing();
})();
"#;
    let result = skeletonize(code, "js");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("IIFE(...)"));
    assert!(result.skeleton.contains("async IIFE(...)"));
    assert!(!result.skeleton.contains("console.log"));
}

#[test]
fn test_go_skeleton() {
    let code = r#"
package service

import (
	"fmt"
	"os"
)

type Config struct {
	ID   string
	Port int
}

func (c *Config) Validate() error {
	if c.ID == "" {
		return fmt.Errorf("empty ID")
	}
	return nil
}

func Start(cfg *Config) {
	fmt.Printf("Starting on %d", cfg.Port)
	os.Exit(0)
}
"#;
    let result = skeletonize(code, "go");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("package service"));
    assert!(result.skeleton.contains("type Config struct"));
    assert!(result.skeleton.contains("func (c *Config) Validate() error"));
    assert!(result.skeleton.contains("func Start(cfg *Config)"));
    assert!(result.skeleton.contains("// Calls: fmt.Printf, os.Exit"));
}

#[test]
fn test_css_skeleton() {
    let code = r#"
.container {
    display: flex;
    margin: 0 auto;
    max-width: 1200px;
}

@media (max-width: 768px) {
    .container {
        padding: 0 20px;
    }
}

.button:hover {
    background: blue;
}
"#;
    let result = skeletonize(code, "css");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains(".container props=3"));
    assert!(result.skeleton.contains("@media (max-width: 768px)"));
    assert!(result.skeleton.contains(".button:hover props=1"));
}

#[test]
fn test_html_skeleton() {
    let code = r#"
<!DOCTYPE html>
<html>
    <head>
        <title>Test Page</title>
        <link rel="stylesheet" href="style.css">
    </head>
    <body>
        <div id="root">
            <h1>Welcome</h1>
            <p>This is a test.</p>
            <ul>
                <li>One</li>
                <li>Two</li>
            </ul>
        </div>
        <script src="app.js"></script>
    </body>
</html>
"#;
    let result = skeletonize(code, "html");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("<html>"));
    assert!(result.skeleton.contains("<head>"));
    assert!(result.skeleton.contains("<body>"));
    assert!(result.skeleton.contains("<div> <!-- 3 children -->"));
}

#[test]
fn test_json_skeleton() {
    let code = r#"
{
    "name": "prompt-pack-lite",
    "version": "0.1.0",
    "scripts": {
        "dev": "vite",
        "build": "tsc && vite build",
        "preview": "vite preview"
    },
    "dependencies": {
        "react": "^18.2.0",
        "react-dom": "^18.2.0"
    },
    "devDependencies": {
        "typescript": "^5.0.0",
        "vite": "^4.0.0"
    }
}
"#;
    let result = skeletonize(code, "json");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("scripts: dev, build, preview"));
    assert!(result.skeleton.contains("dependencies: react@^18.2.0, react-dom@^18.2.0"));
    assert!(result.skeleton.contains("devDependencies: typescript@^5.0.0, vite@^4.0.0"));
}

#[test]
fn test_json_large_summarization() {
    // Create a string larger than MAX_JSON_LARGE_BYTES (2MB)
    let size = 2 * 1024 * 1024 + 100;
    let mut code = String::with_capacity(size);
    code.push_str("{\n");
    for i in 0..50000 {
        code.push_str(&format!("  \"key_{}\": \"some moderately long value that repeats to fill space\",\n", i));
    }
    code.push_str("  \"final_key\": \"final_value\"\n");
    code.push_str("}");

    let result = skeletonize(&code, "json");
    println!("Skeleton (Large):\n{}", result.skeleton);
    // Should use summarize_large_json which shows top-level keys
    assert!(result.skeleton.contains("key_0: string"));
    assert!(result.skeleton.contains("..."));
}


#[test]
fn test_python_call_edges() {
    let code = r#"
def process_data(data):
    clean = normalize(data)
    parsed = parse_json(clean)
    save_to_db(parsed)
    return True

def process_large_data(data):
    x1 = 1
    x2 = 2
    x3 = 3
    x4 = 4
    x5 = 5
    x6 = 6
    x7 = 7
    execute(data)
"#;
    let result = skeletonize(code, "py");
    println!("Skeleton:\n{}", result.skeleton);
    
    // Small function should NOT have call edges (full body kept)
    assert!(!result.skeleton.contains("# Calls: normalize"));
    assert!(result.skeleton.contains("clean = normalize(data)"));

    // Large function SHOULD have call edges
    assert!(result.skeleton.contains("# Calls: execute"));
}

#[test]
fn test_rust_call_edges() {
    let code = r#"
fn main() {
    let data = load_file("input.txt");
    let result = process(&data);
    print_report(result);
}

impl Service {
    fn handle(&self) {
        self.pre_hook();
        self.inner.dispatch();
        self.post_hook();
    }
}
"#;
    let result = skeletonize(code, "rs");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("// Calls: load_file, process, print_report"));
    assert!(result.skeleton.contains("// Calls: self.pre_hook, self.inner.dispatch, self.post_hook"));
}

#[test]
fn test_go_call_edges_complex() {
    let code = r#"
func HandleRequest(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	user, err := auth.Authenticate(ctx)
	if err != nil {
		http.Error(w, "unauthorized", 401)
		return
	}
	db.Query("SELECT * FROM users WHERE id = ?", user.ID)
	render.JSON(w, 200, user)
}
"#;
    let result = skeletonize(code, "go");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("// Calls: r.Context, auth.Authenticate, http.Error, db.Query, render.JSON"));
}

#[test]
fn test_js_insights() {
    let code = r#"
import axios from 'axios';
import { debounce } from 'lodash';

export async function fetchData(url) {
    const response = await axios.get(url);
    window.alert("Fetched");
    const data = await response.data;
    return data;
}

export const process = debounce(() => {
    console.log("Processing...");
    alert("Done");
}, 100);
"#;
    let result = skeletonize(code, "js");
    println!("Skeleton:\n{}", result.skeleton);
    // JS Insights show external imports and top-level invokes
    assert!(result.skeleton.contains("// External: axios"));
    assert!(result.skeleton.contains("// Invokes: axios.get"));
    assert!(result.skeleton.contains("// External: lodash"));
    assert!(result.skeleton.contains("// Invokes: debounce"));
    assert!(result.skeleton.contains("window.alert"));
}

#[test]
fn test_ts_advanced_skeleton() {
    let code = r#"
@Decorator()
class Outer {
    @FieldDecorator
    prop: string;

    static Inner = class {
        method() {
            return 1;
        }
    }

    async outerMethod() {
        const inner = new Outer.Inner();
        return inner.method();
    }
}
"#;
    let result = skeletonize(code, "ts");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("class Outer"));
    assert!(result.skeleton.contains("class"));
    assert!(result.skeleton.contains("method ()"));
    assert!(result.skeleton.contains("async outerMethod ()"));
}



#[test]
fn test_python_nested_structures() {
    let code = r#"
class Outer:
    def outer_method(self):
        def inner_func():
            pass
        class InnerClass:
            def inner_method(self):
                pass
"#;
    let result = skeletonize(code, "py");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("class Outer"));
    assert!(result.skeleton.contains("def outer_method"));
    
    // VERIFIED: Nested functions/classes are now preserved as signatures
    assert!(result.skeleton.contains("def inner_func"));
    assert!(result.skeleton.contains("class InnerClass"));
    assert!(result.skeleton.contains("def inner_method"));
}

#[test]
fn test_python_decorators_advanced() {
    let code = r#"
@decorator_plain
@decorator_with_args(1, 2, kw="arg")
def decorated_func():
    pass

class MyClass:
    @staticmethod
    def static_meth():
        pass
"#;
    let result = skeletonize(code, "py");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("@decorator_plain"));
    assert!(result.skeleton.contains("@decorator_with_args"));
    assert!(result.skeleton.contains("def decorated_func"));
    assert!(result.skeleton.contains("@staticmethod"));
}

#[test]
fn test_python_modern_syntax() {
    let code = r#"
type Point = tuple[float, float]
type Matrix[T] = list[list[T]]

def process_points(points: list[Point]) -> Matrix[float]:
    return [list(p) for p in points]
"#;
    let result = skeletonize(code, "py");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("type Point ="));
    assert!(result.skeleton.contains("type Matrix[T] ="));
    assert!(result.skeleton.contains("def process_points"));
}

#[test]
fn test_python_docstrings_varied() {
    let code = r#"
"""Module docstring."""

def func_with_doc():
    """Function docstring summary.
    Extended description.
    """
    pass

class ClassWithDoc:
    """Class docstring."""
    attr: int
"#;
    let result = skeletonize(code, "py");
    println!("Skeleton:\n{}", result.skeleton);
    // Full body kept - check for start of docstring
    assert!(result.skeleton.contains("\"\"\"Function docstring summary."));
    assert!(result.skeleton.contains("\"\"\"Class docstring.\"\"\""));
}

#[test]
fn test_python_call_edges_complex() {
    let code = r#"
def deep_logic():
    a = first()
    b = second(a)
    c = third(b)
    d = fourth(c)
    e = fifth(d)
    f = sixth(e)
    g = seventh(f) # Should be truncated if limit is 6
"#;
    let result = skeletonize(code, "py");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("# Calls: first, second, third, fourth, fifth, sixth, ..."));
}

#[test]
fn test_python_assignments_and_attributes() {
    let code = r#"
CONSTANT = 42
LONG_ASSIGNMENT = "this is a very long string that should exceed the maximum simple assignment length limit to test if it gets correctly stripped from the skeleton output"
type_annotated: str = "val"

class Config:
    timeout: int = 30
    names = ["alice", "bob", "charlie"]
"#;
    let result = skeletonize(code, "py");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("CONSTANT = 42"));
    assert!(!result.skeleton.contains("LONG_ASSIGNMENT"));
    assert!(result.skeleton.contains("type_annotated: str = \"val\""));
    assert!(result.skeleton.contains("timeout: int = 30"));
    assert!(result.skeleton.contains("names = [\"alice\", \"bob\", \"charlie\"]"));
}

#[test]
fn test_python_call_prioritization() {
    let code = r#"
import os.path
import sys

def mixed_calls_small():
    local_helper()
    os.path.join("a", "b")
    sys.exit(0)

def mixed_calls_large():
    x1 = 1
    x2 = 2
    x3 = 3
    x4 = 4
    x5 = 5
    x6 = 6
    x7 = 7
    local_helper()
    os.path.join("a", "b")
    sys.exit(0)
    other_local()
"#;
    let result = skeletonize(code, "py");
    println!("Skeleton:\n{}", result.skeleton);
    
    // Small function: keeps full body
    assert!(result.skeleton.contains("local_helper()"));
    assert!(result.skeleton.contains("os.path.join"));

    // Large function: uses skeleton with prioritization
    assert!(result.skeleton.contains("# Calls: os.path.join, sys.exit, local_helper, other_local"));
}

#[test]
fn test_python_async_await() {
    let code = r#"
import asyncio

async def fetch_data(url: str):
    print("fetching")
    await asyncio.sleep(1)
    return "data"

async def main():
    async with aiohttp.ClientSession() as session:
        data = await fetch_data("http://example.com")
"#;
    let result = skeletonize(code, "py");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("async def fetch_data"));
    assert!(result.skeleton.contains("async def main"));
    // Small body optimization: keep full body
    assert!(result.skeleton.contains("print(\"fetching\")"));
    assert!(result.skeleton.contains("await asyncio.sleep"));
}

#[test]
fn test_python_match_case() {
    let code = r#"
def http_error(status):
    match status:
        case 400:
            return "OK"
        case _:
            return "ERR"
"#;
    let result = skeletonize(code, "py");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("def http_error"));
    // Small body: kept in full
    assert!(result.skeleton.contains("case 400"));
}

#[test]
fn test_python_dataclasses() {
    let code = r#"
from dataclasses import dataclass, field
from typing import List

@dataclass
class InventoryItem:
    name: str
    unit_price: float
    quantity_on_hand: int = 0

    def total_cost(self) -> float:
        return self.unit_price * self.quantity_on_hand
"#;
    let result = skeletonize(code, "py");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("@dataclass"));
    assert!(result.skeleton.contains("class InventoryItem"));
    assert!(result.skeleton.contains("name: str"));
    assert!(result.skeleton.contains("unit_price: float"));
    assert!(result.skeleton.contains("quantity_on_hand: int = 0"));
    assert!(result.skeleton.contains("def total_cost"));
}

#[test]
fn test_python_exception_handling() {
    let code = r#"
def divide(x, y):
    try:
        result = x / y
    except ZeroDivisionError:
        print("division by zero")
    else:
        print("result is", result)
    finally:
        print("executing finally clause")
"#;
    let result = skeletonize(code, "py");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("def divide"));
    // logic inside try/except/finally should be stripped
    assert!(!result.skeleton.contains("ZeroDivisionError"));
    assert!(!result.skeleton.contains("executing finally clause"));
}

#[test]
fn test_python_path_detection() {
    let code = r#"
import pandas as pd
import torch

def train_model():
    """Train the model and save checkpoints."""
    # Load training data
    train_df = pd.read_csv("./data/train.csv")
    val_df = pd.read_csv("./data/validation.csv")

    # Load pretrained model
    model = torch.load("./models/pretrained.pth")

    # Train for some epochs
    for epoch in range(10):
        loss = train_epoch(model, train_df)
        print(f"Epoch {epoch}: {loss}")

    # Save final model
    torch.save(model, "./output/model_final.pth")
    train_df.to_csv("./output/predictions.csv")
"#;
    let result = skeletonize(code, "py");
    println!("Skeleton:\n{}", result.skeleton);

    // Should contain the function signature
    assert!(result.skeleton.contains("def train_model"));

    // Should detect reads
    assert!(result.skeleton.contains("# Reads:"));
    assert!(result.skeleton.contains("train.csv") || result.skeleton.contains("data/train.csv"));

    // Should detect writes
    assert!(result.skeleton.contains("# Writes:"));
    assert!(result.skeleton.contains("model_final.pth") || result.skeleton.contains("output/model_final.pth"));
}

#[test]
fn test_python_path_detection_no_false_positives() {
    let code = r#"
import re

def validate_input(text):
    """Check if input matches pattern."""
    pattern = r"^\s*\d+\s*$"
    if re.match(pattern, text):
        return True
    return False
"#;
    let result = skeletonize(code, "py");
    println!("Skeleton:\n{}", result.skeleton);

    // Should NOT detect regex patterns as paths
    assert!(!result.skeleton.contains("# Reads:") || !result.skeleton.contains(r"\s*"));
    assert!(!result.skeleton.contains("# Writes:"));
}

#[test]
fn test_c_skeleton() {
    let code = r#"
#include <stdio.h>
#include <stdlib.h>

#define MAX_SIZE 100
"#;

    let result = skeletonize(code, "c");
    println!("C Skeleton:\n{}", result.skeleton);
    
    // Basic test - should at least keep includes and defines
    assert!(result.skeleton.contains("#include <stdio.h>"));
    assert!(result.skeleton.contains("#define MAX_SIZE"));
    
    // TODO: Add more comprehensive tests once function extraction is working
    // Currently the C parser needs refinement to properly extract:
    // - Function definitions
    // - Struct/union/enum definitions  
    // - Typedefs
    // - Function calls
}

#[test]
fn test_c_preprocessor_guards_and_macros() {
    let code = r#"
#ifndef LIB_UTILS_H
#define LIB_UTILS_H

#include <stddef.h>
#include <stdint.h>

#define MAX(a, b) ((a) > (b) ? (a) : (b))
#define ARRAY_LEN(x) (sizeof(x) / sizeof((x)[0]))

#ifdef ENABLE_LOGGING
#define LOG(msg) printf("%s\n", msg)
#else
#define LOG(msg) ((void)0)
#endif

#endif
"#;

    let result = skeletonize(code, "c");
    println!("C Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("#ifndef LIB_UTILS_H"));
    assert!(result.skeleton.contains("#define MAX(a, b)"));
    assert!(result.skeleton.contains("#ifdef ENABLE_LOGGING"));
    assert!(result.skeleton.contains("#endif"));
}

#[test]
fn test_c_struct_enum_union_summary() {
    let code = r#"
struct Point {
    int x;
    int y;
};

union Payload {
    int i;
    float f;
};

enum Status {
    STATUS_OK,
    STATUS_ERR,
    STATUS_UNKNOWN
};
"#;

    let result = skeletonize(code, "c");
    println!("C Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("struct Point"));
    assert!(result.skeleton.contains("enum Status"));
}

#[test]
fn test_c_typedefs_and_prototypes() {
    let code = r#"
typedef int (*Comparator)(const void *a, const void *b);
typedef struct Pair { int left; int right; } Pair;

void sort(void *base, size_t count, Comparator cmp);
int (*resolve)(int code);
"#;

    let result = skeletonize(code, "c");
    println!("C Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("typedef int (*Comparator)"));
    assert!(result.skeleton.contains("typedef struct Pair"));
}

#[test]
fn test_c_function_calls_and_comments() {
    let code = r#"
/** Initialize buffer with zeros. */
char *init_buffer(size_t size) {
    char *buf = (char *)malloc(size);
    if (!buf) {
        return NULL;
    }
    memset(buf, 0, size);
    return buf;
}

// TODO: free buffer after use
void release_buffer(char *buf) {
    free(buf);
}
"#;

    let result = skeletonize(code, "c");
    println!("C Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("Initialize buffer"));
}

#[test]
fn test_js_multi_style_suite() {
    let code = r#"
const express = require("express");
const fs = require("fs");
import path from "path";

const app = express();

class UserRepo {
    constructor(db) {
        this.db = db;
    }

    findById(id) {
        return this.db.get(id);
    }
}

function createServer(port = 3000) {
    app.get("/health", (_req, res) => res.json({ ok: true }));
    return app.listen(port);
}

const handler = async (req, res) => {
    const data = await fs.promises.readFile(path.join(__dirname, "data.json"), "utf8");
    res.send(data);
};

module.exports = { createServer, UserRepo, handler };
"#;

    let result = skeletonize(code, "js");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("class UserRepo"));
    assert!(result.skeleton.contains("function createServer"));
    assert!(result.skeleton.contains("const handler"));
    assert!(result.skeleton.contains("module.exports"));
}

#[test]
fn test_jsx_component_suite() {
    let code = r#"
import React, { useState } from "react";
import { createRoot } from "react-dom/client";

export function Button({ label, onClick }) {
    return <button onClick={onClick}>{label}</button>;
}

export default function App() {
    const [count, setCount] = useState(0);
    return (
        <main>
            <h1>Hello</h1>
            <Button label={`Count ${count}`} onClick={() => setCount(count + 1)} />
        </main>
    );
}

const root = createRoot(document.getElementById("root"));
root.render(<App />);
"#;

    let result = skeletonize(code, "jsx");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("export function Button"));
    assert!(result.skeleton.contains("export default function App"));
    assert!(result.skeleton.contains("// External: react"));
}

#[test]
fn test_typescript_multi_style_suite() {
    let code = r#"
import type { Request, Response } from "express";
import { z } from "zod";

export interface User {
    id: string;
    roles: string[];
}

export type Result<T> =
    | { ok: true; value: T }
    | { ok: false; error: string };

export enum Role {
    Admin = "admin",
    Viewer = "viewer",
}

export class Service<T> {
    constructor(private store: Map<string, T>) {}
    get(id: string): Result<T> {
        return { ok: true, value: this.store.get(id)! };
    }
}

export function handle(req: Request, res: Response): void;
export function handle(req: Request, res: Response, next: () => void): void;
export function handle(req: Request, res: Response, _next?: () => void) {
    res.json({ ok: true });
}

export const createSchema = (name: string) =>
    z.object({ name: z.string().min(1).default(name) });

export namespace Internal {
    export const version = "1.0";
}
"#;

    let result = skeletonize(code, "ts");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("interface User"));
    assert!(result.skeleton.contains("type Result"));
    assert!(result.skeleton.contains("enum Role"));
    assert!(result.skeleton.contains("class Service"));
    assert!(result.skeleton.contains("function handle"));
}

#[test]
fn test_tsx_component_suite() {
    let code = r#"
import React, { useMemo, useReducer, useContext } from "react";
import { useQuery } from "@tanstack/react-query";

type Props = { id: string };

const ThemeContext = React.createContext("light");

export const Card: React.FC<Props> = ({ id }) => {
    const theme = useContext(ThemeContext);
    const [{ count }, dispatch] = useReducer((s, a) => ({ count: s.count + 1 }), { count: 0 });
    const { data } = useQuery({
        queryKey: ["item", id],
        queryFn: () => fetch(`/api/items/${id}`).then((r) => r.json()),
    });
    const label = useMemo(() => data?.name ?? "Loading", [data]);
    return (
        <section data-theme={theme}>
            <h2>{label}</h2>
            <button onClick={() => dispatch({})}>Inc</button>
        </section>
    );
};

export default function App() {
    return <Card id="1" />;
}
"#;

    let result = skeletonize(code, "tsx");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("const Card"));
    assert!(result.skeleton.contains("function App"));
    assert!(result.skeleton.contains("// External: react"));
    assert!(result.skeleton.contains("@tanstack/react-query"));
}

#[test]
fn test_rust_multi_style_suite() {
    let code = r#"
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub roles: Vec<Role>,
}

pub enum Role {
    Admin,
    Viewer,
}

pub trait Repo<T> {
    fn get(&self, id: &str) -> Option<T>;
}

pub struct InMemoryRepo<T> {
    data: HashMap<String, T>,
}

impl<T: Clone> Repo<T> for InMemoryRepo<T> {
    fn get(&self, id: &str) -> Option<T> {
        self.data.get(id).cloned()
    }
}

pub type Result<T> = std::result::Result<T, String>;

pub async fn load_user(id: &str) -> Result<User> {
    Ok(User { id: id.to_string(), roles: vec![Role::Viewer] })
}

macro_rules! metric {
    ($name:expr) => {
        println!("{}", $name);
    };
}
"#;

    let result = skeletonize(code, "rs");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("use serde"));
    assert!(result.skeleton.contains("pub struct User"));
    assert!(result.skeleton.contains("pub enum Role"));
    assert!(result.skeleton.contains("pub trait Repo"));
    assert!(result.skeleton.contains("impl<T: Clone> Repo<T> for InMemoryRepo<T>"));
    assert!(result.skeleton.contains("pub async fn load_user"));
    assert!(result.skeleton.contains("macro_rules! metric"));
}

#[test]
fn test_go_multi_style_suite() {
    let code = r#"
package service

import (
    "context"
    "fmt"
)

type Item struct {
    ID   string
    Name string
}

type Store interface {
    Get(ctx context.Context, id string) (Item, error)
}

type Service struct {
    Store
    logger fmt.Stringer
}

func New(store Store, logger fmt.Stringer) *Service {
    return &Service{Store: store, logger: logger}
}

func (s *Service) Handle(ctx context.Context, id string) (Item, error) {
    item, err := s.Get(ctx, id)
    if err != nil {
        return Item{}, err
    }
    return item, nil
}

func Map[T any, U any](in []T, fn func(T) U) []U {
    out := make([]U, 0, len(in))
    for _, v := range in {
        out = append(out, fn(v))
    }
    return out
}
"#;

    let result = skeletonize(code, "go");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("type Store interface"));
    assert!(result.skeleton.contains("type Service struct"));
    assert!(result.skeleton.contains("func (s *Service) Handle"));
    assert!(result.skeleton.contains("func Map[T any, U any]"));
}

#[test]
fn test_c_multi_style_suite() {
    let code = r#"
#ifndef USER_REPO_H
#define USER_REPO_H

#include <stdint.h>
#include <stdbool.h>

#define USER_MAX 128

typedef int (*Comparator)(const void *a, const void *b);

typedef struct User {
    uint32_t id;
    const char *name;
    bool active;
} User;

typedef struct UserRepo {
    User items[USER_MAX];
    Comparator cmp;
} UserRepo;

void repo_init(UserRepo *repo, Comparator cmp);
User *repo_find(UserRepo *repo, uint32_t id);

#endif
"#;

    let result = skeletonize(code, "c");
    println!("C Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("#ifndef USER_REPO_H"));
    assert!(result.skeleton.contains("typedef int (*Comparator)"));
    assert!(result.skeleton.contains("typedef struct User"));
}

#[test]
fn test_json_varied_structures_suite() {
    let code = r#"
{
    "name": "multi-config",
    "scripts": {
        "dev": "vite",
        "build": "tsc && vite build",
        "lint": "eslint ."
    },
    "dependencies": {
        "react": "^18.2.0",
        "axios": "^1.6.0",
        "zustand": "^4.5.0"
    },
    "routes": [
        { "path": "/", "auth": false },
        { "path": "/about", "auth": false },
        { "path": "/admin", "auth": true }
    ],
    "flags": [true, false, null],
    "nested": { "feature": { "enabled": true } }
}
"#;

    let result = skeletonize(code, "json");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("scripts: dev, build, lint"));
    assert!(result.skeleton.contains("dependencies: react@^18.2.0"));
    assert!(result.skeleton.contains("routes: [\"/\", \"/about\", \"/admin\"]"));
}

#[test]
fn test_css_varied_selectors_suite() {
    let code = r#"
@import url("reset.css");

:root {
    --brand: #ff8c00;
    --space: 12px;
}

.btn, .link:hover {
    color: var(--brand);
    padding: var(--space);
}

@media (max-width: 900px) {
    .btn {
        padding: 8px;
        display: block;
    }
}

@keyframes pulse {
    0% { opacity: 0.5; }
    100% { opacity: 1; }
}
"#;

    let result = skeletonize(code, "css");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("@import url"));
    assert!(result.skeleton.contains(".btn"));
    assert!(result.skeleton.contains("@media (max-width: 900px)"));
    assert!(result.skeleton.contains("@keyframes"));
}

#[test]
fn test_html_varied_structure_suite() {
    let code = r#"
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Suite</title>
  </head>
  <body>
    <header>
      <nav>
        <a href="/">Home</a>
        <a href="/docs">Docs</a>
      </nav>
    </header>
    <main>
      <section>
        <h2>Title</h2>
      </section>
      <aside>
        <p>Sidebar</p>
      </aside>
    </main>
    <template id="row">
      <tr><td>Cell</td></tr>
    </template>
    <script src="/app.js"></script>
  </body>
</html>
"#;

    let result = skeletonize(code, "html");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("<html>"));
    assert!(result.skeleton.contains("<body>"));
    assert!(result.skeleton.contains("<main> <!-- 2 children -->"));
    assert!(result.skeleton.contains("<template>"));
}

fn run_fixture_benchmarks(label: &str, fixtures: &[&str]) {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
    println!("\n=== Fixture Benchmark: {} ===", label);
    for rel in fixtures {
        let path = root.join(rel);
        assert!(path.exists(), "Missing fixture: {}", path.display());
        let result = skeletonize_with_fixture_path(&path);
        println!("\n--- Fixture: {} ---", rel);
        println!(
            "Lines: {} -> {} ({}% reduced)",
            result.original_lines,
            result.skeleton_lines,
            (result.compression_ratio() * 100.0).round()
        );
        println!("Skeleton:\n{}", result.skeleton);
        assert!(
            !result.skeleton.is_empty(),
            "Empty skeleton output for fixture {}",
            rel
        );
    }
}

#[test]
fn test_fixture_benchmarks_python() {
    run_fixture_benchmarks(
        "python",
        &[
            "python/requests__sessions.py",
            "python/pandas__io_json__normalize.py",
            "python/scikit_learn__model_selection__split.py",
            "python/typer__main.py",
            "python/langchain__agents__agent.py",
        ],
    );
}

#[test]
fn test_fixture_benchmarks_js() {
    run_fixture_benchmarks("js", &["js/express__application.js"]);
}

#[test]
fn test_fixture_benchmarks_jsx() {
    run_fixture_benchmarks("jsx", &["jsx/react__Profiler.jsx"]);
}

#[test]
fn test_fixture_benchmarks_ts() {
    run_fixture_benchmarks(
        "ts",
        &["ts/redux_toolkit__createSlice.ts", "ts/zod__index.ts"],
    );
}

#[test]
fn test_fixture_benchmarks_tsx() {
    run_fixture_benchmarks("tsx", &["tsx/headlessui__combobox.tsx"]);
}

#[test]
fn test_fixture_benchmarks_rust() {
    run_fixture_benchmarks("rust", &["rust/serde_json__de.rs"]);
}

#[test]
fn test_fixture_benchmarks_go() {
    run_fixture_benchmarks("go", &["go/gin__context.go"]);
}

#[test]
fn test_fixture_benchmarks_c() {
    run_fixture_benchmarks("c", &["c/curl__url.c"]);
}

#[test]
fn test_fixture_benchmarks_json() {
    run_fixture_benchmarks("json", &["json/vite__package.json"]);
}

#[test]
fn test_fixture_benchmarks_css() {
    run_fixture_benchmarks("css", &["css/normalize__normalize.css"]);
}

#[test]
fn test_fixture_benchmarks_html() {
    run_fixture_benchmarks("html", &["html/cra__index.html"]);
}

#[test]
fn test_fixture_benchmarks_all() {
    run_fixture_benchmarks(
        "all",
        &[
            // Python (priority)
            "python/requests__sessions.py",
            "python/pandas__io_json__normalize.py",
            "python/scikit_learn__model_selection__split.py",
            "python/typer__main.py",
            "python/langchain__agents__agent.py",
            // JavaScript / TypeScript
            "js/express__application.js",
            "jsx/react__Profiler.jsx",
            "ts/redux_toolkit__createSlice.ts",
            "ts/zod__index.ts",
            "tsx/headlessui__combobox.tsx",
            // Rust / Go / C
            "rust/serde_json__de.rs",
            "go/gin__context.go",
            "c/curl__url.c",
            // Config / Markup / Styles
            "json/vite__package.json",
            "css/normalize__normalize.css",
            "html/cra__index.html",
        ],
    );
}
