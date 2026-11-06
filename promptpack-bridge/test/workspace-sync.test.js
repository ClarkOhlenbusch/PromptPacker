import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import { WebSocket } from "ws";

let server;
let ws;
let nextRequestId = 0;
let bridgeUrl;
const replies = new Map();
const proposals = [];
const runs = [];
const snapshots = [];
const sessions = new Set();

function request(type, payload, timeout = 5000) {
  const requestId = `test_${++nextRequestId}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      replies.delete(requestId);
      reject(new Error(`Timed out waiting for ${type}`));
    }, timeout);
    replies.set(requestId, message => {
      clearTimeout(timer);
      resolve(message);
    });
    ws.send(JSON.stringify({ type, payload, requestId }));
  });
}

before(async () => {
  const reservation = net.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  server = spawn(process.execPath, [fileURLToPath(new URL("../src/server.js", import.meta.url))], {
    env: { ...process.env, PROMPTPACK_BRIDGE_PORT: String(port), PROMPTPACK_BRIDGE_TOKEN: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Bridge did not start")), 5000);
    server.once("error", reject);
    server.stdout.on("data", chunk => {
      if (chunk.toString().includes("PromptPack Bridge listening")) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  bridgeUrl = `ws://127.0.0.1:${port}`;
  await connect();
});

async function connect() {
  ws = new WebSocket(bridgeUrl);
  ws.on("message", data => {
    const message = JSON.parse(data.toString());
    if (message.replyTo) {
      const handle = replies.get(message.replyTo);
      replies.delete(message.replyTo);
      handle?.(message);
    }
    if (message.type === "agent_patch_proposed") proposals.push(message.payload);
    if (message.type === "agent_run_proposed") runs.push(message.payload);
    if (message.type === "terminal_snapshot") snapshots.push(message.payload);
  });
  await once(ws, "open");
}

after(async () => {
  for (const sessionId of sessions) await request("session_stop", { sessionId });
  ws?.close();
  if (server && server.exitCode === null) {
    const closed = once(server, "close");
    server.kill();
    await closed;
  }
});

async function startNotebook(withIds = false) {
  const reply = await request("session_start", {
    notebook: { title: "Sync test" },
    cells: [
      { path: "cell_0", ...(withIds ? { cellId: "first-id" } : {}), relativePath: "Cell 1", cellType: "markdown", content: "Original first cell" },
      { path: "cell_1", ...(withIds ? { cellId: "second-id" } : {}), relativePath: "Cell 2", cellType: "code", content: "print('original')" },
    ],
    agent: { kind: "custom", command: `"${process.execPath}" "${fileURLToPath(new URL("./echo-agent.cjs", import.meta.url))}"` },
  });
  assert.equal(reply.type, "session_started", reply.payload?.message);
  sessions.add(reply.payload.sessionId);
  return reply.payload;
}

test("refuses a notebook refresh before it can overwrite an unpolled agent edit", async () => {
  const session = await startNotebook();
  const firstFile = `${session.workspacePath}/notebook/Cell_1_cell_0.md`;
  const secondFile = `${session.workspacePath}/notebook/Cell_2_cell_1.py`;
  const edited = "<!-- This is a test. -->\n\nOriginal first cell";
  await fs.writeFile(firstFile, edited);
  const reply = await request("workspace_delta", {
    sessionId: session.sessionId,
    // Put an unchanged file first to verify validation happens before any writes.
    cells: [
      { path: "cell_1", content: "print('new notebook value')" },
      { path: "cell_0", content: "Original first cell" },
    ],
  }).catch(error => ({ type: "timeout", payload: { message: error.message } }));
  assert.equal(await fs.readFile(firstFile, "utf8"), edited, "Notebook refresh discarded the agent's Markdown edit");
  assert.equal(await fs.readFile(secondFile, "utf8"), "print('original')", "A rejected refresh partially changed the workspace");
  assert.equal(reply.type, "error");
  assert.match(reply.payload.message, /unapplied agent edits/i);

  const deadline = Date.now() + 5000;
  while (!proposals.some(proposal => proposal.updates.some(update => update.newContent === edited))) {
    assert.ok(Date.now() < deadline, "The preserved edit was not proposed for Apply");
    await delay(50);
  }
  const retried = await request("workspace_delta", {
    sessionId: session.sessionId,
    cells: [{ path: "cell_0", content: "Original first cell" }],
  });
  assert.equal(retried.type, "error");
  assert.equal(await fs.readFile(firstFile, "utf8"), edited);
});

test("acknowledges a clean notebook refresh", async () => {
  const session = await startNotebook();
  const reply = await request("workspace_delta", {
    sessionId: session.sessionId,
    cells: [{ path: "cell_0", content: "Updated from Colab" }],
  });
  assert.equal(reply.type, "workspace_synced");
  assert.equal(reply.payload.success, true);
  assert.equal(await fs.readFile(`${session.workspacePath}/notebook/Cell_1_cell_0.md`, "utf8"), "Updated from Colab");
});

test("rejects browser website origins before they can start a local process", async () => {
  const website = new WebSocket(bridgeUrl, { origin: "https://example.com" });
  const response = await new Promise((resolve, reject) => {
    website.once("unexpected-response", (_request, response) => { resolve(response.statusCode); response.resume(); website.terminate(); });
    website.once("error", reject);
  });
  assert.equal(response, 403);
});

async function waitForProposal(sessionId, matches = () => true) {
  const deadline = Date.now() + 8000;
  while (!proposals.some(proposal => proposal.sessionId === sessionId && matches(proposal))) {
    assert.ok(Date.now() < deadline, "No agent edit was proposed");
    await delay(50);
  }
  return proposals.find(proposal => proposal.sessionId === sessionId && matches(proposal));
}

test("discovers new code/Markdown files, acknowledges creation, and tracks later edits by cell ID", async () => {
  const session = await startNotebook();
  const folder = `${session.workspacePath}/notebook/new_cells`;
  assert.match(await fs.readFile(`${session.workspacePath}/AGENTS.md`, "utf8"), /APPEND new cells/);
  assert.match(await fs.readFile(`${session.workspacePath}/CLAUDE.md`, "utf8"), /Do NOT create a separate .ipynb/);
  await fs.writeFile(`${folder}/02_explanation.md`, "# New explanation");
  await fs.writeFile(`${folder}/01_plot.py`, "print('new plot')");
  await fs.writeFile(`${folder}/ignored.ipynb`, '{"cells":[]}');
  await fs.symlink(`${folder}/01_plot.py`, `${folder}/ignored.py`).catch(error => {
    if (process.platform !== "win32" || error.code !== "EPERM") throw error;
  });
  const proposal = await waitForProposal(session.sessionId);
  assert.deepEqual(proposal.updates.map(update => update.cellType), ["code", "markdown"]);
  assert.ok(proposal.updates.every(update => update.operation === "append" && update.cellId.startsWith("pp_")));
  ws.send(JSON.stringify({ type: "agent_patch_apply_result", payload: {
    sessionId: session.sessionId, proposalId: proposal.proposalId,
    result: { success: true, results: proposal.updates.map((update, index) => ({
      cellPath: update.cellPath, cellId: update.cellId, notebookCellPath: `cell_${index + 2}`, applied: true,
    })) },
  } }));
  const metaPath = `${session.workspacePath}/notebook/.promptpack/notebook_meta.json`;
  const deadline = Date.now() + 5000;
  while (JSON.parse(await fs.readFile(metaPath, "utf8")).files.some(file => file.status === "pending_append")) {
    assert.ok(Date.now() < deadline, "Creation acknowledgement was not recorded");
    await delay(30);
  }
  await fs.writeFile(`${folder}/01_plot.py`, "print('updated plot')");
  const edit = await waitForProposal(session.sessionId, item => item.proposalId !== proposal.proposalId);
  assert.equal(edit.updates.length, 1);
  assert.equal(edit.updates[0].operation, undefined);
  assert.equal(edit.updates[0].cellId, proposal.updates[0].cellId);
  assert.equal(edit.updates[0].previousContent, "print('new plot')");
  assert.equal(edit.updates[0].newContent, "print('updated plot')");
  // A Colab refresh after reordering must identify this file by ID, not index.
  ws.send(JSON.stringify({ type: "agent_patch_apply_result", payload: {
    sessionId: session.sessionId, proposalId: edit.proposalId,
    result: { success: true, results: [{ cellPath: edit.updates[0].cellPath, cellId: edit.updates[0].cellId, applied: true }] },
  } }));
  await delay(100);
  const refreshed = await request("workspace_delta", { sessionId: session.sessionId,
    cells: [{ path: "cell_0", cellId: edit.updates[0].cellId, content: "print('edited in Colab')" }],
  });
  assert.equal(refreshed.type, "workspace_synced");
  assert.equal(await fs.readFile(`${folder}/01_plot.py`, "utf8"), "print('edited in Colab')");
  assert.equal(await fs.readFile(`${session.workspacePath}/notebook/Cell_1_cell_0.md`, "utf8"), "Original first cell");
});

test("keeps failed creations pending and does not silently treat them as edits", async () => {
  const session = await startNotebook();
  const file = `${session.workspacePath}/notebook/new_cells/new.py`;
  await fs.writeFile(file, "print('keep me')");
  const proposal = await waitForProposal(session.sessionId);
  ws.send(JSON.stringify({ type: "agent_patch_apply_result", payload: {
    sessionId: session.sessionId, proposalId: proposal.proposalId,
    result: { success: false, results: [{ cellPath: proposal.updates[0].cellPath, applied: false, reason: "read-only notebook" }] },
  } }));
  await delay(100);
  assert.equal(await fs.readFile(file, "utf8"), "print('keep me')");
  const meta = JSON.parse(await fs.readFile(`${session.workspacePath}/notebook/.promptpack/notebook_meta.json`, "utf8"));
  assert.equal(meta.files.find(item => item.fileName === "new_cells/new.py").status, "pending_append");
  // Reconnect restores the same creation ID instead of generating a new one.
  const count = proposals.length;
  await request("session_resume", { sessionId: session.sessionId });
  const deadline = Date.now() + 5000;
  while (proposals.length === count) { assert.ok(Date.now() < deadline); await delay(20); }
  assert.deepEqual(proposals.at(-1).updates, proposal.updates);
  ws.send(JSON.stringify({ type: "agent_patch_apply_result", payload: {
    sessionId: session.sessionId, proposalId: proposal.proposalId,
    result: { success: false, results: [{ cellPath: proposal.updates[0].cellPath, applied: false, reason: "Rejected by user" }] },
  } }));
  await delay(100);
  const afterDiscard = proposals.length;
  await fs.writeFile(file, "print('still kept on disk')");
  await delay(2000);
  assert.equal(proposals.length, afterDiscard, "Discarded creation was automatically imported again");
  assert.equal(await fs.readFile(file, "utf8"), "print('still kept on disk')");
});

test("records per-cell success and preserves conflicting agent files for retry", async () => {
  const session = await startNotebook();
  const firstFile = `${session.workspacePath}/notebook/Cell_1_cell_0.md`;
  const secondFile = `${session.workspacePath}/notebook/Cell_2_cell_1.py`;
  await fs.writeFile(firstFile, "Agent Markdown edit");
  await fs.writeFile(secondFile, "print('agent edit')");
  const proposal = await waitForProposal(session.sessionId);
  assert.equal(proposal.updates.find(update => update.cellPath === "cell_0").previousContent, "Original first cell");
  ws.send(JSON.stringify({ type: "agent_patch_apply_result", payload: {
    sessionId: session.sessionId, proposalId: proposal.proposalId,
    result: { success: false, results: [
      { cellPath: "cell_0", applied: true },
      { cellPath: "cell_1", applied: false, reason: "base_hash_mismatch" },
    ] },
  } }));
  const updated = await request("workspace_delta", {
    sessionId: session.sessionId, cells: [{ path: "cell_0", content: "Fresh notebook edit" }],
  });
  assert.equal(updated.type, "workspace_synced", "The successfully synced cell did not advance its baseline");
  assert.equal(await fs.readFile(secondFile, "utf8"), "print('agent edit')", "Sync failure discarded the agent's edit");
  const blocked = await request("workspace_delta", {
    sessionId: session.sessionId, cells: [{ path: "cell_1", content: "print('original')" }],
  });
  assert.equal(blocked.type, "error");
});

test("resumes a disconnected session with terminal output and unsynced edits", async () => {
  const session = await startNotebook();
  ws.send(JSON.stringify({ type: "terminal_input", payload: { sessionId: session.sessionId, input: "terminal-history-marker\n" } }));
  // Let the PTY produce output, then disconnect its owner without stopping it.
  await delay(100);
  const closed = once(ws, "close");
  ws.close();
  await closed;
  await fs.writeFile(`${session.workspacePath}/notebook/Cell_1_cell_0.md`, "Edited while disconnected");
  await delay(2000);
  await connect();
  const resumed = await request("session_resume", { sessionId: session.sessionId });
  assert.equal(resumed.type, "session_resumed");
  const proposal = await waitForProposal(session.sessionId);
  assert.equal(proposal.updates[0].newContent, "Edited while disconnected");
  const deadline = Date.now() + 5000;
  while (!snapshots.some(snapshot => snapshot.sessionId === session.sessionId)) {
    assert.ok(Date.now() < deadline, "Terminal snapshot was not restored");
    await delay(25);
  }
  assert.match(snapshots.find(snapshot => snapshot.sessionId === session.sessionId).data, /terminal-history-marker/);
});


test("commands report successful moves, conflicts, invalid requests, and execution results", async () => {
  const session = await startNotebook(true);
  const dir = `${session.workspacePath}/notebook/.promptpack/commands`;
  async function submit(name, command) {
    await fs.writeFile(`${dir}/${name}.json`, JSON.stringify(command));
  }
  async function readResult(name) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const result = await fs.readFile(`${dir}/${name}.result.json`, "utf8").catch(() => null);
      if (result) return JSON.parse(result);
      await delay(50);
    }
    throw new Error(`Command ${name} timed out`);
  }
  await Promise.all([
    submit("bad", { action: "move", cell: "cell_1", before: "missing" }),
    submit("unknown", { action: "convert", cell: "cell_0" }),
    submit("move", { action: "move", cell: "cell_1", before: "cell_0" }),
  ]);
  const move = await waitForProposal(session.sessionId, item => item.updates.some(update => update.operation === "move"));
  assert.equal(move.updates[0].cellId, "second-id");
  assert.equal(move.updates[0].beforeCellId, "first-id");
  ws.send(JSON.stringify({ type: "agent_patch_apply_result", payload: { sessionId: session.sessionId, proposalId: move.proposalId,
    result: { results: [{ cellPath: "cell_1", cellId: "second-id", applied: true }] } } }));
  assert.equal((await readResult("move")).applied, true);
  assert.match((await readResult("bad")).error, /destination/i);
  assert.match((await readResult("unknown")).error, /unsupported/i);
  await submit("delete", { action: "delete", cell: "cell_0" });
  const deletion = await waitForProposal(session.sessionId, item => item.updates.some(update => update.operation === "delete"));
  ws.send(JSON.stringify({ type: "agent_patch_apply_result", payload: { sessionId: session.sessionId, proposalId: deletion.proposalId,
    result: { results: [{ cellPath: "cell_0", applied: false, reason: "base_hash_mismatch" }] } } }));
  assert.equal((await readResult("delete")).reason, "base_hash_mismatch");
  assert.equal(await fs.readFile(`${session.workspacePath}/notebook/Cell_1_cell_0.md`, "utf8"), "Original first cell");
  await submit("inspect", { action: "inspect", cell: "cell_1" });
  const deadline = Date.now() + 10000;
  while (!runs.some(run => run.command?.inspectOnly)) { assert.ok(Date.now() < deadline); await delay(50); }
  const inspect = runs.find(run => run.command?.inspectOnly);
  assert.deepEqual(inspect.command.cellIds, ["second-id"]);
  ws.send(JSON.stringify({ type: "agent_run_result", payload: { sessionId: session.sessionId, proposalId: inspect.proposalId,
    result: { status: "ok", executed: 0, errors: [], outputs: [{ cellPath: "cell_1", output: "42", state: "idle" }] } } }));
  assert.equal((await readResult("inspect")).outputs[0].output, "42");
});
