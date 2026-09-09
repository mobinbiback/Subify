
// subify — offscreen document (v3)
// Adds: streaming dub playback, session recording, WAV export, latency measurement.

let ctx = null, mediaStream = null, sourceNode = null;
let originalGain = null, ttsGain = null, workletNode = null, sinkNode = null;

let settings = null;
let dubbingEnabled = false;
let playQueue = [];
let playing = false;
let duckTimer = null;

let live = null;              // LiveTranslateClient when engine === "live"
let livePlayhead = 0;         // scheduled playback cursor (ctx time)
let liveRecSec = 0;           // write cursor in the recording timeline
let liveSpeaking = false;
let liveQuietTimer = null;
let liveFirstAudioAt = 0;
let liveLastInputAt = 0;
let liveCue = null;           // {start, text}
let liveWatchdog = null;

let chunkSeq = 0;
let sessionStart = 0;          // wall clock ms
let capturedSec = 0;           // seconds of original audio seen so far
const chunkMeta = new Map();   // chunkId -> {startSec, wall}
const dubCursor = new Map();   // chunkId -> write position (sec) in the recording
let latencyReported = new Set();

const send = (m) => { try { browser.runtime.sendMessage(m); } catch (e) {} };
const log = (msg, level = "info") => send({ type: "log", level, msg });

// ---------- keepalive ----------
let port = null;
function openKeepalive() {
  try {
    port = browser.runtime.connect({ name: "subify-keepalive" });
    port.onDisconnect.addListener(() => { port = null; });
  } catch (e) {}
}
openKeepalive();
setInterval(() => {
  if (!port) openKeepalive();
  try { port && port.postMessage({ t: Date.now() }); } catch (e) { port = null; }
}, 20000);

// ---------- session recorder ----------
// Two 24 kHz mono tracks on the original timeline: the source, and the dub.
// Combined at export with ducking, so the exported file is properly in sync
// even though live playback cannot be.

const REC = {
  rate: 24000,
  orig: new Float32Array(0),
  dub: new Float32Array(0),
  origLen: 0,
  dubLen: 0,
  active: false,
  capSeconds: 5400,
  warned: false,

  reset() {
    this.orig = new Float32Array(this.rate * 120);
    this.dub = new Float32Array(this.rate * 120);
    this.origLen = 0; this.dubLen = 0;
    this.active = true; this.warned = false;
  },
  grow(which, need) {
    let a = this[which];
    if (need <= a.length) return a;
    let cap = a.length || this.rate * 60;
    while (cap < need) cap *= 2;
    const bigger = new Float32Array(cap);
    bigger.set(a);
    this[which] = bigger;
    return bigger;
  },
  appendOriginal(f32) {
    if (!this.active) return;
    if (this.origLen / this.rate > this.capSeconds) {
      if (!this.warned) { log("Recording length cap reached — export will be truncated", "warn"); this.warned = true; }
      return;
    }
    const a = this.grow("orig", this.origLen + f32.length);
    a.set(f32, this.origLen);
    this.origLen += f32.length;
  },
  writeDub(f32, atSec) {
    if (!this.active) return;
    const at = Math.max(0, Math.round(atSec * this.rate));
    const a = this.grow("dub", at + f32.length);
    for (let i = 0; i < f32.length; i++) a[at + i] += f32[i];
    this.dubLen = Math.max(this.dubLen, at + f32.length);
  },
  get seconds() { return Math.max(this.origLen, this.dubLen) / this.rate; }
};

function resample(f32, inRate, outRate) {
  if (inRate === outRate) return f32;
  const ratio = inRate / outRate;
  const outLen = Math.floor(f32.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const a = Math.floor(i * ratio), b = Math.min(f32.length, Math.floor((i + 1) * ratio));
    let acc = 0;
    for (let j = a; j < b; j++) acc += f32[j];
    out[i] = acc / Math.max(1, b - a);
  }
  return out;
}

// ---------- capture ----------

async function start(streamId, s) {
  await stop(true);
  settings = s;
  dubbingEnabled = s?.dubbingEnabled === true;

  log("Requesting tab audio stream…");
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
      video: false
    });
  } catch (e) { throw new Error("getUserMedia failed: " + (e.message || e)); }

  const track = mediaStream.getAudioTracks()[0];
  if (!track) throw new Error("Stream has no audio track — DRM-protected or silent tab.");
  log("Audio track acquired: " + (track.label || "tab"));

  ctx = new AudioContext();
  if (ctx.state === "suspended") { await ctx.resume(); log("AudioContext resumed"); }
  log(`AudioContext running at ${ctx.sampleRate} Hz`);

  sourceNode = ctx.createMediaStreamSource(mediaStream);
  originalGain = ctx.createGain();
  originalGain.gain.value = 1.0;
  sourceNode.connect(originalGain).connect(ctx.destination);

  ttsGain = ctx.createGain();
  ttsGain.gain.value = dubbingEnabled ? (s.dubGain ?? 1.6) : 0;
  ttsGain.connect(ctx.destination);

  const liveMode = s.engine !== "chunked";

  await ctx.audioWorklet.addModule(browser.runtime.getURL("capture-worklet.js"));
  workletNode = new AudioWorkletNode(ctx, "capture-processor", {
    numberOfInputs: 1, numberOfOutputs: 1,
    processorOptions: liveMode
      ? { mode: "stream", frameMs: s.frameMs ?? 100 }
      : {
          mode: "vad",
          minChunkSec: s.minChunkSec ?? 3.5,
          maxChunkSec: s.maxChunkSec ?? 9,
          silenceGapSec: s.silenceGapSec ?? 0.35,
          silenceThresh: s.silenceThresh ?? 0.004
        }
  });

  sinkNode = ctx.createGain();
  sinkNode.gain.value = 0;
  sourceNode.connect(workletNode);
  workletNode.connect(sinkNode).connect(ctx.destination);

  chunkSeq = 0;
  capturedSec = 0;
  sessionStart = Date.now();
  chunkMeta.clear(); dubCursor.clear(); latencyReported = new Set();
  REC.capSeconds = s.recordMaxSeconds ?? 5400;
  if (s.recordSession !== false) REC.reset();
  else REC.active = false;

  workletNode.port.onmessage = (e) => {
    const d = e.data;
    if (d.type === "level") send({ type: "level", rms: d.rms });
    else if (d.type === "pcm") {
      if (liveMode) handleLiveFrame(d.pcm, d.sampleRate);
      else handlePcm(d.pcm, d.sampleRate, d.reason);
    }
  };

  if (liveMode) startLive(s);

  track.onended = () => send({ type: "capture-ended" });
  log(liveMode
    ? "Capture live — streaming continuously to Gemini Live Translate"
    : `Capture live — cutting at pauses (${s.minChunkSec ?? 3.5}–${s.maxChunkSec ?? 9}s)`, "ok");
  send({ type: "capture-started" });
}

function handlePcm(mono, inRate, reason) {
  const startSec = capturedSec;
  const durSec = mono.length / inRate;
  capturedSec += durSec;

  REC.appendOriginal(resample(mono, inRate, REC.rate));

  let sum = 0;
  for (let i = 0; i < mono.length; i += 4) sum += mono[i] * mono[i];
  const rms = Math.sqrt(sum / (mono.length / 4));
  const gate = settings.minRms ?? 0.0015;
  if (rms < gate) { log(`Segment skipped — silent (rms ${rms.toFixed(5)})`); return; }

  const id = ++chunkSeq;
  chunkMeta.set(id, { startSec, wall: sessionStart + startSec * 1000 });

  const down = resample(mono, inRate, 16000);
  const b64 = arrayBufferToBase64(encodeWav(down, 16000));
  log(`Segment ${id} — ${durSec.toFixed(1)}s (cut on ${reason}), rms ${rms.toFixed(4)}`);
  send({ type: "chunk", chunkId: id, startSec, wavB64: b64, seconds: durSec, rms });
}

function encodeWav(samples, sampleRate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVE");
  w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return buf;
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function base64ToFloat(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const int16 = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
  const f = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) f[i] = int16[i] / 0x8000;
  return f;
}

// ---------- live engine ----------

function startLive(s) {
  livePlayhead = 0;
  liveRecSec = 0;
  liveFirstAudioAt = 0;
  liveLastInputAt = 0;
  liveCue = null;

  live = new self.LiveTranslateClient({
    apiKey: s.apiKey,
    model: s.liveModel || "gemini-3.5-live-translate-preview",
    targetLanguageCode: "fa",
    // "skip Persian sources" maps exactly onto echoTargetLanguage=false
    echoTargetLanguage: s.skipPersian === false,
    voiceName: s.liveVoice || "auto"
  });
  if (Number.isInteger(s.liveSetupVariant)) live.setupVariant = s.liveSetupVariant;

  live.on.log = (m, l) => log(m, l);
  live.on.ready = () => {
    send({ type: "live-ready", schemaVariant: live.setupVariant });
    // Watchdog: if audio is flowing in but nothing comes back, say which half is broken.
    clearInterval(liveWatchdog);
    let ticks = 0;
    liveWatchdog = setInterval(() => {
      if (!live) { clearInterval(liveWatchdog); return; }
      ticks++;
      const st = live.stats;
      if (st.audioPackets > 0) { clearInterval(liveWatchdog); return; }
      if (ticks === 3) {
        log(`No translated audio yet — sent ${st.framesSent} frames (${Math.round(st.bytesSent/1024)} KB), ` +
            `server messages ${st.serverMsgs}, transcripts in/out ${st.inputTexts}/${st.outputTexts}`,
            "warn");
      }
      if (ticks >= 6) {
        clearInterval(liveWatchdog);
        if (st.framesSent === 0) log("Nothing was sent — capture is not reaching the socket", "error");
        else if (st.inputTexts === 0) log("The model received audio but recognised no speech in it", "warn");
        else log("Speech was recognised but no audio came back — the model is not returning audio", "error");
        send({ type: "live-no-audio", stats: { ...st } });
      }
    }, 5000);
  };
  live.on.fatal = (why) => {
    clearInterval(liveWatchdog);
    send({ type: "live-fatal", error: String(why) });
  };
  live.on.audio = (pcm, rate) => playLiveAudio(pcm, rate);
  live.on.inputText = (text, lang) => {
    liveLastInputAt = capturedSec;
    if (!liveCue) liveCue = { start: capturedSec, text: "" };
    send({ type: "live-input", text, lang });
  };
  live.on.outputText = (text) => {
    if (liveCue) liveCue.text += text;
    send({ type: "live-output", text });
  };
  live.connect();
}

function handleLiveFrame(mono, inRate) {
  const startSec = capturedSec;
  capturedSec += mono.length / inRate;
  REC.appendOriginal(resample(mono, inRate, REC.rate));
  if (!live) return;

  const down = resample(mono, inRate, 16000);
  const int16 = new Int16Array(down.length);
  for (let i = 0; i < down.length; i++) {
    const x = Math.max(-1, Math.min(1, down[i]));
    int16[i] = x < 0 ? x * 0x8000 : x * 0x7fff;
  }
  live.sendPcm(int16);
  if (!liveFirstAudioAt) {
    liveFirstAudioAt = Date.now();
    log(`Streaming ${int16.length} samples per frame at 16 kHz to the live session`);
  }
}

// Gapless scheduling: each packet is queued at the running playhead rather than
// waiting for the previous buffer's onended, which would leave audible seams.
function playLiveAudio(pcm, rate) {
  if (!ctx || !pcm.length) return;
  if (!dubbingEnabled) return;

  const buffer = ctx.createBuffer(1, pcm.length, rate);
  buffer.copyToChannel(pcm, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ttsGain);

  const now = ctx.currentTime;
  const lead = 0.06;
  if (livePlayhead < now + lead) livePlayhead = now + lead;
  src.start(livePlayhead);
  const dur = pcm.length / rate;
  livePlayhead += dur;

  if (REC.active) {
    const at24 = resample(pcm, rate, REC.rate);
    REC.writeDub(at24, liveRecSec);
    liveRecSec += at24.length / REC.rate;
  }

  if (!liveSpeaking) {
    liveSpeaking = true;
    if (liveLastInputAt) {
      send({ type: "latency", seconds: Math.max(0, capturedSec - liveLastInputAt) });
    }
  }
  duck(settings?.duckLevel ?? 0.12);

  clearTimeout(liveQuietTimer);
  const quietIn = Math.max(300, (livePlayhead - ctx.currentTime) * 1000 + 350);
  liveQuietTimer = setTimeout(() => {
    liveSpeaking = false;
    unduck();
    if (liveCue && liveCue.text.trim()) {
      send({ type: "live-cue", start: liveCue.start, end: capturedSec, text: liveCue.text.trim() });
    }
    liveCue = null;
    // Keep the recording cursor aligned with the source timeline between utterances.
    liveRecSec = Math.max(liveRecSec, capturedSec);
  }, quietIn);
}

// ---------- dub playback ----------

async function ensurePlaybackContext() {
  if (ctx) return;
  ctx = new AudioContext();
  if (ctx.state === "suspended") await ctx.resume();
  ttsGain = ctx.createGain();
  ttsGain.gain.value = 1.6;
  ttsGain.connect(ctx.destination);
}

async function enqueuePlayback(msg) {
  if (!dubbingEnabled) return;
  await ensurePlaybackContext();

  const pcm = base64ToFloat(msg.pcmB64);
  if (!pcm.length) return;

  // Record into the timeline at this segment's own position.
  if (msg.chunkId != null && REC.active) {
    const meta = chunkMeta.get(msg.chunkId);
    if (meta) {
      const cur = dubCursor.get(msg.chunkId) ?? meta.startSec;
      const at24 = resample(pcm, msg.sampleRate || 24000, REC.rate);
      REC.writeDub(at24, cur);
      dubCursor.set(msg.chunkId, cur + at24.length / REC.rate);
    }
  }

  // Report the real end-to-end delay once per segment.
  if (msg.chunkId != null && !latencyReported.has(msg.chunkId)) {
    const meta = chunkMeta.get(msg.chunkId);
    if (meta) {
      latencyReported.add(msg.chunkId);
      send({ type: "latency", seconds: (Date.now() - meta.wall) / 1000 });
    }
  }

  playQueue.push({ pcm, ...msg });

  // Runaway backlog means the dub drifts further behind forever. Drop the oldest.
  const maxQ = settings?.maxQueue ?? 3;
  while (playQueue.length > maxQ) {
    playQueue.shift();
    log("Dropped a queued segment to stop the dub drifting further behind", "warn");
  }

  if (!playing) playNext();
}

function playNext() {
  const item = playQueue.shift();
  if (!item) { playing = false; unduck(); return; }
  playing = true;

  const buffer = ctx.createBuffer(1, item.pcm.length, item.sampleRate || 24000);
  buffer.copyToChannel(item.pcm, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = (item.playbackRate || 1.0) * (playQueue.length >= 2 ? 1.15 : 1.0);
  src.connect(ttsGain);
  duck(item.duckLevel ?? 0.12);
  src.onended = () => playNext();
  src.start();
}

function duck(level) {
  if (!originalGain || !ctx) return;
  clearTimeout(duckTimer);
  originalGain.gain.cancelScheduledValues(ctx.currentTime);
  originalGain.gain.setTargetAtTime(level, ctx.currentTime, 0.12);
}
function unduck() {
  if (!originalGain || !ctx) return;
  duckTimer = setTimeout(() => {
    if (!originalGain || !ctx) return;
    originalGain.gain.cancelScheduledValues(ctx.currentTime);
    originalGain.gain.setTargetAtTime(1.0, ctx.currentTime, 0.35);
  }, 400);
}

// ---------- export ----------

// Pure PCM mixdown, shared by both the WAV and MP3 export paths so the two
// formats always sound identical — only the container/encoding differs.
function buildMixPcm(mode) {
  const n = Math.max(REC.origLen, REC.dubLen);
  if (!n) throw new Error("Nothing recorded yet");
  const out = new Float32Array(n);
  const duck = settings?.exportDuck ?? 0.18;
  const gain = settings?.exportDubGain ?? 1.0;

  // Smooth duck envelope: attenuate the original wherever dub energy exists.
  const win = Math.round(REC.rate * 0.25);
  const env = new Float32Array(n);
  for (let i = 0; i < REC.dubLen; i++) if (Math.abs(REC.dub[i]) > 0.001) env[i] = 1;
  let run = 0;
  for (let i = 0; i < n; i++) { if (env[i]) run = win; else if (run > 0) { env[i] = 1; run--; } }
  let smooth = 0;
  const a = 1 / (REC.rate * 0.12);
  for (let i = 0; i < n; i++) {
    smooth += (env[i] - smooth) * a;
    const o = i < REC.origLen ? REC.orig[i] : 0;
    const d = i < REC.dubLen ? REC.dub[i] : 0;
    if (mode === "dub") out[i] = d * gain;
    else if (mode === "original") out[i] = o;
    else out[i] = o * (1 - smooth * (1 - duck)) + d * gain;
  }

  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  if (peak > 1) for (let i = 0; i < n; i++) out[i] /= peak * 1.02;

  return { samples: out, rate: REC.rate };
}

// MP3 via the bundled lamejs encoder (vendor/lame.min.js) — chosen over
// MediaRecorder/Opus because MediaRecorder only encodes in real time (an
// exported 90-minute dub would take 90 minutes to produce); lamejs crunches
// through the PCM as fast as the CPU allows, offline, mono, ~64kbps — plenty
// for a spoken-word dub track and roughly a tenth the size of the WAV.
function encodeMp3(samples, sampleRate) {
  if (typeof lamejs === "undefined" || !lamejs.Mp3Encoder) {
    throw new Error("MP3 encoder failed to load (vendor/lame.min.js missing?)");
  }
  const kbps = 64;
  const encoder = new lamejs.Mp3Encoder(1, sampleRate, kbps);
  const blockSize = 1152;
  const int16 = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    int16[i] = x < 0 ? x * 0x8000 : x * 0x7fff;
  }
  const chunks = [];
  for (let i = 0; i < int16.length; i += blockSize) {
    const chunk = encoder.encodeBuffer(int16.subarray(i, i + blockSize));
    if (chunk.length) chunks.push(chunk);
  }
  const tail = encoder.flush();
  if (tail.length) chunks.push(tail);
  return chunks;
}

// browser.downloads is NOT exposed to offscreen documents, so this only builds the
// blob and returns its URL. The service worker performs the actual download —
// blob URLs are shared across extension contexts of the same origin.
async function exportAudio(mode, format) {
  const { samples, rate } = buildMixPcm(mode);
  let blob;
  if (format === "mp3") {
    const chunks = encodeMp3(samples, rate);
    blob = new Blob(chunks, { type: "audio/mpeg" });
  } else {
    blob = new Blob([encodeWav(samples, rate)], { type: "audio/wav" });
  }
  const url = URL.createObjectURL(blob);
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 300000);
  log(`Export built (${format === "mp3" ? "MP3" : "WAV"}) — ${(blob.size / 1048576).toFixed(1)} MB, ${REC.seconds.toFixed(0)}s of timeline`, "ok");
  return { url, bytes: blob.size, seconds: REC.seconds };
}

// ---------- live connection test ----------

async function testLive(s) {
  return new Promise((resolve) => {
    log("Testing live connection…");
    const c = new self.LiveTranslateClient({
      apiKey: s.apiKey,
      model: s.liveModel || "gemini-3.5-live-translate-preview",
      targetLanguageCode: "fa",
      echoTargetLanguage: false,
      voiceName: s.liveVoice || "auto"
    });
    let done = false;
    const finish = (ok, why) => {
      if (done) return;
      done = true;
      try { c.close(); } catch (e) {}
      if (ok) log("Live connection test passed — your key can use this model.", "ok");
      else log("Live connection test failed: " + why, "error");
      resolve({ ok, why });
    };
    c.on.log = (m, l) => log(m, l);
    c.on.ready = () => finish(true);
    c.on.fatal = (why) => finish(false, why);
    c.connect();
    setTimeout(() => finish(false, "timed out after 20s"), 20000);
  });
}

// ---------- teardown ----------

async function stop(keepRecording) {
  try { live && live.close(); } catch (e) {}
  clearInterval(liveWatchdog);
  liveWatchdog = null;
  live = null;
  clearTimeout(liveQuietTimer);
  liveSpeaking = false;
  try { workletNode && workletNode.disconnect(); } catch (e) {}
  try { sinkNode && sinkNode.disconnect(); } catch (e) {}
  try { sourceNode && sourceNode.disconnect(); } catch (e) {}
  try { mediaStream && mediaStream.getTracks().forEach(t => t.stop()); } catch (e) {}
  try { if (ctx) await ctx.close(); } catch (e) {}
  ctx = mediaStream = sourceNode = originalGain = ttsGain = workletNode = sinkNode = null;
  playQueue = []; playing = false;
  if (!keepRecording) REC.active = false;
}

// ---------- messaging ----------

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.type) {
    case "offscreen-ping":
      sendResponse({ ok: true, recordedSeconds: REC.seconds });
      return false;
    case "offscreen-start":
      start(msg.streamId, msg.settings)
        .then(() => sendResponse({ ok: true }))
        .catch((e) => {
          log("Capture failed: " + (e.message || e), "error");
          send({ type: "capture-error", error: String(e.message || e) });
          sendResponse({ ok: false, error: String(e.message || e) });
        });
      return true;
    case "offscreen-stop":
      stop(true).then(() => sendResponse({ ok: true, recordedSeconds: REC.seconds }));
      return true;
    case "offscreen-set-dubbing":
      dubbingEnabled = Boolean(msg.enabled);
      if (!dubbingEnabled) {
        playQueue = [];
        playing = false;
        if (ttsGain && ctx) {
          ttsGain.gain.cancelScheduledValues(ctx.currentTime);
          ttsGain.gain.setValueAtTime(0, ctx.currentTime);
        }
        unduck();
      } else if (ttsGain && ctx) {
        ttsGain.gain.cancelScheduledValues(ctx.currentTime);
        ttsGain.gain.setValueAtTime(settings?.dubGain ?? 1.6, ctx.currentTime);
      }
      sendResponse({ ok: true, enabled: dubbingEnabled });
      return false;
    case "offscreen-set-dubbing":
      dubbingEnabled = Boolean(msg.enabled);
      if (!dubbingEnabled) {
        playQueue = []; playing = false;
        if (ttsGain && ctx) { ttsGain.gain.cancelScheduledValues(ctx.currentTime); ttsGain.gain.setValueAtTime(0, ctx.currentTime); }
        unduck();
      } else if (ttsGain && ctx) {
        ttsGain.gain.cancelScheduledValues(ctx.currentTime);
        ttsGain.gain.setValueAtTime(settings?.dubGain ?? 1.6, ctx.currentTime);
      }
      sendResponse({ ok: true, enabled: dubbingEnabled });
      return false;
    case "offscreen-play":
      enqueuePlayback(msg);
      return false;
    case "offscreen-export":
      exportAudio(msg.mode, msg.format === "mp3" ? "mp3" : "wav")
        .then((r) => sendResponse({ ok: true, ...r }))
        .catch((e) => {
          log("Export failed: " + (e.message || e), "error");
          sendResponse({ ok: false, error: String(e.message || e) });
        });
      return true;
    case "offscreen-test-live":
      testLive(msg.settings).then((r) => sendResponse(r));
      return true;
    case "offscreen-recording-info":
      sendResponse({ ok: true, seconds: REC.seconds, active: REC.active });
      return false;
  }
  return false;
});

send({ type: "offscreen-ready" });
