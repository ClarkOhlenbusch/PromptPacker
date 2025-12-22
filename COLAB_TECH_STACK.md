# PromptPack Colab: Architecture & Stack

## 1. High-Level Overview
**PromptPack Colab** is a **Pure Browser Extension** port of the original PromptPack desktop app. 

### Key Change: No Rust
Unlike the desktop version (which uses **Rust/Tauri** to read files from your hard drive), this version is **100% TypeScript/React**. It does **not** use Rust.
*   **Desktop App:** Rust reads `C:/Users/...`
*   **Colab Extension:** JavaScript reads the HTML DOM of the active browser tab.

## 2. Tech Stack
*   **Runtime:** Chrome Extension V3 (Manifest V3)
*   **Frontend Framework:** React 19
*   **Build Tool:** Vite (builds the React app into standard HTML/JS for the browser)
*   **Styling:** Tailwind CSS
*   **Icons:** Lucide React
*   **Language:** TypeScript

## 3. Directory Structure (`ColabPromptPack/`)

### Core Extension Files (`public/`)
These files interact directly with the Chrome Browser API.
*   `manifest.json`: The configuration file. Defines permissions and scripts.
*   `background.js`: Runs in the background. Listens for the toolbar icon click.
*   `content.js`: **The Bridge.** Runs *inside* the Google Colab page.
    *   It scrapes code from cells.
    *   It injects the PromptPack UI (IFrame) onto the page.

### The UI Application (`src/`)
This is the React application. It is almost identical to the desktop version but uses a different "Data Adapter".
*   `App.tsx`: The main UI component.
*   `services/`
    *   `FileSystem.ts`: The Interface (Contract). Defines `scanProject` and `readFile`.
    *   `ColabFileSystem.ts`: **The Implementation.** Instead of asking Rust for files, it asks `content.js` to scrape the page.
*   `utils/`: Helper logic for formatting prompts (shared with desktop).

## 4. Data Flow
1.  **User Clicks Icon:** `background.js` sends "TOGGLE_OVERLAY" to `content.js`.
2.  **Overlay Opens:** `content.js` creates an IFrame loading `index.html` (React App).
3.  **App Scans:** `App.tsx` calls `fs.scanProject()`.
4.  **Message Passing:**
    *   `ColabFileSystem` sends "GET_CELLS" message to `content.js`.
    *   `content.js` queries the DOM (`document.querySelectorAll`) to find code cells.
    *   `content.js` returns the text content to React.
5.  **User Generates:** React formats the text and copies to clipboard.
