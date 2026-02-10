import { useState } from "react";
import { Camera, CheckCircle2, Copy, GitCompare, Trash2, X } from "lucide-react";
import { CellDiff, DiffLine } from "../services/ColabFileSystem";

interface DiffModalProps {
    cellDiffs: CellDiff[];
    selectedDiffPaths: Set<string>;
    diffCopied: boolean;
    onClose: () => void;
    onToggleDiffSelection: (path: string) => void;
    onCopyDiffs: () => void;
    onTakeSnapshot: () => void;
    onClearHistory: () => void;
    copyFormat: "before-after" | "unified";
    onSetCopyFormat: (format: "before-after" | "unified") => void;
    hasSnapshot: boolean;
    lastSnapshotTime: number | null;
}

function renderDiffLine(line: DiffLine, index: number) {
    const bgColor =
        line.type === "added"
            ? "bg-green-100"
            : line.type === "removed"
                ? "bg-red-100"
                : "bg-white";
    const textColor =
        line.type === "added"
            ? "text-green-800"
            : line.type === "removed"
                ? "text-red-800"
                : "text-gray-700";
    const prefix =
        line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
    const lineNum = line.type === "removed" ? line.oldLineNum : line.newLineNum;

    return (
        <div key={index} className={`${bgColor} ${textColor} font-mono text-xs flex`}>
            <span className="w-10 text-right pr-2 text-gray-400 select-none border-r border-gray-200">
                {lineNum || ""}
            </span>
            <span className="w-4 text-center select-none">{prefix}</span>
            <span className="flex-1 whitespace-pre overflow-x-auto">{line.line}</span>
        </div>
    );
}

export function DiffModal({
    cellDiffs,
    selectedDiffPaths,
    diffCopied,
    onClose,
    onToggleDiffSelection,
    onCopyDiffs,
    onTakeSnapshot,
    onClearHistory,
    copyFormat,
    onSetCopyFormat,
    hasSnapshot,
    lastSnapshotTime,
}: DiffModalProps) {
    const [snapshotJustTaken, setSnapshotJustTaken] = useState(false);

    const handleSnapshotClick = () => {
        onTakeSnapshot();
        setSnapshotJustTaken(true);
        setTimeout(() => setSnapshotJustTaken(false), 2000);
    };

    return (
        <div className="fixed inset-0 z-50 bg-packer-grey/20 flex items-center justify-center p-6 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-6xl h-full max-h-[90vh] rounded-lg shadow-2xl flex flex-col border border-packer-border overflow-hidden">
                {/* Header */}
                <div className="flex justify-between items-center p-4 border-b border-packer-border bg-white">
                    <div className="flex items-center gap-3">
                        <div className="bg-purple-50 p-2 rounded">
                            <GitCompare className="text-purple-600" size={24} />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-packer-grey">
                                Changes Detected
                            </h3>
                            <div className="flex items-center gap-2">
                                <p className="text-xs text-packer-text-muted">
                                    {cellDiffs.length === 0
                                        ? "No changes detected since last snapshot"
                                        : `${cellDiffs.length} cell(s) modified`}
                                </p>
                                {hasSnapshot && (
                                    <span className="flex items-center gap-1 text-[10px] bg-blue-50 text-packer-blue px-2 py-0.5 rounded-full font-bold uppercase tracking-tight">
                                        <Camera size={10} />
                                        Baseline Active {lastSnapshotTime ? `(${new Date(lastSnapshotTime).toLocaleTimeString()})` : ""}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleSnapshotClick}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded border transition-all text-xs font-medium ${snapshotJustTaken
                                ? "bg-green-600 border-green-600 text-white"
                                : hasSnapshot
                                    ? "border-blue-200 bg-blue-50 text-packer-blue hover:bg-blue-100"
                                    : "border-slate-200 bg-white hover:bg-blue-50 hover:border-blue-300 text-packer-text-muted hover:text-blue-600"
                                }`}
                            title="Take a new snapshot (mark current state as baseline)"
                        >
                            {snapshotJustTaken ? (
                                <CheckCircle2 size={14} />
                            ) : (
                                <Camera size={14} />
                            )}
                            {snapshotJustTaken ? "Snapshot Taken!" : "Snapshot"}
                        </button>
                        <button
                            onClick={onClearHistory}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-200 bg-white hover:bg-red-50 hover:border-red-300 text-packer-text-muted hover:text-red-600 transition-all text-xs font-medium"
                            title="Clear all history"
                        >
                            <Trash2 size={14} />
                            Clear
                        </button>
                        <button
                            onClick={onClose}
                            className="hover:bg-slate-100 text-packer-text-muted hover:text-packer-grey p-2 rounded-full transition ml-2"
                        >
                            <X size={24} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {cellDiffs.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-packer-text-muted">
                            <GitCompare size={48} className="mb-4 opacity-30" />
                            <p className="font-medium">No changes detected</p>
                            <p className="text-xs mt-1">
                                Make some edits to your notebook cells, then click "Diff" again
                            </p>
                            <p className="text-xs mt-4 text-purple-600">
                                Tip: Changes are tracked automatically when you scan the notebook
                            </p>
                        </div>
                    ) : (
                        cellDiffs.map((cellDiff) => (
                            <div
                                key={cellDiff.path}
                                className="border border-slate-200 rounded-lg overflow-hidden"
                            >
                                {/* Cell header */}
                                <div className="flex items-center justify-between bg-slate-50 px-4 py-2 border-b border-slate-200">
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="checkbox"
                                            checked={selectedDiffPaths.has(cellDiff.path)}
                                            onChange={() => onToggleDiffSelection(cellDiff.path)}
                                            className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                                        />
                                        <span className="font-bold text-sm text-packer-grey">
                                            {cellDiff.relative_path}
                                        </span>
                                        <span className="text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded">
                                            +{cellDiff.diff.filter((d) => d.type === "added").length}
                                        </span>
                                        <span className="text-xs text-red-600 bg-red-50 px-2 py-0.5 rounded">
                                            -{cellDiff.diff.filter((d) => d.type === "removed").length}
                                        </span>
                                    </div>
                                    <span className="text-xs text-packer-text-muted">
                                        {new Date(cellDiff.current.timestamp).toLocaleTimeString()}
                                    </span>
                                </div>

                                {/* Side-by-side view */}
                                <div className="grid grid-cols-2 divide-x divide-slate-200">
                                    {/* Previous code */}
                                    <div className="flex flex-col">
                                        <div className="bg-red-50/50 px-3 py-1.5 border-b border-slate-200">
                                            <span className="text-xs font-medium text-red-700">
                                                Previous
                                            </span>
                                        </div>
                                        <div className="overflow-x-auto max-h-64 overflow-y-auto bg-slate-50/50">
                                            <pre className="text-xs font-mono p-3 whitespace-pre text-gray-700">
                                                {cellDiff.previous.content}
                                            </pre>
                                        </div>
                                    </div>

                                    {/* Current code */}
                                    <div className="flex flex-col">
                                        <div className="bg-green-50/50 px-3 py-1.5 border-b border-slate-200">
                                            <span className="text-xs font-medium text-green-700">
                                                Current
                                            </span>
                                        </div>
                                        <div className="overflow-x-auto max-h-64 overflow-y-auto bg-slate-50/50">
                                            <pre className="text-xs font-mono p-3 whitespace-pre text-gray-700">
                                                {cellDiff.current.content}
                                            </pre>
                                        </div>
                                    </div>
                                </div>

                                {/* Unified diff view */}
                                <details className="border-t border-slate-200">
                                    <summary className="px-4 py-2 text-xs font-medium text-packer-text-muted cursor-pointer hover:bg-slate-50">
                                        Show unified diff
                                    </summary>
                                    <div className="max-h-48 overflow-y-auto border-t border-slate-100">
                                        {cellDiff.diff.map((line, lineIdx) =>
                                            renderDiffLine(line, lineIdx)
                                        )}
                                    </div>
                                </details>
                            </div>
                        ))
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-packer-border bg-white flex justify-between items-center">
                    <span className="text-xs text-packer-text-muted">
                        {selectedDiffPaths.size} of {cellDiffs.length} changes selected
                    </span>
                    <div className="flex items-center gap-4">
                        <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                            <button
                                onClick={() => onSetCopyFormat("before-after")}
                                className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${copyFormat === "before-after"
                                    ? "bg-white text-packer-blue shadow-sm"
                                    : "text-packer-text-muted hover:text-packer-grey"
                                    }`}
                            >
                                Before/After
                            </button>
                            <button
                                onClick={() => onSetCopyFormat("unified")}
                                className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all ${copyFormat === "unified"
                                    ? "bg-white text-packer-blue shadow-sm"
                                    : "text-packer-text-muted hover:text-packer-grey"
                                    }`}
                            >
                                Unified Diff
                            </button>
                        </div>

                        <button
                            onClick={onClose}
                            className="px-6 py-2.5 hover:bg-slate-50 border border-packer-border rounded font-semibold text-packer-text-muted transition"
                        >
                            Close
                        </button>
                        <button
                            onClick={onCopyDiffs}
                            disabled={selectedDiffPaths.size === 0}
                            className="px-8 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed rounded font-bold text-white flex items-center gap-2 shadow-lg shadow-purple-500/20 transition transform active:scale-[0.98]"
                        >
                            {diffCopied ? (
                                <CheckCircle2 size={18} strokeWidth={2.5} />
                            ) : (
                                <Copy size={18} strokeWidth={2.5} />
                            )}
                            {diffCopied ? "Copied!" : "Copy Changes"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
