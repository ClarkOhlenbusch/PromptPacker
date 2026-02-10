export interface ScanMetrics {
  duration_ms: number;
  file_count: number;
  dir_count: number;
}

export interface TokenCountMetrics {
  duration_ms: number;
  files_processed: number;
  cache_hits: number;
  cache_misses: number;
}

export interface SkeletonFileMetrics {
  duration_ms: number;
  cache_hit: boolean;
}

export interface SkeletonBatchMetrics {
  duration_ms: number;
  files_processed: number;
  cache_hits: number;
  cache_misses: number;
}

export interface WatchMetrics {
  duration_ms: number;
  dirs_watched: number;
  used_cached_dirs: boolean;
}

export interface PerfMetrics {
  scan: ScanMetrics | null;
  token_count: TokenCountMetrics | null;
  skeleton_file: SkeletonFileMetrics | null;
  skeleton_batch: SkeletonBatchMetrics | null;
  watch: WatchMetrics | null;
  token_cache_size: number;
  skeleton_cache_size: number;
}
