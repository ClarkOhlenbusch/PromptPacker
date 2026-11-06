// Isolated browser integration check. Uses Chrome, a fixture notebook, and a
// dummy agent; never connects to the user's running bridge or notebook.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { chromium } = require('playwright');

const project = path.resolve(__dirname, '..');
const bridgeScript = path.resolve(project, '../promptpack-bridge/src/server.js');

async function main() {
  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'promptpack-workflow-proof-'));
  const extensionPath = path.join(output, 'extension');
  execFileSync(process.execPath, [path.join(project, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', extensionPath], { cwd: project, stdio: 'pipe' });
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const bundlePath = path.join(extensionPath, 'assets/index.js');
  const bundle = await fs.readFile(bundlePath, 'utf8');
  assert.ok(bundle.includes('ws://127.0.0.1:47123'));
  await fs.writeFile(bundlePath, bundle.replaceAll('ws://127.0.0.1:47123', `ws://127.0.0.1:${port}`));
  const agentPath = path.join(output, 'dummy-agent.py');
  await fs.writeFile(agentPath, `from pathlib import Path
import sys
print("Test agent ready", flush=True)
for line in sys.stdin:
    if line.strip() == "edit":
        Path("notebook/Cell_1_cell_0.md").write_text("This is a test.\\nOriginal first cell")
        print("Saved first edit", flush=True)
`);
  const bridge = spawn(process.execPath, [bridgeScript], {
    env: { ...process.env, PROMPTPACK_BRIDGE_PORT: String(port), PROMPTPACK_BRIDGE_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let browser;
  let page;
  let panel;
  const socketEvents = [];
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Bridge startup timed out')), 5000);
      bridge.once('error', reject);
      bridge.stdout.on('data', data => {
        if (data.toString().includes('PromptPack Bridge listening')) { clearTimeout(timeout); resolve(); }
      });
    });
    const context = await chromium.launchPersistentContext(path.join(output, 'profile'), { channel: 'chrome', headless: true, viewport: { width: 1440, height: 1000 }, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'] });
    browser = context.browser();
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', { path: extensionPath });
    await context.route('https://api.github.com/repos/ClarkOhlenbusch/PromptPacker/releases?per_page=30', route => route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify([{
        tag_name: 'bridge-v0.2.0', draft: false, prerelease: false, html_url: 'https://example.com/bridge-release',
        assets: ['mac-universal.dmg', 'windows-x64-Setup.exe', 'linux-x64.AppImage', 'linux-arm64.AppImage'].map(name => ({ name: `PromptPack-Bridge-0.2.0-${name}`, browser_download_url: `https://example.com/PromptPack-Bridge-0.2.0-${name}` })),
      }]),
    }));
    const healthUrl = `http://127.0.0.1:${port}/health`;
    await context.route(healthUrl, route => route.fulfill({ contentType: 'application/json', body: '{"ok":false}' }));
    await context.route('https://colab.research.google.com/**', route => route.fulfill({
      contentType: 'text/html; charset=utf-8', body: `<!doctype html><meta charset="utf-8"><title>PromptPack fixture notebook</title>
        <style>body{margin:0;font:16px system-ui;background:#f8fafc;color:#172033}header{padding:24px;background:white;border-bottom:1px solid #ddd}main{padding:32px;width:650px}colab-cell{display:block;padding:24px;background:white;border:1px solid #ddd;border-radius:10px;margin:24px 0}pre{white-space:pre-wrap}button{padding:8px}</style>
        <header>Colab · Fixture notebook</header><main><h1>Notebook</h1><button id="notebook-action" onclick="this.textContent='Notebook remains interactive'">Use notebook</button><colab-cell><h3>Cell 1 · Markdown</h3><pre id="cell0">Original first cell</pre></colab-cell><colab-cell><h3>Cell 2 · Python</h3><pre>print('original')</pre></colab-cell></main>
        <script>
          window.models = ['Original first cell', "print('original')"].map((content, i) => ({
            content, uri: { scheme: 'inmemory', path: '/'+i, toString(){ return 'inmemory:///'+i; } },
            getLanguageId(){ return i === 0 ? 'markdown' : 'python'; },
            getValue(){ return this.content; }, getValueLength(){ return this.content.length; },
            getLineCount(){ return this.content.split('\\n').length; },
            setValue(value){ this.content=value; if(i===0) document.getElementById('cell0').textContent=value; },
            pushStackElement(){}
          }));
          window.monaco = { editor: { getModels: () => window.models, getEditors: () => [] } };
          const nativeCell = (id, model) => ({ getId: () => id, getTextModel: () => model, setText: value => model.setValue(value) });
          window.nativeCells = window.models.map((model, i) => nativeCell('fixture_'+i, model));
          const notebookModel = {
            getCells: () => window.nativeCells,
            createCellFromJson(json) {
              const model = { content: json.source, uri: { scheme: 'inmemory', path: '/'+window.models.length },
                getLanguageId: () => json.cell_type === 'markdown' ? 'markdown' : 'python',
                getValue(){ return this.content; }, getValueLength(){ return this.content.length; },
                getLineCount(){ return this.content.split('\\n').length; },
                setValue(value){ this.content=value; document.getElementById(json.metadata.id).textContent=value; }, pushStackElement(){} };
              return nativeCell(json.metadata.id, model);
            }
          };
          window.colab = { global: { notebookModel, notebook: {
            isEditable: () => true,
            addNewCell(type, index, cell) {
              window.nativeCells.splice(index, 0, cell);
              window.models.splice(index, 0, cell.getTextModel());
              const element = document.createElement('colab-cell');
              const text = document.createElement('pre'); text.id=cell.getId(); text.textContent=cell.getTextModel().getValue();
              element.appendChild(text); document.querySelector('main').appendChild(element);
              return cell.getId();
            }
          } } };
        </script>`,
    }));
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    let session;
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('Page error:', error.message); });
    page.on('websocket', socket => socket.on('framereceived', event => {
      try {
        const message = JSON.parse(event.payload.toString());
        if (message.type === 'session_started') session = message.payload;
      } catch {}
    }));
    page.on('websocket', socket => {
      socketEvents.push({ event: 'open', url: socket.url() });
      socket.on('socketerror', error => socketEvents.push({ event: 'error', error }));
      socket.on('close', () => socketEvents.push({ event: 'close' }));
    });
    page.on('console', message => {
      if (message.type() === 'error') console.error('Browser console:', message.text());
    });
    await page.goto('https://colab.research.google.com/drive/promptpack-workflow-test');
    await page.waitForSelector('#promptpack-injected-script', { state: 'attached' });
    await page.keyboard.press('Alt+Shift+p');
    panel = page.frameLocator('#promptpack-overlay-container iframe');
    await panel.getByRole('button', { name: 'Agent Terminal' }).click();
    await panel.getByRole('heading', { name: 'Get PromptPack Bridge' }).waitFor();
    await panel.locator('a[href^="https://example.com/PromptPack-Bridge-"]').waitFor();
    assert.equal(await panel.getByRole('button', { name: 'Start session' }).isDisabled(), true);
    await context.unroute(healthUrl);
    await panel.getByRole('button', { name: 'Check again' }).click();
    await panel.getByRole('heading', { name: 'Get PromptPack Bridge' }).waitFor({ state: 'hidden' });
    await panel.locator('body').evaluate(() => {
      window.proofClicks = [];
      for (const event of ['pointerdown', 'pointerup', 'click']) document.addEventListener(event, e => window.proofClicks.push({ event, target: e.target.closest('button')?.innerText || e.target.tagName, x: e.clientX, y: e.clientY }), true);
    });
    await panel.locator('select').selectOption('custom');
    await panel.getByRole('textbox', { name: 'Agent command' }).fill(`python3 ${agentPath}`);
    await panel.getByRole('button', { name: 'Start session' }).click();
    await panel.getByRole('status', { name: 'Session running' }).waitFor();
    await panel.locator('.xterm-helper-textarea').focus();
    await page.keyboard.type('edit');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.getElementById('cell0').textContent === 'This is a test.\nOriginal first cell');
    await panel.locator('details[data-agent-history] > summary').waitFor();
    assert.equal(await panel.getByText('Refresh notebook context', { exact: true }).isVisible(), false);
    assert.equal(await panel.getByRole('combobox').count(), 0);
    assert.ok(session?.workspacePath, 'Session state not observed over WebSocket');
    assert.equal(await panel.getByRole('button', { name: 'Apply', exact: true }).count(), 0);
    const terminal = await panel.locator('.xterm').elementHandle();
    const frameNode = await page.locator('#promptpack-overlay-container iframe').elementHandle();
    await page.locator('#promptpack-overlay-container').evaluate(element => { window.originalOverlay = element; });
    await panel.getByRole('button', { name: 'Hide PromptPack — your agent keeps running' }).click();
    await page.getByRole('button', { name: 'Use notebook' }).click();
    const cellFile = path.join(session.workspacePath, 'notebook/Cell_1_cell_0.md');
    await fs.writeFile(cellFile, 'Synced while panel was hidden');
    await page.waitForFunction(() => document.getElementById('cell0').textContent === 'Synced while panel was hidden');
    await page.getByRole('button', { name: 'Open PromptPack', exact: true }).click();
    assert.ok(await frameNode.evaluate(element => element.isConnected), 'Iframe was destroyed');
    assert.ok(await terminal.evaluate(element => element.isConnected), 'Terminal was destroyed');
    assert.ok(await page.evaluate(() => document.getElementById('promptpack-overlay-container') === window.originalOverlay));
    await panel.getByRole('button', { name: 'Prompt Builder' }).click();
    await panel.getByRole('button', { name: 'Agent Terminal' }).click();
    assert.ok(await terminal.evaluate(element => element.isConnected), 'Switching tabs destroyed the terminal');
    const history = panel.locator('details[data-agent-history]');
    await history.locator(':scope > summary').click();
    await history.locator('details').first().locator('summary').click();
    await history.locator('details').first().locator('pre').first().waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(output, 'docked-auto-sync.png'), fullPage: true });
    const newCells = path.join(session.workspacePath, 'notebook/new_cells');
    await fs.writeFile(path.join(newCells, '01_new.py'), "print('created through the bridge')");
    await fs.writeFile(path.join(newCells, '02_new.md'), '# A new Markdown cell');
    await page.waitForFunction(() => window.models.length === 4 && window.models[2].getValue() === "print('created through the bridge')" && window.models[3].getValue() === '# A new Markdown cell');
    await fs.writeFile(path.join(newCells, '01_new.py'), "print('updated the new cell')");
    await page.waitForFunction(() => window.models[2].getValue() === "print('updated the new cell')");
    assert.equal(await page.locator('main colab-cell').count(), 4, 'A later edit duplicated the new cell');
    await page.evaluate(() => window.models[0].setValue('Manual edit in Colab'));
    await fs.writeFile(cellFile, 'Conflicting agent edit');
    await panel.getByText('Needs attention', { exact: true }).waitFor();
    assert.equal(await page.locator('#cell0').textContent(), 'Manual edit in Colab');
    assert.equal(await fs.readFile(cellFile, 'utf8'), 'Conflicting agent edit');
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log(JSON.stringify({ passed: true, browser: await browser.version(), fixtureNotebook: true, dummyAgent: true,
      autoSyncWithoutApply: true, hiddenSync: true, sameIframeAndTerminal: true, tabSwitchPreservesTerminal: true,
      singleStartAction: true, routineControlsHidden: true,
      bridgeSetupAndDiscovery: true,
      autoAppendCodeAndMarkdown: true, subsequentNewCellEdit: true,
      notebookRemainsInteractive: true, conflictPreservesBothVersions: true,
      screenshot: path.join(output, 'docked-auto-sync.png') }, null, 2));
  } catch (error) {
    console.error('Socket events:', socketEvents);
    if (panel) console.error('Clicks:', await panel.locator('body').evaluate(() => window.proofClicks).catch(() => []));
    if (page) await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
    console.error('Diagnostic files:', output);
    throw error;
  } finally {
    if (panel) await panel.getByRole('button', { name: 'Stop session' }).click({ timeout: 1000 }).catch(() => {});
    await browser?.close();
    if (bridge.exitCode === null) { const exited = once(bridge, 'close'); bridge.kill(); await exited; }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
