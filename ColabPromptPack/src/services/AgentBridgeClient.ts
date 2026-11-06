import {
  BridgeMessage,
  BridgeSessionStartPayload,
  BridgeSessionState,
  ExecuteCellsResult,
  ApplyCellUpdatesResult,
} from "../types/agent";

export type BridgeEventHandler = (message: BridgeMessage<any>) => void;

function generateRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  timer: number;
}

export class AgentBridgeClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private handlers = new Set<BridgeEventHandler>();
  private pending = new Map<string, PendingRequest>();
  private connectPromise: Promise<void> | null = null;
  private token: string | null = null;

  constructor(url = "ws://127.0.0.1:47123") {
    this.url = url;
  }

  setToken(token: string | null) {
    this.token = token;
  }

  isConnected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  onMessage(handler: BridgeEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async connect(): Promise<void> {
    if (this.isConnected()) return;
    if (this.connectPromise) return this.connectPromise;

    const pendingConnect = new Promise<void>((resolve, reject) => {
      try {
        const ws = new WebSocket(this.url);
        this.ws = ws;

        ws.onopen = () => {
          this.emit({ type: "bridge_open", timestamp: Date.now() });
          if (this.token) {
            this.send("auth_response", { token: this.token });
          }
          resolve(undefined);
        };

        ws.onmessage = (event) => {
          this.handleIncoming(event.data);
        };

        ws.onerror = () => {
          const message = "Cannot reach PromptPack Bridge. Open the Bridge app on your computer, then try again.";
          this.emit({ type: "bridge_error", payload: { message }, timestamp: Date.now() });
          reject(new Error(message));
        };

        ws.onclose = () => {
          reject(new Error("Bridge connection closed before connecting"));
          if (this.ws !== ws) return;
          this.emit({ type: "bridge_close", timestamp: Date.now() });
          this.rejectAllPending("Bridge disconnected");
          this.ws = null;
          this.connectPromise = null;
        };
      } catch (error) {
        this.connectPromise = null;
        reject(error);
      }
    }).finally(() => {
      this.connectPromise = null;
    });

    this.connectPromise = pendingConnect;
    return pendingConnect;
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
    }
    this.ws = null;
    this.rejectAllPending("Bridge disconnected");
  }

  send(type: string, payload?: any) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Bridge is not connected");
    }
    const message: BridgeMessage = {
      type,
      payload,
      timestamp: Date.now(),
    };
    this.ws.send(JSON.stringify(message));
  }

  request<TResponse = any>(type: string, payload?: any, timeoutMs = 15000): Promise<TResponse> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("Bridge is not connected"));
    }

    const requestId = generateRequestId();

    return new Promise<TResponse>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`Bridge request timed out: ${type}`));
      }, timeoutMs);

      this.pending.set(requestId, { resolve, reject, timer });

      const message: BridgeMessage = {
        type,
        requestId,
        payload,
        timestamp: Date.now(),
      };
      this.ws?.send(JSON.stringify(message));
    });
  }

  startSession(payload: BridgeSessionStartPayload): Promise<BridgeSessionState> {
    return this.request<BridgeSessionState>("session_start", payload, 30000);
  }

  stopSession(sessionId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>("session_stop", { sessionId }, 10000);
  }

  sendTerminalInput(sessionId: string, input: string) {
    this.send("terminal_input", { sessionId, input });
  }

  resizeTerminal(sessionId: string, cols: number, rows: number) {
    this.send("terminal_resize", { sessionId, cols, rows });
  }

  submitWorkspaceDelta(sessionId: string, cells: Array<{ path: string; content: string; cellId?: string }>) {
    return this.request<{ success: boolean }>("workspace_delta", { sessionId, cells });
  }

  sendPatchApplyResult(sessionId: string, proposalId: string, result: ApplyCellUpdatesResult) {
    this.send("agent_patch_apply_result", {
      sessionId,
      proposalId,
      result,
    });
  }

  sendRunResult(sessionId: string, proposalId: string, result: ExecuteCellsResult) {
    this.send("agent_run_result", {
      sessionId,
      proposalId,
      result,
    });
  }

  private handleIncoming(rawData: any) {
    let message: BridgeMessage;
    try {
      message = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
    } catch (e) {
      this.emit({
        type: "bridge_error",
        payload: { message: "Invalid JSON from bridge" },
        timestamp: Date.now(),
      });
      return;
    }

    if (message.replyTo && this.pending.has(message.replyTo)) {
      const pending = this.pending.get(message.replyTo)!;
      window.clearTimeout(pending.timer);
      this.pending.delete(message.replyTo);

      if (message.type === "error") {
        pending.reject(new Error((message.payload as any)?.message || "Bridge request failed"));
      } else {
        pending.resolve(message.payload as any);
      }
      return;
    }

    this.emit(message);
  }

  private emit(message: BridgeMessage) {
    this.handlers.forEach((handler) => {
      try {
        handler(message);
      } catch (e) {
        console.error("PromptPack bridge handler failed", e);
      }
    });
  }

  private rejectAllPending(reason: string) {
    this.pending.forEach((pending) => {
      window.clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    });
    this.pending.clear();
  }
}
