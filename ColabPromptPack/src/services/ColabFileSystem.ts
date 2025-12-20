import { IFileSystem, FileEntry } from "./FileSystem";

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
              if (response && response.cells) {
                console.log("Received cells from content script", response.cells);
                
                // Cache the content
                this.cellContentCache.clear();
                response.cells.forEach((cell: any) => {
                  if (cell.content) {
                    this.cellContentCache.set(cell.path, cell.content);
                  }
                });

                resolve(response.cells);
              } else {
                console.warn("No response from content script, using mock data");
                resolve(this.getMockCells());
              }
            });
          } else {
            console.warn("No active tab found, using mock data");
            resolve(this.getMockCells());
          }
        });
      } else {
        console.log("Not in extension context, using mock data");
        resolve(this.getMockCells());
      }
    });
  }

  private getMockCells(): FileEntry[] {
    const mocks = [
      {
        path: "cell_1",
        relative_path: "Cell 1 (Imports)",
        is_dir: false,
        size: 100,
        line_count: 5,
        content: "import numpy as np\nimport pandas as pd"
      },
      {
        path: "cell_2",
        relative_path: "Cell 2 (Data Loading)",
        is_dir: false,
        size: 500,
        line_count: 20,
        content: "# Load data\ndf = pd.read_csv('data.csv')"
      },
      {
        path: "cell_3",
        relative_path: "Cell 3 (Model Definition)",
        is_dir: false,
        size: 1200,
        line_count: 45,
        content: "model = tf.keras.Sequential([\n  tf.keras.layers.Dense(10)\n])"
      }
    ];

    // Populate cache for mocks too
    mocks.forEach(m => this.cellContentCache.set(m.path, m.content));
    
    return mocks.map(({content, ...rest}) => rest);
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
}
