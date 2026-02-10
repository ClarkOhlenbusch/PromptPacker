import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const manifestJsonPath = path.join(rootDir, 'public', 'manifest.json');

// Get version from command line argument --ver=x.y.z
const args = process.argv.slice(2);
const verArg = args.find(arg => arg.startsWith('--ver='));
const newVersion = verArg ? verArg.split('=')[1] : null;

if (!newVersion) {
    console.log('No version specified. Skipping version update.');
    process.exit(0);
}

function updateJsonFile(filePath, version) {
    if (!fs.existsSync(filePath)) {
        console.warn(`Warning: File not found: ${filePath}`);
        return;
    }
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    content.version = version;
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n');
    console.log(`Updated version in ${path.basename(filePath)} to ${version}`);
}

try {
    updateJsonFile(packageJsonPath, newVersion);
    updateJsonFile(manifestJsonPath, newVersion);
} catch (error) {
    console.error('Error updating version:', error);
    process.exit(1);
}
