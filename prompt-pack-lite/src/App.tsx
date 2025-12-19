import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { generatePrompt } from "./utils/promptGenerator";
import { generateAutoPreamble } from "./utils/autoPreamble";
import { Copy, FileText, RefreshCw, X, CheckCircle2, Wand2, FolderOpen, FileCode } from "lucide-react";
import "./App.css";
import logo from "./assets/logo.png";

interface FileEntry {
  path: string;
  relative_path: string;
  is_dir: boolean;
  size: number;
  line_count?: number;
}

export default function App() {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  
  // Selection State
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [tier1Paths, setTier1Paths] = useState<Set<string>>(new Set()); // Full content

  // Inputs
  const [preamble, setPreamble] = useState("");
  const [goal, setGoal] = useState("");
  
  // Output
  const [generatedPrompt, setGeneratedPrompt] = useState<string | null>(null);
  const [showOutput, setShowOutput] = useState(false);

  async function handleOpenFolder() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (selected && typeof selected === 'string') {
        setProjectPath(selected);
        scanProject(selected);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function scanProject(path: string) {
    setLoading(true);
    try {
      const entries = await invoke<FileEntry[]>("scan_project", { path });
      setFiles(entries);
      // Auto-select README
      const readme = entries.find(e => e.relative_path.toLowerCase() === 'readme.md');
      if (readme) {
        setSelectedPaths(prev => new Set(prev).add(readme.path));
        setTier1Paths(prev => new Set(prev).add(readme.path));
      }
    } catch (e) {
      console.error("Scan failed", e);
    } finally {
      setLoading(false);
    }
  }

  // Toggle Selection
  const toggleSelection = (entry: FileEntry) => {
    const newSelected = new Set(selectedPaths);
    const newTier1 = new Set(tier1Paths);
    
    // Determine target state based on the clicked item
    const isCurrentlySelected = newSelected.has(entry.path);
    const shouldSelect = !isCurrentlySelected;

    const processPath = (p: string, select: boolean) => {
        if (select) {
            newSelected.add(p);
            // Default to SUM (ensure not in tier1)
            newTier1.delete(p); 
        } else {
            newSelected.delete(p);
            newTier1.delete(p);
        }
    };

    if (entry.is_dir) {
        const separator = entry.path.includes('\\') ? '\\' : '/';
        const prefix = entry.path.endsWith(separator) ? entry.path : entry.path + separator;

        files.forEach(f => {
            if (f.path === entry.path || f.path.startsWith(prefix)) {
                processPath(f.path, shouldSelect);
            }
        });
    } else {
        processPath(entry.path, shouldSelect);
    }

    setSelectedPaths(newSelected);
    setTier1Paths(newTier1);
  };

  const toggleTier1 = (path: string) => {
    if (!selectedPaths.has(path)) return; // Must be selected first
    const newTier1 = new Set(tier1Paths);
    if (newTier1.has(path)) {
      newTier1.delete(path);
    } else {
      newTier1.add(path);
    }
    setTier1Paths(newTier1);
  };
  
  const handleGenerate = async () => {
      setGenerating(true);
      try {
          const prompt = await generatePrompt(files, selectedPaths, tier1Paths, preamble, goal);
          setGeneratedPrompt(prompt);
          setShowOutput(true);
      } catch (e) {
          console.error(e);
          alert("Failed to generate prompt");
      } finally {
          setGenerating(false);
      }
  };

  async function handleAutoFill() {
    setGenerating(true);
    try {
      const autoPreamble = await generateAutoPreamble(files);
      if (autoPreamble) {
        setPreamble(prev => (prev ? prev + "\n\n" + autoPreamble : autoPreamble));
      } else {
        alert("No suitable config files or README found to generate context.");
      }
    } catch (e) {
      console.error(e);
      alert("Failed to auto-generate preamble");
    } finally {
      setGenerating(false);
    }
  }

  const copyToClipboard = async () => {
      if (!generatedPrompt) return;
      try {
          await navigator.clipboard.writeText(generatedPrompt);
          alert("Copied to clipboard!");
      } catch (e) {
          console.error("Copy failed", e);
      }
  };

  // Minimalist Tree Renderer
  const FileTreeItem = ({ entry, depth }: { entry: FileEntry, depth: number }) => {
    const isSelected = selectedPaths.has(entry.path);
    const isTier1 = tier1Paths.has(entry.path);
    
    return (
      <div 
        className={`group flex items-center py-2 px-3 cursor-pointer transition-colors border-l-4
          ${isSelected 
            ? 'bg-blue-100/60 border-[#0069C3]' 
            : 'border-transparent hover:bg-slate-50'
          }`}
        style={{ paddingLeft: `${depth * 1.5 + 0.75}rem` }}
        onClick={() => toggleSelection(entry)}
      >
        <div className="flex-1 flex items-center gap-3 overflow-hidden">
           {/* Custom Checkbox */}
           <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors shadow-sm
              ${isSelected ? 'bg-[#0069C3] border-[#0069C3]' : 'bg-white border-gray-300 group-hover:border-[#0069C3]'}`}>
              {isSelected && <CheckCircle2 size={12} className="text-white" strokeWidth={3} />}
           </div>

           {entry.is_dir ? 
             <FolderOpen size={18} className={`${isSelected ? 'text-[#0069C3]' : 'text-slate-400 group-hover:text-slate-600'} transition-colors`} strokeWidth={2}/> : 
             <FileCode size={18} className={`${isSelected ? 'text-[#0069C3]' : 'text-slate-400 group-hover:text-slate-600'} transition-colors`} strokeWidth={2}/>
           }
           
           <span className={`text-sm truncate font-bold ${isSelected ? 'text-slate-900' : 'text-slate-600'}`}>
             {entry.relative_path.split('/').pop()}
           </span>
        </div>
        
        {!entry.is_dir && isSelected && (
           <button 
             onClick={(e) => {
               e.stopPropagation();
               toggleTier1(entry.path);
             }}
             className={`ml-2 text-[10px] px-2 py-0.5 rounded border-2 font-black tracking-wide uppercase transition-all shadow-sm
               ${isTier1 
                 ? 'bg-[#0069C3] text-white border-[#0069C3]' 
                 : 'bg-white text-slate-900 border-slate-300 hover:border-slate-400'
               }`}
           >
             {isTier1 ? "FULL" : "SUM"}
           </button>
        )}
      </div>
    );
  };
  
  return (
    <div className="h-screen w-screen bg-white text-packer-grey flex flex-col font-sans relative selection:bg-packer-blue selection:text-white">
      {/* Header */}
      <header className="h-16 border-b border-packer-border flex items-center px-6 justify-between bg-white shrink-0 z-10">
        <div className="flex items-center gap-3">
           <img src={logo} alt="Logo" className="w-8 h-8" />
           <div>
             <h1 className="font-bold text-lg text-packer-grey tracking-tight">PromptPack Lite</h1>
           </div>
        </div>
        <button 
          onClick={handleOpenFolder}
          className="flex items-center gap-2 bg-white hover:bg-slate-50 text-packer-grey border border-packer-grey px-4 py-2 rounded-md text-sm font-semibold transition-all"
        >
          <FolderOpen size={18} strokeWidth={2} />
          {projectPath ? "Change Folder" : "Open Project"}
        </button>
      </header>
      
      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Pane: File Explorer */}
        <div className="w-[320px] border-r border-packer-border flex flex-col bg-white">
           <div className="h-12 px-4 flex items-center justify-between border-b border-packer-border bg-slate-50/50">
              <span className="text-xs font-bold text-packer-text-muted uppercase tracking-wider">Project Files</span>
              <span className="text-xs font-mono text-packer-blue bg-blue-50 px-2 py-0.5 rounded">{files.length}</span>
           </div>
           
           <div className="flex-1 overflow-y-auto custom-scrollbar">
              {files.length === 0 && !loading && (
                <div className="h-full flex flex-col items-center justify-center text-packer-text-muted p-8 text-center gap-4 opacity-60">
                   <div className="bg-slate-100 p-4 rounded-full">
                      <FolderOpen size={32} strokeWidth={1.5}/>
                   </div>
                   <p className="font-medium text-sm">No project loaded</p>
                </div>
              )}
              
              {loading && (
                <div className="flex items-center justify-center p-8 text-packer-blue gap-3">
                  <RefreshCw className="animate-spin" size={20}/> 
                  <span className="text-sm font-medium">Scanning...</span>
                </div>
              )}
              
              <div className="py-2">
                {files.map((entry) => (
                   <FileTreeItem 
                     key={entry.path} 
                     entry={entry} 
                     depth={entry.relative_path.split('/').length - 1} 
                   />
                ))}
              </div>
           </div>
        </div>
        
        {/* Right Pane: Configuration */}
        <div className="flex-1 flex flex-col bg-white">
           <div className="flex-1 overflow-y-auto p-10">
              <div className="max-w-3xl mx-auto space-y-10">
                
                {/* Context Section */}
                <div className="space-y-6">
                   <div className="flex items-center gap-3 pb-2 border-b border-packer-border">
                      <div className="bg-blue-50 p-1.5 rounded text-packer-blue">
                         <FileText size={20} strokeWidth={2}/>
                      </div>
                      <h2 className="text-lg font-bold text-packer-grey">Context & Goal</h2>
                   </div>
                   
                   <div className="grid gap-8">
                      <div className="space-y-3">
                         <div className="flex justify-between items-end">
                            <label className="text-sm font-bold text-packer-grey uppercase tracking-wide text-[11px]">Preamble / Context</label>
                            <button 
                              onClick={handleAutoFill}
                              disabled={generating}
                              className="text-[10px] font-bold text-packer-blue hover:text-[#005a9e] flex items-center gap-1 uppercase tracking-wide transition-colors"
                            >
                               <Wand2 size={12} /> Auto-Fill
                            </button>
                         </div>
                         <textarea 
                           className="w-full bg-white border border-packer-border rounded p-4 text-sm text-packer-grey focus:border-packer-blue focus:ring-1 focus:ring-packer-blue focus:outline-none min-h-[120px] placeholder:text-gray-300 transition-all shadow-subtle"
                           placeholder="Describe your project stack, conventions, or specific requirements..."
                           value={preamble}
                           onChange={e => setPreamble(e.target.value)}
                         />
                      </div>

                      <div className="space-y-3">
                         <label className="text-sm font-bold text-packer-grey uppercase tracking-wide text-[11px]">Task / Query</label>
                         <textarea 
                           className="w-full bg-white border border-packer-border rounded p-4 text-sm text-packer-grey focus:border-packer-blue focus:ring-1 focus:ring-packer-blue focus:outline-none min-h-[100px] placeholder:text-gray-300 transition-all shadow-subtle"
                           placeholder="What should the AI do with this context?"
                           value={goal}
                           onChange={e => setGoal(e.target.value)}
                         />
                      </div>
                   </div>
                </div>
                
                {/* Stats Card */}
                <div className="rounded-lg border border-packer-border p-6 shadow-subtle bg-slate-50/30">
                   <div className="flex items-center justify-between mb-6">
                     <h3 className="text-sm font-bold text-packer-grey">Pack Summary</h3>
                   </div>
                   
                   <div className="grid grid-cols-3 gap-8">
                      <div className="flex flex-col gap-1">
                        <span className="text-[11px] font-bold text-packer-text-muted uppercase">Files Selected</span>
                        <div className="flex items-baseline gap-2">
                           <span className="text-2xl font-bold text-packer-grey">{selectedPaths.size}</span>
                           <span className="text-xs text-packer-text-muted">total</span>
                        </div>
                      </div>
                      
                      <div className="flex flex-col gap-1">
                         <span className="text-[11px] font-bold text-packer-text-muted uppercase">Context Type</span>
                         <div className="flex gap-4 text-sm font-medium mt-1">
                            <span className="flex items-center gap-1.5 text-packer-blue">
                               <div className="w-2 h-2 rounded-full bg-packer-blue"></div>
                               {tier1Paths.size} Full
                            </span>
                            <span className="flex items-center gap-1.5 text-packer-text-muted">
                               <div className="w-2 h-2 rounded-full bg-gray-300"></div>
                               {selectedPaths.size - tier1Paths.size} Sum
                            </span>
                         </div>
                      </div>

                      <div className="flex flex-col gap-1 text-right">
                         <span className="text-[11px] font-bold text-packer-text-muted uppercase">Estimated Tokens</span>
                         <span className="text-2xl font-bold text-packer-blue font-mono">
                           ~{Math.round(
                             files.filter(f => tier1Paths.has(f.path)).reduce((acc, f) => acc + (f.size / 4), 0) + 
                             files.filter(f => selectedPaths.has(f.path) && !tier1Paths.has(f.path) && !f.is_dir).reduce((acc, f) => acc + ((f.size / 4) * 0.2), 0) +
                             (files.length * 2) 
                           ).toLocaleString()}
                         </span> 
                      </div>
                   </div>
                </div>

              </div>
           </div>

           {/* Action Footer */}
           <div className="p-6 border-t border-packer-border bg-white flex justify-end gap-4 z-10">
              <button 
                  onClick={handleGenerate}
                  disabled={generating || selectedPaths.size === 0}
                  className="px-8 py-3 bg-[#0069C3] hover:bg-[#1a252f] disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-bold tracking-wide text-white transition-all shadow-lg shadow-blue-500/20 flex items-center gap-2 transform active:scale-[0.98]"
              >
                {generating ? <RefreshCw className="animate-spin" size={18}/> : <Copy size={18} strokeWidth={2.5} />}
                GENERATE PROMPT
              </button>
           </div>
        </div>
      </div>
      
      {/* Output Modal */}
      {showOutput && (
          <div className="fixed inset-0 z-50 bg-packer-grey/20 flex items-center justify-center p-12 backdrop-blur-sm animate-in fade-in duration-200">
              <div className="bg-white w-full max-w-5xl h-full max-h-[80vh] rounded-lg shadow-2xl flex flex-col border border-packer-border overflow-hidden">
                  <div className="flex justify-between items-center p-6 border-b border-packer-border bg-white">
                      <div className="flex items-center gap-3">
                        <div className="bg-blue-50 p-2 rounded">
                           <CheckCircle2 className="text-packer-blue" size={24}/>
                        </div>
                        <div>
                          <h3 className="font-bold text-lg text-packer-grey">Prompt Generated</h3>
                          <p className="text-xs text-packer-text-muted">Ready to copy</p>
                        </div>
                      </div>
                      <button onClick={() => setShowOutput(false)} className="hover:bg-slate-100 text-packer-text-muted hover:text-packer-grey p-2 rounded-full transition"><X size={24}/></button>
                  </div>
                  <div className="flex-1 p-0 relative">
                      <textarea 
                          readOnly 
                          value={generatedPrompt || ""} 
                          className="w-full h-full bg-slate-50 text-packer-grey font-mono text-sm p-8 focus:outline-none resize-none custom-scrollbar leading-relaxed"
                      />
                  </div>
                  <div className="p-6 border-t border-packer-border bg-white flex justify-between items-center">
                      <span className="text-xs text-packer-text-muted font-mono bg-slate-100 px-2 py-1 rounded">
                        {generatedPrompt?.length.toLocaleString()} chars
                      </span>
                      <div className="flex gap-4">
                        <button onClick={() => setShowOutput(false)} className="px-6 py-2.5 hover:bg-slate-50 border border-packer-border rounded font-semibold text-packer-text-muted transition">Close</button>
                        <button onClick={copyToClipboard} className="px-8 py-2.5 bg-[#0069C3] hover:bg-[#1a252f] rounded font-bold text-white flex items-center gap-2 shadow-lg shadow-blue-500/20 transition transform active:scale-[0.98]">
                            <Copy size={18} strokeWidth={2.5}/> Copy to Clipboard
                        </button>
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}
