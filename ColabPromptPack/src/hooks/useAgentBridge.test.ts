import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ColabFileSystem } from "../services/ColabFileSystem";
import type { FileEntry } from "../services/FileSystem";
import type { ApplyCellUpdatesResult, BridgeMessage } from "../types/agent";
import { useAgentBridge } from "./useAgentBridge";

const bridge = vi.hoisted(() => ({
  handler: null as ((message: BridgeMessage<any>) => void) | null,
  submitWorkspaceDelta: vi.fn(),
  applyCellUpdates: vi.fn(),
  sendPatchApplyResult: vi.fn(),
  isConnected: vi.fn(),
  connect: vi.fn(),
  request: vi.fn(),
  startSession: vi.fn(),
}));

vi.mock("../services/AgentBridgeClient", () => ({
  AgentBridgeClient: class {
    onMessage(handler: (message: BridgeMessage<any>) => void) {
      bridge.handler = handler;
      return () => { bridge.handler = null; };
    }
    submitWorkspaceDelta = bridge.submitWorkspaceDelta;
    sendPatchApplyResult = bridge.sendPatchApplyResult;
    isConnected = bridge.isConnected;
    connect = bridge.connect;
    request = bridge.request;
    startSession = bridge.startSession;
  },
}));

const cachedFiles: FileEntry[] = [{
  path: "cell_0", relative_path: "Cell 1", is_dir: false, size: 3, content: "old", cellType: "markdown",
}];

function setup(freshFiles: FileEntry[] = [{ ...cachedFiles[0], content: "edited in Colab" }], withSession = true) {
  const scanProject = vi.fn(async () => freshFiles);
  const fs = { scanProject, applyCellUpdates: bridge.applyCellUpdates } as unknown as ColabFileSystem;
  const hook = renderHook(() => useAgentBridge(fs, cachedFiles));
  if (withSession) act(() => {
    bridge.handler!({
      type: "session_state",
      payload: { sessionId: "session", workspacePath: "/tmp/notebook", startedAt: 1, agentKind: "codex" },
    });
  });
  return { ...hook, scanProject };
}

beforeEach(() => {
  bridge.isConnected.mockReset().mockReturnValue(true);
  bridge.connect.mockReset().mockResolvedValue(undefined);
  bridge.request.mockReset();
  bridge.startSession.mockReset();
  bridge.submitWorkspaceDelta.mockReset().mockResolvedValue({ success: true });
  bridge.applyCellUpdates.mockReset().mockImplementation(async ({ updates }) => ({
    success: true,
    results: updates.map((update: { cellPath: string }) => ({ cellPath: update.cellPath, applied: true })),
  }));
  bridge.sendPatchApplyResult.mockReset();
  window.sessionStorage.clear();
});

afterEach(cleanup);

it("uses the single Start action to resume an existing session without launching a second agent", async () => {
  const { result } = setup(cachedFiles, false);
  const resumed = { sessionId: "existing", workspacePath: "/tmp/notebook", startedAt: 1, agentKind: "codex" };
  window.sessionStorage.setItem("promptpack.bridge.sessionId", resumed.sessionId);
  bridge.isConnected.mockReturnValue(false);
  bridge.request.mockResolvedValue(resumed);
  await act(async () => { await result.current.startSession("codex"); });
  expect(bridge.connect).toHaveBeenCalledOnce();
  expect(bridge.request).toHaveBeenCalledWith("session_resume", { sessionId: "existing" }, 10000);
  expect(result.current.session).toEqual(resumed);
  expect(bridge.startSession).not.toHaveBeenCalled();
});

describe("Colab to agent refresh", () => {
  it("replaces obsolete bridge instructions with an actionable update message", async () => {
    const { result } = setup();
    const oldMessage = "Cell 1 has unapplied agent edits. Use Apply or Reject under Proposed Cell Edits before updating the agent from Colab.";
    bridge.submitWorkspaceDelta.mockRejectedValueOnce(new Error(oldMessage));
    await act(async () => {
      await expect(result.current.syncWorkspace()).rejects.toThrow(oldMessage);
    });
    expect(result.current.bridgeError).toContain("bridge is running older code");
    expect(result.current.bridgeError).toContain("Restart the bridge");
    expect(result.current.bridgeError).not.toContain("Proposed Cell Edits");
  });

  it("reads current notebook content instead of resending the initial snapshot", async () => {
    const { result, scanProject } = setup();
    await act(async () => { await result.current.syncWorkspace(); });
    expect(scanProject).toHaveBeenCalledOnce();
    expect(bridge.submitWorkspaceDelta).toHaveBeenCalledWith("session", [{ path: "cell_0", content: "edited in Colab" }]);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 40)); });
    expect(result.current.terminalOutput).toContain("Updated agent workspace from Colab");
  });

  it("includes persistent cell IDs when refreshing a reordered notebook", async () => {
    const { result } = setup([{ ...cachedFiles[0], cellId: "pp_created", content: "moved new cell" }]);
    await act(async () => { await result.current.syncWorkspace(); });
    expect(bridge.submitWorkspaceDelta).toHaveBeenCalledWith("session", [{ path: "cell_0", cellId: "pp_created", content: "moved new cell" }]);
  });

  it("shows rejected refreshes without reporting success or clearing edit proposals", async () => {
    const { result } = setup();
    const proposal = { proposalId: "patch", summary: "Edit", updates: [], createdAt: 1 };
    await act(async () => { bridge.handler!({ type: "agent_patch_proposed", payload: proposal }); });
    const error = new Error("Cell 1 has unapplied agent edits. Use Apply or Reject.");
    bridge.submitWorkspaceDelta.mockRejectedValueOnce(error);
    await act(async () => {
      await expect(result.current.syncWorkspace()).rejects.toThrow(error.message);
    });
    expect(result.current.bridgeError).toBe(error.message);
    expect(result.current.changeHistory[0].proposal).toEqual(proposal);
    expect(result.current.terminalOutput).not.toContain("Updated agent workspace");
  });

  it("does not send an update when Colab returns no cells", async () => {
    const { result } = setup([]);
    await act(async () => {
      await expect(result.current.syncWorkspace()).rejects.toThrow("No notebook cells were returned by Colab");
    });
    expect(bridge.submitWorkspaceDelta).not.toHaveBeenCalled();
    expect(result.current.bridgeError).toContain("No notebook cells");
  });
});

describe("automatic agent edits", () => {
  const proposal = {
    proposalId: "automatic-patch", sessionId: "session", summary: "Updated Cell 1", createdAt: 1,
    updates: [{ cellPath: "cell_0", relativePath: "Cell 1", previousContent: "old", newContent: "agent edit", baseHash: "old-hash" }],
  };

  it("syncs a saved edit without a second approval and keeps its before/after history", async () => {
    const { result } = setup();
    await act(async () => { bridge.handler!({ type: "agent_patch_proposed", payload: proposal }); });
    expect(bridge.applyCellUpdates).toHaveBeenCalledWith({ updates: proposal.updates, mode: "best-effort" });
    expect(bridge.sendPatchApplyResult).toHaveBeenCalledWith("session", proposal.proposalId, expect.objectContaining({ success: true }));
    expect(result.current.patchQueue).toEqual([]);
    expect(result.current.changeHistory).toEqual([{ proposal, status: "applied", result: expect.objectContaining({ success: true }) }]);
    await act(async () => { bridge.handler!({ type: "agent_patch_proposed", payload: proposal }); });
    expect(bridge.applyCellUpdates).toHaveBeenCalledOnce();
    expect(bridge.sendPatchApplyResult).toHaveBeenCalledTimes(2);
  });

  it("serializes successive edits instead of applying them concurrently", async () => {
    const { result } = setup();
    let finishFirst!: (value: ApplyCellUpdatesResult) => void;
    bridge.applyCellUpdates.mockReturnValueOnce(new Promise(resolve => { finishFirst = resolve; }));
    const second = { ...proposal, proposalId: "second-patch" };
    await act(async () => {
      bridge.handler!({ type: "agent_patch_proposed", payload: proposal });
      bridge.handler!({ type: "agent_patch_proposed", payload: second });
    });
    expect(bridge.applyCellUpdates).toHaveBeenCalledOnce();
    expect(result.current.changeHistory[0].status).toBe("syncing");
    await act(async () => { finishFirst({ success: true, results: [{ cellPath: "cell_0", applied: true }] }); });
    expect(bridge.applyCellUpdates).toHaveBeenCalledTimes(2);
    expect(result.current.changeHistory.map(change => change.status)).toEqual(["applied", "applied"]);
  });

  it("retains failed updates for retry and keeps successful updates out of the retry", async () => {
    const { result } = setup();
    const partial = { ...proposal, updates: [...proposal.updates, { cellPath: "cell_1", newContent: "second edit" }] };
    bridge.applyCellUpdates.mockResolvedValueOnce({ success: false, results: [
      { cellPath: "cell_0", applied: true },
      { cellPath: "cell_1", applied: false, reason: "base_hash_mismatch" },
    ] });
    await act(async () => { bridge.handler!({ type: "agent_patch_proposed", payload: partial }); });
    expect(result.current.changeHistory[0].status).toBe("conflict");
    expect(result.current.patchQueue[0].updates).toEqual([partial.updates[1]]);
    expect(result.current.bridgeError).toContain("preserved");
    await act(async () => { await result.current.approvePatch(partial.proposalId); });
    expect(bridge.applyCellUpdates).toHaveBeenLastCalledWith({ updates: [partial.updates[1]], mode: "best-effort" });
    expect(result.current.changeHistory[0].status).toBe("applied");
    expect(result.current.patchQueue).toEqual([]);
  });

  it("keeps an edit when Colab is unavailable instead of treating it as rejected", async () => {
    const { result } = setup();
    bridge.applyCellUpdates.mockRejectedValueOnce(new Error("Colab unavailable"));
    await act(async () => { bridge.handler!({ type: "agent_patch_proposed", payload: proposal }); });
    expect(result.current.patchQueue[0]).toEqual(proposal);
    expect(result.current.changeHistory[0].status).toBe("conflict");
    expect(bridge.sendPatchApplyResult).toHaveBeenCalledWith("session", proposal.proposalId, expect.objectContaining({
      results: [expect.objectContaining({ applied: false, reason: "Colab unavailable" })],
    }));
  });
});
