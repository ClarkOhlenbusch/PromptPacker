# 🚀 PromptPacker Launch Kit

**Ready to launch?** This file contains everything you need to copy-paste for your launch.

---

## Pre-Launch Checklist

- [ ] README updated ✓
- [ ] Assets folder created ✓
- [ ] Logo in assets ✓
- [ ] Screenshots taken (YOU DO THIS)
  - Save as: `assets/screenshot-main.png` (main interface)
  - Save as: `assets/screenshot-skeleton.png` (AST skeletonization view)
- [ ] Test install flow
- [ ] Latest release published on GitHub

---

## 📋 Git Commit & Push

```bash
git add .
git commit -m "docs: polish README for launch, add assets folder

- Rewrite README with better hook and structure
- Add logo to assets folder
- Add launch materials"
git push origin main
```

---

## 🟠 Hacker News - Show HN

**URL:** https://news.ycombinator.com/submit

**Title:** Show HN: PromptPacker – Stop pasting code into ChatGPT

**Body:**

```
Hey HN,

Built this because I was tired of copy-pasting 47 files into ChatGPT and hoping it understood my codebase.

PromptPacker is a context engineering toolkit for working with LLMs. It:

• Scans your project intelligently (respects .gitignore, skips binaries)
• Generates AST skeletons — 70% fewer tokens, same structural understanding
• Runs 100% locally (Rust/Tauri desktop app)
• Has a Chrome extension for Google Colab

The "AST skeletonization" thing is the killer feature IMO. Instead of pasting full file contents, you get imports, types, and function signatures. The LLM understands your architecture without wasting tokens on implementation details.

Site: https://promptpacker.dev
GitHub: https://github.com/ClarkOhlenbusch/PromptPacker

Tech stack: Rust (Tauri v2), React 19, TypeScript, Tree-sitter

Built this in my spare time. Would love feedback!
```

**Best time to post:** Tuesday-Thursday, 8-10 AM PT

---

## 🐦 Twitter/X Thread

**Post 1:**
```
I built a tool that cut my ChatGPT token usage by 70%.

It's called PromptPacker, and it completely changed how I work with LLMs.

Here's what it does 🧵
```

**Post 2:**
```
The problem: You're working on a codebase and want to ask ChatGPT something.

So you copy-paste files. A lot of files.

But most of what you paste is noise — node_modules, build artifacts, implementation details the LLM doesn't need.
```

**Post 3:**
```
PromptPacker fixes this with "AST skeletonization."

Instead of full file contents, you get:
• Imports
• Types  
• Function signatures

70% fewer tokens. Same structural understanding.
```

**Post 4:**
```
It runs 100% locally.

No cloud. No tracking. No BS.

Just a fast Rust + Tauri desktop app that respects your .gitignore and skips binaries automatically.
```

**Post 5:**
```
There's also a Chrome extension for Google Colab.

Same features, but works inside your notebook. Tracks diffs, takes snapshots, has global hotkeys.

Because context engineering shouldn't stop at your desktop.
```

**Post 6:**
```
It's free, open source, and I use it every day.

🌐 https://promptpacker.dev
⭐ https://github.com/ClarkOhlenbusch/PromptPacker

Built with Rust, React, and too much coffee.

RTs appreciated 🙏
```

**Best time:** Tuesday-Thursday, 9-11 AM ET

---

## 🔴 Reddit Posts

### r/rust

**URL:** https://www.reddit.com/r/rust/submit

**Title:** PromptPacker — A context engineering toolkit built with Rust + Tauri

**Body:**
```
Hey r/rust!

Been working on a desktop app for "context engineering" — basically, intelligently packaging codebases for LLMs.

The desktop app is built with Tauri v2 + Rust. Uses tree-sitter for parsing and generating AST skeletons (imports, types, function signatures). This cuts token usage by ~70% while keeping structural context.

Also built a Chrome extension (React + Vite) that brings the same features to Google Colab.

GitHub: https://github.com/ClarkOhlenbusch/PromptPacker
Site: https://promptpacker.dev

Curious what you all think! Particularly interested in feedback on the Rust architecture — using a FileSystem abstraction that works across desktop (tauri::command) and browser (DOM scraping via postMessage).
```

### r/webdev

**URL:** https://www.reddit.com/r/webdev/submit

**Title:** I built a tool that cut my ChatGPT token usage by 70%

**Body:**
```
As a web dev, I'm constantly asking ChatGPT questions about my codebase.

But copy-pasting files is painful:
• You paste too much (node_modules, build artifacts)
• You waste tokens on implementation details
• You lose track of what you already shared

So I built PromptPacker. It:

✅ Scans your project (respects .gitignore)
✅ Generates AST skeletons (imports, types, signatures)
✅ Runs 100% locally (Rust + Tauri)
✅ Has a Chrome extension for Colab

The "skeletonization" is the killer feature. Instead of full file contents, the LLM gets just the structure. Way fewer tokens, same understanding.

It's free and open source. Would love your feedback!

https://promptpacker.dev
```

### r/LocalLLaMA

**URL:** https://www.reddit.com/r/LocalLLaMA/submit

**Title:** PromptPacker — Context engineering toolkit for local LLM workflows

**Body:**
```
For those of us running local LLMs, token efficiency matters even more.

Built PromptPacker to intelligently package codebases for LLMs. Key features:

• AST skeletonization — 70% token reduction via tree-sitter parsing
• Smart file selection — respects .gitignore, skips binaries
• 100% local — Rust/Tauri desktop app, no cloud
• Chrome extension — works in Google Colab

The AST approach gives you structural understanding without burning tokens on implementation details. Especially useful for smaller context windows.

https://github.com/ClarkOhlenbusch/PromptPacker

Would appreciate any feedback from the local LLM community!
```

---

## 💬 Discord Communities

Copy-paste this into relevant channels:

```
Hey all! Just launched PromptPacker — a context engineering toolkit for working with LLMs.

Built with Rust + Tauri (desktop) and React (browser extension).

Key feature: AST skeletonization that cuts token usage by 70% while keeping structural context.

https://promptpacker.dev

Would love feedback from this community!
```

**Communities to hit:**
- Theo's Discord (t3.gg)
- Fireship Discord
- Rust Programming Language (official)
- Tauri Discord
- LocalLLaMA Discord
- Latent Space Discord

---

## 🟣 Product Hunt (Wait for traction first)

**URL:** https://www.producthunt.com/posts/new

**Title:** PromptPacker — Context engineering for LLMs

**Tagline:** Stop pasting code. Start packing.

**Description:**
```
PromptPacker intelligently packages your codebase for LLMs. 

Instead of copy-pasting files into ChatGPT, you get:

• Smart project scanning (respects .gitignore)
• AST skeletonization (70% fewer tokens)
• 100% local desktop app (Rust/Tauri)
• Chrome extension for Google Colab

The "AST skeletonization" feature generates structural summaries — imports, types, function signatures — so LLMs understand your architecture without wasting tokens on implementation details.

Free and open source.
```

**Topics:** Developer Tools, AI, Productivity, Open Source

**Makers:** Clark Ohlenbusch

---

## 📊 Success Metrics to Track

After launch, watch these:

| Metric | Baseline | Week 1 Goal |
|--------|----------|-------------|
| GitHub Stars | 5 | 50-100 |
| Website Visits | 0 | 1000+ |
| HN Position | — | Front page |
| Reddit Upvotes | — | 50+ per post |

---

## 🔄 Follow-up Content Ideas

After launch, keep momentum:

1. **"How I built PromptPacker"** blog post
2. **"AST Skeletonization deep dive"** technical writeup  
3. **"PromptPacker vs manual copy-paste"** comparison
4. **Twitter thread:** Lessons learned building with Rust + Tauri
5. **60-second demo video** for TikTok/Reels/Shorts

---

## Need Help?

Tag me (@MeLo) if you need:
- Responses to comments/questions
- Follow-up posts drafted
- README updates based on feedback
- Anything else!

**Now go get those stars!** ⭐
