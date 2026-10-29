const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('blocks', {
  load: () => ipcRenderer.invoke('blocks:load'),
  submit: (score) => ipcRenderer.invoke('blocks:submit', score),
  close: () => ipcRenderer.send('blocks:close'),
});
