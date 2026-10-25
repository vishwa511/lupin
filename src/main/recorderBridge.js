'use strict';

const START_TIMEOUT_MS = 5000;
const STOP_TIMEOUT_MS = 5000;

/** Copies IPC-delivered bytes into an aligned Float32Array (IPC may hand back a Buffer view). */
function toFloat32(data) {
  if (data instanceof Float32Array) {
    return Float32Array.from(data);
  }
  const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data);
  return new Float32Array(Uint8Array.from(bytes).buffer);
}

/**
 * Main-process side of the hidden recorder window: start/stop/cancel as promises.
 * Each request carries an id so late replies from an earlier request are ignored.
 */
function createRecorderBridge({ ipcMain, getWebContents }) {
  const pending = new Map();
  let nextId = 1;

  function request(channel, timeoutMs) {
    const webContents = getWebContents();
    if (!webContents || webContents.isDestroyed()) {
      return Promise.reject(new Error('Recorder window is not available'));
    }
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Recorder did not respond to ${channel}`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      webContents.send(channel, id);
    });
  }

  function settle(id, outcome, value) {
    const entry = pending.get(id);
    if (!entry) {
      return;
    }
    pending.delete(id);
    clearTimeout(entry.timer);
    entry[outcome](value);
  }

  ipcMain.on('recorder:started', (_event, id) => settle(id, 'resolve'));
  ipcMain.on('recorder:failed', (_event, id, message) => settle(id, 'reject', new Error(message)));
  ipcMain.on('recorder:audio', (_event, id, data, sampleRate) => {
    settle(id, 'resolve', { samples: toFloat32(data), sampleRate });
  });

  return {
    start: () => request('recorder:start', START_TIMEOUT_MS),
    stop: () => request('recorder:stop', STOP_TIMEOUT_MS),
    cancel: async () => {
      getWebContents()?.send('recorder:cancel');
    },
  };
}

module.exports = { createRecorderBridge, toFloat32 };
