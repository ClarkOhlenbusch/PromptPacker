import type { FileEntry } from "../services/FileSystem";

function orderedCells(files: FileEntry[]) {
  return files
    .filter(file => !file.is_dir && /^cell_\d+$/.test(file.path))
    .sort((a, b) => Number(a.path.slice(5)) - Number(b.path.slice(5)));
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

function renderMarkdown(source: string) {
  return source.split(/\n{2,}/).map(block => {
    const text = escapeHtml(block.trim());
    if (!text) return "";
    if (/^```/.test(block.trim())) {
      return `<pre><code>${escapeHtml(block.trim().replace(/^```[^\n]*\n?|\n?```$/g, ""))}</code></pre>`;
    }
    const heading = text.match(/^(#{1,6})\s+(.+)$/);
    if (heading) return `<h${heading[1].length}>${heading[2]}</h${heading[1].length}>`;
    if (block.split("\n").every(line => /^\s*[-*]\s+/.test(line))) {
      return `<ul>${block.split("\n").map(line => line.match(/^\s*[-*]\s+(.*)$/)).filter(Boolean).map(match => `<li>${escapeHtml(match![1])}</li>`).join("")}</ul>`;
    }
    return `<p>${text.replace(/\n/g, "<br>")}</p>`;
  }).join("\n");
}

export function notebookToMarkdown(files: FileEntry[]) {
  return orderedCells(files).map(file => {
    const content = file.content || "";
    if (file.cellType === "markdown") return content;
    const output = file.output?.trim() ? `\n\nOutput:\n\n\`\`\`text\n${file.output}\n\`\`\`` : "";
    return `\`\`\`python\n${content}\n\`\`\`${output}`;
  }).join("\n\n---\n\n") + "\n";
}

export function notebookToPython(files: FileEntry[]) {
  return orderedCells(files).map((file, index) => file.cellType === "markdown"
    ? `# %% [markdown]\n${(file.content || "").split("\n").map(line => `# ${line}`).join("\n")}`
    : `# %% Cell ${index + 1}\n${file.content || ""}${file.output?.trim() ? `\n\n# Output:\n${file.output.split("\n").map(line => `# ${line}`).join("\n")}` : ""}`
  ).join("\n\n\n") + "\n";
}

export function notebookToHtml(files: FileEntry[]) {
  const sections = orderedCells(files).map((file, index) => file.cellType === "markdown"
    ? `<section class="markdown">${renderMarkdown(file.content || "")}</section>`
    : `<section><div class="label">Cell ${index + 1}</div><pre><code>${escapeHtml(file.content || "")}</code></pre>${file.output?.trim() ? `<div class="label output-label">Output</div><pre class="output">${escapeHtml(file.output)}</pre>` : ""}</section>`
  ).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Colab assignment</title><style>
    body{font:15px/1.6 system-ui,sans-serif;color:#202124;max-width:900px;margin:40px auto;padding:0 28px}section{margin:0 0 24px;padding:16px 0;border-bottom:1px solid #dadce0}.label{font-size:12px;color:#5f6368;margin-bottom:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f8f9fa;border:1px solid #dadce0;border-radius:6px;padding:14px;margin:0;font:13px/1.5 ui-monospace,monospace}.output-label{margin-top:14px}.output{background:#fff;border-color:#eee}.markdown h1,.markdown h2,.markdown h3{line-height:1.25}.markdown p{white-space:pre-wrap}@media print{body{max-width:none;margin:0;padding:0}section{break-inside:avoid}pre{white-space:pre-wrap}@page{margin:0.7in}}
    </style></head><body>${sections}</body></html>`;
}

export function downloadFile(filename: string, content: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
