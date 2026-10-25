'use strict';

/** Forwards each 128-sample block of the first input channel to the page. */
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) {
      this.port.postMessage(channel.slice(0));
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCapture);
