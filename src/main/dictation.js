'use strict';

const DEFAULT_MIN_HOLD_MS = 250;
const DEFAULT_MAX_RECORD_MS = 120_000;

/**
 * Push-to-talk state machine: idle -> starting -> recording -> transcribing -> idle.
 * All side effects (mic, Whisper, pasting, UI) are injected so the flow is testable.
 */
function createDictationController({
  recorder,
  transcribe,
  insertText,
  showStatus,
  clock = Date.now,
  minHoldMs = DEFAULT_MIN_HOLD_MS,
  maxRecordMs = DEFAULT_MAX_RECORD_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  log = console,
}) {
  let state = 'idle';
  let startedAt = 0;
  let stopRequested = false;
  let cancelled = false;
  let maxTimer = null;

  function fail(error) {
    log.error('[Lupine] dictation failed', error);
    state = 'idle';
    showStatus('error', error?.message ?? String(error));
  }

  async function fnDown() {
    if (state !== 'idle') {
      return;
    }
    state = 'starting';
    stopRequested = false;
    cancelled = false;
    startedAt = clock();
    showStatus('listening');
    try {
      await recorder.start();
    } catch (error) {
      fail(error);
      return;
    }
    if (cancelled) {
      await recorder.cancel();
      return;
    }
    state = 'recording';
    maxTimer = setTimer(() => {
      fnUp().catch(fail);
    }, maxRecordMs);
    if (stopRequested) {
      await fnUp();
    }
  }

  async function fnUp() {
    if (state === 'starting') {
      // Released before the mic finished opening; fnDown completes the stop once it has.
      stopRequested = true;
      return;
    }
    if (state !== 'recording') {
      return;
    }
    state = 'transcribing';
    clearTimer(maxTimer);
    try {
      const audio = await recorder.stop();
      if (clock() - startedAt < minHoldMs) {
        state = 'idle';
        showStatus('idle');
        return;
      }
      showStatus('transcribing');
      const text = await transcribe(audio);
      if (text) {
        await insertText(text);
      }
      state = 'idle';
      showStatus('idle');
    } catch (error) {
      fail(error);
    }
  }

  /** Fn was used as a modifier (e.g. Fn+arrow): throw the recording away. */
  async function cancel() {
    if (state === 'starting') {
      cancelled = true;
      state = 'idle';
      showStatus('idle');
      return;
    }
    if (state !== 'recording') {
      return;
    }
    state = 'idle';
    clearTimer(maxTimer);
    showStatus('idle');
    try {
      await recorder.cancel();
    } catch (error) {
      log.warn('[Lupine] cancel failed', error);
    }
  }

  return { fnDown, fnUp, cancel, state: () => state };
}

module.exports = { createDictationController };
