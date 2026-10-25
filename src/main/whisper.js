'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { encodeWav, resample } = require('./audio');

const WHISPER_SAMPLE_RATE = 16000;
// Below this RMS level the recording has no speech; Whisper would hallucinate (e.g. "you").
const SILENCE_RMS = 0.003;
const TRANSCRIBE_TIMEOUT_MS = 120_000;
const CLI_CANDIDATES = ['/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli'];
// Whisper emits bracketed/parenthesised tags for non-speech, e.g. [BLANK_AUDIO], (music).
const NON_SPEECH_TAG = /\[[^\]]*\]|\((?:music|inaudible|silence|applause|laughter|noise|wind|static)[^)]*\)/gi;

/** Finds whisper-cli; apps launched from Finder don't inherit the shell PATH, so check Homebrew paths. */
function resolveWhisperCli(env = process.env, exists = fs.existsSync) {
  if (env.LUPINE_WHISPER_CLI) {
    return env.LUPINE_WHISPER_CLI;
  }
  return CLI_CANDIDATES.find((candidate) => exists(candidate)) ?? null;
}

function isSilent(samples) {
  if (samples.length === 0) {
    return true;
  }
  const sumOfSquares = samples.reduce((sum, sample) => sum + sample * sample, 0);
  return Math.sqrt(sumOfSquares / samples.length) < SILENCE_RMS;
}

function cleanTranscript(raw) {
  return (raw ?? '')
    .replace(NON_SPEECH_TAG, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function runWhisper(cli, model, wavPath) {
  const args = ['-m', model, '-f', wavPath, '-l', 'en', '-nt', '-np', '-t', String(Math.min(8, os.cpus().length))];
  return new Promise((resolve, reject) => {
    execFile(cli, args, { timeout: TRANSCRIBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr?.trim().split('\n').pop() || error.message;
        reject(new Error(`Whisper failed: ${detail}`));
        return;
      }
      resolve(stdout);
    });
  });
}

/** Builds a transcribe(audio) function bound to a whisper-cli binary and model file. */
function createTranscriber({ modelPath, cliPath = resolveWhisperCli() }) {
  return async function transcribe({ samples, sampleRate }) {
    if (isSilent(samples)) {
      return '';
    }
    if (!cliPath) {
      throw new Error('whisper-cli not found. Install it with: brew install whisper-cpp');
    }
    if (!fs.existsSync(modelPath)) {
      throw new Error(`Whisper model missing at ${modelPath}`);
    }
    const wav = encodeWav(resample(samples, sampleRate, WHISPER_SAMPLE_RATE), WHISPER_SAMPLE_RATE);
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lupine-'));
    const wavPath = path.join(dir, 'dictation.wav');
    try {
      await fs.promises.writeFile(wavPath, wav);
      return cleanTranscript(await runWhisper(cliPath, modelPath, wavPath));
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  };
}

module.exports = { cleanTranscript, createTranscriber, isSilent, resolveWhisperCli };
