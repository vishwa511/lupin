'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTextInserter } = require('../src/main/textInserter');

/** Mirrors Electron 44's ClipboardItem: data by MIME type, read back with getType(). */
class FakeClipboardItem {
  constructor(data, { fromRead = false } = {}) {
    this.data = data;
    this.fromRead = fromRead;
    this.types = Object.keys(data);
  }

  async getType(type) {
    if (!(type in this.data)) {
      throw new Error(`No ${type}`);
    }
    return this.data[type];
  }
}

/**
 * Fake of Electron 44's async clipboard. Like the real one, write() only accepts freshly
 * constructed ClipboardItems and rejects items that came from read().
 */
function fakeClipboard(initialData) {
  let data = initialData;
  const calls = [];
  return {
    calls,
    current: () => data,
    read: async () => { calls.push('read'); return data.map((d) => new FakeClipboardItem(d, { fromRead: true })); },
    write: async (items) => {
      if (items.some((item) => !(item instanceof FakeClipboardItem) || item.fromRead)) {
        throw new TypeError('clipboard.write cannot accept a ClipboardItem returned from clipboard.read()');
      }
      calls.push('write');
      data = items.map((item) => item.data);
    },
    readText: async () => data.find((d) => d['text/plain'] !== undefined)?.['text/plain'] ?? '',
    writeText: async (text) => { calls.push(`writeText:${text}`); data = [{ 'text/plain': text }]; },
    clear: () => { calls.push('clear'); data = []; },
  };
}

const noDelay = async () => {};

test('pastes the text and restores the previous clipboard items', async () => {
  // Arrange
  const previous = [{ 'text/plain': 'copied earlier', 'text/html': '<b>copied earlier</b>' }, { 'image/png': 'png-bytes' }];
  const clipboard = fakeClipboard(previous);
  const pasted = [];
  const insertText = createTextInserter({
    clipboard,
    ClipboardItem: FakeClipboardItem,
    paste: async () => pasted.push((await clipboard.readText())),
    delay: noDelay,
  });

  // Act
  await insertText('hello world');

  // Assert
  assert.deepEqual(pasted, ['hello world']);
  assert.deepEqual(clipboard.current(), previous);
});

test('clears the clipboard afterwards when it was empty before', async () => {
  const clipboard = fakeClipboard([]);
  const insertText = createTextInserter({ clipboard, ClipboardItem: FakeClipboardItem, paste: async () => {}, delay: noDelay });

  await insertText('hi');

  assert.deepEqual(clipboard.current(), []);
  assert.ok(clipboard.calls.includes('clear'));
});

test('ignores the macOS find pasteboard so an empty clipboard is cleared, not refilled', async () => {
  // Electron reports the Find pasteboard as an item even when the clipboard is empty.
  const clipboard = fakeClipboard([{ 'electron application/findtext': 'last search' }]);
  const insertText = createTextInserter({ clipboard, ClipboardItem: FakeClipboardItem, paste: async () => {}, delay: noDelay });

  await insertText('dictated');

  assert.deepEqual(clipboard.current(), []);
  assert.ok(clipboard.calls.includes('clear'));
});

test('leaves the clipboard alone if something else changed it during the paste', async () => {
  const clipboard = fakeClipboard([{ 'text/plain': 'old' }]);
  const insertText = createTextInserter({
    clipboard,
    ClipboardItem: FakeClipboardItem,
    paste: async () => {},
    delay: async () => { await clipboard.writeText('user copied this'); },
  });

  await insertText('dictated');

  assert.deepEqual(clipboard.current(), [{ 'text/plain': 'user copied this' }]);
});

test('still restores the clipboard when pasting fails', async () => {
  const previous = [{ 'text/plain': 'keep me' }];
  const clipboard = fakeClipboard(previous);
  const insertText = createTextInserter({
    clipboard,
    ClipboardItem: FakeClipboardItem,
    paste: async () => { throw new Error('Paste timed out'); },
    delay: noDelay,
  });

  await assert.rejects(insertText('lost'), /Paste timed out/);

  assert.deepEqual(clipboard.current(), previous);
});
