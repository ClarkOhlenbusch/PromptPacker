import { useState, useEffect } from "react";
import {
   Download,
   FileCode,
   Cpu,
   ShieldCheck,
   ChevronRight,
   Zap,
   Layers,
   CheckCircle2,
   Github,
   Star,
   Chrome,
   Terminal,
   ArrowRight,
   NotebookPen
} from "lucide-react";
import { motion } from "framer-motion";
import type { Variants } from "framer-motion";

const REPO_OWNER = "ClarkOhlenbusch";
const REPO_NAME = "PromptPacker";
const BRIDGE_RELEASES = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases?q=bridge-v&expanded=true`;
const COLAB_SETUP = `https://github.com/${REPO_OWNER}/${REPO_NAME}#agent-terminal-for-google-colab`;
const COLAB_PREVIEW = `https://github.com/${REPO_OWNER}/${REPO_NAME}/raw/refs/heads/main/PromptPackerColab-chrome.zip`;
type BridgeRelease = { tag_name: string; draft: boolean; prerelease: boolean; html_url: string; assets: { name: string; browser_download_url: string }[] };
type BridgeStatus = { state: "loading" | "available" | "unavailable" | "error"; release?: BridgeRelease };

export default function App() {
   const [scrolled, setScrolled] = useState(false);
   const [latestVersion, setLatestVersion] = useState<string | null>(null);
   const [downloadUrl, setDownloadUrl] = useState("");
   const [osName] = useState(() => {
      const userAgent = window.navigator.userAgent;
      if (userAgent.includes("Win")) return "Windows";
      if (userAgent.includes("Linux") && !userAgent.includes("Android")) return "Linux";
      return "Mac";
   });
   const [starCount, setStarCount] = useState<number | null>(null);
   const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus>({ state: "loading" });

   useEffect(() => {
      const handleScroll = () => setScrolled(window.scrollY > 20);
      window.addEventListener("scroll", handleScroll);

      fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`)
         .then(res => res.json())
         .then(data => {
            if (data.tag_name) {
               setLatestVersion(data.tag_name);
               let asset = null;
               if (data.assets && data.assets.length > 0) {
                  if (osName === "Windows") {
                     asset = data.assets.find((a: { name: string; browser_download_url: string }) => a.name.endsWith(".exe"));
                  } else if (osName === "Linux") {
                     asset = data.assets.find((a: { name: string; browser_download_url: string }) => a.name.endsWith(".AppImage"));
                  } else {
                     asset = data.assets.find((a: { name: string; browser_download_url: string }) => a.name.includes("aarch64") && a.name.endsWith(".dmg"))
                        || data.assets.find((a: { name: string; browser_download_url: string }) => a.name.endsWith(".dmg"));
                  }
               }
               if (asset) setDownloadUrl(asset.browser_download_url);
            }
         })
         .catch(err => console.error("Failed to fetch latest version", err));

      fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=100`)
         .then(res => {
            if (!res.ok) throw new Error("Unable to check Bridge releases");
            return res.json() as Promise<BridgeRelease[]>;
         })
         .then(releases => {
            const release = releases.find(item => item.tag_name.startsWith("bridge-v") && !item.draft && !item.prerelease && item.assets?.some(asset => /\.(dmg|exe|AppImage|deb)$/i.test(asset.name)));
            setBridgeStatus(release ? { state: "available", release } : { state: "unavailable" });
         })
         .catch(() => setBridgeStatus({ state: "error" }));

      const fetchStarCount = () => {
         fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`)
            .then(res => res.json())
            .then(data => {
               if (typeof data.stargazers_count === "number") {
                  setStarCount(data.stargazers_count);
               }
            })
            .catch(err => console.error("Failed to fetch GitHub stars", err));
      };

      fetchStarCount();
      const starInterval = window.setInterval(fetchStarCount, 5 * 60 * 1000);

      return () => {
         window.removeEventListener("scroll", handleScroll);
         window.clearInterval(starInterval);
      };
   }, [osName]);

   const currentDownloadLink = downloadUrl || `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases`;
   const formattedStars = starCount === null ? "..." : starCount.toLocaleString();

   const containerVariants: Variants = {
      hidden: { opacity: 0 },
      visible: {
         opacity: 1,
         transition: {
            staggerChildren: 0.1
         }
      }
   };

   const itemVariants: Variants = {
      hidden: { y: 20, opacity: 0 },
      visible: {
         y: 0,
         opacity: 1,
         transition: {
            duration: 0.8,
            ease: [0.16, 1, 0.3, 1]
         }
      }
   };

   return (
      <div className="min-h-screen bg-white text-[#2A3947] font-sans selection:bg-[#0069C3]/10 selection:text-[#0069C3] overflow-x-hidden">

         {/* Tech Background Grid */}
         <div className="fixed inset-0 pointer-events-none z-0">
            <div className="absolute inset-0 tech-grid opacity-40" />
            <div className="absolute top-[-10%] right-[-10%] w-[500px] h-[500px] bg-[#0069C3]/5 blur-[120px] rounded-full" />
            <div className="absolute bottom-[-10%] left-[-10%] w-[400px] h-[400px] bg-[#0069C3]/5 blur-[100px] rounded-full" />
         </div>

         {/* Navbar */}
         <nav className={`fixed top-0 w-full z-50 transition-all duration-300 ${scrolled ? 'glass py-3' : 'bg-transparent py-6'}`}>
            <div className="max-w-7xl mx-auto px-6 flex items-center justify-between">
               <motion.div
                  initial={{ x: -20, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  className="flex items-center gap-3"
               >
                  <img src="/logo.png" alt="Logo" className="h-9 w-auto rounded shadow-sm" />
                  <span className="font-display font-bold text-xl tracking-tight text-[#2A3947]">
                     Prompt<span className="text-[#0069C3]">Packer</span>
                  </span>
               </motion.div>
               <div className="flex items-center gap-8">
                  <a href="#colab-agent" className="hidden md:block text-sm font-medium text-slate-500 hover:text-[#0069C3] transition-colors">Colab Agent</a>
                  <a href="#features" className="hidden md:block text-sm font-medium text-slate-500 hover:text-[#0069C3] transition-colors">Features</a>
                  <a href="https://github.com/ClarkOhlenbusch/PromptPacker" target="_blank" rel="noopener noreferrer" className="hidden md:flex text-sm font-medium text-slate-500 hover:text-[#0069C3] transition-colors items-center gap-1">
                     <Github size={16} /> GitHub
                     <span className="ml-1 inline-flex items-center gap-1 rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                        <Star size={12} className="text-amber-500" />
                        {formattedStars}
                     </span>
                  </a>
                  <a href="https://chromewebstore.google.com/detail/piniclchmidgfainpldphnocipgilmll?utm_source=item-share-cb" target="_blank" rel="noopener noreferrer" className="hidden lg:flex text-sm font-medium text-slate-500 hover:text-[#0069C3] transition-colors items-center gap-1">
                     <Chrome size={16} /> Extension
                  </a>
                  <motion.a
                     whileHover={{ scale: 1.05 }}
                     whileTap={{ scale: 0.95 }}
                     href={currentDownloadLink}
                     className="px-5 py-2 bg-[#0069C3] text-white text-sm font-bold rounded-lg transition-all flex items-center gap-2 shadow-lg shadow-blue-500/20"
                  >
                     <Download size={16} /> <span className="hidden sm:inline">Download</span>
                  </motion.a>
               </div>
            </div>
         </nav>

         {/* Hero Section */}
         <motion.header
            variants={containerVariants}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="relative pt-48 pb-32 px-6 z-10"
         >
            <div className="max-w-5xl mx-auto text-center space-y-8">
               <motion.div variants={itemVariants} className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-[#0069C3] text-xs font-mono font-medium tracking-wide">
                  <span className="relative flex h-2 w-2">
                     <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                     <span className="relative inline-flex rounded-full h-2 w-2 bg-[#0069C3]"></span>
                  </span>
                  {latestVersion ? `DESKTOP ${latestVersion.toUpperCase()}` : 'DESKTOP AND COLAB TOOLS'}
               </motion.div>

               <motion.h1 variants={itemVariants} className="font-display text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight leading-[0.95] text-[#2A3947]">
                  Stop pasting code. <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#0069C3] to-cyan-600">
                     Start Packing.
                  </span>
               </motion.h1>

               <motion.p variants={itemVariants} className="text-lg md:text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed font-light">
                  Turn your project into useful AI context, or work with a coding agent directly inside Google Colab.
               </motion.p>

               <motion.div variants={itemVariants} className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-8">
                  <a
                     href={currentDownloadLink}
                     className="px-10 py-5 bg-[#2A3947] text-white rounded-xl font-bold text-lg shadow-2xl shadow-slate-900/20 hover:bg-[#1e293b] transition-all flex items-center gap-3 w-full sm:w-auto justify-center group"
                  >
                     <Download size={24} />
                     <span>{downloadUrl ? `Download Desktop for ${osName}` : "Desktop downloads"}</span>
                     <ChevronRight size={20} className="opacity-50 group-hover:translate-x-1 transition-transform" />
                  </a>
                  <a
                     href="https://chromewebstore.google.com/detail/piniclchmidgfainpldphnocipgilmll?utm_source=item-share-cb"
                     target="_blank"
                     rel="noopener noreferrer"
                     className="px-10 py-5 bg-white text-[#2A3947] border border-slate-200 rounded-xl font-bold text-lg shadow-xl hover:bg-slate-50 transition-all flex items-center gap-3 w-full sm:w-auto justify-center group"
                  >
                     <Chrome size={24} className="text-[#0069C3]" />
                     <span>Chrome Extension</span>
                     <ChevronRight size={20} className="opacity-50 group-hover:translate-x-1 transition-transform text-slate-300" />
                  </a>
               </motion.div>

               <motion.a variants={itemVariants} href="#colab-agent" className="inline-flex items-center gap-2 text-[#0069C3] font-semibold hover:underline">
                  Explore Agent Terminal for Colab <ArrowRight size={17} />
               </motion.a>
               <motion.div variants={itemVariants} className="pt-12">
                  <div className="relative mx-auto max-w-5xl bg-white rounded-xl overflow-hidden border border-slate-200 shadow-[0_20px_50px_-12px_rgba(0,0,0,0.1)]">
                     {/* Window Header */}
                     <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
                        <div className="flex gap-2">
                           <div className="w-3 h-3 rounded-full bg-slate-200 border border-slate-300"></div>
                           <div className="w-3 h-3 rounded-full bg-slate-200 border border-slate-300"></div>
                           <div className="w-3 h-3 rounded-full bg-slate-200 border border-slate-300"></div>
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">PromptPacker — Desktop</div>
                        <div className="w-12"></div>
                     </div>

                     <div className="flex h-[400px]">
                        {/* Sidebar Mockup */}
                        <div className="w-64 border-r border-slate-100 bg-white p-4 space-y-4 hidden md:block">
                           <div className="flex items-center justify-between">
                              <div className="text-[10px] font-bold text-slate-400 uppercase">Files</div>
                              <div className="w-4 h-4 rounded bg-slate-100"></div>
                           </div>
                           <div className="space-y-2">
                              {[1, 2, 3, 4, 5, 6].map(i => (
                                 <div key={i} className="flex items-center gap-2">
                                    <div className={`w-3 h-3 rounded ${i === 2 ? 'bg-blue-100' : 'bg-slate-100'}`}></div>
                                    <div className={`h-2 rounded ${i === 2 ? 'bg-blue-100 w-24' : 'bg-slate-100 w-32'}`}></div>
                                 </div>
                              ))}
                           </div>
                        </div>

                        {/* Main Content Mockup */}
                        <div className="flex-1 p-8 text-left space-y-6 bg-white">
                           <div className="space-y-3">
                              <div className="h-3 w-32 bg-slate-100 rounded"></div>
                              <div className="h-24 w-full bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
                                 <div className="h-2 w-3/4 bg-slate-100 rounded"></div>
                                 <div className="h-2 w-1/2 bg-slate-100 rounded mt-2"></div>
                              </div>
                           </div>
                           <div className="space-y-3">
                              <div className="h-3 w-24 bg-slate-100 rounded"></div>
                              <div className="h-16 w-full bg-white border border-slate-200 rounded-lg shadow-sm"></div>
                           </div>
                           <div className="pt-4 flex justify-end">
                              <div className="px-6 py-3 bg-[#0069C3] rounded-lg text-white text-xs font-bold font-display shadow-lg shadow-blue-500/20">
                                 GENERATE PROMPT
                              </div>
                           </div>
                        </div>
                     </div>
                  </div>
               </motion.div>
            </div>
         </motion.header>

         <section id="colab-agent" className="relative z-10 scroll-mt-24 border-y border-blue-100 bg-[#f4f9fd] px-6 py-24 md:py-32">
            <div className="mx-auto grid max-w-7xl gap-14 lg:grid-cols-2 lg:items-center">
               <div className="space-y-7">
                  <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-4 py-2 text-xs font-bold uppercase tracking-widest text-[#0069C3]">
                     <Terminal size={15} /> Agent Terminal for Colab
                  </div>
                  <h2 className="font-display text-4xl font-bold tracking-tight text-[#2A3947] md:text-5xl">Your coding agent, right in your notebook.</h2>
                  <p className="text-lg leading-relaxed text-slate-600">Use Codex, Claude Code, or another installed command-line agent from PromptPack. Ask it to edit, add, move, or delete cells, and see changes sync into your open notebook.</p>
                  <div className="grid gap-4 sm:grid-cols-3">
                     {[
                        ["1", "Get the extension", "Install the current development build for Agent Terminal."],
                        ["2", "Open Bridge", "Run the companion app on your computer."],
                        ["3", "Start your agent", "Open Colab, choose Agent Terminal, and start a session."],
                     ].map(([number, title, detail]) => (
                        <div key={number} className="rounded-xl border border-blue-100 bg-white p-4">
                           <span className="font-mono text-xs font-bold text-[#0069C3]">{number.padStart(2, "0")}</span>
                           <h3 className="mt-2 font-bold text-[#2A3947]">{title}</h3>
                           <p className="mt-1 text-sm leading-relaxed text-slate-500">{detail}</p>
                        </div>
                     ))}
                  </div>
                  <div className="flex flex-wrap gap-3">
                     {bridgeStatus.state === "available" ? (
                        <a href={bridgeStatus.release!.html_url} className="inline-flex items-center gap-2 rounded-xl bg-[#0069C3] px-6 py-3 font-bold text-white hover:bg-blue-700"><Download size={18} /> Download Bridge</a>
                     ) : (
                        <a href={COLAB_SETUP} className="inline-flex items-center gap-2 rounded-xl bg-[#0069C3] px-6 py-3 font-bold text-white hover:bg-blue-700">Bridge setup guide <ArrowRight size={18} /></a>
                     )}
                     <a href={COLAB_PREVIEW} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-6 py-3 font-bold text-[#2A3947] hover:bg-slate-50"><Chrome size={18} /> Download extension preview</a>
                  </div>
                  <p role="status" className="text-sm leading-relaxed text-slate-500">
                     {bridgeStatus.state === "loading" && "Checking Bridge downloads…"}
                     {bridgeStatus.state === "unavailable" && <>Bridge installers are not published yet. See the <a className="underline" href={COLAB_SETUP}>setup guide</a> for the current preview.</>}
                     {bridgeStatus.state === "error" && <>We couldn’t check Bridge downloads. See <a className="underline" href={BRIDGE_RELEASES}>Bridge releases</a> and the <a className="underline" href={COLAB_SETUP}>setup guide</a>.</>}
                     {bridgeStatus.state === "available" && <>Choose your operating system on the release page. Bridge runs locally; your coding agent is installed and signed in separately.</>}
                  </p>
               </div>
               <div className="overflow-hidden rounded-2xl border border-slate-700 bg-[#182635] shadow-2xl shadow-slate-900/20">
                  <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4 text-sm font-semibold text-slate-200"><NotebookPen size={17} className="text-sky-300" /> Colab <span className="text-slate-500">/</span> Agent Terminal</div>
                  <div className="space-y-5 p-6 font-mono text-sm leading-relaxed md:p-8">
                     <p className="text-slate-300"><span className="text-sky-300">You</span> &nbsp;Add a plot of the model predictions after the evaluation cell.</p>
                     <p className="text-slate-300"><span className="text-emerald-300">Agent</span> &nbsp;I’ll add a code cell after evaluation and label the axes.</p>
                     <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-xs text-slate-400">Saved changes sync to your open notebook.<br />Your agent’s normal approvals still apply.</div>
                  </div>
               </div>
            </div>
         </section>

         {/* SOTA Compression Feature Section */}
         <section className="py-32 px-6 relative z-10 border-t border-slate-100 bg-slate-50/50">
            <div className="max-w-7xl mx-auto">
               <div className="grid lg:grid-cols-2 gap-16 items-center">
                  <div className="space-y-8 text-left">
                     <h2 className="font-display text-4xl font-bold tracking-tight text-[#2A3947]">
                        Signal over Noise. <br />
                        <span className="text-[#0069C3]">AST-Based Compression.</span>
                     </h2>
                     <p className="text-lg text-slate-500 leading-relaxed">
                        Traditional tools blindly concatenate files. PromptPacker parses the Abstract Syntax Tree (AST) of your code to understand its structure. It keeps signatures, types, and interfaces while folding implementation details.
                     </p>

                     <div className="grid sm:grid-cols-2 gap-6 pt-4">
                        <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-sm">
                           <div className="w-10 h-10 rounded bg-blue-50 flex items-center justify-center mb-3">
                              <Layers size={20} className="text-[#0069C3]" />
                           </div>
                           <h4 className="font-bold text-[#2A3947] mb-1">Structural Integrity</h4>
                           <p className="text-sm text-slate-500">Preserves class hierarchies and function signatures.</p>
                        </div>
                        <div className="p-4 rounded-lg bg-white border border-slate-200 shadow-sm">
                           <div className="w-10 h-10 rounded bg-cyan-50 flex items-center justify-center mb-3">
                              <Zap size={20} className="text-cyan-600" />
                           </div>
                           <h4 className="font-bold text-[#2A3947] mb-1">Token Efficiency</h4>
                           <p className="text-sm text-slate-500">Reduces context usage by up to 80% without losing meaning.</p>
                        </div>
                     </div>
                  </div>

                  <div className="relative">
                     <div className="absolute -inset-1 bg-gradient-to-r from-[#0069C3] to-cyan-500 rounded-2xl blur opacity-10"></div>
                     <div className="relative bg-white rounded-xl overflow-hidden border border-slate-200 shadow-2xl">
                        {/* App Output Header */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-white">
                           <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                                 <CheckCircle2 size={18} className="text-[#0069C3]" />
                              </div>
                              <div className="text-left">
                                 <div className="text-sm font-bold text-[#2A3947]">Prompt Generated</div>
                                 <div className="text-[10px] text-slate-500 uppercase font-mono">12,450 Tokens • 42 Files</div>
                              </div>
                           </div>
                        </div>

                        {/* App Output Content */}
                        <div className="p-6 bg-slate-50 font-mono text-[11px] text-slate-500 text-left h-[260px] overflow-hidden">
                           <div className="space-y-4">
                              <div className="text-[#0069C3]">--- PROMPT PREAMBLE ---</div>
                              <div>This project is a React/Rust application using Tauri v2...</div>
                              <div className="text-[#0069C3] pt-2">--- FILE TREE ---</div>
                              <div className="space-y-1 opacity-70">
                                 <div>src/</div>
                                 <div>  main.rs</div>
                                 <div>  skeleton.rs</div>
                              </div>
                              <div className="text-[#0069C3] pt-2">--- FILE: src/skeleton.rs (SKELETON) ---</div>
                              <div className="bg-white p-2 rounded border border-slate-200">
                                 <div className="text-pink-600 font-bold">pub fn</div> <span className="text-[#0069C3]">skeletonize</span>(code: &str) {"{ /* ... */ }"}
                              </div>
                           </div>
                        </div>

                        {/* App Output Footer */}
                        <div className="p-4 bg-white border-t border-slate-100 flex justify-end">
                           <div className="px-4 py-2 bg-[#0069C3] text-white rounded text-[11px] font-bold shadow-sm">
                              COPY TO CLIPBOARD
                           </div>
                        </div>
                     </div>
                  </div>
               </div>
            </div>
         </section>

         {/* Features Grid */}
         <section id="features" className="py-32 px-6">
            <div className="max-w-7xl mx-auto">
               <div className="text-center mb-20 space-y-4">
                  <h2 className="font-display text-4xl md:text-5xl font-bold text-[#2A3947] text-glow">Engineered for Flow.</h2>
                  <p className="text-slate-500 text-lg">Local-first, privacy-focused, and blazing fast.</p>
               </div>
               <div className="grid md:grid-cols-3 gap-6">
                  <Feature
                     icon={<Zap className="text-[#0069C3]" size={24} />}
                     title="Real-time Watcher"
                     desc="Background service watches your filesystem. Changes are reflected in the UI instantly. No manual re-scanning."
                     delay={0.1}
                  />
                  <Feature
                     icon={<FileCode className="text-cyan-600" size={24} />}
                     title="Smart Ignore"
                     desc="Respects .gitignore out of the box. Automatically filters lockfiles and binaries."
                     delay={0.2}
                  />
                  <Feature
                     icon={<Cpu className="text-[#2A3947]" size={24} />}
                     title="Rust Native"
                     desc="Built on Tauri v2 and Rust for a tiny memory footprint and millisecond performance."
                     delay={0.3}
                  />
               </div>
            </div>
         </section>

         {/* Privacy Section */}
         <section className="py-24 px-6 relative overflow-hidden">
            <div className="max-w-4xl mx-auto tech-card rounded-[32px] p-12 md:p-20 text-center relative overflow-hidden bg-slate-50/50">
               <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#0069C3]/30 to-transparent" />
               <div className="space-y-8 relative z-10">
                  <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-green-50 border border-green-100 text-green-700 text-xs font-bold uppercase tracking-widest">
                     <ShieldCheck size={14} /> Local First
                  </div>
                  <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight text-[#2A3947]">Local tools, connected to your workflow.</h2>
                  <p className="text-lg text-slate-500 leading-relaxed max-w-2xl mx-auto">
                     PromptPack Bridge runs on your computer and connects to the Colab page in your browser. Your chosen coding agent and Google Colab may send data to their own services under their respective settings.
                  </p>
               </div>
            </div>
         </section>

         <footer className="py-12 border-t border-slate-100 bg-white">
            <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-8">
               <div className="flex items-center gap-3">
                  <img src="/logo.png" alt="Logo" className="h-6 w-auto opacity-60" />
                  <span className="font-bold text-lg tracking-tight text-[#2A3947]">PromptPacker</span>
               </div>
               <p className="text-sm text-slate-400">© 2025 PromptPacker. Build with Rust.</p>
               <div className="flex items-center gap-6">
                  <a href="https://github.com/ClarkOhlenbusch/PromptPacker" target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-[#0069C3] transition-colors flex items-center gap-1">
                     <Github size={16} /> GitHub
                  </a>
               </div>
            </div>
         </footer>
      </div>
   );
}

function Feature({ icon, title, desc, delay }: { icon: React.ReactNode, title: string, desc: string, delay: number }) {
   return (
      <motion.div
         initial={{ y: 20, opacity: 0 }}
         whileInView={{ y: 0, opacity: 1 }}
         transition={{ delay, duration: 0.6 }}
         viewport={{ once: true }}
         className="bg-white border border-slate-100 p-8 rounded-2xl shadow-sm hover:shadow-md hover:border-[#0069C3]/20 transition-all duration-300 group text-left"
      >
         <div className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center border border-slate-100 mb-6 group-hover:scale-110 transition-transform duration-300 group-hover:bg-blue-50">
            {icon}
         </div>
         <h3 className="text-xl font-bold text-[#2A3947] mb-3 group-hover:text-[#0069C3] transition-colors">{title}</h3>
         <p className="text-slate-500 leading-relaxed text-sm">
            {desc}
         </p>
      </motion.div>
   )
}
