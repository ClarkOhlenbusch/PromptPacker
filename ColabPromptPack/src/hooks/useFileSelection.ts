import { useState, useCallback } from "react";
import { getFileSystem, FileEntry } from "../services/FileSystem";

export interface UseFileSelectionReturn {
    files: FileEntry[];
    selectedPaths: Set<string>;
    tier1Paths: Set<string>;
    includeOutputPaths: Set<string>;
    loading: boolean;
    scanError: string | null;
    projectPath: string | null;
    handleOpenFolder: () => Promise<void>;
    toggleSelection: (entry: FileEntry) => void;
    toggleTier1: (path: string) => void;
    toggleIncludeOutput: (path: string) => void;
    handleSelectAll: () => void;
    handleSetFull: (entry: FileEntry) => void;
    handleGlobalOutputToggle: () => void;
    handleGlobalMarkdownToggle: () => void;
}

export function useFileSelection(): UseFileSelectionReturn {
    const [projectPath, setProjectPath] = useState<string | null>(null);
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);
    const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
    const [tier1Paths, setTier1Paths] = useState<Set<string>>(new Set());
    const [includeOutputPaths, setIncludeOutputPaths] = useState<Set<string>>(new Set());

    const fs = getFileSystem();

    const scanProject = useCallback(async (path: string) => {
        setLoading(true);
        setScanError(null);
        try {
            const entries = await fs.scanProject(path);

            if (entries.length === 0) {
                setScanError("No cells found. Make sure you're on a Google Colab notebook page.");
                return;
            }

            setFiles(entries);

            // Auto-select ALL files as Tier 1 (Full) by default
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
            setScanError(e instanceof Error ? e.message : "Failed to scan notebook cells");
        } finally {
            setLoading(false);
        }
    }, [fs]);

    const handleOpenFolder = useCallback(async () => {
        try {
            const selected = await fs.openFolder();
            if (selected) {
                setProjectPath(selected);
                scanProject(selected);
            }
        } catch (err) {
            console.error(err);
        }
    }, [fs, scanProject]);

    const toggleSelection = useCallback((entry: FileEntry) => {
        const newSelected = new Set(selectedPaths);
        const newTier1 = new Set(tier1Paths);

        const isCurrentlySelected = newSelected.has(entry.path);
        const shouldSelect = !isCurrentlySelected;

        const processPath = (p: string, select: boolean) => {
            if (select) {
                newSelected.add(p);
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
    }, [selectedPaths, tier1Paths, files]);

    const toggleTier1 = useCallback((path: string) => {
        if (!selectedPaths.has(path)) return;
        const newTier1 = new Set(tier1Paths);
        if (newTier1.has(path)) {
            newTier1.delete(path);
        } else {
            newTier1.add(path);
        }
        setTier1Paths(newTier1);
    }, [selectedPaths, tier1Paths]);

    const toggleIncludeOutput = useCallback((path: string) => {
        if (!selectedPaths.has(path)) return;
        const newSet = new Set(includeOutputPaths);
        if (newSet.has(path)) newSet.delete(path);
        else newSet.add(path);
        setIncludeOutputPaths(newSet);
    }, [selectedPaths, includeOutputPaths]);

    const handleSetFull = useCallback((entry: FileEntry) => {
        const newSelected = new Set(selectedPaths);
        newSelected.add(entry.path);
        setSelectedPaths(newSelected);

        const newTier1 = new Set(tier1Paths);
        newTier1.add(entry.path);
        setTier1Paths(newTier1);
    }, [selectedPaths, tier1Paths]);

    const handleSelectAll = useCallback(() => {
        if (files.length === 0) return;

        const allSelected = files.every(f => selectedPaths.has(f.path));
        const allFull = files.every(f => tier1Paths.has(f.path) || f.is_dir);

        if (!allSelected) {
            const newSelected = new Set<string>();
            files.forEach(f => newSelected.add(f.path));
            setSelectedPaths(newSelected);
            setTier1Paths(new Set());
        } else if (!allFull) {
            const newTier1 = new Set<string>();
            files.forEach(f => {
                if (!f.is_dir) newTier1.add(f.path);
            });
            setTier1Paths(newTier1);
        } else {
            setSelectedPaths(new Set());
            setTier1Paths(new Set());
        }
    }, [files, selectedPaths, tier1Paths]);

    const handleGlobalOutputToggle = useCallback(() => {
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
    }, [files, selectedPaths, includeOutputPaths]);

    const handleGlobalMarkdownToggle = useCallback(() => {
        const markdownFiles = files.filter(f => f.cellType === 'markdown');
        if (markdownFiles.length === 0) return;

        const allMarkdownSelected = markdownFiles.every(f => selectedPaths.has(f.path));

        const newSelected = new Set(selectedPaths);
        const newTier1 = new Set(tier1Paths);
        if (allMarkdownSelected) {
            // Deselect all markdown cells
            markdownFiles.forEach(f => {
                newSelected.delete(f.path);
                newTier1.delete(f.path);
            });
        } else {
            // Select all markdown cells (as full by default)
            markdownFiles.forEach(f => {
                newSelected.add(f.path);
                newTier1.add(f.path);
            });
        }
        setSelectedPaths(newSelected);
        setTier1Paths(newTier1);
    }, [files, selectedPaths, tier1Paths]);

    return {
        files,
        selectedPaths,
        tier1Paths,
        includeOutputPaths,
        loading,
        scanError,
        projectPath,
        handleOpenFolder,
        toggleSelection,
        toggleTier1,
        toggleIncludeOutput,
        handleSelectAll,
        handleSetFull,
        handleGlobalOutputToggle,
        handleGlobalMarkdownToggle,
    };
}
