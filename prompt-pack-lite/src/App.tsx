import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { writeText as writeClipboardText } from "@tauri-apps/plugin-clipboard-manager";
import { generatePrompt } from "./utils/promptGenerator";
import { generateAutoPreamble } from "./utils/autoPreamble";
import { Copy, FileText, RefreshCw, X, CheckCircle2, Wand2, FolderOpen, ListChecks, GitCompare, Camera, Trash2 } from "lucide-react";
import { FileTreeItem } from "./components/FileTreeItem";
import "./App.css";

interface FileEntry {
  path: string;
  relative_path: string;
  is_dir: boolean;
  size: number;
  line_count?: number;
}

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  line: string;
  old_line_num: number | null;
  new_line_num: number | null;
}

interface FileDiff {
  path: string;
  relative_path: string;
  previous: string;
  current: string;
  diff: DiffLine[];
}

export default function App() {
  const [projectPath, setProjectPath] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const scanInProgress = useRef(false);
  const pendingScanPath = useRef<string | null>(null);
  const scanDebounceTimer = useRef<number | null>(null);

  // Selection State
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [tier1Paths, setTier1Paths] = useState<Set<string>>(new Set()); // Full content

  // Inputs
  const [preamble, setPreamble] = useState("");
  const [goal, setGoal] = useState("");

  // Output
  const [generatedPrompt, setGeneratedPrompt] = useState<string | null>(null);
  const [showOutput, setShowOutput] = useState(false);
  const [copied, setCopied] = useState(false);
  const [includeFileTree, setIncludeFileTree] = useState(true);

  // Token counting
  const [tokenCount, setTokenCount] = useState<number | null>(null);
  const [countingTokens, setCountingTokens] = useState(false);

  // Diff tracking
  const [fileDiffs, setFileDiffs] = useState<FileDiff[]>([]);
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [loadingDiffs, setLoadingDiffs] = useState(false);
  const [selectedDiffPaths, setSelectedDiffPaths] = useState<Set<string>>(new Set());
  const [diffCopied, setDiffCopied] = useState(false);
  const [hasSnapshot, setHasSnapshot] = useState(false);

  function requestScan(path: string, immediate = false) {
    pendingScanPath.current = path;

    if (scanInProgress.current) {
      if (scanDebounceTimer.current !== null) {
        window.clearTimeout(scanDebounceTimer.current);
        scanDebounceTimer.current = null;
      }
      return;
    }

    if (scanDebounceTimer.current !== null) {
      window.clearTimeout(scanDebounceTimer.current);
      scanDebounceTimer.current = null;
    }

    if (immediate) {
      void scanProject(path);
      return;
    }

    scanDebounceTimer.current = window.setTimeout(() => {
      scanDebounceTimer.current = null;
      const nextPath = pendingScanPath.current;
      if (nextPath) {
        void scanProject(nextPath);
      }
    }, 250);
  }

  // Watch for file changes
  useEffect(() => {
    if (!projectPath) return;

    // Start watching
    invoke("watch_project", { path: projectPath }).catch(console.error);

    let unlisten: Promise<() => void>;

    const setupListener = async () => {
      unlisten = listen("project-change", () => {
        console.log("File change detected, refreshing...");
        requestScan(projectPath);
      });
    };

    setupListener();

    return () => {
      if (unlisten) unlisten.then(f => f());
      if (scanDebounceTimer.current !== null) {
        window.clearTimeout(scanDebounceTimer.current);
        scanDebounceTimer.current = null;
      }
      pendingScanPath.current = null;
    };
  }, [projectPath]);

  // Count tokens when selection changes
  useEffect(() => {
    const fullPaths = files.filter(f => tier1Paths.has(f.path) && !f.is_dir).map(f => f.path);
    const skeletonPaths = files.filter(f => selectedPaths.has(f.path) && !tier1Paths.has(f.path) && !f.is_dir).map(f => f.path);
    const selectedFiles = files.filter(f => selectedPaths.has(f.path) && !f.is_dir);
    
    if (selectedFiles.length === 0 && !preamble.trim() && !goal.trim()) {
      setTokenCount(0);
      return;
    }

    let cancelled = false;
    setCountingTokens(true);

    (async () => {
      try {
        // Build overhead text (headers, file tree, formatting)
        let overhead = "";
        
        if (preamble.trim()) {
          overhead += "PREAMBLE\n" + preamble + "\n\n";
        }
        
        if (includeFileTree && files.length > 0) {
          overhead += "TREE\n";
          // Estimate tree: ~50 chars per file entry on average
          overhead += files.map(f => `├─ ${f.relative_path} (${f.size} B, ${f.line_count || 0} lines)\n`).join("");
          overhead += "\n\n";
        }
        
        // Add file headers/footers
        selectedFiles.forEach(f => {
          const isFull = tier1Paths.has(f.path);
          overhead += `FILE ${f.relative_path} ${isFull ? "FULL" : "SKELETON"}\n`;
          overhead += "\nEND_FILE\n\n";
        });
        
        if (goal.trim()) {
          overhead += "GOAL\n" + goal + "\n";
        }
        
        const overheadTokens: number = overhead.length > 0 
          ? await invoke("count_tokens", { text: overhead })
          : 0;

        const fullTokens: number = fullPaths.length > 0 
          ? await invoke("count_tokens_for_files", { paths: fullPaths })
          : 0;
        
        // For skeleton files, count full tokens then apply 30% estimate
        const skeletonFullTokens: number = skeletonPaths.length > 0
          ? await invoke("count_tokens_for_files", { paths: skeletonPaths })
          : 0;
        const skeletonTokens = Math.round(skeletonFullTokens * 0.3);

        if (!cancelled) {
          setTokenCount(overheadTokens + fullTokens + skeletonTokens);
        }
      } catch (e) {
        console.error("Token counting failed:", e);
        if (!cancelled) setTokenCount(null);
      } finally {
        if (!cancelled) setCountingTokens(false);
      }
    })();

    return () => { cancelled = true; };
  }, [files, selectedPaths, tier1Paths, preamble, goal, includeFileTree]);

  async function handleOpenFolder() {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (selected && typeof selected === 'string') {
        // Reset selection when opening a NEW project
        if (selected !== projectPath) {
          setSelectedPaths(new Set());
          setTier1Paths(new Set());
        }
        setProjectPath(selected);
        // Scan immediately for faster UX; watcher refreshes are debounced.
        requestScan(selected, true);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function scanProject(path: string) {
    if (scanInProgress.current) {
      pendingScanPath.current = path;
      return;
    }

    scanInProgress.current = true;
    pendingScanPath.current = null;
    setLoading(true);
    try {
      const entries = await invoke<FileEntry[]>("scan_project", { path });
      setFiles(entries);

      // Auto-select README only if nothing is selected (initial load)
      // We need to access the CURRENT selectedPaths state.
      // Since we are inside a closure, selectedPaths might be stale?
      // We can use the functional update of setFiles to trigger side effects? No.
      // We'll trust the component state for now. 
      // Actually, if it's an auto-refresh, we don't want to re-select README.

      setSelectedPaths(prev => {
        if (prev.size === 0) {
          const readme = entries.find(e => e.relative_path.toLowerCase() === 'readme.md');
          if (readme) {
            setTier1Paths(t => new Set(t).add(readme.path));
            return new Set(prev).add(readme.path);
          }
        }
        return prev;
      });

    } catch (e) {
      console.error("Scan failed", e);
    } finally {
      setLoading(false);
      scanInProgress.current = false;
      if (pendingScanPath.current) {
        const nextPath = pendingScanPath.current;
        pendingScanPath.current = null;
        void scanProject(nextPath);
      }
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

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const prompt = await generatePrompt(files, selectedPaths, tier1Paths, preamble, goal, includeFileTree);
      setGeneratedPrompt(prompt);
      setShowOutput(true);
    } catch (e) {
      console.error(e);
      alert("Failed to generate prompt");
    } finally {
      setGenerating(false);
    }
  };

  // Diff handlers
  const handleTakeSnapshot = async () => {
    if (!projectPath) return;
    const paths = files.filter(f => !f.is_dir).map(f => f.path);
    try {
      const count = await invoke<number>("take_snapshot", { paths });
      setHasSnapshot(true);
      alert(`Snapshot taken: ${count} files`);
    } catch (e) {
      console.error("Snapshot failed", e);
    }
  };

  const handleViewDiffs = async () => {
    if (!projectPath) return;
    setLoadingDiffs(true);
    try {
      const paths = files.filter(f => !f.is_dir).map(f => f.path);
      const diffs = await invoke<FileDiff[]>("get_diffs", { paths, rootPath: projectPath });
      setFileDiffs(diffs);
      setSelectedDiffPaths(new Set(diffs.map(d => d.path)));
      setShowDiffModal(true);
    } catch (e) {
      console.error("Get diffs failed", e);
    } finally {
      setLoadingDiffs(false);
    }
  };

  const handleClearSnapshot = async () => {
    try {
      await invoke("clear_snapshot");
      setHasSnapshot(false);
      setFileDiffs([]);
    } catch (e) {
      console.error("Clear snapshot failed", e);
    }
  };

  const toggleDiffSelection = (path: string) => {
    const newSet = new Set(selectedDiffPaths);
    if (newSet.has(path)) newSet.delete(path);
    else newSet.add(path);
    setSelectedDiffPaths(newSet);
  };

  const generateDiffPrompt = (): string => {
    const selected = fileDiffs.filter(d => selectedDiffPaths.has(d.path));
    if (selected.length === 0) return "";
    let output = "### CHANGES MADE ###\n\n";
    output += `The following ${selected.length} file(s) have been modified:\n\n`;
    selected.forEach(diff => {
      output += `---\n\n#### ${diff.relative_path} ####\n\n`;
      output += `**Previous Code:**\n\`\`\`\n${diff.previous}\n\`\`\`\n\n`;
      output += `**Updated Code:**\n\`\`\`\n${diff.current}\n\`\`\`\n\n`;
      const added = diff.diff.filter(d => d.type === 'added').length;
      const removed = diff.diff.filter(d => d.type === 'removed').length;
      output += `*Changes: +${added} lines, -${removed} lines*\n\n`;
    });
    return output;
  };

  const copyDiffToClipboard = async () => {
    const diffPrompt = generateDiffPrompt();
    if (!diffPrompt) return;
    try {
      await writeClipboardText(diffPrompt);
      setDiffCopied(true);
      setTimeout(() => setDiffCopied(false), 2000);
    } catch (e) {
      console.error("Copy failed", e);
    }
  };

  const renderDiffLine = (line: DiffLine, index: number) => {
    const bgColor = line.type === 'added' ? 'bg-green-100' : line.type === 'removed' ? 'bg-red-100' : 'bg-white';
    const textColor = line.type === 'added' ? 'text-green-800' : line.type === 'removed' ? 'text-red-800' : 'text-gray-700';
    const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';
    const lineNum = line.type === 'removed' ? line.old_line_num : line.new_line_num;
    return (
      <div key={index} className={`${bgColor} ${textColor} font-mono text-xs flex`}>
        <span className="w-10 text-right pr-2 text-gray-400 select-none border-r border-gray-200">{lineNum || ''}</span>
        <span className="w-4 text-center select-none">{prefix}</span>
        <span className="flex-1 whitespace-pre overflow-x-auto">{line.line}</span>
      </div>
    );
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

  const fallbackCopyText = (text: string) => {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let success = false;
    try {
      success = document.execCommand("copy");
    } catch (err) {
      success = false;
    }
    document.body.removeChild(textarea);
    return success;
  };

  const copyToClipboard = async () => {
    if (!generatedPrompt) return;
    try {
      await writeClipboardText(generatedPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      try {
        await navigator.clipboard.writeText(generatedPrompt);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (fallbackErr) {
        if (fallbackCopyText(generatedPrompt)) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } else {
          console.error("Copy failed", fallbackErr);
        }
      }
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

  return (
    <div className="h-screen w-screen bg-white text-packer-grey flex flex-col font-sans relative selection:bg-packer-blue selection:text-white">
      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left Pane: File Explorer */}
        <div className="w-[320px] border-r border-packer-border flex flex-col bg-white">
          <div className="h-12 px-3 flex items-center justify-between border-b border-packer-border bg-slate-50/50">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-packer-text-muted uppercase tracking-wider whitespace-nowrap">FILES</span>

              {/* Select All Button */}
              {files.length > 0 && (
                <div className="flex items-center ml-1 gap-1">
                  <button
                    onClick={handleSelectAll}
                    className="flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 bg-white hover:bg-blue-50 hover:border-packer-blue/30 text-packer-text-muted hover:text-packer-blue transition-all shadow-sm active:scale-95"
                    title="Cycle: Select All (Skeleton) → Select All (Full) → Clear"
                  >
                    <ListChecks size={12} strokeWidth={2.5} />
                    <span className="text-[10px] font-bold uppercase tracking-tight">All</span>
                  </button>

                  <button
                    onClick={() => projectPath && requestScan(projectPath, true)}
                    disabled={loading}
                    className="flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 bg-white hover:bg-blue-50 hover:border-packer-blue/30 text-packer-text-muted hover:text-packer-blue transition-all shadow-sm active:scale-95"
                    title="Refresh File List"
                  >
                    <RefreshCw size={12} strokeWidth={2.5} className={loading ? "animate-spin" : ""} />
                  </button>
                </div>
              )}

              <button
                onClick={handleOpenFolder}
                className="flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 bg-white hover:bg-blue-50 hover:border-packer-blue/30 text-packer-text-muted hover:text-packer-blue transition-all shadow-sm active:scale-95"
              >
                <FolderOpen size={12} strokeWidth={2.5} />
                <span className="text-[10px] font-bold uppercase tracking-tight">
                  {projectPath ? "Change" : "Open"}
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
                  <FolderOpen size={36} strokeWidth={1.5} />
                </div>
                <div className="transform transition-transform group-hover:translate-y-1">
                  <p className="font-bold text-sm text-packer-grey group-hover:text-packer-blue transition-colors">No project loaded</p>
                  <p className="text-xs mt-1 opacity-70 group-hover:opacity-100">Click to open a folder</p>
                </div>
              </button>
            )}

            {loading && (
              <div className="flex items-center justify-center p-8 text-packer-blue gap-3">
                <RefreshCw className="animate-spin" size={20} />
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
                  onToggle={toggleSelection}
                  onSetFull={handleSetFull}
                  onToggleTier1={(e) => toggleTier1(e.path)}
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
                    <FileText size={20} strokeWidth={2} />
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
                <div className="flex items-center gap-6 mb-6">
                  <h3 className="text-sm font-bold text-packer-grey">Pack Summary</h3>
                  <div className="flex items-center gap-2">
                    <button
                      id="file-tree-toggle"
                      onClick={() => setIncludeFileTree(!includeFileTree)}
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-packer-blue focus:ring-offset-2 ${includeFileTree ? 'bg-packer-blue shadow-inner shadow-blue-900/20' : 'bg-slate-200 shadow-inner shadow-black/5'}`}
                    >
                      <span className="sr-only">Toggle file tree</span>
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out ${includeFileTree ? 'translate-x-4.5' : 'translate-x-1'}`}
                      />
                    </button>
                    <label className="text-xs font-bold text-packer-grey uppercase tracking-wide cursor-pointer select-none transition-colors" htmlFor="file-tree-toggle">File Tree</label>
                  </div>
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
                        {selectedPaths.size - tier1Paths.size} Skeleton
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 text-right">
                    <span className="text-[11px] font-bold text-packer-text-muted uppercase">Estimated Tokens</span>
                    <span className="text-2xl font-bold text-packer-blue font-mono">
                      {countingTokens ? "..." : tokenCount !== null ? tokenCount.toLocaleString() : "—"}
                    </span>
                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* Action Footer */}
          <div className="p-6 border-t border-packer-border bg-white flex justify-between items-center z-10">
            <div className="flex gap-2">
              <button
                onClick={handleTakeSnapshot}
                disabled={!projectPath || files.length === 0}
                className="px-4 py-2.5 border border-slate-200 hover:bg-blue-50 hover:border-blue-300 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-medium text-packer-text-muted hover:text-blue-600 transition-all flex items-center gap-2"
                title="Take snapshot of current files"
              >
                <Camera size={16} />
                Snapshot
              </button>
              <button
                onClick={handleViewDiffs}
                disabled={!hasSnapshot || loadingDiffs}
                className="px-4 py-2.5 border border-slate-200 hover:bg-purple-50 hover:border-purple-300 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-medium text-packer-text-muted hover:text-purple-600 transition-all flex items-center gap-2"
                title="View changes since snapshot"
              >
                {loadingDiffs ? <RefreshCw className="animate-spin" size={16} /> : <GitCompare size={16} />}
                Diff
              </button>
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating || selectedPaths.size === 0}
              className="px-8 py-3 bg-packer-blue hover:bg-[#1a252f] disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-bold tracking-wide text-white transition-all shadow-lg shadow-blue-500/20 flex items-center gap-2 transform active:scale-[0.98]"
            >
              {generating ? <RefreshCw className="animate-spin" size={18} /> : <Copy size={18} strokeWidth={2.5} />}
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
                  <CheckCircle2 className="text-packer-blue" size={24} />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-packer-grey">Prompt Generated</h3>
                  <p className="text-xs text-packer-text-muted">Ready to copy</p>
                </div>
              </div>
              <button onClick={() => setShowOutput(false)} className="hover:bg-slate-100 text-packer-text-muted hover:text-packer-grey p-2 rounded-full transition"><X size={24} /></button>
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
                <button onClick={copyToClipboard} className="px-8 py-2.5 bg-packer-blue hover:bg-[#1a252f] rounded font-bold text-white flex items-center gap-2 shadow-lg shadow-blue-500/20 transition transform active:scale-[0.98]">
                  {copied ? <CheckCircle2 size={18} strokeWidth={2.5} /> : <Copy size={18} strokeWidth={2.5} />}
                  {copied ? "Copied!" : "Copy to Clipboard"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Diff Modal */}
      {showDiffModal && (
        <div className="fixed inset-0 z-50 bg-packer-grey/20 flex items-center justify-center p-6 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-6xl h-full max-h-[90vh] rounded-lg shadow-2xl flex flex-col border border-packer-border overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-packer-border bg-white">
              <div className="flex items-center gap-3">
                <div className="bg-purple-50 p-2 rounded">
                  <GitCompare className="text-purple-600" size={24} />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-packer-grey">Changes Detected</h3>
                  <p className="text-xs text-packer-text-muted">
                    {fileDiffs.length === 0 ? "No changes since snapshot" : `${fileDiffs.length} file(s) modified`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleTakeSnapshot} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 hover:bg-blue-50 hover:border-blue-300 text-packer-text-muted hover:text-blue-600 transition-all text-xs font-medium">
                  <Camera size={14} /> Snapshot
                </button>
                <button onClick={handleClearSnapshot} className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 hover:bg-red-50 hover:border-red-300 text-packer-text-muted hover:text-red-600 transition-all text-xs font-medium">
                  <Trash2 size={14} /> Clear
                </button>
                <button onClick={() => setShowDiffModal(false)} className="hover:bg-slate-100 text-packer-text-muted hover:text-packer-grey p-2 rounded-full transition ml-2">
                  <X size={24} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {fileDiffs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-packer-text-muted">
                  <GitCompare size={48} className="mb-4 opacity-30" />
                  <p className="font-medium">No changes detected</p>
                  <p className="text-xs mt-1">Make some edits, then click "Diff" again</p>
                </div>
              ) : (
                fileDiffs.map((diff) => (
                  <div key={diff.path} className="border border-slate-200 rounded-lg overflow-hidden">
                    <div className="flex items-center justify-between bg-slate-50 px-4 py-2 border-b border-slate-200">
                      <div className="flex items-center gap-3">
                        <input type="checkbox" checked={selectedDiffPaths.has(diff.path)} onChange={() => toggleDiffSelection(diff.path)} className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500" />
                        <span className="font-bold text-sm text-packer-grey">{diff.relative_path}</span>
                        <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">+{diff.diff.filter(d => d.type === 'added').length}</span>
                        <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded">-{diff.diff.filter(d => d.type === 'removed').length}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 divide-x divide-slate-200">
                      <div className="flex flex-col">
                        <div className="bg-red-50/50 px-3 py-1.5 border-b border-slate-200"><span className="text-xs font-medium text-red-700">Previous</span></div>
                        <div className="overflow-x-auto max-h-64 overflow-y-auto bg-slate-50/50">
                          <pre className="text-xs font-mono p-3 whitespace-pre text-gray-700">{diff.previous}</pre>
                        </div>
                      </div>
                      <div className="flex flex-col">
                        <div className="bg-green-50/50 px-3 py-1.5 border-b border-slate-200"><span className="text-xs font-medium text-green-700">Current</span></div>
                        <div className="overflow-x-auto max-h-64 overflow-y-auto bg-slate-50/50">
                          <pre className="text-xs font-mono p-3 whitespace-pre text-gray-700">{diff.current}</pre>
                        </div>
                      </div>
                    </div>
                    <details className="border-t border-slate-200">
                      <summary className="px-4 py-2 text-xs font-medium text-packer-text-muted cursor-pointer hover:bg-slate-50">Show unified diff</summary>
                      <div className="max-h-48 overflow-y-auto border-t border-slate-100">
                        {diff.diff.map((line, idx) => renderDiffLine(line, idx))}
                      </div>
                    </details>
                  </div>
                ))
              )}
            </div>

            <div className="p-4 border-t border-packer-border bg-white flex justify-between items-center">
              <span className="text-xs text-packer-text-muted">{selectedDiffPaths.size} of {fileDiffs.length} changes selected</span>
              <div className="flex gap-4">
                <button onClick={() => setShowDiffModal(false)} className="px-6 py-2.5 hover:bg-slate-50 border border-packer-border rounded font-semibold text-packer-text-muted transition">Close</button>
                <button onClick={copyDiffToClipboard} disabled={selectedDiffPaths.size === 0} className="px-8 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed rounded font-bold text-white flex items-center gap-2 shadow-lg shadow-purple-500/20 transition transform active:scale-[0.98]">
                  {diffCopied ? <CheckCircle2 size={18} strokeWidth={2.5} /> : <Copy size={18} strokeWidth={2.5} />}
                  {diffCopied ? "Copied!" : "Copy Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
