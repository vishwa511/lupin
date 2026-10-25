'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanTranscript, createTranscriber, isSilent, resolveWhisperCli } = require('../src/main/whisper');

test('cleanTranscript joins lines and trims whitespace', () => {
  assert.equal(cleanTranscript('  Hello there.\n  How are you?  \n'), 'Hello there. How are you?');
});

test('cleanTranscript drops Whisper non-speech markers', () => {
  assert.equal(cleanTranscript('[BLANK_AUDIO]\n'), '');
  assert.equal(cleanTranscript('(music) Hello [Music] world (inaudible)'), 'Hello world');
  assert.equal(cleanTranscript(' [ Silence ] '), '');
});

test('cleanTranscript tolerates empty input', () => {
  assert.equal(cleanTranscript(''), '');
  assert.equal(cleanTranscript(undefined), '');
});

test('isSilent flags near-silent audio and passes speech-level audio', () => {
  const silence = new Float32Array(16000);
  const hiss = new Float32Array(16000).map((_, i) => (i % 2 ? 0.0005 : -0.0005));
  const speech = new Float32Array(16000).map((_, i) => 0.1 * Math.sin(i / 10));

  assert.equal(isSilent(silence), true);
  assert.equal(isSilent(hiss), true);
  assert.equal(isSilent(speech), false);
});

test('transcribe returns empty text for silence without running Whisper', async () => {
  // Whisper hallucinates words like "you" on silent input, which would then get pasted.
  const transcribe = createTranscriber({ modelPath: __filename, cliPath: '/nonexistent/whisper-cli' });

  const text = await transcribe({ samples: new Float32Array(48000), sampleRate: 48000 });

  assert.equal(text, '');
});

test('resolveWhisperCli prefers the LUPINE_WHISPER_CLI override', () => {
  const found = resolveWhisperCli({ LUPINE_WHISPER_CLI: '/custom/whisper-cli' }, () => true);

  assert.equal(found, '/custom/whisper-cli');
});

test('resolveWhisperCli falls back to Homebrew locations', () => {
  const exists = (p) => p === '/usr/local/bin/whisper-cli';

  assert.equal(resolveWhisperCli({}, exists), '/usr/local/bin/whisper-cli');
});

test('resolveWhisperCli returns null when nothing is installed', () => {
  assert.equal(resolveWhisperCli({}, () => false), null);
});
