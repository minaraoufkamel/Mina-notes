// Exposes a narrow AI bridge to the page. No Node access, no API key.
const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();
ipcRenderer.on('ai:delta', (e, msg) => listeners.forEach((fn) => fn(msg)));

contextBridge.exposeInMainWorld('minaAI', {
  keyStatus: () => ipcRenderer.invoke('ai:keyStatus'),
  setKey: (key) => ipcRenderer.invoke('ai:setKey', key),
  clearKey: () => ipcRenderer.invoke('ai:clearKey'),
  count: (params) => ipcRenderer.invoke('ai:count', params),
  create: (params) => ipcRenderer.invoke('ai:create', params),
  stream: (id, params) => ipcRenderer.invoke('ai:stream', { id, params }),
  cancel: (id) => ipcRenderer.invoke('ai:cancel', id),
  onDelta: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
});
