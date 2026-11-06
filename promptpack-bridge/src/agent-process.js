import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PTY_WRAPPER = fileURLToPath(new URL("./pty_agent.py", import.meta.url));
let nativePty;
try {
  const module = await import("node-pty");
  nativePty = module.default || module;
} catch (error) {
  if (process.env.PROMPTPACK_BRIDGE_DESKTOP === "1" || process.platform === "win32") {
    throw new Error(`The bundled terminal could not load. Reinstall PromptPack Bridge. ${error.message}`);
  }
}

export const terminalBackend = nativePty ? "native" : "python";

export function spawnAgentProcess(agent, workspacePath) {
  if (!nativePty) return spawnPythonProcess(agent, workspacePath);
  const batch = process.platform === "win32" && /\.(cmd|bat)$/i.test(agent.cmd);
  const command = batch ? process.env.ComSpec || "cmd.exe" : agent.cmd;
  const args = batch
    ? `/d /s /c ""${agent.cmd}" ${agent.args.map(arg => `"${arg.replaceAll('"', '\\"')}"`).join(" ")}"`
    : agent.args;
  const child = nativePty.spawn(command, args, {
    name: "xterm-256color",
    cols: 120,
    rows: 40,
    cwd: workspacePath,
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
  });
  return {
    write(data) { child.write(data); },
    resize(cols, rows) { child.resize(cols, rows); },
    kill() { try { child.kill(); } catch { /* Already exited. */ } },
    onData(handler) { child.onData(handler); },
    onExit(handler) { child.onExit(({ exitCode }) => handler(exitCode)); },
  };
}

function spawnPythonProcess(agent, workspacePath) {
  const child = spawn("python3", [PTY_WRAPPER, agent.cmd, ...agent.args], {
    cwd: workspacePath,
    env: {
      ...process.env,
      TERM: process.env.TERM || "xterm-256color",
      COLORTERM: process.env.COLORTERM || "truecolor",
      CLICOLOR_FORCE: process.env.CLICOLOR_FORCE || "1",
      COLUMNS: process.env.COLUMNS || "120",
      LINES: process.env.LINES || "40",
      PROMPTPACK_TERM_COLS: process.env.PROMPTPACK_TERM_COLS || process.env.COLUMNS || "120",
      PROMPTPACK_TERM_ROWS: process.env.PROMPTPACK_TERM_ROWS || process.env.LINES || "40",
    },
    stdio: ["pipe", "pipe", "pipe", "pipe"],
  });

  let onDataHandler = null;

  child.stdout.on("data", (chunk) => {
    if (onDataHandler) onDataHandler(chunk.toString());
  });

  child.stderr.on("data", (chunk) => {
    if (onDataHandler) onDataHandler(chunk.toString());
  });

  return {
    write(data) {
      child.stdin.write(data);
    },
    resize(cols, rows) {
      const control = child.stdio[3];
      if (!control || typeof control.write !== "function") return;
      if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) return;
      try {
        control.write(`RESIZE ${Math.trunc(cols)} ${Math.trunc(rows)}\n`);
      } catch {
        // Ignore best-effort resize failures.
      }
    },
    kill() {
      try {
        child.kill();
      } catch {
        // Ignore cleanup errors.
      }
    },
    onData(handler) {
      onDataHandler = handler;
    },
    onExit(handler) {
      child.on("close", (code) => {
        handler(code ?? null);
      });
    },
  };
}
