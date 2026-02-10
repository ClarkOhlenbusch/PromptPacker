import { getFileSystem, FileEntry } from "../services/FileSystem";

export async function generateAutoPreamble(files: FileEntry[]): Promise<string> {
  const parts: string[] = [];
  const fs = getFileSystem();

  // Separate code and markdown cells
  const codeCells = files.filter(f => !f.is_dir && f.cellType === 'code');
  const markdownCells = files.filter(f => !f.is_dir && f.cellType === 'markdown');

  // Gather content from all cells
  const codeContents: string[] = [];
  for (const cell of codeCells) {
    try {
      const content = cell.content || await fs.readFileContent(cell.path);
      if (content && content.trim()) codeContents.push(content);
    } catch { /* skip unreadable cells */ }
  }

  const markdownContents: string[] = [];
  for (const cell of markdownCells) {
    try {
      const content = cell.content || await fs.readFileContent(cell.path);
      if (content && content.trim()) markdownContents.push(content);
    } catch { /* skip unreadable cells */ }
  }

  // 1. Notebook Title — first # heading from any markdown cell
  const title = extractTitle(markdownContents);
  if (title) parts.push(`Notebook: ${title}`);

  // 2. Notebook Outline — heading structure from markdown cells
  const outline = extractOutline(markdownContents);
  if (outline) parts.push(outline);

  // 3. Libraries from code cells
  const libraries = extractLibraries(codeContents);
  if (libraries.length > 0) {
    parts.push(`Libraries: ${libraries.join(', ')}`);
  }

  // 4. Key Definitions from code cells
  const definitions = extractDefinitions(codeContents);
  if (definitions.length > 0) {
    const display = definitions.slice(0, 12);
    parts.push(`Key Definitions: ${display.join(', ')}${definitions.length > 12 ? ', ...' : ''}`);
  }

  // 5. Data Source Detection from code cells
  const dataSources = extractDataSources(codeContents);
  if (dataSources.length > 0) {
    parts.push(`Data Sources: ${dataSources.join(', ')}`);
  }

  // 6. Hardware/Environment from code cells
  const hardware = extractHardwareInfo(codeContents);
  if (hardware) parts.push(`Environment: ${hardware}`);

  // 7. Notebook cell stats
  const stats = calculateStats(files);
  if (stats) parts.push(stats);

  return parts.join("\n\n");
}

// ─── Markdown Analyzers ────────────────────────────────────────────

function extractTitle(markdownContents: string[]): string | null {
  for (const md of markdownContents) {
    const lines = md.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // Match a top-level heading: "# Title" but not "## Subtitle"
      const match = trimmed.match(/^#\s+(.+)$/);
      if (match) return match[1].trim();
    }
  }
  return null;
}

function extractOutline(markdownContents: string[]): string | null {
  const headings: { level: number; text: string }[] = [];

  for (const md of markdownContents) {
    const lines = md.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // Match ## and ### headings (skip # which is the title)
      const match = trimmed.match(/^(#{2,3})\s+(.+)$/);
      if (match) {
        headings.push({
          level: match[1].length,
          text: match[2].trim()
        });
      }
    }
  }

  if (headings.length === 0) return null;

  const lines = headings.map((h, i) => {
    const indent = h.level === 2 ? '' : '  ';
    return `${indent}${i + 1}. ${h.text}`;
  });

  return `Outline:\n${lines.join('\n')}`;
}

// ─── Code Analyzers ────────────────────────────────────────────────

function extractLibraries(contents: string[]): string[] {
  const libs = new Set<string>();
  // Standard Python builtins to exclude from the list
  const builtins = new Set([
    'os', 'sys', 'io', 'json', 'math', 'time', 'datetime', 're',
    'collections', 'itertools', 'functools', 'typing', 'pathlib',
    'copy', 'glob', 'shutil', 'tempfile', 'subprocess', 'logging',
    'warnings', 'abc', 'enum', 'dataclasses', 'contextlib', 'textwrap',
    'random', 'string', 'struct', 'operator', 'pickle', 'csv',
    'argparse', 'configparser', 'hashlib', 'base64', 'unittest',
    'pprint', 'inspect', 'traceback', 'gc', 'weakref', 'threading',
    'multiprocessing', 'socket', 'http', 'urllib', 'ftplib',
    'email', 'html', 'xml', 'zipfile', 'tarfile', 'gzip', 'bz2',
    'sqlite3', 'decimal', 'fractions', 'statistics', 'secrets',
    'uuid', 'pdb', 'dis', 'ast', 'token', 'tokenize', '__future__'
  ]);

  for (const code of contents) {
    // Use matchAll to avoid lastIndex issues with exec+global
    const matches = code.matchAll(/^\s*(?:import\s+([\w]+)|from\s+([\w]+))/gm);
    for (const match of matches) {
      const lib = match[1] || match[2];
      if (lib && !builtins.has(lib)) libs.add(lib);
    }
  }

  return Array.from(libs).sort();
}

function extractDefinitions(contents: string[]): string[] {
  const defs: string[] = [];

  for (const code of contents) {
    const lines = code.split('\n');
    for (const line of lines) {
      // Only top-level (no leading whitespace)
      if (line.startsWith('class ')) {
        const match = line.match(/^class\s+([A-Za-z_]\w*)/);
        if (match) defs.push(`class ${match[1]}`);
      } else if (line.startsWith('def ')) {
        const match = line.match(/^def\s+([A-Za-z_]\w*)/);
        if (match) defs.push(`def ${match[1]}`);
      }
    }
  }

  return Array.from(new Set(defs));
}

function extractDataSources(contents: string[]): string[] {
  const sources = new Set<string>();
  const patterns = [
    { name: 'CSV File', regex: /\.read_csv\s*\(/ },
    { name: 'JSON File', regex: /\.read_json\s*\(|json\.load/ },
    { name: 'Parquet File', regex: /\.read_parquet\s*\(/ },
    { name: 'Excel File', regex: /\.read_excel\s*\(/ },
    { name: 'HuggingFace Dataset', regex: /load_dataset\s*\(/ },
    { name: 'SQL Database', regex: /read_sql|\.execute\s*\(\s*['"]SELECT/i },
    { name: 'Google Drive', regex: /drive\.mount|from\s+google\.colab\s+import\s+drive/ },
    { name: 'Web Download', regex: /!wget\s|!curl\s|requests\.get\s*\(|gdown\.download/ },
    { name: 'Kaggle', regex: /kaggle\s+datasets|!kaggle/ },
    { name: 'GCS Bucket', regex: /gs:\/\/|gsutil/ },
    { name: 'Torch Checkpoint', regex: /torch\.load\s*\(/ },
    { name: 'NumPy File', regex: /np\.load\s*\(|np\.loadtxt/ },
  ];

  const all = contents.join('\n');
  for (const p of patterns) {
    if (p.regex.test(all)) sources.add(p.name);
  }

  return Array.from(sources).sort();
}

function extractHardwareInfo(contents: string[]): string | null {
  const code = contents.join('\n');
  const hints: string[] = [];

  if (/xm\.xla_device|google\.colab.*tpu|TPUStrategy/.test(code)) hints.push('TPU');
  if (/\.to\s*\(\s*['"]cuda['"]|torch\.device\s*\(\s*['"]cuda['"]|cuda\.is_available|torch\.cuda/.test(code)) hints.push('GPU/CUDA');
  if (/torch\.mps|\.to\s*\(\s*['"]mps['"]/.test(code)) hints.push('Apple MPS');

  if (hints.length === 0) return null;
  return hints.join(', ') + ' detected';
}

function calculateStats(files: FileEntry[]): string {
  let codeCount = 0;
  let mdCount = 0;

  for (const f of files) {
    if (f.is_dir) continue;
    if (f.cellType === 'code') codeCount++;
    else if (f.cellType === 'markdown') mdCount++;
  }

  const total = codeCount + mdCount;
  if (total === 0) return "";

  const parts = [];
  if (codeCount > 0) parts.push(`${codeCount} code`);
  if (mdCount > 0) parts.push(`${mdCount} markdown`);

  return `Notebook: ${total} cells (${parts.join(', ')})`;
}
