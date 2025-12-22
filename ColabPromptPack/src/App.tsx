import { useState, useEffect } from "react";
import { getFileSystem, FileEntry } from "./services/FileSystem";
import { generatePrompt } from "./utils/promptGenerator";
import { generateAutoPreamble } from "./utils/autoPreamble";
import { Copy, FileText, RefreshCw, X, CheckCircle2, Wand2, FolderOpen, ListChecks, Settings, Keyboard, Terminal } from "lucide-react";
import { FileTreeItem } from "./components/FileTreeItem";
import "./App.css";

export default function App() {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  
  const fs = getFileSystem();
  
  // Selection State
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [tier1Paths, setTier1Paths] = useState<Set<string>>(new Set()); // Full content
  const [includeOutputPaths, setIncludeOutputPaths] = useState<Set<string>>(new Set());

  // Inputs
  const [preamble, setPreamble] = useState("");
  const [goal, setGoal] = useState("");
  
  // Output
  const [generatedPrompt, setGeneratedPrompt] = useState<string | null>(null);
  const [showOutput, setShowOutput] = useState(false);
  const [copied, setCopied] = useState(false);

  // Settings
  const [showSettings, setShowSettings] = useState(false);
  const [currentShortcut, setCurrentShortcut] = useState<{modifiers: string[], key: string} | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [quickCopyIncludesOutput, setQuickCopyIncludesOutput] = useState(false);

  // Close Overlay Logic
  const handleCloseOverlay = () => {
    // Send message to parent window (content script)
    window.parent.postMessage({ type: 'CLOSE_PROMPTPACK' }, '*');
  };

  // Auto-scan on mount & Load Settings
  useEffect(() => {
    handleOpenFolder();
    
    // Load shortcut
    // We are in an IFrame, so we can't access chrome.storage directly easily if we are sandboxed? 
    // Wait, extension pages have access to chrome API.
    if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.get(['quickCopyShortcut', 'quickCopyIncludesOutput'], (result) => {
            if (result.quickCopyShortcut) {
                setCurrentShortcut(result.quickCopyShortcut);
            } else {
                setCurrentShortcut({ modifiers: ["Alt", "Shift"], key: "C" });
            }
            if (result.quickCopyIncludesOutput !== undefined) {
                setQuickCopyIncludesOutput(result.quickCopyIncludesOutput);
            }
        });
    }
  }, []);

  const handleToggleQuickCopyOutput = () => {
      const newValue = !quickCopyIncludesOutput;
      setQuickCopyIncludesOutput(newValue);
      if (typeof chrome !== 'undefined' && chrome.storage) {
          chrome.storage.local.set({ quickCopyIncludesOutput: newValue }, () => {
            console.log("PromptPack UI: Saved quickCopyIncludesOutput =", newValue);
          });
      }
  };

  async function handleOpenFolder() {
    try {
      const selected = await fs.openFolder();

      if (selected) {
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
      const entries = await fs.scanProject(path);
      setFiles(entries);
      
      // Auto-select ALL files as Tier 1 (Full) by default
      // This reduces clicks for the "Copy Entire Notebook" use case
      const allPaths = new Set<string>();
      const allTier1 = new Set<string>();
      
      entries.forEach(e => {
        if (!e.is_dir) {
            allPaths.add(e.path);
            allTier1.add(e.path);
        }
      });
      
      setSelectedPaths(allPaths);
      setTier1Paths(allTier1);

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

  const toggleIncludeOutput = (path: string) => {
    if (!selectedPaths.has(path)) return; 
    const newSet = new Set(includeOutputPaths);
    if (newSet.has(path)) newSet.delete(path);
    else newSet.add(path);
    setIncludeOutputPaths(newSet);
  };

  const handleGlobalOutputToggle = () => {
    const selectedFiles = files.filter(f => selectedPaths.has(f.path) && !f.is_dir);
    if (selectedFiles.length === 0) return;

    const allHaveOutput = selectedFiles.every(f => includeOutputPaths.has(f.path));
    
    const newSet = new Set(includeOutputPaths);
    if (allHaveOutput) {
        selectedFiles.forEach(f => newSet.delete(f.path));
    } else {
        selectedFiles.forEach(f => newSet.add(f.path));
    }
    setIncludeOutputPaths(newSet);
  };
  
  const handleGenerate = async () => {
      setGenerating(true);
      try {
          const prompt = await generatePrompt(files, selectedPaths, tier1Paths, includeOutputPaths, preamble, goal);
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isRecording) return;
    e.preventDefault();
    e.stopPropagation();

    const modifiers = [];
    if (e.ctrlKey) modifiers.push("Ctrl");
    if (e.altKey) modifiers.push("Alt");
    if (e.shiftKey) modifiers.push("Shift");
    if (e.metaKey) modifiers.push("Meta");

    // Ignore modifier-only presses
    if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;

    const newShortcut = { modifiers, key: e.key.toUpperCase() };
    setCurrentShortcut(newShortcut);
    setIsRecording(false);
    
    // Save
    if (typeof chrome !== 'undefined' && chrome.storage) {
        chrome.storage.local.set({ quickCopyShortcut: newShortcut });
    }
  };

  const copyToClipboard = async () => {
      if (!generatedPrompt) return;
      try {
        // Use parent postMessage because we are in an IFrame
        window.parent.postMessage({ type: 'COPY_TO_CLIPBOARD', text: generatedPrompt }, '*');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
          console.error("Copy failed", e);
      }
  };

  const handleSetFull = (entry: FileEntry) => {
     const newSelected = new Set(selectedPaths);
     newSelected.add(entry.path);
     setSelectedPaths(newSelected);

     const newTier1 = new Set(tier1Paths);
     newTier1.add(entry.path);
     setTier1Paths(newTier1);
  };

  const handleSelectAll = () => {
    if (files.length === 0) return;

    // Check current state to decide next state
    // State 0: Not all selected -> Go to Select All (Sum)
    // State 1: All selected (Sum) -> Go to Select All (Full)
    // State 2: All selected (Full) -> Clear All

    const allSelected = files.every(f => selectedPaths.has(f.path));
    const allFull = files.every(f => tier1Paths.has(f.path) || f.is_dir);

    if (!allSelected) {
        // Select All (Sum)
        const newSelected = new Set<string>();
        files.forEach(f => newSelected.add(f.path));
        setSelectedPaths(newSelected);
        setTier1Paths(new Set()); // Reset full
    } else if (!allFull) {
        // Select All (Full)
        const newTier1 = new Set<string>();
        files.forEach(f => {
            if (!f.is_dir) newTier1.add(f.path);
        });
        setTier1Paths(newTier1);
    } else {
        // Clear All
        setSelectedPaths(new Set());
        setTier1Paths(new Set());
    }
  };
  
  return (
    <div className="h-screen w-screen bg-white text-packer-grey flex flex-col font-sans relative selection:bg-[#0069C3] selection:text-white">
      {/* Overlay Close Button */}
      <div className="absolute top-0 right-0 p-2 z-50">
        <button 
            onClick={handleCloseOverlay}
            className="bg-white/80 hover:bg-red-50 text-packer-text-muted hover:text-red-500 p-1.5 rounded-full shadow-sm border border-slate-200 transition-all"
            title="Close PromptPack"
        >
            <X size={20} strokeWidth={2.5}/>
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Pane: File Explorer */}
        <div className="w-[320px] border-r border-packer-border flex flex-col bg-white">
           <div className="h-12 px-3 flex items-center justify-between border-b border-packer-border bg-slate-50/50">
              <div className="flex items-center gap-2">
                 <span className="text-xs font-bold text-packer-text-muted uppercase tracking-wider whitespace-nowrap">Files</span>
                 
                 {/* Select All Button */}
                 {files.length > 0 && (
                   <div className="flex gap-1 ml-1">
                     <button 
                       onClick={handleSelectAll} 
                       className="flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 bg-white hover:bg-blue-50 hover:border-packer-blue/30 text-packer-text-muted hover:text-packer-blue transition-all shadow-sm active:scale-95"
                       title="Cycle: Select All (Sum) -> Select All (Full) -> Clear"
                     >
                        <ListChecks size={12} strokeWidth={2.5} />
                        <span className="text-[10px] font-bold uppercase tracking-tight">All</span>
                     </button>
                     
                     <button 
                       onClick={handleGlobalOutputToggle} 
                       className={`flex items-center gap-1 px-2 py-0.5 rounded border transition-all shadow-sm active:scale-95
                         ${files.filter(f => selectedPaths.has(f.path) && !f.is_dir).every(f => includeOutputPaths.has(f.path)) && selectedPaths.size > 0
                           ? 'bg-amber-100 border-amber-500 text-amber-700' 
                           : 'bg-white border-slate-200 text-packer-text-muted hover:border-amber-300 hover:text-amber-600'}`}
                       title="Toggle Output for All Selected Files"
                     >
                        <Terminal size={12} strokeWidth={2.5} />
                        <span className="text-[10px] font-bold uppercase tracking-tight">Out</span>
                     </button>
                   </div>
                 )}
                 
                 <button 
                   onClick={handleOpenFolder} 
                   className="flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 bg-white hover:bg-blue-50 hover:border-packer-blue/30 text-packer-text-muted hover:text-packer-blue transition-all shadow-sm active:scale-95"
                 >
                    <FolderOpen size={12} strokeWidth={2.5} />
                    <span className="text-[10px] font-bold uppercase tracking-tight">
                       {projectPath ? "Refresh" : "Scan"}
                    </span>
                 </button>
              </div>
              <span className="text-xs font-mono text-packer-blue bg-blue-50 px-2 py-0.5 rounded">{files.length}</span>
           </div>
           
           <div className="flex-1 overflow-y-auto custom-scrollbar">
              {files.length === 0 && !loading && (
                <button 
                  onClick={handleOpenFolder}
                  className="w-full h-full flex flex-col items-center justify-center text-packer-text-muted p-8 text-center gap-4 group hover:bg-slate-50/80 transition-all"
                >
                   <div className="bg-slate-100 p-5 rounded-full group-hover:bg-blue-50 group-hover:text-packer-blue transition-all transform group-hover:scale-110 shadow-sm group-hover:shadow-md">
                      <FolderOpen size={36} strokeWidth={1.5}/>
                   </div>
                   <div className="transform transition-transform group-hover:translate-y-1">
                      <p className="font-bold text-sm text-packer-grey group-hover:text-packer-blue transition-colors">No project loaded</p>
                      <p className="text-xs mt-1 opacity-70 group-hover:opacity-100">Click to open a folder</p>
                   </div>
                </button>
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
                     selectedPaths={selectedPaths}
                     tier1Paths={tier1Paths}
                     includeOutputPaths={includeOutputPaths}
                     onToggle={toggleSelection}
                     onSetFull={handleSetFull}
                     onToggleTier1={(e) => toggleTier1(e.path)}
                     onToggleOutput={(e) => toggleIncludeOutput(e.path)}
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
           <div className="p-6 border-t border-packer-border bg-white flex justify-between items-center gap-4 z-10">
              <button 
                  onClick={() => setShowSettings(true)}
                  className="px-4 py-2.5 flex items-center gap-2 text-packer-text-muted hover:bg-slate-50 hover:text-packer-grey rounded-md transition-colors border border-packer-border shadow-sm active:scale-95"
                  title="Settings"
              >
                 <Settings size={18} />
                 <span className="text-xs font-bold uppercase tracking-wider">Settings</span>
              </button>

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
      
      {/* Settings Modal */}
      {showSettings && (
          <div className="fixed inset-0 z-50 bg-packer-grey/20 flex items-center justify-center p-12 backdrop-blur-sm animate-in fade-in duration-200">
             <div className="bg-white w-[500px] rounded-lg shadow-2xl flex flex-col border border-packer-border overflow-hidden">
                <div className="flex justify-between items-center p-6 border-b border-packer-border bg-white">
                      <div className="flex items-center gap-3">
                        <div className="bg-slate-50 p-2 rounded text-packer-grey">
                           <Settings size={24}/>
                        </div>
                        <div>
                          <h3 className="font-bold text-lg text-packer-grey">Settings</h3>
                        </div>
                      </div>
                      <button onClick={() => setShowSettings(false)} className="hover:bg-slate-100 text-packer-text-muted hover:text-packer-grey p-2 rounded-full transition"><X size={24}/></button>
                </div>
                
                <div className="p-8 space-y-6">
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-packer-grey flex items-center gap-2">
                           <Keyboard size={16} /> Quick Copy Shortcut
                        </label>
                        <p className="text-xs text-packer-text-muted">
                           Global hotkey to copy the entire notebook without opening the extension.
                        </p>
                        
                        <div 
                          className={`mt-2 p-4 border-2 rounded-lg flex items-center justify-center cursor-pointer transition-all ${isRecording ? 'border-packer-blue bg-blue-50 text-packer-blue' : 'border-slate-200 bg-slate-50 hover:border-slate-300'}`}
                          onClick={() => setIsRecording(true)}
                          onKeyDown={handleKeyDown}
                          tabIndex={0} // Make focusable
                        >
                           {isRecording ? (
                               <span className="font-mono font-bold animate-pulse">Press keys...</span>
                           ) : (
                               <div className="flex gap-2">
                                  {currentShortcut?.modifiers.map(m => (
                                      <kbd key={m} className="px-2 py-1 bg-white border border-slate-200 rounded font-mono text-xs font-bold shadow-sm">{m}</kbd>
                                  ))}
                                  <kbd className="px-2 py-1 bg-white border border-slate-200 rounded font-mono text-xs font-bold shadow-sm">{currentShortcut?.key}</kbd>
                               </div>
                           )}
                        </div>
                        {isRecording && <p className="text-xs text-center text-packer-blue mt-1">Focus box and press key combo</p>}
                        {!isRecording && <p className="text-[10px] text-center text-packer-text-muted mt-1">Click to record new shortcut</p>}
                    </div>

                    <div className="space-y-2 pt-4 border-t border-slate-100">
                        <div className="flex items-center justify-between">
                           <div className="flex flex-col">
                              <label className="text-sm font-bold text-packer-grey flex items-center gap-2">
                                 <Terminal size={16} /> Include Outputs in Quick Copy
                              </label>
                              <p className="text-xs text-packer-text-muted">
                                 Append cell outputs (logs, errors) to the hotkey prompt.
                              </p>
                           </div>
                           <button 
                             onClick={handleToggleQuickCopyOutput}
                             className={`w-12 h-6 rounded-full relative transition-all duration-200 focus:outline-none shadow-inner
                               ${quickCopyIncludesOutput ? 'bg-[#0069C3]' : 'bg-slate-300'}`}
                           >
                               <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-200 shadow-md border border-slate-100 ${quickCopyIncludesOutput ? 'left-7' : 'left-1'}`} />
                           </button>
                        </div>
                    </div>
                </div>

                <div className="p-6 border-t border-packer-border bg-white flex justify-end">
                    <button onClick={() => setShowSettings(false)} className="px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded font-bold transition">Done</button>
                </div>
             </div>
          </div>
      )}

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
                            {copied ? <CheckCircle2 size={18} strokeWidth={2.5}/> : <Copy size={18} strokeWidth={2.5}/>}
                            {copied ? "Copied!" : "Copy to Clipboard"}
                        </button>
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}
