const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shopAPI', {
  load: () => ipcRenderer.invoke('store:load'),
  save: (data) => ipcRenderer.invoke('store:save', data),
  paths: () => ipcRenderer.invoke('app:paths'),
  version: () => ipcRenderer.invoke('app:version'),
  exportCsv: (payload) => ipcRenderer.invoke('export:csv', payload),
  exportPdf: (payload) => ipcRenderer.invoke('export:pdf', payload),
  exportBackup: (payload) => ipcRenderer.invoke('export:backup', payload),
  importBackup: () => ipcRenderer.invoke('import:backup'),
  openDataFolder: () => ipcRenderer.invoke('open:dataFolder')
});
