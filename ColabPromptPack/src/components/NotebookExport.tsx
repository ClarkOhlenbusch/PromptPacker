import { useState } from "react";
import { ChevronDown, Download } from "lucide-react";
import type { IFileSystem } from "../services/FileSystem";
import { downloadFile, notebookToHtml, notebookToMarkdown, notebookToPython } from "../utils/notebookExport";

export function NotebookExport({ fs, disabled }: { fs: IFileSystem; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const exportNotebook = async (format: "html" | "pdf" | "md" | "py") => {
    // Open synchronously so the browser treats the print window as a user action.
    const printWindow = format === "pdf" ? window.open("", "_blank") : null;
    if (format === "pdf" && !printWindow) {
      setError("Allow pop-ups to save as PDF.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const files = await fs.scanProject("Google Colab Notebook");
      if (!files.length) throw new Error("No notebook cells were found. Refresh the notebook and try again.");
      if (printWindow) {
        printWindow.document.open();
        printWindow.document.write(notebookToHtml(files));
        printWindow.document.close();
        printWindow.focus();
        printWindow.print();
      } else if (format === "html") {
        downloadFile("colab-assignment.html", notebookToHtml(files), "text/html");
      } else if (format === "md") {
        downloadFile("colab-assignment.md", notebookToMarkdown(files), "text/markdown");
      } else {
        downloadFile("colab-assignment.py", notebookToPython(files), "text/x-python");
      }
      setOpen(false);
    } catch (cause) {
      printWindow?.close();
      setError(cause instanceof Error ? cause.message : "Could not export the notebook.");
    } finally {
      setBusy(false);
    }
  };

  return <div className="relative">
    <button type="button" disabled={disabled || busy} onClick={() => setOpen(!open)} aria-expanded={open}
      className="px-4 py-2.5 flex items-center gap-2 text-packer-text-muted hover:bg-slate-50 rounded-md border border-packer-border shadow-sm disabled:opacity-50 text-xs font-bold uppercase tracking-wider">
      <Download size={17} /> {busy ? "Exporting…" : "Export notebook"} <ChevronDown size={14} />
    </button>
    {open && <div className="absolute bottom-full right-0 mb-2 w-72 rounded-md border border-packer-border bg-white p-2 shadow-xl z-20">
      <p className="px-2 py-1 text-xs text-packer-text-muted">Exports all cells and available text outputs. Outputs may be truncated; images and rich outputs are not included. HTML and PDF use basic Markdown formatting.</p>
      {([ ["html", "HTML document"], ["pdf", "PDF (print / save)"], ["md", "Markdown"], ["py", "Python script"] ] as const).map(([format, label]) =>
        <button key={format} type="button" disabled={busy} onClick={() => void exportNotebook(format)} className="block w-full text-left px-2 py-2 rounded text-sm hover:bg-slate-50 disabled:opacity-50">{label}</button>)}
      {error && <p role="alert" className="px-2 py-1 text-xs text-red-600">{error}</p>}
    </div>}
  </div>;
}
