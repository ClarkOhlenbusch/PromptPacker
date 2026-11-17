import { useMemo, useState } from "react";
import { Download, Info, X } from "lucide-react";
import type { IFileSystem } from "../services/FileSystem";
import { requestNotebookExport } from "../services/ColabFileSystem";
import { downloadFile, notebookToHtml, notebookToMarkdown, notebookToPython, prepareNotebookImages, printNotebookHtml, selectNotebookContent, type Notebook } from "../utils/notebookExport";

export function NotebookExport({ disabled }: { fs: IFileSystem; disabled: boolean }) {
  const [snapshot, setSnapshot] = useState<{ notebook: Notebook; title: string; images: Record<string, string> } | null>(null);
  const [includeOutputs, setIncludeOutputs] = useState(true);
  const [includeMarkdown, setIncludeMarkdown] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selectedNotebook = useMemo(() => snapshot ? selectNotebookContent(snapshot.notebook, { includeOutputs, includeMarkdown }) : null, [snapshot, includeOutputs, includeMarkdown]);
  const rendered = useMemo(() => selectedNotebook && snapshot ? notebookToHtml(selectedNotebook, snapshot.title, snapshot.images) : null, [selectedNotebook, snapshot]);

  const preview = async () => {
    setBusy(true); setError("");
    try {
      const result = await requestNotebookExport();
      if (result?.error) throw new Error(result.error);
      if (!result?.notebook?.cells) throw new Error("Could not read the notebook. Try Colab's File > Download menu.");
      const title = result.title || "Colab notebook";
      const images = await prepareNotebookImages(result.notebook, title);
      setSnapshot({ notebook: result.notebook, title, images });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not prepare the notebook."); }
    finally { setBusy(false); }
  };
  const exportFile = async (format: "ipynb" | "html" | "pdf" | "md" | "py") => {
    if (!snapshot || !selectedNotebook || !rendered) return;
    const name = snapshot.title.replace(/\.ipynb$/i, "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 100) || "notebook";
    if (format === "pdf") {
      setBusy(true); setError("");
      try { await printNotebookHtml(rendered.html); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Could not print the notebook."); }
      finally { setBusy(false); }
    } else if (format === "ipynb") downloadFile(`${name}.ipynb`, JSON.stringify(selectedNotebook, null, 2), "application/x-ipynb+json");
    else if (format === "html") downloadFile(`${name}.html`, rendered.html, "text/html");
    else if (format === "md") downloadFile(`${name}.md`, notebookToMarkdown(selectedNotebook), "text/markdown");
    else downloadFile(`${name}.py`, notebookToPython(selectedNotebook), "text/x-python");
  };
  return <>
    <div><button type="button" disabled={disabled || busy} onClick={() => void preview()} className="px-4 py-2.5 flex items-center gap-2 text-packer-text-muted hover:bg-slate-50 rounded-md border border-packer-border shadow-sm disabled:opacity-50 text-xs font-bold uppercase tracking-wider"><Download size={17}/>{busy ? "Preparing…" : "Export notebook"}</button>
    {error && !snapshot && <p role="alert" className="absolute bottom-20 right-4 bg-white border border-red-200 rounded p-3 text-xs text-red-700 shadow-lg">{error}</p>}</div>
    {snapshot && rendered && <div className="fixed inset-0 z-50 bg-packer-grey/20 flex items-center justify-center p-6 backdrop-blur-sm animate-in fade-in duration-200" role="dialog" aria-modal="true" aria-label="Notebook export preview">
      <div className="bg-white w-full max-w-5xl h-full max-h-[90vh] rounded-lg shadow-2xl flex flex-col border border-packer-border overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 border-b border-packer-border bg-white">
          <h2 className="text-sm font-bold text-packer-grey mr-auto">Export preview</h2>
          <div className="flex items-center gap-2"><span id="export-outputs-label" className="text-xs font-semibold text-packer-text-muted">Outputs</span><button type="button" role="switch" aria-checked={includeOutputs} aria-labelledby="export-outputs-label" onClick={() => setIncludeOutputs(value => !value)} className={`w-10 h-5 rounded-full relative transition-all duration-200 shadow-inner focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-packer-blue ${includeOutputs ? "bg-packer-blue" : "bg-slate-300"}`}><span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all duration-200 shadow-sm ${includeOutputs ? "left-[22px]" : "left-0.5"}`} /></button></div>
          <div className="flex items-center gap-2"><span id="export-markdown-label" className="text-xs font-semibold text-packer-text-muted">Markdown cells</span><button type="button" role="switch" aria-checked={includeMarkdown} aria-labelledby="export-markdown-label" onClick={() => setIncludeMarkdown(value => !value)} className={`w-10 h-5 rounded-full relative transition-all duration-200 shadow-inner focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-packer-blue ${includeMarkdown ? "bg-packer-blue" : "bg-slate-300"}`}><span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-all duration-200 shadow-sm ${includeMarkdown ? "left-[22px]" : "left-0.5"}`} /></button></div>
          <button aria-label="Close preview" onClick={() => { setSnapshot(null); setError(""); }} className="hover:bg-slate-100 text-packer-text-muted hover:text-packer-grey p-1 rounded-full transition"><X size={20}/></button>
        </div>
        <iframe title="Notebook preview" sandbox="" srcDoc={rendered.html} className="flex-1 w-full min-h-0 bg-white border-0" />
        <div className="px-4 py-3 border-t border-packer-border bg-white"><div className="flex flex-wrap items-center gap-2">{([ ["ipynb", "Notebook (.ipynb)"], ["html", "HTML"], ["pdf", "PDF (print)"], ["md", "Markdown"], ["py", "Python"] ] as const).map(([format, label]) => <button key={format} disabled={busy} onClick={() => void exportFile(format)} className="px-4 py-2 border border-packer-border hover:bg-slate-50 hover:border-slate-300 rounded text-sm font-semibold text-packer-text-muted hover:text-packer-grey transition">{label}</button>)}{rendered.warnings.length > 0 && <details className="relative ml-auto text-xs text-packer-text-muted"><summary className="cursor-pointer flex items-center gap-1 hover:text-packer-blue"><Info size={14} /> Preview details</summary><div role="status" className="absolute bottom-full right-0 mb-2 w-72 max-h-40 overflow-auto rounded border border-packer-border bg-white p-3 shadow-lg">Export details:<ul className="mt-2 list-disc pl-4">{rendered.warnings.map(w => <li key={w}>{w}</li>)}</ul></div></details>}</div><p className="text-xs text-packer-text-muted mt-2">Markdown includes tables and saved images; Python includes text outputs. Use HTML or PDF for styled diagrams.</p>{error && <p role="alert" className="text-red-700 text-xs mt-2">{error}</p>}</div>
      </div>
    </div>}
  </>;
}
