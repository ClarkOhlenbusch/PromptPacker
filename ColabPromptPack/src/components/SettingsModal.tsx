import { Settings, Keyboard, Terminal, FileText, ArrowUp, ArrowDown, X } from "lucide-react";
import { ShortcutConfig } from "../hooks/useSettings";

interface SettingsModalProps {
    quickCopyShortcut: ShortcutConfig | null;
    openAppShortcut: ShortcutConfig | null;
    copyAboveShortcut: ShortcutConfig | null;
    copyBelowShortcut: ShortcutConfig | null;
    recordingShortcutType: 'quickCopy' | 'openApp' | 'copyAbove' | 'copyBelow' | null;
    quickCopyIncludesOutput: boolean;
    quickCopyIncludesMarkdown: boolean;
    onClose: () => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    onStartRecording: (type: 'quickCopy' | 'openApp' | 'copyAbove' | 'copyBelow') => void;
    onToggleQuickCopyOutput: () => void;
    onToggleQuickCopyMarkdown: () => void;
}

export function SettingsModal({
    quickCopyShortcut,
    openAppShortcut,
    copyAboveShortcut,
    copyBelowShortcut,
    recordingShortcutType,
    quickCopyIncludesOutput,
    quickCopyIncludesMarkdown,
    onClose,
    onKeyDown,
    onStartRecording,
    onToggleQuickCopyOutput,
    onToggleQuickCopyMarkdown,
}: SettingsModalProps) {

    const ShortcutRecorder = ({ label, description, icon: Icon, type, shortcut }: {
        label: string;
        description: string;
        icon: React.ComponentType<{ size: number }>;
        type: 'quickCopy' | 'openApp' | 'copyAbove' | 'copyBelow';
        shortcut: ShortcutConfig | null;
    }) => (
        <div className="space-y-2">
            <label className="text-sm font-bold text-packer-grey flex items-center gap-2">
                <Icon size={16} /> {label}
            </label>
            <p className="text-xs text-packer-text-muted">
                {description}
            </p>

            <div
                className={`mt-2 p-4 border-2 rounded-lg flex items-center justify-center cursor-pointer transition-all ${recordingShortcutType === type
                    ? "border-packer-blue bg-blue-50 text-packer-blue"
                    : "border-slate-200 bg-slate-50 hover:border-slate-300"
                    }`}
                onClick={() => onStartRecording(type)}
                onKeyDown={onKeyDown}
                tabIndex={0}
            >
                {recordingShortcutType === type ? (
                    <span className="font-mono font-bold animate-pulse">
                        Press keys...
                    </span>
                ) : (
                    <div className="flex gap-2">
                        {shortcut?.modifiers.map((m) => (
                            <kbd
                                key={m}
                                className="px-2 py-1 bg-white border border-slate-200 rounded font-mono text-xs font-bold shadow-sm"
                            >
                                {m}
                            </kbd>
                        ))}
                        <kbd className="px-2 py-1 bg-white border border-slate-200 rounded font-mono text-xs font-bold shadow-sm">
                            {shortcut?.key}
                        </kbd>
                    </div>
                )}
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 z-50 bg-packer-grey/20 flex items-center justify-center p-12 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-[500px] rounded-lg shadow-2xl flex flex-col border border-packer-border overflow-hidden max-h-full">
                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-packer-border bg-white">
                    <div className="flex items-center gap-3">
                        <div className="bg-slate-50 p-2 rounded text-packer-grey">
                            <Settings size={24} />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-packer-grey">Settings</h3>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="hover:bg-slate-100 text-packer-text-muted hover:text-packer-grey p-2 rounded-full transition"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-8 space-y-6 overflow-y-auto">
                    <ShortcutRecorder
                        label="Open App Shortcut"
                        description="Global hotkey to open/close the PromptPacker overlay."
                        icon={Keyboard}
                        type="openApp"
                        shortcut={openAppShortcut}
                    />

                    <ShortcutRecorder
                        label="Quick Copy Shortcut"
                        description="Global hotkey to copy the entire notebook without opening the extension."
                        icon={Keyboard}
                        type="quickCopy"
                        shortcut={quickCopyShortcut}
                    />

                    {recordingShortcutType && (
                        <p className="text-xs text-center text-packer-blue mt-1">
                            Focus box and press key combo
                        </p>
                    )}
                    {!recordingShortcutType && (
                        <p className="text-[10px] text-center text-packer-text-muted mt-1">
                            Click to record new shortcut
                        </p>
                    )}

                    <ShortcutRecorder
                        label="Copy Above Shortcut"
                        description="Copy the focused cell and all cells above it to clipboard."
                        icon={ArrowUp}
                        type="copyAbove"
                        shortcut={copyAboveShortcut}
                    />

                    <ShortcutRecorder
                        label="Copy Below Shortcut"
                        description="Copy the focused cell and all cells below it to clipboard."
                        icon={ArrowDown}
                        type="copyBelow"
                        shortcut={copyBelowShortcut}
                    />

                    {/* Quick Copy Output Toggle */}
                    <div className="space-y-2 pt-4 border-t border-slate-100">
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                                <label className="text-sm font-bold text-packer-grey flex items-center gap-2">
                                    <Terminal size={16} /> Include Outputs in Quick Copy
                                </label>
                                <p className="text-xs text-packer-text-muted">
                                    Append cell outputs (logs, errors) to the hotkey prompt.
                                </p>
                            </div>
                            <button
                                onClick={onToggleQuickCopyOutput}
                                className={`w-12 h-6 rounded-full relative transition-all duration-200 focus:outline-none shadow-inner
                  ${quickCopyIncludesOutput ? "bg-packer-blue" : "bg-slate-300"}`}
                            >
                                <div
                                    className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-200 shadow-md border border-slate-100 ${quickCopyIncludesOutput ? "left-7" : "left-1"
                                        }`}
                                />
                            </button>
                        </div>
                    </div>

                    {/* Quick Copy Markdown Toggle */}
                    <div className="space-y-2 pt-4 border-t border-slate-100">
                        <div className="flex items-center justify-between">
                            <div className="flex flex-col">
                                <label className="text-sm font-bold text-packer-grey flex items-center gap-2">
                                    <FileText size={16} /> Include Markdown in Quick Copy
                                </label>
                                <p className="text-xs text-packer-text-muted">
                                    Include notebook markdown/text cells in the hotkey prompt.
                                </p>
                            </div>
                            <button
                                onClick={onToggleQuickCopyMarkdown}
                                className={`w-12 h-6 rounded-full relative transition-all duration-200 focus:outline-none shadow-inner
                  ${quickCopyIncludesMarkdown ? "bg-packer-blue" : "bg-slate-300"}`}
                            >
                                <div
                                    className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-200 shadow-md border border-slate-100 ${quickCopyIncludesMarkdown ? "left-7" : "left-1"
                                        }`}
                                />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-packer-border bg-white flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded font-bold transition"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
}
