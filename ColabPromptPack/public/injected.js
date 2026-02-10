// PromptPack: Injected Script to access Colab Internals
// This script only extracts cell data - diff logic is handled in the React app
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
      } catch (e) {
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
          return cells.map((cell, index) => {
            const source = cell.source || cell.text || cell.code || "";
            const outputs = cell.outputs || [];
            let outputText = "";
            outputs.forEach(output => {
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
              is_dir: false,
              size: source.length,
              line_count: source.split('\n').length,
              content: source,
              output: outputText.trim()
            };
          }).filter(cell => cell.content.trim().length > 0);
        }
      }

      if (window.IPython && window.IPython.notebook) {
        const nb = window.IPython.notebook;
        const cells = nb.get_cells ? nb.get_cells() : [];
        return cells.map((cell, index) => {
          const source = cell.get_text ? cell.get_text() : "";
          const outputs = cell.output_area ? cell.output_area.outputs : [];
          let outputText = "";
          outputs.forEach(output => { if (output.text) outputText += output.text; });
          return {
            path: `cell_${index}`,
            relative_path: `Cell ${index + 1}`,
            is_dir: false,
            size: source.length,
            line_count: source.split('\n').length,
            content: source,
            output: outputText.trim()
          };
        }).filter(cell => cell.content.trim().length > 0);
      }
    } catch (e) {
      console.warn("PromptPack: Error accessing Colab internal API", e);
    }
    return null;
  }

  function extractCellsFromMemory() {
    // PRIORITY 1: Try Monaco first (has LIVE editor content, updates on every keystroke)
    if (window.monaco && window.monaco.editor) {
      console.log("PromptPack: Extracting cells from Monaco (live data)");
      const models = window.monaco.editor.getModels();
      const validModels = models.filter(model => {
        const lang = model.getLanguageId();
        const content = model.getValue();
        const isCode = lang.includes('python') || lang === 'r' || lang === 'scala' || lang === 'sql';
        if (!isCode) return false;
        const isMasterScript = content.includes('# %%') || content.includes('get_ipython()');
        if (isMasterScript) return false;
        if (model.getValueLength() === 0) return false;
        if (model.uri.scheme !== 'inmemory') return false;
        return true;
      });

      if (validModels.length > 0) {
        const sortedModels = validModels.sort((a, b) => {
          const getLastNum = (uri) => parseInt(uri.path.split('/').pop()) || 0;
          return getLastNum(a.uri) - getLastNum(b.uri);
        });

        // Try to match models to DOM cells for output extraction
        const editorInstances = window.monaco.editor.getEditors ? window.monaco.editor.getEditors() : [];
        const modelToCellMap = new Map();
        const modelContentMap = new Map();

        sortedModels.forEach((model, idx) => {
          modelContentMap.set(model.getValue().trim().substring(0, 200), { model, index: idx });
        });

        editorInstances.forEach(editorInstance => {
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

        const cells = sortedModels.map((model, index) => {
          const content = model.getValue();
          let outputText = "";
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
          return {
            path: `cell_${index}`,
            relative_path: `Cell ${index + 1}`,
            is_dir: false,
            size: content.length,
            line_count: model.getLineCount(),
            content,
            output: outputText
          };
        });

        console.log("PromptPack: Extracted", cells.length, "cells from Monaco");
        return cells;
      }
    }

    // PRIORITY 2: Fallback to Colab internal API (STALE data, only updates on execution/save)
    console.log("PromptPack: Monaco not available, falling back to Colab internal API (may be stale)");
    const colabCells = tryColabInternalAPI();
    if (colabCells && colabCells.length > 0) {
      console.log("PromptPack: Extracted", colabCells.length, "cells from Colab API");
      return colabCells;
    }

    console.warn("PromptPack: No cells found via any extraction method");
    return [];
  }
})();
