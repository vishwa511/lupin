'use strict';

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { parseLines } = require('./lineParser');

const RESTART_DELAY_MS = 1000;
const MAX_RESTARTS = 5;
const PASTE_TIMEOUT_MS = 1500;

/**
 * Runs the native Fn helper and turns its JSON lines into events:
 * 'fn' (isDown), 'chord', 'permission' (granted), 'ready', 'pasted', 'error' (message).
 */
function createFnHelper({ binaryPath, log = console }) {
  const events = new EventEmitter();
  let child = null;
  let pending = '';
  let restarts = 0;
  let stopping = false;

  function dispatch(message) {
    switch (message.event) {
      case 'fn': events.emit('fn', message.down === true); break;
      case 'fn-chord': events.emit('chord'); break;
      case 'permission': events.emit('permission', message.accessibility === true); break;
      case 'ready': restarts = 0; events.emit('ready'); break;
      case 'pasted': events.emit('pasted'); break;
      case 'error': events.emit('error', message.message ?? 'Unknown helper error'); break;
      default: log.warn('[Lupine] unknown helper message', message);
    }
  }

  function start() {
    stopping = false;
    child = spawn(binaryPath, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      const { messages, rest } = parseLines(pending, chunk);
      pending = rest;
      messages.forEach((m) => (m.ok ? dispatch(m.value) : log.warn('[Lupine] bad helper line', m.raw)));
    });
    child.on('error', (error) => events.emit('error', `Fn helper failed to start: ${error.message}`));
    child.on('exit', (code, signal) => {
      child = null;
      pending = '';
      if (stopping) {
        return;
      }
      if (restarts >= MAX_RESTARTS) {
        events.emit('error', `Fn helper keeps exiting (code ${code ?? signal}); giving up`);
        return;
      }
      restarts += 1;
      log.warn(`[Lupine] Fn helper exited (${code ?? signal}); restarting`);
      setTimeout(start, RESTART_DELAY_MS);
    });
  }

  function paste() {
    if (!child) {
      return Promise.reject(new Error('Fn helper is not running'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        events.off('pasted', onPasted);
        reject(new Error('Paste timed out'));
      }, PASTE_TIMEOUT_MS);
      function onPasted() {
        clearTimeout(timer);
        resolve();
      }
      events.once('pasted', onPasted);
      child.stdin.write('paste\n');
    });
  }

  function stop() {
    stopping = true;
    child?.stdin.end();
    child?.kill();
  }

  return { events, start, paste, stop };
}

module.exports = { createFnHelper };
