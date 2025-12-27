# PromptPack Skeletonization (skel) Guide for AI Agents

The "skel" (skeletonization) feature in PromptPack is a sophisticated code compression algorithm designed to maximize the **meaning per token** in LLM contexts.

## Purpose

The primary goal of skeletonization is to provide an LLM with just enough structural context to understand a file's purpose, its internal API, and its relationship with the rest of the codebase, without wasting tokens on implementation details.

### Why use Skeletonization?
- **Maximize Context**: Pack more of the codebase into a single prompt.
- **Reduce Noise**: Remove low-value tokens (loop bodies, complex logic, internal states) that can distract an LLM from the high-level architecture.
- **Focus where it matters**: Users typically select a "Target File" in full for active editing, while the rest of the codebase is provided as a "Skeleton" to provide the necessary semantic bridge.
- **Show relationships between files minimally**: To understand the file's role in the codebase. while preserving the necessary semantic bridge.

## How it works

The algorithm uses tree-sitter AST parsing to intelligently prune source code while preserving:

- **Imports & Exports**: To understand external dependencies and provided interfaces.
- **Type Definitions**: (Interfaces, Structs, Classes, Type Aliases) to understand data shapes.
- **Function/Method Signatures**: To understand callable APIs (Parameters, Return Types, Decorators).
- **Docstrings (Summarized)**: To preserve high-level human intent.
- **Call Insights**:
    - **Rust/Python**: Lists significant internal and external function calls.
    - **JS/TS**: Detects "Invokes" (calls to external libraries like `axios`, or framework utilities like `invoke`) to provide a behavioral summary.

## The Balancing Act

Skeletonization is a trade-off between **token count** and **semantic completeness**.

> [!IMPORTANT]
> **Full File** = For active debugging and editing.
> **Skeleton** = For understanding "What is this file for?" and "How do I use its elements?".

If you are an agent working with a skeletonized file and find you are missing crucial details (like a specific implementation of a complex algorithm), you should request the user to provide that specific file in full.
