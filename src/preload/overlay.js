'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lupineOverlay', {
  onStatus: (callback) => ipcRenderer.on('overlay:status', (_event, status, detail) => callback(status, detail)),
});
