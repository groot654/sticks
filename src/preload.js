const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sticks', {
  load: () => ipcRenderer.invoke('store:load'),
  save: (doc) => ipcRenderer.send('store:save', doc),
  setIgnoreMouse: (ignore) => ipcRenderer.send('mouse:ignore', ignore),
  onCommand: (fn) => ipcRenderer.on('cmd', (_e, cmd) => fn(cmd)),
});
