import { Settings, Keyboard, Terminal, X } from "lucide-react";
import { ShortcutConfig } from "../hooks/useSettings";

interface SettingsModalProps {
    currentShortcut: ShortcutConfig | null;
    isRecording: boolean;
    quickCopyIncludesOutput: boolean;
    onClose: () => void;
    onKeyDown: (e: React.KeyboardEvent) => void;
    onStartRecording: () => void;
    onToggleQuickCopyOutput: () => void;
}

export function SettingsModal({
    currentShortcut,
    isRecording,
    quickCopyIncludesOutput,
    onClose,
    onKeyDown,
    onStartRecording,
    onToggleQuickCopyOutput,
}: SettingsModalProps) {
    return (
        <div className="fixed inset-0 z-50 bg-packer-grey/20 flex items-center justify-center p-12 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-[500px] rounded-lg shadow-2xl flex flex-col border border-packer-border overflow-hidden">
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
                <div className="p-8 space-y-6">
                    {/* Shortcut Recorder */}
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-packer-grey flex items-center gap-2">
                            <Keyboard size={16} /> Quick Copy Shortcut
                        </label>
                        <p className="text-xs text-packer-text-muted">
                            Global hotkey to copy the entire notebook without opening the extension.
                        </p>

                        <div
                            className={`mt-2 p-4 border-2 rounded-lg flex items-center justify-center cursor-pointer transition-all ${isRecording
                                    ? "border-packer-blue bg-blue-50 text-packer-blue"
                                    : "border-slate-200 bg-slate-50 hover:border-slate-300"
                                }`}
                            onClick={onStartRecording}
                            onKeyDown={onKeyDown}
                            tabIndex={0}
                        >
                            {isRecording ? (
                                <span className="font-mono font-bold animate-pulse">
                                    Press keys...
                                </span>
                            ) : (
                                <div className="flex gap-2">
                                    {currentShortcut?.modifiers.map((m) => (
                                        <kbd
                                            key={m}
                                            className="px-2 py-1 bg-white border border-slate-200 rounded font-mono text-xs font-bold shadow-sm"
                                        >
                                            {m}
                                        </kbd>
                                    ))}
                                    <kbd className="px-2 py-1 bg-white border border-slate-200 rounded font-mono text-xs font-bold shadow-sm">
                                        {currentShortcut?.key}
                                    </kbd>
                                </div>
                            )}
                        </div>
                        {isRecording && (
                            <p className="text-xs text-center text-packer-blue mt-1">
                                Focus box and press key combo
                            </p>
                        )}
                        {!isRecording && (
                            <p className="text-[10px] text-center text-packer-text-muted mt-1">
                                Click to record new shortcut
                            </p>
                        )}
                    </div>

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
                  ${quickCopyIncludesOutput ? "bg-[#0069C3]" : "bg-slate-300"}`}
                            >
                                <div
                                    className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all duration-200 shadow-md border border-slate-100 ${quickCopyIncludesOutput ? "left-7" : "left-1"
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
