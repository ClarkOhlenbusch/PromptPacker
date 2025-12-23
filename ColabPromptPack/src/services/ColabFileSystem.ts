import { IFileSystem, FileEntry } from "./FileSystem";

// Diff-related types
export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  line: string;
  oldLineNum: number | null;
  newLineNum: number | null;
}

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

  async scanProject(_path: string): Promise<FileEntry[]> {
    console.log("Colab: Scanning notebook cells...");

    return new Promise((resolve) => {
      // Check if we are in a Chrome Extension context
      // @ts-ignore
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        // @ts-ignore
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const activeTab = tabs[0];
          if (activeTab && activeTab.id) {
            console.log("Sending message to content script in tab", activeTab.id);
            // @ts-ignore
            chrome.tabs.sendMessage(activeTab.id, { type: "GET_CELLS" }, (response) => {
              // Check for Chrome runtime errors
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
            console.error("Colab: No active tab found. Make sure you're on a Google Colab page.");
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
    const content = this.cellContentCache.get(path);
    if (content !== undefined) {
      return content;
    }

    // Fallback if not in cache (shouldn't happen if scanned first)
    return `# Error: Content for ${path} not found in cache.\n# Please try refreshing the file list.`;
  }

  async openFolder(): Promise<string | null> {
    return "Google Colab Notebook";
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
            chrome.tabs.sendMessage(activeTab.id, { type: "GET_DIFFS" }, (response) => {
              // @ts-ignore
              if (chrome.runtime.lastError) {
                // @ts-ignore
                console.error("Colab: Chrome runtime error:", chrome.runtime.lastError.message);
                resolve([]);
                return;
              }

              if (response && response.diffs && Array.isArray(response.diffs)) {
                console.log("Received diffs from content script", response.diffs.length, "cells with changes");
                resolve(response.diffs);
              } else if (response && response.error) {
                console.error("Colab: Error from content script:", response.error);
                resolve([]);
              } else {
                console.warn("Colab: No diffs received from content script");
                resolve([]);
              }
            });
          } else {
            console.error("Colab: No active tab found");
            resolve([]);
          }
        });
      } else {
        console.error("Colab: Not running in Chrome extension context");
        resolve([]);
      }
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
            chrome.tabs.sendMessage(activeTab.id, { type: "TAKE_SNAPSHOT" }, (response) => {
              // @ts-ignore
              if (chrome.runtime.lastError) {
                // @ts-ignore
                console.error("Colab: Chrome runtime error:", chrome.runtime.lastError.message);
                resolve(false);
                return;
              }

              if (response && response.success) {
                console.log("Colab: Snapshot taken successfully");
                resolve(true);
              } else {
                console.error("Colab: Failed to take snapshot");
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

  async clearHistory(cellPath?: string): Promise<boolean> {
    console.log("Colab: Clearing history...", cellPath || "all");

    return new Promise((resolve) => {
      // @ts-ignore
      if (typeof chrome !== 'undefined' && chrome.tabs) {
        // @ts-ignore
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const activeTab = tabs[0];
          if (activeTab && activeTab.id) {
            // @ts-ignore
            chrome.tabs.sendMessage(activeTab.id, { type: "CLEAR_HISTORY", cellPath }, (response) => {
              // @ts-ignore
              if (chrome.runtime.lastError) {
                // @ts-ignore
                console.error("Colab: Chrome runtime error:", chrome.runtime.lastError.message);
                resolve(false);
                return;
              }

              resolve(response?.success || false);
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
}
