import { IFileSystem, FileEntry } from "./FileSystem";
import { computeDiff, DiffLine } from "../utils/diff";

export type { DiffLine };

export interface CellVersion {
  content: string;
  output: string;
  timestamp: number;
}

export interface CellDiff {
  path: string;
  relative_path: string;
  previous: CellVersion;
  current: CellVersion;
  diff: DiffLine[];
}

/** Response shape from content script GET_CELLS message */
interface CellsResponse {
  cells?: CellData[];
  error?: string;
}

/** Cell data as returned from the content script */
interface CellData {
  path: string;
  relative_path: string;
  content: string;
  output?: string;
}

/**
 * Type guard to check if the Chrome extension API is available.
 * This is the proper way to handle the chrome global without @ts-ignore.
 */
function isChromeExtensionContext(): boolean {
  return (
    typeof chrome !== "undefined" &&
    typeof chrome.tabs !== "undefined" &&
    typeof chrome.runtime !== "undefined"
  );
}

/**
 * Helper to query the active tab and send a message.
 * Encapsulates Chrome API interaction with proper typing.
 */
async function sendMessageToActiveTab<T>(message: { type: string }): Promise<T | null> {
  if (!isChromeExtensionContext()) {
    console.error("Colab: Not running in Chrome extension context");
    return null;
  }

  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab?.id) {
        console.error("Colab: No active tab found.");
        resolve(null);
        return;
      }

      chrome.tabs.sendMessage(activeTab.id, message, (response: T) => {
        if (chrome.runtime.lastError) {
          console.error("Colab: Chrome runtime error:", chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        resolve(response);
      });
    });
  });
}

export class ColabFileSystem implements IFileSystem {
  private cellContentCache: Map<string, string> = new Map();
  private snapshot: Map<string, CellVersion> = new Map();

  async scanProject(_path: string): Promise<FileEntry[]> {
    console.log("Colab: Scanning notebook cells...");

    const response = await sendMessageToActiveTab<CellsResponse>({ type: "GET_CELLS" });

    if (!response) {
      return [];
    }

    if (response.error) {
      console.error("Colab: Error from content script:", response.error);
      return [];
    }

    if (!response.cells || !Array.isArray(response.cells)) {
      console.warn("Colab: No cells received from content script");
      return [];
    }

    console.log("Received cells from content script", response.cells.length, "cells");

    // Cache the content
    this.cellContentCache.clear();
    response.cells.forEach((cell) => {
      if (cell.content) {
        this.cellContentCache.set(cell.path, cell.content);
      }
    });

    // Auto-snapshot on first scan if no snapshot exists
    if (this.snapshot.size === 0) {
      this.takeSnapshotFromCells(response.cells);
    }

    // Map cells to FileEntry format
    return response.cells.map((cell) => ({
      path: cell.path,
      relative_path: cell.relative_path,
      is_dir: false,
      size: cell.content?.length ?? 0,
      line_count: cell.content?.split("\n").length ?? 0,
      content: cell.content,
      output: cell.output,
    }));
  }

  async readFileContent(path: string): Promise<string> {
    return this.cellContentCache.get(path) ?? `# Error: Content for ${path} not found in cache.`;
  }

  async openFolder(): Promise<string | null> {
    return "Google Colab Notebook";
  }

  private takeSnapshotFromCells(cells: CellData[]) {
    const timestamp = Date.now();
    this.snapshot.clear();
    cells.forEach((cell) => {
      this.snapshot.set(cell.path, {
        content: cell.content || "",
        output: cell.output || "",
        timestamp,
      });
    });
  }

  async takeSnapshot(): Promise<boolean> {
    console.log("Colab: Taking snapshot...");

    const response = await sendMessageToActiveTab<CellsResponse>({ type: "GET_CELLS" });

    if (!response?.cells) {
      return false;
    }

    this.takeSnapshotFromCells(response.cells);
    return true;
  }

  async getDiffs(): Promise<CellDiff[]> {
    console.log("Colab: Getting diffs...");

    const response = await sendMessageToActiveTab<CellsResponse>({ type: "GET_CELLS" });

    if (!response?.cells || !Array.isArray(response.cells)) {
      return [];
    }

    const diffs: CellDiff[] = [];
    const timestamp = Date.now();

    response.cells.forEach((cell) => {
      const prev = this.snapshot.get(cell.path);
      if (prev && prev.content !== cell.content) {
        diffs.push({
          path: cell.path,
          relative_path: cell.relative_path,
          previous: prev,
          current: { content: cell.content, output: cell.output || "", timestamp },
          diff: computeDiff(prev.content, cell.content),
        });
      }
    });

    return diffs;
  }

  async clearHistory(_cellPath?: string): Promise<boolean> {
    this.snapshot.clear();
    return true;
  }
}
