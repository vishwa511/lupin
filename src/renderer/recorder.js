'use strict';

// Owns the microphone only while Fn is held, so the macOS mic indicator reflects real dictation.
let session = null;

async function openMicrophone() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const context = new AudioContext();
  await context.audioWorklet.addModule('recorder-worklet.js');
  const source = context.createMediaStreamSource(stream);
  const capture = new AudioWorkletNode(context, 'pcm-capture');
  const chunks = [];
  capture.port.onmessage = (event) => chunks.push(event.data);
  source.connect(capture);
  // The worklet only runs while connected to the graph's destination; it outputs silence.
  capture.connect(context.destination);
  return { stream, context, source, capture, chunks };
}

async function closeMicrophone(current) {
  current.source.disconnect();
  current.capture.disconnect();
  current.stream.getTracks().forEach((track) => track.stop());
  await current.context.close();
}

function concat(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Float32Array(total);
  chunks.reduce((offset, chunk) => {
    out.set(chunk, offset);
    return offset + chunk.length;
  }, 0);
  return out;
}

window.lupineRecorder.onStart(async (id) => {
  if (session) {
    await closeMicrophone(session).catch(() => {});
    session = null;
  }
  try {
    session = await openMicrophone();
    window.lupineRecorder.started(id);
  } catch (error) {
    session = null;
    window.lupineRecorder.failed(id, `Microphone unavailable: ${error.message}`);
  }
});

window.lupineRecorder.onStop(async (id) => {
  const current = session;
  session = null;
  if (!current) {
    window.lupineRecorder.failed(id, 'Recording was not running');
    return;
  }
  const { sampleRate } = current.context;
  await closeMicrophone(current).catch(() => {});
  const samples = concat(current.chunks);
  window.lupineRecorder.audio(id, samples.buffer, sampleRate);
});

window.lupineRecorder.onCancel(async () => {
  const current = session;
  session = null;
  if (current) {
    await closeMicrophone(current).catch(() => {});
  }
});
