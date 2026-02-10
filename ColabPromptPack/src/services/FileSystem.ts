export interface FileEntry {
  path: string;
  relative_path: string;
  is_dir: boolean;
  size: number;
  line_count?: number;
  output?: string;
  content?: string; // Cell content (available in Colab extension)
  cellType?: 'code' | 'markdown'; // Cell type (Colab extension only)
}

export interface IFileSystem {
  scanProject(path: string): Promise<FileEntry[]>;
  readFileContent(path: string): Promise<string>;
  openFolder(): Promise<string | null>;
}

// Global instance variable
let fsInstance: IFileSystem | null = null;

export function getFileSystem(): IFileSystem {
  if (!fsInstance) {
    throw new Error("FileSystem not initialized. Call initializeFileSystem first.");
  }
  return fsInstance;
}

export function initializeFileSystem(instance: IFileSystem) {
  fsInstance = instance;
}
