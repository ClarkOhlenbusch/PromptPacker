import { useState, useCallback } from "react";
import { ColabFileSystem, CellDiff } from "../services/ColabFileSystem";
import { IFileSystem } from "../services/FileSystem";

export interface UseDiffsReturn {
    cellDiffs: CellDiff[];
    showDiffModal: boolean;
    setShowDiffModal: (show: boolean) => void;
    loadingDiffs: boolean;
    selectedDiffPaths: Set<string>;
    copyFormat: "before-after" | "unified";
    setCopyFormat: (format: "before-after" | "unified") => void;
    diffCopied: boolean;
    handleViewDiffs: () => Promise<void>;
    handleTakeSnapshot: () => Promise<void>;
    handleClearHistory: () => Promise<void>;
    toggleDiffSelection: (path: string) => void;
    generateDiffPrompt: () => string;
    copyDiffToClipboard: () => Promise<void>;
    hasSnapshot: boolean;
    lastSnapshotTime: number | null;
}

export function useDiffs(fs: IFileSystem): UseDiffsReturn {
    const [cellDiffs, setCellDiffs] = useState<CellDiff[]>([]);
    const [showDiffModal, setShowDiffModal] = useState(false);
    const [loadingDiffs, setLoadingDiffs] = useState(false);
    const [selectedDiffPaths, setSelectedDiffPaths] = useState<Set<string>>(new Set());
    const [copyFormat, setCopyFormat] = useState<"before-after" | "unified">("before-after");
    const [diffCopied, setDiffCopied] = useState(false);
    const [hasSnapshot, setHasSnapshot] = useState(false);
    const [lastSnapshotTime, setLastSnapshotTime] = useState<number | null>(null);

    const refreshSnapshotStatus = useCallback(async () => {
        const colabFs = fs as ColabFileSystem;
        if (!colabFs.getSnapshotStatus) return;
        const status = await colabFs.getSnapshotStatus();
        if (status) {
            setHasSnapshot(status.cellCount > 0);
            setLastSnapshotTime(status.timestamp);
        }
    }, [fs]);

    const handleViewDiffs = useCallback(async () => {
        setLoadingDiffs(true);
        try {
            const colabFs = fs as ColabFileSystem;
            const diffs = await colabFs.getDiffs();
            setCellDiffs(diffs);
            // Auto-select all diffs
            const allPaths = new Set(diffs.map(d => d.path));
            setSelectedDiffPaths(allPaths);
            setShowDiffModal(true);
        } catch (e) {
            console.error("Failed to get diffs", e);
            alert("Failed to get changes. Make sure you have made some edits after the initial scan.");
        } finally {
            setLoadingDiffs(false);
            refreshSnapshotStatus();
        }
    }, [fs]);

    const handleTakeSnapshot = useCallback(async () => {
        try {
            const colabFs = fs as ColabFileSystem;
            const success = await colabFs.takeSnapshot();
            if (success) {
                refreshSnapshotStatus();
            }
        } catch (e) {
            console.error("Failed to take snapshot", e);
        }
    }, [fs]);

    const handleClearHistory = useCallback(async () => {
        try {
            const colabFs = fs as ColabFileSystem;
            await colabFs.clearHistory();
            setCellDiffs([]);
            setHasSnapshot(false);
            setLastSnapshotTime(null);
        } catch (e) {
            console.error("Failed to clear history", e);
        }
    }, [fs]);

    const toggleDiffSelection = useCallback((path: string) => {
        const newSet = new Set(selectedDiffPaths);
        if (newSet.has(path)) {
            newSet.delete(path);
        } else {
            newSet.add(path);
        }
        setSelectedDiffPaths(newSet);
    }, [selectedDiffPaths]);

    const generateDiffPrompt = useCallback((): string => {
        const selectedDiffs = cellDiffs.filter(d => selectedDiffPaths.has(d.path));
        if (selectedDiffs.length === 0) return "";

        let output = "### CHANGES MADE ###\n\n";
        output += `The following ${selectedDiffs.length} cell(s) have been modified:\n\n`;

        selectedDiffs.forEach(cellDiff => {
            output += `---\n\n`;
            output += `#### ${cellDiff.relative_path} ####\n\n`;

            if (copyFormat === "unified") {
                output += "```diff\n";
                cellDiff.diff.forEach(line => {
                    if (line.type === "added") output += `+ ${line.line}\n`;
                    else if (line.type === "removed") output += `- ${line.line}\n`;
                    else output += `  ${line.line}\n`;
                });
                output += "```\n\n";
            } else {
                output += `**Previous Code:**\n`;
                output += "```python\n";
                output += cellDiff.previous.content;
                output += "\n```\n\n";

                output += `**Updated Code:**\n`;
                output += "```python\n";
                output += cellDiff.current.content;
                output += "\n```\n\n";
            }

            const addedLines = cellDiff.diff.filter(d => d.type === "added").length;
            const removedLines = cellDiff.diff.filter(d => d.type === "removed").length;
            output += `*Changes: +${addedLines} lines, -${removedLines} lines*\n\n`;
        });

        return output;
    }, [cellDiffs, selectedDiffPaths, copyFormat]);

    const copyDiffToClipboard = useCallback(async () => {
        const diffPrompt = generateDiffPrompt();
        if (!diffPrompt) return;
        try {
            window.parent.postMessage({ type: "COPY_TO_CLIPBOARD", text: diffPrompt }, "*");
            setDiffCopied(true);
            setTimeout(() => setDiffCopied(false), 2000);
        } catch (e) {
            console.error("Copy failed", e);
        }
    }, [generateDiffPrompt]);

    return {
        cellDiffs,
        showDiffModal,
        setShowDiffModal,
        loadingDiffs,
        selectedDiffPaths,
        copyFormat,
        setCopyFormat,
        diffCopied,
        handleViewDiffs,
        handleTakeSnapshot,
        handleClearHistory,
        toggleDiffSelection,
        generateDiffPrompt,
        copyDiffToClipboard,
        hasSnapshot,
        lastSnapshotTime,
    };
}
