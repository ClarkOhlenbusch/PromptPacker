//! Tests for the skeleton module
//!
//! These tests verify AST-based code skeletonization for various languages.

use crate::skeleton::{skeletonize_with_path, SkeletonResult};

fn skeletonize(content: &str, extension: &str) -> SkeletonResult {
    skeletonize_with_path(content, extension, None)
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
        for item in items:
            result = self._transform(item)
            results.append(result)
        return results

    def _transform(self, item: str) -> dict:
        return json.loads(item)

def main():
    processor = DataProcessor({})
    processor.process([])
"#;

    let result = skeletonize(code, "py");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("from typing import"));
    assert!(result.skeleton.contains("class DataProcessor"));
    assert!(result.skeleton.contains("def __init__"));
    assert!(result.skeleton.contains("def process"));
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
    assert!(result.skeleton.contains("const { foo"));
}

#[test]
fn test_typescript_export_alias_keeps_local_decl() {
    let code = r#"
const foo = (value: string) => value;
export { foo as bar };
"#;

    let result = skeletonize(code, "ts");
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

class Processor:
    def execute(self):
        self.prepare()
        result = self.run_logic()
        self.cleanup(result)
"#;
    let result = skeletonize(code, "py");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("# Calls: normalize, parse_json, save_to_db"));
    assert!(result.skeleton.contains("# Calls: self.prepare, self.run_logic, self.cleanup"));
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
    assert!(result.skeleton.contains("\"\"\"Module docstring.\"\"\""));
    assert!(result.skeleton.contains("\"\"\"Function docstring summary.\"\"\""));
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
from typing import List, Any

def mixed_calls():
    local_helper()
    os.path.join("a", "b")
    sys.exit(0)
    List[int]
    other_local()
"#;
    let result = skeletonize(code, "py");
    println!("Skeleton:\n{}", result.skeleton);
    // External calls (os.path.join, sys.exit) should be prioritized
    // Relative order of external calls should be preserved: os.path.join, sys.exit
    // Local calls should follow: local_helper, other_local
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
    // Ensure body is stripped/summarized
    assert!(!result.skeleton.contains("print(\"fetching\")"));
    assert!(!result.skeleton.contains("await asyncio.sleep"));
}

#[test]
fn test_python_match_case() {
    let code = r#"
def http_error(status):
    match status:
        case 400:
            return "Bad request"
        case 404:
            return "Not found"
        case _:
            return "Something's wrong with the internet"
"#;
    let result = skeletonize(code, "py");
    println!("Skeleton:\n{}", result.skeleton);
    assert!(result.skeleton.contains("def http_error"));
    // The match/case structure is internal logic, it should probably be stripped in the skeleton
    // verifying that it doesn't crash and potentially strips the details
    assert!(!result.skeleton.contains("case 404"));
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
