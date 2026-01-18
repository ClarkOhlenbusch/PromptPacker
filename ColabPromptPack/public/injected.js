// PromptPack: Injected Script to access Colab Internals
(function() {
  console.log("PromptPack: Injected script running in page context.");

  // Security: Define the expected origin for postMessage communication
  const COLAB_ORIGIN = "https://colab.research.google.com";

  // Cell history tracking for diff functionality
  // Maps cell path -> array of { content, timestamp, output }
  const cellHistory = new Map();
  const MAX_HISTORY_PER_CELL = 10;

  // Store a snapshot of current cells
  function snapshotCells(cells) {
    const timestamp = Date.now();
    cells.forEach(cell => {
      if (!cellHistory.has(cell.path)) {
        cellHistory.set(cell.path, []);
      }
      const history = cellHistory.get(cell.path);
      const lastEntry = history[history.length - 1];

      // Only store if content changed
      if (!lastEntry || lastEntry.content !== cell.content) {
        history.push({
          content: cell.content,
          output: cell.output || "",
          timestamp: timestamp
        });

        // Limit history size
        if (history.length > MAX_HISTORY_PER_CELL) {
          history.shift();
        }
      }
    });
  }

  // Compute line-by-line diff between two strings
  function computeDiff(oldContent, newContent) {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');

    const diff = [];
    const maxLen = Math.max(oldLines.length, newLines.length);

    // Simple line-by-line comparison with context
    let i = 0, j = 0;

    while (i < oldLines.length || j < newLines.length) {
      const oldLine = i < oldLines.length ? oldLines[i] : null;
      const newLine = j < newLines.length ? newLines[j] : null;

      if (oldLine === newLine) {
        diff.push({ type: 'unchanged', line: oldLine, oldLineNum: i + 1, newLineNum: j + 1 });
        i++;
        j++;
      } else if (oldLine !== null && !newLines.slice(j).includes(oldLine)) {
        // Line was removed
        diff.push({ type: 'removed', line: oldLine, oldLineNum: i + 1, newLineNum: null });
        i++;
      } else if (newLine !== null && !oldLines.slice(i).includes(newLine)) {
        // Line was added
        diff.push({ type: 'added', line: newLine, oldLineNum: null, newLineNum: j + 1 });
        j++;
      } else if (oldLine !== newLine) {
        // Modified line - show both
        diff.push({ type: 'removed', line: oldLine, oldLineNum: i + 1, newLineNum: null });
        diff.push({ type: 'added', line: newLine, oldLineNum: null, newLineNum: j + 1 });
        i++;
        j++;
      }
    }

    return diff;
  }

  // Get diff for a specific cell
  function getCellDiff(cellPath) {
    const history = cellHistory.get(cellPath);
    if (!history || history.length < 2) {
      return null; // No previous version to compare
    }

    const current = history[history.length - 1];
    const previous = history[history.length - 2];

    return {
      previous: {
        content: previous.content,
        output: previous.output,
        timestamp: previous.timestamp
      },
      current: {
        content: current.content,
        output: current.output,
        timestamp: current.timestamp
      },
      diff: computeDiff(previous.content, current.content)
    };
  }

  // Get all cells with changes
  function getAllCellDiffs() {
    const diffs = [];
    cellHistory.forEach((history, path) => {
      if (history.length >= 2) {
        const current = history[history.length - 1];
        const previous = history[history.length - 2];

        // Only include if there are actual changes
        if (previous.content !== current.content) {
          diffs.push({
            path: path,
            relative_path: `Cell ${parseInt(path.replace('cell_', '')) + 1}`,
            previous: {
              content: previous.content,
              output: previous.output,
              timestamp: previous.timestamp
            },
            current: {
              content: current.content,
              output: current.output,
              timestamp: current.timestamp
            },
            diff: computeDiff(previous.content, current.content)
          });
        }
      }
    });
    return diffs;
  }

  // Clear history for a cell or all cells
  function clearHistory(cellPath = null) {
    if (cellPath) {
      cellHistory.delete(cellPath);
    } else {
      cellHistory.clear();
    }
  }

  // Take a manual snapshot (for "mark as baseline" functionality)
  function takeSnapshot() {
    const cells = extractCellsFromMemory();
    snapshotCells(cells);
    return cells.length;
  }

  // Signal that injected script is ready
  window.postMessage({ type: "PROMPTPACK_INJECTED_READY" }, COLAB_ORIGIN);

  window.addEventListener("message", (event) => {
    // Security: Only accept messages from the expected origin and same window
    if (event.source !== window || event.origin !== COLAB_ORIGIN) return;

    if (event.data.type === "PROMPTPACK_REQUEST_CELLS") {
      try {
        const cells = extractCellsFromMemory();
        // Auto-snapshot cells on each fetch
        snapshotCells(cells);
        window.postMessage({
          type: "PROMPTPACK_RESPONSE_CELLS",
          cells: cells
        }, COLAB_ORIGIN);
      } catch (e) {
        console.error("PromptPack Extraction Error:", e);
        window.postMessage({
          type: "PROMPTPACK_RESPONSE_ERROR",
          error: e.message
        }, COLAB_ORIGIN);
      }
    } else if (event.data.type === "PROMPTPACK_REQUEST_DIFFS") {
      try {
        const diffs = getAllCellDiffs();
        window.postMessage({
          type: "PROMPTPACK_RESPONSE_DIFFS",
          diffs: diffs
        }, COLAB_ORIGIN);
      } catch (e) {
        console.error("PromptPack Diff Error:", e);
        window.postMessage({
          type: "PROMPTPACK_RESPONSE_ERROR",
          error: e.message
        }, COLAB_ORIGIN);
      }
    } else if (event.data.type === "PROMPTPACK_TAKE_SNAPSHOT") {
      try {
        const count = takeSnapshot();
        window.postMessage({
          type: "PROMPTPACK_SNAPSHOT_TAKEN",
          cellCount: count
        }, COLAB_ORIGIN);
      } catch (e) {
        console.error("PromptPack Snapshot Error:", e);
        window.postMessage({
          type: "PROMPTPACK_RESPONSE_ERROR",
          error: e.message
        }, COLAB_ORIGIN);
      }
    } else if (event.data.type === "PROMPTPACK_CLEAR_HISTORY") {
      clearHistory(event.data.cellPath);
      window.postMessage({
        type: "PROMPTPACK_HISTORY_CLEARED"
      }, COLAB_ORIGIN);
    }
  });

  // Try to access Colab's internal notebook API for more reliable data extraction
  function tryColabInternalAPI() {
    try {
      // Method 1: Try colab.global.notebook
      if (window.colab && window.colab.global && window.colab.global.notebook) {
        const notebook = window.colab.global.notebook;
        console.log("PromptPack: Found colab.global.notebook", notebook);

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

      // Method 2: Try accessing via google.colab
      if (window.google && window.google.colab && window.google.colab.kernel) {
        console.log("PromptPack: Found google.colab.kernel");
        // This typically provides kernel communication, not direct cell access
      }

      // Method 3: Check for IPython/Jupyter style notebook object
      if (window.IPython && window.IPython.notebook) {
        console.log("PromptPack: Found IPython.notebook");
        const nb = window.IPython.notebook;
        const cells = nb.get_cells ? nb.get_cells() : [];
        return cells.map((cell, index) => {
          const source = cell.get_text ? cell.get_text() : "";
          const outputs = cell.output_area ? cell.output_area.outputs : [];
          let outputText = "";

          outputs.forEach(output => {
            if (output.text) outputText += output.text;
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

      // Log available globals for debugging
      const colabGlobals = [];
      if (window.colab) colabGlobals.push("colab");
      if (window.google) colabGlobals.push("google");
      if (window.IPython) colabGlobals.push("IPython");
      if (window._nb) colabGlobals.push("_nb");
      console.log("PromptPack: Available Colab-related globals:", colabGlobals.join(", ") || "none found");

    } catch (e) {
      console.warn("PromptPack: Error accessing Colab internal API", e);
    }

    return null; // Fallback to DOM/Monaco approach
  }

  function extractCellsFromMemory() {
    const results = [];

    // Try Colab's internal API first (most reliable if available)
    const colabCells = tryColabInternalAPI();
    if (colabCells && colabCells.length > 0) {
      console.log("PromptPack: Using Colab internal API - found", colabCells.length, "cells");
      return colabCells;
    }

    // Fallback to Monaco + DOM approach
    // 1. Get Code from Monaco (High Fidelity)
    if (window.monaco && window.monaco.editor) {
      const models = window.monaco.editor.getModels();
      
      // Filter for valid notebook cells
      const validModels = models.filter(model => {
        const lang = model.getLanguageId();
        const content = model.getValue();
        
        // Must be code
        const isCode = lang.includes('python') || lang === 'r' || lang === 'scala' || lang === 'sql';
        if (!isCode) return false;

        // Exclude Master Script
        const isMasterScript = content.includes('# %%') || content.includes('get_ipython()');
        if (isMasterScript) return false;

        if (model.getValueLength() === 0) return false;
        if (model.uri.scheme !== 'inmemory') return false;
        
        return true;
      });

      // Sort models by URI ID (approximate creation order)
      // Note: This is imperfect but usually matches the execution order in simple cases.
      // A better way is strictly visual order if we can map it.
      const sortedModels = validModels.sort((a, b) => {
        const getLastNum = (uri) => {
            const parts = uri.path.split('/');
            const last = parts.pop();
            return parseInt(last) || 0;
        };
        return getLastNum(a.uri) - getLastNum(b.uri);
      });

      // 2. Get Outputs from DOM
      // Colab's DOM structure varies, so we try multiple selectors
      // Strategy: Find monaco editor instances and match them to models, then find outputs

      // Build a map of model content hash -> model for matching
      const modelContentMap = new Map();
      sortedModels.forEach((model, idx) => {
        const content = model.getValue().trim();
        // Use first 200 chars as a fingerprint (enough to be unique usually)
        const fingerprint = content.substring(0, 200);
        modelContentMap.set(fingerprint, { model, index: idx });
      });

      // Find all monaco editor instances in the DOM and try to match them to models
      const editorInstances = window.monaco.editor.getEditors ? window.monaco.editor.getEditors() : [];
      console.log(`PromptPack: Found ${editorInstances.length} editor instances via monaco API`);

      // Map to store: model index -> DOM cell container
      const modelToCellMap = new Map();

      editorInstances.forEach(editorInstance => {
        try {
          const model = editorInstance.getModel();
          if (!model) return;

          const content = model.getValue().trim();
          const fingerprint = content.substring(0, 200);
          const modelInfo = modelContentMap.get(fingerprint);

          if (modelInfo) {
            // Find the DOM element for this editor
            const domNode = editorInstance.getDomNode();
            if (domNode) {
              // Traverse up to find the cell container
              let cellContainer = domNode;
              for (let i = 0; i < 15 && cellContainer; i++) {
                cellContainer = cellContainer.parentElement;
                if (!cellContainer) break;

                const isCell = cellContainer.classList.contains('cell') ||
                               cellContainer.hasAttribute('data-cell-id') ||
                               cellContainer.tagName.toLowerCase() === 'colab-cell' ||
                               cellContainer.classList.contains('codecell') ||
                               cellContainer.id?.includes('cell');

                if (isCell) {
                  modelToCellMap.set(modelInfo.index, cellContainer);
                  console.log(`PromptPack: Matched model ${modelInfo.index} to DOM cell`);
                  break;
                }
              }
            }
          }
        } catch (e) {
          console.warn("PromptPack: Error matching editor to model", e);
        }
      });

      // Fallback: If few matches via editor instances, try positional matching with ALL cell containers
      // Colab virtualizes cells - only visible ones have Monaco editors, but cell containers may exist
      if (modelToCellMap.size < sortedModels.length) {
        console.log("PromptPack: Attempting to find additional cells via DOM structure");

        // Find all cell containers in the notebook (Colab uses different structures)
        const cellSelectors = [
          'div.cell',
          '[data-cell-id]',
          'colab-cell',
          '.codecell-input-output',
          'div[class*="cell-"]'
        ];

        let allCellContainers = [];
        for (const selector of cellSelectors) {
          const found = Array.from(document.querySelectorAll(selector));
          if (found.length > 0) {
            console.log(`PromptPack: Found ${found.length} elements with selector "${selector}"`);
            // Filter to only code cells (have code-like children or specific attributes)
            const codeCells = found.filter(el => {
              // Check if it looks like a code cell
              const hasMonaco = el.querySelector('.monaco-editor') !== null;
              const hasCodeMirror = el.querySelector('.CodeMirror') !== null;
              const hasOutput = el.querySelector('[class*="output"]') !== null;
              const isCodeType = el.getAttribute('data-type') === 'code' ||
                                 el.classList.contains('code') ||
                                 el.querySelector('.code') !== null;
              return hasMonaco || hasCodeMirror || hasOutput || isCodeType;
            });
            if (codeCells.length > 0) {
              allCellContainers = codeCells;
              break;
            }
          }
        }

        console.log(`PromptPack: Found ${allCellContainers.length} code cell containers in DOM`);

        // Map cells by position - if we have same number as models, assume 1:1 mapping
        if (allCellContainers.length >= sortedModels.length) {
          allCellContainers.forEach((cell, idx) => {
            if (idx < sortedModels.length && !modelToCellMap.has(idx)) {
              modelToCellMap.set(idx, cell);
            }
          });
        } else if (allCellContainers.length > 0) {
          // Partial match - assign what we can
          allCellContainers.forEach((cell, idx) => {
            if (idx < sortedModels.length && !modelToCellMap.has(idx)) {
              modelToCellMap.set(idx, cell);
            }
          });
        }
      }

      console.log(`PromptPack: Matched ${modelToCellMap.size} of ${sortedModels.length} models to DOM cells.`);

      sortedModels.forEach((model, index) => {
        const content = model.getValue();
        let outputText = "";

        // Try to match with DOM using our map
        const domCell = modelToCellMap.get(index);
        if (domCell) {

            // Try multiple selectors for output areas (Colab DOM varies)
            const outputSelectors = [
              '.output',
              '.output-area',
              '.outputarea',
              '[class*="output"]',
              '.cell-output',
              'colab-cell-output',
              '.output_subarea',
              '.output_text'
            ];

            let outputArea = null;
            for (const selector of outputSelectors) {
              outputArea = domCell.querySelector(selector);
              if (outputArea && outputArea.innerText.trim().length > 0) {
                break;
              }
            }

            // Fallback: look for any element after the monaco editor that might contain output
            if (!outputArea || outputArea.innerText.trim().length === 0) {
              const monacoInCell = domCell.querySelector('.monaco-editor');
              if (monacoInCell) {
                // Look for siblings or subsequent elements that might be output
                let sibling = monacoInCell.parentElement;
                while (sibling && sibling.parentElement !== domCell) {
                  sibling = sibling.parentElement;
                }
                if (sibling) {
                  let nextSibling = sibling.nextElementSibling;
                  while (nextSibling) {
                    const text = nextSibling.innerText?.trim();
                    if (text && text.length > 0 && !nextSibling.querySelector('.monaco-editor')) {
                      outputArea = nextSibling;
                      break;
                    }
                    nextSibling = nextSibling.nextElementSibling;
                  }
                }
              }
            }

            if (outputArea) {
                // Get text, but truncate if massive
                outputText = outputArea.innerText.trim();
                if (outputText.length > 5000) {
                    outputText = outputText.substring(0, 5000) + "\n... [Output Truncated] ...";
                }
                console.log(`PromptPack: Cell ${index + 1} output found (${outputText.length} chars)`);
            } else {
                console.log(`PromptPack: Cell ${index + 1} no output area found in DOM`);
            }
        } else {
            console.log(`PromptPack: Cell ${index + 1} has no matched DOM cell`);
        }

        results.push({
          path: `cell_${index}`,
          relative_path: `Cell ${index + 1}`,
          is_dir: false,
          size: content.length,
          line_count: model.getLineCount(),
          content: content,
          output: outputText
        });
      });
      
      return results;
    }

    return [];
  }
})();
