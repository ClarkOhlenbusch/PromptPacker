# 🚀 PromptPacker Launch Kit v2 — Colab-First Edition

**Ready to launch?** This file contains everything you need to copy-paste for your launch.

---

## Pre-Launch Checklist

- [ ] README updated ✓
- [ ] Assets folder created ✓
- [ ] Logo in assets ✓
- [ ] Screenshots taken (YOU DO THIS)
  - Save as: `assets/screenshot-colab.png` (extension in Colab)
  - Save as: `assets/screenshot-diff.png` (diff tracking feature)
  - Save as: `assets/screenshot-main.png` (desktop app — secondary)
- [ ] Chrome Web Store link ready (add to posts when available)
- [ ] Test install flow
- [ ] Latest release published on GitHub

---

## 📋 Git Commit & Push (if needed)

```bash
git add .
git commit -m "docs: update launch materials for Colab-first narrative"
git push origin main
```

---

## 🟠 Hacker News - Show HN

**URL:** https://news.ycombinator.com/submit

**Title:** Show HN: PromptPacker — A better way to get Colab code into ChatGPT

**Body:**

```
Hey HN,

I got tired of Gemini for Colab being... not great. It would try to analyze my entire notebook, download the whole Python file, and fill up context with stuff I didn't need.

So I built PromptPacker — a Chrome extension (plus desktop app) that treats Colab cells as actual "files" you can selectively pack for LLMs.

The problem I kept hitting:
• Gemini would analyze the entire notebook or download the whole .ipynb
• No way to show diffs between versions
• No easy way to select just the cells that changed
• Context would get stuffed with outputs I didn't care about

What PromptPacker does:
• Treats each Colab cell as a "file" you can select/deselect
• Tracks diffs — see exactly what changed since your last snapshot
• Visual diff view before you pack
• Global hotkeys to copy context instantly
• 70% token reduction via AST skeletonization

Also has a desktop app (Rust/Tauri) for local projects, but honestly I built the extension first because that's where I was feeling the pain every day.

Chrome Web Store: [link when ready]
Site: https://prompt-packer-one.vercel.app/
GitHub: https://github.com/ClarkOhlenbusch/PromptPacker

Tech: React, Vite, Chrome Manifest V3, Rust/Tauri for desktop

Would love feedback from other Colab users!
```

**Best time to post:** Tuesday-Thursday, 8-10 AM PT

---

## 🐦 Twitter/X Thread — Colab-Focused

**Post 1 (Hook):**
```
Gemini for Google Colab is... not it.

I was tired of it downloading my entire notebook, stuffing context with garbage, and having zero way to show diffs.

So I built something better.

Here's PromptPacker 🧵
```

**Post 2 (The Pain):**
```
The daily struggle:

• Ask Gemini about my Colab → it analyzes the ENTIRE notebook
• Try to paste into ChatGPT → downloading .ipynb files like a caveman
• Want to show what changed → copy-paste cells manually
• Context gets nuked with outputs and metadata I don't need

There had to be a better way.
```

**Post 3 (The Solution):**
```
PromptPacker is a Chrome extension that treats Colab cells as actual "files."

✅ Select/deselect individual cells
✅ Track diffs since your last snapshot
✅ Visual side-by-side before packing
✅ Global hotkey (Ctrl+Shift+C) to copy instantly
✅ Respects your context budget
```

**Post 4 (The Tech):**
```
How it works:

The extension injects into Colab's DOM, treats cells as a virtual filesystem, and gives you a file-tree UI right in the sidebar.

Plus AST skeletonization — instead of full cell contents, you get structure (imports, function signatures). 70% fewer tokens, same understanding.
```

**Post 5 (Desktop Bonus):**
```
There's also a desktop app (Rust + Tauri) for local projects.

Same features, but for your actual filesystem:
• Respects .gitignore
• Auto-watch for changes
• Smart preamble generation

Built it because the extension worked so well I wanted it everywhere.
```

**Post 6 (CTA):**
```
It's free, open source, and I use it every single day.

If you use Colab + ChatGPT/Claude, this will save you time.

🌐 https://prompt-packer-one.vercel.app/
⭐ https://github.com/ClarkOhlenbusch/PromptPacker
🧩 Chrome Web Store: [link]

Built because Gemini wasn't cutting it. Hope it helps you too 🙏
```

**Best time:** Tuesday-Thursday, 9-11 AM ET

---

## 🔴 Reddit Posts

### r/MachineLearning

**URL:** https://www.reddit.com/r/MachineLearning/submit

**Title:** I built a Chrome extension that makes getting Colab code into ChatGPT actually good

**Body:**
```
Like many of you, I use Google Colab for ML experiments and ChatGPT/Claude for help.

But getting code from Colab into an LLM context was always painful:

• Gemini for Colab would try to analyze the entire notebook
• Downloading the .ipynb meant dealing with JSON metadata
• No way to show diffs between versions
• No easy selection of "just the cells that changed"

So I built PromptPacker — a Chrome extension that:

✅ Treats each Colab cell as a selectable "file"
✅ Tracks diffs since your last snapshot
✅ Shows visual diffs before packing
✅ Has global hotkeys for instant copy
✅ Does AST skeletonization (70% token reduction)

The extension injects into Colab's DOM and gives you a file-tree UI in the sidebar. Way easier than copy-pasting individual cells or dealing with notebook downloads.

Also has a desktop app (Rust/Tauri) for local projects with the same features.

Chrome Web Store: [link]
Site: https://prompt-packer-one.vercel.app/
GitHub: https://github.com/ClarkOhlenbusch/PromptPacker

Built this because I was feeling the pain daily. Hope it helps some of you too!
```

### r/webdev

**URL:** https://www.reddit.com/r/webdev/submit

**Title:** Showoff Saturday: I built a Chrome extension because Gemini for Colab wasn't cutting it

**Body:**
```
The problem: I use Google Colab for quick prototypes and ChatGPT for debugging. But getting code from Colab into ChatGPT was always:

• Copy-pasting individual cells (tedious)
• Downloading the entire .ipynb (messy)
• Using Gemini (which would analyze the whole notebook and miss the point)

So I built PromptPacker — a Chrome extension that treats Colab cells as a virtual filesystem.

Features:
• File-tree UI in the Colab sidebar
• Select/deselect cells like files
• Diff tracking — see what changed since last snapshot
• Visual diff view before packing
• Global hotkey to copy context instantly
• AST skeletonization (structure only, 70% fewer tokens)

Tech stack: React 19, Vite, Chrome Manifest V3, DOM scraping via content script

There's also a desktop version (Rust + Tauri) for local projects, but the extension was the "scratch your own itch" origin story.

Chrome Web Store: [link]
GitHub: https://github.com/ClarkOhlenbusch/PromptPacker

Curious what other devs think!
```

### r/LocalLLaMA

**URL:** https://www.reddit.com/r/LocalLLaMA/submit

**Title:** PromptPacker — Context engineering for Colab (with local LLM support in mind)

**Body:**
```
If you're running local LLMs, token efficiency matters even more.

I built PromptPacker primarily as a Chrome extension for Google Colab, with a focus on sending only the context you actually need.

The Colab Problem:
• Gemini tries to analyze your entire notebook
• Downloading .ipynb files includes tons of metadata
• No way to select specific cells or show diffs
• Context gets bloated with outputs

PromptPacker fixes this by:
• Treating cells as selectable "files"
• AST skeletonization — send structure (imports, signatures) not full implementations
• 70% token reduction while keeping semantic understanding
• Diff tracking — only pack what changed

Built with local LLMs in mind: when you have a 4K-8K context window, every token matters. Sending skeletonized code vs full implementations is the difference between fitting your whole project context or not.

Also has a desktop app (Rust/Tauri) for local file projects.

Chrome Web Store: [link]
GitHub: https://github.com/ClarkOhlenbusch/PromptPacker

Would love feedback from the local LLM community!
```

### r/rust

**URL:** https://www.reddit.com/r/rust/submit

**Title:** PromptPacker — Built a Chrome extension first, then a Rust desktop app

**Body:**
```
Hey r/rust!

Built a Chrome extension (React/Vite) to solve a Colab workflow problem, then liked the architecture so much I built a desktop version with Tauri v2 + Rust.

The original problem: Gemini for Colab would analyze entire notebooks, download massive .ipynb files, and provide no diff tracking. So I built a browser extension that treats Colab cells as a virtual filesystem.

The desktop app (prompt-pack-lite/) uses:
• Tauri v2 for the Rust backend
• Tree-sitter for AST parsing
• Hexagonal architecture shared with the extension

The FileSystem abstraction is the cool part — same React frontend works with:
• Desktop: Rust tauri::command for file scanning
• Extension: DOM scraping via content script + postMessage

GitHub: https://github.com/ClarkOhlenbusch/PromptPacker
Site: https://prompt-packer-one.vercel.app/

Curious what Rustaceans think of the Tauri architecture!
```

---

## 💬 Discord Communities

### For ML/AI Communities (LocalLLaMA, Latent Space, etc.):

```
Built a Chrome extension for Google Colab because Gemini wasn't cutting it.

Problem: Gemini analyzes your entire notebook, downloads massive .ipynb files, no diff tracking.

Solution: Treat Colab cells as selectable "files" — pick what you want, see diffs, copy instantly. Plus AST skeletonization for 70% token reduction.

Built it for my own Colab → ChatGPT workflow. Hope it helps others too.

https://prompt-packer-one.vercel.app/
Chrome Web Store: [link]
```

### For Web Dev Communities (Theo's discord, etc.):

```
Shipped a Chrome extension that makes Colab + ChatGPT actually usable.

Gemini for Colab was driving me nuts — entire notebook analysis, no diff tracking, bloated context. So I built PromptPacker.

Injects into Colab, treats cells as a virtual filesystem, has global hotkeys, diff tracking, AST skeletonization.

Also has a Rust/Tauri desktop app for local projects.

Check it out: https://prompt-packer-one.vercel.app/
```

---

## 🟣 Product Hunt (Wait for traction first)

**URL:** https://www.producthunt.com/posts/new

**Title:** PromptPacker — The Colab extension I wish existed

**Tagline:** Stop fighting Gemini. Start packing.

**Description:**
```
I built PromptPacker because Gemini for Google Colab wasn't cutting it.

Every time I wanted to get Colab code into ChatGPT, I had to:
• Copy-paste individual cells (tedious)
• Download the entire .ipynb (messy)
• Watch Gemini analyze my whole notebook (slow, bloated)

PromptPacker is a Chrome extension that treats Colab cells as actual "files":

• Select/deselect cells in a file-tree UI
• Track diffs since your last snapshot
• Visual diff view before packing
• Global hotkey for instant copy
• AST skeletonization — 70% fewer tokens

Also has a desktop app (Rust/Tauri) for local projects with the same features.

Built for my own daily workflow. Hope it helps yours.
```

**Topics:** Developer Tools, AI, Productivity, Chrome Extensions, Open Source

**Makers:** Clark Ohlenbusch

---

## 📧 Email/Newsletter Pitch (if needed)

**Subject:** I built a Chrome extension because Gemini for Colab was driving me nuts

**Body:**

```
Hey [name],

Quick one: I built a Chrome extension called PromptPacker and I think you might dig it.

The backstory: I use Google Colab for prototypes and ChatGPT for debugging. But getting code from Colab into ChatGPT was always painful.

Gemini for Colab would try to analyze my entire notebook. Or I'd download the .ipynb and paste it, which meant dealing with JSON metadata and bloated context. No diff tracking. No way to select just the cells I changed.

So I built PromptPacker. It's a Chrome extension that:

• Treats each Colab cell as a "file" you can select/deselect
• Tracks diffs — see exactly what changed since your last snapshot
• Shows visual diffs before you pack
• Has global hotkeys for instant copy
• Does AST skeletonization (70% token reduction)

I use it every day. Also built a desktop app (Rust + Tauri) for local projects.

Check it out:
• Site: https://prompt-packer-one.vercel.app/
• Chrome Web Store: [link]
• GitHub: https://github.com/ClarkOhlenbusch/PromptPacker

Would love your take!

— Clark
```

---

## 📊 Success Metrics to Track

After launch, watch these:

| Metric | Baseline | Week 1 Goal |
|--------|----------|-------------|
| GitHub Stars | 5 | 50-100 |
| Website Visits | 0 | 1000+ |
| Chrome Extension Installs | 0 | 100+ |
| HN Position | — | Front page |
| Reddit Upvotes | — | 50+ per post |

---

## 🔄 Follow-up Content Ideas

After launch, keep momentum:

1. **"Why Gemini for Colab Falls Short"** — comparison post
2. **"Building a Chrome Extension for DOM Scraping"** — technical deep dive
3. **"How I reduced LLM token usage by 70%"** — AST skeletonization explainer
4. **Video demo:** 60-second Colab workflow before/after
5. **Twitter thread:** "The anatomy of a Colab cell" — why .ipynb is messy

---

## Need Help?

Tag me (@MeLo) if you need:
- Responses to comments/questions
- Follow-up posts drafted
- README updates based on feedback
- Chrome Web Store listing copy
- Anything else!

**Now go get those installs!** 🚀
