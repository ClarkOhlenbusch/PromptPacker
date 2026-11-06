export type CellType = "code" | "markdown";

export interface CellSnapshot {
  path: string;
  cellId?: string;
  relativePath: string;
  content: string;
  cellType: CellType;
}

export interface CellUpdate {
  cellPath: string;
  cellId?: string;
  operation?: "append" | "move" | "delete";
  afterCellId?: string | null;
  beforeCellId?: string;
  cellType?: CellType;
  newContent: string;
  baseHash?: string;
  relativePath?: string;
  changeId?: string;
  previousContent?: string;
}

export interface ApplyCellUpdatesPayload {
  updates: CellUpdate[];
  mode?: "all-or-nothing" | "best-effort";
}

export interface ApplyCellUpdateResult {
  cellPath: string;
  cellId?: string;
  notebookCellPath?: string;
  applied: boolean;
  reason?: string;
  previousHash?: string;
  currentHash?: string;
  changeId?: string;
}

export interface ApplyCellUpdatesResult {
  success: boolean;
  results: ApplyCellUpdateResult[];
}

export interface ExecuteCellsRequest {
  mode: "cell" | "range" | "all";
  cellPaths?: string[];
  cellIds?: string[];
  inspectOnly?: boolean;
  range?: {
    start: number;
    end: number;
  };
  requestId?: string;
}

export interface ExecuteCellsResult {
  requestId?: string;
  status: "ok" | "queued" | "error" | "partial";
  executed: number;
  errors: string[];
  outputs?: Array<{
    cellPath: string;
    output: string;
    state?: "running" | "pending" | "idle" | "unknown";
    hasError?: boolean;
  }>;
}

export interface NotebookMetadata {
  notebookUrl: string;
  notebookId: string | null;
  title: string;
  kernel: string | null;
  language: string | null;
  cellCount: number;
}

export interface AgentPatchProposal {
  sessionId?: string;
  proposalId: string;
  summary: string;
  updates: CellUpdate[];
  createdAt: number;
}

export interface AgentChangeRecord {
  proposal: AgentPatchProposal;
  status: "syncing" | "applied" | "conflict" | "discarded";
  result?: ApplyCellUpdatesResult;
}

export interface AgentRunProposal {
  proposalId: string;
  command: ExecuteCellsRequest;
  summary: string;
  createdAt: number;
}

export interface BridgeSessionStartPayload {
  notebook: NotebookMetadata;
  cells: CellSnapshot[];
  agent: {
    kind: "codex" | "claude" | "custom";
    command?: string;
    args?: string[];
  };
  mounts?: Array<{
    alias: string;
    path: string;
  }>;
}

export interface BridgeSessionState {
  sessionId: string;
  workspacePath: string;
  startedAt: number;
  agentKind: string;
}

export interface BridgeMessage<T = unknown> {
  type: string;
  requestId?: string;
  replyTo?: string;
  payload?: T;
  timestamp?: number;
}
