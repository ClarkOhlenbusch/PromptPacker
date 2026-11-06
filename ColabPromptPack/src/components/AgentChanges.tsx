import type { AgentChangeRecord } from "../types/agent";

interface AgentChangesProps {
  changes: AgentChangeRecord[];
  retry: (proposalId: string) => Promise<void>;
  discard: (proposalId: string) => void;
}

const statusLabels = {
  syncing: "Syncing…",
  applied: "Synced to Colab",
  conflict: "Needs attention",
  discarded: "Unsynced edits discarded",
};

export function AgentChanges({ changes, retry, discard }: AgentChangesProps) {
  const conflicts = changes.filter(change => change.status === "conflict");
  const history = changes.filter(change => change.status !== "conflict");
  const renderChange = (change: AgentChangeRecord) => (
    <div key={change.proposal.proposalId} className="rounded border border-slate-200 overflow-hidden">
      <div className="flex justify-between gap-3 p-2 bg-slate-50 text-xs">
        <span>{change.proposal.summary || "Agent edited notebook cells"}</span>
        <span className={change.status === "conflict" ? "text-amber-700" : "text-emerald-700"} role="status">{statusLabels[change.status]}</span>
      </div>
      {change.proposal.updates.map(update => {
        const outcome = change.result?.results.find(entry => entry.cellPath === update.cellPath);
        return (
          <details key={update.changeId || update.cellPath} className="border-t border-slate-200">
            <summary className="p-2 cursor-pointer text-xs font-medium">{update.relativePath || update.cellPath}{update.operation === "append" ? " · Added cell" : ""}{outcome?.applied ? " · Synced" : ""}</summary>
            {outcome?.reason && <p className="px-2 pb-2 text-xs text-amber-700">{outcome.reason === "base_hash_mismatch" ? "This cell changed in Colab while the agent was editing. Both versions have been kept." : outcome.reason}</p>}
            <div className="grid grid-cols-1 gap-2 p-2 text-xs">
              {update.operation !== "append" && <div><p className="font-semibold mb-1">Before</p><pre className="bg-red-50 p-2 overflow-auto max-h-60 whitespace-pre">{update.previousContent ?? "Previous content unavailable"}</pre></div>}
              <div><p className="font-semibold mb-1">Agent edit</p><pre className="bg-emerald-50 p-2 overflow-auto max-h-60 whitespace-pre">{update.newContent}</pre></div>
            </div>
          </details>
        );
      })}
      {change.status === "conflict" && (
        <div className="p-2 flex gap-2">
          <button className="text-xs px-2 py-1 border rounded" onClick={() => { retry(change.proposal.proposalId).catch(console.error); }}>Retry sync</button>
          <button className="text-xs px-2 py-1 border rounded text-red-700" onClick={() => discard(change.proposal.proposalId)}>Discard unsynced edits</button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {conflicts.length > 0 && (
        <section aria-label="Sync conflicts" className="border border-amber-200 rounded-md p-3 space-y-2">
          <h3 className="text-xs font-semibold text-amber-800">Notebook changes need attention</h3>
          {[...conflicts].reverse().map(renderChange)}
        </section>
      )}
      {history.length > 0 && (
        <details data-agent-history className="text-xs text-slate-500">
          <summary className="cursor-pointer py-1">Notebook changes ({history.length})</summary>
          <div className="pt-2 space-y-2">{[...history].reverse().map(renderChange)}</div>
        </details>
      )}
    </div>
  );
}
