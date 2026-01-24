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

export class ColabFileSystem implements IFileSystem {
  private cellContentCache: Map<string, string> = new Map();
  private snapshot: Map<string, CellVersion> = new Map();

  async scanProject(_path: string): Promise<FileEntry[]> {
    console.log("Colab: Scanning notebook cells...");

    return new Promise((resolve) => {
      // @ts-ignore
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        // @ts-ignore
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const activeTab = tabs[0];
          if (activeTab && activeTab.id) {
            // @ts-ignore
            chrome.tabs.sendMessage(activeTab.id, { type: "GET_CELLS" }, (response) => {
              // @ts-ignore
              if (chrome.runtime.lastError) {
                // @ts-ignore
                console.error("Colab: Chrome runtime error:", chrome.runtime.lastError.message);
                resolve([]);
                return;
              }

              if (response && response.cells && Array.isArray(response.cells)) {
                console.log("Received cells from content script", response.cells.length, "cells");

                // Cache the content
                this.cellContentCache.clear();
                response.cells.forEach((cell: any) => {
                  if (cell.content) {
                    this.cellContentCache.set(cell.path, cell.content);
                  }
                });

                // Auto-snapshot on first scan if no snapshot exists
                if (this.snapshot.size === 0) {
                  this.takeSnapshotFromCells(response.cells);
                }

                resolve(response.cells);
              } else if (response && response.error) {
                console.error("Colab: Error from content script:", response.error);
                resolve([]);
              } else {
                console.warn("Colab: No cells received from content script");
                resolve([]);
              }
            });
          } else {
            console.error("Colab: No active tab found.");
            resolve([]);
          }
        });
      } else {
        console.error("Colab: Not running in Chrome extension context");
        resolve([]);
      }
    });
  }

  async readFileContent(path: string): Promise<string> {
    return this.cellContentCache.get(path) ?? `# Error: Content for ${path} not found in cache.`;
  }

  async openFolder(): Promise<string | null> {
    return "Google Colab Notebook";
  }

  private takeSnapshotFromCells(cells: any[]) {
    const timestamp = Date.now();
    this.snapshot.clear();
    cells.forEach((cell: any) => {
      this.snapshot.set(cell.path, {
        content: cell.content || "",
        output: cell.output || "",
        timestamp
      });
    });
  }

  async takeSnapshot(): Promise<boolean> {
    console.log("Colab: Taking snapshot...");
    
    return new Promise((resolve) => {
      // @ts-ignore
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        // @ts-ignore
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const activeTab = tabs[0];
          if (activeTab && activeTab.id) {
            // @ts-ignore
            chrome.tabs.sendMessage(activeTab.id, { type: "GET_CELLS" }, (response) => {
              // @ts-ignore
              if (chrome.runtime.lastError) {
                resolve(false);
                return;
              }
              if (response && response.cells) {
                this.takeSnapshotFromCells(response.cells);
                resolve(true);
              } else {
                resolve(false);
              }
            });
          } else {
            resolve(false);
          }
        });
      } else {
        resolve(false);
      }
    });
  }

  async getDiffs(): Promise<CellDiff[]> {
    console.log("Colab: Getting diffs...");

    return new Promise((resolve) => {
      // @ts-ignore
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        // @ts-ignore
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const activeTab = tabs[0];
          if (activeTab && activeTab.id) {
            // @ts-ignore
            chrome.tabs.sendMessage(activeTab.id, { type: "GET_CELLS" }, (response) => {
              // @ts-ignore
              if (chrome.runtime.lastError) {
                resolve([]);
                return;
              }

              if (response && response.cells && Array.isArray(response.cells)) {
                const diffs: CellDiff[] = [];
                const timestamp = Date.now();

                response.cells.forEach((cell: any) => {
                  const prev = this.snapshot.get(cell.path);
                  if (prev && prev.content !== cell.content) {
                    diffs.push({
                      path: cell.path,
                      relative_path: cell.relative_path,
                      previous: prev,
                      current: { content: cell.content, output: cell.output || "", timestamp },
                      diff: computeDiff(prev.content, cell.content)
                    });
                  }
                });

                resolve(diffs);
              } else {
                resolve([]);
              }
            });
          } else {
            resolve([]);
          }
        });
      } else {
        resolve([]);
      }
    });
  }

  async clearHistory(_cellPath?: string): Promise<boolean> {
    this.snapshot.clear();
    return true;
  }
}
