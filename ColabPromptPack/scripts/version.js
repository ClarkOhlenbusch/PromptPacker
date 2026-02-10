import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rootDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(rootDir, 'package.json');
const manifestJsonPath = path.join(rootDir, 'public', 'manifest.json');

// Get version from environment variable (set via npm run package --ver=x.y.z)
// or from command line argument --ver=x.y.z
const envVer = process.env.npm_config_ver;
const args = process.argv.slice(2);
const verArg = args.find(arg => arg.startsWith('--ver='));
const argVer = verArg ? verArg.split('=')[1] : null;

const newVersion = argVer || envVer;

// Basic validation: 1-4 dot-separated integers
const versionRegex = /^\d+(\.\d+){0,3}$/;

if (!newVersion || !versionRegex.test(newVersion)) {
    if (newVersion) {
        console.error(`Invalid version format: "${newVersion}". Must be 1-4 dot-separated integers.`);
        process.exit(1);
    }
    console.log('No version specified or found in environment. Skipping version update.');
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
