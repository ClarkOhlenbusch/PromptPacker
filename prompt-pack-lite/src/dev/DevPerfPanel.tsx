import { useState } from "react";
import { Activity, ChevronDown, ChevronUp } from "lucide-react";
import type { PerfMetrics } from "./PerfMetrics";

interface Props {
  metrics: PerfMetrics | null;
}

function fmt(ms: number): string {
  return ms < 1 ? "<1ms" : `${ms.toFixed(1)}ms`;
}

function hitRate(hits: number, total: number): string {
  if (total === 0) return "—";
  return `${Math.round((hits / total) * 100)}%`;
}

export function DevPerfPanel({ metrics }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-packer-border p-6 shadow-subtle bg-slate-50/30">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-packer-blue" />
          <h3 className="text-sm font-bold text-packer-grey">Dev Metrics</h3>
        </div>
        {open ? (
          <ChevronUp size={16} className="text-packer-text-muted" />
        ) : (
          <ChevronDown size={16} className="text-packer-text-muted" />
        )}
      </button>

      {open && (
        <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-4">
          {/* Scan */}
          <div>
            <span className="text-[11px] font-bold text-packer-text-muted uppercase">
              Scan
            </span>
            {metrics?.scan ? (
              <div className="font-mono text-packer-blue text-sm">
                {fmt(metrics.scan.duration_ms)}
                <span className="text-packer-text-muted text-xs ml-2">
                  {metrics.scan.file_count} files, {metrics.scan.dir_count} dirs
                </span>
              </div>
            ) : (
              <div className="text-xs text-packer-text-muted">No metrics yet</div>
            )}
          </div>

          {/* Watch */}
          <div>
            <span className="text-[11px] font-bold text-packer-text-muted uppercase">
              Watch
            </span>
            {metrics?.watch ? (
              <div className="font-mono text-packer-blue text-sm">
                {fmt(metrics.watch.duration_ms)}
                <span className="text-packer-text-muted text-xs ml-2">
                  {metrics.watch.dirs_watched} dirs
                  {metrics.watch.used_cached_dirs ? " (cached)" : " (walked)"}
                </span>
              </div>
            ) : (
              <div className="text-xs text-packer-text-muted">No metrics yet</div>
            )}
          </div>

          {/* Token Count */}
          <div>
            <span className="text-[11px] font-bold text-packer-text-muted uppercase">
              Token Count
            </span>
            {metrics?.token_count ? (
              <div className="font-mono text-packer-blue text-sm">
                {fmt(metrics.token_count.duration_ms)}
                <span className="text-packer-text-muted text-xs ml-2">
                  {metrics.token_count.files_processed} files, hit{" "}
                  {hitRate(
                    metrics.token_count.cache_hits,
                    metrics.token_count.files_processed
                  )}
                </span>
              </div>
            ) : (
              <div className="text-xs text-packer-text-muted">No metrics yet</div>
            )}
          </div>

          {/* Skeleton Batch */}
          <div>
            <span className="text-[11px] font-bold text-packer-text-muted uppercase">
              Skeleton Batch
            </span>
            {metrics?.skeleton_batch ? (
              <div className="font-mono text-packer-blue text-sm">
                {fmt(metrics.skeleton_batch.duration_ms)}
                <span className="text-packer-text-muted text-xs ml-2">
                  {metrics.skeleton_batch.files_processed} files, hit{" "}
                  {hitRate(
                    metrics.skeleton_batch.cache_hits,
                    metrics.skeleton_batch.files_processed
                  )}
                </span>
              </div>
            ) : (
              <div className="text-xs text-packer-text-muted">No metrics yet</div>
            )}
          </div>

          {/* Skeleton File */}
          <div>
            <span className="text-[11px] font-bold text-packer-text-muted uppercase">
              Skeleton File
            </span>
            {metrics?.skeleton_file ? (
              <div className="font-mono text-packer-blue text-sm">
                {fmt(metrics.skeleton_file.duration_ms)}
                <span className="text-packer-text-muted text-xs ml-2">
                  {metrics.skeleton_file.cache_hit ? "cache hit" : "cache miss"}
                </span>
              </div>
            ) : (
              <div className="text-xs text-packer-text-muted">No metrics yet</div>
            )}
          </div>

          {/* Cache Sizes */}
          <div>
            <span className="text-[11px] font-bold text-packer-text-muted uppercase">
              Cache Sizes
            </span>
            {metrics ? (
              <div className="font-mono text-packer-blue text-sm">
                <span className="text-packer-text-muted text-xs">
                  token: {metrics.token_cache_size}, skeleton:{" "}
                  {metrics.skeleton_cache_size}
                </span>
              </div>
            ) : (
              <div className="text-xs text-packer-text-muted">No metrics yet</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
