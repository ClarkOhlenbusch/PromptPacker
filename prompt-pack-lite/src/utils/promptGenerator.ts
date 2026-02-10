import { invoke } from "@tauri-apps/api/core";
import { FileEntry } from "../services/FileSystem";

// Result from Rust skeleton extraction
interface SkeletonResult {
  skeleton: string;
  language: string | null;
  original_lines: number;
  skeleton_lines: number;
  compression_ratio: number;
}

type SkeletonBatchResult = { Ok: SkeletonResult } | { Err: string };

const MAX_TREE_LINES = 4000;

export async function generatePrompt(
  allEntries: FileEntry[],
  selectedPaths: Set<string>,
  tier1Paths: Set<string>,
  preamble: string,
  goal: string,
  includeFileTree: boolean
): Promise<string> {
  const sections: string[] = [];

  if (preamble.trim()) {
    sections.push("PREAMBLE\n", preamble, "\n\n");
  }

  if (includeFileTree) {
    sections.push("TREE\n", generateTreeStructure(allEntries), "\n\n");
  }

  const selectedEntries = allEntries.filter((entry) => selectedPaths.has(entry.path));
  const effectiveSelectedPaths = new Set(selectedPaths);
  const needsTauriLib = selectedEntries.some((entry) =>
    entry.relative_path.startsWith("src-tauri/src/")
  );

  if (needsTauriLib) {
    const libEntry = allEntries.find(
      (entry) => !entry.is_dir && entry.relative_path === "src-tauri/src/lib.rs"
    );
    if (libEntry) {
      effectiveSelectedPaths.add(libEntry.path);
    }
  }

  const selectedFiles = allEntries.filter(
    (entry) => !entry.is_dir && effectiveSelectedPaths.has(entry.path)
  );

  const fallbackFiles: string[] = [];
  const fullFiles = selectedFiles.filter((file) => tier1Paths.has(file.path));
  const skeletonFiles = selectedFiles.filter((file) => !tier1Paths.has(file.path));

  const fullContentByPath = new Map<string, string>();
  const fullReadErrorsByPath = new Map<string, unknown>();
  const skeletonByPath = new Map<string, SkeletonResult>();
  const skeletonErrorsByPath = new Map<string, unknown>();
  const fallbackContentByPath = new Map<string, string>();
  const fallbackReadErrorsByPath = new Map<string, unknown>();

  const fullReadTask = Promise.all(
    fullFiles.map(async (file) => {
      try {
        const content = await invoke<string>("read_file_content", { path: file.path });
        fullContentByPath.set(file.path, content);
      } catch (err) {
        fullReadErrorsByPath.set(file.path, err);
      }
    })
  );

  const skeletonTask = (async () => {
    if (skeletonFiles.length === 0) {
      return;
    }

    const skeletonPaths = skeletonFiles.map((file) => file.path);

    try {
      const results = await invoke<SkeletonBatchResult[]>("skeletonize_files", { paths: skeletonPaths });

      if (results.length !== skeletonPaths.length) {
        const mismatchError = new Error(
          `Unexpected skeletonize_files response length: expected ${skeletonPaths.length}, got ${results.length}`
        );
        console.warn("Skeleton extraction batch returned unexpected result count, using full content:", mismatchError);
        for (const path of skeletonPaths) {
          skeletonErrorsByPath.set(path, mismatchError);
        }
        return;
      }

      for (let index = 0; index < skeletonPaths.length; index += 1) {
        const path = skeletonPaths[index];
        const result = results[index];

        if ("Ok" in result) {
          skeletonByPath.set(path, result.Ok);
          continue;
        }

        skeletonErrorsByPath.set(path, result.Err);
      }
    } catch (err) {
      console.warn("Batch skeleton extraction failed, using full content:", err);
      for (const path of skeletonPaths) {
        skeletonErrorsByPath.set(path, err);
      }
    }
  })();

  await Promise.all([fullReadTask, skeletonTask]);

  const fallbackPaths = skeletonFiles
    .map((file) => file.path)
    .filter((path) => skeletonErrorsByPath.has(path));

  await Promise.all(
    fallbackPaths.map(async (path) => {
      try {
        const content = await invoke<string>("read_file_content", { path });
        fallbackContentByPath.set(path, compressCode(content));
      } catch (err) {
        fallbackReadErrorsByPath.set(path, err);
      }
    })
  );

  for (const file of selectedFiles) {
    const fileSections: string[] = [];
    const isFullFile = tier1Paths.has(file.path);
    fileSections.push(`FILE ${file.relative_path} ${isFullFile ? "FULL" : "SKELETON"}\n`);

    if (isFullFile) {
      const content = fullContentByPath.get(file.path);
      if (content !== undefined) {
        fileSections.push(content);
      } else {
        const err = fullReadErrorsByPath.get(file.path) ?? new Error("Missing full file content");
        console.error(`Failed to read ${file.path}`, err);
        fileSections.push("Error reading file.");
      }
    } else {
      const result = skeletonByPath.get(file.path);

      if (result) {
        fileSections.push(result.skeleton);

        if (result.language) {
          fileSections.push(
            `\n// [${result.language}: ${result.original_lines}->${result.skeleton_lines} lines, ${Math.round(result.compression_ratio * 100)}% reduced]`
          );
        }
      } else if (skeletonErrorsByPath.has(file.path)) {
        const skeletonErr = skeletonErrorsByPath.get(file.path);
        console.warn(`Skeleton extraction failed for ${file.path}, using full content:`, skeletonErr);
        fallbackFiles.push(file.relative_path);

        const fallbackContent = fallbackContentByPath.get(file.path);
        if (fallbackContent !== undefined) {
          fileSections.push(fallbackContent);
        } else {
          const err = fallbackReadErrorsByPath.get(file.path) ?? new Error("Missing fallback file content");
          console.error(`Failed to read ${file.path}`, err);
          fileSections.push("Error reading file.");
        }
      } else {
        const err = new Error("Missing skeleton result");
        console.error(`Failed to read ${file.path}`, err);
        fileSections.push("Error reading file.");
      }
    }

    fileSections.push("\nEND_FILE\n\n");
    sections.push(fileSections.join(""));
  }

  if (goal.trim()) {
    sections.push("GOAL\n", goal, "\n");
  }

  if (fallbackFiles.length > 0) {
    const warningLines = fallbackFiles.map((file) => `// ! - ${file}`).join("\n");
    sections.push(
      "\n// ! FALLBACK WARNING: AST Skeletonization failed for the following files (naive compression used):\n",
      warningLines,
      "\n"
    );
  }

  return sections.join("");
}

function generateTreeStructure(entries: FileEntry[]): string {
  type Node = { name: string; entry?: FileEntry; children: Record<string, Node> };
  const root: Node = { name: "root", children: {} };

  entries.forEach((entry) => {
    const parts = entry.relative_path.split("/");
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

  const lines: string[] = [];
  let truncated = false;

  const appendLine = (line: string) => {
    if (lines.length >= MAX_TREE_LINES) {
      truncated = true;
      return;
    }
    lines.push(line);
  };

  function printNode(node: Node, prefix: string, isLast: boolean, isRoot: boolean) {
    if (truncated) {
      return;
    }

    if (!isRoot) {
      const connector = isLast ? "\\- " : "|- ";
      const stats = node.entry && !node.entry.is_dir
        ? ` (${formatSize(node.entry.size)}, ${node.entry.line_count ?? 0} lines)`
        : "";

      appendLine(`${prefix}${connector}${node.name}${stats}`);
    }

    if (truncated) {
      return;
    }

    const childrenKeys = Object.keys(node.children).sort((a, b) => a.localeCompare(b));
    for (let index = 0; index < childrenKeys.length; index += 1) {
      const child = node.children[childrenKeys[index]];
      const isChildLast = index === childrenKeys.length - 1;
      const childPrefix = isRoot ? "" : prefix + (isLast ? "   " : "|  ");
      printNode(child, childPrefix, isChildLast, false);
      if (truncated) {
        break;
      }
    }
  }

  printNode(root, "", true, true);

  if (truncated) {
    lines.push("... tree truncated ...");
  }

  return lines.join("\n");
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function compressCode(code: string): string {
  const lines = code.split("\n");
  const result: string[] = [];
  const keywords = [
    "import",
    "export",
    "class",
    "function",
    "interface",
    "type",
    "const",
    "let",
    "var",
    "def",
    "struct",
    "enum",
    "pub",
    "fn",
    "async",
  ];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const firstWord = trimmed.split(" ")[0];
    const keepLine =
      keywords.includes(firstWord) ||
      trimmed.startsWith("@") ||
      trimmed.endsWith("{") ||
      trimmed.endsWith(":") ||
      trimmed.startsWith("import") ||
      trimmed.startsWith("from") ||
      trimmed.startsWith("use") ||
      trimmed.startsWith("#include");

    if (keepLine) {
      result.push(line);
      continue;
    }

    if (result.length > 0 && !result[result.length - 1].includes("...")) {
      const indent = line.match(/^\s*/)?.[0] || "";
      result.push(indent + "// ...");
    }
  }

  return result.join("\n");
}
