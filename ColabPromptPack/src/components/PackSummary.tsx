import { FileEntry } from "../services/FileSystem";
import { countTokens } from "../utils/tokenizer";

interface PackSummaryProps {
    files: FileEntry[];
    selectedPaths: Set<string>;
    tier1Paths: Set<string>;
    includeFileTree: boolean;
    preamble: string;
    goal: string;
    onToggleFileTree: () => void;
}

export function PackSummary({
    files,
    selectedPaths,
    tier1Paths,
    includeFileTree,
    preamble,
    goal,
    onToggleFileTree,
}: PackSummaryProps) {
    const estimatedTokens = (() => {
        const selectedFiles = files.filter(
            (f) => selectedPaths.has(f.path) && !f.is_dir && f.content
        );
        const fullFiles = selectedFiles.filter((f) => tier1Paths.has(f.path));
        const skeletonFiles = selectedFiles.filter((f) => !tier1Paths.has(f.path));

        // Overhead: preamble, goal, file tree, headers
        let overhead = "";
        if (preamble.trim()) overhead += "PREAMBLE\n" + preamble + "\n\n";
        if (includeFileTree && files.length > 0) {
            overhead += "TREE\n";
            files.forEach((f) => {
                overhead += `├─ ${f.relative_path} (${f.size} B, ${f.line_count || 0} lines)\n`;
            });
            overhead += "\n\n";
        }
        selectedFiles.forEach((f) => {
            overhead += `FILE ${f.relative_path} ${tier1Paths.has(f.path) ? "FULL" : "SKELETON"}\n\nEND_FILE\n\n`;
        });
        if (goal.trim()) overhead += "GOAL\n" + goal + "\n";

        const overheadTokens = countTokens(overhead);
        const fullTokens = fullFiles.reduce(
            (acc, f) => acc + countTokens(f.content!),
            0
        );
        const skeletonTokens = skeletonFiles.reduce(
            (acc, f) => acc + Math.round(countTokens(f.content!) * 0.3),
            0
        );

        return (overheadTokens + fullTokens + skeletonTokens).toLocaleString();
    })();

    return (
        <div className="rounded-lg border border-packer-border p-6 shadow-subtle bg-slate-50/30">
            <div className="flex items-center justify-between mb-6">
                <h3 className="text-sm font-bold text-packer-grey">Pack Summary</h3>
                <div className="flex items-center gap-2">
                    <button
                        id="file-tree-toggle"
                        onClick={onToggleFileTree}
                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-packer-blue focus:ring-offset-2 ${includeFileTree
                                ? "bg-packer-blue shadow-inner shadow-blue-900/20"
                                : "bg-slate-200 shadow-inner shadow-black/5"
                            }`}
                    >
                        <span className="sr-only">Toggle file tree</span>
                        <span
                            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm ring-0 transition-transform duration-200 ease-in-out ${includeFileTree ? "translate-x-4.5" : "translate-x-1"
                                }`}
                        />
                    </button>
                    <label
                        className="text-xs font-bold text-packer-grey uppercase tracking-wide cursor-pointer select-none transition-colors"
                        htmlFor="file-tree-toggle"
                    >
                        File Tree
                    </label>
                </div>
            </div>

            <div className="grid grid-cols-3 gap-8">
                <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold text-packer-text-muted uppercase">
                        Files Selected
                    </span>
                    <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-bold text-packer-grey">
                            {selectedPaths.size}
                        </span>
                        <span className="text-xs text-packer-text-muted">total</span>
                    </div>
                </div>

                <div className="flex flex-col gap-1">
                    <span className="text-[11px] font-bold text-packer-text-muted uppercase">
                        Context Type
                    </span>
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
                    <span className="text-[11px] font-bold text-packer-text-muted uppercase">
                        Estimated Tokens
                    </span>
                    <span className="text-2xl font-bold text-packer-blue font-mono">
                        {estimatedTokens}
                    </span>
                </div>
            </div>
        </div>
    );
}
