'use strict';

// Integration tests that run inside real Electron (the version Lupine ships with).
//
// The microphone is replaced by Chromium's fake capture device playing a speech WAV made with
// macOS `say`, so no real mic, TCC prompt or Accessibility permission is involved. The paste
// step is replaced by reading the clipboard, so nothing is typed into your apps. Your real
// clipboard is snapshotted first and restored at the end.
//
// Run with: npm run test:integration

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const { app, clipboard, ClipboardItem, ipcMain } = require('electron');

const root = path.join(__dirname, '..', '..');
const { createDictationController } = require(path.join(root, 'src/main/dictation'));
const { createRecorderBridge } = require(path.join(root, 'src/main/recorderBridge'));
const { createTextInserter, snapshotClipboard } = require(path.join(root, 'src/main/textInserter'));
const { createTranscriber } = require(path.join(root, 'src/main/whisper'));
const { createOverlay, createRecorderWindow } = require(path.join(root, 'src/main/windows'));

const SPOKEN = 'Hello from Lupine. This sentence was dictated by holding the function key.';
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lupine-it-'));
const speechWav = path.join(workDir, 'speech.wav');

// The fake mic must be configured before Electron is ready.
execFileSync('say', ['-o', speechWav, '--data-format=LEI16@48000', SPOKEN]);
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
app.commandLine.appendSwitch('use-file-for-fake-audio-capture', speechWav);
// The sandboxed audio service can't read files from the temp dir; run it in-process for tests.
app.commandLine.appendSwitch('disable-features', 'AudioServiceOutOfProcess');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const wavSeconds = (file) => {
  const bytes = fs.statSync(file).size - 44;
  return bytes / (48000 * 2);
};
const rms = (samples) => Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / Math.max(1, samples.length));

async function loaded(win) {
  if (win.webContents.isLoading()) {
    await once(win.webContents, 'did-finish-load');
  }
}

function createTests(context) {
  return [
    ['Electron exposes the async clipboard API Lupine relies on', async () => {
      assert.equal(typeof ClipboardItem, 'function');
      for (const method of ['read', 'write', 'readText', 'writeText', 'clear']) {
        assert.equal(typeof clipboard[method], 'function', `clipboard.${method}`);
      }
    }],

    ['textInserter pastes the text then restores a rich (text + HTML) clipboard', async () => {
      await clipboard.write([new ClipboardItem({ 'text/plain': 'lupine-before', 'text/html': '<b>lupine-before</b>' })]);
      let pasted = null;
      const insertText = createTextInserter({
        clipboard,
        ClipboardItem,
        paste: async () => { pasted = await clipboard.readText(); },
      });

      await insertText('dictated text');

      assert.equal(pasted, 'dictated text');
      assert.equal(await clipboard.readText(), 'lupine-before');
      const [item] = await clipboard.read();
      assert.ok(item.types.includes('text/html'), `types after restore: ${item.types}`);
      const html = await (await item.getType('text/html')).text();
      assert.match(html, /lupine-before/);
    }],

    ['textInserter clears the clipboard afterwards when it was empty', async () => {
      clipboard.clear();
      const insertText = createTextInserter({ clipboard, ClipboardItem, paste: async () => {} });

      await insertText('temporary');

      assert.equal(await clipboard.readText(), '');
    }],

    ['recorder window captures audio from the microphone', async () => {
      await context.bridge.start();
      await sleep(1500);
      const { samples, sampleRate } = await context.bridge.stop();

      assert.ok(sampleRate >= 16000, `sample rate ${sampleRate}`);
      assert.ok(samples.length >= sampleRate * 1.2, `only ${samples.length} samples`);
      assert.ok(rms(samples) > 0.005, `audio looks silent (rms ${rms(samples).toFixed(5)})`);
    }],

    ['recorder can be cancelled and started again', async () => {
      await context.bridge.start();
      await context.bridge.cancel();
      await sleep(200);
      await context.bridge.start();
      const { samples } = await context.bridge.stop();
      assert.ok(samples instanceof Float32Array);
    }],

    ['full dictation: hold Fn, speak, release -> Whisper text is pasted', async () => {
      const statuses = [];
      let pasted = null;
      const controller = createDictationController({
        recorder: context.bridge,
        transcribe: createTranscriber({ modelPath: path.join(root, 'models', 'ggml-base.en.bin') }),
        insertText: createTextInserter({
          clipboard,
          ClipboardItem,
          paste: async () => { pasted = await clipboard.readText(); },
        }),
        showStatus: (status, detail) => statuses.push(detail ? `${status}:${detail}` : status),
        log: { warn() {}, error() {} },
      });

      await controller.fnDown();
      await sleep(wavSeconds(speechWav) * 1000 + 800);
      await controller.fnUp();

      assert.deepEqual(statuses, ['listening', 'transcribing', 'idle']);
      assert.match(pasted ?? '', /dictated by holding the function key/i);
      context.report.transcript = pasted;
    }],

    ['overlay appears without taking focus and hides again', async () => {
      const overlay = createOverlay();
      await loaded(overlay.window);

      overlay.show('listening');
      await sleep(300);
      assert.equal(overlay.window.isVisible(), true);
      assert.equal(overlay.window.isFocused(), false);

      overlay.show('idle');
      assert.equal(overlay.window.isVisible(), false);
      overlay.window.destroy();
    }],

    ['compiled Fn helper speaks the JSON protocol and exits with the app', async () => {
      const helper = spawn(path.join(root, 'bin', 'lupine-fn-helper'), [], {
        env: { ...process.env, LUPINE_AX_PROMPT: '0' },
        stdio: ['pipe', 'pipe', 'inherit'],
      });
      const lines = [];
      helper.stdout.setEncoding('utf8');
      helper.stdout.on('data', (chunk) => lines.push(...chunk.split('\n').filter(Boolean).map((l) => JSON.parse(l))));

      const firstLine = once(helper.stdout, 'data');
      await Promise.race([firstLine, sleep(5000)]);
      assert.equal(lines[0]?.event, 'permission');
      assert.equal(typeof lines[0]?.accessibility, 'boolean');
      context.report.accessibilityForTestRunner = lines[0].accessibility;

      helper.stdin.write('bogus\n');
      await sleep(300);
      assert.ok(lines.some((l) => l.event === 'error' && /Unknown command: bogus/.test(l.message)));

      const exited = once(helper, 'exit');
      helper.stdin.end();
      const [code] = await Promise.race([exited, sleep(3000).then(() => ['timeout'])]);
      assert.equal(code, 0, 'helper should exit when the app closes its stdin');
    }],
  ];
}

async function run() {
  app.dock?.hide();
  const report = { results: [] };
  const savedClipboard = await snapshotClipboard(clipboard);

  const recorderWindow = createRecorderWindow();
  await loaded(recorderWindow);
  const context = {
    report,
    bridge: createRecorderBridge({ ipcMain, getWebContents: () => recorderWindow.webContents }),
  };

  try {
    for (const [name, fn] of createTests(context)) {
      const started = Date.now();
      try {
        await fn();
        report.results.push({ name, ok: true, ms: Date.now() - started });
        console.log(`ok     ${name} (${Date.now() - started} ms)`);
      } catch (error) {
        report.results.push({ name, ok: false, error: error.message });
        console.log(`FAILED ${name}\n       ${error.message}`);
      }
    }
  } finally {
    if (savedClipboard.length > 0) {
      await clipboard.write(savedClipboard.map((record) => new ClipboardItem(record)));
    } else {
      clipboard.clear();
    }
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  const failed = report.results.filter((r) => !r.ok).length;
  console.log(`\n${report.results.length - failed} passed, ${failed} failed`);
  if (report.transcript) {
    console.log(`transcript: "${report.transcript}"`);
  }
  console.log(`Accessibility granted to the test runner: ${report.accessibilityForTestRunner}`);
  app.exit(failed === 0 ? 0 : 1);
}

app.whenReady().then(run).catch((error) => {
  console.error(error);
  app.exit(1);
});
