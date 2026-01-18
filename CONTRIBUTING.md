# Contributing to PromptPacker

Thank you for your interest in contributing to PromptPacker! This project is **open source** under the Apache 2.0 license. We welcome contributions from the community. Please follow these guidelines when contributing.

## Development Workflow

1.  **Branching:**
    *   Create a new branch for every feature or bug fix.
    *   Use the format: `feature/your-feature-name` or `fix/bug-description`.
    *   Do not commit directly to `main`.

2.  **Commit Messages:**
    *   Write clear, concise commit messages.
    *   Start with a verb (e.g., "Add", "Fix", "Update", "Remove").
    *   Example: `Add tree-sitter support for Python files`

3.  **Code Style:**
    *   **TypeScript/React:** We use standard Prettier configuration. Ensure your editor formats on save.
    *   **Rust:** Use `cargo fmt` to format Rust code.
    *   **Linting:** Run `npm run lint` (or equivalent) before pushing to catch potential errors.

## Project Structure specifics

*   **`prompt-pack-lite/src-tauri`**: Contains the Rust backend. Any file system operations or heavy lifting should be implemented here as a Tauri command.
*   **`ColabPromptPack/public`**: Contains the Manifest V3 extension scripts (`background.js`, `content.js`). Be careful when modifying `content.js` as it interacts directly with the Google Colab DOM, which can be fragile.

## Testing

*   **Desktop:** Run the app using `npm run tauri dev` and manually verify your changes.
*   **Extension:** You must reload the extension in `chrome://extensions` and refresh the Colab tab to see changes.

## Reporting Bugs

If you find a bug, please create an Issue in the repository with:
1.  Description of the issue.
2.  Steps to reproduce.
3.  Expected vs. Actual behavior.
4.  Screenshots (if applicable).
