export { };

import {
  ApplyCellUpdateResult,
  ApplyCellUpdatesPayload,
  ApplyCellUpdatesResult,
  CellUpdate,
  ExecuteCellsRequest,
  ExecuteCellsResult,
  NotebookMetadata,
} from "./types/agent";

// PromptPack: Injected Script to access Colab Internals
// This script extracts and mutates notebook cell data from page context.

declare global {
  interface Window {
    colab?: any;
    IPython?: any;
    monaco?: any;
  }
}

const CODE_LANGS = new Set(["python", "r", "scala", "sql"]);

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function parseCellIndex(cellPath?: string, relativePath?: string): number | null {
  const parseCandidate = (value?: string): number | null => {
    if (!value) return null;

    const trimmed = value.trim();
    if (!trimmed) return null;

    const direct = /^cell_(\d+)$/i.exec(trimmed);
    if (direct) {
      const parsed = parseInt(direct[1], 10);
      return Number.isNaN(parsed) ? null : parsed;
    }

    const strippedName = trimmed
      .replace(/^.*[\\/]/, "")
      .replace(/\.[^.]+$/, "");

    const patterns = [
      /(?:^|[^a-z0-9])cell[_\s-]?(\d+)(?:[^a-z0-9]|$)/i,
      /cell\s+(\d+)/i,
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(strippedName) || pattern.exec(trimmed);
      if (!match) continue;
      const parsed = parseInt(match[1], 10);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }

    const bareNumber = /^(\d+)$/.exec(strippedName);
    if (bareNumber) {
      const parsed = parseInt(bareNumber[1], 10);
      return Number.isNaN(parsed) ? null : parsed;
    }

    return null;
  };

  const fromCellPath = parseCandidate(cellPath);
  if (fromCellPath !== null) return fromCellPath;

  const fromRelativePath = parseCandidate(relativePath);
  if (fromRelativePath !== null) {
    // Human labels are often 1-based ("Cell 1"), convert when clearly label-style.
    if (relativePath && /cell\s+\d+/i.test(relativePath.trim())) {
      return Math.max(0, fromRelativePath - 1);
    }
    return fromRelativePath;
  }

  return null;
}

function callMaybeAsync(fn: Function, ctx: any, ...args: any[]): Promise<any> {
  try {
    const result = fn.apply(ctx, args);
    if (result && typeof result.then === "function") {
      return result;
    }
    return Promise.resolve(result);
  } catch (e) {
    return Promise.reject(e);
  }
}

function isValidNotebookModel(model: any): boolean {
  const lang = model.getLanguageId();
  const content = model.getValue();

  const isCode = CODE_LANGS.has(lang) || lang.includes("python");
  const isMarkdown = lang === "markdown";
  if (!isCode && !isMarkdown) return false;

  if (isCode) {
    const isMasterScript = content.includes("# %%") || content.includes("get_ipython()");
    if (isMasterScript) return false;
  }

  if (model.uri.scheme !== "inmemory") return false;
  return true;
}

function getNotebookModel(): any | null {
  return window.colab?.global?.notebookModel || window.colab?.global?.notebook?.getNotebookModel?.() || null;
}

function getNativeCells(): any[] | null {
  const notebook = getNotebookModel();
  const cells = notebook?.getCells?.() ?? notebook?.cells;
  if (!Array.isArray(cells) || !cells.every(cell =>
    typeof cell.getId === "function" && typeof cell.getTextModel === "function"
  )) return null;
  return cells;
}

function cellIdForModel(model: any): string | undefined {
  return getNativeCells()?.find(cell => cell.getTextModel() === model)?.getId();
}

function getSortedValidModels(): any[] {
  // The notebook model supplies actual notebook order, persistent IDs, and
  // empty cells. Monaco URI allocation order changes after insertions/reloads.
  const nativeCells = getNativeCells();
  if (nativeCells) return nativeCells.map(cell => cell.getTextModel());
  if (!window.monaco || !window.monaco.editor) return [];

  const models = window.monaco.editor.getModels();
  const validModels = models.filter((model: any) => isValidNotebookModel(model));

  return validModels.sort((a: any, b: any) => {
    const getLastNum = (uri: any) => parseInt(uri.path.split("/").pop()) || 0;
    return getLastNum(a.uri) - getLastNum(b.uri);
  });
}

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
            cellType: (cell.cell_type === "markdown" || cell.cell_type === "text") ? "markdown" as const : "code" as const,
            is_dir: false,
            size: source.length,
            line_count: source.split("\n").length,
            content: source,
            output: outputText.trim(),
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
        outputs.forEach((output: any) => {
          if (output.text) outputText += output.text;
        });

        return {
          path: `cell_${index}`,
          relative_path: `Cell ${index + 1}`,
          cellType: (cell.cell_type === "markdown" || cell.cell_type === "text") ? "markdown" as const : "code" as const,
          is_dir: false,
          size: source.length,
          line_count: source.split("\n").length,
          content: source,
          output: outputText.trim(),
        };
      }).filter((cell: any) => cell.content.trim().length > 0);
    }
  } catch (e) {
    console.warn("PromptPack: Error accessing Colab internal API", e);
  }
  return null;
}

function extractCellsFromMemory() {
  if (window.monaco && window.monaco.editor) {
    const sortedModels = getSortedValidModels();

    if (sortedModels.length > 0) {
      const editorInstances = window.monaco.editor.getEditors ? window.monaco.editor.getEditors() : [];
      const modelToCellMap = new Map<number, HTMLElement>();
      const modelContentMap = new Map<string, { model: any; index: number }>();

      sortedModels.forEach((model: any, idx: number) => {
        modelContentMap.set(model.getValue().trim().substring(0, 200), { model, index: idx });
      });

      editorInstances.forEach((editorInstance: any) => {
        try {
          const model = editorInstance.getModel();
          if (!model) return;

          const fingerprint = model.getValue().trim().substring(0, 200);
          const modelInfo = modelContentMap.get(fingerprint);
          if (!modelInfo) return;

          const domNode = editorInstance.getDomNode();
          if (!domNode) return;

          let cellContainer: HTMLElement | null = domNode;
          for (let i = 0; i < 15 && cellContainer; i++) {
            cellContainer = cellContainer.parentElement;
            if (!cellContainer) break;
            const isCell = cellContainer.classList.contains("cell") ||
              cellContainer.hasAttribute("data-cell-id") ||
              cellContainer.tagName.toLowerCase() === "colab-cell";

            if (isCell) {
              modelToCellMap.set(modelInfo.index, cellContainer);
              break;
            }
          }
        } catch {
          // Ignore best-effort mapping failures.
        }
      });

      let codeCount = 0;
      let markdownCount = 0;

      const cells = sortedModels.map((model: any, index: number) => {
        const lang = model.getLanguageId();
        const content = model.getValue();
        const isMarkdown = lang === "markdown";

        let outputText = "";
        if (!isMarkdown) {
          const domCell = modelToCellMap.get(index);
          if (domCell) {
            const outputArea = domCell.querySelector(".output, .output-area, [class*='output']");
            if (outputArea) {
              outputText = outputArea.textContent?.trim() ?? "";
              if (outputText.length > 5000) {
                outputText = `${outputText.substring(0, 5000)}\n... [Output Truncated] ...`;
              }
            }
          }
        }

        if (isMarkdown) markdownCount += 1;
        else codeCount += 1;

        return {
          path: `cell_${index}`,
          relative_path: `Cell ${index + 1}`,
          cellType: isMarkdown ? "markdown" as const : "code" as const,
          cellId: cellIdForModel(model),
          is_dir: false,
          size: content.length,
          line_count: model.getLineCount(),
          content,
          output: outputText,
        };
      });

      console.log(`PromptPack: Extracted ${cells.length} cells from Monaco (${codeCount} code, ${markdownCount} markdown)`);
      return cells;
    }
  }

  const colabCells = tryColabInternalAPI();
  if (colabCells && colabCells.length > 0) {
    console.log("PromptPack: Extracted", colabCells.length, "cells from Colab API");
    return colabCells;
  }

  console.warn("PromptPack: No cells found via any extraction method");
  return [];
}

function getActiveCellIndex(): number | null {
  if (!window.monaco || !window.monaco.editor) return null;

  const editors = window.monaco.editor.getEditors ? window.monaco.editor.getEditors() : [];
  const sortedModels = getSortedValidModels();

  const uriToIndex = new Map<string, number>();
  sortedModels.forEach((model: any, idx: number) => {
    uriToIndex.set(model.uri.toString(), idx);
  });

  for (const editor of editors) {
    try {
      if (editor.hasTextFocus && editor.hasTextFocus()) {
        const model = editor.getModel();
        if (!model) continue;

        const idx = uriToIndex.get(model.uri.toString());
        if (idx !== undefined) {
          return idx;
        }
      }
    } catch {
      // Ignore best-effort focus lookups.
    }
  }

  return null;
}

function applyCellUpdates(payload: ApplyCellUpdatesPayload): ApplyCellUpdatesResult {
  const updates = payload?.updates ?? [];
  const mode = payload?.mode ?? "best-effort";
  const models = getSortedValidModels();
  const validations: Array<{ update: CellUpdate; index: number | null; model: any | null; append?: boolean; currentHash?: string; reason?: string }> = [];

  updates.forEach((update) => {
    const nativeCells = getNativeCells();
    if (update.operation === "append") {
      const existing = nativeCells?.find(cell => cell.getId() === update.cellId);
      if (!update.cellId || !/^[a-zA-Z0-9_-]{1,64}$/.test(update.cellId) || !["code", "markdown"].includes(update.cellType || "")) {
        validations.push({ update, index: null, model: null, reason: "Invalid new cell ID or type" });
      } else if (existing) {
        // A lost acknowledgement/reconnect must not create a duplicate or
        // overwrite a cell the user subsequently edited.
        const model = existing.getTextModel();
        validations.push({ update, index: nativeCells!.indexOf(existing), model,
          currentHash: hashString(model.getValue()),
          ...(model.getValue() === update.newContent ? {} : { reason: "base_hash_mismatch" }),
        });
      } else {
        const notebook = window.colab?.global?.notebook;
        const available = nativeCells && typeof notebook?.addNewCell === "function"
          && typeof getNotebookModel()?.createCellFromJson === "function";
        const editable = typeof notebook?.isEditable === "function" && notebook.isEditable();
        validations.push({ update, index: null, model: null, append: true,
          ...(!available ? { reason: "This Colab version does not expose cell creation. Your new cell file was preserved." }
            : !editable ? { reason: "This notebook is read-only. Open an editable copy in Colab, then retry sync." } : {}),
        });
      }
      return;
    }
    // Structural operations require stable IDs and an editable notebook.
    if (["move", "delete"].includes(update.operation || "")) {
      const notebook = window.colab?.global?.notebook;
      const cell = nativeCells?.find(item => item.getId() === update.cellId);
      const model = cell?.getTextModel();
      let reason: string | undefined;
      if (!update.cellId || !cell || !model) reason = "Cell not found in current notebook";
      else if (typeof notebook?.isEditable !== "function" || !notebook.isEditable()) reason = "This notebook is read-only";
      else if (update.baseHash && hashString(model.getValue()) !== update.baseHash) reason = "base_hash_mismatch";
      else if (update.operation === "move" && update.afterCellId && (!nativeCells?.some(item => item.getId() === update.afterCellId) || update.afterCellId === update.cellId)) reason = "Move destination not found or is the same cell";
      else if (update.operation === "move" && update.beforeCellId && (!nativeCells?.some(item => item.getId() === update.beforeCellId) || update.beforeCellId === update.cellId)) reason = "Move destination not found or is the same cell";
      validations.push({ update, index: cell ? nativeCells!.indexOf(cell) : null, model, currentHash: model ? hashString(model.getValue()) : undefined, reason });
      return;
    }
    // If a known ID is gone, fail safely rather than editing its former neighbor.
    const index = update.cellId
      ? nativeCells?.findIndex(cell => cell.getId() === update.cellId) ?? -1
      : parseCellIndex(update.cellPath, update.relativePath);
    if (index === null || index < 0 || index >= models.length) {
      validations.push({
        update,
        index,
        model: null,
        reason: "Cell not found in current notebook order",
      });
      return;
    }

    const model = models[index];
    const current = model.getValue();
    const currentHash = hashString(current);

    if (current !== update.newContent && update.baseHash && update.baseHash !== currentHash) {
      validations.push({
        update,
        index,
        model,
        currentHash,
        reason: "base_hash_mismatch",
      });
      return;
    }

    validations.push({
      update,
      index,
      model,
      currentHash,
    });
  });

  if (mode === "all-or-nothing" && validations.some((v) => !!v.reason)) {
    return {
      success: false,
      results: validations.map((v) => ({
        cellPath: v.update.cellPath,
        applied: false,
        reason: v.reason || "validation_failed",
        previousHash: v.currentHash,
        currentHash: v.currentHash,
        changeId: v.update.changeId,
      })),
    };
  }

  const results: ApplyCellUpdateResult[] = validations.map((validation) => {
    const { update, model, reason, currentHash } = validation;

    if (reason || (!model && !validation.append)) {
      return {
        cellPath: update.cellPath,
        applied: false,
        reason: reason || "Unknown error",
        previousHash: currentHash,
        currentHash,
        changeId: update.changeId,
      };
    }

    try {
      if (validation.append) {
        const notebook = window.colab!.global.notebook;
        const notebookModel = getNotebookModel();
        const cells = getNativeCells()!;
        const json = {
          cell_type: update.cellType,
          id: update.cellId,
          metadata: { id: update.cellId },
          source: update.newContent,
          ...(update.cellType === "code" ? { outputs: [], execution_count: null } : {}),
        };
        const cell = notebookModel.createCellFromJson(json);
        // addNewCell follows Colab's normal permissions, undo, and save path.
        notebook.addNewCell(update.cellType === "markdown" ? "text" : "code", cells.length, cell);
        const inserted = getNativeCells()!.find(item => item.getId() === update.cellId);
        if (!inserted || inserted.getTextModel().getValue() !== update.newContent) {
          throw new Error("Colab did not confirm the new cell. Your file was preserved; retry sync.");
        }
        return {
          cellPath: update.cellPath,
          cellId: inserted.getId(),
          notebookCellPath: `cell_${getNativeCells()!.indexOf(inserted)}`,
          applied: true,
          currentHash: hashString(inserted.getTextModel().getValue()),
          changeId: update.changeId,
        };
      }
      if (update.operation === "move" || update.operation === "delete") {
        const notebookModel = getNotebookModel();
        const cells = getNativeCells()!;
        const cell = cells.find(item => item.getId() === update.cellId)!;
        if (update.operation === "move") {
          if (typeof notebookModel?.moveCells !== "function") throw new Error("Colab does not expose cell movement");
          const withoutTarget = cells.filter(item => item !== cell);
          const anchor = update.beforeCellId
            ? withoutTarget[withoutTarget.findIndex(item => item.getId() === update.beforeCellId) - 1]
            : update.afterCellId ? cells.find(item => item.getId() === update.afterCellId) : undefined;
          notebookModel.moveCells(anchor, [cell]);
          const moved = getNativeCells()!;
          const index = moved.findIndex(item => item.getId() === update.cellId);
          if (index !== (anchor ? moved.indexOf(anchor) + 1 : 0)) throw new Error("Colab did not confirm the move");
        } else if (update.operation === "delete") {
          if (typeof notebookModel?.deleteCells !== "function") throw new Error("Colab does not expose cell deletion");
          notebookModel.deleteCells([cell]);
          if (getNativeCells()!.some(item => item.getId() === update.cellId)) throw new Error("Colab did not confirm the deletion");
        }
        return { cellPath: update.cellPath, cellId: update.cellId, applied: true, previousHash: currentHash, currentHash, changeId: update.changeId };
      }
      model.pushStackElement?.();
      // Colab's own setter records a normal editor undo operation and dirty state.
      const nativeCell = getNativeCells()?.find(cell => cell.getTextModel() === model);
      if (model.getValue() !== update.newContent) {
        if (nativeCell?.setText) nativeCell.setText(update.newContent);
        else model.setValue(update.newContent);
      }
      model.pushStackElement?.();

      const finalHash = hashString(model.getValue());
      return {
        cellPath: update.cellPath,
        cellId: cellIdForModel(model),
        notebookCellPath: `cell_${getSortedValidModels().indexOf(model)}`,
        applied: true,
        previousHash: currentHash,
        currentHash: finalHash,
        changeId: update.changeId,
      };
    } catch (error: any) {
      return {
        cellPath: update.cellPath,
        applied: false,
        reason: error?.message || "Failed to apply cell update",
        previousHash: currentHash,
        currentHash,
        changeId: update.changeId,
      };
    }
  });

  return {
    success: results.every((entry) => entry.applied),
    results,
  };
}

async function executeCells(request: ExecuteCellsRequest): Promise<ExecuteCellsResult> {
  const notebook = window.colab?.global?.notebook || window.IPython?.notebook;
  const extractedCells = extractCellsFromMemory();
  const extractedByPath = new Map<string, any>(
    extractedCells.map((cell: any) => [String(cell.path), cell])
  );

  const getNotebookCells = (): any[] => {
    if (!notebook) return [];

    const candidates: any[] = [];
    try {
      if (Array.isArray(notebook.cells)) {
        candidates.push(...notebook.cells);
      } else if (notebook.cells && typeof notebook.cells === "object") {
        candidates.push(...Object.values(notebook.cells));
      }
    } catch {
      // Ignore best-effort notebook cell lookups.
    }

    try {
      const fromGetCells = typeof notebook.getCells === "function" ? notebook.getCells() : null;
      if (Array.isArray(fromGetCells)) {
        candidates.push(...fromGetCells);
      }
    } catch {
      // Ignore best-effort notebook cell lookups.
    }

    try {
      const fromGetCellsLegacy = typeof notebook.get_cells === "function" ? notebook.get_cells() : null;
      if (Array.isArray(fromGetCellsLegacy)) {
        candidates.push(...fromGetCellsLegacy);
      }
    } catch {
      // Ignore best-effort notebook cell lookups.
    }

    if (candidates.length === 0) return [];

    const unique: any[] = [];
    const seen = new Set<any>();
    candidates.forEach((cell) => {
      if (!cell || seen.has(cell)) return;
      seen.add(cell);
      unique.push(cell);
    });
    return unique;
  };

  const notebookCells = getNotebookCells();
  const totalCells = Math.max(extractedCells.length, notebookCells.length);

  const resolveIndices = (): number[] => {
    if (request.mode === "all") {
      return Array.from({ length: totalCells }, (_item, idx) => idx);
    }

    if (request.mode === "range" && request.range) {
      const start = Math.max(0, Math.min(request.range.start, request.range.end));
      const end = Math.min(totalCells - 1, Math.max(request.range.start, request.range.end));
      const indices: number[] = [];
      for (let idx = start; idx <= end; idx++) indices.push(idx);
      return indices;
    }

    const indexSet = new Set<number>();
    (request.cellIds || []).forEach(id => {
      const index = getNativeCells()?.findIndex(cell => cell.getId() === id) ?? -1;
      if (index >= 0) indexSet.add(index);
    });
    (request.cellPaths || []).forEach((cellPath) => {
      const index = parseCellIndex(cellPath);
      if (index !== null && index >= 0 && index < totalCells) {
        indexSet.add(index);
      }
    });
    return Array.from(indexSet).sort((a, b) => a - b);
  };

  const targetIndices = resolveIndices();
  if (targetIndices.length === 0) {
    return {
      requestId: request.requestId,
      status: "error",
      executed: 0,
      errors: ["No valid cells resolved for execution request"],
    };
  }

  const readOutputs = () => {
    const savedCells = getNotebookModel()?.getIpynbJson?.()?.cells;
    return targetIndices.map(index => {
      const liveCell = getNotebookCells()[index];
      const items = savedCells?.[index]?.outputs;
      const output = Array.isArray(items) ? items.map((item: any) => {
        const value = item.text ?? item.data?.["text/plain"] ?? item.traceback ?? "";
        return Array.isArray(value) ? value.join("") : String(value);
      }).filter(Boolean).join("\n").slice(0, 20000) : "";
      const state: "running" | "pending" | "idle" | "unknown" =
        liveCell?.isRunning?.() ? "running" : liveCell?.isPending?.() ? "pending" :
        typeof liveCell?.isRunning === "function" ? "idle" : "unknown";
      return { cellPath: `cell_${index}`, output, state, hasError: Array.isArray(items) && items.some((item: any) => item.output_type === "error") };
    });
  };
  if (request.inspectOnly) return { requestId: request.requestId, status: "ok", executed: 0, errors: [], outputs: readOutputs() };

  const errors: string[] = [];
  let executed = 0;

  const runCellViaDom = async (index: number): Promise<boolean> => {
    const domCells = Array.from(document.querySelectorAll("colab-cell, .cell")) as Array<any>;
    const domCell = domCells[index];
    if (!domCell) return false;

    const runButtonSelectors = [
      "button[aria-label*='Run']",
      "button[title*='Run']",
      "button[data-tooltip*='Run']",
      "[role='button'][aria-label*='Run']",
      ".run-button button",
      ".run-button",
    ];

    const scopes: any[] = [domCell];
    if (domCell.shadowRoot) {
      scopes.push(domCell.shadowRoot);
    }
    const descendants = domCell.querySelectorAll?.("*") || [];
    descendants.forEach((node: any) => {
      if (node?.shadowRoot) {
        scopes.push(node.shadowRoot);
      }
    });

    let runButton: HTMLElement | null = null;
    for (const scope of scopes) {
      for (const selector of runButtonSelectors) {
        const match = scope.querySelector?.(selector);
        if (match) {
          runButton = match as HTMLElement;
          break;
        }
      }
      if (runButton) break;
    }

    if (runButton) {
      runButton.click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      return true;
    }

    return false;
  };

  const executeSingleCell = async (index: number): Promise<boolean> => {
    const localErrors: string[] = [];

    const callCandidates = async (candidates: Array<{ fn: any; owner: any; args: any[]; label: string }>): Promise<boolean> => {
      for (const candidate of candidates) {
        if (typeof candidate.fn !== "function") continue;
        try {
          await callMaybeAsync(candidate.fn, candidate.owner, ...candidate.args);
          return true;
        } catch (error: any) {
          localErrors.push(`${candidate.label}: ${error?.message || "failed"}`);
        }
      }
      return false;
    };

    if (await callCandidates([
      { fn: notebook?.executeCell, owner: notebook, args: [index], label: "notebook.executeCell" },
      { fn: notebook?.runCell, owner: notebook, args: [index], label: "notebook.runCell" },
      { fn: notebook?.execute_cell, owner: notebook, args: [index], label: "notebook.execute_cell" },
      { fn: window.IPython?.notebook?.execute_cell, owner: window.IPython?.notebook, args: [index], label: "IPython.execute_cell" },
    ])) {
      return true;
    }

    if (await callCandidates([
      { fn: notebook?.setSelectedCell, owner: notebook, args: [index], label: "notebook.setSelectedCell" },
      { fn: notebook?.selectCell, owner: notebook, args: [index], label: "notebook.selectCell" },
      { fn: notebook?.setActiveCellIndex, owner: notebook, args: [index], label: "notebook.setActiveCellIndex" },
      { fn: notebook?.setActiveCell, owner: notebook, args: [index], label: "notebook.setActiveCell" },
    ])) {
      if (await callCandidates([
        { fn: notebook?.runSelectedCell, owner: notebook, args: [], label: "notebook.runSelectedCell" },
        { fn: notebook?.executeSelectedCell, owner: notebook, args: [], label: "notebook.executeSelectedCell" },
        { fn: notebook?.runSelected, owner: notebook, args: [], label: "notebook.runSelected" },
      ])) {
        return true;
      }
    }

    const liveCells = getNotebookCells();
    const liveCell = liveCells[index];
    if (liveCell) {
      if (await callCandidates([
        { fn: liveCell.manualExecute, owner: liveCell, args: [], label: "cell.manualExecute" },
        { fn: liveCell.run, owner: liveCell, args: [], label: "cell.run" },
        { fn: liveCell.execute, owner: liveCell, args: [], label: "cell.execute" },
        { fn: liveCell.runCell, owner: liveCell, args: [], label: "cell.runCell" },
        { fn: liveCell.executeCell, owner: liveCell, args: [], label: "cell.executeCell" },
      ])) {
        return true;
      }
    }

    try {
      const domWorked = await runCellViaDom(index);
      if (domWorked) return true;
    } catch (error: any) {
      localErrors.push(`dom.run: ${error?.message || "failed"}`);
    }

    if (localErrors.length > 0) {
      errors.push(`cell_${index}: ${localErrors[localErrors.length - 1]}`);
    } else {
      errors.push(`cell_${index}: no execution API available`);
    }
    return false;
  };

  for (const index of targetIndices) {
    const path = `cell_${index}`;
    const meta = extractedByPath.get(path);
    if (meta?.cellType === "markdown") {
      // Colab does not execute markdown; treat as a no-op so mixed ranges can still proceed.
      executed += 1;
      continue;
    }

    const ok = await executeSingleCell(index);
    if (ok) {
      executed += 1;
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 300));

  const outputs = readOutputs();

  return {
    requestId: request.requestId,
    status: errors.length === 0 ? "queued" : (executed > 0 ? "partial" : "error"),
    executed,
    errors,
    outputs,
  };
}

function getNotebookMetadata(): NotebookMetadata {
  const notebookUrl = window.location.href;
  const notebookIdMatch = notebookUrl.match(/\/(?:drive|notebooks)\/([a-zA-Z0-9_-]+)/);
  const notebookId = notebookIdMatch ? notebookIdMatch[1] : null;

  const title = document.title.replace(/\s*-\s*Colab$/i, "").trim() || "Untitled Notebook";
  const language =
    window.colab?.global?.notebook?.metadata?.kernelspec?.language ||
    window.colab?.global?.notebook?.metadata?.language_info?.name ||
    "python";

  const kernel =
    window.colab?.global?.kernel?.kernelName ||
    window.colab?.global?.runtime?.kernelName ||
    null;

  const cellCount = extractCellsFromMemory().length;

  return {
    notebookUrl,
    notebookId,
    title,
    kernel,
    language,
    cellCount,
  };
}

(function () {
  console.log("PromptPack: Injected script running in page context.");

  const COLAB_ORIGIN = "https://colab.research.google.com";

  window.postMessage({ type: "PROMPTPACK_INJECTED_READY" }, COLAB_ORIGIN);

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== COLAB_ORIGIN) return;

    const requestId = event.data?.requestId;

    if (event.data.type === "PROMPTPACK_PING") {
      window.postMessage({ type: "PROMPTPACK_INJECTED_READY" }, COLAB_ORIGIN);
    } else if (event.data.type === "PROMPTPACK_REQUEST_CELLS") {
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
    } else if (event.data.type === "PROMPTPACK_APPLY_CELL_UPDATES") {
      try {
        const payload = (event.data.payload || { updates: [] }) as ApplyCellUpdatesPayload;
        const result = applyCellUpdates(payload);
        window.postMessage({ type: "PROMPTPACK_APPLY_RESULT", requestId, payload: result }, COLAB_ORIGIN);
      } catch (e: any) {
        const failure: ApplyCellUpdatesResult = {
          success: false,
          results: [{
            cellPath: "unknown",
            applied: false,
            reason: e?.message || "Failed to apply updates",
          }],
        };
        window.postMessage({ type: "PROMPTPACK_APPLY_RESULT", requestId, payload: failure }, COLAB_ORIGIN);
      }
    } else if (event.data.type === "PROMPTPACK_EXECUTE_CELLS") {
      const payload = (event.data.payload || { mode: "cell", cellPaths: [] }) as ExecuteCellsRequest;
      executeCells(payload)
        .then((result: ExecuteCellsResult) => {
          window.postMessage({ type: "PROMPTPACK_EXECUTION_RESULT", requestId, payload: result }, COLAB_ORIGIN);
        })
        .catch((e: any) => {
          const failure: ExecuteCellsResult = {
            requestId: payload.requestId,
            status: "error",
            executed: 0,
            errors: [e?.message || "Execution failed"],
          };
          window.postMessage({ type: "PROMPTPACK_EXECUTION_RESULT", requestId, payload: failure }, COLAB_ORIGIN);
        });
    } else if (event.data.type === "PROMPTPACK_GET_NOTEBOOK_METADATA") {
      try {
        const metadata = getNotebookMetadata();
        window.postMessage({ type: "PROMPTPACK_NOTEBOOK_METADATA_RESULT", requestId, payload: metadata }, COLAB_ORIGIN);
      } catch (e: any) {
        const fallback: NotebookMetadata = {
          notebookUrl: window.location.href,
          notebookId: null,
          title: "Untitled Notebook",
          kernel: null,
          language: null,
          cellCount: 0,
        };
        window.postMessage({ type: "PROMPTPACK_NOTEBOOK_METADATA_RESULT", requestId, payload: fallback }, COLAB_ORIGIN);
      }
    }
  });
})();
