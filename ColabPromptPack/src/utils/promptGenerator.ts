import { getFileSystem, FileEntry } from "../services/FileSystem";

export async function generatePrompt(
  allEntries: FileEntry[],
  selectedPaths: Set<string>,
  tier1Paths: Set<string>,
  preamble: string,
  goal: string
): Promise<string> {
  let output = "";
  const fs = getFileSystem();

  if (preamble.trim()) {
    output += "### PREAMBLE ###\n" + preamble + "\n\n";
  }

  output += "### PROJECT STRUCTURE ###\n";
  output += generateTreeStructure(allEntries);
  output += "\n\n";

  output += "### FILE CONTENTS ###\n\n";

  const selectedFiles = allEntries.filter(e => !e.is_dir && selectedPaths.has(e.path));

  for (const file of selectedFiles) {
    try {
      const content = await fs.readFileContent(file.path);
      const isFull = tier1Paths.has(file.path);
      
      output += `##### File: ${file.relative_path} ${isFull ? '(FULL)' : '(SUMMARY)'} #####\n`;
      const ext = file.path.split('.').pop() || "";
      output += "```" + ext + "\n";
      
      if (isFull) {
        output += content;
      } else {
        output += compressCode(content);
      }
      
      output += "\n```\n\n";
    } catch (err) {
      console.error(`Failed to read ${file.path}`, err);
      output += `##### File: ${file.relative_path} (ERROR) #####\nError reading file.\n\n`;
    }
  }

  if (goal.trim()) {
    output += "### GOAL / QUERY ###\n" + goal + "\n";
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
