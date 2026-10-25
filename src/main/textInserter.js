'use strict';

// Long enough for the target app to read the clipboard after Cmd+V.
const RESTORE_DELAY_MS = 600;

// macOS reports its separate Find pasteboard as a clipboard item; it isn't the user's clipboard.
const IGNORED_TYPES = new Set(['electron application/findtext']);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Copies every readable MIME payload out of the clipboard. Electron 44 rejects writing back
 * the live items returned by read(), so we keep plain { mimeType: payload } records instead.
 */
async function snapshotClipboard(clipboard) {
  const items = await clipboard.read();
  const records = await Promise.all(items.map(async (item) => {
    const types = item.types.filter((type) => !IGNORED_TYPES.has(type));
    const entries = await Promise.all(types.map(async (type) => {
      try {
        return [type, await item.getType(type)];
      } catch {
        return null; // Some platform formats can't be read back; skip just that one.
      }
    }));
    return Object.fromEntries(entries.filter(Boolean));
  }));
  return records.filter((record) => Object.keys(record).length > 0);
}

async function restoreClipboard(clipboard, ClipboardItem, records) {
  if (records.length === 0) {
    clipboard.clear();
    return;
  }
  await clipboard.write(records.map((record) => new ClipboardItem(record)));
}

/**
 * Pastes text into the focused app via the clipboard, then puts the user's clipboard back
 * unless something else changed it in the meantime.
 */
function createTextInserter({ clipboard, ClipboardItem, paste, delay = wait }) {
  return async function insertText(text) {
    const saved = await snapshotClipboard(clipboard);
    await clipboard.writeText(text);
    try {
      await paste();
      await delay(RESTORE_DELAY_MS);
    } finally {
      if ((await clipboard.readText()) === text) {
        await restoreClipboard(clipboard, ClipboardItem, saved);
      }
    }
  };
}

module.exports = { createTextInserter, snapshotClipboard };
