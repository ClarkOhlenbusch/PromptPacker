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

/** Incrementing request ID for message correlation */
let nextRequestId = 1;

/**
 * Request cells from the content script via postMessage through the parent window.
 */
async function requestCellsFromContentScript(): Promise<CellsResponse | null> {
  const requestId = nextRequestId++;
  const TIMEOUT_MS = 10000;

  return new Promise((resolve) => {
    let settled = false;

    const handleResponse = (event: MessageEvent) => {
      if (
        event.data?.type === "PROMPTPACK_CELLS_RESPONSE" &&
        event.data?.requestId === requestId
      ) {
        if (!settled) {
          settled = true;
          window.removeEventListener("message", handleResponse);
          resolve(event.data.payload ?? null);
        }
      }
    };

    window.addEventListener("message", handleResponse);

    window.parent.postMessage(
      { type: "PROMPTPACK_GET_CELLS", requestId },
      "*"
    );

    setTimeout(() => {
      if (!settled) {
        settled = true;
        window.removeEventListener("message", handleResponse);
        console.error("Colab iframe: GET_CELLS timed out after", TIMEOUT_MS, "ms");
        resolve(null);
      }
    }, TIMEOUT_MS);
  });
}

/**
 * Send a snapshot command to the content script and wait for acknowledgement.
 */
async function sendSnapshotCommand(type: string): Promise<any> {
  const requestId = nextRequestId++;
  const TIMEOUT_MS = 10000;

  return new Promise((resolve) => {
    let settled = false;

    const handleResponse = (event: MessageEvent) => {
      if (
        event.data?.type === "PROMPTPACK_SNAPSHOT_RESPONSE" &&
        event.data?.requestId === requestId
      ) {
        if (!settled) {
          settled = true;
          window.removeEventListener("message", handleResponse);
          resolve(event.data.payload ?? null);
        }
      }
    };

    window.addEventListener("message", handleResponse);

    window.parent.postMessage({ type, requestId }, "*");

    setTimeout(() => {
      if (!settled) {
        settled = true;
        window.removeEventListener("message", handleResponse);
        console.error("Colab iframe: Snapshot command timed out:", type);
        resolve(null);
      }
    }, TIMEOUT_MS);
  });
}

export class ColabFileSystem implements IFileSystem {
  private cellContentCache: Map<string, string> = new Map();

  async scanProject(_path: string): Promise<FileEntry[]> {
    const response = await requestCellsFromContentScript();

    if (!response) return [];
    if (response.error) {
      console.error("Colab: Error from content script:", response.error);
      return [];
    }
    if (!response.cells || !Array.isArray(response.cells)) {
      console.warn("Colab: No cells received");
      return [];
    }

    // Cache the content
    this.cellContentCache.clear();
    response.cells.forEach((cell) => {
      if (cell.content) {
        this.cellContentCache.set(cell.path, cell.content);
      }
    });

    // Auto-snapshot on first scan if no snapshot exists in the content script
    const existingSnapshot = await sendSnapshotCommand("PROMPTPACK_GET_SNAPSHOT");
    if (!existingSnapshot?.cells || existingSnapshot.cells.length === 0) {
      await sendSnapshotCommand("PROMPTPACK_TAKE_SNAPSHOT");
    }

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

  async takeSnapshot(): Promise<boolean> {
    const result = await sendSnapshotCommand("PROMPTPACK_TAKE_SNAPSHOT");
    return result?.success ?? false;
  }

  async getDiffs(): Promise<CellDiff[]> {
    // 1. Get the persisted snapshot from the content script
    const snapshotResult = await sendSnapshotCommand("PROMPTPACK_GET_SNAPSHOT");
    const snapshotCells: CellData[] = snapshotResult?.cells ?? [];

    if (snapshotCells.length === 0) {
      console.warn("Colab: No snapshot available for diffing");
      return [];
    }

    // Build a lookup map from the snapshot
    const snapshotMap = new Map<string, CellData>();
    snapshotCells.forEach((cell) => {
      snapshotMap.set(cell.path, cell);
    });

    // 2. Get fresh current cells
    const response = await requestCellsFromContentScript();
    if (!response?.cells || !Array.isArray(response.cells)) {
      console.warn("Colab: No current cells received for diffing");
      return [];
    }

    // 3. Compare each current cell against the snapshot
    const diffs: CellDiff[] = [];
    const timestamp = Date.now();

    for (const cell of response.cells) {
      const prev = snapshotMap.get(cell.path);

      if (prev && prev.content !== cell.content) {
        try {
          const cellDiff = computeDiff(prev.content, cell.content);

          diffs.push({
            path: cell.path,
            relative_path: cell.relative_path,
            previous: {
              content: prev.content,
              output: prev.output || "",
              timestamp: 0, // Snapshot timestamp not tracked
            },
            current: { content: cell.content, output: cell.output || "", timestamp },
            diff: cellDiff,
          });
        } catch (e) {
          console.error(`Colab: Error diffing cell ${cell.relative_path}:`, e);
        }
      }
    }

    return diffs;
  }

  async clearHistory(_cellPath?: string): Promise<boolean> {
    window.parent.postMessage({ type: "PROMPTPACK_CLEAR_SNAPSHOT" }, "*");
    return true;
  }
}
