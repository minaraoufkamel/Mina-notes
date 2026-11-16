// Exposes a narrow AI bridge to the page. No Node access, no API keys.
const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();
ipcRenderer.on('ai:delta', (e, msg) => listeners.forEach((fn) => fn(msg)));

contextBridge.exposeInMainWorld('minaAI', {
  keyStatus: (provider) => ipcRenderer.invoke('ai:keyStatus', provider),
  setKey: (provider, key) => ipcRenderer.invoke('ai:setKey', provider, key),
  clearKey: (provider) => ipcRenderer.invoke('ai:clearKey', provider),
  call: (id, provider, op, params) => ipcRenderer.invoke('ai:call', { id, provider, op, params }),
  cancel: (id) => ipcRenderer.invoke('ai:cancel', id),
  openrouterModels: () => ipcRenderer.invoke('ai:openrouterModels'),
  onDelta: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
});
