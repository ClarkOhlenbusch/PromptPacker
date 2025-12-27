import { useState, useEffect } from "react";
import {
   Download,
   FileCode,
   Cpu,
   ShieldCheck,
   ChevronRight,
   Zap,
   Layers,
   CheckCircle2
} from "lucide-react";
import { motion } from "framer-motion";
import type { Variants } from "framer-motion";

// Fallback if API fails
const FALLBACK_VERSION = "v0.1.0";
const REPO_OWNER = "ClarkOhlenbusch";
const REPO_NAME = "PromptPacker-Releases";

export default function App() {
   const [scrolled, setScrolled] = useState(false);
   const [latestVersion, setLatestVersion] = useState(FALLBACK_VERSION);
   const [downloadUrl, setDownloadUrl] = useState("");
   const [osName, setOsName] = useState("Mac");

   useEffect(() => {
      const handleScroll = () => setScrolled(window.scrollY > 20);
      window.addEventListener("scroll", handleScroll);

      let detectedOS = "Mac";
      const userAgent = window.navigator.userAgent;
      if (userAgent.indexOf("Win") !== -1) detectedOS = "Windows";
      else if (userAgent.indexOf("Linux") !== -1 && userAgent.indexOf("Android") === -1) detectedOS = "Linux";
      setOsName(detectedOS);

      fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`)
         .then(res => res.json())
         .then(data => {
            if (data.tag_name) {
               setLatestVersion(data.tag_name);
               let asset = null;
               if (data.assets && data.assets.length > 0) {
                  if (detectedOS === "Windows") {
                     asset = data.assets.find((a: any) => a.name.endsWith(".exe"));
                  } else if (detectedOS === "Linux") {
                     asset = data.assets.find((a: any) => a.name.endsWith(".AppImage"));
                  } else {
                     asset = data.assets.find((a: any) => a.name.includes("aarch64") && a.name.endsWith(".dmg"))
                        || data.assets.find((a: any) => a.name.endsWith(".dmg"));
                  }
               }
               if (asset) setDownloadUrl(asset.browser_download_url);
            }
         })
         .catch(err => console.error("Failed to fetch latest version", err));

      return () => window.removeEventListener("scroll", handleScroll);
   }, []);

   const getFallbackUrl = () => {
      if (osName === "Windows") return `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${latestVersion}/prompt-pack-lite_${latestVersion}_x64-setup.exe`;
      if (osName === "Linux") return `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${latestVersion}/prompt-pack-lite_${latestVersion}_amd64.AppImage`;
      return `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${latestVersion}/prompt-pack-lite_${latestVersion}_aarch64.dmg`;
   };

   const currentDownloadLink = downloadUrl || getFallbackUrl();

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
                  <a href="#features" className="hidden md:block text-sm font-medium text-slate-500 hover:text-[#0069C3] transition-colors">Features</a>
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
                  V{latestVersion.replace('v', '')} NOW AVAILABLE
               </motion.div>

               <motion.h1 variants={itemVariants} className="font-display text-5xl md:text-7xl lg:text-8xl font-bold tracking-tight leading-[0.95] text-[#2A3947]">
                  Stop pasting code. <br />
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#0069C3] to-cyan-600">
                     Start Packing.
                  </span>
               </motion.h1>

               <motion.p variants={itemVariants} className="text-lg md:text-xl text-slate-500 max-w-2xl mx-auto leading-relaxed font-light">
                  The essential tool for "Context Engineering." Automatically clean, filter, and format your codebase into the perfect prompt for LLMs.
               </motion.p>

               <motion.div variants={itemVariants} className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-8">
                  <a
                     href={currentDownloadLink}
                     className="px-10 py-5 bg-[#2A3947] text-white rounded-xl font-bold text-lg shadow-2xl shadow-slate-900/20 hover:bg-[#1e293b] transition-all flex items-center gap-3 w-full sm:w-auto justify-center group"
                  >
                     <Download size={24} />
                     <span>Download for {osName}</span>
                     <ChevronRight size={20} className="opacity-50 group-hover:translate-x-1 transition-transform" />
                  </a>
               </motion.div>
               
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
                  <h2 className="font-display text-4xl md:text-5xl font-bold tracking-tight text-[#2A3947]">Your code never leaves localhost.</h2>
                  <p className="text-lg text-slate-500 leading-relaxed max-w-2xl mx-auto">
                     PromptPacker is closed-source for quality control, but remains a local-first application. We don't have servers. We don't track usage. Everything happens entirely on your machine.
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
                  <a href="#" className="text-slate-400 hover:text-[#0069C3] transition-colors">Docs</a>
                  <a href="#" className="text-slate-400 hover:text-[#0069C3] transition-colors">Terms</a>
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