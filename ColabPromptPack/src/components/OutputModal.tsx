import { CheckCircle2, Copy, X } from "lucide-react";

interface OutputModalProps {
    generatedPrompt: string | null;
    copied: boolean;
    onClose: () => void;
    onCopy: () => void;
}

export function OutputModal({
    generatedPrompt,
    copied,
    onClose,
    onCopy,
}: OutputModalProps) {
    return (
        <div className="fixed inset-0 z-50 bg-packer-grey/20 flex items-center justify-center p-12 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-5xl h-full max-h-[80vh] rounded-lg shadow-2xl flex flex-col border border-packer-border overflow-hidden">
                {/* Header */}
                <div className="flex justify-between items-center p-6 border-b border-packer-border bg-white">
                    <div className="flex items-center gap-3">
                        <div className="bg-blue-50 p-2 rounded">
                            <CheckCircle2 className="text-packer-blue" size={24} />
                        </div>
                        <div>
                            <h3 className="font-bold text-lg text-packer-grey">
                                Prompt Generated
                            </h3>
                            <p className="text-xs text-packer-text-muted">Ready to copy</p>
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
                <div className="flex-1 p-0 relative">
                    <textarea
                        readOnly
                        value={generatedPrompt || ""}
                        className="w-full h-full bg-slate-50 text-packer-grey font-mono text-sm p-8 focus:outline-none resize-none custom-scrollbar leading-relaxed"
                    />
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-packer-border bg-white flex justify-between items-center">
                    <span className="text-xs text-packer-text-muted font-mono bg-slate-100 px-2 py-1 rounded">
                        {generatedPrompt?.length.toLocaleString()} chars
                    </span>
                    <div className="flex gap-4">
                        <button
                            onClick={onClose}
                            className="px-6 py-2.5 hover:bg-slate-50 border border-packer-border rounded font-semibold text-packer-text-muted transition"
                        >
                            Close
                        </button>
                        <button
                            onClick={onCopy}
                            className="px-8 py-2.5 bg-[#0069C3] hover:bg-[#1a252f] rounded font-bold text-white flex items-center gap-2 shadow-lg shadow-blue-500/20 transition transform active:scale-[0.98]"
                        >
                            {copied ? (
                                <CheckCircle2 size={18} strokeWidth={2.5} />
                            ) : (
                                <Copy size={18} strokeWidth={2.5} />
                            )}
                            {copied ? "Copied!" : "Copy to Clipboard"}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
