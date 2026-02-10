export interface FileEntry {
    path: string;
    relative_path: string;
    is_dir: boolean;
    size: number;
    line_count?: number;
}
