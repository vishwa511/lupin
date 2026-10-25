'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseLines } = require('../src/main/lineParser');

test('parseLines returns complete JSON messages and keeps the partial line', () => {
  const { messages, rest } = parseLines('', '{"event":"ready"}\n{"event":"fn","do');

  assert.deepEqual(messages, [{ ok: true, value: { event: 'ready' } }]);
  assert.equal(rest, '{"event":"fn","do');
});

test('parseLines completes a message split across chunks', () => {
  const { messages, rest } = parseLines('{"event":"fn","do', 'wn":true}\n');

  assert.deepEqual(messages, [{ ok: true, value: { event: 'fn', down: true } }]);
  assert.equal(rest, '');
});

test('parseLines reports non-JSON lines instead of throwing', () => {
  const { messages } = parseLines('', 'garbage\n\n');

  assert.deepEqual(messages, [{ ok: false, raw: 'garbage' }]);
});
