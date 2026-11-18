'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// L'interfaccia (journal-ui) parla con i dati solo tramite queste tre funzioni.
contextBridge.exposeInMainWorld('localStore', {
  invoke: (method, args) => ipcRenderer.invoke('core', method, args),
  onChange: (cb) => { ipcRenderer.on('store-changed', () => cb()); },
  onProgress: (cb) => { const h = (_e, t) => cb(t); ipcRenderer.on('import-progress', h); return () => ipcRenderer.removeListener('import-progress', h); },
});
