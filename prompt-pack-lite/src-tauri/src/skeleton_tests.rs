//! Tests for the skeleton module
//!
//! These tests verify AST-based code skeletonization for various languages.

use crate::skeleton::skeletonize;

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
    assert!(result.skeleton.contains("chrome.runtime.onMessage.addListener"));
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
    assert!(result.skeleton.contains("// Returns: <div ... />"));
    assert!(result.skeleton.contains("const ArrowComp"));
    assert!(result.skeleton.contains("// Returns: <span ... />"));
}
