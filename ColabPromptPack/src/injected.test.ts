import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplyCellUpdatesPayload, ApplyCellUpdatesResult, ExecuteCellsRequest, ExecuteCellsResult } from "./types/agent";
import "./injected";

function makeCell(id: string, content: string, type = "code") {
  const model = {
    content,
    uri: { scheme: "inmemory", path: `/${id}`, toString: () => `inmemory:///${id}` },
    getValue() { return this.content; },
    getValueLength() { return this.content.length; },
    getLineCount() { return this.content.split("\n").length; },
    getLanguageId: () => type === "markdown" ? "markdown" : "python",
    setValue(value: string) { this.content = value; },
    pushStackElement() {},
  };
  return {
    getId: () => id,
    getTextModel: () => model,
    setText: vi.fn((value: string) => { model.setValue(value); }),
  };
}

let cells: ReturnType<typeof makeCell>[];
let addNewCell: ReturnType<typeof vi.fn>;
let isEditable: ReturnType<typeof vi.fn>;

function apply(payload: ApplyCellUpdatesPayload): ApplyCellUpdatesResult {
  const sent = vi.spyOn(window, "postMessage");
  sent.mockClear();
  window.dispatchEvent(new MessageEvent("message", {
    origin: "https://colab.research.google.com", source: window,
    data: { type: "PROMPTPACK_APPLY_CELL_UPDATES", requestId: "test", payload },
  }));
  return sent.mock.calls.find(([message]) => message.type === "PROMPTPACK_APPLY_RESULT")![0].payload;
}

beforeEach(() => {
  cells = [makeCell("original", "print('original')"), makeCell("empty", "")];
  isEditable = vi.fn(() => true);
  addNewCell = vi.fn((_type: string, index: number, cell: ReturnType<typeof makeCell>) => {
    cells.splice(index, 0, cell);
    return cell.getId();
  });
  window.colab = { global: {
    notebook: { addNewCell, isEditable },
    notebookModel: {
      getCells: () => cells,
      moveCells: (anchor: ReturnType<typeof makeCell> | undefined, moved: ReturnType<typeof makeCell>[]) => {
        for (const cell of moved) cells.splice(cells.indexOf(cell), 1);
        cells.splice(anchor ? cells.indexOf(anchor) + 1 : 0, 0, ...moved);
      },
      deleteCells: (deleted: ReturnType<typeof makeCell>[]) => { for (const cell of deleted) cells.splice(cells.indexOf(cell), 1); },
      createCellFromJson: (json: any) => makeCell(json.metadata.id, json.source, json.cell_type),
    },
  } };
  window.monaco = { editor: { getModels: () => [...cells].reverse().map(cell => cell.getTextModel()), getEditors: () => [] } };
});

const append = {
  cellPath: "new_file", cellId: "pp_new", operation: "append" as const,
  cellType: "code" as const, newContent: "print('new final cell')", changeId: "creation",
};

describe("cell creation", () => {
  it("appends code and Markdown after empty cells, with stable identities", () => {
    const result = apply({ updates: [append, { ...append, cellPath: "new_text", cellId: "pp_text", cellType: "markdown", newContent: "# Explanation" }] });
    expect(result.success).toBe(true);
    expect(result.results.map(entry => entry.notebookCellPath)).toEqual(["cell_2", "cell_3"]);
    expect(cells.map(cell => cell.getId())).toEqual(["original", "empty", "pp_new", "pp_text"]);
    expect(cells[3].getTextModel().getLanguageId()).toBe("markdown");
  });

  it("does not duplicate a creation after a lost acknowledgement, including after model reload", () => {
    expect(apply({ updates: [append] }).success).toBe(true);
    cells = cells.map(cell => makeCell(cell.getId(), cell.getTextModel().getValue()));
    expect(apply({ updates: [append] }).success).toBe(true);
    expect(addNewCell).toHaveBeenCalledOnce();
    expect(cells).toHaveLength(3);
    cells[2].setText("Edited by the user after creation");
    expect(apply({ updates: [append] }).results[0].reason).toBe("base_hash_mismatch");
    expect(cells[2].getTextModel().getValue()).toBe("Edited by the user after creation");
  });

  it("edits the same cell after reordering and refuses to edit a deleted cell's neighbor", () => {
    apply({ updates: [append] });
    const newCell = cells.pop()!;
    cells.unshift(newCell);
    expect(apply({ updates: [{ cellPath: "new_file", cellId: "pp_new", newContent: "print('second edit')" }] }).success).toBe(true);
    expect(newCell.setText).toHaveBeenCalledWith("print('second edit')");
    cells.shift();
    const result = apply({ updates: [{ cellPath: "cell_0", cellId: "pp_new", newContent: "should not apply" }] });
    expect(result.success).toBe(false);
    expect(cells[0].getTextModel().getValue()).toBe("print('original')");
  });

  it("preserves files by reporting read-only/unsupported notebooks without inserting", () => {
    isEditable.mockReturnValue(false);
    expect(apply({ updates: [append] }).results[0].reason).toMatch(/read-only/);
    isEditable.mockReturnValue(true);
    delete window.colab.global.notebook.addNewCell;
    expect(apply({ updates: [append] }).results[0].reason).toMatch(/does not expose cell creation/);
    expect(addNewCell).not.toHaveBeenCalled();
  });

  it("validates all-or-nothing batches before creating any cells", () => {
    const result = apply({ mode: "all-or-nothing", updates: [append, { cellPath: "missing", newContent: "no" }] });
    expect(result.success).toBe(false);
    expect(addNewCell).not.toHaveBeenCalled();
  });

  it("exports persistent cell IDs in notebook order, including blank cells", () => {
    const sent = vi.spyOn(window, "postMessage");
    sent.mockClear();
    window.dispatchEvent(new MessageEvent("message", {
      origin: "https://colab.research.google.com", source: window,
      data: { type: "PROMPTPACK_REQUEST_CELLS" },
    }));
    const exported = sent.mock.calls.find(([message]) => message.type === "PROMPTPACK_RESPONSE_CELLS")![0].cells;
    expect(exported.map((cell: any) => [cell.path, cell.cellId, cell.content])).toEqual([
      ["cell_0", "original", "print('original')"], ["cell_1", "empty", ""],
    ]);
  });
});


describe("structural cell operations", () => {
  const move = { cellPath: "cell_1", cellId: "empty", operation: "move" as const, newContent: "" };
  const remove = { cellPath: "cell_0", cellId: "original", operation: "delete" as const, newContent: "print('original')" };

  it("moves by persistent ID before and after another cell", () => {
    expect(apply({ updates: [{ ...move, beforeCellId: "original" }] }).success).toBe(true);
    expect(cells.map(cell => cell.getId())).toEqual(["empty", "original"]);
    expect(apply({ updates: [{ ...move, afterCellId: "original" }] }).success).toBe(true);
    expect(cells.map(cell => cell.getId())).toEqual(["original", "empty"]);
  });

  it("rejects missing destinations, missing targets, and read-only changes", () => {
    expect(apply({ updates: [{ ...move, beforeCellId: "gone" }] }).results[0].reason).toMatch(/destination/i);
    expect(apply({ updates: [{ ...remove, cellId: "gone" }] }).results[0].reason).toMatch(/not found/i);
    isEditable.mockReturnValue(false);
    expect(apply({ updates: [remove] }).results[0].reason).toMatch(/read-only/i);
    expect(cells.map(cell => cell.getId())).toEqual(["original", "empty"]);
  });

  it("refuses to delete a cell changed by the user since the agent snapshot", () => {
    expect(apply({ updates: [{ ...remove, baseHash: "00000000" }] }).results[0].reason).toBe("base_hash_mismatch");
    expect(cells).toHaveLength(2);
    expect(cells[0].getTextModel().getValue()).toBe("print('original')");
  });

  it("deletes the intended cell after reordering", () => {
    cells.reverse();
    expect(apply({ updates: [remove] }).success).toBe(true);
    expect(cells.map(cell => cell.getId())).toEqual(["empty"]);
  });
});

async function execute(payload: ExecuteCellsRequest): Promise<ExecuteCellsResult> {
  const sent = vi.spyOn(window, "postMessage");
  sent.mockClear();
  window.dispatchEvent(new MessageEvent("message", {
    origin: "https://colab.research.google.com", source: window,
    data: { type: "PROMPTPACK_EXECUTE_CELLS", requestId: "execution-test", payload },
  }));
  await waitFor(() => expect(sent.mock.calls.some(([message]) => message.type === "PROMPTPACK_EXECUTION_RESULT")).toBe(true), { timeout: 2000 });
  return sent.mock.calls.find(([message]) => message.type === "PROMPTPACK_EXECUTION_RESULT")![0].payload;
}

describe("execution and output inspection", () => {
  it("reads runtime state and serialized errors without executing the cell", async () => {
    const run = vi.fn();
    window.colab.global.notebook.getCells = () => [
      { isRunning: () => false, isPending: () => false, manualExecute: run },
      { isRunning: () => true, isPending: () => false, manualExecute: run },
    ];
    window.colab.global.notebookModel.getIpynbJson = () => ({ cells: [
      { outputs: [] }, { outputs: [{ output_type: "error", traceback: ["Traceback", "failed"] }] },
    ] });
    const result = await execute({ mode: "cell", cellIds: ["empty"], inspectOnly: true });
    expect(result.status).toBe("ok");
    expect(result.outputs).toEqual([{ cellPath: "cell_1", output: "Tracebackfailed", state: "running", hasError: true }]);
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses to execute a missing stable ID", async () => {
    const run = vi.fn();
    window.colab.global.notebook.getCells = () => [{ manualExecute: run }, { manualExecute: run }];
    const result = await execute({ mode: "cell", cellIds: ["missing"] });
    expect(result.status).toBe("error");
    expect(run).not.toHaveBeenCalled();
  });

  it("reports a queued run without claiming the runtime finished", async () => {
    const run = vi.fn(async () => {});
    window.colab.global.notebook.getCells = () => [{ manualExecute: run }, { manualExecute: vi.fn() }];
    const result = await execute({ mode: "cell", cellIds: ["original"] });
    expect(run).toHaveBeenCalledOnce();
    expect(result.status).toBe("queued");
  });
});
