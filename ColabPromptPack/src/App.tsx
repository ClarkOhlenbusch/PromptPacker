import { useState, useEffect } from "react";
import { getFileSystem } from "./services/FileSystem";
import { generatePrompt } from "./utils/promptGenerator";
import { generateAutoPreamble } from "./utils/autoPreamble";
import { Copy, FileText, RefreshCw, X, Wand2, FolderOpen, ListChecks, Settings, Terminal, GitCompare } from "lucide-react";
import { FileTreeItem } from "./components/FileTreeItem";
import { SettingsModal } from "./components/SettingsModal";
import { OutputModal } from "./components/OutputModal";
import { DiffModal } from "./components/DiffModal";
import { PackSummary } from "./components/PackSummary";
import { useFileSelection } from "./hooks/useFileSelection";
import { useSettings } from "./hooks/useSettings";
import { useDiffs } from "./hooks/useDiffs";
import { useResizablePanel } from "./hooks/useResizablePanel";
import "./App.css";

export default function App() {
  const fs = getFileSystem();

  // Custom hooks
  const fileSelection = useFileSelection();
  const settings = useSettings();
  const diffs = useDiffs(fs);
  const { leftPanelWidth, isResizing, handleMouseDown } = useResizablePanel();

  // Local UI state
  const [preamble, setPreamble] = useState("");
  const [goal, setGoal] = useState("");
  const [generatedPrompt, setGeneratedPrompt] = useState<string | null>(null);
  const [showOutput, setShowOutput] = useState(false);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [includeFileTree, setIncludeFileTree] = useState(true);

  // Close Overlay Logic
  const handleCloseOverlay = () => {
    window.parent.postMessage({ type: "CLOSE_PROMPTPACK" }, "*");
  };

  // Auto-scan on mount
  useEffect(() => {
    fileSelection.handleOpenFolder();
    // Try to focus the window so local keys work immediately
    window.focus();
  }, []);

  // Global ESC key listener
  useEffect(() => {
    const handleEscapeAction = () => {
      // Priority: Close modals first, then close application
      if (diffs.showDiffModal) {
        diffs.setShowDiffModal(false);
      } else if (showOutput) {
        setShowOutput(false);
      } else if (settings.showSettings) {
        settings.setShowSettings(false);
        if (settings.recordingShortcutType) {
          settings.setRecordingShortcutType(null);
        }
      } else {
        handleCloseOverlay();
      }
    };

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleEscapeAction();
      }
    };

    const handleMessage = (e: MessageEvent) => {
      if (e.data.type === "EXTERNAL_ESCAPE") {
        handleEscapeAction();
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
      window.removeEventListener("message", handleMessage);
    };
  }, [diffs, showOutput, settings, handleCloseOverlay]);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const prompt = await generatePrompt(
        fileSelection.files,
        fileSelection.selectedPaths,
        fileSelection.tier1Paths,
        fileSelection.includeOutputPaths,
        preamble,
        goal,
        includeFileTree
      );
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
      const autoPreamble = await generateAutoPreamble(fileSelection.files);
      if (autoPreamble) {
        setPreamble((prev) =>
          prev ? prev + "\n\n" + autoPreamble : autoPreamble
        );
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
      window.parent.postMessage(
        { type: "COPY_TO_CLIPBOARD", text: generatedPrompt },
        "*"
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Copy failed", e);
    }
  };

  return (
    <div className="h-screen w-screen bg-white text-packer-grey flex flex-col font-sans relative selection:bg-packer-blue selection:text-white">
      {/* Overlay Close Button */}
      <div className="absolute top-0 right-0 p-2 z-50">
        <button
          onClick={handleCloseOverlay}
          className="bg-white/80 hover:bg-red-50 text-packer-text-muted hover:text-red-500 p-1.5 rounded-full shadow-sm border border-slate-200 transition-all"
          title="Close PromptPack"
        >
          <X size={20} strokeWidth={2.5} />
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Pane: File Explorer */}
        <div
          style={{ width: leftPanelWidth }}
          className="flex-shrink-0 flex flex-col bg-white border-r border-packer-border"
        >
          {/* Header */}
          <div className="px-3 py-2 flex flex-col gap-2 border-b border-packer-border bg-slate-50/50">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-packer-text-muted uppercase tracking-wider whitespace-nowrap">
                Files
              </span>
              <span className="text-xs font-mono text-packer-blue bg-blue-50 px-2 py-0.5 rounded">
                {fileSelection.files.length}
              </span>
            </div>

            <div className="flex items-center gap-1 flex-wrap">
              <button
                onClick={fileSelection.handleOpenFolder}
                className="flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 bg-white hover:bg-blue-50 hover:border-packer-blue/30 text-packer-text-muted hover:text-packer-blue transition-all shadow-sm active:scale-95"
              >
                <FolderOpen size={12} strokeWidth={2.5} />
                <span className="text-[10px] font-bold uppercase tracking-tight">
                  {fileSelection.projectPath ? "Refresh" : "Scan"}
                </span>
              </button>

              {fileSelection.files.length > 0 && (
                <>
                  <button
                    onClick={fileSelection.handleSelectAll}
                    className="flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 bg-white hover:bg-blue-50 hover:border-packer-blue/30 text-packer-text-muted hover:text-packer-blue transition-all shadow-sm active:scale-95"
                    title="Cycle: Select All (Sum) -> Select All (Full) -> Clear"
                  >
                    <ListChecks size={12} strokeWidth={2.5} />
                    <span className="text-[10px] font-bold uppercase tracking-tight">
                      All
                    </span>
                  </button>

                  <button
                    onClick={fileSelection.handleGlobalOutputToggle}
                    className={`flex items-center gap-1 px-2 py-0.5 rounded border transition-all shadow-sm active:scale-95
                      ${fileSelection.files
                        .filter(
                          (f) =>
                            fileSelection.selectedPaths.has(f.path) &&
                            !f.is_dir
                        )
                        .every((f) =>
                          fileSelection.includeOutputPaths.has(f.path)
                        ) && fileSelection.selectedPaths.size > 0
                        ? "bg-amber-100 border-amber-500 text-amber-700"
                        : "bg-white border-slate-200 text-packer-text-muted hover:border-amber-300 hover:text-amber-600"
                      }`}
                    title="Toggle Output for All Selected Files"
                  >
                    <Terminal size={12} strokeWidth={2.5} />
                    <span className="text-[10px] font-bold uppercase tracking-tight">
                      Out
                    </span>
                  </button>

                  <button
                    onClick={diffs.handleViewDiffs}
                    disabled={diffs.loadingDiffs}
                    className="flex items-center gap-1 px-2 py-0.5 rounded border border-slate-200 bg-white hover:bg-purple-50 hover:border-purple-300 text-packer-text-muted hover:text-purple-600 transition-all shadow-sm active:scale-95"
                    title="View Changes (Diff)"
                  >
                    {diffs.loadingDiffs ? (
                      <RefreshCw size={12} className="animate-spin" />
                    ) : (
                      <GitCompare size={12} strokeWidth={2.5} />
                    )}
                    <span className="text-[10px] font-bold uppercase tracking-tight">
                      Diff
                    </span>
                  </button>
                </>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {fileSelection.scanError && !fileSelection.loading && (
              <div className="flex flex-col items-center justify-center h-full text-center p-8 gap-4">
                <div className="bg-red-50 p-4 rounded-full">
                  <X size={28} className="text-red-500" />
                </div>
                <div>
                  <p className="font-bold text-sm text-gray-800">Scan Failed</p>
                  <p className="text-xs text-gray-600 mt-1 max-w-[200px]">
                    {fileSelection.scanError}
                  </p>
                </div>
                <button
                  onClick={fileSelection.handleOpenFolder}
                  className="text-xs font-bold text-packer-blue hover:underline"
                >
                  Try Again
                </button>
              </div>
            )}

            {fileSelection.files.length === 0 &&
              !fileSelection.loading &&
              !fileSelection.scanError && (
                <button
                  onClick={fileSelection.handleOpenFolder}
                  className="w-full h-full flex flex-col items-center justify-center text-packer-text-muted p-8 text-center gap-4 group hover:bg-slate-50/80 transition-all"
                >
                  <div className="bg-slate-100 p-5 rounded-full group-hover:bg-blue-50 group-hover:text-packer-blue transition-all transform group-hover:scale-110 shadow-sm group-hover:shadow-md">
                    <FolderOpen size={36} strokeWidth={1.5} />
                  </div>
                  <div className="transform transition-transform group-hover:translate-y-1">
                    <p className="font-bold text-sm text-packer-grey group-hover:text-packer-blue transition-colors">
                      No project loaded
                    </p>
                    <p className="text-xs mt-1 opacity-70 group-hover:opacity-100">
                      Click to open a folder
                    </p>
                  </div>
                </button>
              )}

            {fileSelection.loading && (
              <div className="flex items-center justify-center p-8 text-packer-blue gap-3">
                <RefreshCw className="animate-spin" size={20} />
                <span className="text-sm font-medium">Scanning...</span>
              </div>
            )}

            <div className="py-2">
              {fileSelection.files.map((entry) => (
                <FileTreeItem
                  key={entry.path}
                  entry={entry}
                  depth={entry.relative_path.split("/").length - 1}
                  selectedPaths={fileSelection.selectedPaths}
                  tier1Paths={fileSelection.tier1Paths}
                  includeOutputPaths={fileSelection.includeOutputPaths}
                  onToggle={fileSelection.toggleSelection}
                  onSetFull={fileSelection.handleSetFull}
                  onToggleTier1={(e) => fileSelection.toggleTier1(e.path)}
                  onToggleOutput={(e) =>
                    fileSelection.toggleIncludeOutput(e.path)
                  }
                />
              ))}
            </div>
          </div>
        </div>

        {/* Resize Handle */}
        <div
          onMouseDown={handleMouseDown}
          className={`w-1 flex-shrink-0 cursor-col-resize hover:bg-packer-blue/30 transition-colors relative group ${isResizing ? "bg-packer-blue/50" : "bg-packer-border"
            }`}
        >
          <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <div className="w-1 h-8 rounded-full bg-slate-300"></div>
          </div>
        </div>

        {/* Right Pane: Configuration */}
        <div className="flex-1 flex flex-col bg-white min-w-0">
          <div className="flex-1 overflow-y-auto p-10">
            <div className="max-w-3xl mx-auto space-y-10">
              {/* Context Section */}
              <div className="space-y-6">
                <div className="flex items-center gap-3 pb-2 border-b border-packer-border">
                  <div className="bg-blue-50 p-1.5 rounded text-packer-blue">
                    <FileText size={20} strokeWidth={2} />
                  </div>
                  <h2 className="text-lg font-bold text-packer-grey">
                    Context & Goal
                  </h2>
                </div>

                <div className="grid gap-8">
                  <div className="space-y-3">
                    <div className="flex justify-between items-end">
                      <label className="text-sm font-bold text-packer-grey uppercase tracking-wide text-[11px]">
                        Preamble / Context
                      </label>
                      <button
                        onClick={handleAutoFill}
                        disabled={generating}
                        className="text-[10px] font-bold text-packer-blue hover:text-packer-blue-dark flex items-center gap-1 uppercase tracking-wide transition-colors"
                      >
                        <Wand2 size={12} /> Auto-Fill
                      </button>
                    </div>
                    <textarea
                      className="w-full bg-white border border-packer-border rounded p-4 text-sm text-packer-grey focus:border-packer-blue focus:ring-1 focus:ring-packer-blue focus:outline-none min-h-[120px] placeholder:text-gray-300 transition-all shadow-subtle"
                      placeholder="Describe your project stack, conventions, or specific requirements..."
                      value={preamble}
                      onChange={(e) => setPreamble(e.target.value)}
                    />
                  </div>

                  <div className="space-y-3">
                    <label className="text-sm font-bold text-packer-grey uppercase tracking-wide text-[11px]">
                      Task / Query
                    </label>
                    <textarea
                      className="w-full bg-white border border-packer-border rounded p-4 text-sm text-packer-grey focus:border-packer-blue focus:ring-1 focus:ring-packer-blue focus:outline-none min-h-[100px] placeholder:text-gray-300 transition-all shadow-subtle"
                      placeholder="What should the AI do with this context?"
                      value={goal}
                      onChange={(e) => setGoal(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Pack Summary Card */}
              <PackSummary
                files={fileSelection.files}
                selectedPaths={fileSelection.selectedPaths}
                tier1Paths={fileSelection.tier1Paths}
                includeFileTree={includeFileTree}
                preamble={preamble}
                goal={goal}
                onToggleFileTree={() => setIncludeFileTree(!includeFileTree)}
              />
            </div>
          </div>

          {/* Action Footer */}
          <div className="p-6 border-t border-packer-border bg-white flex justify-between items-center gap-4 z-10">
            <button
              onClick={() => settings.setShowSettings(true)}
              className="px-4 py-2.5 flex items-center gap-2 text-packer-text-muted hover:bg-slate-50 hover:text-packer-grey rounded-md transition-colors border border-packer-border shadow-sm active:scale-95"
              title="Settings"
            >
              <Settings size={18} />
              <span className="text-xs font-bold uppercase tracking-wider">
                Settings
              </span>
            </button>

            <button
              onClick={handleGenerate}
              disabled={generating || fileSelection.selectedPaths.size === 0}
              className="px-8 py-3 bg-packer-blue hover:bg-[#1a252f] disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm font-bold tracking-wide text-white transition-all shadow-lg shadow-blue-500/20 flex items-center gap-2 transform active:scale-[0.98]"
            >
              {generating ? (
                <RefreshCw className="animate-spin" size={18} />
              ) : (
                <Copy size={18} strokeWidth={2.5} />
              )}
              GENERATE PROMPT
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      {settings.showSettings && (
        <SettingsModal
          quickCopyShortcut={settings.quickCopyShortcut}
          openAppShortcut={settings.openAppShortcut}
          recordingShortcutType={settings.recordingShortcutType}
          quickCopyIncludesOutput={settings.quickCopyIncludesOutput}
          onClose={() => settings.setShowSettings(false)}
          onKeyDown={settings.handleKeyDown}
          onStartRecording={settings.setRecordingShortcutType}
          onToggleQuickCopyOutput={settings.handleToggleQuickCopyOutput}
        />
      )}

      {showOutput && (
        <OutputModal
          generatedPrompt={generatedPrompt}
          copied={copied}
          onClose={() => setShowOutput(false)}
          onCopy={copyToClipboard}
        />
      )}

      {diffs.showDiffModal && (
        <DiffModal
          cellDiffs={diffs.cellDiffs}
          selectedDiffPaths={diffs.selectedDiffPaths}
          diffCopied={diffs.diffCopied}
          onClose={() => diffs.setShowDiffModal(false)}
          onToggleDiffSelection={diffs.toggleDiffSelection}
          onCopyDiffs={diffs.copyDiffToClipboard}
          onTakeSnapshot={diffs.handleTakeSnapshot}
          onClearHistory={diffs.handleClearHistory}
          copyFormat={diffs.copyFormat}
          onSetCopyFormat={diffs.setCopyFormat}
          hasSnapshot={diffs.hasSnapshot}
          lastSnapshotTime={diffs.lastSnapshotTime}
        />
      )}
    </div>
  );
}
