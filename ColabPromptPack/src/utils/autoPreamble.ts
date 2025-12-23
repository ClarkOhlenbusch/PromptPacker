import { getFileSystem, FileEntry } from "../services/FileSystem";

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
  const fs = getFileSystem();
  
  // Package.json (Node/JS)
  const pkgJson = rootFiles.find(f => f.relative_path === 'package.json');
  if (pkgJson) {
    try {
      const content = await fs.readFileContent(pkgJson.path);

      // Validate content before parsing
      if (typeof content !== 'string' || content.trim().length === 0) {
        console.warn("package.json content is empty or invalid");
      } else {
        const pkg = JSON.parse(content);

        // Validate parsed object
        if (pkg && typeof pkg === 'object') {
          output += `Project: ${pkg.name || 'Untitled'}\n`;
          if (pkg.description) output += `Description: ${pkg.description}\n`;

          // Safely merge dependencies with null checks
          const deps = {
            ...(pkg.dependencies || {}),
            ...(pkg.devDependencies || {})
          };
          const importantDeps = Object.keys(deps).filter(k =>
            ['react', 'vue', 'svelte', 'next', 'nuxt', 'tailwindcss', 'typescript', 'vite', 'tauri', 'electron', 'express', 'fastify', 'nestjs'].some(i => k.includes(i))
          ).slice(0, 10); // Limit to top matches

          if (importantDeps.length > 0) {
            output += `Key Stack (Node): ${importantDeps.join(', ')}\n`;
          }
        }
      }
    } catch (e) {
      console.error("Error parsing package.json:", e instanceof Error ? e.message : e);
    }
  }

  // Cargo.toml (Rust)
  const cargoToml = rootFiles.find(f => f.relative_path === 'Cargo.toml');
  if (cargoToml) {
    try {
      const content = await fs.readFileContent(cargoToml.path);

      // Validate content before parsing
      if (typeof content !== 'string' || content.trim().length === 0) {
        console.warn("Cargo.toml content is empty or invalid");
      } else {
        // Simple regex extraction to avoid TOML parser dependency
        // Handles both double and single quotes, and multiline values
        const nameMatch = content.match(/^\s*name\s*=\s*["']([^"']+)["']/m);
        const descMatch = content.match(/^\s*description\s*=\s*["']([^"']+)["']/m);

        const name = nameMatch?.[1];
        const desc = descMatch?.[1];

        if (name && !output.includes(name)) output += `Project (Rust): ${name}\n`;
        if (desc && !output.includes(desc)) output += `Description: ${desc}\n`;

        if (output && !output.includes("Key Stack (Node)")) {
          output += `Stack Hint: Rust Project detected.\n`;
        }
      }
    } catch (e) {
      console.error("Error reading Cargo.toml:", e instanceof Error ? e.message : e);
    }
  }

  return output.trim() || null;
}

async function scanReadme(rootFiles: FileEntry[]): Promise<string | null> {
  const readme = rootFiles.find(f => f.relative_path.toLowerCase() === 'readme.md');
  if (!readme) return null;

  const fs = getFileSystem();

  try {
    const content = await fs.readFileContent(readme.path);
    const lines = content.split('\n');
    
    // 1. Try to find an architecture diagram or specific header
    let startIdx = -1;
    let endIdx = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Detect common architecture headers or ASCII boxes
      if (
        line.toLowerCase().includes('architecture') || 
        line.toLowerCase().includes('flow') || 
        line.includes('┌') || line.includes('╔')
      ) {
        startIdx = i;
        break;
      }
    }

    if (startIdx !== -1) {
      // Find the end of the block (empty line or next header)
      for (let j = startIdx + 1; j < lines.length && j < startIdx + 25; j++) {
        if (lines[j].trim() === '' && lines[j+1]?.trim() === '') {
           endIdx = j;
           break;
        }
        if (lines[j].startsWith('#') && j > startIdx + 5) {
           endIdx = j;
           break;
        }
        endIdx = j;
      }
      
      const diagramBlock = lines.slice(Math.max(0, startIdx - 1), endIdx).join('\n');
      return `Project Context:\n${diagramBlock}`;
    }

    // Fallback: First 15 lines
    const summary = lines.slice(0, 15).filter(l => !l.trim().startsWith('[!')).join('\n');
    return `Project Overview:\n${summary}`;
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
