// subify capture worklet (v3) — voice-activity segmentation.
// v2 cut fixed 10s windows, so every chunk waited a full 10s before it could
// even be sent. v3 cuts at the first natural pause after minChunkSec, which
// removes several seconds of dead waiting and keeps sentences intact.

class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = (options && options.processorOptions) || {};
    this.minSamples = Math.round(sampleRate * (o.minChunkSec || 3.5));
    this.maxSamples = Math.round(sampleRate * (o.maxChunkSec || 9));
    this.gapSamples = Math.round(sampleRate * (o.silenceGapSec || 0.35));
    this.silenceThresh = o.silenceThresh || 0.004;
    // "stream" = post fixed ~100ms frames continuously (Live API).
    // "vad"    = cut at natural pauses (chunked REST pipeline).
    this.mode = o.mode === "stream" ? "stream" : "vad";
    this.frameSamples = Math.round(sampleRate * (o.frameMs || 100) / 1000);

    this.buf = [];
    this.count = 0;
    this.silentRun = 0;
    this.levelAcc = 0;
    this.levelCount = 0;
    this.levelEvery = Math.round(sampleRate / 4);

    this.port.onmessage = (e) => {
      const d = e.data || {};
      if (d.minChunkSec) this.minSamples = Math.round(sampleRate * d.minChunkSec);
      if (d.maxChunkSec) this.maxSamples = Math.round(sampleRate * d.maxChunkSec);
      if (d.flush) this.flush("manual");
    };
  }

  flush(reason) {
    if (!this.count) return;
    const merged = new Float32Array(this.count);
    let o = 0;
    for (const b of this.buf) { merged.set(b, o); o += b.length; }
    this.buf = [];
    this.count = 0;
    this.silentRun = 0;
    this.port.postMessage(
      { type: "pcm", pcm: merged, sampleRate, reason },
      [merged.buffer]
    );
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input.length || !input[0]) return true;

    const len = input[0].length;
    const chans = input.length;
    const mono = new Float32Array(len);
    for (let c = 0; c < chans; c++) {
      const ch = input[c];
      for (let i = 0; i < len; i++) mono[i] += ch[i] / chans;
    }

    let sq = 0;
    for (let i = 0; i < len; i++) sq += mono[i] * mono[i];
    const blockRms = Math.sqrt(sq / len);

    this.levelAcc += sq;
    this.levelCount += len;
    if (this.levelCount >= this.levelEvery) {
      this.port.postMessage({ type: "level", rms: Math.sqrt(this.levelAcc / this.levelCount) });
      this.levelAcc = 0;
      this.levelCount = 0;
    }

    this.buf.push(mono);
    this.count += len;

    if (this.mode === "stream") {
      if (this.count >= this.frameSamples) this.flush("frame");
      return true;
    }

    if (blockRms < this.silenceThresh) this.silentRun += len;
    else this.silentRun = 0;

    // Cut on a pause once we have enough speech, or force a cut at the ceiling.
    if (this.count >= this.minSamples && this.silentRun >= this.gapSamples) this.flush("pause");
    else if (this.count >= this.maxSamples) this.flush("max");

    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
