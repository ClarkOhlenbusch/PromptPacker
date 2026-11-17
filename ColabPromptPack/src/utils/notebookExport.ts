import { marked } from "marked";
import DOMPurify from "dompurify";
import katex from "katex";

export interface NotebookOutput {
  output_type?: string;
  text?: string | string[];
  traceback?: string[];
  data?: Record<string, unknown>;
  metadata?: Record<string, { width?: number; height?: number }>;
}
export interface NotebookCell {
  cell_type: string;
  source: string | string[];
  outputs?: NotebookOutput[];
  attachments?: Record<string, Record<string, string | string[]>>;
  [key: string]: unknown;
}
export interface Notebook { cells: NotebookCell[]; nbformat: number; [key: string]: unknown; }
export interface ExportOptions { includeOutputs: boolean; includeMarkdown: boolean; }
export function selectNotebookContent(notebook: Notebook, options: ExportOptions): Notebook {
  return {
    ...notebook,
    cells: notebook.cells
      .filter(cell => options.includeMarkdown || cell.cell_type !== "markdown")
      .map(cell => !options.includeOutputs && cell.cell_type === "code"
        ? { ...cell, outputs: [], execution_count: null }
        : cell),
  };
}
const asText = (value: unknown): string => typeof value === "string" ? value : Array.isArray(value) ? value.join("") : "";
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const mathHtml = (text: string, displayMode: boolean) => katex.renderToString(text, { displayMode, output: "mathml", throwOnError: false, trust: false });

marked.use({ extensions: [
  { name: "mathBlock", level: "block", start: src => src.search(/\$\$|\\\[/), tokenizer(src) { const m = src.match(/^\$\$\s*([\s\S]+?)\s*\$\$(?:\n|$)/) || src.match(/^\\\[([\s\S]+?)\\\](?:\n|$)/); if (m) return { type: "mathBlock", raw: m[0], text: m[1] }; }, renderer: token => mathHtml(String(token.text), true) },
  { name: "mathInline", level: "inline", start: src => src.search(/\$|\\\(/), tokenizer(src) { const m = src.match(/^\$(?!\$|\s)((?:[^\n$]*?[^\s$])?)\$(?!\$)/) || src.match(/^\\\(([^\n]*?)\\\)/); if (m && m[1]) return { type: "mathInline", raw: m[0], text: m[1] }; }, renderer: token => mathHtml(String(token.text), false) },
] });

// A script-free document works in the extension's CSP, a downloaded file, and print.
// Output CSS lives in declarative shadow roots so even `body`, `*`, or repeated IDs
// from separate MIME bundles cannot change the surrounding notebook or each other.
const EXPORT_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: https: http: blob:; font-src data:; base-uri 'none'; form-action 'none'";
const CONTENT_STYLE = `:host{display:block;min-width:0;color:#202124;font:14px/1.5 system-ui,sans-serif;contain:layout style;isolation:isolate;overflow:auto}img,svg{max-width:100%}img{height:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 ui-monospace,monospace}table{border-collapse:collapse}th,td{padding:6px 10px}table.dataframe{font-size:13px}table.dataframe thead{border-bottom:1px solid #bbb}table.dataframe tbody tr:nth-child(odd){background:#f5f5f5}a{color:#1967d2}math[display=block]{display:block;margin:1em 0;overflow:auto}@media print{:host{overflow:visible;print-color-adjust:exact;-webkit-print-color-adjust:exact}img,svg,tr{break-inside:avoid}details> :not(summary){display:block!important}}`;

function isolatedContent(content: string) {
  return `<div class="rich-output"><template shadowrootmode="open"><style>${CONTENT_STYLE}</style>${content}</template></div>`;
}

function imageUrl(source: string): string | null {
  if (!source.trim()) return null;
  if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml|avif|bmp);/i.test(source)) return source;
  try {
    const url = new URL(source, "https://colab.research.google.com/");
    return /^(https?:|blob:)$/.test(url.protocol) ? url.href : null;
  } catch { return null; }
}

interface ContentResult { html: string; missing: string[]; externalImages: string[]; }
function cleanHtml(html: string, images: Record<string, string>): ContentResult {
  // Template contents are inert: notebook onload/onerror attributes must never be
  // attached to an active document, even briefly, before sanitization.
  const template = document.createElement("template");
  template.innerHTML = html;
  const raw = template.content;
  const missing: string[] = [];
  // Libraries such as scikit-learn mention `<a>` in CSS comments. DOMPurify's
  // XML protections reject a whole style element containing literal markup.
  // A CSS escape preserves both valid CSS strings and those comments safely.
  raw.querySelectorAll("style").forEach(style => { style.textContent = (style.textContent || "").replace(/</g, "\\3c "); });
  // These are Colab-only toolbar enhancements, not part of the displayed table.
  if (raw.querySelector("table")) {
    raw.querySelectorAll(".colab-df-buttons, .colab-df-convert, .colab-df-quickchart").forEach(element => element.remove());
    raw.querySelectorAll("script").forEach(script => {
      if (/google[.]colab|convertToInteractive|quickchart|data_table|dataframe/i.test(script.textContent || "")) script.remove();
    });
  }
  if (raw.querySelector("script,iframe,object,embed,canvas")) missing.push("a script-based output needs a static image or HTML representation");
  if (raw.querySelector('link[rel="stylesheet"]')) missing.push("an external stylesheet is unavailable in the standalone file");
  const fragment = DOMPurify.sanitize(raw, {
    RETURN_DOM_FRAGMENT: true,
    ADD_TAGS: ["style"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "base", "link", "meta", "canvas", "foreignObject", "animate", "animateMotion", "animateTransform", "set", "template"],
    FORBID_ATTR: ["srcdoc", "autofocus", "action", "formaction"],
  });
  const externalImages: string[] = [];
  fragment.querySelectorAll("*").forEach(element => {
    // Defense in depth for HTML, MathML, and namespaced SVG event attributes.
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.localName)) element.removeAttributeNode(attribute);
    }
    if (element.localName === "style") {
      // @import cannot work under the export CSP. Preserve local formatting.
      element.textContent = (element.textContent || "").replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;?/gi, "");
    }
    if (element.localName === "button") element.remove();
    if (element.localName === "input" && !["checkbox", "radio"].includes(element.getAttribute("type") || "")) element.remove();
    if (element.localName === "a") element.setAttribute("rel", "noopener noreferrer");
    if (element.localName === "img") {
      element.removeAttribute("srcset");
      element.removeAttribute("loading");
      const source = imageUrl(element.getAttribute("src") || "");
      if (source) {
        element.setAttribute("src", images[source] || source);
        element.setAttribute("referrerpolicy", "no-referrer");
        if (!images[source] && !source.startsWith("data:")) externalImages.push(source);
      } else {
        missing.push("an image has no portable source");
        element.replaceWith(document.createTextNode(element.getAttribute("alt") || "[Image unavailable]"));
      }
    }
  });
  const visible = fragment.cloneNode(true) as DocumentFragment;
  visible.querySelectorAll("style").forEach(element => element.remove());
  // Script-only chart containers must fall back to text, rather than exporting
  // an empty box just because their HTML contains a div or stylesheet.
  if (missing.length && !visible.textContent?.trim() && !visible.querySelector("img,svg,math,table,input,hr")) return { html: "", missing, externalImages };
  template.content.replaceChildren(fragment);
  return { html: template.innerHTML, missing, externalImages };
}

export function notebookToHtml(notebook: Notebook, title: string, images: Record<string, string> = {}) {
  const warnings: string[] = [];
  const imageUrls = new Set<string>();
  const renderContent = (html: string, index: number) => {
    const cleaned = cleanHtml(html, images);
    cleaned.missing.forEach(reason => warnings.push(`Cell ${index + 1}: ${reason}.`));
    cleaned.externalImages.forEach(url => imageUrls.add(url));
    if (cleaned.externalImages.length) warnings.push(`Cell ${index + 1}: an image requires an internet connection.`);
    return cleaned.html.trim() ? isolatedContent(cleaned.html) : "";
  };
  const sections = notebook.cells.map((cell, index) => {
    const source = asText(cell.source);
    if (cell.cell_type === "markdown") {
      let markdown = source;
      for (const [name, data] of Object.entries(cell.attachments || {})) {
        const mime = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].find(key => data[key]);
        if (mime) {
          const uri = mime === "image/svg+xml" ? `data:${mime};charset=utf-8,${encodeURIComponent(asText(data[mime]))}` : `data:${mime};base64,${asText(data[mime]).replace(/\s/g, "")}`;
          markdown = markdown.split(`attachment:${name}`).join(uri);
        }
      }
      if (/attachment:/.test(markdown)) warnings.push(`Cell ${index + 1}: an attachment could not be displayed.`);
      return `<section class="markdown">${renderContent(marked.parse(markdown, { async: false }), index)}</section>`;
    }
    if (cell.cell_type !== "code") return `<section><pre>${escapeHtml(source)}</pre></section>`;
    const outputs = (cell.outputs || []).map(output => {
      if (output.output_type === "stream") return `<pre class="output">${escapeHtml(asText(output.text).replace(/\x1b\[[0-9;]*m/g, ""))}</pre>`;
      if (output.output_type === "error") return `<pre class="output error">${escapeHtml((output.traceback || []).join("\n").replace(/\x1b\[[0-9;]*m/g, ""))}</pre>`;
      const data = output.data || {};
      const mime = ["image/png", "image/jpeg", "image/gif", "image/webp"].find(key => data[key]);
      // A MIME bundle contains alternative representations of ONE output. Use a
      // portable image when available instead of flagging unused widget/JS MIME.
      if (mime) {
        const width = output.metadata?.[mime]?.width;
        return `<img class="output-image" alt="Output from cell ${index + 1}"${Number.isFinite(width) && width! > 0 ? ` width="${width}"` : ""} src="data:${mime};base64,${escapeHtml(asText(data[mime]).replace(/\s/g, ""))}">`;
      }
      if (data["image/svg+xml"]) return renderContent(asText(data["image/svg+xml"]), index);
      if (data["text/html"]) {
        const content = renderContent(asText(data["text/html"]), index);
        if (content) return content;
      }
      if (data["text/latex"]) return renderContent(mathHtml(asText(data["text/latex"]).replace(/^\s*(?:\$\$?|\\\[|\\\()|(?:\$\$?|\\\]|\\\))\s*$/g, ""), true), index);
      if (data["application/json"] !== undefined) return `<pre class="output">${escapeHtml(JSON.stringify(data["application/json"], null, 2))}</pre>`;
      if (data["text/plain"]) {
        if (Object.keys(data).some(key => key !== "text/plain")) warnings.push(`Cell ${index + 1}: a rich output is available only as text in this export.`);
        return `<pre class="output">${escapeHtml(asText(data["text/plain"]))}</pre>`;
      }
      warnings.push(`Cell ${index + 1}: the output has no static representation.`);
      return '<p class="unavailable">[This output has no static representation. Open the notebook to view it.]</p>';
    }).join("");
    return `<section><div class="label">Cell ${index + 1}</div><pre class="source"><code>${escapeHtml(source)}</code></pre>${outputs ? `<div class="label output-label">Output</div>${outputs}` : ""}</section>`;
  }).join("\n");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escapeHtml(EXPORT_CSP)}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{font:15px/1.6 system-ui,sans-serif;color:#202124;background:white;max-width:1000px;margin:32px auto;padding:0 24px}section{margin:0 0 24px;padding:12px 0;border-bottom:1px solid #dadce0;min-width:0}.label{font-size:12px;color:#5f6368;margin-bottom:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere;border-radius:6px;padding:14px;font:13px/1.5 ui-monospace,monospace}.source{background:#f8f9fa;border:1px solid #dadce0}.output-label{margin-top:14px}.output{padding:8px 0}.error{color:#b91c1c}.output-image{max-width:100%;height:auto}.unavailable{color:#5f6368;font-size:13px}@media print{body{max-width:none;margin:0;padding:0;print-color-adjust:exact;-webkit-print-color-adjust:exact}.output-image{break-inside:avoid}@page{margin:0.6in}}</style></head><body>${sections}</body></html>`;
  return { html, warnings: [...new Set(warnings)], imageUrls: [...imageUrls] };
}

// Embed public images when CORS permits. Keep their original URLs on failure so
// a reachable image still displays rather than silently deleting it.
export async function prepareNotebookImages(notebook: Notebook, title: string): Promise<Record<string, string>> {
  const { imageUrls } = notebookToHtml(notebook, title);
  const images: Record<string, string> = {};
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, imageUrls.length) }, async () => {
    while (next < imageUrls.length) {
      const url = imageUrls[next++];
      try {
        const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(5000) });
        if (!response.ok) continue;
        const blob = await response.blob();
        if (!/^image\//i.test(blob.type)) continue;
        images[url] = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
      } catch { /* The linked image remains in the export. */ }
    }
  }));
  return images;
}

function materializeOutputStyles(doc: Document) {
  // document.write does not activate declarative shadow DOM in every Chrome
  // context. Build the same roots from our sanitized templates before printing.
  doc.querySelectorAll<HTMLTemplateElement>('.rich-output > template[shadowrootmode="open"]').forEach(template => {
    const host = template.parentElement!;
    if (!host.shadowRoot) host.attachShadow({ mode: "open" }).append(template.content.cloneNode(true));
    template.remove();
  });
}

function documentImages(root: Document | ShadowRoot): HTMLImageElement[] {
  return [...root.querySelectorAll("img"), ...Array.from(root.querySelectorAll("*")).flatMap(element => element.shadowRoot ? documentImages(element.shadowRoot) : [])];
}

export async function printNotebookHtml(html: string): Promise<void> {
  // Open synchronously during the user's click, before awaiting image/font loads.
  const printWindow = window.open("", "_blank");
  if (!printWindow) throw new Error("Allow pop-ups to print or save as PDF.");
  printWindow.opener = null;
  try {
    printWindow.document.open();
    let loadTimeout: ReturnType<typeof setTimeout>;
    const loaded = new Promise<void>((resolve, reject) => {
      loadTimeout = setTimeout(() => reject(new Error("The print preview took too long to load. Check external images and try again.")), 15000);
      printWindow.addEventListener("load", () => { clearTimeout(loadTimeout); resolve(); }, { once: true });
    });
    printWindow.document.write(html);
    printWindow.document.close();
    materializeOutputStyles(printWindow.document);
    await loaded;
    await printWindow.document.fonts.ready;
    const images = documentImages(printWindow.document);
    await Promise.all(images.map(image => image.decode()));
    await new Promise<void>(resolve => printWindow.requestAnimationFrame(() => printWindow.requestAnimationFrame(() => resolve())));
    if (printWindow.closed) return;
    printWindow.focus();
    printWindow.print();
  } catch (error) {
    if (!printWindow.closed) printWindow.close();
    throw new Error(error instanceof Error && error.message.includes("print preview") ? error.message : "An image could not load for printing. Check the HTML preview and try again.");
  }
}

function fence(text: string, language = "") { const n = Math.max(3, ...Array.from(text.matchAll(/`+/g), m => m[0].length + 1)); const f = "`".repeat(n); return `${f}${language}\n${text}\n${f}`; }
function tableToMarkdown(table: HTMLTableElement): string {
  // Markdown cannot represent merged cells. Keep the HTML table in that case.
  if (table.querySelector('[colspan]:not([colspan="1"]), [rowspan]:not([rowspan="1"])')) return table.outerHTML;
  const rows = Array.from(table.rows).map(row => Array.from(row.cells).map(cell => (cell.textContent || "").trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_\[\]|]/g, "\\$&").replace(/\r?\n/g, "<br>")));
  if (!rows.length) return "";
  const width = Math.max(...rows.map(row => row.length));
  const line = (row: string[]) => `| ${Array.from({ length: width }, (_, index) => row[index] || "").join(" | ")} |`;
  return [line(rows[0]), line(Array(width).fill("---")), ...rows.slice(1).map(line)].join("\n");
}

function outputToMarkdown(output: NotebookOutput): string {
  const data = output.data || {};
  const mime = ["image/png", "image/jpeg", "image/gif", "image/webp"].find(key => data[key]);
  if (mime) return `![Cell output](data:${mime};base64,${asText(data[mime]).replace(/\s/g, "")})`;
  if (data["image/svg+xml"]) {
    const svg = cleanHtml(asText(data["image/svg+xml"]), {}).html;
    return `![Cell output](data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)})`;
  }
  if (data["text/html"]) {
    const template = document.createElement("template");
    template.innerHTML = cleanHtml(asText(data["text/html"]), {}).html;
    const tables = Array.from(template.content.querySelectorAll("table"));
    if (tables.length) return tables.map(tableToMarkdown).join("\n\n");
    if (!data["text/plain"] && template.content.textContent?.trim()) return template.innerHTML;
  }
  if (data["text/latex"]) return `$$\n${asText(data["text/latex"]).replace(/^\s*\$\$?|\$\$?\s*$/g, "")}\n$$`;
  if (data["application/json"] !== undefined) return fence(JSON.stringify(data["application/json"], null, 2), "json");
  const text = asText(output.text ?? data["text/plain"]) || (output.traceback || []).join("\n");
  return text ? fence(text.replace(/\x1b\[[0-9;]*m/g, ""), "text") : "[This output has no static representation. Open the notebook to view it.]";
}

export function notebookToMarkdown(notebook: Notebook) {
  return notebook.cells.map(cell => {
    if (cell.cell_type === "markdown") {
      let markdown = asText(cell.source);
      for (const [name, data] of Object.entries(cell.attachments || {})) {
        const mime = ["image/png", "image/jpeg", "image/gif", "image/webp"].find(key => data[key]);
        if (mime) markdown = markdown.split(`attachment:${name}`).join(`data:${mime};base64,${asText(data[mime]).replace(/\s/g, "")}`);
      }
      return markdown;
    }
    return fence(asText(cell.source), "python") + (cell.outputs?.length ? "\n\n" + cell.outputs.map(outputToMarkdown).join("\n\n") : "");
  }).join("\n\n---\n\n") + "\n";
}
export function notebookToPython(notebook: Notebook) { return notebook.cells.map(cell => {
  if (cell.cell_type === "markdown") return `# %% [markdown]\n${asText(cell.source).split("\n").map(line => `# ${line}`).join("\n")}`;
  const outputs = (cell.outputs || []).map(output => asText(output.text ?? output.data?.["text/plain"]) || (output.traceback || []).join("\n")).filter(Boolean).join("\n");
  return `# %%\n${asText(cell.source)}${outputs ? `\n\n# Output:\n${outputs.split("\n").map(line => `# ${line}`).join("\n")}` : ""}`;
}).join("\n\n") + "\n"; }
export function downloadFile(filename: string, content: string, mimeType: string) { const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
