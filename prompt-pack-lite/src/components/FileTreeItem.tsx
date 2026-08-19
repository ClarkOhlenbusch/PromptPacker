import { CheckCircle2, ChevronDown, ChevronRight, FileCode, Folder, FolderOpen } from "lucide-react";
import { MouseEvent } from "react";
import { FileEntry } from "../services/FileSystem";

interface FileTreeItemProps {
  entry: FileEntry;
  depth: number;
  selectedPaths: Set<string>;
  tier1Paths: Set<string>;
  onToggle: (entry: FileEntry) => void;
  onSetFull: (entry: FileEntry) => void;
  onToggleTier1: (entry: FileEntry) => void;
  isCollapsed: boolean;
  onToggleCollapse: (entry: FileEntry) => void;
}

export const FileTreeItem = ({ entry, depth, selectedPaths, tier1Paths, onToggle, onSetFull, onToggleTier1, isCollapsed, onToggleCollapse }: FileTreeItemProps) => {
  const isSelected = selectedPaths.has(entry.path);
  const isTier1 = tier1Paths.has(entry.path);
  const name = entry.relative_path.split('/').pop();

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

  // The chevron must not fall through to the row, which would toggle the
  // selection of the whole directory.
  const handleChevronClick = (e: MouseEvent) => {
    e.stopPropagation();
    onToggleCollapse(entry);
  };

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
      <div className="flex-1 flex items-center gap-3">
        {/* Collapse chevron on directories, an aligning spacer on files */}
        {entry.is_dir ? (
          <button
            onClick={handleChevronClick}
            aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${name}`}
            title={`${isCollapsed ? "Expand" : "Collapse"} ${name}`}
            className="shrink-0 text-slate-400 hover:text-packer-blue transition-colors"
          >
            {isCollapsed
              ? <ChevronRight size={14} strokeWidth={2.5} />
              : <ChevronDown size={14} strokeWidth={2.5} />
            }
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}

        {/* Custom Checkbox */}
        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors shadow-sm
            ${isSelected ? 'bg-packer-blue border-packer-blue' : 'bg-white border-gray-300 group-hover:border-packer-blue'}`}>
          {isSelected && <CheckCircle2 size={12} className="text-white" strokeWidth={3} />}
        </div>

        {entry.is_dir ?
          (isCollapsed
            ? <Folder size={18} className={`${isSelected ? 'text-packer-blue' : 'text-slate-400 group-hover:text-slate-600'} transition-colors`} strokeWidth={2} />
            : <FolderOpen size={18} className={`${isSelected ? 'text-packer-blue' : 'text-slate-400 group-hover:text-slate-600'} transition-colors`} strokeWidth={2} />
          ) :
          <FileCode size={18} className={`${isSelected ? 'text-packer-blue' : 'text-slate-400 group-hover:text-slate-600'} transition-colors`} strokeWidth={2} />
        }

        <span className={`text-sm whitespace-nowrap font-bold ${isSelected ? 'text-slate-900' : 'text-slate-600'}`}>
          {name}
        </span>
      </div>

      {!entry.is_dir && isSelected && (
        <button
          onClick={handleBadgeClick}
          className={`ml-2 text-[10px] px-2 py-0.5 rounded border-2 font-black tracking-wide uppercase transition-all shadow-sm
             ${isTier1
              ? 'bg-packer-blue text-white border-packer-blue'
              : 'bg-white text-slate-900 border-slate-300 hover:border-slate-400'
            }`}
        >
          {isTier1 ? "FULL" : "SKEL"}
        </button>
      )}
    </div>
  );
};
