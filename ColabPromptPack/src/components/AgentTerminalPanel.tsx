import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TerminalSquare } from "lucide-react";
import { UseAgentBridgeReturn } from "../hooks/useAgentBridge";
import { Terminal as XTerm } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { AgentChanges } from "./AgentChanges";
import { BridgeSetup } from "./BridgeSetup";
import { useBridgeAvailability } from "../hooks/useBridgeAvailability";
import { AGENT_SETUP_URLS } from "../services/bridgeSetup";

interface AgentTerminalPanelProps {
  agentBridge: UseAgentBridgeReturn;
  fileCount: number;
}

export function AgentTerminalPanel({ agentBridge, fileCount }: AgentTerminalPanelProps) {
  const [agentKind, setAgentKind] = useState<"codex" | "claude" | "custom">("codex");
  const [customCommand, setCustomCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const lastRenderedOutputRef = useRef("");
  const lastTerminalRevisionRef = useRef(0);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const { sendTerminalInput, resizeTerminal } = agentBridge;
  const terminalCallbacksRef = useRef({ sendTerminalInput, resizeTerminal });
  const bridge = useBridgeAvailability(agentBridge.connectionStatus === "connected" || !!agentBridge.session);
  const agentMissing = agentKind !== "custom" && bridge.health?.agents?.[agentKind] === false;

  useLayoutEffect(() => {
    terminalCallbacksRef.current = { sendTerminalInput, resizeTerminal };
    // A new session needs the current dimensions even if the host did not resize.
    const term = termRef.current;
    if (term) {
      resizeTerminal(term.cols, term.rows);
    }
  }, [sendTerminalInput, resizeTerminal]);

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host || termRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: "Menlo, Monaco, Consolas, 'Courier New', monospace",
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 10000,
      theme: {
        background: "#020617",
        foreground: "#e2e8f0",
        cursor: "#38bdf8",
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(host);
    fitAddon.fit();
    term.focus();

    term.attachCustomKeyEventHandler((event) => {
      const key = event.key.toLowerCase();
      const blocksBrowserShortcut =
        (event.metaKey || event.ctrlKey) &&
        (key === "w" || key === "r" || key === "l" || key === "t" || key === "n");
      if (blocksBrowserShortcut) {
        event.preventDefault();
        return false;
      }
      return true;
    });

    term.onData((data) => {
      terminalCallbacksRef.current.sendTerminalInput(data);
    });

    const resizeToFit = () => {
      if (!host.clientWidth || !host.clientHeight) return;
      try {
        fitAddon.fit();
      } catch {
        return;
      }
      if (term.cols > 0 && term.rows > 0) {
        terminalCallbacksRef.current.resizeTerminal(term.cols, term.rows);
      }
    };

    resizeToFit();

    const observer = new ResizeObserver(() => {
      resizeToFit();
    });
    observer.observe(host);

    resizeObserverRef.current = observer;
    termRef.current = term;
    fitAddonRef.current = fitAddon;
    // Restore the retained output if the panel is mounted after output arrived.
    lastRenderedOutputRef.current = agentBridge.terminalOutput;
    if (agentBridge.terminalOutput) term.write(agentBridge.terminalOutput);
    agentBridge.drainTerminalEvents();
    lastTerminalRevisionRef.current = agentBridge.terminalRevision;

    return () => {
      observer.disconnect();
      resizeObserverRef.current = null;
      fitAddonRef.current = null;
      term.dispose();
      termRef.current = null;
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (lastTerminalRevisionRef.current === agentBridge.terminalRevision) return;
    for (const event of agentBridge.drainTerminalEvents()) {
      if (event.type === "snapshot" || event.type === "clear") {
        term.reset();
        lastRenderedOutputRef.current = "";
      }
      if (event.data) {
        term.write(event.data);
        lastRenderedOutputRef.current = (lastRenderedOutputRef.current + event.data).slice(-250_000);
      }
    }
    lastTerminalRevisionRef.current = agentBridge.terminalRevision;
  }, [agentBridge.terminalRevision, agentBridge.drainTerminalEvents]);

  const runAction = async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (error: any) {
      setActionError(error?.message || "Unable to complete the action. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {(actionError || agentBridge.bridgeError) && (
        <div role="alert" className="border border-red-200 bg-red-50 text-red-700 rounded-md p-3 text-xs">
          {actionError || agentBridge.bridgeError}
        </div>
      )}

      {!agentBridge.session && bridge.status !== "ready" && (
        <BridgeSetup status={bridge.status} checkAgain={bridge.checkAgain} />
      )}

      {!agentBridge.session && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Coding agent"
            value={agentKind}
            disabled={busy}
            onChange={(e) => {
              const nextKind = e.target.value as "codex" | "claude" | "custom";
              setAgentKind(nextKind);
              if (nextKind !== "custom") setCustomCommand("");
            }}
            className="flex-1 min-w-32 border border-slate-200 rounded px-3 py-2 text-sm bg-white"
          >
            <option value="codex">Codex</option>
            <option value="claude">Claude Code</option>
            <option value="custom">Custom CLI</option>
          </select>
          {agentKind !== "custom" && (
            <p className="w-full order-3 text-xs text-slate-500">
              Runs <code className="select-text font-mono text-slate-700">{agentKind === "codex" ? "codex --no-alt-screen" : "claude"}</code>
            </p>
          )}
          {agentKind === "custom" && (
            <input
              aria-label="Agent command"
              value={customCommand}
              disabled={busy}
              onChange={(e) => setCustomCommand(e.target.value)}
              placeholder="e.g. codex --no-alt-screen"
              className="w-full order-3 border border-slate-200 rounded px-3 py-2 text-sm"
            />
          )}
          {agentMissing && (
            <p className="w-full order-4 text-xs text-amber-700">
              {agentKind === "codex" ? "Codex" : "Claude Code"} isn’t installed yet. <a href={AGENT_SETUP_URLS[agentKind]} target="_blank" rel="noopener noreferrer" className="underline">Follow the setup guide</a>, then reopen Bridge.
            </p>
          )}
          <button
            onClick={() => { void runAction(() => agentBridge.startSession(agentKind, agentKind === "custom" ? customCommand || undefined : undefined)); }}
            disabled={busy || bridge.status !== "ready" || agentMissing || (agentKind === "custom" && !customCommand.trim())}
            className="px-4 py-2 text-sm font-semibold rounded bg-packer-blue text-white disabled:opacity-50"
          >
            {busy ? "Starting…" : "Start session"}
          </button>
        </div>
      )}

      <div className="border border-slate-200 rounded-md overflow-hidden">
        <div className="bg-slate-900 text-slate-100 px-3 py-2 flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-2 text-xs font-medium">
            <TerminalSquare size={14} />
            {agentBridge.session
              ? agentBridge.session.agentKind === "codex" ? "Codex" : agentBridge.session.agentKind === "claude" ? "Claude Code" : "Agent terminal"
              : "Terminal"}
            {agentBridge.session && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" role="status" aria-label="Session running" />}
          </span>
          {agentBridge.session && (
            <button
              onClick={() => { void runAction(agentBridge.stopSession); }}
              disabled={busy}
              aria-label="Stop session"
              className="text-xs px-2 py-1 rounded text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-50"
            >Stop</button>
          )}
        </div>
        <div
          ref={terminalHostRef}
          onClick={() => termRef.current?.focus()}
          className="agent-terminal bg-slate-950 overflow-hidden"
          style={{ height: agentBridge.session ? "max(360px, calc(100dvh - 200px))" : "clamp(320px, 60vh, 720px)" }}
          tabIndex={0}
        />
      </div>

      <AgentChanges changes={agentBridge.changeHistory} retry={agentBridge.approvePatch} discard={agentBridge.rejectPatch} />

      {agentBridge.runQueue.length > 0 && (
        <section aria-label="Notebook run requests" className="border border-slate-200 rounded p-3 space-y-2">
          <h3 className="text-xs font-semibold text-slate-700">Notebook run requests</h3>
          {agentBridge.runQueue.map(proposal => (
            <div key={proposal.proposalId} className="flex flex-wrap items-center gap-2 text-xs">
              <span className="flex-1">{proposal.summary || "Agent requested notebook execution"}</span>
              <button className="px-2 py-1 rounded bg-packer-blue text-white" onClick={() => { void runAction(() => agentBridge.approveRun(proposal.proposalId)); }} disabled={busy}>Run</button>
              <button className="px-2 py-1 rounded border" onClick={() => agentBridge.rejectRun(proposal.proposalId)}>Reject</button>
            </div>
          ))}
        </section>
      )}

      {agentBridge.session && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer py-1">Session tools</summary>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              onClick={() => { void runAction(agentBridge.syncWorkspace); }}
              disabled={busy}
              title="Copy current Colab cells into the agent workspace"
              className="underline underline-offset-2 disabled:opacity-50"
            >Refresh notebook context</button>
            <button
              onClick={() => {
                agentBridge.clearTerminal();
                termRef.current?.reset();
                lastRenderedOutputRef.current = "";
              }}
              className="underline underline-offset-2"
            >Clear terminal</button>
            <span>{fileCount} cells</span>
          </div>
        </details>
      )}
    </div>
  );
}
