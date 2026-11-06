import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseAgentBridgeReturn } from "../hooks/useAgentBridge";
import { AgentTerminalPanel } from "./AgentTerminalPanel";

vi.mock("../hooks/useBridgeAvailability", () => ({
  useBridgeAvailability: () => ({ status: "ready", health: null, checkAgain: vi.fn() }),
}));

const terminalMocks = vi.hoisted(() => ({
  terminals: [] as Array<{
    input?: (data: string) => void;
    dispose: ReturnType<typeof vi.fn>;
  }>,
  observers: [] as Array<{ callback: () => void; disconnect: ReturnType<typeof vi.fn> }>,
}));

vi.mock("xterm", () => ({
  Terminal: class {
    cols = 100;
    rows = 20;
    host!: HTMLElement;
    input?: (data: string) => void;
    dispose = vi.fn(() => { this.host.textContent = ""; });
    constructor() { terminalMocks.terminals.push(this); }
    open(host: HTMLElement) { this.host = host; }
    loadAddon() {}
    focus() {}
    attachCustomKeyEventHandler() {}
    onData(callback: (data: string) => void) { this.input = callback; }
    write(text: string) { this.host.textContent += text; }
    reset() { this.host.textContent = ""; }
  },
}));

vi.mock("xterm-addon-fit", () => ({ FitAddon: class { fit() {} } }));

function createBridge(overrides: Partial<UseAgentBridgeReturn> = {}): UseAgentBridgeReturn {
  return {
    connectionStatus: "connected",
    session: null,
    terminalOutput: "Agent waiting for input > ",
    terminalRevision: 0,
    drainTerminalEvents: vi.fn(() => []),
    bridgeError: null,
    patchQueue: [],
    changeHistory: [],
    runQueue: [],
    connectBridge: vi.fn(async () => {}),
    disconnectBridge: vi.fn(),
    startSession: vi.fn(async () => {}),
    stopSession: vi.fn(async () => {}),
    sendTerminalInput: vi.fn(),
    resizeTerminal: vi.fn(),
    syncWorkspace: vi.fn(async () => {}),
    approvePatch: vi.fn(async () => {}),
    rejectPatch: vi.fn(),
    approveRun: vi.fn(async () => {}),
    rejectRun: vi.fn(),
    clearTerminal: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(850);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(300);
  terminalMocks.terminals.length = 0;
  terminalMocks.observers.length = 0;
  vi.stubGlobal("ResizeObserver", class {
    disconnect = vi.fn();
    constructor(public callback: () => void) { terminalMocks.observers.push(this); }
    observe() {}
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AgentTerminalPanel", () => {
  it("keeps a blocked notebook refresh visible in the panel without logging a Chrome extension error", async () => {
    const message = "Cell 1 has unapplied agent edits. Wait for sync to finish or resolve the conflict under Notebook changes.";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const bridge = createBridge({
      session: { sessionId: "session", workspacePath: "/tmp/notebook", startedAt: 1, agentKind: "codex" },
      bridgeError: message,
      syncWorkspace: vi.fn().mockRejectedValue(new Error(message)),
    });
    render(<AgentTerminalPanel agentBridge={bridge} fileCount={1} />);
    fireEvent.click(screen.getByText("Session tools"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Refresh notebook context" })); });
    expect(bridge.syncWorkspace).toHaveBeenCalledOnce();
    expect(screen.getByText(message)).toBeInTheDocument();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("shows a single Start action, then keeps routine controls out of the active terminal", async () => {
    const bridge = createBridge();
    const { rerender } = render(<AgentTerminalPanel agentBridge={bridge} fileCount={1} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start session" })); });
    expect(bridge.startSession).toHaveBeenCalledWith("codex", undefined);
    expect(screen.queryByRole("button", { name: "Connect Bridge" })).not.toBeInTheDocument();
    rerender(<AgentTerminalPanel agentBridge={{ ...bridge, session: { sessionId: "session", workspacePath: "/tmp/notebook", startedAt: 1, agentKind: "codex" } }} fileCount={1} />);
    expect(screen.getByRole("button", { name: "Stop session" })).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByText("Refresh notebook context")).not.toBeVisible();
    expect(screen.getByText("Clear terminal")).not.toBeVisible();
    expect(screen.queryByText(/Proposed Runs/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Notebook changes/)).not.toBeInTheDocument();
    expect(terminalMocks.terminals).toHaveLength(1);
  });

  it("displays a failed Start action without leaving the button stuck or logging to Chrome", async () => {
    const bridge = createBridge({ startSession: vi.fn().mockRejectedValue(new Error("Start the local bridge first")) });
    render(<AgentTerminalPanel agentBridge={bridge} fileCount={1} />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Start session" })); });
    expect(screen.getByRole("alert")).toHaveTextContent("Start the local bridge first");
    expect(screen.getByRole("button", { name: "Start session" })).toBeEnabled();
  });

  it("preserves visible output when session state and proposal queues change", () => {
    const bridge = createBridge();
    const { container, rerender } = render(<AgentTerminalPanel agentBridge={bridge} fileCount={1} />);
    const terminal = container.querySelector(".agent-terminal")!;
    expect(terminal.textContent).toBe(bridge.terminalOutput);

    rerender(<AgentTerminalPanel agentBridge={{
      ...bridge,
      session: { sessionId: "session", workspacePath: "/tmp/notebook", startedAt: 1, agentKind: "codex" },
    }} fileCount={1} />);
    expect(terminal.textContent).toBe(bridge.terminalOutput);

    rerender(<AgentTerminalPanel agentBridge={{
      ...bridge,
      patchQueue: [{ proposalId: "patch", summary: "Edit", updates: [], createdAt: 1 }],
    }} fileCount={1} />);
    expect(terminal.textContent).toBe(bridge.terminalOutput);
    expect(terminalMocks.terminals).toHaveLength(1);
    expect(terminalMocks.terminals[0].dispose).not.toHaveBeenCalled();
  });

  it("uses the current session callbacks without recreating the terminal", () => {
    const bridge = createBridge();
    const { rerender, unmount } = render(<AgentTerminalPanel agentBridge={bridge} fileCount={1} />);
    const nextBridge = createBridge();
    rerender(<AgentTerminalPanel agentBridge={nextBridge} fileCount={1} />);

    terminalMocks.terminals[0].input!("hello\r");
    expect(nextBridge.sendTerminalInput).toHaveBeenCalledWith("hello\r");
    expect(bridge.sendTerminalInput).not.toHaveBeenCalled();
    expect(nextBridge.resizeTerminal).toHaveBeenCalledWith(100, 20);
    vi.mocked(nextBridge.resizeTerminal).mockClear();
    terminalMocks.observers[0].callback();
    expect(nextBridge.resizeTerminal).toHaveBeenCalledWith(100, 20);
    expect(terminalMocks.terminals).toHaveLength(1);

    unmount();
    expect(terminalMocks.terminals[0].dispose).toHaveBeenCalledOnce();
    expect(terminalMocks.observers[0].disconnect).toHaveBeenCalledOnce();
  });

  it("appends output and clears the screen when output is cleared", () => {
    const bridge = createBridge();
    const { container, rerender } = render(<AgentTerminalPanel agentBridge={bridge} fileCount={1} />);
    vi.mocked(bridge.drainTerminalEvents).mockReturnValueOnce([{ type: "append", data: "hello" }]);
    rerender(<AgentTerminalPanel agentBridge={{ ...bridge, terminalRevision: 1, terminalOutput: bridge.terminalOutput + "hello" }} fileCount={1} />);
    expect(container.querySelector(".agent-terminal")!.textContent).toBe(bridge.terminalOutput + "hello");
    vi.mocked(bridge.drainTerminalEvents).mockReturnValueOnce([{ type: "clear", data: "" }]);
    rerender(<AgentTerminalPanel agentBridge={{ ...bridge, terminalRevision: 2, terminalOutput: "" }} fileCount={1} />);
    expect(container.querySelector(".agent-terminal")!.textContent).toBe("");
    expect(terminalMocks.terminals).toHaveLength(1);
  });
});
