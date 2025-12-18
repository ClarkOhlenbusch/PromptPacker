import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, FileCode, RefreshCw, Copy, X } from "lucide-react";
import { generatePrompt } from "./utils/promptGenerator";
import "./App.css";

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
        // Simple heuristic for path matching: 
        // If entry.path is "/a/b", we match "/a/b" and "/a/b/..."
        // On Windows path separator is backslash.
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

  const copyToClipboard = async () => {
      if (!generatedPrompt) return;
      try {
          await navigator.clipboard.writeText(generatedPrompt);
          alert("Copied to clipboard!");
      } catch (e) {
          console.error("Copy failed", e);
      }
  };

  // Simple Recursive Tree Renderer
  const FileTreeItem = ({ entry, depth }: { entry: FileEntry, depth: number }) => {
    const isSelected = selectedPaths.has(entry.path);
    const isTier1 = tier1Paths.has(entry.path);
    
    return (
      <div 
        className={`flex items-center py-1 px-2 hover:bg-gray-800 cursor-pointer ${isSelected ? 'bg-gray-800' : ''}`}
        style={{ paddingLeft: `${depth * 1.5}rem` }}
      >
        <div className="flex-1 flex items-center gap-2" onClick={() => toggleSelection(entry)}>
           <input 
             type="checkbox" 
             checked={isSelected} 
             readOnly
             className="cursor-pointer"
           />
           {entry.is_dir ? <FolderOpen size={16} className="text-yellow-500"/> : <FileCode size={16} className="text-blue-400"/>}
           <span className="text-sm truncate">{entry.relative_path.split('/').pop()}</span>
        </div>
        
        {!entry.is_dir && isSelected && (
           <div className="flex items-center gap-2">
              <button 
                onClick={() => toggleTier1(entry.path)}
                className={`text-xs px-2 py-0.5 rounded border ${isTier1 ? 'bg-green-600 border-green-500 text-white' : 'border-gray-600 text-gray-400'}`}
                title={isTier1 ? "Full Content (Tier 1)" : "Summary Only (Tier 2)"}
              >
                {isTier1 ? "FULL" : "SUM"}
              </button>
           </div>
        )}
      </div>
    );
  };
  
  return (
    <div className="h-screen w-screen bg-gray-900 text-gray-100 flex flex-col font-sans relative">
      {/* Header */}
      <header className="h-14 border-b border-gray-700 flex items-center px-4 justify-between bg-gray-950">
        <div className="flex items-center gap-2">
           <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center font-bold">PP</div>
           <h1 className="font-semibold text-lg">PromptPack Lite</h1>
        </div>
        <button 
          onClick={handleOpenFolder}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 px-4 py-1.5 rounded text-sm transition"
        >
          <FolderOpen size={16} />
          {projectPath ? "Change Folder" : "Open Project"}
        </button>
      </header>
      
      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        
        {/* Left Pane: File Explorer */}
        <div className="w-1/3 min-w-[300px] border-r border-gray-700 flex flex-col bg-gray-900">
           <div className="p-2 border-b border-gray-800 text-xs uppercase text-gray-500 font-bold tracking-wider flex justify-between">
              <span>Files</span>
              <span>{files.length} found</span>
           </div>
           <div className="flex-1 overflow-y-auto custom-scrollbar">
              {files.length === 0 && !loading && (
                <div className="h-full flex flex-col items-center justify-center text-gray-500 p-4 text-center">
                   <p>No folder opened.</p>
                   <p className="text-sm">Click "Open Project" to start.</p>
                </div>
              )}
              {loading && <div className="p-4 text-center text-gray-400">Scanning...</div>}
              
              {files.map((entry) => (
                 <FileTreeItem 
                   key={entry.path} 
                   entry={entry} 
                   depth={entry.relative_path.split('/').length - 1} 
                 />
              ))}
           </div>
        </div>
        
        {/* Right Pane: Configuration */}
        <div className="flex-1 flex flex-col bg-gray-950">
           <div className="p-6 flex-1 overflow-y-auto">
              
              {/* Prompt Settings */}
              <div className="space-y-6 max-w-3xl mx-auto">
                
                <div>
                   <label className="block text-sm font-medium text-gray-400 mb-2">Preamble / Context</label>
                   <textarea 
                     className="w-full bg-gray-900 border border-gray-700 rounded p-3 text-sm focus:border-blue-500 focus:outline-none min-h-[100px]"
                     placeholder="E.g. This is a React project using Vite. We are trying to refactor the Auth component..."
                     value={preamble}
                     onChange={e => setPreamble(e.target.value)}
                   />
                </div>

                <div>
                   <label className="block text-sm font-medium text-gray-400 mb-2">Goal / Query</label>
                   <textarea 
                     className="w-full bg-gray-900 border border-gray-700 rounded p-3 text-sm focus:border-blue-500 focus:outline-none min-h-[80px]"
                     placeholder="What do you want the AI to do?"
                     value={goal}
                     onChange={e => setGoal(e.target.value)}
                   />
                </div>
                
                <div className="bg-gray-900 rounded p-4 border border-gray-800">
                   <h3 className="text-sm font-bold text-gray-300 mb-3">Selection Summary</h3>
                   <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-gray-500">Selected Files:</span>
                        <span className="ml-2 font-mono">{selectedPaths.size}</span>
                      </div>
                      <div>
                         <span className="text-gray-500">Full Content (Tier 1):</span>
                         <span className="ml-2 font-mono text-green-400">{tier1Paths.size}</span>
                      </div>
                      <div>
                         <span className="text-gray-500">Summarized (Tier 2):</span>
                         <span className="ml-2 font-mono text-yellow-400">{selectedPaths.size - tier1Paths.size}</span>
                      </div>
                      <div>
                         <span className="text-gray-500">Est. Tokens:</span>
                         <span className="ml-2 font-mono">
                           ~{Math.round(
                             files.filter(f => tier1Paths.has(f.path)).reduce((acc, f) => acc + (f.size / 4), 0) + 
                             files.filter(f => selectedPaths.has(f.path) && !tier1Paths.has(f.path) && !f.is_dir).reduce((acc, f) => acc + ((f.size / 4) * 0.2), 0) +
                             (files.length * 2) // Rough estimate for project tree lines
                           ).toLocaleString()}
                         </span> 
                      </div>
                   </div>
                </div>

              </div>
           </div>

           {/* Action Footer */}
           <div className="p-4 border-t border-gray-800 bg-gray-900 flex justify-end gap-4">
              <button 
                  onClick={handleGenerate}
                  disabled={generating || selectedPaths.size === 0}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded text-sm font-semibold transition flex items-center gap-2"
              >
                {generating ? <RefreshCw className="animate-spin" size={16}/> : <Copy size={16} />}
                Generate & Preview
              </button>
           </div>
        </div>
      </div>
      
      {/* Output Modal */}
      {showOutput && (
          <div className="absolute inset-0 z-50 bg-black/80 flex items-center justify-center p-8 backdrop-blur-sm">
              <div className="bg-gray-900 w-full max-w-4xl h-full max-h-[90vh] rounded-lg shadow-2xl flex flex-col border border-gray-700">
                  <div className="flex justify-between items-center p-4 border-b border-gray-800">
                      <h3 className="font-bold text-lg">Generated Prompt</h3>
                      <button onClick={() => setShowOutput(false)} className="hover:bg-gray-800 p-1 rounded"><X size={20}/></button>
                  </div>
                  <div className="flex-1 p-4 overflow-hidden">
                      <textarea 
                          readOnly 
                          value={generatedPrompt || ""} 
                          className="w-full h-full bg-gray-950 text-gray-300 font-mono text-sm p-4 rounded border border-gray-800 focus:outline-none resize-none"
                      />
                  </div>
                  <div className="p-4 border-t border-gray-800 flex justify-end gap-3">
                      <button onClick={() => setShowOutput(false)} className="px-4 py-2 hover:bg-gray-800 rounded">Close</button>
                      <button onClick={copyToClipboard} className="px-6 py-2 bg-green-600 hover:bg-green-700 rounded font-semibold text-white flex items-center gap-2">
                          <Copy size={16}/> Copy to Clipboard
                      </button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}