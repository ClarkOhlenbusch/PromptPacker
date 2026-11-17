# Contributing to PromptPacker

Thank you for your interest in contributing to PromptPacker! This project is **open source** under the Apache 2.0 license. We welcome contributions from the community. Please follow these guidelines when contributing.

## Development Workflow

1.  **Fork & Branch:**
    *   `main` is the primary (and only) upstream branch.
    *   Fork the repository, then create a branch on your fork for every feature or bug fix (do not push directly to `main`).
    *   Use the format: `feature/your-feature-name` or `fix/bug-description`.
    *   Open a Pull Request from your branch targeting `main`.

2.  **Commit Messages:**
    *   Write clear, concise commit messages.
    *   Start with a verb (e.g., "Add", "Fix", "Update", "Remove").
    *   Example: `Add tree-sitter support for Python files`

3.  **Code Style & Checks:**
    *   **TypeScript/React:** Match the existing formatting and ensure TypeScript compiles cleanly (`npm run build` in the subproject you modified; `prompt-pack-site` also provides `npm run lint`).
    *   **Rust:** Run `cargo fmt` inside `prompt-pack-lite/src-tauri` to format Rust code.

## Project Structure Specifics

*   **`prompt-pack-lite`**: Desktop app (React/TypeScript frontend + `src-tauri` Rust backend). File system operations and AST skeletonization live in `prompt-pack-lite/src-tauri`.
*   **`ColabPromptPack`**: Chrome Manifest V3 extension. Be careful when modifying `content.ts` / `injected.ts` as they interact directly with the Google Colab DOM, which can be fragile.
*   **`promptpack-bridge`**: Local Node/Electron companion bridge for Colab Agent Terminal.
*   **`prompt-pack-site`**: Marketing and download site.

## Testing

Run the relevant automated checks for any subproject you touch (see [TESTING.md](TESTING.md) for details):

*   **PromptPack Lite (Desktop):**
    *   Rust backend: `cd prompt-pack-lite/src-tauri && cargo test`
    *   Frontend: `cd prompt-pack-lite && npx vitest run && npm run build`
    *   Manual check: `cd prompt-pack-lite && npm run tauri dev`
*   **ColabPromptPack (Extension):**
    *   Unit tests & build: `cd ColabPromptPack && npx vitest run && npm run build`
    *   Manual check: reload the `dist` folder in `chrome://extensions` and refresh the Colab tab.
*   **PromptPack Bridge:**
    *   Tests: `cd promptpack-bridge && npm test`
*   **PromptPack Site:**
    *   Lint & build: `cd prompt-pack-site && npm run lint && npm run build`

## Reporting Bugs

If you find a bug, please create an Issue in the repository with:
1.  Description of the issue.
2.  Steps to reproduce.
3.  Expected vs. Actual behavior.
4.  Screenshots (if applicable).
