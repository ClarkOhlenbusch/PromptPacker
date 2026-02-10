import { getFileSystem, FileEntry } from "../services/FileSystem";

interface CompressionStats {
  originalLines: number;
  compressedLines: number;
  ratio: number;
}

type CommentType =
  | 'structural'    // # --- Section --- or # ========
  | 'explanatory'   // # This does X because Y
  | 'todo'          // # TODO, FIXME, NOTE, HACK, XXX
  | 'trivial'       // # obvious stuff
  | 'disabled_code'; // # some_func() - commented out code

type CellBucket =
  | 'setup'
  | 'data_acquisition'
  | 'dataset_build'
  | 'training_invocation'
  | 'checkpoint_handling'
  | 'model_load'
  | 'inference_api'
  | 'evaluation'
  | 'debug_experiments'
  | 'plotting'
  | 'other';

interface CellCompressionContext {
  cellIndex: number;
  relativePath: string;
  bucket: CellBucket;
  bucketPrimaryIndex?: number;
  duplicateOfIndex?: number;
  signatureDuplicateOfIndex?: number;
}

const BUCKET_LABELS: Record<CellBucket, string> = {
  setup: "Setup",
  data_acquisition: "Data Acquisition",
  dataset_build: "Dataset Build",
  training_invocation: "Training Invocation",
  checkpoint_handling: "Checkpoint Handling",
  model_load: "Model Load",
  inference_api: "Inference API",
  evaluation: "Evaluation",
  debug_experiments: "Debug Experiments",
  plotting: "Plotting",
  other: "Other"
};

export async function generatePrompt(
  allEntries: FileEntry[],
  selectedPaths: Set<string>,
  tier1Paths: Set<string>,
  includeOutputPaths: Set<string>,
  preamble: string,
  goal: string,
  includeFileTree: boolean
): Promise<string> {
  let output = "";
  const fs = getFileSystem();
  const hashToCellIndex = new Map<string, number>();
  const signatureToCellIndex = new Map<string, number>();
  const bucketPrimaryIndex = new Map<CellBucket, number>();

  if (preamble.trim()) {
    output += "PREAMBLE\n" + preamble + "\n\n";
  }

  if (includeFileTree) {
    output += "TREE\n";
    output += generateTreeStructure(allEntries);
    output += "\n\n";
  }

  const selectedFiles = allEntries.filter(e => !e.is_dir && selectedPaths.has(e.path));

  for (let fileIndex = 0; fileIndex < selectedFiles.length; fileIndex++) {
    const file = selectedFiles[fileIndex];
    try {
      const content = await fs.readFileContent(file.path);

      // Handle markdown cells differently - no compression/skeletonization
      if (file.cellType === 'markdown') {
        output += `FILE ${file.relative_path} MARKDOWN\n`;
        output += content;
        output += "\nEND_FILE\n\n";
        continue;
      }

      const sanitizedFull = sanitizeCellContent(content);
      const sanitized = sanitizeCellContent(content, { pythonComments: true });
      const cellIndex = parseCellIndex(file.relative_path, fileIndex + 1);
      const bucket = classifyBucket(sanitized);
      const normalized = normalizeForHash(sanitized);
      const hash = normalized ? fnv1aHash(normalized) : "";
      const duplicateOfIndex = hash ? hashToCellIndex.get(hash) : undefined;
      if (!duplicateOfIndex && hash) {
        hashToCellIndex.set(hash, cellIndex);
      }

      const signatureKey = extractSignatureKey(sanitized);
      const signatureDuplicateOfIndex = !duplicateOfIndex && signatureKey
        ? signatureToCellIndex.get(signatureKey)
        : undefined;
      if (!duplicateOfIndex && signatureKey && !signatureDuplicateOfIndex) {
        signatureToCellIndex.set(signatureKey, cellIndex);
      }

      const existingPrimary = bucketPrimaryIndex.get(bucket);
      if (!duplicateOfIndex && !signatureDuplicateOfIndex && existingPrimary === undefined) {
        bucketPrimaryIndex.set(bucket, cellIndex);
      }
      const isFull = tier1Paths.has(file.path);

      output += `FILE ${file.relative_path} ${isFull ? 'FULL' : 'SKELETON'}\n`;

      if (isFull) {
        output += sanitizedFull;
      } else {
        const context: CellCompressionContext = {
          cellIndex,
          relativePath: file.relative_path,
          bucket,
          bucketPrimaryIndex: bucketPrimaryIndex.get(bucket),
          duplicateOfIndex,
          signatureDuplicateOfIndex
        };
        const { compressed, stats } = compressCodeWithStats(sanitized, context);
        output += compressed;
        // Add compression stats as a comment if available
        if (stats) {
          const ext = getFileExtension(file.path);
          const languageLabel = ext || "python";
          const commentPrefix = getCommentPrefix(ext);
          const diff = stats.originalLines - stats.compressedLines;
          const percent = stats.originalLines > 0
            ? Math.round(Math.abs(diff) / stats.originalLines * 100)
            : 0;
          const verb = diff >= 0 ? "reduced" : "expanded";
          // Try to detect language for display, though simple extension is fine
          output += `\n${commentPrefix} [${languageLabel}: ${stats.originalLines}→${stats.compressedLines} lines, ${percent}% ${verb}]`;
        }
      }

      // Append Cell Output if requested
      if (includeOutputPaths.has(file.path) && file.output && file.output.trim().length > 0) {
        output += "\n# Output:\n";
        output += file.output;
      }

      output += "\nEND_FILE\n\n";
    } catch (err) {
      console.error(`Failed to read ${file.path}`, err);
      // Minimal error format
      output += `FILE ${file.relative_path} ERROR\nError reading file.\nEND_FILE\n\n`;
    }
  }

  if (goal.trim()) {
    output += "GOAL\n" + goal + "\n";
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
      return aIsDir ? -1 : 1;
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

function getFileExtension(path: string): string | null {
  const base = path.split('/').pop() || path;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

function getCommentPrefix(ext: string | null): string {
  if (!ext || ext === "py" || ext === "ipynb") return "#";
  if (["js", "ts", "jsx", "tsx", "rs", "go", "c", "cpp", "h", "hpp", "java", "kt", "swift"].includes(ext)) {
    return "//";
  }
  if (ext === "sh" || ext === "bash") return "#";
  return "#";
}

function parseCellIndex(relativePath: string, fallback: number): number {
  const match = relativePath.match(/Cell\s+(\d+)/i);
  if (match) return Number(match[1]);
  return fallback;
}

interface SanitizeOptions {
  pythonComments?: boolean;
}

function sanitizeCellContent(code: string, options: SanitizeOptions = {}): string {
  const { pythonComments = false } = options;
  const lines = code.split('\n');
  const cleaned: string[] = [];

  for (const line of lines) {
    let next = line.replace(/:contentReference\[oaicite:[^\]]+\]/g, "");
    if (pythonComments && next.trim().startsWith("//")) {
      next = next.replace(/^(\s*)\/\/\s?/, "$1# ");
    }

    const trimmed = next.trim();
    if ((trimmed.startsWith("#") || trimmed.startsWith("//")) && /poop\s+poop\s+poop/i.test(trimmed)) {
      continue;
    }

    cleaned.push(next);
  }

  return cleaned.join('\n');
}

function normalizeForHash(code: string): string {
  return code
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith("#") && !line.startsWith("//"))
    .map(line => line.replace(/\s+/g, ""))
    .join("");
}

function fnv1aHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function classifyBucket(code: string): CellBucket {
  const text = code.toLowerCase();
  const scores = new Map<CellBucket, number>();
  const bump = (bucket: CellBucket, patterns: RegExp[], weight: number) => {
    if (patterns.some(pattern => pattern.test(text))) {
      scores.set(bucket, (scores.get(bucket) || 0) + weight);
    }
  };

  bump('setup', [/!pip\b/, /pip install/, /git clone/, /apt-get/, /conda install/, /!apt\b/, /!sudo\b/], 4);
  bump('data_acquisition', [/wget\b/, /curl\b/, /gdown\b/, /gsutil\b/, /kaggle\b/, /download\b/, /\.parquet\b/, /\.csv\b/, /\.jsonl\b/, /\.tsv\b/, /https?:\/\//], 3);
  bump('dataset_build', [/dataset\b/, /dataloader\b/, /tokenizer\b/, /tokenize\b/, /build_dataset\b/, /prepare_dataset\b/, /augment\b/, /np\.save\b/, /to_json\b/], 3);
  bump('training_invocation', [/train\b/, /trainer\b/, /fit\b/, /optimizer\b/, /backward\b/, /epochs?\b/], 3);
  bump('checkpoint_handling', [/checkpoint\b/, /state_dict\b/, /load_state_dict\b/, /torch\.save\b/, /torch\.load\b/, /ckpt\b/], 3);
  bump('model_load', [/from_pretrained\b/, /AutoModel\b/, /AutoTokenizer\b/, /load_model\b/, /load_pretrained\b/], 3);
  bump('inference_api', [/predict\b/, /inference\b/, /generate\b/, /forward\b/, /no_grad\b/, /logits\b/, /softmax\b/], 2);
  bump('evaluation', [/eval\b/, /accuracy\b/, /topk\b/, /metric\b/, /precision\b/, /recall\b/], 3);
  bump('plotting', [/plot\b/, /matplotlib\b/, /seaborn\b/, /plt\./], 3);
  bump('debug_experiments', [/print\b/, /inspect\b/, /pdb\b/, /assert\b/, /debug\b/, /logits\b/], 1);

  if (scores.size === 0) return "other";

  const order: CellBucket[] = [
    "setup",
    "data_acquisition",
    "dataset_build",
    "training_invocation",
    "checkpoint_handling",
    "model_load",
    "inference_api",
    "evaluation",
    "plotting",
    "debug_experiments",
    "other"
  ];

  let bestBucket: CellBucket = "other";
  let bestScore = 0;
  for (const bucket of order) {
    const score = scores.get(bucket) || 0;
    if (score > bestScore) {
      bestBucket = bucket;
      bestScore = score;
    }
  }

  return bestBucket;
}

function extractSignatureKey(code: string): string | null {
  const lines = code.split('\n');
  const signatures: string[] = [];
  let pendingDecorators: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (getIndent(line) !== 0) continue;

    if (trimmed.startsWith("@")) {
      pendingDecorators.push(trimmed.replace(/\s+/g, " "));
      continue;
    }

    const defMatch = trimmed.match(/^(def|class)\s+[A-Za-z_][A-Za-z0-9_]*/);
    if (defMatch) {
      const normalized = trimmed.replace(/\s+/g, " ");
      const combined = pendingDecorators.length
        ? `${pendingDecorators.join("|")}|${normalized}`
        : normalized;
      signatures.push(combined);
    }
    pendingDecorators = [];
  }

  if (signatures.length === 0) return null;
  return signatures.join("||");
}

// Shared helper: extract def/class name from a single line
function extractDefOrClassName(trimmed: string): string | null {
  const defMatch = trimmed.match(/^def\s+([A-Za-z_][A-Za-z0-9_]*)/);
  if (defMatch) return defMatch[1];
  const classMatch = trimmed.match(/^class\s+([A-Za-z_][A-Za-z0-9_]*)/);
  if (classMatch) return classMatch[1];
  return null;
}

function extractDefinitionNames(code: string): string[] {
  const names = new Set<string>();
  const lines = code.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || getIndent(line) !== 0) continue;

    const name = extractDefOrClassName(trimmed);
    if (name) names.add(name);
  }

  return Array.from(names);
}

function compressCodeWithStats(code: string, context: CellCompressionContext): { compressed: string, stats?: CompressionStats } {
  const originalLines = countNonEmptyLines(code);
  const variantKind = getVariantKind(context);

  const result: string[] = [];
  const bucketLabel = BUCKET_LABELS[context.bucket];

  // Track whether we're keeping full code (skip metadata overhead for small cells)
  let keptFullCode = false;

  if (variantKind === null && originalLines < 6) {
    // For very small cells, just output the code directly without metadata overhead
    result.push(...code.split("\n"));
    keptFullCode = true;
  } else if (variantKind === "duplicate") {
    const names = extractDefinitionNames(code);
    const nameHint = names.length ? ` (${names.join(", ")})` : "";
    result.push(`# Duplicate of Cell ${context.duplicateOfIndex}${nameHint}`);
  } else if (variantKind === "signature") {
    const summary = summarizeCell(code);
    const target = context.signatureDuplicateOfIndex
      ? `signature duplicate of Cell ${context.signatureDuplicateOfIndex}`
      : "signature duplicate";
    result.push(`# Variant of ${bucketLabel} (${target}): ${summary}`);
  } else if (variantKind === "bucket") {
    const summary = summarizeCell(code);
    const target = context.bucketPrimaryIndex && context.bucketPrimaryIndex !== context.cellIndex
      ? `see Cell ${context.bucketPrimaryIndex}`
      : "see primary cell";
    result.push(`# Variant of ${bucketLabel} (${target}): ${summary}`);
  } else {
    result.push(`# Bucket: ${bucketLabel}`);
    result.push(...skeletonizePythonCell(code));
  }

  // Only add state contract for cells that were actually skeletonized
  if (!keptFullCode) {
    const contract = buildStateContract(code);
    result.push(`# Defines: ${formatList(contract.defines)}`);
    result.push(`# Reads: ${formatList(contract.reads)}`);
    if (contract.writes.length > 0) {
      result.push(`# Writes: ${formatList(contract.writes)}`);
    }
  }

  const compressed = result.join("\n");
  const compressedLines = countNonEmptyLines(compressed);
  const rawRatio = originalLines > 0 ? (originalLines - compressedLines) / originalLines : 0;
  const ratio = Math.max(0, rawRatio);

  return {
    compressed,
    stats: { originalLines, compressedLines, ratio }
  };
}

type VariantKind = "duplicate" | "signature" | "bucket" | null;

function getVariantKind(context: CellCompressionContext): VariantKind {
  if (context.duplicateOfIndex) return "duplicate";
  if (context.signatureDuplicateOfIndex) return "signature";
  if (context.bucketPrimaryIndex && context.bucketPrimaryIndex !== context.cellIndex) return "bucket";
  return null;
}

function countNonEmptyLines(code: string): number {
  return code.split('\n').filter(line => line.trim().length > 0).length;
}

function skeletonizePythonCell(code: string): string[] {
  const lines = code.split('\n');
  const result: string[] = [];

  const imports = new Set<string>();
  const structuralComments: { index: number; line: string }[] = [];
  const constants: string[] = [];
  const definitionLines: string[] = [];
  const topLevelCalls: string[] = [];
  const summarizedAssignments: string[] = [];
  let skippedTopLevel = false;
  let pendingDecorators: string[] = [];
  let pendingComments: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Only process top-level code
    if (getIndent(line) !== 0) {
      continue;
    }

    // Handle comments at top level
    if (isCommentLine(trimmed)) {
      const commentType = classifyComment(trimmed);
      if (shouldKeepComment(commentType)) {
        if (commentType === 'structural') {
          // Structural comments go to their own list to preserve position
          structuralComments.push({ index: i, line: trimmed });
        } else {
          // Explanatory/TODO comments attach to next definition
          pendingComments.push(trimmed);
        }
      }
      continue;
    }

    // Handle decorators
    if (trimmed.startsWith("@")) {
      pendingDecorators.push(trimmed);
      continue;
    }

    // Handle imports
    if (isImportLine(trimmed)) {
      imports.add(trimmed);
      pendingDecorators = [];
      pendingComments = [];
      continue;
    }

    // Handle function/class definitions
    if (trimmed.startsWith("def ") || trimmed.startsWith("class ")) {
      const block = collectBlock(lines, i);

      // Add pending comments before this definition
      if (pendingComments.length > 0) {
        pendingComments.forEach(c => definitionLines.push(c));
        pendingComments = [];
      }

      // Add decorators
      if (pendingDecorators.length > 0) {
        pendingDecorators.forEach(decorator => definitionLines.push(decorator));
        pendingDecorators = [];
      }

      // Add signature
      block.signatureLines.forEach(sig => definitionLines.push(sig));

      const summaryIndent = " ".repeat(block.indent + 4);

      // Check if we should keep the full body (small function)
      if (shouldKeepFullBody(block.bodyLines)) {
        // Keep full body for small functions
        block.bodyLines.forEach(bodyLine => definitionLines.push(bodyLine));
      } else {
        // Extract docstring first line
        const docSummary = extractDocstringSummary(block.bodyLines);
        const hasDocstring = docSummary !== null;
        if (hasDocstring) {
          definitionLines.push(`${summaryIndent}"""${docSummary}"""`);
        }

        // Generate summary phrases (skip "implementation elided" if we have docstring)
        const summaryLines = summarizeBody(block.bodyLines, hasDocstring);
        summaryLines.forEach(summary => definitionLines.push(`${summaryIndent}# ${summary}`));
      }

      i = block.endIndex;
      continue;
    }

    // Handle assignments
    const assignment = parseAssignment(trimmed);
    if (assignment) {
      const action = classifyAssignment(assignment.name, assignment.value, code);
      if (action === 'keep') {
        constants.push(trimmed);
      } else if (action === 'summarize') {
        summarizedAssignments.push(assignment.name);
        skippedTopLevel = true;
      } else {
        skippedTopLevel = true;
      }
      pendingDecorators = [];
      pendingComments = [];
      continue;
    }

    // Handle print statements - skip but capture intent
    if (isPrintStatement(trimmed)) {
      // Print statements are removed, intent captured in summary
      skippedTopLevel = true;
      pendingDecorators = [];
      pendingComments = [];
      continue;
    }

    // Handle top-level calls (shell commands, magic)
    if (isTopLevelCall(trimmed)) {
      topLevelCalls.push(trimmed);
      pendingDecorators = [];
      pendingComments = [];
      continue;
    }

    skippedTopLevel = true;
    pendingDecorators = [];
    pendingComments = [];
  }

  if (pendingDecorators.length > 0) skippedTopLevel = true;

  // Build result in logical order
  // 1. Structural comments that appear before imports
  const firstImportIndex = lines.findIndex(l => isImportLine(l.trim()));
  structuralComments
    .filter(sc => firstImportIndex < 0 || sc.index < firstImportIndex)
    .forEach(sc => result.push(sc.line));

  // 2. Imports
  if (imports.size > 0) result.push(...Array.from(imports).sort());

  // 3. Structural comments after imports but before definitions
  structuralComments
    .filter(sc => firstImportIndex >= 0 && sc.index >= firstImportIndex)
    .forEach(sc => result.push(sc.line));

  // 4. Constants
  if (constants.length > 0) result.push(...constants);

  // 5. Definitions (with their attached comments)
  if (definitionLines.length > 0) result.push(...definitionLines);

  // 6. Top-level calls
  if (topLevelCalls.length > 0) result.push(...topLevelCalls);

  // 7. Note about summarized assignments
  if (summarizedAssignments.length > 0) {
    result.push(`# (assignments: ${summarizedAssignments.join(', ')})`);
  }

  // 8. Indicate skipped content
  if (skippedTopLevel || result.length === 0) result.push("# ...");

  return result;
}

function summarizeBody(bodyLines: string[], hasDocstring: boolean = false): string[] {
  const text = bodyLines.join("\n");
  const phrases = collectSummaryPhrases(text);

  // If no phrases found and no docstring, show fallback
  if (phrases.length === 0) {
    return hasDocstring ? [] : ["summary: implementation elided"];
  }

  const summaryLines: string[] = [];
  const chunkSize = 3;
  const maxLines = 3;
  for (let i = 0; i < phrases.length && summaryLines.length < maxLines; i += chunkSize) {
    summaryLines.push(`summary: ${phrases.slice(i, i + chunkSize).join(", ")}`);
  }

  return summaryLines;
}

function summarizeCell(code: string): string {
  const phrases = collectSummaryPhrases(code);
  const names = extractDefinitionNames(code);
  const summaryParts: string[] = [];
  if (names.length > 0) {
    summaryParts.push(`defines ${names.slice(0, 3).join(", ")}`);
  }
  summaryParts.push(...phrases);
  if (summaryParts.length === 0) return "content elided";
  return summaryParts.slice(0, 3).join("; ");
}

function collectSummaryPhrases(text: string): string[] {
  const lower = text.toLowerCase();
  const phrases: string[] = [];
  const add = (pattern: RegExp, phrase: string) => {
    if (pattern.test(lower)) phrases.push(phrase);
  };

  add(/torch\.load|load_state_dict|\.load\(/, "loads checkpoint/state_dict");
  add(/torch\.save|np\.save|save_pretrained|\.to_json|\.to_csv|pickle\.dump/, "writes artifacts/checkpoints");
  add(/pd\.read|np\.load|json\.load|open\([^)]*['"]r/, "reads data files");
  add(/tokenizer\.|\.tokenize|\.encode\(|\.decode\(/, "tokenizes/encodes text");
  add(/augment|shuffle\(|\.sample\(/, "applies augmentation/sampling");
  add(/\.train\(|\.fit\(|optimizer\.|\.backward\(|loss\./, "runs training loop");
  add(/\.eval\(|accuracy|top_?k|metric|precision|recall/, "evaluates metrics");
  add(/plt\.|\.plot\(|seaborn|sns\./, "plots figures");
  add(/\.cuda\(|\.to\(device|\.to\(['"]cuda/, "moves tensors to device");
  add(/pad_sequence|\.pad\(|max_length=|attention_mask/, "prepares inputs/masks");
  add(/DataLoader|\.batch\(|collate_fn/, "builds batches/dataloaders");
  add(/\.logits|softmax\(|\.argmax\(/, "computes logits/probabilities");
  add(/!pip|pip install|requirements\.txt/, "installs dependencies");
  add(/!git clone|!wget|!curl|gdown/, "downloads external resources");

  // Also extract intent from print statements in the text
  const printMatches = text.match(/print\s*\([^)]+\)/g) || [];
  for (const pm of printMatches) {
    const intent = extractPrintIntent(pm);
    if (intent) phrases.push(intent);
  }

  return Array.from(new Set(phrases));
}

interface StateContract {
  defines: string[];
  reads: string[];
  writes: string[];
}

function buildStateContract(code: string): StateContract {
  const defines = new Set<string>();
  const reads = new Set<string>();
  const writes = new Set<string>();
  const lines = code.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (getIndent(line) === 0) {
      // Use shared helper for def/class extraction
      const defOrClassName = extractDefOrClassName(trimmed);
      if (defOrClassName) {
        defines.add(defOrClassName);
      } else {
        const assignment = parseAssignment(trimmed);
        if (assignment) defines.add(assignment.name);
      }
    }

    const paths = extractPathsFromLine(line);
    if (paths.length > 0) {
      const intent = classifyReadWrite(trimmed.toLowerCase());
      for (const path of paths) {
        if (intent === "write") {
          writes.add(path);
        } else {
          reads.add(path);
        }
      }
    }
  }

  return {
    defines: Array.from(defines),
    reads: Array.from(reads),
    writes: Array.from(writes)
  };
}

function extractPathsFromLine(line: string): string[] {
  const paths: string[] = [];
  const stringRegex = /(["'])([^"']+)\1/g;
  let match: RegExpExecArray | null;
  while ((match = stringRegex.exec(line)) !== null) {
    const value = match[2];
    if (looksLikePath(value)) paths.push(value);
  }

  const urlRegex = /(https?:\/\/[^\s'"]+|gs:\/\/[^\s'"]+|s3:\/\/[^\s'"]+)/g;
  const urlMatches = line.match(urlRegex);
  if (urlMatches) {
    urlMatches.forEach(url => paths.push(url));
  }

  return Array.from(new Set(paths));
}

function looksLikePath(value: string): boolean {
  if (value.length < 4) return false;

  // Reject strings that look like regex patterns or escape sequences
  if (/^[\^$]/.test(value)) return false; // Starts with regex anchors
  if (/\\[snrtdwbDWSB]/.test(value)) return false; // Contains regex escape sequences
  if (/^\\n|^\\t/.test(value)) return false; // Starts with newline/tab escape
  if (/\{[^}]+\}/.test(value)) return false; // Contains f-string interpolation like {var}
  if (/[*+?|()[\]]/.test(value)) return false; // Contains regex metacharacters

  // Must have path-like structure: contains / or \ in a path context
  if (value.includes("/")) {
    // Should look like a path, not a URL fragment or regex
    return /^[./~]|^[a-zA-Z]:/.test(value) || /\.\w+$/.test(value);
  }

  // File extension check
  return /\.(json|npy|pt|pth|ckpt|csv|parquet|txt|pkl|npz|tsv|jsonl)$/i.test(value);
}

function classifyReadWrite(text: string): "read" | "write" {
  let isWrite = /save|dump|write|to_csv|to_json|to_parquet|torch\.save|np\.save|pickle\.dump/.test(text);
  let isRead = /read|load|read_csv|read_parquet|read_json|torch\.load|np\.load|json\.load|wget|curl|gdown|gsutil/.test(text);

  if (/open\([^)]*['"]w/.test(text) || /mode\s*=\s*['"]w/.test(text)) isWrite = true;
  if (/open\([^)]*['"]r/.test(text) || /mode\s*=\s*['"]r/.test(text)) isRead = true;

  if (isWrite) return "write";
  if (isRead) return "read";
  return "read";
}

function formatList(values: string[], limit = 6): string {
  const unique = Array.from(new Set(values)).filter(Boolean);
  if (unique.length === 0) return "(none)";
  const display = unique.slice(0, limit);
  const suffix = unique.length > limit ? ", ..." : "";
  return `${display.join(", ")}${suffix}`;
}

function getIndent(line: string): number {
  return line.match(/^\s*/)?.[0]?.length || 0;
}

function isImportLine(trimmed: string): boolean {
  return trimmed.startsWith("import ") || trimmed.startsWith("from ");
}

function isTopLevelCall(trimmed: string): boolean {
  if (trimmed.startsWith("!") || trimmed.startsWith("%")) return true;
  if (/^(if|for|while|with|try|except|def|class)\b/.test(trimmed)) return false;
  return /^[A-Za-z_][A-Za-z0-9_.]*\s*\(.*\)/.test(trimmed);
}

function parseAssignment(trimmed: string): { name: string; value: string } | null {
  if (!trimmed.includes("=")) return null;
  if (trimmed.includes("==")) return null;
  if (/^(if|for|while)\b/.test(trimmed)) return null;
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
  if (!match) return null;
  return { name: match[1], value: match[2] };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectBlock(lines: string[], startIndex: number): { signatureLines: string[]; bodyLines: string[]; endIndex: number; indent: number } {
  const baseIndent = getIndent(lines[startIndex]);
  const signatureLines: string[] = [lines[startIndex].trimEnd()];
  let parenBalance = countParens(lines[startIndex]);
  let i = startIndex;

  while (i + 1 < lines.length) {
    const trimmed = lines[i].trim();
    if (trimmed.endsWith(":") && parenBalance <= 0) break;
    i++;
    signatureLines.push(lines[i].trimEnd());
    parenBalance += countParens(lines[i]);
    if (lines[i].trim().endsWith(":") && parenBalance <= 0) break;
  }

  const bodyLines: string[] = [];
  let j = i + 1;
  for (; j < lines.length; j++) {
    const line = lines[j];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (getIndent(line) <= baseIndent) break;
    bodyLines.push(line);
  }

  return { signatureLines, bodyLines, endIndex: j - 1, indent: baseIndent };
}

function countParens(line: string): number {
  let count = 0;
  for (const char of line) {
    if (char === "(") count++;
    if (char === ")") count--;
  }
  return count;
}

// ============ Comment Classification ============

function classifyComment(comment: string): CommentType {
  const trimmed = comment.trim();

  // Check for markdown-style headers: ## Header or ### Header (before stripping #)
  if (/^#{2,}\s/.test(trimmed)) return 'structural';

  const text = trimmed.replace(/^#\s*/, '');

  // Structural: section dividers like # --- Section --- or # ========
  if (/^[-=]{3,}/.test(text) || /[-=]{3,}$/.test(text)) return 'structural';

  // TODO variants
  if (/^(TODO|FIXME|NOTE|HACK|XXX|BUG|WARNING)\b/i.test(text)) return 'todo';

  // Disabled code: looks like valid Python
  if (looksLikeDisabledCode(text)) return 'disabled_code';

  // Trivial: very short and not ending with colon (not a label)
  if (text.length < 15 && !/:$/.test(text)) return 'trivial';

  return 'explanatory';
}

function looksLikeDisabledCode(text: string): boolean {
  // Matches patterns like: func(), var = x, import foo, for x in
  return /^[a-z_]\w*\s*\(|^\w+\s*=\s*\w|^(import|from|for|if|while|def|class)\s/i.test(text);
}

function shouldKeepComment(commentType: CommentType): boolean {
  return commentType === 'structural' ||
    commentType === 'explanatory' ||
    commentType === 'todo';
}

function isCommentLine(trimmed: string): boolean {
  return trimmed.startsWith('#') && !trimmed.startsWith('#!');
}

// ============ Docstring Extraction ============

function extractDocstringSummary(bodyLines: string[]): string | null {
  if (bodyLines.length === 0) return null;

  const first = bodyLines[0].trim();

  // Single-line docstring: """Summary here.""" or '''Summary here.'''
  const singleMatch = first.match(/^(["']{3})(.+?)\1$/);
  if (singleMatch) return singleMatch[2].trim();

  // Multi-line docstring: extract first meaningful line
  const multiStart = first.match(/^(["']{3})(.*)$/);
  if (multiStart) {
    const content = multiStart[2].trim();
    if (content) return content;
    // First line is just """, look at next line
    if (bodyLines.length > 1) {
      const secondLine = bodyLines[1].trim();
      // Check if second line closes the docstring
      if (secondLine.match(/^["']{3}$/)) return null;
      return secondLine.replace(/["']{3}$/, '').trim() || null;
    }
  }

  return null;
}

// ============ Small Function Detection ============

const SMALL_FUNCTION_THRESHOLD = 6;

function shouldKeepFullBody(bodyLines: string[]): boolean {
  const nonEmpty = bodyLines.filter(l => l.trim().length > 0);
  return nonEmpty.length <= SMALL_FUNCTION_THRESHOLD;
}

// ============ Print Statement Handling ============

function isPrintStatement(line: string): boolean {
  return /^\s*print\s*\(/.test(line);
}

function extractPrintIntent(printLine: string): string | null {
  const match = printLine.match(/print\s*\(\s*f?["']([^"']+)/);
  if (match) {
    const msg = match[1].toLowerCase();
    if (/build|creat|generat/i.test(msg)) return 'building/generating';
    if (/load|read/i.test(msg)) return 'loading';
    if (/sav|writ/i.test(msg)) return 'saving';
    if (/train|epoch/i.test(msg)) return 'training progress';
    if (/process/i.test(msg)) return 'processing';
    if (/done|finish|complete/i.test(msg)) return 'completion';
  }
  return null;
}

// ============ Assignment Classification ============

type AssignmentAction = 'keep' | 'summarize' | 'remove';

function classifyAssignment(name: string, value: string, code: string): AssignmentAction {
  // Always keep: CONSTANTS
  if (name === name.toUpperCase() && name.length > 1) return 'keep';

  // Always keep: paths
  if (looksLikePath(value)) return 'keep';

  // Always keep: config-like names
  if (/^(config|params|args|options|settings|opts)/i.test(name)) return 'keep';

  // Always keep: used multiple times
  if (isNameReferencedMultipleTimes(code, name)) return 'keep';

  // Summarize: large objects (mention in contract, don't show value)
  if (/DataFrame|tensor|array|model|tokenizer|dataset/i.test(value)) return 'summarize';

  // Remove: very long values
  if (value.length > 100) return 'remove';

  // Keep: short values by default
  return 'keep';
}

function isNameReferencedMultipleTimes(code: string, name: string): boolean {
  const escaped = escapeRegExp(name);
  const regex = new RegExp(`\\b${escaped}\\b`, 'g');
  const matches = code.match(regex);
  return matches ? matches.length > 2 : false;
}
