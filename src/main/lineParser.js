'use strict';

/**
 * Splits newline-delimited JSON from a stream.
 * Returns parsed messages for complete lines and the trailing partial line to carry forward.
 */
function parseLines(pending, chunk) {
  const lines = `${pending}${chunk}`.split('\n');
  const rest = lines.pop();
  const messages = lines
    .filter((line) => line.trim() !== '')
    .map((line) => {
      try {
        return { ok: true, value: JSON.parse(line) };
      } catch {
        return { ok: false, raw: line };
      }
    });
  return { messages, rest };
}

module.exports = { parseLines };
