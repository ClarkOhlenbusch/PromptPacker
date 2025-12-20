import { CheckCircle2, FileCode, FolderOpen } from "lucide-react";
import { MouseEvent } from "react";

interface FileEntry {
  path: string;
  relative_path: string;
  is_dir: boolean;
  size: number;
}

interface FileTreeItemProps {
  entry: FileEntry;
  depth: number;
  selectedPaths: Set<string>;
  tier1Paths: Set<string>;
  onToggle: (entry: FileEntry) => void;
  onSetFull: (entry: FileEntry) => void;
  onToggleTier1: (entry: FileEntry) => void;
}

export const FileTreeItem = ({ entry, depth, selectedPaths, tier1Paths, onToggle, onSetFull, onToggleTier1 }: FileTreeItemProps) => {
  const isSelected = selectedPaths.has(entry.path);
  const isTier1 = tier1Paths.has(entry.path);

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

  return (
    <div 
      className={`group flex items-center py-2 px-3 cursor-pointer transition-colors border-l-4 select-none
        ${isSelected 
          ? 'bg-blue-100/60 border-[#0069C3]' 
          : 'border-transparent hover:bg-slate-50'
        }`}
      style={{ paddingLeft: `${depth * 1.5 + 0.75}rem` }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      <div className="flex-1 flex items-center gap-3 overflow-hidden">
         {/* Custom Checkbox */}
         <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors shadow-sm
            ${isSelected ? 'bg-[#0069C3] border-[#0069C3]' : 'bg-white border-gray-300 group-hover:border-[#0069C3]'}`}>
            {isSelected && <CheckCircle2 size={12} className="text-white" strokeWidth={3} />}
         </div>

         {entry.is_dir ? 
           <FolderOpen size={18} className={`${isSelected ? 'text-[#0069C3]' : 'text-slate-400 group-hover:text-slate-600'} transition-colors`} strokeWidth={2}/> : 
           <FileCode size={18} className={`${isSelected ? 'text-[#0069C3]' : 'text-slate-400 group-hover:text-slate-600'} transition-colors`} strokeWidth={2}/>
         }
         
         <span className={`text-sm truncate font-bold ${isSelected ? 'text-slate-900' : 'text-slate-600'}`}>
           {entry.relative_path.split('/').pop()}
         </span>
      </div>
      
      {!entry.is_dir && isSelected && (
         <button 
           onClick={handleBadgeClick}
           className={`ml-2 text-[10px] px-2 py-0.5 rounded border-2 font-black tracking-wide uppercase transition-all shadow-sm
             ${isTier1 
               ? 'bg-[#0069C3] text-white border-[#0069C3]' 
               : 'bg-white text-slate-900 border-slate-300 hover:border-slate-400'
             }`}
         >
           {isTier1 ? "FULL" : "SUM"}
         </button>
      )}
    </div>
  );
};
