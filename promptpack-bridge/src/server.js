import http from "node:http";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import fsp from "node:fs/promises";
import { spawnAgentProcess, terminalBackend } from "./agent-process.js";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PROMPTPACK_BRIDGE_PORT || 47123);
const HOST = "127.0.0.1";
const REQUIRED_TOKEN = process.env.PROMPTPACK_BRIDGE_TOKEN || "";
const IDLE_TIMEOUT_MS = 20 * 60 * 1000;
const DIFF_POLL_INTERVAL_MS = 1800;
const COMMON_BIN_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  path.join(os.homedir(), ".local/bin"),
  ...(process.platform === "win32" ? [path.join(os.homedir(), "AppData/Roaming/npm")] : []),
];

const sessions = new Map();
const VERSION = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const ANSI_CSI_RE = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const ANSI_OSC_RE = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
const ANSI_SINGLE_RE = /\u001b[@-Z\\-_]/g;

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function hashContent(content) {
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function safeFileName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "cell";
}

function stripTerminalControl(text) {
  return String(text || "")
    .replace(ANSI_OSC_RE, "")
    .replace(ANSI_CSI_RE, "")
    .replace(ANSI_SINGLE_RE, "")
    .replace(/\u0007/g, "");
}

function respondToTerminalQueries(session, chunk) {
  if (!session?.process || typeof chunk !== "string" || chunk.length === 0) return;

  const combined = `${session.probeBuffer || ""}${chunk}`;
  const responses = [];

  if (combined.includes("\u001b[6n")) {
    responses.push("\u001b[1;1R");
  }

  if (combined.includes("\u001b[c")) {
    responses.push("\u001b[?1;2c");
  }

  if (combined.includes("\u001b]10;?\u0007") || combined.includes("\u001b]10;?\u001b\\")) {
    responses.push("\u001b]10;rgb:cccc/cccc/cccc\u0007");
  }

  if (combined.includes("\u001b]11;?\u0007") || combined.includes("\u001b]11;?\u001b\\")) {
    responses.push("\u001b]11;rgb:0000/0000/0000\u0007");
  }

  if (combined.includes("\u001b]12;?\u0007") || combined.includes("\u001b]12;?\u001b\\")) {
    responses.push("\u001b]12;rgb:ffff/ffff/ffff\u0007");
  }

  if (responses.length > 0) {
    for (const response of responses) {
      try {
        session.process.write(response);
      } catch {
        // Ignore best-effort probe response write failures.
      }
    }
  }

  const cleaned = combined
    .split("\u001b[6n").join("")
    .split("\u001b[c").join("")
    .replace(/\u001b\]10;\?(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\]11;\?(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\]12;\?(?:\u0007|\u001b\\)/g, "");

  session.probeBuffer = cleaned.slice(-1024);
}

function parseCommand(command) {
  const parts = [];
  let current = "";
  let quote = null;

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }

    if (ch === " ") {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current) parts.push(current);

  if (parts.length === 0) {
    throw new Error("Command is empty");
  }

  return { cmd: parts[0], args: parts.slice(1) };
}

function defaultAgentCommand(agent) {
  if (agent?.command) {
    return parseCommand(agent.command);
  }

  if (agent?.kind === "claude") {
    return { cmd: "claude", args: [] };
  }

  if (agent?.kind === "custom") {
    throw new Error("Custom agent requires an explicit command");
  }

  return { cmd: "codex", args: ["--no-alt-screen"] };
}

function normalizeCellPathFromInput(rawValue, session) {
  if (typeof rawValue !== "string") return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;

  const runPath = file => file?.creationPending || file?.discarded ? null : (file?.notebookCellPath || file?.cellPath || null);
  if (session.files.has(trimmed)) return runPath(session.files.get(trimmed));

  const directMatch = /^cell_(\d+)$/i.exec(trimmed);
  if (directMatch) {
    const cellPath = `cell_${Number.parseInt(directMatch[1], 10)}`;
    return runPath(session.files.get(cellPath));
  }

  const candidates = [
    trimmed,
    path.basename(trimmed),
    path.basename(trimmed).replace(/\.[^.]+$/g, ""),
  ];

  for (const candidate of candidates) {
    const match = /(?:^|[^a-z0-9])cell[_\s-]?(\d+)(?:[^a-z0-9]|$)/i.exec(candidate);
    if (!match) continue;
    const cellPath = `cell_${Number.parseInt(match[1], 10)}`;
    if (session.files.has(cellPath)) return runPath(session.files.get(cellPath));
  }

  const lowered = trimmed.toLowerCase();
  for (const file of session.files.values()) {
    if (lowered === file.fileName.toLowerCase()) return runPath(file);
    if (lowered === `notebook/${file.fileName.toLowerCase()}`) return runPath(file);
    if (file.relativePath && lowered === file.relativePath.toLowerCase()) return runPath(file);
  }

  return null;
}

function normalizeRunCommand(rawCommand, session) {
  if (!rawCommand || typeof rawCommand !== "object") {
    throw new Error("Run payload must be a JSON object");
  }

  const mode = String(rawCommand.mode || "").toLowerCase();
  if (mode !== "cell" && mode !== "range" && mode !== "all") {
    throw new Error(`Invalid run mode "${rawCommand.mode ?? ""}"`);
  }

  const normalized = { mode };

  if (mode === "all") {
    if (rawCommand.requestId !== undefined) {
      normalized.requestId = String(rawCommand.requestId);
    }
    return normalized;
  }

  if (mode === "range") {
    const source = rawCommand.range && typeof rawCommand.range === "object"
      ? rawCommand.range
      : rawCommand;
    const start = Number(source.start);
    const end = Number(source.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      throw new Error("Range run requires numeric start/end");
    }
    normalized.range = {
      start: Math.trunc(start),
      end: Math.trunc(end),
    };
    if (rawCommand.requestId !== undefined) {
      normalized.requestId = String(rawCommand.requestId);
    }
    return normalized;
  }

  const rawPaths = Array.isArray(rawCommand.cellPaths) ? rawCommand.cellPaths : [];
  const seen = new Set();
  const cellPaths = [];

  for (const rawPath of rawPaths) {
    const normalizedPath = normalizeCellPathFromInput(rawPath, session);
    if (!normalizedPath || seen.has(normalizedPath)) continue;
    seen.add(normalizedPath);
    cellPaths.push(normalizedPath);
  }

  if (cellPaths.length === 0) {
    throw new Error("Cell run requires at least one valid cell path");
  }

  normalized.cellPaths = cellPaths;

  if (rawCommand.requestId !== undefined) {
    normalized.requestId = String(rawCommand.requestId);
  }

  return normalized;
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveExecutable(cmd) {
  if (!cmd) return null;

  const extensions = process.platform === "win32" && !path.extname(cmd)
    ? ["", ...(process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";")]
    : [""];
  const findExecutable = base => extensions.map(extension => `${base}${extension}`).find(isExecutable) || null;
  if (cmd.includes(path.sep) || path.isAbsolute(cmd)) return findExecutable(cmd);

  const pathEntries = (process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);

  const candidates = [...pathEntries, ...COMMON_BIN_DIRS];
  const seen = new Set();

  for (const baseDir of candidates) {
    if (seen.has(baseDir)) continue;
    seen.add(baseDir);
    const fullPath = path.join(baseDir, cmd);
    const found = findExecutable(fullPath);
    if (found) return found;
  }

  return null;
}

function resolveAgentCommand(agent) {
  const resolved = resolveExecutable(agent.cmd);
  if (!resolved) {
    throw new Error(
      `"${agent.cmd}" was not found on this computer. Install your coding agent and reopen PromptPack Bridge, or enter the full executable path under Custom CLI.`
    );
  }
  return {
    ...agent,
    cmd: resolved,
  };
}

function formatCommandLine(agent) {
  const parts = [agent.cmd, ...(agent.args || [])];
  return parts.map((part) => {
    if (/^[a-zA-Z0-9_./:=+-]+$/.test(part)) return part;
    return JSON.stringify(part);
  }).join(" ");
}


function send(ws, type, payload = null, extras = {}) {
  if (!ws || ws.readyState !== 1) return;

  ws.send(JSON.stringify({
    type,
    payload,
    timestamp: Date.now(),
    ...extras,
  }));
}

function reply(ws, message, type, payload = null) {
  send(ws, type, payload, {
    replyTo: message.requestId,
  });
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  const temporary = `${filePath}.${createId("tmp")}`;
  try {
    await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fsp.rename(temporary, filePath);
  } finally {
    await fsp.rm(temporary, { force: true });
  }
}

function sessionState(session) {
  return {
    sessionId: session.id,
    workspacePath: session.workspacePath,
    startedAt: session.startedAt,
    agentKind: session.agentKind,
  };
}

function emitTerminal(session, data, fromPty = false) {
  // PTY output already has terminal line endings; bridge status messages do not.
  if (!fromPty) data = data.replace(/\r?\n/g, "\r\n");
  session.terminalOutput = `${session.terminalOutput || ""}${data}`.slice(-250_000);
  if (!session.owner) return;
  send(session.owner, "terminal_output", {
    sessionId: session.id,
    data,
  });
}

function emitRunProposal(session, command, summary) {
  if (!session.owner) return;

  const proposal = {
    proposalId: createId("run"),
    command,
    summary,
    createdAt: Date.now(),
  };

  session.pendingRuns.set(proposal.proposalId, proposal);
  send(session.owner, "agent_run_proposed", proposal);
}

function tryRestartAgentWithoutAltScreen(session) {
  if (session.retryWithoutAltAttempted) return false;
  if (session.agentKind !== "codex") return false;
  if (!session.agent || !Array.isArray(session.agent.args)) return false;
  if (!session.agent.args.includes("--no-alt-screen")) return false;

  session.retryWithoutAltAttempted = true;
  const nextAgent = {
    ...session.agent,
    args: session.agent.args.filter((arg) => arg !== "--no-alt-screen"),
  };

  let child;
  try {
    child = spawnAgentProcess(nextAgent, session.workspacePath);
  } catch (error) {
    emitTerminal(session, `[PromptPack] Retry failed: ${error?.message || "unable to restart agent"}\n`);
    return false;
  }

  session.agent = nextAgent;
  session.agentCommandLine = formatCommandLine(nextAgent);
  session.processStartedAt = Date.now();
  session.rawOutputSample = "";
  session.visibleOutputChars = 0;
  session.process = child;

  emitTerminal(session, "[PromptPack] Agent exited immediately. Retrying without --no-alt-screen...\n");
  emitTerminal(session, `[PromptPack] Launching agent: ${session.agentCommandLine}\n`);
  bindProcessHandlers(session, child);
  return true;
}

function bindProcessHandlers(session, child) {
  child.onData((text) => {
    session.rawOutputSample = `${session.rawOutputSample}${text}`.slice(-8000);
    session.visibleOutputChars += stripTerminalControl(text).trim().length;
    respondToTerminalQueries(session, text);
    emitTerminal(session, text, true);

    session.lineBuffer += text;
    const lines = session.lineBuffer.split(/\r?\n/);
    session.lineBuffer = lines.pop() || "";

    for (const line of lines) {
      const marker = "PROMPTPACK_RUN:";
      const cleanLine = stripTerminalControl(line).trim();
      if (!cleanLine.startsWith(marker)) continue;

      const raw = cleanLine.slice(marker.length).trim();
      try {
        const command = normalizeRunCommand(JSON.parse(raw), session);
        emitRunProposal(session, command, "Agent requested notebook execution");
      } catch (error) {
        emitTerminal(session, `\n[PromptPack] Ignored invalid PROMPTPACK_RUN: ${error?.message || "parse_failed"}\n`);
      }
    }
  });

  child.onExit((code) => {
    const uptimeMs = Date.now() - session.processStartedAt;
    if (uptimeMs < 3000 && code === 0) {
      const restarted = tryRestartAgentWithoutAltScreen(session);
      if (restarted) return;

      emitTerminal(
        session,
        "[PromptPack] Agent exited immediately with code 0. This usually means a non-interactive command was launched.\n"
      );
      emitTerminal(session, `[PromptPack] Last command: ${session.agentCommandLine}\n`);
      if (session.visibleOutputChars === 0 && session.rawOutputSample.trim().length > 0) {
        emitTerminal(session, `[PromptPack] Raw output sample: ${JSON.stringify(session.rawOutputSample.slice(-240))}\n`);
      }
    }

    emitTerminal(session, `\n[PromptPack] Agent exited (${code ?? "unknown"})\n`);
    cleanupSession(session, "agent_exit");
  });
}

async function initializeWorkspace(payload) {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), "promptpack-session-"));
  const notebookDir = path.join(base, "notebook");
  const metaDir = path.join(notebookDir, ".promptpack");

  await ensureDir(notebookDir);
  await ensureDir(metaDir);
  await ensureDir(path.join(notebookDir, "new_cells"));
  await ensureDir(path.join(metaDir, "commands"));

  const files = new Map();

  for (const cell of payload.cells || []) {
    const ext = cell.cellType === "markdown" ? ".md" : ".py";
    const fileName = `${safeFileName(cell.relativePath || cell.path)}_${cell.path}${ext}`;
    const fullPath = path.join(notebookDir, fileName);
    const content = typeof cell.content === "string" ? cell.content : "";

    await fsp.writeFile(fullPath, content, "utf8");

    files.set(cell.path, {
      cellPath: cell.path,
      cellId: cell.cellId,
      notebookCellPath: cell.path,
      relativePath: cell.relativePath,
      filePath: fullPath,
      fileName,
      cellType: cell.cellType || "code",
      baselineContent: content,
      baselineHash: hashContent(content),
      pendingProposalId: null,
    });
  }

  await writeWorkspaceMetadata({ workspacePath: base, files, notebook: payload.notebook });

  const contextLines = [
    "You are operating inside PromptPack Bridge.",
    "Only edit files under ./notebook.",
    "Each file maps to one Colab cell.",
    "Saved edits to mapped files sync automatically to the open Colab notebook.",
    "",
    "To APPEND new cells to Colab, create files in ./notebook/new_cells/:",
    "  01_prediction_maps.py creates a Python code cell.",
    "  02_explanation.md creates a Markdown cell.",
    "Each .py or .md file in that folder becomes one new cell at the END of the notebook.",
    "Write the complete content, then wait a few seconds for sync. Files discovered together append in filename order.",
    "Continue editing the SAME file to update that cell; do not copy or rename it to update it.",
    "Do NOT create a separate .ipynb to add cells: .ipynb files are not imported by Bridge.",
    "Deleting files does not delete Colab cells. For moving, deleting, running, and inspecting cells, use the command interface below.",
    "Write a unique JSON file in ./notebook/.promptpack/commands/, for example 001.json. Wait for 001.result.json and read it before continuing. Use a fresh name for each command.",
    "Address cells using cellPath from notebook_meta.json (or its fileName). After creating a new cell, wait until its status is synced before moving it.",
    'Move: {"action":"move","cell":"cell_3","before":"cell_1"} or {"action":"move","cell":"cell_3","after":"cell_1"} or {"action":"move","cell":"cell_3","start":true}.',
    'Delete: {"action":"delete","cell":"cell_3"}. Cell type conversion is not supported.',
    'Run: {"action":"run","cell":"cell_3"} or {"action":"run","all":true}. Results report whether execution was queued, plus any immediately available output; queued does not mean execution has finished.',
    'Inspect output and runtime state after a run: {"action":"inspect","cell":"cell_3"}. Use a fresh file for each inspection. State idle alone does not prove a run occurred; inspect output and errors.',
    "To insert a new cell anywhere, create it in new_cells, wait for sync, then move it before or after the desired cell using the command interface.",
    "Commands fail safely if the cell has unsynced edits. Wait for sync and use a new command file to retry.",
    "Do not edit notebook_meta.json. It lists persistent cell IDs and sync status.",
    "",

    `Notebook: ${payload.notebook?.title || "Untitled"}`,
    `Cell files: ${files.size}`,
  ];
  await fsp.writeFile(path.join(metaDir, "AGENT_CONTEXT.md"), `${contextLines.join("\n")}\n`, "utf8");
  // Agent CLIs discover these automatically, including before the user's first task.
  await fsp.writeFile(path.join(base, "AGENTS.md"), `${contextLines.join("\n")}\n`, "utf8");
  await fsp.writeFile(path.join(base, "CLAUDE.md"), `${contextLines.join("\n")}\n`, "utf8");

  return {
    workspacePath: base,
    files,
  };
}

async function writeWorkspaceMetadata(session) {
  await writeJson(path.join(session.workspacePath, "notebook/.promptpack/notebook_meta.json"), {
    notebook: session.notebook,
    files: Array.from(session.files.values()).map(item => ({
      cellPath: item.cellPath,
      cellId: item.cellId,
      notebookCellPath: item.notebookCellPath,
      relativePath: item.relativePath,
      fileName: item.fileName,
      cellType: item.cellType,
      status: item.discarded ? "discarded" : item.creationPending ? "pending_append" : item.pendingProposalId ? "pending_edit" : "synced",
    })),
  });
}

async function discoverNewCells(session) {
  const dir = path.join(session.workspacePath, "notebook/new_cells");
  // Never follow symlinks to other files or directories on the user's computer.
  const dirStat = await fsp.lstat(dir).catch(() => null);
  if (!dirStat?.isDirectory() || dirStat.isSymbolicLink()) return;
  const entries = (await fsp.readdir(dir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && !entry.name.startsWith(".") && /\.(py|md)$/i.test(entry.name))
    .sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const observed = new Set();
  for (const entry of entries) {
    const fileName = `new_cells/${entry.name}`;
    if ([...session.files.values()].some(file => file.fileName === fileName)) continue;
    const filePath = path.join(dir, entry.name);
    const content = await fsp.readFile(filePath, "utf8").catch(() => null);
    if (content === null) continue;
    observed.add(fileName);
    const hash = hashContent(content);
    const previous = session.newFileCandidates.get(fileName);
    session.newFileCandidates.set(fileName, hash);
    // Wait for a complete save rather than importing an empty/partly written file.
    if (previous !== hash) continue;
    const cellPath = createId("new");
    session.files.set(cellPath, {
      cellPath,
      cellId: createId("pp"),
      relativePath: `New cell · ${entry.name}`,
      fileName,
      filePath,
      cellType: /\.md$/i.test(entry.name) ? "markdown" : "code",
      creationPending: true,
      baselineContent: "",
      baselineHash: hashContent(""),
      pendingProposalId: null,
    });
    session.newFileCandidates.delete(fileName);
  }
  for (const name of session.newFileCandidates.keys()) {
    if (!observed.has(name)) session.newFileCandidates.delete(name);
  }
}

function buildBootstrapPrompt(payload, files) {
  const lines = [];
  lines.push("[PromptPack] Session started");
  lines.push("Context file: ./notebook/.promptpack/AGENT_CONTEXT.md");
  lines.push("Ask the agent to read that file first.");
  lines.push("");
  lines.push(`Notebook: ${payload.notebook?.title || "Untitled"}`);
  lines.push(`Cell files: ${files.size}`);
  return `${lines.join("\n")}\n\n`;
}

function cleanupSession(session, reason = "closed") {
  if (session.closed) {
    return;
  }
  session.closed = true;

  if (session.pollTimer) {
    clearInterval(session.pollTimer);
    session.pollTimer = null;
  }

  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }

  if (session.process) {
    session.process.kill();
  }

  sessions.delete(session.id);

  if (session.owner) {
    send(session.owner, "session_closed", { sessionId: session.id, reason });
  }

  fsp.rm(session.workspacePath, { recursive: true, force: true }).catch(() => {
    // Ignore workspace cleanup errors.
  });
}

async function pollWorkspaceDiffs(session) {
  const updates = [];
  await discoverNewCells(session);
  if (session.closed) return;

  for (const item of session.files.values()) {
    if (item.pendingProposalId || item.discarded) continue;

    let current;
    try {
      current = await fsp.readFile(item.filePath, "utf8");
    } catch {
      continue;
    }

    const currentHash = hashContent(current);
    if (currentHash === item.baselineHash && !item.creationPending) continue;

    updates.push({
      cellPath: item.cellPath,
      ...(item.cellId ? { cellId: item.cellId } : {}),
      ...(item.creationPending ? { operation: "append", cellType: item.cellType } : {}),
      relativePath: item.relativePath,
      newContent: current,
      previousContent: item.baselineContent,
      baseHash: item.baselineHash,
      changeId: createId("chg"),
      __fileRef: item,
    });
  }

  if (updates.length === 0) return;

  const proposalId = createId("patch");

  updates.forEach((update) => {
    update.__fileRef.pendingProposalId = proposalId;
  });

  const outboundUpdates = updates.map(({ __fileRef, ...rest }) => rest);

  const proposal = {
    proposalId,
    sessionId: session.id,
    summary: updates.some(update => update.operation === "append")
      ? `Agent added ${updates.filter(update => update.operation === "append").length} cell(s)${updates.some(update => !update.operation) ? " and edited existing cells" : ""}`
      : `Agent edited ${updates.length} cell(s) in workspace`,
    updates: outboundUpdates,
    createdAt: Date.now(),
  };

  session.pendingPatches.set(proposalId, {
    proposal,
    rawUpdates: updates,
  });
  await writeWorkspaceMetadata(session);

  if (session.owner) {
    send(session.owner, "agent_patch_proposed", proposal);
  }
}

// Each command is an explicitly saved agent action with a durable result file.
async function pollAgentCommands(session) {
  if (!session.owner || session.closed) return;
  const dir = path.join(session.workspacePath, "notebook/.promptpack/commands");
  const entries = (await fsp.readdir(dir, { withFileTypes: true }))
    .filter(entry => entry.isFile() && /^[a-zA-Z0-9_-]+\.json$/.test(entry.name) && !entry.name.endsWith(".result.json"))
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const file = path.join(dir, entry.name);
    if (session.activeCommands.has(file) || await fsp.stat(file.replace(/\.json$/, ".result.json")).catch(() => null)) continue;
    const data = await fsp.readFile(file, "utf8").catch(() => null);
    if (data === null) continue;
    const hash = hashContent(data);
    if (session.commandCandidates.get(file) !== hash) { session.commandCandidates.set(file, hash); continue; }
    session.activeCommands.add(file);
    const finishError = error => writeJson(file.replace(/\.json$/, ".result.json"), { applied: false, status: "error", error: error.message });
    try {
      const command = JSON.parse(data);
      const find = name => [...session.files.values()].find(item => !item.discarded && (item.cellPath === name || item.cellId === name || item.fileName === name));
      const target = command.cell ? find(command.cell) : null;
      if (!target && !(["run", "inspect"].includes(command.action) && command.all === true)) throw new Error("Cell not found; see notebook_meta.json");
      if (target && (!target.cellId || target.creationPending || target.pendingProposalId || hashContent(await fsp.readFile(target.filePath, "utf8")) !== target.baselineHash)) throw new Error("Cell is not synced; wait for sync and retry with a new command file");
      if (command.action === "run" || command.action === "inspect") {
        if (command.action === "run" && command.all === true) {
          for (const item of session.files.values()) {
            if (item.discarded) continue;
            if (item.creationPending || item.pendingProposalId || hashContent(await fsp.readFile(item.filePath, "utf8")) !== item.baselineHash) throw new Error("Notebook has unsynced edits; wait for sync and retry with a new command file");
          }
        }
        const proposal = { proposalId: createId("run"), command: { ...(command.all === true ? { mode: "all" } : { mode: "cell", cellIds: [target.cellId] }), ...(command.action === "inspect" ? { inspectOnly: true } : {}) }, summary: `Agent requested notebook ${command.action}`, createdAt: Date.now(), commandFile: file };
        session.pendingRuns.set(proposal.proposalId, proposal);
        send(session.owner, "agent_run_proposed", proposal);
        continue;
      }
      if (!["move", "delete"].includes(command.action)) throw new Error("Unknown or unsupported action");
      const update = { cellPath: target.cellPath, cellId: target.cellId, operation: command.action, newContent: target.baselineContent, baseHash: target.baselineHash, changeId: createId("chg"), __fileRef: target };
      if (command.action === "move") {
        const destination = command.before || command.after;
        if (command.start !== true && !destination) throw new Error("Specify before, after, or start");
        if (destination) {
          const anchor = find(destination);
          if (!anchor?.cellId || anchor.creationPending || anchor === target) throw new Error("Move destination not found or not synced");
          if (command.before) update.beforeCellId = anchor.cellId;
          else update.afterCellId = anchor.cellId;
        } else update.afterCellId = null;
      }
      const proposalId = createId("patch");
      target.pendingProposalId = proposalId;
      const { __fileRef, ...wireUpdate } = update;
      const proposal = { proposalId, sessionId: session.id, summary: `Agent requested cell ${command.action}`, updates: [wireUpdate], createdAt: Date.now() };
      session.pendingPatches.set(proposalId, { proposal, rawUpdates: [update], commandFile: file });
      await writeWorkspaceMetadata(session);
      send(session.owner, "agent_patch_proposed", proposal);
    } catch (error) { await finishError(error); }
  }
}

async function startSession(ws, message) {
  const payload = message.payload || {};

  if (!payload.notebook || !Array.isArray(payload.cells)) {
    reply(ws, message, "error", { message: "Invalid session_start payload" });
    return;
  }

  const { workspacePath, files } = await initializeWorkspace(payload);

  let agent;
  try {
    agent = defaultAgentCommand(payload.agent || { kind: "codex" });
    agent = resolveAgentCommand(agent);
  } catch (error) {
    await fsp.rm(workspacePath, { recursive: true, force: true }).catch(() => {});
    reply(ws, message, "error", { message: error.message || "Invalid agent command" });
    return;
  }

  const session = {
    id: createId("session"),
    owner: ws,
    workspacePath,
    files,
    notebook: payload.notebook,
    newFileCandidates: new Map(),
    commandCandidates: new Map(),
    activeCommands: new Set(),
    pendingPatches: new Map(),
    pendingRuns: new Map(),
    startedAt: Date.now(),
    agentKind: payload.agent?.kind || "codex",
    agent,
    agentCommandLine: formatCommandLine(agent),
    process: null,
    processStartedAt: Date.now(),
    pollTimer: null,
    idleTimer: null,
    lineBuffer: "",
    probeBuffer: "",
    rawOutputSample: "",
    visibleOutputChars: 0,
    terminalOutput: "",
    retryWithoutAltAttempted: false,
    closed: false,
  };

  let child;
  try {
    child = spawnAgentProcess(agent, workspacePath);
  } catch (error) {
    await fsp.rm(workspacePath, { recursive: true, force: true }).catch(() => {});
    reply(ws, message, "error", { message: error?.message || "Failed to start agent process" });
    return;
  }

  session.process = child;
  session.processStartedAt = Date.now();
  sessions.set(session.id, session);

  emitTerminal(session, `[PromptPack] Launching agent: ${session.agentCommandLine}\n`);
  bindProcessHandlers(session, child);

  session.pollTimer = setInterval(() => {
    if (session.polling || session.closed) return;
    session.polling = true;
    pollWorkspaceDiffs(session).then(() => pollAgentCommands(session)).catch((error) => {
      emitTerminal(session, `\n[PromptPack] Workspace sync error: ${error.message}\n`);
    }).finally(() => { session.polling = false; });
  }, DIFF_POLL_INTERVAL_MS);

  emitTerminal(session, buildBootstrapPrompt(payload, files));

  reply(ws, message, "session_started", sessionState(session));
  send(ws, "session_state", sessionState(session));
}

function attachSession(ws, message) {
  const sessionId = message.payload?.sessionId;
  const session = sessions.get(sessionId);

  if (!session) {
    reply(ws, message, "error", { message: "Session not found" });
    return;
  }

  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }

  session.owner = ws;
  reply(ws, message, "session_resumed", sessionState(session));
  send(ws, "session_state", sessionState(session));
  send(ws, "terminal_snapshot", { sessionId: session.id, data: session.terminalOutput || "" });
  for (const { proposal } of session.pendingPatches.values()) {
    send(ws, "agent_patch_proposed", proposal);
  }
  for (const proposal of session.pendingRuns.values()) {
    send(ws, "agent_run_proposed", proposal);
  }
}

function detachSessionsForSocket(ws) {
  for (const session of sessions.values()) {
    if (session.owner !== ws) continue;

    session.owner = null;
    if (session.idleTimer) {
      clearTimeout(session.idleTimer);
    }

    session.idleTimer = setTimeout(() => {
      cleanupSession(session, "idle_timeout");
    }, IDLE_TIMEOUT_MS);
  }
}

async function handlePatchApplyResult(message) {
  const session = sessions.get(message.payload?.sessionId);
  if (!session) return;

  const proposalId = message.payload?.proposalId;
  const pending = session.pendingPatches.get(proposalId);
  if (!pending) return;

  const result = message.payload?.result;
  const unresolved = [];
  if (pending.commandFile) {
    const update = pending.rawUpdates[0];
    const entry = result?.results?.find(item => item.cellPath === update.cellPath);
    update.__fileRef.pendingProposalId = null;
    if (entry?.applied && update.operation === "delete") update.__fileRef.discarded = true;
    session.pendingPatches.delete(proposalId);
    await writeWorkspaceMetadata(session);
    await writeJson(pending.commandFile.replace(/\.json$/, ".result.json"), entry || { applied: false, reason: "No result from Colab" });
    return;
  }
  for (const update of pending.rawUpdates) {
    const fileRef = update.__fileRef;
    const entry = result?.results?.find(item => item.cellPath === update.cellPath);
    if (entry?.applied) {
      if (update.operation === "append" && entry.cellId !== fileRef.cellId) {
        unresolved.push(update);
        continue;
      }
      fileRef.creationPending = false;
      if (entry.notebookCellPath) fileRef.notebookCellPath = entry.notebookCellPath;
      fileRef.baselineContent = update.newContent;
      fileRef.baselineHash = hashContent(update.newContent);
      fileRef.pendingProposalId = null;
    } else if (entry?.reason === "Rejected by user") {
      if (update.operation === "append") {
        // Stop importing this file; retain the agent's work for manual recovery.
        fileRef.creationPending = false;
        fileRef.discarded = true;
        fileRef.pendingProposalId = null;
        continue;
      }
      // Discard only the proposed version, never a newer edit from the agent.
      const current = await fsp.readFile(fileRef.filePath, "utf8");
      if (hashContent(current) === hashContent(update.newContent)) {
        await fsp.writeFile(fileRef.filePath, fileRef.baselineContent, "utf8");
      }
      fileRef.pendingProposalId = null;
    } else {
      // A sync failure is not a rejection. Preserve it for retry/reconnection.
      unresolved.push(update);
    }
  }
  if (unresolved.length) {
    pending.rawUpdates = unresolved;
    pending.proposal.updates = unresolved.map(({ __fileRef, ...update }) => update);
  } else {
    session.pendingPatches.delete(proposalId);
  }
  await writeWorkspaceMetadata(session);
}

async function handleRunResult(message) {
  const session = sessions.get(message.payload?.sessionId);
  if (!session) return;

  const proposalId = message.payload?.proposalId;
  if (!session.pendingRuns.has(proposalId)) return;

  const pendingRun = session.pendingRuns.get(proposalId);
  session.pendingRuns.delete(proposalId);
  const result = message.payload?.result || {};
  if (pendingRun.commandFile) await writeJson(pendingRun.commandFile.replace(/\.json$/, ".result.json"), result);
  const status = result.status || "unknown";
  const executed = Number.isFinite(Number(result.executed)) ? Number(result.executed) : null;
  const errors = Array.isArray(result.errors) ? result.errors.filter((item) => typeof item === "string" && item.trim()) : [];

  let line = `\n[PromptPack] Notebook execution result: ${status}`;
  if (executed !== null) {
    line += ` (executed=${executed})`;
  }
  if (errors.length > 0) {
    line += `\n[PromptPack] Execution errors: ${errors.join(" | ")}`;
  }
  emitTerminal(session, `${line}\n`);
}

async function handleWorkspaceDelta(ws, message) {
  const session = sessions.get(message.payload?.sessionId);
  if (!session) {
    throw new Error("Session not found");
  }

  const cells = Array.isArray(message.payload?.cells) ? message.payload.cells : [];
  const staged = [];

  // Check every incoming file before writing any of them. The agent may have
  // saved an edit that the proposal poller has not discovered yet.
  for (const cell of cells) {
    const file = cell.cellId
      ? [...session.files.values()].find(item => item.cellId === cell.cellId)
      : session.files.get(cell.path);
    if (!file) continue;

    const current = await fsp.readFile(file.filePath, "utf8");
    if (file.pendingProposalId || hashContent(current) !== file.baselineHash) {
      throw new Error(
        `${file.relativePath || cell.path} has unapplied agent edits. Wait for sync to finish or resolve the conflict under Notebook changes before updating the agent from Colab.`
      );
    }

    const content = typeof cell.content === "string" ? cell.content : "";
    staged.push({ file, content, notebookCellPath: cell.path });
  }

  for (const { file, content, notebookCellPath } of staged) {
    await fsp.writeFile(file.filePath, content, "utf8");
    file.baselineContent = content;
    file.baselineHash = hashContent(content);
    file.notebookCellPath = notebookCellPath;
  }
  await writeWorkspaceMetadata(session);

  if (message.requestId) {
    reply(ws, message, "workspace_synced", { success: true });
  }
}

function handleTerminalInput(message) {
  const session = sessions.get(message.payload?.sessionId);
  if (!session || !session.process) return;

  const input = String(message.payload?.input || "");
  session.process.write(input);
}

function handleTerminalResize(message) {
  const session = sessions.get(message.payload?.sessionId);
  if (!session || !session.process) return;

  const cols = Number(message.payload?.cols);
  const rows = Number(message.payload?.rows);
  if (Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0) {
    session.process.resize(Math.floor(cols), Math.floor(rows));
  }
}

async function handleSessionStop(ws, message) {
  const sessionId = message.payload?.sessionId;
  const session = sessions.get(sessionId);

  if (!session) {
    reply(ws, message, "session_stopped", { success: true });
    return;
  }

  cleanupSession(session, "stopped_by_user");
  reply(ws, message, "session_stopped", { success: true });
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(getBridgeStatus()));
    return;
  }

  res.writeHead(404, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false }));
});

const wss = new WebSocketServer({ noServer: true });

export function getBridgeStatus() {
  return {
    service: "promptpack-bridge",
    port: server.address()?.port || PORT,
    version: VERSION,
    ok: true,
    sessions: sessions.size,
    requiresToken: !!REQUIRED_TOKEN,
    terminalBackend,
    agents: { codex: !!resolveExecutable("codex"), claude: !!resolveExecutable("claude") },
  };
}

export async function shutdownBridge() {
  for (const session of sessions.values()) cleanupSession(session, "bridge_quit");
  for (const client of wss.clients) client.terminate();
  await new Promise(resolve => server.close(resolve));
}

wss.on("connection", (ws, req) => {
  ws.isAuthed = !REQUIRED_TOKEN;

  send(ws, "hello", {
    version: VERSION,
    requiresAuth: !!REQUIRED_TOKEN,
    resumeSupported: true,
  });

  ws.on("message", async (data) => {
    let message;

    try {
      message = JSON.parse(data.toString());
    } catch {
      send(ws, "error", { message: "Invalid JSON" });
      return;
    }

    if (REQUIRED_TOKEN && !ws.isAuthed && message.type !== "auth_response") {
      if (message.requestId) {
        reply(ws, message, "error", { message: "Bridge authentication required" });
      } else {
        send(ws, "error", { message: "Bridge authentication required" });
      }
      return;
    }

    if (message.type === "auth_response") {
      if (!REQUIRED_TOKEN || message.payload?.token === REQUIRED_TOKEN) {
        ws.isAuthed = true;
        if (message.requestId) {
          reply(ws, message, "auth_ok", { success: true });
        } else {
          send(ws, "auth_ok", { success: true });
        }
      } else {
        if (message.requestId) {
          reply(ws, message, "error", { message: "Invalid bridge token" });
        } else {
          send(ws, "error", { message: "Invalid bridge token" });
        }
      }
      return;
    }

    try {
      switch (message.type) {
        case "session_start":
          await startSession(ws, message);
          break;
        case "session_resume":
          attachSession(ws, message);
          break;
        case "session_stop":
          await handleSessionStop(ws, message);
          break;
        case "terminal_input":
          handleTerminalInput(message);
          break;
        case "terminal_resize":
          handleTerminalResize(message);
          break;
        case "workspace_delta":
          await handleWorkspaceDelta(ws, message);
          break;
        case "agent_patch_apply_result":
          await handlePatchApplyResult(message);
          break;
        case "agent_run_result":
          await handleRunResult(message);
          break;
        case "health":
          if (message.requestId) {
            reply(ws, message, "health_ok", { ok: true, sessions: sessions.size });
          }
          break;
        default:
          if (message.requestId) {
            reply(ws, message, "error", { message: `Unsupported message type: ${message.type}` });
          }
          break;
      }
    } catch (error) {
      const text = error?.message || "Bridge command failed";
      if (message.requestId) {
        reply(ws, message, "error", { message: text });
      } else {
        send(ws, "error", { message: text });
      }
    }
  });

  ws.on("close", () => {
    detachSessionsForSocket(ws);
  });
});

server.on("upgrade", (req, socket, head) => {
  const remoteAddress = req.socket.remoteAddress || "";
  if (remoteAddress !== "127.0.0.1" && remoteAddress !== "::1" && remoteAddress !== "::ffff:127.0.0.1") {
    socket.destroy();
    return;
  }

  // A browser page must not be able to launch a local CLI through this service.
  // Local non-browser clients have no Origin header; Chrome extension pages do.
  if (req.headers.origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(req.headers.origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

export const bridgeReady = new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`PromptPack Bridge listening on ws://${HOST}:${server.address().port}`);
  // eslint-disable-next-line no-console
  console.log(`Health endpoint: http://${HOST}:${server.address().port}/health`);
  if (REQUIRED_TOKEN) {
    // eslint-disable-next-line no-console
    console.log("Bridge auth token is required (PROMPTPACK_BRIDGE_TOKEN set)");
  }
  resolve(getBridgeStatus());
  });
});

if (!process.versions.electron) {
  bridgeReady.catch(error => { console.error("PromptPack Bridge could not start:", error.message); process.exitCode = 1; });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => { shutdownBridge().finally(() => process.exit(0)); });
  }
}
