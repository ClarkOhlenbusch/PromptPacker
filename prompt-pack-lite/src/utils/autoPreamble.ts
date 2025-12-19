import { invoke } from "@tauri-apps/api/core";

interface FileEntry {
  path: string;
  relative_path: string;
  is_dir: boolean;
  size: number;
}

export async function generateAutoPreamble(files: FileEntry[]): Promise<string> {
  const parts: string[] = [];
  const rootFiles = files.filter(f => !f.is_dir && !f.relative_path.includes('/'));

  // 1. Manifest Scanning
  const manifestInfo = await scanManifests(rootFiles);
  if (manifestInfo) parts.push(manifestInfo);

  // 2. Readme Head
  const readmeInfo = await scanReadme(rootFiles);
  if (readmeInfo) parts.push(readmeInfo);

  // 3. File Type Distribution
  const statsInfo = calculateStats(files);
  if (statsInfo) parts.push(statsInfo);

  return parts.join("\n\n");
}

async function scanManifests(rootFiles: FileEntry[]): Promise<string | null> {
  let output = "";
  
  // Package.json (Node/JS)
  const pkgJson = rootFiles.find(f => f.relative_path === 'package.json');
  if (pkgJson) {
    try {
      const content = await invoke<string>("read_file_content", { path: pkgJson.path });
      const pkg = JSON.parse(content);
      output += `Project: ${pkg.name || 'Untitled'}\n`;
      if (pkg.description) output += `Description: ${pkg.description}\n`;
      
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const importantDeps = Object.keys(deps).filter(k => 
        ['react', 'vue', 'svelte', 'next', 'nuxt', 'tailwindcss', 'typescript', 'vite', 'tauri', 'electron', 'express', 'fastify', 'nestjs'].some(i => k.includes(i))
      ).slice(0, 10); // Limit to top matches
      
      if (importantDeps.length > 0) {
        output += `Key Stack (Node): ${importantDeps.join(', ')}\n`;
      }
    } catch (e) { console.error("Error parsing package.json", e); }
  }

  // Cargo.toml (Rust)
  const cargoToml = rootFiles.find(f => f.relative_path === 'Cargo.toml');
  if (cargoToml) {
    try {
      const content = await invoke<string>("read_file_content", { path: cargoToml.path });
      // Simple regex extraction to avoid TOML parser dependency
      const name = content.match(/name\s*=\s*\"(.*?)\"/)?.[1];
      const desc = content.match(/description\s*=\s*\"(.*?)\"/)?.[1];
      
      if (name && !output.includes(name)) output += `Project (Rust): ${name}\n`;
      if (desc && !output.includes(desc)) output += `Description: ${desc}\n`;
      
      if (output && !output.includes("Key Stack (Node)")) {
         output += `Stack Hint: Rust Project detected.\n`;
      }
    } catch (e) { console.error("Error reading Cargo.toml", e); }
  }

  return output.trim() || null;
}

async function scanReadme(rootFiles: FileEntry[]): Promise<string | null> {
  const readme = rootFiles.find(f => f.relative_path.toLowerCase() === 'readme.md');
  if (!readme) return null;

  try {
    const content = await invoke<string>("read_file_content", { path: readme.path });
    const lines = content.split('\n').slice(0, 15).filter(l => l.trim().length > 0);
    // Remove badges (images)
    const cleanLines = lines.filter(l => !l.trim().startsWith('[!') && !l.includes('img.shields.io'));
    return `Documentation Head:\n${cleanLines.join('\n')}`;
  } catch (e) {
    return null;
  }
}

function calculateStats(files: FileEntry[]): string {
  const stats: Record<string, number> = {};
  let total = 0;

  files.forEach(f => {
    if (f.is_dir) return;
    const ext = f.relative_path.split('.').pop() || 'no-ext';
    if (['png', 'jpg', 'jpeg', 'svg', 'ico', 'lock', 'json', 'map'].includes(ext)) return; // Skip assets/meta
    stats[ext] = (stats[ext] || 0) + 1;
    total++;
  });

  const sorted = Object.entries(stats)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5) // Top 5
    .map(([ext, count]) => `${ext} (${Math.round((count / total) * 100)}%)`)
    .join(', ');

  return sorted ? `Codebase Profile: ${sorted}` : "";
}
