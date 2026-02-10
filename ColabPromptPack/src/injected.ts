export { };

// PromptPack: Injected Script to access Colab Internals
// This script only extracts cell data - diff logic is handled in the React app

declare global {
    interface Window {
        colab?: any;
        IPython?: any;
        monaco?: any;
    }
}

(function () {
    console.log("PromptPack: Injected script running in page context.");

    const COLAB_ORIGIN = "https://colab.research.google.com";

    window.postMessage({ type: "PROMPTPACK_INJECTED_READY" }, COLAB_ORIGIN);

    window.addEventListener("message", (event) => {
        if (event.source !== window || event.origin !== COLAB_ORIGIN) return;

        if (event.data.type === "PROMPTPACK_REQUEST_CELLS") {
            try {
                const cells = extractCellsFromMemory();
                window.postMessage({ type: "PROMPTPACK_RESPONSE_CELLS", cells }, COLAB_ORIGIN);
            } catch (e: any) {
                console.error("PromptPack Extraction Error:", e);
                window.postMessage({ type: "PROMPTPACK_RESPONSE_ERROR", error: e.message }, COLAB_ORIGIN);
            }
        } else if (event.data.type === "PROMPTPACK_REQUEST_CELLS_WITH_ACTIVE") {
            try {
                const cells = extractCellsFromMemory();
                const activeCellIndex = getActiveCellIndex();
                window.postMessage({ type: "PROMPTPACK_RESPONSE_CELLS_WITH_ACTIVE", cells, activeCellIndex }, COLAB_ORIGIN);
            } catch (e: any) {
                console.error("PromptPack Extraction Error:", e);
                window.postMessage({ type: "PROMPTPACK_RESPONSE_ERROR", error: e.message }, COLAB_ORIGIN);
            }
        }
    });

    function tryColabInternalAPI() {
        try {
            if (window.colab && window.colab.global && window.colab.global.notebook) {
                const notebook = window.colab.global.notebook;
                if (notebook.cells) {
                    const cells = Array.isArray(notebook.cells) ? notebook.cells : Object.values(notebook.cells);
                    return cells.map((cell: any, index: number) => {
                        const source = cell.source || cell.text || cell.code || "";
                        const outputs = cell.outputs || [];
                        let outputText = "";
                        outputs.forEach((output: any) => {
                            if (output.text) {
                                outputText += (Array.isArray(output.text) ? output.text.join("") : output.text);
                            } else if (output.data && output.data["text/plain"]) {
                                const text = output.data["text/plain"];
                                outputText += (Array.isArray(text) ? text.join("") : text);
                            }
                        });
                        return {
                            path: `cell_${index}`,
                            relative_path: `Cell ${index + 1}`,
                            cellType: (cell.cell_type === 'markdown' || cell.cell_type === 'text') ? 'markdown' as const : 'code' as const,
                            is_dir: false,
                            size: source.length,
                            line_count: source.split('\n').length,
                            content: source,
                            output: outputText.trim()
                        };
                    }).filter((cell: any) => cell.content.trim().length > 0);
                }
            }

            if (window.IPython && window.IPython.notebook) {
                const nb = window.IPython.notebook;
                const cells = nb.get_cells ? nb.get_cells() : [];
                return cells.map((cell: any, index: number) => {
                    const source = cell.get_text ? cell.get_text() : "";
                    const outputs = cell.output_area ? cell.output_area.outputs : [];
                    let outputText = "";
                    outputs.forEach((output: any) => { if (output.text) outputText += output.text; });
                    return {
                        path: `cell_${index}`,
                        relative_path: `Cell ${index + 1}`,
                        cellType: (cell.cell_type === 'markdown' || cell.cell_type === 'text') ? 'markdown' as const : 'code' as const,
                        is_dir: false,
                        size: source.length,
                        line_count: source.split('\n').length,
                        content: source,
                        output: outputText.trim()
                    };
                }).filter((cell: any) => cell.content.trim().length > 0);
            }
        } catch (e) {
            console.warn("PromptPack: Error accessing Colab internal API", e);
        }
        return null;
    }

    function extractCellsFromMemory() {
        // STRATEGY: Use Monaco models for BOTH code and markdown cells.
        // Monaco stores ALL notebook cells as in-memory models with different language IDs:
        //   - Code cells: 'python', 'r', 'scala', 'sql'
        //   - Markdown cells: 'markdown'
        // We use getLanguageId() to classify, same proven mechanism as original code extraction.

        if (window.monaco && window.monaco.editor) {
            console.log("PromptPack: Extracting all cells from Monaco (live data)");
            const models = window.monaco.editor.getModels();

            // Determine known language IDs for classification
            const codeLangs = new Set(['python', 'r', 'scala', 'sql']);

            const validModels = models.filter((model: any) => {
                const lang = model.getLanguageId();
                const content = model.getValue();

                // Accept code languages AND markdown
                const isCode = codeLangs.has(lang) || lang.includes('python');
                const isMarkdown = lang === 'markdown';
                if (!isCode && !isMarkdown) return false;

                // Filter out Colab internal master scripts (code cells only)
                if (isCode) {
                    const isMasterScript = content.includes('# %%') || content.includes('get_ipython()');
                    if (isMasterScript) return false;
                }

                if (model.getValueLength() === 0) return false;
                if (model.uri.scheme !== 'inmemory') return false;
                return true;
            });

            if (validModels.length > 0) {
                // Sort by URI path number to maintain notebook order
                const sortedModels = validModels.sort((a: any, b: any) => {
                    const getLastNum = (uri: any) => parseInt(uri.path.split('/').pop()) || 0;
                    return getLastNum(a.uri) - getLastNum(b.uri);
                });

                // Try to match models to DOM cells for output extraction (code cells only)
                const editorInstances = window.monaco.editor.getEditors ? window.monaco.editor.getEditors() : [];
                const modelToCellMap = new Map();
                const modelContentMap = new Map();

                sortedModels.forEach((model: any, idx: number) => {
                    modelContentMap.set(model.getValue().trim().substring(0, 200), { model, index: idx });
                });

                editorInstances.forEach((editorInstance: any) => {
                    try {
                        const model = editorInstance.getModel();
                        if (!model) return;
                        const fingerprint = model.getValue().trim().substring(0, 200);
                        const modelInfo = modelContentMap.get(fingerprint);
                        if (modelInfo) {
                            const domNode = editorInstance.getDomNode();
                            if (domNode) {
                                let cellContainer = domNode;
                                for (let i = 0; i < 15 && cellContainer; i++) {
                                    cellContainer = cellContainer.parentElement;
                                    if (!cellContainer) break;
                                    const isCell = cellContainer.classList.contains('cell') ||
                                        cellContainer.hasAttribute('data-cell-id') ||
                                        cellContainer.tagName.toLowerCase() === 'colab-cell';
                                    if (isCell) {
                                        modelToCellMap.set(modelInfo.index, cellContainer);
                                        break;
                                    }
                                }
                            }
                        }
                    } catch (e) { }
                });

                let codeCount = 0;
                let mdCount = 0;

                const cells = sortedModels.map((model: any, index: number) => {
                    const lang = model.getLanguageId();
                    const content = model.getValue();
                    const isMarkdown = lang === 'markdown';

                    let outputText = "";
                    if (!isMarkdown) {
                        // Only extract output for code cells
                        const domCell = modelToCellMap.get(index);
                        if (domCell) {
                            const outputArea = domCell.querySelector('.output, .output-area, [class*="output"]');
                            if (outputArea) {
                                outputText = outputArea.innerText.trim();
                                if (outputText.length > 5000) {
                                    outputText = outputText.substring(0, 5000) + "\n... [Output Truncated] ...";
                                }
                            }
                        }
                    }

                    if (isMarkdown) mdCount++;
                    else codeCount++;

                    return {
                        path: `cell_${index}`,
                        relative_path: `Cell ${index + 1}`,
                        cellType: isMarkdown ? 'markdown' as const : 'code' as const,
                        is_dir: false,
                        size: content.length,
                        line_count: model.getLineCount(),
                        content,
                        output: outputText
                    };
                });

                console.log("PromptPack: Extracted", cells.length, "cells from Monaco (" + codeCount + " code, " + mdCount + " markdown)");
                return cells;
            }
        }

        // FALLBACK: Colab internal API (stale data, only updates on execution/save)
        console.log("PromptPack: Monaco not available, falling back to Colab internal API (may be stale)");
        const colabCells = tryColabInternalAPI();
        if (colabCells && colabCells.length > 0) {
            console.log("PromptPack: Extracted", colabCells.length, "cells from Colab API");
            return colabCells;
        }

        console.warn("PromptPack: No cells found via any extraction method");
        return [];
    }

    /**
     * Detect the currently focused cell by checking which Monaco editor has text focus.
     * Returns the index into the sorted valid models list, or null if no cell is focused.
     */
    function getActiveCellIndex(): number | null {
        if (!window.monaco || !window.monaco.editor) return null;

        const editors = window.monaco.editor.getEditors ? window.monaco.editor.getEditors() : [];
        const models = window.monaco.editor.getModels();
        const codeLangs = new Set(['python', 'r', 'scala', 'sql']);

        // Build the same sorted valid models list used by extractCellsFromMemory
        const validModels = models.filter((model: any) => {
            const lang = model.getLanguageId();
            const content = model.getValue();
            const isCode = codeLangs.has(lang) || lang.includes('python');
            const isMarkdown = lang === 'markdown';
            if (!isCode && !isMarkdown) return false;
            if (isCode) {
                const isMasterScript = content.includes('# %%') || content.includes('get_ipython()');
                if (isMasterScript) return false;
            }
            if (model.getValueLength() === 0) return false;
            if (model.uri.scheme !== 'inmemory') return false;
            return true;
        });

        const sortedModels = validModels.sort((a: any, b: any) => {
            const getLastNum = (uri: any) => parseInt(uri.path.split('/').pop()) || 0;
            return getLastNum(a.uri) - getLastNum(b.uri);
        });

        // Build a URI -> index map for quick lookup
        const uriToIndex = new Map<string, number>();
        sortedModels.forEach((model: any, idx: number) => {
            uriToIndex.set(model.uri.toString(), idx);
        });

        // Find the editor with text focus
        for (const editor of editors) {
            try {
                if (editor.hasTextFocus && editor.hasTextFocus()) {
                    const model = editor.getModel();
                    if (model) {
                        const idx = uriToIndex.get(model.uri.toString());
                        if (idx !== undefined) {
                            console.log("PromptPack: Active cell detected at index", idx);
                            return idx;
                        }
                    }
                }
            } catch (e) { }
        }

        console.log("PromptPack: No focused cell detected");
        return null;
    }
})();
