import { describe, expect, it } from "vitest";
import { marked } from "marked";
import { notebookToHtml, notebookToMarkdown, selectNotebookContent, type Notebook } from "./notebookExport";

const codeOutput = (data: Record<string, unknown>): Notebook => ({ nbformat: 4, cells: [{ cell_type: "code", source: "display(result)", outputs: [{ data }] }] });

describe("notebook export content", () => {
  it("keeps styles and CSS disclosure controls while removing executable attributes in all namespaces", () => {
    const result = notebookToHtml(codeOutput({ "text/html": '<style>/* Documentation for <a> */.diagram{color:red}</style><div style="text-align:right"><input type="checkbox" id="toggle"><label for="toggle">Details</label><svg onload="alert(1)"><rect style="fill:blue" width="10" height="10"/></svg><img src="data:image/png;base64,AA==" onerror="alert(1)"></div>' }), "Example");
    expect(result.html).toContain(".diagram{color:red}");
    expect(result.html).toContain('style="text-align:right"');
    expect(result.html).toContain('type="checkbox"');
    expect(result.html).toContain('style="fill:blue"');
    expect(result.html).not.toMatch(/onload|onerror/);
    expect(result.warnings).toEqual([]);
  });

  it("uses a static image from a MIME bundle without warning about its unused widget alternative", () => {
    const result = notebookToHtml(codeOutput({ "image/png": "AA==", "application/vnd.jupyter.widget-view+json": { model_id: "widget" } }), "Image");
    expect(result.html).toContain("data:image/png;base64,AA==");
    expect(result.warnings).toEqual([]);
  });

  it("renders single-letter inline math, display math, and LaTeX MIME output", () => {
    const notebook = codeOutput({ "text/latex": "$x^2$" });
    notebook.cells.unshift({ cell_type: "markdown", source: "A $x$ value.\n\n\\[y^2\\]" });
    const result = notebookToHtml(notebook, "Math");
    expect(result.html.match(/<math[\s>]/g)).toHaveLength(3);
  });

  it("converts DataFrame cells to Markdown while preserving pipes and empty index headings", () => {
    const markdown = notebookToMarkdown(codeOutput({ "text/html": '<table><thead><tr><th></th><th>city</th></tr></thead><tbody><tr><th>0</th><td>Boston | NYC</td></tr></tbody></table>', "text/plain": "old plaintext table" }));
    expect(markdown).toContain("|  | city |\n| --- | --- |\n| 0 | Boston \\| NYC |");
    expect(marked.parse(markdown)).toContain("<table>");
    expect(markdown).not.toContain("old plaintext table");
  });

  it("preserves merged table structure and embedded Markdown attachments", () => {
    const notebook = codeOutput({ "text/html": '<table><tr><th colspan="2">Group</th></tr><tr><td>1</td><td>2</td></tr></table>' });
    notebook.cells.unshift({ cell_type: "markdown", source: "![Attached](attachment:plot.png)", attachments: { "plot.png": { "image/png": "AA==" } } });
    const markdown = notebookToMarkdown(notebook);
    expect(markdown).toContain('colspan="2"');
    expect(markdown).toContain("![Attached](data:image/png;base64,AA==)");
  });

  it("falls back to text for script-only output rather than exporting an empty box", () => {
    const result = notebookToHtml(codeOutput({ "text/html": '<div id="chart"></div><script>renderChart()</script>', "text/plain": "Chart summary" }), "Chart");
    expect(result.html).toContain("Chart summary");
    expect(result.html).not.toContain('id="chart"');
    expect(result.warnings.some(warning => warning.includes("script-based output"))).toBe(true);
  });

  it("filters without losing metadata or mutating original cells and outputs", () => {
    const notebook: Notebook = { nbformat: 4, metadata: { custom: true }, cells: [{ cell_type: "markdown", source: "intro" }, { cell_type: "code", source: "1", execution_count: 4, metadata: { id: "stable" }, outputs: [{ data: { "text/plain": "1" } }] }] };
    const before = JSON.stringify(notebook);
    const selected = selectNotebookContent(notebook, { includeMarkdown: false, includeOutputs: false });
    expect(selected.cells).toHaveLength(1);
    expect(selected.cells[0]).toMatchObject({ metadata: { id: "stable" }, execution_count: null, outputs: [] });
    expect(selected.metadata).toEqual({ custom: true });
    expect(JSON.stringify(notebook)).toEqual(before);
  });
});
