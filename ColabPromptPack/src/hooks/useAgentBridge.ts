import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentBridgeClient } from "../services/AgentBridgeClient";
import { ColabFileSystem } from "../services/ColabFileSystem";
import { FileEntry, IFileSystem } from "../services/FileSystem";
import { BRIDGE_URL } from "../services/bridgeSetup";
import {
  AgentPatchProposal,
  AgentChangeRecord,
  AgentRunProposal,
  ApplyCellUpdatesResult,
  BridgeMessage,
  BridgeSessionStartPayload,
  BridgeSessionState,
  CellSnapshot,
  ExecuteCellsResult,
} from "../types/agent";

export interface UseAgentBridgeReturn {
  connectionStatus: "disconnected" | "connecting" | "connected" | "error";
  session: BridgeSessionState | null;
  terminalOutput: string;
  terminalRevision: number;
  drainTerminalEvents: () => Array<{ type: "append" | "snapshot" | "clear"; data: string }>;
  bridgeError: string | null;
  patchQueue: AgentPatchProposal[];
  changeHistory: AgentChangeRecord[];
  runQueue: AgentRunProposal[];
  connectBridge: () => Promise<void>;
  disconnectBridge: () => void;
  startSession: (agentKind: "codex" | "claude" | "custom", command?: string) => Promise<void>;
  stopSession: () => Promise<void>;
  sendTerminalInput: (input: string) => void;
  resizeTerminal: (cols: number, rows: number) => void;
  syncWorkspace: () => Promise<void>;
  approvePatch: (proposalId: string) => Promise<void>;
  rejectPatch: (proposalId: string) => void;
  approveRun: (proposalId: string) => Promise<void>;
  rejectRun: (proposalId: string) => void;
  clearTerminal: () => void;
}

const LAST_SESSION_STORAGE_KEY = "promptpack.bridge.sessionId";

function appendTerminal(previous: string, chunk: string): string {
  const next = previous + chunk;
  if (next.length > 250_000) {
    return next.slice(next.length - 250_000);
  }
  return next;
}

async function buildCellSnapshot(fs: ColabFileSystem, files: FileEntry[]): Promise<CellSnapshot[]> {
  const snapshots: CellSnapshot[] = [];

  for (const file of files) {
    if (file.is_dir) continue;

    let content = file.content ?? "";
    if (!content) {
      content = await fs.readFileContent(file.path);
    }

    snapshots.push({
      path: file.path,
      ...(file.cellId ? { cellId: file.cellId } : {}),
      relativePath: file.relative_path,
      content,
      cellType: file.cellType === "markdown" ? "markdown" : "code",
    });
  }

  return snapshots;
}

export function useAgentBridge(fs: IFileSystem, files: FileEntry[]): UseAgentBridgeReturn {
  const colabFs = fs as ColabFileSystem;
  const clientRef = useRef<AgentBridgeClient | null>(null);
  const sessionRef = useRef<BridgeSessionState | null>(null);
  const seenPatches = useRef(new Set<string>());
  const completedPatchResults = useRef(new Map<string, ApplyCellUpdatesResult>());
  const syncChain = useRef(Promise.resolve());
  const completedRuns = useRef(new Map<string, ExecuteCellsResult>());
  const seenRuns = useRef(new Set<string>());
  const terminalBufferRef = useRef("");
  const terminalPendingRef = useRef<string[]>([]);
  const terminalEventsRef = useRef<Array<{ type: "append" | "snapshot" | "clear"; data: string }>>([]);
  const terminalFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [connectionStatus, setConnectionStatus] = useState<"disconnected" | "connecting" | "connected" | "error">("disconnected");
  const [session, setSessionState] = useState<BridgeSessionState | null>(null);
  const setSession = useCallback((state: BridgeSessionState | null) => {
    sessionRef.current = state;
    setSessionState(state);
  }, []);
  const [terminalOutput, setTerminalOutput] = useState("");
  const [terminalRevision, setTerminalRevision] = useState(0);
  const drainTerminalEvents = useCallback(() => terminalEventsRef.current.splice(0), []);
  const queueTerminalOutput = useCallback((chunk: string) => {
    if (!chunk) return;
    terminalPendingRef.current.push(chunk);
    if (terminalFlushTimerRef.current !== null) return;
    terminalFlushTimerRef.current = setTimeout(() => {
      terminalFlushTimerRef.current = null;
      const data = terminalPendingRef.current.join("");
      terminalPendingRef.current = [];
      if (!data) return;
      terminalBufferRef.current = appendTerminal(terminalBufferRef.current, data);
      terminalEventsRef.current.push({ type: "append", data });
      setTerminalOutput(terminalBufferRef.current);
      setTerminalRevision(revision => revision + 1);
    }, 32);
  }, []);
  const [bridgeError, setBridgeError] = useState<string | null>(null);
  const [patchQueue, setPatchQueue] = useState<AgentPatchProposal[]>([]);
  const [changeHistory, setChangeHistory] = useState<AgentChangeRecord[]>([]);
  const [runQueue, setRunQueue] = useState<AgentRunProposal[]>([]);

  const ensureClient = useCallback(() => {
    if (!clientRef.current) {
      clientRef.current = new AgentBridgeClient(BRIDGE_URL);
    }
    return clientRef.current;
  }, []);

  const applyPatch = useCallback(async (proposal: AgentPatchProposal, sessionId: string) => {
    if (sessionRef.current?.sessionId !== sessionId) return;
    setChangeHistory(previous => {
      const existing = previous.find(item => item.proposal.proposalId === proposal.proposalId);
      return existing
        ? previous.map(item => item === existing ? { ...item, status: "syncing" } : item)
        : [...previous, { proposal, status: "syncing" }];
    });
    let result: ApplyCellUpdatesResult;
    try {
      result = await colabFs.applyCellUpdates({ updates: proposal.updates, mode: "best-effort" });
    } catch (error: any) {
      result = {
        success: false,
        results: proposal.updates.map(update => ({ cellPath: update.cellPath, applied: false, reason: error?.message || "Unable to reach Colab", changeId: update.changeId })),
      };
    }
    completedPatchResults.current.set(proposal.proposalId, result);
    let bridgeAckSent = true;
    try {
      ensureClient().sendPatchApplyResult(sessionId, proposal.proposalId, result);
    } catch {
      bridgeAckSent = false;
      setBridgeError("The bridge disconnected during sync. Reconnect to finish syncing your changes.");
    }
    if (sessionRef.current && sessionRef.current.sessionId !== sessionId) return;
    const failedUpdates = proposal.updates.filter(update => !result.results.some(entry => entry.cellPath === update.cellPath && entry.applied));
    setPatchQueue(previous => [
      ...previous.filter(item => item.proposalId !== proposal.proposalId),
      ...(failedUpdates.length ? [{ ...proposal, updates: failedUpdates }] : []),
    ]);
    setChangeHistory(previous => previous.map(item => {
      if (item.proposal.proposalId !== proposal.proposalId) return item;
      const entries = new Map(item.result?.results.map(entry => [entry.cellPath, entry]) || []);
      result.results.forEach(entry => entries.set(entry.cellPath, entry));
      const success = item.proposal.updates.every(update => entries.get(update.cellPath)?.applied);
      return { ...item, status: success ? "applied" : "conflict", result: { success, results: [...entries.values()] } };
    }));
    if (failedUpdates.length) {
      setBridgeError("Some agent edits could not sync. Your notebook and agent files were preserved. Review the conflict under Notebook changes.");
    } else if (bridgeAckSent) {
      setBridgeError(null);
    }
  }, [colabFs, ensureClient]);

  useEffect(() => {
    const client = ensureClient();

    const unsubscribe = client.onMessage((message: BridgeMessage<any>) => {
      if (message.type === "hello" || message.type === "bridge_open") {
        setConnectionStatus("connected");
        setBridgeError(null);
        return;
      }

      if (message.type === "bridge_close") {
        setConnectionStatus("disconnected");
        setSession(null);
        return;
      }

      if (message.type === "bridge_error") {
        setConnectionStatus("error");
        setBridgeError((message.payload as any)?.message || "Bridge error");
        return;
      }

      if (message.type === "terminal_output") {
        const chunk = (message.payload as any)?.data || "";
        queueTerminalOutput(chunk);
        return;
      }

      if (message.type === "terminal_snapshot") {
        if (terminalFlushTimerRef.current !== null) clearTimeout(terminalFlushTimerRef.current);
        terminalFlushTimerRef.current = null;
        terminalPendingRef.current = [];
        terminalBufferRef.current = message.payload?.data || "";
        terminalEventsRef.current.push({ type: "snapshot", data: terminalBufferRef.current });
        setTerminalOutput(terminalBufferRef.current);
        setTerminalRevision(revision => revision + 1);
        return;
      }

      if (message.type === "session_state") {
        const state = (message.payload as BridgeSessionState) || null;
        setSession(state);
        if (state?.sessionId) {
          window.sessionStorage.setItem(LAST_SESSION_STORAGE_KEY, state.sessionId);
        }
        return;
      }

      if (message.type === "session_closed") {
        setSession(null);
        window.sessionStorage.removeItem(LAST_SESSION_STORAGE_KEY);
        return;
      }

      if (message.type === "agent_patch_proposed") {
        const proposal = message.payload as AgentPatchProposal;
        const sessionId = proposal?.sessionId || sessionRef.current?.sessionId;
        if (proposal?.proposalId && sessionId && completedPatchResults.current.has(proposal.proposalId)) {
          client.sendPatchApplyResult(sessionId, proposal.proposalId, completedPatchResults.current.get(proposal.proposalId)!);
          return;
        }
        if (proposal?.proposalId && sessionId && !seenPatches.current.has(proposal.proposalId)) {
          seenPatches.current.add(proposal.proposalId);
          // File writes already passed through the agent's own approval policy.
          // Serialize notebook writes so successive patches validate in order.
          syncChain.current = syncChain.current.then(() => applyPatch(proposal, sessionId));
        }
        return;
      }

      if (message.type === "agent_run_proposed") {
        const proposal = message.payload as AgentRunProposal;
        if (proposal?.proposalId) {
          const sessionId = sessionRef.current?.sessionId;
          const completed = completedRuns.current.get(proposal.proposalId);
          if (completed && sessionId) client.sendRunResult(sessionId, proposal.proposalId, completed);
          else if (sessionId && !seenRuns.current.has(proposal.proposalId)) {
            seenRuns.current.add(proposal.proposalId);
            syncChain.current = syncChain.current.then(async () => {
              let result: ExecuteCellsResult;
              try { result = await colabFs.executeCells(proposal.command); }
              catch (error: any) { result = { status: "error", executed: 0, errors: [error?.message || "Unable to execute cells"] }; }
              completedRuns.current.set(proposal.proposalId, result);
              client.sendRunResult(sessionId, proposal.proposalId, result);
            });
          }
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [ensureClient, applyPatch, setSession, queueTerminalOutput, colabFs]);

  const connectBridge = useCallback(async () => {
    const client = ensureClient();
    setConnectionStatus("connecting");
    setBridgeError(null);

    try {
      await client.connect();
      setConnectionStatus("connected");

      const previousSessionId = window.sessionStorage.getItem(LAST_SESSION_STORAGE_KEY);
      if (previousSessionId) {
        try {
          const resumed = await client.request<BridgeSessionState>(
            "session_resume",
            { sessionId: previousSessionId },
            10000
          );
          setSession(resumed);
        } catch {
          window.sessionStorage.removeItem(LAST_SESSION_STORAGE_KEY);
        }
      }
    } catch (error: any) {
      setConnectionStatus("error");
      setBridgeError(error?.message || "Failed to connect to PromptPack Bridge");
      throw error;
    }
  }, [ensureClient]);

  const disconnectBridge = useCallback(() => {
    const client = clientRef.current;
    if (client) {
      client.disconnect();
    }
    setSession(null);
    setConnectionStatus("disconnected");
    window.sessionStorage.removeItem(LAST_SESSION_STORAGE_KEY);
  }, []);

  const startSession = useCallback(async (agentKind: "codex" | "claude" | "custom", command?: string) => {
    const client = ensureClient();

    if (!client.isConnected()) {
      await connectBridge();
    }

    // The single Start action may have reconnected to an existing session.
    if (sessionRef.current) return;

    const metadata = await colabFs.getNotebookMetadata();
    if (!metadata) {
      throw new Error("Unable to load notebook metadata");
    }

    const cells = await buildCellSnapshot(colabFs, files);

    const payload: BridgeSessionStartPayload = {
      notebook: metadata,
      cells,
      agent: {
        kind: agentKind,
        command,
      },
    };

    const state = await client.startSession(payload);
    setSession(state);
    window.sessionStorage.setItem(LAST_SESSION_STORAGE_KEY, state.sessionId);
    setPatchQueue([]);
    setChangeHistory([]);
    seenPatches.current.clear();
    completedPatchResults.current.clear();
    setRunQueue([]);
  }, [ensureClient, connectBridge, colabFs, files]);

  const stopSession = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !session) return;

    await client.stopSession(session.sessionId);
    setSession(null);
    window.sessionStorage.removeItem(LAST_SESSION_STORAGE_KEY);
  }, [session]);

  const sendTerminalInput = useCallback((input: string) => {
    const client = clientRef.current;
    if (!client || !session) return;
    client.sendTerminalInput(session.sessionId, input);
  }, [session]);

  const resizeTerminal = useCallback((cols: number, rows: number) => {
    const client = clientRef.current;
    if (!client || !session) return;
    client.resizeTerminal(session.sessionId, cols, rows);
  }, [session]);

  const syncWorkspace = useCallback(async () => {
    const client = clientRef.current;
    if (!client || !session) return;

    setBridgeError(null);
    try {
      const freshFiles = await colabFs.scanProject("");
      if (freshFiles.length === 0) {
        throw new Error("No notebook cells were returned by Colab. Refresh the notebook and try again.");
      }
      const cells = await buildCellSnapshot(colabFs, freshFiles);
      await client.submitWorkspaceDelta(session.sessionId, cells.map((cell) => ({
        path: cell.path,
        content: cell.content,
        ...(cell.cellId ? { cellId: cell.cellId } : {}),
      })));
      queueTerminalOutput("\r\n[PromptPack] Updated agent workspace from Colab.\r\n");
    } catch (error: any) {
      const message = error?.message || "Failed to update agent workspace from Colab";
      setBridgeError(message.includes("Use Apply or Reject under Proposed Cell Edits")
        ? "The bridge is running older code. Restart the bridge, reload the PromptPack extension, and refresh Colab to use automatic edit sync."
        : message);
      throw error;
    }
  }, [session, colabFs, queueTerminalOutput]);

  const approvePatch = useCallback(async (proposalId: string) => {
    const proposal = patchQueue.find((item) => item.proposalId === proposalId);
    const client = clientRef.current;
    if (!proposal || !session || !client) return;

    syncChain.current = syncChain.current.then(() => applyPatch(proposal, session.sessionId));
    await syncChain.current;
  }, [patchQueue, session, applyPatch]);

  const rejectPatch = useCallback((proposalId: string) => {
    const proposal = patchQueue.find((item) => item.proposalId === proposalId);
    const client = clientRef.current;
    if (!proposal || !session || !client) return;

    const result: ApplyCellUpdatesResult = {
      success: false,
      results: proposal.updates.map((update) => ({
        cellPath: update.cellPath,
        applied: false,
        reason: "Rejected by user",
        changeId: update.changeId,
      })),
    };

    completedPatchResults.current.set(proposalId, result);
    client.sendPatchApplyResult(session.sessionId, proposalId, result);
    setBridgeError(null);
    setPatchQueue((prev) => prev.filter((item) => item.proposalId !== proposalId));
    setChangeHistory(previous => previous.map(item => item.proposal.proposalId === proposalId ? { ...item, status: "discarded" } : item));
  }, [patchQueue, session]);

  const approveRun = useCallback(async (proposalId: string) => {
    const proposal = runQueue.find((item) => item.proposalId === proposalId);
    const client = clientRef.current;
    if (!proposal || !session || !client) return;

    const result = await colabFs.executeCells(proposal.command);
    client.sendRunResult(session.sessionId, proposalId, result);
    setRunQueue((prev) => prev.filter((item) => item.proposalId !== proposalId));
  }, [runQueue, session, colabFs]);

  const rejectRun = useCallback((proposalId: string) => {
    const proposal = runQueue.find((item) => item.proposalId === proposalId);
    const client = clientRef.current;
    if (!proposal || !session || !client) return;

    const result: ExecuteCellsResult = {
      requestId: proposal.command.requestId,
      status: "error",
      executed: 0,
      errors: ["Rejected by user"],
    };

    client.sendRunResult(session.sessionId, proposalId, result);
    setRunQueue((prev) => prev.filter((item) => item.proposalId !== proposalId));
  }, [runQueue, session]);

  const clearTerminal = useCallback(() => {
    if (terminalFlushTimerRef.current !== null) clearTimeout(terminalFlushTimerRef.current);
    terminalFlushTimerRef.current = null;
    terminalPendingRef.current = [];
    terminalBufferRef.current = "";
    terminalEventsRef.current.push({ type: "clear", data: "" });
    setTerminalOutput("");
    setTerminalRevision(revision => revision + 1);
  }, []);

  useEffect(() => () => {
    if (terminalFlushTimerRef.current !== null) clearTimeout(terminalFlushTimerRef.current);
  }, []);

  return useMemo(() => ({
    connectionStatus,
    session,
    terminalOutput,
    terminalRevision,
    drainTerminalEvents,
    bridgeError,
    patchQueue,
    changeHistory,
    runQueue,
    connectBridge,
    disconnectBridge,
    startSession,
    stopSession,
    sendTerminalInput,
    resizeTerminal,
    syncWorkspace,
    approvePatch,
    rejectPatch,
    approveRun,
    rejectRun,
    clearTerminal,
  }), [
    connectionStatus,
    session,
    terminalOutput,
    terminalRevision,
    drainTerminalEvents,
    bridgeError,
    patchQueue,
    changeHistory,
    runQueue,
    connectBridge,
    disconnectBridge,
    startSession,
    stopSession,
    sendTerminalInput,
    resizeTerminal,
    syncWorkspace,
    approvePatch,
    rejectPatch,
    approveRun,
    rejectRun,
    clearTerminal,
  ]);
}
