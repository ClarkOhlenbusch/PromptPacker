# PromptPack Project Overview

This repository contains the ecosystem for **PromptPack**, a tool designed to intelligently "pack" codebases into concise contexts for Large Language Models (LLMs). It features a multi-platform architecture sharing a common core.

## Project Structure

The repository is organized into distinct sub-projects:

### 1. `prompt-pack-lite` (Desktop App)
*   **Type:** Desktop Application (Windows, macOS, Linux)
*   **Stack:** Rust (Tauri v2), React 19, TypeScript, Tailwind CSS.
*   **Key Features:**
    *   Reads local file systems.
    *   Uses `tree-sitter` for AST-based code skeletonization (summarizing code structure).
    *   Respects `.gitignore` via the `ignore` crate.
*   **Build & Run:**
    *   `npm run tauri dev`: Start the application in development mode.
    *   `npm run tauri build`: compile a release binary.

### 2. `ColabPromptPack` (Chrome Extension)
*   **Type:** Browser Extension (Chrome Manifest V3)
*   **Stack:** React 19, TypeScript, Tailwind CSS, Vite.
*   **Key Features:**
    *   Enables PromptPack directly inside Google Colab.
    *   **Architecture:** Uses an "Adapter Pattern". Replaces the local file system calls with a DOM scraper (`content.js`) that reads code cells from the active Colab notebook.
    *   **Data Flow:** `Background Script` -> `Content Script` (Scraper) -> `React UI` (via IFrame/Side Panel).
*   **Build:**
    *   `npm run build`: Compiles the React application. (Note: Ensure extension-specific files like `manifest.json` and background scripts are correctly packaged).

### 3. `prompt-pack-site` (Landing Page)
*   **Type:** Static Website
*   **Stack:** React 19, Vite, Tailwind CSS.
*   **Purpose:** Marketing and download site for PromptPack.
*   **Build:**
    *   `npm run dev`: Local development server.
    *   `npm run build`: Production build.

### 4. `prompt-pack-heavy` (Planned)
*   **Type:** Local AI Desktop App (Privacy-First)
*   **Status:** Architecture Draft (see `PROMPT_PACK_HEAVY_ARCH.md`).
*   **Goal:** Use local SLMs (e.g., Qwen2.5-Coder-3B via Candle) to generate intelligent semantic summaries of code instead of raw text.

## Development Conventions

*   **Frontend Shared Stack:** All frontend components use **React 19**, **TypeScript**, and **Tailwind CSS**.
*   **Icons:** `lucide-react` is the standard icon library.
*   **Code Sharing:** The project aims to share UI logic between the Desktop and Extension versions by abstracting the data source behind a `FileSystem` interface (`scanProject`, `readFile`).
    *   `TauriFileSystem`: Adapts to Rust/Tauri `fs` plugin.
    *   `ColabFileSystem`: Adapts to Browser DOM scraping.

## Key Documentation Files
*   `COLAB_TECH_STACK.md`: Technical details for the Colab extension.
*   `PROMPT_PACK_COLAB_ARCH.md`: Architecture overview for the Colab extension.
*   `PROMPT_PACK_HEAVY_ARCH.md`: Design doc for the future "Heavy" version.
