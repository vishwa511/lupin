'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeWav, resample } = require('../src/main/audio');

test('encodeWav writes a 16-bit mono PCM header and samples', () => {
  // Arrange
  const samples = new Float32Array([0, 1, -1, 0.5]);

  // Act
  const wav = encodeWav(samples, 16000);

  // Assert
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 1, 'mono');
  assert.equal(wav.readUInt32LE(24), 16000, 'sample rate');
  assert.equal(wav.readUInt16LE(34), 16, 'bits per sample');
  assert.equal(wav.readUInt32LE(40), samples.length * 2, 'data size');
  assert.equal(wav.length, 44 + samples.length * 2);
  assert.deepEqual(
    [0, 1, 2, 3].map((i) => wav.readInt16LE(44 + i * 2)),
    [0, 32767, -32768, 16384],
  );
});

test('encodeWav clamps out-of-range samples', () => {
  const wav = encodeWav(new Float32Array([2, -3]), 16000);

  assert.equal(wav.readInt16LE(44), 32767);
  assert.equal(wav.readInt16LE(46), -32768);
});

test('resample returns the same samples when rates match', () => {
  const samples = new Float32Array([0.1, 0.2, 0.3]);

  const out = resample(samples, 16000, 16000);

  assert.deepEqual(Array.from(out), Array.from(samples));
});

test('resample 48k to 16k keeps duration and does not mutate input', () => {
  const samples = new Float32Array(48000).map((_, i) => i / 48000);
  const copy = Float32Array.from(samples);

  const out = resample(samples, 48000, 16000);

  assert.equal(out.length, 16000);
  assert.ok(Math.abs(out[8000] - 0.5) < 0.001);
  assert.deepEqual(samples, copy);
});

test('resample rejects invalid rates', () => {
  assert.throws(() => resample(new Float32Array(4), 0, 16000), /sample rate/);
});
