'use strict';

const WAV_HEADER_BYTES = 44;
const BITS_PER_SAMPLE = 16;
const INT16_MAX = 32767;
const INT16_MIN = -32768;

/** Linear-interpolation resample; returns a new array and never mutates the input. */
function resample(samples, fromRate, toRate) {
  if (!(fromRate > 0) || !(toRate > 0)) {
    throw new RangeError(`Invalid sample rate: ${fromRate} -> ${toRate}`);
  }
  if (fromRate === toRate) {
    return Float32Array.from(samples);
  }
  const ratio = fromRate / toRate;
  const length = Math.floor(samples.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const next = Math.min(index + 1, samples.length - 1);
    const fraction = position - index;
    out[i] = samples[index] + (samples[next] - samples[index]) * fraction;
  }
  return out;
}

/** Encodes mono Float32 samples (-1..1) as a 16-bit PCM WAV file. */
function encodeWav(samples, sampleRate) {
  const dataBytes = samples.length * (BITS_PER_SAMPLE / 8);
  const buffer = Buffer.alloc(WAV_HEADER_BYTES + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // fmt chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * (BITS_PER_SAMPLE / 8), 28); // byte rate
  buffer.writeUInt16LE(BITS_PER_SAMPLE / 8, 32); // block align
  buffer.writeUInt16LE(BITS_PER_SAMPLE, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  samples.forEach((sample, i) => {
    const clamped = Math.max(-1, Math.min(1, sample));
    const value = clamped < 0 ? clamped * -INT16_MIN : clamped * INT16_MAX;
    buffer.writeInt16LE(Math.round(value), WAV_HEADER_BYTES + i * 2);
  });
  return buffer;
}

module.exports = { encodeWav, resample };
