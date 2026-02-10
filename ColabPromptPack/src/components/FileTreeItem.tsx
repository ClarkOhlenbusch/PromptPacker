import { CheckCircle2, FileCode, FolderOpen, Terminal } from "lucide-react";
import { MouseEvent } from "react";
import { FileEntry } from "../services/FileSystem";

interface FileTreeItemProps {
  entry: FileEntry;
  depth: number;
  selectedPaths: Set<string>;
  tier1Paths: Set<string>;
  includeOutputPaths: Set<string>;
  onToggle: (entry: FileEntry) => void;
  onSetFull: (entry: FileEntry) => void;
  onToggleTier1: (entry: FileEntry) => void;
  onToggleOutput: (entry: FileEntry) => void;
}

export const FileTreeItem = ({ entry, depth, selectedPaths, tier1Paths, includeOutputPaths, onToggle, onSetFull, onToggleTier1, onToggleOutput }: FileTreeItemProps) => {
  const isSelected = selectedPaths.has(entry.path);
  const isTier1 = tier1Paths.has(entry.path);
  const includeOutput = includeOutputPaths.has(entry.path);

  const handleDoubleClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (entry.is_dir) return;
    onSetFull(entry);
  };

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    onToggle(entry);
  };

  const handleBadgeClick = (e: MouseEvent) => {
    e.stopPropagation();
    onToggleTier1(entry);
  };

  const handleOutputClick = (e: MouseEvent) => {
    e.stopPropagation();
    onToggleOutput(entry);
  }

  return (
    <div
      className={`group flex items-center py-2 px-3 cursor-pointer transition-colors border-l-4 select-none
        ${isSelected
          ? 'bg-blue-100/60 border-packer-blue'
          : 'border-transparent hover:bg-slate-50'
        }`}
      style={{ paddingLeft: `${depth * 1.5 + 0.75}rem` }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <div className="flex-1 flex items-center gap-3 overflow-hidden">
        {/* Custom Checkbox */}
        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors shadow-sm
            ${isSelected ? 'bg-packer-blue border-packer-blue' : 'bg-white border-gray-300 group-hover:border-packer-blue'}`}>
          {isSelected && <CheckCircle2 size={12} className="text-white" strokeWidth={3} />}
        </div>

        {entry.is_dir ?
          <FolderOpen size={18} className={`${isSelected ? 'text-packer-blue' : 'text-slate-400 group-hover:text-slate-600'} transition-colors`} strokeWidth={2} /> :
          <FileCode size={18} className={`${isSelected ? 'text-packer-blue' : 'text-slate-400 group-hover:text-slate-600'} transition-colors`} strokeWidth={2} />
        }

        <span className={`text-sm truncate font-bold ${isSelected ? 'text-slate-900' : 'text-slate-600'}`}>
          {entry.relative_path.split('/').pop()}
        </span>
      </div>

      {!entry.is_dir && isSelected && (
        <div className="flex gap-1 ml-2">
          <button
            onClick={handleOutputClick}
            className={`w-6 h-6 rounded flex items-center justify-center border transition-all shadow-sm
                 ${includeOutput
                ? 'bg-amber-100 border-amber-500 text-amber-700'
                : 'bg-white text-slate-300 border-slate-200 hover:border-slate-300 hover:text-slate-400'}`}
            title="Include Cell Output"
          >
            <Terminal size={12} strokeWidth={includeOutput ? 2.5 : 2} />
          </button>

          <button
            onClick={handleBadgeClick}
            className={`text-[10px] px-2 py-0.5 rounded border-2 font-black tracking-wide uppercase transition-all shadow-sm
                 ${isTier1
                ? 'bg-packer-blue text-white border-packer-blue'
                : 'bg-white text-slate-900 border-slate-300 hover:border-slate-400'
              }`}
          >
            {isTier1 ? "FULL" : "SUM"}
          </button>
        </div>
      )}
    </div>
  );
};
