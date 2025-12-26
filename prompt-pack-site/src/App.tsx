import { useState, useEffect } from "react";
import { Download, Terminal, FileCode, Zap, Monitor, CheckCircle2 } from "lucide-react";

// Fallback if API fails
const FALLBACK_VERSION = "v0.1.0";
const REPO_OWNER = "ClarkOhlenbusch";
const REPO_NAME = "PromptPacker-Releases"; // The public bridge repo

export default function App() {
  const [scrolled, setScrolled] = useState(false);
  const [latestVersion, setLatestVersion] = useState(FALLBACK_VERSION);
  const [downloadUrl, setDownloadUrl] = useState("");
  const [osName, setOsName] = useState("Mac"); // Default to Mac if detection fails

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);

    // 1. Detect OS
    let detectedOS = "Mac";
    const userAgent = window.navigator.userAgent;
    if (userAgent.indexOf("Win") !== -1) detectedOS = "Windows";
    else if (userAgent.indexOf("Linux") !== -1 && userAgent.indexOf("Android") === -1) detectedOS = "Linux";
    setOsName(detectedOS);
    
    // 2. Fetch latest release from the public bridge repo
    fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`)
       .then(res => res.json())
       .then(data => {
          if (data.tag_name) {
             setLatestVersion(data.tag_name);
             
             // 3. Find asset based on OS
             let asset = null;
             if (data.assets && data.assets.length > 0) {
                if (detectedOS === "Windows") {
                   asset = data.assets.find((a: any) => a.name.endsWith(".exe"));
                } else if (detectedOS === "Linux") {
                   asset = data.assets.find((a: any) => a.name.endsWith(".AppImage")); // Prefer AppImage
                } else {
                   // MacOS - Default to aarch64 (Apple Silicon) if available, or just the first .dmg
                   asset = data.assets.find((a: any) => a.name.includes("aarch64") && a.name.endsWith(".dmg")) 
                           || data.assets.find((a: any) => a.name.endsWith(".dmg"));
                }
             }

             if (asset) {
                setDownloadUrl(asset.browser_download_url);
             }
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

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white font-sans selection:bg-packer-blue selection:text-white">
      
      {/* Navbar */}
      <nav className={`fixed top-0 w-full z-50 transition-all duration-300 ${scrolled ? 'bg-white/90 backdrop-blur-md shadow-sm border-b border-slate-100 py-3' : 'bg-transparent py-6'}`}>
        <div className="max-w-6xl mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="Logo" className="h-9 w-auto rounded-lg shadow-sm" />
            <span className="font-extrabold text-xl tracking-tight">
               <span className="text-black">Prompt</span>
               <span className="text-packer-blue">Packer</span>
            </span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#features" className="text-sm font-medium text-packer-text-muted hover:text-packer-blue transition-colors">Features</a>
            <a 
              href={currentDownloadLink}
              className="px-5 py-2 bg-packer-blue hover:bg-[#005a9e] text-white text-sm font-bold rounded-full transition-all shadow-lg shadow-blue-500/20 active:scale-95 flex items-center gap-2"
            >
              <Download size={16} /> Download
            </a>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <header className="pt-40 pb-20 px-6">
        <div className="max-w-4xl mx-auto text-center space-y-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-packer-blue text-xs font-bold uppercase tracking-wider animate-fade-in">
             <span className="w-2 h-2 rounded-full bg-packer-blue animate-pulse"></span>
             {latestVersion} Available Now
          </div>
          
          <h1 className="text-5xl md:text-7xl font-extrabold text-packer-grey tracking-tight leading-tight animate-slide-up">
             Stop pasting code. <br/>
             <span className="text-transparent bg-clip-text bg-gradient-to-r from-packer-blue to-cyan-500">Start Packing.</span>
          </h1>
          
          <p className="text-xl text-packer-text-muted max-w-2xl mx-auto leading-relaxed animate-slide-up delay-100">
             The essential tool for "Context Engineering." Automatically clean, filter, and format your codebase into the perfect prompt for LLMs.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4 animate-slide-up delay-200">
             <a 
               href={currentDownloadLink}
               className="px-12 py-4 bg-packer-grey hover:bg-slate-900 text-white rounded-xl font-bold text-lg shadow-2xl shadow-slate-900/20 transition-all transform hover:-translate-y-1 active:translate-y-0 flex items-center gap-3 w-full sm:w-auto justify-center"
             >
                <Monitor size={24} />
                <span>Download for {osName}</span>
             </a>
          </div>
          
          <p className="text-xs text-packer-text-muted pt-2 animate-fade-in delay-300">
            Supports macOS, Windows, and Linux.
          </p>
        </div>
      </header>

      {/* Preview Section */}
      <section className="px-6 pb-20">
         <div className="max-w-5xl mx-auto bg-white rounded-2xl shadow-[0_50px_100px_-20px_rgba(0,0,0,0.12)] border border-slate-200 overflow-hidden relative group">
            <div className="h-12 bg-slate-50 border-b border-slate-200 flex items-center px-4 gap-2">
               <div className="w-3 h-3 rounded-full bg-red-400"></div>
               <div className="w-3 h-3 rounded-full bg-amber-400"></div>
               <div className="w-3 h-3 rounded-full bg-green-400"></div>
            </div>
            {/* Mock UI Content */}
            <div className="p-8 grid grid-cols-12 gap-8 h-[500px] bg-slate-50/30">
               <div className="col-span-4 bg-white rounded-lg border border-slate-200 shadow-sm p-4 space-y-3">
                  <div className="h-4 w-24 bg-slate-100 rounded mb-4"></div>
                  {[1,2,3,4,5].map(i => (
                      <div key={i} className={`h-8 rounded flex items-center px-3 gap-2 ${i===2 ? 'bg-blue-50 border border-blue-200' : 'bg-transparent'}`}>
                          <div className={`w-4 h-4 rounded border ${i===2 ? 'bg-packer-blue border-packer-blue' : 'border-slate-300'}`}></div>
                          <div className="h-2 w-20 bg-slate-200 rounded"></div>
                      </div>
                  ))}
               </div>
               <div className="col-span-8 space-y-4">
                  <div className="h-32 bg-white rounded-lg border border-slate-200 shadow-sm p-6">
                      <div className="h-4 w-32 bg-slate-100 rounded mb-2"></div>
                      <div className="h-2 w-full bg-slate-50 rounded"></div>
                  </div>
                  <div className="h-full bg-slate-800 rounded-lg shadow-lg p-6 font-mono text-xs text-blue-300 overflow-hidden relative">
                      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-b from-transparent to-slate-800 pointer-events-none"></div>
                      <p>### PROJECT STRUCTURE ###</p>
                      <p>├─ src/App.tsx (2.4 KB)</p>
                      <p>├─ src/utils/packer.ts (1.1 KB)</p>
                      <br/>
                      <p>### FILE CONTENTS ###</p>
                      <p>##### File: src/App.tsx #####</p>
                      <p>import React from 'react';</p>
                      <p>...</p>
                  </div>
               </div>
            </div>
         </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-24 bg-white border-t border-slate-100">
         <div className="max-w-6xl mx-auto px-6 grid md:grid-cols-3 gap-12">
            <Feature 
               icon={<Terminal className="text-white" size={24}/>}
               title="Auto-Watch & Update"
               desc="Changes to your code are reflected instantly. No need to re-scan. The perfect companion for rapid iteration."
            />
            <Feature 
               icon={<FileCode className="text-white" size={24}/>}
               title="Smart Filtering"
               desc="Automatically ignores node_modules, build artifacts, and binary assets (images, fonts) to save massive amounts of tokens."
            />
             <Feature 
               icon={<Zap className="text-white" size={24}/>}
               title="SVG & Context Aware"
               desc="Includes SVGs and config files often missed by other tools, giving your LLM the full visual and structural context."
            />
         </div>
      </section>

      {/* Privacy Section */}
      <section className="py-24 bg-slate-50 border-y border-slate-100">
         <div className="max-w-4xl mx-auto px-6 text-center space-y-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-50 border border-green-100 text-green-700 text-xs font-bold uppercase tracking-wider">
               <CheckCircle2 size={14} /> 100% Private & Secure
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-packer-grey">Your code never leaves your machine.</h2>
            <p className="text-lg text-packer-text-muted leading-relaxed">
               PromptPacker is a <strong>100% local application</strong>. We don't have servers, we don't track your usage, and we definitely never see your code. Everything happens entirely on your hardware, ensuring your intellectual property remains yours.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
               <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                  <p className="font-bold text-packer-grey">No Cloud</p>
                  <p className="text-xs text-packer-text-muted mt-1">Zero data transmission</p>
               </div>
               <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                  <p className="font-bold text-packer-grey">No Tracking</p>
                  <p className="text-xs text-packer-text-muted mt-1">No telemetry or analytics</p>
               </div>
               <div className="p-4 bg-white rounded-xl border border-slate-200 shadow-sm">
                  <p className="font-bold text-packer-grey">Local Only</p>
                  <p className="text-xs text-packer-text-muted mt-1">100% Offline capability</p>
               </div>
            </div>
         </div>
      </section>

      <footer className="py-12 bg-white text-center">
         <p className="text-sm text-packer-text-muted">© 2025 PromptPacker. Built for builders.</p>
      </footer>
    </div>
  );
}

function Feature({icon, title, desc}: {icon: React.ReactNode, title: string, desc: string}) {
   return (
      <div className="space-y-4 group">
         <div className="w-12 h-12 bg-packer-blue rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20 group-hover:scale-110 transition-transform duration-300">
            {icon}
         </div>
         <h3 className="text-xl font-bold text-packer-grey">{title}</h3>
         <p className="text-packer-text-muted leading-relaxed">
            {desc}
         </p>
      </div>
   )
}