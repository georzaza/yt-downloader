'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  getState: () => ipcRenderer.invoke('app:getState'),
  ensureSetup: () => ipcRenderer.invoke('setup:ensure'),
  openInput: () => ipcRenderer.invoke('dialog:openInput'),
  chooseOutput: () => ipcRenderer.invoke('dialog:chooseOutput'),
  analyze: (payload) => ipcRenderer.invoke('analyze', payload),
  download: (payload) => ipcRenderer.invoke('download', payload),
  libraryStats: (dir) => ipcRenderer.invoke('library:stats', dir),
  loadState: (dir) => ipcRenderer.invoke('state:load', dir),
  saveState: (dir, items) => ipcRenderer.invoke('state:save', { dir, items }),
  checkFolder: (dir, items) => ipcRenderer.invoke('folder:check', { dir, items }),
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),

  on: (channel, cb) => {
    const allowed = ['setup:log', 'setup:progress', 'analyze:progress', 'download:progress'];
    if (!allowed.includes(channel)) return () => {};
    const listener = (_evt, data) => cb(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
});
