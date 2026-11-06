const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('promptpackBridge', {
  status: () => ipcRenderer.invoke('bridge:status'),
  retry: () => ipcRenderer.invoke('bridge:retry'),
  help: key => ipcRenderer.invoke('bridge:help', key),
  launchAtLogin: enabled => ipcRenderer.invoke('bridge:login', enabled),
  quit: () => ipcRenderer.invoke('bridge:quit'),
  onStatus: handler => {
    const listener = (_event, status) => handler(status);
    ipcRenderer.on('bridge:status', listener);
    return () => ipcRenderer.removeListener('bridge:status', listener);
  },
});
