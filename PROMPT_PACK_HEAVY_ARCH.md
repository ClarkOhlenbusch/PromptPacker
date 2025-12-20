# PromptPack Heavy: Architecture & Implementation Plan

**Date:** December 19, 2025  
**Status:** Planned / Draft

## 1. Project Objective
To build a standalone, privacy-first desktop application that leverages **Local AI** to intelligently summarize, compress, and organize codebases for LLM prompting. Unlike "Lite," "Heavy" will use an embedded Small Language Model (SLM) to "read" files and generate high-signal summaries rather than just concatenating raw text.

## 2. Core Constraints & Requirements
- **Hardware:** Must run on a generic laptop (e.g., MacBook Air M1/M2 or Windows equivalent) with 16GB RAM.
- **Privacy:** 100% Local. No data leaves the machine. No API keys required.
- **Performance:** Inference must be reasonable (streaming tokens). RAM usage for the model should ideally stay under 4GB.

## 3. Technology Stack

### Frontend
- **Framework:** React + TypeScript (Vite)
- **Styling:** Tailwind CSS (v4)
- **Design System:** Consistent with PromptPack Lite (Blue `#0069C3`, Clean UI).

### Backend (The "Heavy" Lifting)
- **Runtime:** Tauri v2 (Rust).
- **Inference Engine:** **[Candle](https://github.com/huggingface/candle)**.
    - Candle is a minimalist ML framework for Rust built by Hugging Face.
    - **Benefit:** Allows us to run quantized models (GGUF) *directly* inside the Rust binary. No Python installation, no Docker, no external servers (like Ollama) required for the end user.

## 4. Model Selection

**Chosen Model:** **Qwen2.5-Coder-3B-Instruct**

- **Why:** specifically fine-tuned for code analysis, logic, and reasoning. Significantly outperforms general-purpose models (like Llama 3.2 3B) on coding benchmarks (HumanEval, MBPP).
- **Format:** GGUF (Quantized).
- **Quantization Level:** 4-bit (Q4_K_M).
- **Specs:**
    - **File Size:** ~2.0 GB.
    - **RAM Usage:** ~3.5 - 4.5 GB total (including context cache).
    - **Context Window:** Supports up to 32k tokens (we may cap this at 8k or 16k depending on user RAM).

## 5. Distribution Strategy

**Approach: "Download on First Run"**

To keep the installer lightweight and friendly:
1.  **Installer:** ~10-15MB (Contains only the App logic + Tauri runtime).
2.  **First Launch:**
    - App detects the model is missing.
    - UI presents a "Downloading Local Intelligence Engine..." progress bar.
    - App fetches the ~2GB GGUF model file from a reliable CDN (or HuggingFace Hub) and stores it in the user's local application support directory (`~/Library/Application Support/com.promptpack.heavy/`).
    - **Benefit:** Faster initial install; easier to update the binary without re-downloading the model.

## 6. Key Features (vs Lite)
- **Smart Summarization:** Instead of dumping a 500-line file, the AI writes a 20-line summary of the class structure and public methods.
- **Semantic Search:** (Future) Ability to find files based on "what they do" rather than filenames.
- **Chat with Context:** Simple Q&A about the selected files before generating the final prompt.

## 7. Next Steps
1. Initialize `prompt-pack-heavy` directory (sibling to `lite`).
2. Set up Tauri + React scaffold.
3. Implement `candle-core` and `candle-nn` dependencies in Rust.
4. Build the "Model Manager" (downloader/verifier logic).
