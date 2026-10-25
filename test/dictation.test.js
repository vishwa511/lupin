'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDictationController } = require('../src/main/dictation');

function setup({ transcript = 'hello world', startDelay = 0, clockSteps = [0, 1000] } = {}) {
  const calls = [];
  const statuses = [];
  const clockValues = [...clockSteps];
  let resolveStart;
  const recorder = {
    start: () => {
      calls.push('start');
      if (startDelay === 'manual') {
        return new Promise((resolve) => { resolveStart = resolve; });
      }
      return Promise.resolve();
    },
    stop: async () => { calls.push('stop'); return { samples: new Float32Array(16000), sampleRate: 16000 }; },
    cancel: async () => { calls.push('cancel'); },
  };
  const controller = createDictationController({
    recorder,
    transcribe: async () => { calls.push('transcribe'); return transcript; },
    insertText: async (text) => { calls.push(`insert:${text}`); },
    showStatus: (status) => statuses.push(status),
    clock: () => (clockValues.length > 1 ? clockValues.shift() : clockValues[0]),
    minHoldMs: 250,
    log: { warn() {}, error() {} },
  });
  return { controller, calls, statuses, resolveStart: () => resolveStart() };
}

test('press and release records, transcribes and inserts the text', async () => {
  const { controller, calls, statuses } = setup();

  await controller.fnDown();
  await controller.fnUp();

  assert.deepEqual(calls, ['start', 'stop', 'transcribe', 'insert:hello world']);
  assert.deepEqual(statuses, ['listening', 'transcribing', 'idle']);
  assert.equal(controller.state(), 'idle');
});

test('a tap shorter than the minimum hold is discarded', async () => {
  const { controller, calls, statuses } = setup({ clockSteps: [0, 100] });

  await controller.fnDown();
  await controller.fnUp();

  assert.deepEqual(calls, ['start', 'stop']);
  assert.deepEqual(statuses, ['listening', 'idle']);
});

test('empty transcript inserts nothing', async () => {
  const { controller, calls } = setup({ transcript: '' });

  await controller.fnDown();
  await controller.fnUp();

  assert.deepEqual(calls, ['start', 'stop', 'transcribe']);
});

test('Fn used as a modifier (chord) cancels the recording', async () => {
  const { controller, calls, statuses } = setup();

  await controller.fnDown();
  await controller.cancel();
  await controller.fnUp();

  assert.deepEqual(calls, ['start', 'cancel']);
  assert.deepEqual(statuses, ['listening', 'idle']);
});

test('release while the microphone is still starting finishes once it starts', async () => {
  const { controller, calls, resolveStart } = setup({ startDelay: 'manual' });

  const down = controller.fnDown();
  const up = controller.fnUp();
  resolveStart();
  await down;
  await up;

  assert.deepEqual(calls, ['start', 'stop', 'transcribe', 'insert:hello world']);
});

test('a second press while transcribing is ignored', async () => {
  const { controller, calls } = setup();

  await controller.fnDown();
  const finishing = controller.fnUp();
  await controller.fnDown();
  await finishing;

  assert.equal(calls.filter((c) => c === 'start').length, 1);
});

test('transcription failure reports an error and returns to idle', async () => {
  const statuses = [];
  const controller = createDictationController({
    recorder: { start: async () => {}, stop: async () => ({ samples: new Float32Array(1), sampleRate: 16000 }), cancel: async () => {} },
    transcribe: async () => { throw new Error('whisper-cli not found'); },
    insertText: async () => {},
    showStatus: (status, detail) => statuses.push(detail ? `${status}:${detail}` : status),
    clock: (() => { const v = [0, 1000]; return () => v.shift() ?? 1000; })(),
    log: { warn() {}, error() {} },
  });

  await controller.fnDown();
  await controller.fnUp();

  assert.deepEqual(statuses, ['listening', 'transcribing', 'error:whisper-cli not found']);
  assert.equal(controller.state(), 'idle');
});
