# PromptPacker

**Stop pasting code. Start Packing.**

PromptPacker is a suite of tools designed for **Context Engineering**. It allows you to intelligently select, compress, and format your codebase into high-signal prompts for Large Language Models (LLMs).

## Project Ecosystem

This repository is a monorepo containing three distinct projects sharing a common core:

### 1. PromptPack Lite (Desktop App)
A native desktop application that runs 100% locally on your machine.

*   **Location:** `prompt-pack-lite/`
*   **Tech Stack:** Rust (Tauri v2), React 19, TypeScript, Tailwind CSS.
*   **Key Features:**
    *   **Local File Scanning:** Recursively scans directories, respecting `.gitignore` and skipping binary files (images, fonts, etc.).
    *   **AST Skeletonization:** Uses `tree-sitter` (via Rust) to generate structural summaries (imports, types, function signatures) of your code, reducing token usage by ~70% while keeping context.
    *   **Auto-Watch:** Automatically detects file changes and refreshes the file tree.
    *   **Context tiers:**
        *   **Full:** Includes the entire file content.
        *   **Skeleton:** Includes only the structural outline.
    *   **Smart Auto-Fill:** Generates a preamble based on `package.json`, `README.md`, and config files.

### 2. PromptPack Colab (Browser Extension)
A Chrome/Browser extension that brings the PromptPack interface directly into Google Colab notebooks.

*   **Location:** `ColabPromptPack/`
*   **Tech Stack:** React 19, Vite, Chrome Manifest V3.
*   **Key Features:**
    *   **DOM Scraping Adapter:** Uses a custom `ColabFileSystem` adapter to treat Notebook Cells as "files".
    *   **Diff Tracking:** Automatically tracks changes made to cells since the last scan/snapshot.
    *   **Visual Diffs:** View side-by-side diffs of your code changes before packing them.
    *   **Snapshotting:** Take snapshots of the notebook state to manage history during a session.
    *   **Quick Copy:** Global hotkeys (customizable) to copy the entire notebook context instantly.

### 3. PromptPack Site (Landing Page)
The marketing and distribution website.

*   **Location:** `prompt-pack-site/`
*   **Tech Stack:** React 19, Vite, Tailwind CSS.
*   **Features:**
    *   Auto-detects latest release from GitHub API.
    *   Provides download links for macOS (Apple Silicon/Intel).

## Architecture

The project uses a **Hexagonal Architecture** approach on the frontend to share UI logic between the Desktop and Extension versions.

*   **`FileSystem` Interface:** A shared abstraction that defines how the app reads data.
    *   **Desktop:** Calls Rust `tauri::command` (`scan_project`, `read_file_content`).
    *   **Extension:** Uses `window.postMessage` to query the `content.js` script which scrapes the DOM.

## Development

### Prerequisites
*   Node.js (v18+)
*   Rust (latest stable) for Desktop App

### Building the Desktop App
```bash
cd prompt-pack-lite
npm install
npm run tauri dev   # Run in development mode
npm run tauri build # Build release binary
```

### Building the Extension
```bash
cd ColabPromptPack
npm install
npm run build
# Load the 'dist' folder as an unpacked extension in Chrome/Edge.
```

### Running the Site
```bash
cd prompt-pack-site
npm install
npm run dev
```

## Future Plans (PromptPack Heavy)
A planned "Heavy" version will introduce a local Small Language Model (SLM) to perform semantic summarization of code files, moving beyond AST skeletonization to true "AI-reading" of files.

---
© 2025 PromptPacker. All Rights Reserved.
