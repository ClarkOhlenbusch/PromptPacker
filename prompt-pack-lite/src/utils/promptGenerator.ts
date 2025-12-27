import { invoke } from "@tauri-apps/api/core";

interface FileEntry {
  path: string;
  relative_path: string;
  is_dir: boolean;
  size: number;
  line_count?: number;
}

// Result from Rust skeleton extraction
interface SkeletonResult {
  skeleton: string;
  language: string | null;
  original_lines: number;
  skeleton_lines: number;
  compression_ratio: number;
}

export async function generatePrompt(
  allEntries: FileEntry[],
  selectedPaths: Set<string>,
  tier1Paths: Set<string>,
  preamble: string,
  goal: string,
  includeFileTree: boolean
): Promise<string> {
  let output = "";

  if (preamble.trim()) {
    output += "PREAMBLE\n" + preamble + "\n\n";
  }

  if (includeFileTree) {
    output += "TREE\n";
    output += generateTreeStructure(allEntries);
    output += "\n\n";
  }

  const selectedEntries = allEntries.filter(e => selectedPaths.has(e.path));
  const effectiveSelectedPaths = new Set(selectedPaths);
  const needsTauriLib = selectedEntries.some(entry =>
    entry.relative_path.startsWith("src-tauri/src/")
  );
  if (needsTauriLib) {
    const libEntry = allEntries.find(
      entry => !entry.is_dir && entry.relative_path === "src-tauri/src/lib.rs"
    );
    if (libEntry) {
      effectiveSelectedPaths.add(libEntry.path);
    }
  }
  const selectedFiles = allEntries.filter(
    e => !e.is_dir && effectiveSelectedPaths.has(e.path)
  );

  const fallbackFiles: string[] = [];

  for (const file of selectedFiles) {
    try {
      const isFull = tier1Paths.has(file.path);

      output += `FILE ${file.relative_path} ${isFull ? "FULL" : "SKELETON"}\n`;

      if (isFull) {
        // Tier 1: Full content
        const content = await invoke<string>("read_file_content", { path: file.path });
        output += content;
      } else {
        // Tier 2: Use Rust AST-based skeleton extraction
        try {
          const result = await invoke<SkeletonResult>("skeletonize_file", { path: file.path });
          output += result.skeleton;
          // Add compression stats as a comment
          if (result.language) {
            output += `\n// [${result.language}: ${result.original_lines}→${result.skeleton_lines} lines, ${Math.round(result.compression_ratio * 100)}% reduced]`;
          }
        } catch (skeletonErr) {
          // Fallback to reading full content if skeleton fails
          console.warn(`Skeleton extraction failed for ${file.path}, using full content:`, skeletonErr);
          fallbackFiles.push(file.relative_path);
          const content = await invoke<string>("read_file_content", { path: file.path });
          output += compressCode(content);
        }
      }

      output += "\nEND_FILE\n\n";
    } catch (err) {
      console.error(`Failed to read ${file.path}`, err);
      output += `FILE ${file.relative_path} ERROR\nError reading file.\nEND_FILE\n\n`;
    }
  }

  if (goal.trim()) {
    output += "GOAL\n" + goal + "\n";
  }

  if (fallbackFiles.length > 0) {
    output += "\n// ! FALLBACK WARNING: AST Skeletonization failed for the following files (naive compression used):\n";
    fallbackFiles.forEach(f => {
      output += `// ! - ${f}\n`;
    });
  }

  return output;
}

function generateTreeStructure(entries: FileEntry[]): string {
  // 1. Build a recursive tree structure from the flat list
  type Node = { name: string; entry?: FileEntry; children: Record<string, Node> };
  const root: Node = { name: "root", children: {} };

  entries.forEach(entry => {
    const parts = entry.relative_path.split('/');
    let current = root;
    parts.forEach((part, index) => {
      if (!current.children[part]) {
        current.children[part] = { name: part, children: {} };
      }
      current = current.children[part];
      if (index === parts.length - 1) {
        current.entry = entry;
      }
    });
  });

  // 2. Recursive print function
  let result = "";

  function printNode(node: Node, prefix: string, isLast: boolean, isRoot: boolean) {
    if (!isRoot) {
      const connector = isLast ? "└─ " : "├─ ";
      const stats = node.entry && !node.entry.is_dir
        ? ` (${formatSize(node.entry.size)}, ${node.entry.line_count ?? 0} lines)`
        : "";

      result += `${prefix}${connector}${node.name}${stats}\n`;
    }

    const childrenKeys = Object.keys(node.children).sort((a, b) => {
      // Directories first, then files
      const aIsDir = node.children[a].entry?.is_dir ?? true; // inferred dir if no entry
      const bIsDir = node.children[b].entry?.is_dir ?? true;
      if (aIsDir === bIsDir) return a.localeCompare(b);
      return aIsDir ? -1 : 1; // Dir comes before file? Actually usually opposite or alphabetical. 
      // Standard `tree` command does alphabetical.
      // Let's do alphabetical for simplicity and consistency with standard tools.
      return a.localeCompare(b);
    });

    childrenKeys.forEach((key, index) => {
      const child = node.children[key];
      const isChildLast = index === childrenKeys.length - 1;
      const childPrefix = isRoot ? "" : prefix + (isLast ? "   " : "│  ");
      printNode(child, childPrefix, isChildLast, false);
    });
  }

  printNode(root, "", true, true);
  return result;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function compressCode(code: string): string {
  const lines = code.split('\n');
  const result: string[] = [];
  const keywords = ['import', 'export', 'class', 'function', 'interface', 'type', 'const', 'let', 'var', 'def', 'struct', 'enum', 'pub', 'fn', 'async'];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const firstWord = trimmed.split(' ')[0];
    if (keywords.includes(firstWord) || trimmed.startsWith('@') || trimmed.endsWith('{') || trimmed.endsWith(':') || trimmed.startsWith('import') || trimmed.startsWith('from') || trimmed.startsWith('use') || trimmed.startsWith('#include')) {
      result.push(line);
    } else {
      if (result.length > 0 && !result[result.length - 1].includes('...')) {
        const indent = line.match(/^\s*/)?.[0] || "";
        result.push(indent + "// ...");
      }
    }
  }

  return result.join('\n');
}
