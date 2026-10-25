'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { createFnHelper } = require('../src/main/fnHelper');

const quietLog = { warn() {}, error() {} };

/**
 * Writes an executable stand-in for the Swift helper that speaks the same JSON-lines protocol.
 * mode 'press': after ready, simulate Fn down + another key + Fn up.
 * mode 'crash-once': the first run exits right after ready; the restarted run stays up.
 */
function fakeHelperBinary(mode = 'idle') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lupine-fake-helper-'));
  const file = path.join(dir, 'helper');
  const marker = path.join(dir, 'crashed-once');
  fs.writeFileSync(file, `#!${process.execPath}
const fs = require('node:fs');
const send = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
send({ event: 'permission', accessibility: true });
// Split one message across two writes to exercise line buffering.
process.stdout.write('{"event":"rea');
setTimeout(() => {
  process.stdout.write('dy"}\\n');
  if (${JSON.stringify(mode)} === 'press') {
    send({ event: 'fn', down: true }); send({ event: 'fn-chord' }); send({ event: 'fn', down: false });
  }
  if (${JSON.stringify(mode)} === 'crash-once' && !fs.existsSync(${JSON.stringify(marker)})) {
    fs.writeFileSync(${JSON.stringify(marker)}, '');
    process.exit(3);
  }
}, 10);
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\\n')) >= 0) {
    const cmd = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    if (cmd === 'paste') send({ event: 'pasted' });
  }
});
process.stdin.on('end', () => process.exit(0));
`, { mode: 0o755 });
  return file;
}

test('emits permission and ready, joining a message split across chunks', async (t) => {
  const helper = createFnHelper({ binaryPath: fakeHelperBinary(), log: quietLog });
  t.after(() => helper.stop());
  const permission = once(helper.events, 'permission');
  const ready = once(helper.events, 'ready');

  helper.start();

  assert.deepEqual(await permission, [true]);
  await ready;
});

test('translates fn and chord messages into events in order', async (t) => {
  const helper = createFnHelper({ binaryPath: fakeHelperBinary('press'), log: quietLog });
  t.after(() => helper.stop());
  const seen = [];
  const released = new Promise((resolve) => {
    helper.events.on('fn', (down) => {
      seen.push(down ? 'down' : 'up');
      if (!down) resolve();
    });
  });
  helper.events.on('chord', () => seen.push('chord'));

  helper.start();
  await released;

  assert.deepEqual(seen, ['down', 'chord', 'up']);
});

test('paste resolves when the helper confirms', async (t) => {
  const helper = createFnHelper({ binaryPath: fakeHelperBinary(), log: quietLog });
  t.after(() => helper.stop());
  helper.start();
  await once(helper.events, 'ready');

  await helper.paste();
});

test('paste rejects when the helper is not running', async () => {
  const helper = createFnHelper({ binaryPath: fakeHelperBinary(), log: quietLog });

  await assert.rejects(helper.paste(), /not running/);
});

test('restarts the helper after an unexpected exit', async (t) => {
  const helper = createFnHelper({ binaryPath: fakeHelperBinary('crash-once'), log: quietLog });
  t.after(() => helper.stop());
  let readyCount = 0;
  const secondReady = new Promise((resolve) => {
    helper.events.on('ready', () => {
      readyCount += 1;
      if (readyCount === 2) resolve();
    });
  });

  helper.start();
  await secondReady;

  assert.equal(readyCount, 2);
});

test('reports a missing binary as an error event', async () => {
  const helper = createFnHelper({ binaryPath: '/nonexistent/lupine-fn-helper', log: quietLog });
  const error = once(helper.events, 'error');

  helper.start();

  assert.match((await error)[0], /failed to start/);
  helper.stop();
});
