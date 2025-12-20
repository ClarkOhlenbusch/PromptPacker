# PromptPack for Colab: Architecture

**Date:** December 19, 2025
**Type:** Browser Extension (Chrome/Edge/Brave/Firefox)

## 1. Objective
Enable users to use the PromptPack interface directly inside Google Colab. The tool will identify code cells as "files," allowing users to select/deselect specific cells and pack them into a single context prompt, maintaining the familiar UX of the desktop app.

## 2. Technical Approach: The "Adapter" Pattern

To reuse the existing React codebase (`prompt-pack-lite`) without duplication, we will abstract the data fetching layer.

### Current Structure (Tightly Coupled)
`App.tsx` directly calls `invoke('get_files')` (Tauri).

### New Structure (Decoupled)
We introduce a `FileSystemInterface`:

```typescript
interface FileSystemInterface {
  scan(): Promise<FileNode[]>;
  readFile(id: string): Promise<string>;
}
```

We then implement two adapters:
1.  **`TauriFileSystem`**: Uses Rust/Tauri to read disk files (for Desktop).
2.  **`ColabFileSystem`**: Uses Chrome Messaging to query the Content Script (for Extension).

## 3. Extension Architecture

### A. Manifest V3
- **Permissions:** `activeTab`, `scripting`, `storage`.
- **Host Permissions:** `https://colab.research.google.com/*`

### B. Content Script (`colab-injector.js`)
- Runs on `colab.research.google.com`.
- **Observer:** Watches the DOM for the Colab toolbar to inject the "PromptPack" trigger button.
- **Scraper:** When requested, iterates through Colab DOM elements (Monaco editors) to extract:
    - Cell Index
    - Cell Content (Code)
    - Output (Optional, v2)
- **Message Listener:** Responds to requests from the UI (e.g., "Get all cells").

### C. The UI (Side Panel)
- We configure the extension to use the **Chrome Side Panel API**.
- The Side Panel loads `index.html` from our React build.
- **Build Step:** We create a separate Vite build config `vite.config.colab.ts` that builds the React app into the extension's `dist/` folder.

## 4. Development Roadmap

1.  **Refactor `prompt-pack-lite`**:
    - Create `src/services/FileSystem.ts` (The Abstraction).
    - Move Tauri calls into `src/services/TauriAdapter.ts`.
    - Ensure App loads dummy data if Tauri is not present (preparation for web build).
2.  **Scaffold Extension**:
    - Create `prompt-pack-extension/` directory.
    - Create `manifest.json`.
    - Create basic Content Script to detect Colab cells.
3.  **Integration**:
    - Build React app -> Copy to Extension folder.
    - Wire up the `ColabAdapter` to talk to the content script.

## 5. User Experience
1.  User installs "PromptPack" from Chrome Web Store.
2.  User opens a Google Colab notebook.
3.  A small "PromptPack" icon appears in the Colab header (or user clicks extension icon).
4.  The PromptPack Sidebar slides out.
5.  It lists all Cells: "Cell 1 (Imports)", "Cell 2 (Model Def)", etc.
6.  User selects specific cells and clicks "Pack".
7.  Result is copied to clipboard.
