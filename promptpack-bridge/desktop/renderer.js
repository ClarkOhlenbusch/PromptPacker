const api = window.promptpackBridge;
const element = id => document.getElementById(id);

function render(status) {
  const ready = status.phase === 'ready';
  const failed = status.phase === 'error';
  element('title').textContent = ready ? 'Ready for Colab' : failed ? 'Bridge needs attention' : 'Starting your bridge…';
  element('message').textContent = status.message;
  element('status-icon').textContent = ready ? '✓' : failed ? '!' : '…';
  element('status-icon').className = `status-icon ${ready ? 'ready' : failed ? 'error' : ''}`;
  element('retry').hidden = !failed;
  element('colab').hidden = !ready;
  element('agents').hidden = !ready;
  element('version').textContent = `Version ${status.version}`;
  element('login-option').hidden = !status.supportsLogin;
  if (status.launchAtLogin !== undefined) element('login').checked = status.launchAtLogin;
  element('background-note').textContent = ready
    ? status.supportsLogin ? 'You can close this window. Bridge stays in your menu bar or system tray.' : 'Keep this window open or minimized while using Agent Terminal.'
    : 'Keep this app open while using Agent Terminal.';
  for (const agent of ['codex', 'claude']) {
    element(`${agent}-status`).textContent = status.agents?.[agent] ? 'Installed' : 'Not found';
    element(`${agent}-help`).hidden = !!status.agents?.[agent];
  }
}

api.onStatus(render);
api.status().then(render);
element('retry').onclick = () => api.retry();
element('colab').onclick = () => api.help('colab');
element('codex-help').onclick = () => api.help('codex');
element('claude-help').onclick = () => api.help('claude');
element('login').onchange = event => api.launchAtLogin(event.target.checked);
element('quit').onclick = () => api.quit();
