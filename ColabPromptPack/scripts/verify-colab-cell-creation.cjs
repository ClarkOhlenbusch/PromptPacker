// Runs against the real Colab frontend in a fresh, signed-out Chrome profile.
// Uses a public sample's UNSAVED local copy; never opens a user's Drive notebook.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const { chromium } = require('playwright');
const { WebSocket } = require('../../promptpack-bridge/node_modules/ws');

async function main() {
  const project = path.resolve(__dirname, '..');
  const output = process.env.PROMPTPACK_CANARY_ARTIFACTS || await fs.mkdtemp(path.join(os.tmpdir(), 'promptpack-live-creation-'));
  await fs.mkdir(output, { recursive: true });
  const extensionPath = path.join(output, 'extension');
  execFileSync(process.execPath, [path.join(project, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', extensionPath], { cwd: project, stdio: 'pipe' });
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const bridge = spawn(process.execPath, [path.resolve(project, '../promptpack-bridge/src/server.js')], {
    env: { ...process.env, PROMPTPACK_BRIDGE_PORT: String(port), PROMPTPACK_BRIDGE_TOKEN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let context, ws, session, page;
  let chain = Promise.resolve();
  let chainError;
  const proposals = [];
  const results = [];
  const pending = new Map();
  let requestId = 0;
  function request(type, payload) {
    const id = `proof_${++requestId}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${type} timed out`)); }, 10000);
      pending.set(id, message => { clearTimeout(timer); message.type === 'error' ? reject(new Error(message.payload.message)) : resolve(message.payload); });
      ws.send(JSON.stringify({ type, payload, requestId: id }));
    });
  }
  async function pageCommand(type, responseType, payload) {
    return page.evaluate(({ type, responseType, payload }) => new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => { window.removeEventListener('message', listener); reject(new Error(`${type} timed out`)); }, 10000);
      function listener(event) {
        if (event.source !== window || event.data?.type !== responseType) return;
        if (event.data.requestId !== undefined && event.data.requestId !== requestId) return;
        clearTimeout(timer); window.removeEventListener('message', listener);
        resolve(event.data.payload ?? event.data.cells);
      }
      window.addEventListener('message', listener);
      window.postMessage({ type, requestId, payload }, location.origin);
    }), { type, responseType, payload });
  }
  async function waitUntil(condition, description) {
    const deadline = Date.now() + 20000;
    while (!condition()) {
      if (chainError) throw chainError;
      if (Date.now() > deadline) throw new Error(`Timed out: ${description}`);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    await chain;
    if (chainError) throw chainError;
  }
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Bridge startup timed out')), 10000);
      bridge.once('error', reject);
      bridge.stdout.on('data', data => { if (data.toString().includes('PromptPack Bridge listening')) { clearTimeout(timer); resolve(); } });
    });
    context = await chromium.launchPersistentContext(path.join(output, 'profile'), {
      channel: 'chrome', headless: true, viewport: { width: 1400, height: 1000 },
      ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'],
    });
    const cdp = await context.browser().newBrowserCDPSession();
    await cdp.send('Extensions.loadUnpacked', { path: extensionPath });
    page = await context.newPage();
    page.on('pageerror', error => console.error('Colab page error:', error.message));
    page.on('console', message => {
      if (/PromptPack/.test(message.text())) console.error(message.text());
      if (message.type() === 'error' && /injected|extension|script|trusted/i.test(message.text())) console.error('Colab console:', message.text());
    });
    await page.goto('https://colab.research.google.com/notebooks/intro.ipynb', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.colab?.global?.notebookModel?.getCells()?.length > 0, { timeout: 45000 });
    assert.equal(await page.evaluate(() => window.colab.global.notebookModel.saveable()), false, 'Refusing to modify a backed notebook');
    await pageCommand('PROMPTPACK_PING', 'PROMPTPACK_INJECTED_READY');
    const cells = await pageCommand('PROMPTPACK_REQUEST_CELLS', 'PROMPTPACK_RESPONSE_CELLS');
    assert.ok(cells.length > 0 && cells.every(cell => cell.cellId), 'Missing persistent notebook identities');
    const originalCount = cells.length;
    const originalFirst = cells[0];
    ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('message', data => {
      const message = JSON.parse(data.toString());
      if (message.replyTo) { pending.get(message.replyTo)?.(message); pending.delete(message.replyTo); }
      if (message.type === 'agent_run_proposed') {
        chain = chain.then(async () => {
          const result = await pageCommand('PROMPTPACK_EXECUTE_CELLS', 'PROMPTPACK_EXECUTION_RESULT', message.payload.command);
          ws.send(JSON.stringify({ type: 'agent_run_result', payload: { sessionId: session.sessionId, proposalId: message.payload.proposalId, result } }));
        }).catch(error => { chainError = error; });
      }
      if (message.type === 'agent_patch_proposed') {
        proposals.push(message.payload);
        chain = chain.then(async () => {
          const result = await pageCommand('PROMPTPACK_APPLY_CELL_UPDATES', 'PROMPTPACK_APPLY_RESULT', { updates: message.payload.updates });
          results.push({ proposal: message.payload, result });
          ws.send(JSON.stringify({ type: 'agent_patch_apply_result', payload: { sessionId: session.sessionId, proposalId: message.payload.proposalId, result } }));
          assert.ok(result.success, JSON.stringify({ proposal: message.payload, result }));
        }).catch(error => { chainError = error; });
      }
    });
    await once(ws, 'open');
    session = await request('session_start', {
      notebook: { title: 'Isolated live cell creation proof' },
      cells: cells.map(cell => ({ path: cell.path, cellId: cell.cellId, relativePath: cell.relative_path, content: cell.content, cellType: cell.cellType })),
      agent: { kind: 'custom', command: `"${process.execPath}" "${path.resolve(project, '../promptpack-bridge/test/echo-agent.cjs')}"` },
    });
    const newDir = path.join(session.workspacePath, 'notebook/new_cells');
    const code = '# PromptPack live creation proof\nprint("new final cell")';
    const markdown = '### PromptPack creation proof\nA new Markdown cell.';
    await fs.writeFile(path.join(newDir, '01_proof.py'), code);
    await fs.writeFile(path.join(newDir, '02_notes.md'), markdown);
    await waitUntil(() => results.filter(entry => entry.result.success).flatMap(entry => entry.proposal.updates).length === 2, 'two new cells');
    const creations = proposals.flatMap(proposal => proposal.updates);
    assert.equal(creations.length, 2);
    assert.deepEqual(creations.map(update => update.cellType), ['code', 'markdown']);
    let exported = await page.evaluate(() => window.colab.global.notebookModel.getIpynbJson());
    assert.equal(exported.cells.length, originalCount + 2);
    assert.equal(exported.cells.at(-2).source.join(''), code);
    assert.equal(exported.cells.at(-1).source.join(''), markdown);
    const replay = await pageCommand('PROMPTPACK_APPLY_CELL_UPDATES', 'PROMPTPACK_APPLY_RESULT', { updates: creations });
    assert.ok(replay.success, JSON.stringify(replay));
    assert.equal(await page.evaluate(() => window.colab.global.notebookModel.getCells().length), originalCount + 2);
    // Move the new code cell: the following saved edit must follow its ID.
    await page.evaluate(id => {
      const model = window.colab.global.notebookModel;
      model.moveCells(undefined, [model.getCells().find(cell => cell.getId() === id)]);
    }, creations[0].cellId);
    const edited = `${code}\n# edited after moving the cell`;
    await fs.writeFile(path.join(newDir, '01_proof.py'), edited);
    await waitUntil(() => results.some(entry => entry.proposal.updates.some(update => update.newContent === edited)), 'edit after reorder');
    assert.equal(await page.evaluate(id => window.colab.global.notebookModel.getCells().find(cell => cell.getId() === id).getText(), creations[0].cellId), edited);
    assert.equal(await page.evaluate(id => window.colab.global.notebookModel.getCells().find(cell => cell.getId() === id).getText(), originalFirst.cellId), originalFirst.content);
    // Export, reload the real frontend, then re-import the saved JSON. This
    // checks notebook serialization/identity; it does not claim a Drive save.
    exported = await page.evaluate(() => window.colab.global.notebookModel.getIpynbJson());
    const notebookFile = path.join(output, 'creation-proof.ipynb');
    await fs.writeFile(notebookFile, JSON.stringify(exported, null, 2));
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.colab?.global?.notebookModel?.getCells()?.length > 0, { timeout: 45000 });
    await pageCommand('PROMPTPACK_PING', 'PROMPTPACK_INJECTED_READY');
    await page.evaluate(json => window.colab.global.notebookModel.fillFromJson(json), JSON.parse(await fs.readFile(notebookFile, 'utf8')));
    const afterReload = `${edited}\n# edited after export and reload`;
    await fs.writeFile(path.join(newDir, '01_proof.py'), afterReload);
    await waitUntil(() => results.some(entry => entry.proposal.updates.some(update => update.newContent === afterReload)), 'edit after export/reload/import');
    assert.equal(await page.evaluate(id => window.colab.global.notebookModel.getCells().find(cell => cell.getId() === id).getText(), creations[0].cellId), afterReload);
    assert.equal(await page.evaluate(() => window.colab.global.notebookModel.getCells().length), originalCount + 2);
    const commandDir = path.join(session.workspacePath, 'notebook/.promptpack/commands');
    async function command(name, action) {
      const response = path.join(commandDir, `${name}.result.json`);
      await fs.writeFile(path.join(commandDir, `${name}.json`), JSON.stringify(action));
      let value;
      const deadline = Date.now() + 20000;
      while (!value && Date.now() < deadline) {
        if (chainError) throw chainError;
        value = await fs.readFile(response, 'utf8').catch(() => null);
        if (!value) await new Promise(resolve => setTimeout(resolve, 100));
      }
      assert.ok(value, `Timed out waiting for ${name}`);
      const result = JSON.parse(value);
      assert.ok(result.applied || result.status === "ok", JSON.stringify(result));
      return result;
    }
    await command('01_move', { action: 'move', cell: creations[0].cellPath, before: originalFirst.cellId });
    assert.equal(await page.evaluate(() => window.colab.global.notebookModel.getCells()[0].getId()), creations[0].cellId);
    const inspected = await command('02_inspect', { action: 'inspect', cell: creations[0].cellPath });
    assert.equal(inspected.outputs.length, 1);
    assert.equal(inspected.outputs[0].state, 'idle');
    await command('03_delete', { action: 'delete', cell: creations[1].cellPath });
    assert.equal(await page.evaluate(id => window.colab.global.notebookModel.getCells().some(c => c.getId() === id), creations[1].cellId), false);
    await page.evaluate(id => window.colab.global.notebook.getCells().find(cell => cell.getId() === id).getElement().scrollIntoView(), creations[0].cellId);
    await page.screenshot({ path: path.join(output, 'live-colab-created-cell.png') });
    console.log(JSON.stringify({ passed: true, realColabFrontend: true, isolatedSignedOutBrowser: true,
      codeAndMarkdownAppended: true, replayDoesNotDuplicate: true, editAfterReorder: true,
      exportReloadImportRoundTrip: true, editAfterReload: true, moveAndDelete: true, inspectOutput: true,
      connectedRuntimeTested: false, driveSaveTested: false,
      originalCellsPreserved: true, notebookFile, screenshot: path.join(output, 'live-colab-created-cell.png') }, null, 2));
  } catch (error) {
    console.error('Diagnostics:', output);
    if (page) {
      console.error(await page.evaluate(() => ({ url: location.href, injected: document.getElementById('promptpack-injected-script')?.outerHTML })));
      await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    }
    throw error;
  } finally {
    if (session && ws?.readyState === WebSocket.OPEN) await request('session_stop', { sessionId: session.sessionId }).catch(() => {});
    ws?.close();
    await context?.close();
    if (bridge.exitCode === null) { const closed = once(bridge, 'close'); bridge.kill(); await closed; }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
