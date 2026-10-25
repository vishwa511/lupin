'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createRecorderBridge, toFloat32 } = require('../src/main/recorderBridge');

/** Fake ipcMain + recorder window: replies to each request the way recorder.js does. */
function setup(reply) {
  const ipcMain = new EventEmitter();
  const sent = [];
  const webContents = {
    isDestroyed: () => false,
    send: (channel, id) => {
      sent.push(channel);
      queueMicrotask(() => reply(channel, id, (replyChannel, ...args) => ipcMain.emit(replyChannel, {}, id, ...args)));
    },
  };
  const bridge = createRecorderBridge({ ipcMain, getWebContents: () => webContents });
  return { bridge, sent };
}

test('start resolves when the recorder confirms', async () => {
  const { bridge, sent } = setup((_channel, _id, respond) => respond('recorder:started'));

  await bridge.start();

  assert.deepEqual(sent, ['recorder:start']);
});

test('start rejects with the recorder error message', async () => {
  const { bridge } = setup((_channel, _id, respond) => respond('recorder:failed', 'Microphone unavailable: denied'));

  await assert.rejects(bridge.start(), /Microphone unavailable: denied/);
});

test('stop returns Float32 samples and the sample rate', async () => {
  const samples = new Float32Array([0.25, -0.5, 1]);
  const { bridge } = setup((_channel, _id, respond) => respond('recorder:audio', samples.buffer, 48000));

  const audio = await bridge.stop();

  assert.deepEqual(Array.from(audio.samples), [0.25, -0.5, 1]);
  assert.equal(audio.sampleRate, 48000);
});

test('replies for an unknown request id are ignored', () => {
  const ipcMain = new EventEmitter();
  createRecorderBridge({ ipcMain, getWebContents: () => null });

  assert.doesNotThrow(() => ipcMain.emit('recorder:started', {}, 999));
});

test('requests fail fast when the recorder window is gone', async () => {
  const bridge = createRecorderBridge({ ipcMain: new EventEmitter(), getWebContents: () => null });

  await assert.rejects(bridge.start(), /not available/);
});

test('toFloat32 handles a Buffer view at an unaligned offset', () => {
  const floats = new Float32Array([0.5, -0.25]);
  const padded = Buffer.concat([Buffer.from([7]), Buffer.from(floats.buffer)]);
  const view = padded.subarray(1);

  assert.deepEqual(Array.from(toFloat32(view)), [0.5, -0.25]);
});
