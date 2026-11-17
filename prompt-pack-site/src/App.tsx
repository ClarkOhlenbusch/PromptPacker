import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  Chrome,
  Download,
  Github,
  Play,
  Star,
  Terminal,
} from "lucide-react";

const REPO_OWNER = "ClarkOhlenbusch";
const REPO_NAME = "PromptPacker";
const BRIDGE_RELEASES = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases?q=bridge-v&expanded=true`;
const COLAB_SETUP = `https://github.com/${REPO_OWNER}/${REPO_NAME}#agent-terminal-for-google-colab`;
const COLAB_PREVIEW = `https://github.com/${REPO_OWNER}/${REPO_NAME}/raw/refs/heads/main/PromptPackerColab-chrome.zip`;
const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/piniclchmidgfainpldphnocipgilmll?utm_source=item-share-cb";

type BridgeRelease = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  assets: { name: string; browser_download_url: string }[];
};

type BridgeStatus = {
  state: "loading" | "available" | "unavailable" | "error";
  release?: BridgeRelease;
};

type HeroTab = "colab-full" | "colab-sync" | "desktop";
type DesktopView = "clip" | "workspace" | "output";
type ColabClipTab = "start" | "sync" | "diff";

export default function App() {
  const [downloadUrl, setDownloadUrl] = useState("");
  const [osName] = useState(() => {
    const ua = window.navigator.userAgent;
    if (ua.includes("Win")) return "Windows";
    if (ua.includes("Linux") && !ua.includes("Android")) return "Linux";
    return "Mac";
  });
  const [starCount, setStarCount] = useState<number | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({ state: "loading" });

  const [heroTab, setHeroTab] = useState<HeroTab>("colab-sync");
  const [colabClip, setColabClip] = useState<ColabClipTab>("sync");
  const [desktopView, setDesktopView] = useState<DesktopView>("clip");
  const fullVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`)
      .then((res) => res.json())
      .then((data) => {
        if (data.tag_name) {
          let asset = null;
          if (data.assets && data.assets.length > 0) {
            if (osName === "Windows") {
              asset = data.assets.find((a: { name: string }) => a.name.endsWith(".exe"));
            } else if (osName === "Linux") {
              asset = data.assets.find((a: { name: string }) => a.name.endsWith(".AppImage"));
            } else {
              asset =
                data.assets.find(
                  (a: { name: string }) => a.name.includes("aarch64") && a.name.endsWith(".dmg")
                ) || data.assets.find((a: { name: string }) => a.name.endsWith(".dmg"));
            }
          }
          if (asset) setDownloadUrl(asset.browser_download_url);
        }
      })
      .catch((err) => console.error("Failed to fetch latest version", err));

    fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=100`)
      .then((res) => {
        if (!res.ok) throw new Error("Unable to check Bridge releases");
        return res.json() as Promise<BridgeRelease[]>;
      })
      .then((releases) => {
        const candidates = releases.filter(
          (item) =>
            item.tag_name.startsWith("bridge-v") &&
            !item.draft &&
            item.assets?.some((asset) => /\.(dmg|exe|AppImage|deb)$/i.test(asset.name))
        );
        const release = candidates.find((item) => !item.prerelease) || candidates[0];
        setBridgeStatus(release ? { state: "available", release } : { state: "unavailable" });
      })
      .catch(() => setBridgeStatus({ state: "error" }));

    const fetchStars = () => {
      fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`)
        .then((res) => res.json())
        .then((data) => {
          if (typeof data.stargazers_count === "number") {
            setStarCount(data.stargazers_count);
          }
        })
        .catch((err) => console.error("Failed to fetch GitHub stars", err));
    };

    fetchStars();
    const interval = window.setInterval(fetchStars, 5 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [osName]);

  const currentDownloadLink =
    downloadUrl || `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;

  const jumpToFullTimestamp = (seconds: number) => {
    setHeroTab("colab-full");
    window.setTimeout(() => {
      if (fullVideoRef.current) {
        fullVideoRef.current.currentTime = seconds;
        void fullVideoRef.current.play().catch(() => {});
      }
    }, 60);
  };

  return (
    <div className="min-h-screen bg-white text-[#1B2836] font-sans selection:bg-[#0066C0]/15 selection:text-[#0066C0]">
      {/* Navigation */}
      <header className="sticky top-0 z-50 border-b border-[#E3E8EE] bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <a href="#" className="flex items-center gap-2.5">
            <img
              src="/logo-mark.png"
              alt="PromptPacker mark"
              className="h-8 w-8 object-contain"
            />
            <span className="font-display text-lg font-semibold tracking-tight text-[#1B2836]">
              PromptPacker
            </span>
          </a>

          <nav className="hidden items-center gap-8 text-sm font-medium text-[#526273] md:flex">
            <a href="#colab-agent" className="hover:text-[#1B2836] transition-colors">
              Colab Agent
            </a>
            <a href="#desktop" className="hover:text-[#1B2836] transition-colors">
              Desktop App
            </a>
            <a href="#architecture" className="hover:text-[#1B2836] transition-colors">
              How it works
            </a>
            <a
              href={`https://github.com/${REPO_OWNER}/${REPO_NAME}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-[#1B2836] transition-colors"
            >
              <Github size={15} />
              <span>GitHub</span>
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/80 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                <Star size={11} className="fill-amber-400 text-amber-500" />
                <span>{starCount === null ? "..." : starCount.toLocaleString()}</span>
              </span>
            </a>
          </nav>

          <div className="flex items-center gap-3">
            <a
              href={CHROME_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden items-center gap-1.5 rounded-lg border border-[#D5DDE6] px-3.5 py-2 text-sm font-medium text-[#1B2836] hover:bg-[#F7F9FB] transition-colors sm:inline-flex"
            >
              <Chrome size={15} />
              <span>Extension</span>
            </a>
            <a
              href={currentDownloadLink}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0066C0] px-4 py-2 text-sm font-medium text-white hover:bg-[#00529B] transition-colors"
            >
              <Download size={15} />
              <span>Download</span>
            </a>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto max-w-6xl px-6 pb-20 pt-16 md:pt-24">
          <div className="max-w-3xl">
            <h1 className="font-display text-4xl font-bold tracking-tight text-[#1B2836] sm:text-5xl md:text-6xl leading-[1.06]">
              Pack codebases for LLMs and run coding agents inside Google Colab
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-relaxed text-[#526273]">
              Two local tools built around one workflow: a desktop app that compresses
              repositories using Tree-sitter AST skeletons, and a browser extension plus local
              bridge that lets Codex or Claude Code edit Colab notebooks live.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href={currentDownloadLink}
                className="inline-flex items-center gap-2 rounded-lg bg-[#0066C0] px-5 py-3 text-sm font-semibold text-white hover:bg-[#00529B] transition-colors"
              >
                <Download size={16} />
                <span>{downloadUrl ? `Download for ${osName}` : "Download Desktop"}</span>
              </a>
              <a
                href="#colab-agent"
                className="inline-flex items-center gap-2 rounded-lg border border-[#D5DDE6] bg-white px-5 py-3 text-sm font-semibold text-[#1B2836] hover:bg-[#F7F9FB] transition-colors"
              >
                <Terminal size={16} />
                <span>See Agent Terminal clips</span>
              </a>
              <a
                href={CHROME_STORE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-3 text-sm font-medium text-[#526273] hover:text-[#1B2836] transition-colors"
              >
                <span>Chrome Web Store</span>
                <ArrowUpRight size={15} />
              </a>
            </div>
          </div>

          {/* Interactive Real Footage Player */}
          <div className="mt-14">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex rounded-lg border border-[#E3E8EE] bg-[#F7F9FB] p-1">
                <button
                  type="button"
                  onClick={() => setHeroTab("colab-sync")}
                  className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    heroTab === "colab-sync"
                      ? "bg-white text-[#1B2836] shadow-sm"
                      : "text-[#526273] hover:text-[#1B2836]"
                  }`}
                >
                  Colab Live Sync Clip
                </button>
                <button
                  type="button"
                  onClick={() => setHeroTab("desktop")}
                  className={`rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    heroTab === "desktop"
                      ? "bg-white text-[#1B2836] shadow-sm"
                      : "text-[#526273] hover:text-[#1B2836]"
                  }`}
                >
                  Desktop AST Packer Clip
                </button>
                <button
                  type="button"
                  onClick={() => setHeroTab("colab-full")}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                    heroTab === "colab-full"
                      ? "bg-white text-[#1B2836] shadow-sm"
                      : "text-[#526273] hover:text-[#1B2836]"
                  }`}
                >
                  <Play size={12} />
                  Full 46s Codex Walkthrough
                </button>
              </div>

              <span className="font-mono text-xs text-[#6B7C8F]">
                {heroTab === "colab-full" && "Unedited 1.0x real-time capture • codex --no-alt-screen"}
                {heroTab === "colab-sync" && "Real Codex session syncing edits to colab.research.google.com"}
                {heroTab === "desktop" && "Real prompt-pack-lite.app scanning 78 files with Tree-sitter + tiktoken"}
              </span>
            </div>

            <div className="overflow-hidden rounded-xl border border-[#DCE3EB] bg-white shadow-lg">
              {heroTab === "colab-sync" && (
                <video
                  key="hero-sync"
                  src="/media/clip-live-sync.mp4"
                  poster="/media/colab-poster.jpg"
                  autoPlay
                  muted
                  loop
                  playsInline
                  controls
                  className="aspect-video w-full object-cover"
                />
              )}
              {heroTab === "desktop" && (
                <video
                  key="hero-desktop"
                  src="/media/clip-desktop-pack.mp4"
                  poster="/media/screenshots/desktop-workspace.png"
                  autoPlay
                  muted
                  loop
                  playsInline
                  controls
                  className="aspect-[2440/1520] w-full object-cover"
                />
              )}
              {heroTab === "colab-full" && (
                <video
                  key="hero-full"
                  ref={fullVideoRef}
                  src="/media/colab-showcase-full.mp4"
                  poster="/media/colab-poster.jpg"
                  controls
                  autoPlay
                  muted
                  playsInline
                  className="aspect-video w-full object-cover"
                />
              )}
            </div>

            {/* Chapter shortcuts for the full video */}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#526273]">
              <span className="font-medium text-[#1B2836]">Jump inside the full video:</span>
              <button
                type="button"
                onClick={() => jumpToFullTimestamp(1.5)}
                className="rounded border border-[#E3E8EE] bg-white px-2.5 py-1 font-mono hover:border-[#0066C0] hover:text-[#0066C0] transition-colors"
              >
                0:01 Open Agent Terminal
              </button>
              <button
                type="button"
                onClick={() => jumpToFullTimestamp(6.0)}
                className="rounded border border-[#E3E8EE] bg-white px-2.5 py-1 font-mono hover:border-[#0066C0] hover:text-[#0066C0] transition-colors"
              >
                0:06 Codex Reads AGENTS.md
              </button>
              <button
                type="button"
                onClick={() => jumpToFullTimestamp(14.0)}
                className="rounded border border-[#E3E8EE] bg-white px-2.5 py-1 font-mono hover:border-[#0066C0] hover:text-[#0066C0] transition-colors"
              >
                0:14 Cell 3 Fix + New Cells
              </button>
              <button
                type="button"
                onClick={() => jumpToFullTimestamp(36.0)}
                className="rounded border border-[#E3E8EE] bg-white px-2.5 py-1 font-mono hover:border-[#0066C0] hover:text-[#0066C0] transition-colors"
              >
                0:36 Before / After Diffs
              </button>
            </div>
          </div>
        </section>

        {/* Agent Terminal for Google Colab */}
        <section id="colab-agent" className="scroll-mt-20 border-t border-[#E3E8EE] bg-[#F7F9FB] py-20">
          <div className="mx-auto max-w-6xl px-6">
            <div className="grid gap-12 lg:grid-cols-12 lg:items-start">
              <div className="space-y-6 lg:col-span-5">
                <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#0066C0]">
                  Agent Terminal + Bridge
                </p>
                <h2 className="font-display text-3xl font-bold tracking-tight text-[#1B2836] sm:text-4xl">
                  Your CLI coding agent docked right next to Colab
                </h2>
                <p className="text-base leading-relaxed text-[#526273]">
                  Skip copying cells back and forth. PromptPack Bridge exports your open
                  notebook cells into a local workspace with{" "}
                  <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-[#1B2836] border border-[#E3E8EE]">
                    AGENTS.md
                  </code>{" "}
                  and launches Codex, Claude Code, or any custom CLI inside the Colab panel.
                </p>

                {/* Step switcher tied to real clips */}
                <div className="space-y-2.5 pt-2">
                  {[
                    {
                      id: "start" as const,
                      num: "01",
                      title: "Launch Codex inside the notebook sidebar",
                      desc: "Open PromptPack (Alt+Shift+P), pick Codex or Claude Code, and click Start session.",
                    },
                    {
                      id: "sync" as const,
                      num: "02",
                      title: "Watch saved file edits sync straight to Colab",
                      desc: "Agent edits to existing cells and new files in notebook/new_cells/ appear in Colab immediately.",
                    },
                    {
                      id: "diff" as const,
                      num: "03",
                      title: "Review Before / Agent edit diffs with conflict guards",
                      desc: "Every cell edit logs a Before/After diff. Concurrent browser edits pause cleanly under Needs attention.",
                    },
                  ].map((step) => {
                    const active = colabClip === step.id;
                    return (
                      <button
                        key={step.id}
                        type="button"
                        onClick={() => setColabClip(step.id)}
                        className={`w-full rounded-xl border p-4 text-left transition-all ${
                          active
                            ? "border-[#0066C0] bg-white shadow-sm"
                            : "border-[#E3E8EE] bg-white/60 hover:bg-white"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={`font-mono text-xs font-bold pt-0.5 ${
                              active ? "text-[#0066C0]" : "text-[#6B7C8F]"
                            }`}
                          >
                            {step.num}
                          </span>
                          <div>
                            <div className="text-sm font-semibold text-[#1B2836]">
                              {step.title}
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-[#526273]">
                              {step.desc}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap gap-3 pt-2">
                  {bridgeStatus.state === "available" ? (
                    <a
                      href={bridgeStatus.release!.html_url}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#0066C0] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#00529B] transition-colors"
                    >
                      <Download size={16} />
                      <span>
                        {bridgeStatus.release!.prerelease
                          ? "Download Bridge preview"
                          : "Download Bridge"}
                      </span>
                    </a>
                  ) : (
                    <a
                      href={COLAB_SETUP}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#0066C0] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#00529B] transition-colors"
                    >
                      <span>Bridge setup guide</span>
                    </a>
                  )}
                  <a
                    href={COLAB_PREVIEW}
                    className="inline-flex items-center gap-2 rounded-lg border border-[#D5DDE6] bg-white px-4 py-2.5 text-sm font-semibold text-[#1B2836] hover:bg-[#F7F9FB] transition-colors"
                  >
                    <Chrome size={16} />
                    <span>Extension preview zip</span>
                  </a>
                </div>

                <p role="status" className="text-xs leading-relaxed text-[#6B7C8F]">
                  {bridgeStatus.state === "loading" && "Checking Bridge release status…"}
                  {bridgeStatus.state === "unavailable" && (
                    <>
                      Bridge installers are not published yet. See the{" "}
                      <a className="underline text-[#1B2836]" href={COLAB_SETUP}>
                        setup guide
                      </a>
                      .
                    </>
                  )}
                  {bridgeStatus.state === "error" && (
                    <>
                      Check{" "}
                      <a className="underline text-[#1B2836]" href={BRIDGE_RELEASES}>
                        Bridge releases
                      </a>{" "}
                      on GitHub.
                    </>
                  )}
                  {bridgeStatus.state === "available" &&
                    "Bridge runs locally on 127.0.0.1:47123. In the demo recording above, Codex edits cells at 1.0x real time without running a Colab runtime (run requests work once a runtime is connected)."}
                </p>
              </div>

              <div className="space-y-4 lg:col-span-7">
                {/* Real clip stage for active step */}
                <div className="overflow-hidden rounded-xl border border-[#DCE3EB] bg-white shadow-md">
                  {colabClip === "start" && (
                    <video
                      key="colab-start"
                      src="/media/clip-codex-start.mp4"
                      autoPlay
                      muted
                      loop
                      playsInline
                      controls
                      className="aspect-video w-full object-cover"
                    />
                  )}
                  {colabClip === "sync" && (
                    <video
                      key="colab-sync"
                      src="/media/clip-live-sync.mp4"
                      autoPlay
                      muted
                      loop
                      playsInline
                      controls
                      className="aspect-video w-full object-cover"
                    />
                  )}
                  {colabClip === "diff" && (
                    <video
                      key="colab-diff"
                      src="/media/clip-diff-review.mp4"
                      autoPlay
                      muted
                      loop
                      playsInline
                      controls
                      className="aspect-video w-full object-cover"
                    />
                  )}
                </div>

                {/* Real still screenshots underneath */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <figure className="overflow-hidden rounded-xl border border-[#DCE3EB] bg-white">
                    <img
                      src="/media/screenshots/01-bridge-ready.png"
                      alt="PromptPack Bridge desktop companion showing Ready for Colab"
                      className="aspect-[16/10] w-full object-contain bg-white p-2 border-b border-[#E3E8EE]"
                    />
                    <figcaption className="px-3.5 py-2.5 text-xs text-[#526273]">
                      <span className="font-semibold text-[#1B2836]">PromptPack Bridge</span> — detects installed Codex & Claude Code CLIs locally
                    </figcaption>
                  </figure>
                  <figure className="overflow-hidden rounded-xl border border-[#DCE3EB] bg-white">
                    <img
                      src="/media/screenshots/colab-diff-panel.png"
                      alt="PromptPack Notebook changes panel with Before and Agent edit diff"
                      className="aspect-[16/10] w-full object-cover object-top bg-white border-b border-[#E3E8EE]"
                    />
                    <figcaption className="px-3.5 py-2.5 text-xs text-[#526273]">
                      <span className="font-semibold text-[#1B2836]">Notebook changes</span> — inline Before / Agent edit diff & sync status
                    </figcaption>
                  </figure>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* PromptPacker Desktop App */}
        <section id="desktop" className="scroll-mt-20 border-t border-[#E3E8EE] bg-white py-20">
          <div className="mx-auto max-w-6xl px-6">
            <div className="grid gap-12 lg:grid-cols-12 lg:items-center">
              <div className="space-y-6 lg:col-span-5">
                <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#0066C0]">
                  PromptPacker Desktop
                </p>
                <h2 className="font-display text-3xl font-bold tracking-tight text-[#1B2836] sm:text-4xl">
                  AST context compression built with Rust and Tree-sitter
                </h2>
                <p className="text-base leading-relaxed text-[#526273]">
                  Instead of pasting raw multi-hundred-line files into a chat box, mark key
                  files as <span className="font-semibold text-[#1B2836]">Full</span> and the
                  rest as <span className="font-semibold text-[#1B2836]">Skeleton</span>.
                  PromptPacker parses ASTs across TypeScript, Python, Rust, Go, and C to keep
                  types, signatures, and structure while folding bodies.
                </p>

                <ul className="space-y-3 text-sm text-[#1B2836]">
                  <li className="flex items-start gap-2.5">
                    <Check size={16} className="mt-0.5 shrink-0 text-[#0066C0]" />
                    <span>
                      Respects <code className="font-mono text-xs">.gitignore</code> and skips binaries & lockfiles automatically
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check size={16} className="mt-0.5 shrink-0 text-[#0066C0]" />
                    <span>
                      Live <code className="font-mono text-xs">tiktoken</code> token estimates update as you toggle files
                    </span>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Check size={16} className="mt-0.5 shrink-0 text-[#0066C0]" />
                    <span>
                      Built-in filesystem watcher plus Snapshot & Diff export for changed code
                    </span>
                  </li>
                </ul>

                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <a
                    href={currentDownloadLink}
                    className="inline-flex items-center gap-2 rounded-lg bg-[#0066C0] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#00529B] transition-colors"
                  >
                    <Download size={16} />
                    <span>Download Desktop for {osName}</span>
                  </a>
                </div>
              </div>

              <div className="space-y-3 lg:col-span-7">
                <div className="flex items-center gap-1.5">
                  {(
                    [
                      ["clip", "Live App Clip"],
                      ["workspace", "78-File Workspace"],
                      ["output", "Generated AST Prompt"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setDesktopView(id)}
                      className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        desktopView === id
                          ? "border-[#0066C0] bg-[#0066C0]/5 text-[#0066C0]"
                          : "border-[#E3E8EE] bg-white text-[#526273] hover:text-[#1B2836]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="overflow-hidden rounded-xl border border-[#DCE3EB] bg-white shadow-md">
                  {desktopView === "clip" && (
                    <video
                      key="desktop-clip"
                      src="/media/clip-desktop-pack.mp4"
                      poster="/media/screenshots/desktop-workspace.png"
                      autoPlay
                      muted
                      loop
                      playsInline
                      controls
                      className="aspect-[2440/1520] w-full object-cover"
                    />
                  )}
                  {desktopView === "workspace" && (
                    <img
                      src="/media/screenshots/desktop-workspace.png"
                      alt="prompt-pack-lite desktop workspace showing 78 files selected in Skeleton mode"
                      className="aspect-[2440/1520] w-full object-cover object-top bg-white"
                    />
                  )}
                  {desktopView === "output" && (
                    <img
                      src="/media/screenshots/desktop-output.png"
                      alt="prompt-pack-lite Prompt Generated modal ready to copy"
                      className="aspect-[2440/1520] w-full object-cover object-top bg-white"
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Architecture & Local Guarantees */}
        <section id="architecture" className="scroll-mt-20 border-t border-[#E3E8EE] bg-[#F7F9FB] py-20">
          <div className="mx-auto max-w-6xl px-6">
            <div className="max-w-2xl">
              <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[#0066C0]">
                Architecture
              </p>
              <h2 className="mt-2 font-display text-3xl font-bold tracking-tight text-[#1B2836]">
                Local tools under your own accounts
              </h2>
            </div>

            <div className="mt-10 grid overflow-hidden rounded-xl border border-[#DCE3EB] bg-white md:grid-cols-3 md:divide-x md:divide-[#E3E8EE]">
              <div className="p-7">
                <h3 className="text-base font-semibold text-[#1B2836]">
                  Strict loopback binding
                </h3>
                <p className="mt-2.5 text-sm leading-relaxed text-[#526273]">
                  PromptPack Bridge binds strictly to{" "}
                  <code className="font-mono text-xs text-[#1B2836]">127.0.0.1:47123</code> and
                  rejects ordinary browser origins—only Chrome extension pages and local
                  clients can connect.
                </p>
              </div>
              <div className="border-t border-[#E3E8EE] p-7 md:border-t-0">
                <h3 className="text-base font-semibold text-[#1B2836]">
                  Persistent cell mapping
                </h3>
                <p className="mt-2.5 text-sm leading-relaxed text-[#526273]">
                  Existing notebook cells sync cleanly to local{" "}
                  <code className="font-mono text-xs text-[#1B2836]">.py</code> and{" "}
                  <code className="font-mono text-xs text-[#1B2836]">.md</code> files, while
                  new files in{" "}
                  <code className="font-mono text-xs text-[#1B2836]">notebook/new_cells/</code>{" "}
                  append with stable Colab cell IDs.
                </p>
              </div>
              <div className="border-t border-[#E3E8EE] p-7 md:border-t-0">
                <h3 className="text-base font-semibold text-[#1B2836]">
                  Zero cloud middleman
                </h3>
                <p className="mt-2.5 text-sm leading-relaxed text-[#526273]">
                  No PromptPack servers sit between you and your LLM. Desktop scanning uses
                  local Tauri + Rust; Agent Terminal runs your local Codex or Claude CLI with
                  your own credentials and approvals.
                </p>
              </div>
            </div>

            {/* Final CTA Band */}
            <div className="mt-14 flex flex-col items-start justify-between gap-6 rounded-xl border border-[#DCE3EB] bg-white p-8 sm:flex-row sm:items-center">
              <div className="flex items-center gap-4">
                <img
                  src="/logo-mark.png"
                  alt="PromptPacker mark"
                  className="h-12 w-12 shrink-0 object-contain"
                />
                <div>
                  <h3 className="font-display text-xl font-bold text-[#1B2836]">
                    Start packing codebases or launch Codex in Colab
                  </h3>
                  <p className="mt-1 text-sm text-[#526273]">
                    Open source under Apache-2.0 for macOS, Windows, Linux, and Chrome.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <a
                  href={currentDownloadLink}
                  className="inline-flex items-center gap-2 rounded-lg bg-[#0066C0] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#00529B] transition-colors"
                >
                  <Download size={16} />
                  <span>Download Desktop</span>
                </a>
                <a
                  href={`https://github.com/${REPO_OWNER}/${REPO_NAME}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-[#D5DDE6] bg-white px-5 py-2.5 text-sm font-semibold text-[#1B2836] hover:bg-[#F7F9FB] transition-colors"
                >
                  <Github size={16} />
                  <span>View source</span>
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[#E3E8EE] bg-white py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
          <div className="flex items-center gap-2.5">
            <img src="/logo-mark.png" alt="PromptPacker mark" className="h-6 w-6 object-contain" />
            <span className="font-display text-sm font-semibold text-[#1B2836]">PromptPacker</span>
            <span className="text-xs text-[#6B7C8F]">Apache-2.0</span>
          </div>
          <div className="flex items-center gap-6 text-sm text-[#526273]">
            <a href="/privacy.html" className="hover:text-[#1B2836] transition-colors">
              Privacy
            </a>
            <a href={BRIDGE_RELEASES} target="_blank" rel="noopener noreferrer" className="hover:text-[#1B2836] transition-colors">
              Bridge Releases
            </a>
            <a
              href={`https://github.com/${REPO_OWNER}/${REPO_NAME}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[#1B2836] transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
