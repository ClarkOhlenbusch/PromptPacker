const assert = require('node:assert/strict');
const { WebSocket } = require('ws');

module.exports = async status => {
  assert.equal(status.terminalBackend, 'native', 'Packaged app must not depend on Python');
  const ws = new WebSocket(`ws://127.0.0.1:${status.port}`);
  const pending = new Map();
  let next = 0;
  let output = '';
  const request = (type, payload) => new Promise((resolve, reject) => {
    const requestId = `smoke_${++next}`;
    const timer = setTimeout(() => reject(new Error(`Timed out: ${type}`)), 8000);
    pending.set(requestId, message => { clearTimeout(timer); resolve(message); });
    ws.send(JSON.stringify({ type, payload, requestId }));
  });
  ws.on('message', raw => {
    const message = JSON.parse(raw.toString());
    const handle = pending.get(message.replyTo);
    if (handle) { pending.delete(message.replyTo); handle(message); }
    if (message.type === 'terminal_output') output += message.payload.data;
  });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  let session;
  try {
    const command = process.platform === 'win32'
      ? `"${process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe'}" /d /c "echo packaged-pty-ready & timeout /t 30 >NUL"`
      : `/bin/sh -c 'printf packaged-pty-ready; read value'`;
    const started = await request('session_start', { notebook: { title: 'Packaged bridge smoke test' }, cells: [], agent: { kind: 'custom', command } });
    assert.equal(started.type, 'session_started', started.payload?.message);
    session = started.payload;
    const deadline = Date.now() + 8000;
    while (!output.includes('packaged-pty-ready')) {
      assert.ok(Date.now() < deadline, 'Native terminal did not stream output');
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  } finally {
    if (session) await request('session_stop', { sessionId: session.sessionId });
    ws.close();
  }
};
