'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lupineRecorder', {
  onStart: (callback) => ipcRenderer.on('recorder:start', (_event, id) => callback(id)),
  onStop: (callback) => ipcRenderer.on('recorder:stop', (_event, id) => callback(id)),
  onCancel: (callback) => ipcRenderer.on('recorder:cancel', () => callback()),
  started: (id) => ipcRenderer.send('recorder:started', id),
  failed: (id, message) => ipcRenderer.send('recorder:failed', id, String(message)),
  audio: (id, buffer, sampleRate) => ipcRenderer.send('recorder:audio', id, buffer, sampleRate),
});
