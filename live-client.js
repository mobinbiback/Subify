
const __sby_p = (() => {
  const a = [77,111,98,105,110,98,105,98,97,107];
  return Object.freeze({
    id: a.map((n,i) => String.fromCharCode(n ^ 0)).join(''),
    stamp: 'subify-provenance-v2416'
  });
})();
// subify — Gemini Live Translate client (v4.1)
// Implements Google's BidiGenerateContent WebSocket protocol.
// 16 kHz PCM in, 24 kHz PCM out, continuous streaming.
//
// v4.1 fixes:
//  • v4 reconnected forever on a fatal close (bad model / no access), so the real
//    reason scrolled away and nothing ever played. Fatal closes now stop and report.
//  • Setup schema is probed across known variants instead of assumed.
//  • Counters + watchdog so "no audio" says WHY: no socket, no setup, no
//    transcripts, or transcripts but no audio.

class LiveTranslateClient {
  constructor(opts) {
    this.opts = opts;
    this.ws = null;
    this.ready = false;
    this.closedByUs = false;
    this.pending = [];
    this.maxPending = 20;
    this.resumeHandle = null;
    this.generation = 0;
    this.reconnectTimer = null;

    this.setupVariant = 0;      // schema probe index
    this.variantsTried = 0;
    this.attempts = 0;
    this.sawSetupComplete = false;

    this.stats = { framesSent: 0, bytesSent: 0, serverMsgs: 0, audioPackets: 0, audioSamples: 0, inputTexts: 0, outputTexts: 0 };

    this.on = {
      ready: () => {}, audio: () => {}, inputText: () => {},
      outputText: () => {}, log: () => {}, closed: () => {}, fatal: () => {}
    };
  }

  static get WS_URL() {
    return "wss://generativelanguage.googleapis.com/ws/" +
           "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
  }

  // Three known-good shapes; we probe rather than assume.
  buildSetup() {
    const model = `models/${this.opts.model}`;
    const translationConfig = {
      targetLanguageCode: this.opts.targetLanguageCode || "fa",
      echoTargetLanguage: !!this.opts.echoTargetLanguage
    };
    const speech = (this.opts.voiceName && this.opts.voiceName !== "auto")
      ? { speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.opts.voiceName } } } }
      : {};

    let setup;
    if (this.setupVariant === 0) {
      // Confirmed working shape: transcription flags sit at setup level, NOT
      // inside generationConfig (the docs' example is wrong about this).
      setup = {
        model,
        generationConfig: { responseModalities: ["AUDIO"], translationConfig, ...speech },
        inputAudioTranscription: {},
        outputAudioTranscription: {}
      };
    } else if (this.setupVariant === 1) {
      setup = {
        model,
        generationConfig: {
          responseModalities: ["AUDIO"],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          translationConfig,
          ...speech
        }
      };
    } else {
      setup = {
        model,
        generationConfig: { responseModalities: ["AUDIO"], translationConfig, ...speech }
      };
    }
    if (this.resumeHandle) setup.sessionResumption = { handle: this.resumeHandle };
    return { setup };
  }

  connect() {
    this.closedByUs = false;
    this.attempts++;
    this.sawSetupComplete = false;

    if (!this.opts.apiKey) { this.fail("No API key"); return; }

    const url = `${LiveTranslateClient.WS_URL}?key=${encodeURIComponent(this.opts.apiKey)}`;
    try {
      this.ws = new WebSocket(url);
    } catch (e) {
      this.fail("Could not open WebSocket: " + (e.message || e));
      return;
    }
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => {
      this.on.log(`Live socket open — sending setup (schema variant ${this.setupVariant})`);
      this.sendJson(this.buildSetup());
      // If the server neither completes setup nor closes, say so rather than hanging.
      this.setupTimer = setTimeout(() => {
        if (!this.ready) this.on.log("No setupComplete after 10s — server accepted the socket but not the config", "warn");
      }, 10000);
    };

    this.ws.onmessage = (ev) => this.handleMessage(ev);
    this.ws.onerror = () => this.on.log("Live socket error event", "warn");

    this.ws.onclose = (ev) => {
      clearTimeout(this.setupTimer);
      this.ready = false;
      this.ws = null;
      if (this.closedByUs) { this.on.closed(); return; }

      const reason = (ev.reason || "").trim();
      this.on.log(`Live socket closed — code ${ev.code}${reason ? ": " + reason : " (no reason given)"}`,
                  this.sawSetupComplete ? "warn" : "error");

      // Closed before setup ever completed => the config or the model is the problem.
      if (!this.sawSetupComplete) {
        if (this.setupVariant < 2) {
          this.setupVariant++;
          this.variantsTried++;
          this.on.log(`Retrying with setup schema variant ${this.setupVariant}`, "warn");
          this.scheduleReconnect(400);
          return;
        }
        this.fail(reason || `socket closed with code ${ev.code} before setup completed`);
        return;
      }
      // Setup had worked before, so this is a transient drop: resume.
      if (this.attempts < 30) this.scheduleReconnect(1200);
      else this.fail("too many reconnects");
    };
  }

  fail(why) {
    this.on.log("Live engine unavailable: " + why, "error");
    this.closedByUs = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.on.fatal(why);
  }

  sendJson(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  sendPcm(int16) {
    if (this.closedByUs) return;
    if (!this.isReady()) {
      this.pending.push(int16);
      while (this.pending.length > this.maxPending) this.pending.shift();
      return;
    }
    this.sendPcmNow(int16);
  }

  sendPcmNow(int16) {
    const data = LiveTranslateClient.toBase64(int16.buffer);
    this.stats.framesSent++;
    this.stats.bytesSent += int16.byteLength;
    this.sendJson({ realtimeInput: { audio: { data, mimeType: "audio/pcm;rate=16000" } } });
  }

  flushPending() {
    const q = this.pending;
    this.pending = [];
    for (const f of q) this.sendPcmNow(f);
    if (q.length) this.on.log(`Flushed ${q.length} buffered audio frames`);
  }

  isReady() { return this.ready && this.ws && this.ws.readyState === WebSocket.OPEN; }

  async handleMessage(ev) {
    const gen = this.generation;
    let text;
    if (typeof ev.data === "string") text = ev.data;
    else if (ev.data instanceof ArrayBuffer) text = new TextDecoder().decode(ev.data);
    else text = await ev.data.text();

    let msg;
    try { msg = JSON.parse(text); }
    catch (e) { this.on.log("Unparseable server frame", "warn"); return; }
    this.stats.serverMsgs++;

    if (msg.error) {
      const e = msg.error;
      this.on.log(`Server error ${e.code || ""}: ${e.message || JSON.stringify(e).slice(0, 160)}`, "error");
      return;
    }

    const h = msg.sessionResumptionUpdate ?? msg.session_resumption_update;
    if (h && (h.newHandle ?? h.new_handle)) this.resumeHandle = h.newHandle ?? h.new_handle;

    const goAway = msg.goAway ?? msg.go_away;
    if (goAway) {
      this.on.log("Server will rotate the session — reconnecting", "warn");
      this.scheduleReconnect(400);
    }

    if (msg.setupComplete ?? msg.setup_complete) {
      clearTimeout(this.setupTimer);
      this.ready = true;
      this.sawSetupComplete = true;
      this.on.log(`Live session ready (schema variant ${this.setupVariant})`, "ok");
      this.on.ready();
      this.flushPending();
      return;
    }

    const sc = msg.serverContent ?? msg.server_content;
    if (!sc) return;

    const it = sc.inputTranscription ?? sc.input_transcription;
    if (it && it.text) {
      this.stats.inputTexts++;
      this.on.inputText(it.text, it.languageCode ?? it.language_code ?? "");
    }

    const ot = sc.outputTranscription ?? sc.output_transcription;
    if (ot && ot.text) { this.stats.outputTexts++; this.on.outputText(ot.text); }

    const parts = (sc.modelTurn ?? sc.model_turn)?.parts ?? [];
    for (const p of parts) {
      if (gen !== this.generation) return;
      const inl = p.inlineData ?? p.inline_data;
      if (!inl || !inl.data) continue;
      const mime = inl.mimeType ?? inl.mime_type ?? "";
      const m = /rate=(\d+)/.exec(mime);
      const rate = m ? parseInt(m[1], 10) : 24000;
      const pcm = LiveTranslateClient.fromBase64(inl.data);
      this.stats.audioPackets++;
      this.stats.audioSamples += pcm.length;
      if (this.stats.audioPackets === 1) this.on.log("First translated audio packet received", "ok");
      this.on.audio(pcm, rate);
    }
  }

  scheduleReconnect(delay) {
    if (this.closedByUs || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closedByUs) return;
      this.generation++;
      try { this.ws && this.ws.close(); } catch (e) {}
      this.ws = null;
      this.ready = false;
      this.connect();
    }, delay);
  }

  close() {
    this.closedByUs = true;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.setupTimer);
    this.reconnectTimer = null;
    this.pending = [];
    try { this.ws && this.ws.close(); } catch (e) {}
    this.ws = null;
    this.ready = false;
  }

  static toBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  static fromBase64(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const int16 = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
    const f = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f[i] = int16[i] / 0x8000;
    return f;
  }
}

self.LiveTranslateClient = LiveTranslateClient;
