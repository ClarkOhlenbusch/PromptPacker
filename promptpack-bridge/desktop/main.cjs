const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const smokeTest = process.argv.includes('--smoke-test');
const isolated = smokeTest || process.argv.includes('--isolated-test');
if (isolated) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'promptpack-bridge-profile-')));
if (smokeTest && !process.env.PROMPTPACK_BRIDGE_PORT) process.env.PROMPTPACK_BRIDGE_PORT = '0';
process.env.PROMPTPACK_BRIDGE_DESKTOP = '1';
let window;
let tray;
let bridge;
let quitting = false;
let shuttingDown = false;
let refreshTimer;
let state = { phase: 'starting', message: 'Starting your bridge…', agents: {}, version: app.getVersion() };

const helpLinks = {
  codex: 'https://learn.chatgpt.com/docs/codex/cli',
  claude: 'https://code.claude.com/docs/en/overview',
  colab: 'https://colab.research.google.com/',
};

function showWindow() {
  if (!window) return;
  window.show();
  window.focus();
}

function updateState(update) {
  state = { ...state, ...update, supportsLogin: process.platform !== 'linux', launchAtLogin: !isolated && process.platform !== 'linux' ? app.getLoginItemSettings().openAtLogin : false };
  window?.webContents.send('bridge:status', state);
  if (tray) {
    tray.setToolTip(`PromptPack Bridge — ${state.phase === 'ready' ? 'Ready for Colab' : 'Needs attention'}`);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: state.phase === 'ready' ? 'Ready for Colab' : 'Bridge needs attention', enabled: false },
      { label: 'Open PromptPack Bridge', click: showWindow },
      { type: 'separator' },
      { label: 'Quit PromptPack Bridge', click: () => app.quit() },
    ]));
  }
}

function probeExisting() {
  const port = Number(process.env.PROMPTPACK_BRIDGE_PORT || 47123);
  if (!port) return Promise.resolve(null);
  return new Promise(resolve => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/health', timeout: 1000 }, response => {
      let data = '';
      response.on('data', chunk => { data += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(null); }
      });
    });
    request.on('timeout', () => { request.destroy(); resolve(null); });
    request.on('error', () => resolve(null));
  });
}

async function restoreShellPath() {
  if (process.platform === 'win32') return;
  const loginShell = process.env.SHELL || '/bin/sh';
  await new Promise(resolve => {
    execFile(loginShell, ['-ilc', 'printf "\\n__PROMPTPACK_PATH__%s" "$PATH"'], { timeout: 5000, maxBuffer: 256 * 1024 }, (error, output) => {
      const marker = '\n__PROMPTPACK_PATH__';
      if (!error && output.includes(marker)) process.env.PATH = output.slice(output.lastIndexOf(marker) + marker.length).trim();
      resolve();
    });
  });
}

async function startBridge() {
  if (bridge) { updateState({ phase: 'ready', ...bridge.getBridgeStatus() }); return; }
  updateState({ phase: 'starting', message: 'Starting your bridge…' });
  try {
    const existing = await probeExisting();
    if (existing?.service === 'promptpack-bridge') {
      updateState({ phase: 'ready', message: 'Your bridge is already running. Return to Colab and click Start session.', ...existing });
      return;
    }
    if (existing) throw new Error('Another bridge is already open. Close that copy, then click Try again.');
    await restoreShellPath();
    const loaded = await import(pathToFileURL(path.join(__dirname, '../src/server.js')).href);
    const status = await loaded.bridgeReady;
    bridge = loaded;
    updateState({ phase: 'ready', message: 'Return to your Colab tab and click Start session.', ...status });
    refreshTimer = setInterval(() => updateState(bridge.getBridgeStatus()), 3000);
  } catch (error) {
    fs.mkdirSync(app.getPath('userData'), { recursive: true });
    fs.appendFileSync(path.join(app.getPath('userData'), 'bridge.log'), `${new Date().toISOString()} ${error.stack || error}\n`);
    updateState({ phase: 'error', message: error.code === 'EADDRINUSE' ? 'Another app is using the bridge connection. Close the other copy of PromptPack Bridge, then reopen this app.' : error.message });
  }
}

function createWindow() {
  window = new BrowserWindow({
    show: !smokeTest,
    width: 520, height: 680, minWidth: 430, minHeight: 560,
    title: 'PromptPack Bridge', backgroundColor: '#f8fafc', autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  window.loadFile(path.join(__dirname, 'index.html'));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close', event => {
    if (!quitting && tray) { event.preventDefault(); process.platform === 'linux' ? window.minimize() : window.hide(); }
  });
  window.webContents.on('did-finish-load', () => updateState(state));
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets/icon.png')).resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.on('click', showWindow);
  updateState(state);
}

ipcMain.handle('bridge:status', () => ({ ...state, launchAtLogin: !isolated && process.platform !== 'linux' ? app.getLoginItemSettings().openAtLogin : false, supportsLogin: process.platform !== 'linux' }));
ipcMain.handle('bridge:retry', () => { app.relaunch(); app.quit(); });
ipcMain.handle('bridge:help', (_event, key) => { if (helpLinks[key]) return shell.openExternal(helpLinks[key]); });
ipcMain.handle('bridge:login', (_event, enabled) => {
  if (!isolated && process.platform !== 'linux') app.setLoginItemSettings({ openAtLogin: enabled === true });
  updateState(state);
});
ipcMain.handle('bridge:quit', () => app.quit());

app.on('before-quit', event => {
  quitting = true;
  clearInterval(refreshTimer);
  if (bridge && !shuttingDown) {
    event.preventDefault();
    shuttingDown = true;
    bridge.shutdownBridge().finally(() => app.quit());
  }
});
app.on('activate', showWindow);
app.on('open-url', event => { event.preventDefault(); showWindow(); });
app.on('window-all-closed', () => { if (!tray) app.quit(); });

if (!isolated && !app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    if (app.isPackaged && !isolated) app.setAsDefaultProtocolClient('promptpack-bridge');
    createWindow();
    await startBridge();
    if (smokeTest) {
      let exitCode = 0;
      try {
        if (state.phase !== 'ready' || !bridge) throw new Error(`Bridge did not start: ${state.message}`);
        await require('./smoke.cjs')(state);
        if (window.webContents.isLoading()) await new Promise(resolve => window.webContents.once('did-finish-load', resolve));
        const deadline = Date.now() + 5000;
        while (await window.webContents.executeJavaScript('document.getElementById("title").textContent') !== 'Ready for Colab') {
          if (Date.now() > deadline) throw new Error('Setup window did not display Ready for Colab');
          await new Promise(resolve => setTimeout(resolve, 25));
        }
        if (process.env.PROMPTPACK_BRIDGE_SCREENSHOT) {
          fs.writeFileSync(process.env.PROMPTPACK_BRIDGE_SCREENSHOT, (await window.webContents.capturePage()).toPNG());
        }
        console.log('PROMPTPACK_DESKTOP_SMOKE_OK', JSON.stringify({ version: state.version, terminalBackend: state.terminalBackend, packaged: app.isPackaged }));
      } catch (error) { console.error(error); exitCode = 1; }
      clearInterval(refreshTimer);
      if (bridge) { await bridge.shutdownBridge(); bridge = null; }
      app.exit(exitCode);
    }
  }).catch(error => { console.error(error); app.exit(1); });
}
