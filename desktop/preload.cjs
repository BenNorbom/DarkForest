const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopUpdates', {
  action: (action) => ipcRenderer.invoke('updates:action', action),
  onState: (listener) => {
    ipcRenderer.on('updates:state', (_event, update) => listener(update));
  },
});
