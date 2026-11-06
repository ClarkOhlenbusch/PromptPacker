const fs = require('node:fs');
const path = require('node:path');

function makeHelpersExecutable(root) {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) makeHelpersExecutable(file);
    else if (entry.name === 'spawn-helper') fs.chmodSync(file, 0o755);
  }
}

module.exports = { makeHelpersExecutable };
if (require.main === module) {
  makeHelpersExecutable(path.join(__dirname, '../node_modules/node-pty'));
}
