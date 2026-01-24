import fastDiff from 'fast-diff';

export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  line: string;
  oldLineNum: number | null;
  newLineNum: number | null;
}

/**
 * Compute line-based diff using Myers algorithm (via fast-diff)
 */
export function computeDiff(oldContent: string, newContent: string): DiffLine[] {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  
  // Use fast-diff on joined lines with unique separator
  const SEP = '\x00';
  const result = fastDiff(oldLines.join(SEP), newLines.join(SEP));
  
  const diffLines: DiffLine[] = [];
  let oldLineNum = 1;
  let newLineNum = 1;
  
  for (const [type, text] of result) {
    const lines = text.split(SEP);
    
    for (const line of lines) {
      if (type === fastDiff.EQUAL) {
        diffLines.push({ type: 'unchanged', line, oldLineNum: oldLineNum++, newLineNum: newLineNum++ });
      } else if (type === fastDiff.DELETE) {
        diffLines.push({ type: 'removed', line, oldLineNum: oldLineNum++, newLineNum: null });
      } else if (type === fastDiff.INSERT) {
        diffLines.push({ type: 'added', line, oldLineNum: null, newLineNum: newLineNum++ });
      }
    }
  }
  
  return diffLines;
}
