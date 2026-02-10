# PromptPacker

<p align="center">
  <img src="./assets/logo.png" alt="PromptPacker" width="120">
</p>

<p align="center">
  <strong>Stop pasting code. Start Packing.</strong>
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-why-promptpacker">Why?</a> •
  <a href="#-features">Features</a> •
  <a href="https://promptpacker.dev">Website</a>
</p>

<p align="center">
  <a href="https://github.com/ClarkOhlenbusch/PromptPacker/releases">
    <img src="https://img.shields.io/github/v/release/ClarkOhlenbusch/PromptPacker?color=0069C3&style=flat-square" alt="Release">
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square" alt="License">
  </a>
</p>

---

## 🚀 Quick Start

### macOS (Apple Silicon)
```bash
curl -L https://github.com/ClarkOhlenbusch/PromptPacker/releases/latest/download/prompt-pack-lite_aarch64.dmg -o PromptPacker.dmg
open PromptPacker.dmg
```

### Other Platforms
Download the latest release for your OS from [GitHub Releases](https://github.com/ClarkOhlenbusch/PromptPacker/releases).

**Or visit [promptpacker.dev](https://promptpacker.dev)** for auto-detected downloads.

---

## 🤔 Why PromptPacker?

You know that thing where you copy-paste 47 files into ChatGPT and hope it understands your codebase?

Yeah, we fixed that.

**PromptPacker** is a context engineering toolkit that intelligently selects, compresses, and formats your code for LLMs. It understands *structure*, not just text.

### The Problem

- Most files you paste are noise (node_modules, build artifacts, images)
- Full file contents waste tokens on implementation details
- You lose track of what you already shared
- Browser-based AI tools have no concept of "your project"

### The Solution

- **Smart Scanning** — Respects `.gitignore`, skips binaries automatically
- **AST Skeletonization** — 70% fewer tokens, same structural understanding
- **Context Tiers** — Full code, skeleton, or omit entirely
- **Auto-Watch** — Your context stays current as you code

---

## ✨ Features

### 🖥️ PromptPack Lite (Desktop App)

A native desktop app that runs **100% locally**. No cloud, no tracking.

| Feature | Description |
|---------|-------------|
| **Local File Scanning** | Recursively scans directories, respects `.gitignore` |
| **AST Skeletonization** | Tree-sitter powered structural summaries — imports, types, signatures |
| **Auto-Watch** | Detects file changes, refreshes automatically |
| **Context Tiers** | Full → Skeleton → Omit |
| **Smart Preamble** | Auto-generates context from `package.json`, `README.md`, config files |

**Tech Stack:** Rust (Tauri v2), React 19, TypeScript, Tailwind CSS

---

### 🧩 PromptPack Colab (Browser Extension)

Bring PromptPacker into your Google Colab workflow.

| Feature | Description |
|---------|-------------|
| **DOM Scraping Adapter** | Treats Colab cells as "files" |
| **Diff Tracking** | See what changed since your last snapshot |
| **Visual Diffs** | Side-by-side before packing |
| **Quick Copy** | Global hotkeys to grab entire notebook context |

**Tech Stack:** React 19, Vite, Chrome Manifest V3

---

### 🌐 PromptPack Site

Marketing site with auto-updating downloads from GitHub Releases.

**Live at:** [promptpacker.dev](https://promptpacker.dev)

---

## 📸 Screenshots

<p align="center">
  <i>Screenshots coming soon — see <a href="https://promptpacker.dev">promptpacker.dev</a> for live demo</i>
</p>

---

## 🏗️ Architecture

PromptPacker uses **Hexagonal Architecture** to share UI logic between Desktop and Extension:

```
┌─────────────────┐     ┌─────────────────┐
│   Desktop App   │     │   Extension     │
│   (Tauri/Rust)  │     │   (Chrome API)  │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │  FileSystem Interface │  ← Shared abstraction
         │  (scan, read, watch)  │
         └───────────┬───────────┘
                     │
         ┌───────────▼───────────┐
         │      Core Logic       │
         │   (React + TS)        │
         └───────────────────────┘
```

---

## 🔮 Roadmap

- [x] Desktop app (macOS)
- [x] Browser extension (Colab)
- [x] Landing page
- [x] Windows & Linux builds
- [ ] **PromptPack Heavy** — Local SLM for semantic code summarization
- [ ] VS Code extension
- [ ] JetBrains plugin

---

## 🛠️ Development

### Prerequisites

- Node.js (v18+)
- Rust (latest stable) — for Desktop App

### Desktop App

```bash
cd prompt-pack-lite
npm install
npm run tauri dev      # Development
npm run tauri build    # Production build
```

### Browser Extension

```bash
cd ColabPromptPack
npm install
npm run build
# Load 'dist' folder as unpacked extension in Chrome
```

### Landing Page

```bash
cd prompt-pack-site
npm install
npm run dev
```

---

## 📄 License

Apache License 2.0 — see [LICENSE](./LICENSE)

---

## 🙏 Acknowledgments

Built with:
- [Tauri](https://tauri.app) — Rust-based desktop framework
- [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) — Parsing wizardry
- [React](https://react.dev) — UI that doesn't fight you

---

<p align="center">
  <strong>Made with ☕ and 🦀</strong>
</p>

<p align="center">
  <a href="https://github.com/ClarkOhlenbusch">@ClarkOhlenbusch</a>
</p>
