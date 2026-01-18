# PromptPacker Testing Guide

This document outlines the testing strategy and execution for the PromptPacker ecosystem.

## 1. Backend Core (Rust)
The core skeletonization logic is written in Rust and resides in `prompt-pack-lite/src-tauri`.

- **Tools:** Cargo (built-in test runner).
- **Files:** `src-tauri/src/skeleton_tests.rs`.
- **Architecture:** Transitioning to a modular system in `src-tauri/src/skeleton/`.
- **Coverage:** 
    - **Modular (New):** Python, Rust, Go, JSON, CSS, HTML.
    - **Legacy:** JavaScript, TypeScript, JSX, TSX.
- **Run Tests:**
  ```bash
  cd prompt-pack-lite/src-tauri
  cargo test
  ```

## 2. Frontend Components (React)
React components and UI logic are tested using **Vitest** and **React Testing Library**.

### PromptPack Lite (Desktop)
- **Files:** `prompt-pack-lite/src/**/*.test.tsx`.
- **Run Tests:**
  ```bash
  cd prompt-pack-lite
  npm run test
  ```

### ColabPromptPack (Chrome Extension)
- **Files:** `ColabPromptPack/src/**/*.test.tsx`.
- **Run Tests:**
  ```bash
  cd ColabPromptPack
  npm run test
  ```

## 3. Best Practices
- **Mock External APIs:** Use `vi.mock` for Tauri APIs (`@tauri-apps/api/*`) or Chrome Extension APIs (`chrome.*`).
- **Focus on Behavior:** Test that components render correctly and respond to state changes (e.g., scanning, selection).
- **Keep Skeleton Logic in Rust:** Complexity for code parsing should stay in the Rust backend where it is heavily unit-tested.

## 4. CI/CD Integration
*Planned: Integrated GitHub Actions to run both Rust and Vitest suites on every PR.*
