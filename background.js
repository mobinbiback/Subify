
const __sby_p = (() => {
  const a = [77,111,98,105,110,98,105,98,97,107];
  return Object.freeze({
    id: a.map((n,i) => String.fromCharCode(n ^ 0)).join(''),
    stamp: 'subify-provenance-v2416'
  });
})();
// Subify — background service worker
// Pipeline: offscreen capture -> WAV chunk -> Gemini (transcribe + detect language
// + detect speaker gender + translate to Persian) -> Gemini TTS with a gender-matched
// voice -> offscreen playback with ducking.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const DEFAULT_SETTINGS = {
  apiKey: "",
  openRouterKey: "",
  openaiKey: "",
  subtitleProvider: "auto", // "auto" prefers OpenRouter, then OpenAI, then Gemini when keys exist
  openRouterModel: "openrouter/free",
  openaiModel: "gpt-5.6-luna",
  sttModel: "gemini-3.5-flash",
  ttsModel: "gemini-3.1-flash-tts-preview",
  autoVoiceByGender: true,
  maleVoice: "Charon",
  femaleVoice: "Leda",
  engine: "live",                                   // "live" | "chunked"
  autoFallback: true,                               // drop to chunked if live cannot run
  liveModel: "gemini-3.5-live-translate-preview",
  liveVoice: "auto",                                // "auto" = mirror the speaker
  liveSetupVariant: null,                           // learned on first successful connect
  frameMs: 100,
  minChunkSec: 3.5,
  maxChunkSec: 9,
  silenceGapSec: 0.35,
  silenceThresh: 0.004,
  streamTts: true,
  maxQueue: 3,
  recordSession: true,
  recordMaxSeconds: 5400,
  exportDuck: 0.18,
  exportDubGain: 1.0,
  duckLevel: 0.12,
  dubGain: 1.6,
  playbackRate: 1.0,
  skipPersian: true,
  minRms: 0.0015
};

const MODEL_MIGRATIONS = {
  "gemini-2.0-flash": "gemini-3.5-flash",
  "gemini-2.0-flash-lite": "gemini-3.1-flash-lite",
  "gemini-2.5-flash": "gemini-3.5-flash",
  "gemini-2.5-flash-lite": "gemini-3.1-flash-lite",
  // NOTE: gemini-2.5-flash-tts / gemini-2.5-pro-tts are Cloud Text-to-Speech IDs and
  // do NOT exist on generativelanguage:generateContent. Map them back.
  "gemini-2.5-flash-tts": "gemini-3.1-flash-tts-preview",
  "gemini-2.5-pro-tts": "gemini-3.1-flash-tts-preview"
};
const STT_FALLBACKS = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3-flash"];
// Current TTS model first, classic flash as one backstop. If both fail for a key,
// synthesizeWithFullFallback discovers a working model from the key itself rather
// than blindly trying more hardcoded names (which is how the stale
// "gemini-2.5-pro-tts not found" message reached a user).
const TTS_FALLBACKS = [
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-flash-preview-tts"
];

const FEMALE_VOICES = ["Leda", "Kore", "Aoede", "Zephyr"];
const MALE_VOICES = ["Charon", "Puck", "Fenrir", "Orus"];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let _subifyDbPromise = null;
function subifyDb(){
  if(_subifyDbPromise)return _subifyDbPromise;
  _subifyDbPromise=new Promise((resolve,reject)=>{const req=indexedDB.open("subify-local",2);req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains("translations"))d.createObjectStore("translations");if(!d.objectStoreNames.contains("vocab"))d.createObjectStore("vocab");if(!d.objectStoreNames.contains("shots"))d.createObjectStore("shots");if(!d.objectStoreNames.contains("storyboards"))d.createObjectStore("storyboards");};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  return _subifyDbPromise;
}
async function vocabGet(key){const d=await subifyDb();return new Promise((res,rej)=>{const r=d.transaction("vocab","readonly").objectStore("vocab").get(key);r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error);});}
async function vocabPut(key,val){const d=await subifyDb();return new Promise((res,rej)=>{const r=d.transaction("vocab","readwrite").objectStore("vocab").put(val,key);r.onsuccess=()=>res();r.onerror=()=>rej(r.error);});}
async function vocabList(){const d=await subifyDb();return new Promise(res=>{const st=d.transaction("vocab","readonly").objectStore("vocab"),out=[];st.openCursor().onsuccess=e=>{const c=e.target.result;if(!c)return res(out);out.push({key:String(c.key),value:c.value});c.continue();};});}
async function enrichWord(settings,word,sentence){
  const prompt=`Translate and explain the vocabulary item for a Persian learner. Return ONLY JSON: {"word":"","meaning":"","example":"","pos":"","level":""}. Word: ${word}\nSentence: ${sentence}\nMeaning must be concise natural Persian. Example must be a short Persian sentence.`;
  if((settings.subtitleProvider||"auto")!=="openrouter" && settings.apiKey){
    const model=settings.sttModel||STT_FALLBACKS[0];
    const r=await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(settings.apiKey)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:.15,responseMimeType:"application/json"}})});
    const raw=await r.text();if(!r.ok)throw new Error(`Gemini ${r.status}: ${raw.slice(0,220)}`);const d=JSON.parse(raw);return JSON.parse((d.candidates?.[0]?.content?.parts||[]).map(p=>p.text||"").join("").replace(/```json|```/g,"").trim());
  }
  if(settings.openRouterKey){const r=await fetch(`${OPENROUTER_BASE}/chat/completions`,{method:"POST",headers:{Authorization:`Bearer ${settings.openRouterKey}`,"Content-Type":"application/json","X-Title":"subify vocabulary"},body:JSON.stringify({model:settings.openRouterModel||"openrouter/free",messages:[{role:"user",content:prompt}],temperature:.15})});const raw=await r.text();if(!r.ok)throw new Error(`OpenRouter ${r.status}: ${raw.slice(0,220)}`);const d=JSON.parse(raw);return JSON.parse(String(d.choices?.[0]?.message?.content||"").replace(/```json|```/g,"").trim());}
  throw new Error("No Gemini or OpenRouter key saved");
}


// ---------- state (persisted: MV3 workers get evicted mid-session) ----------

const BLANK = {
  active: false, tabId: null, host: "", title: "",
  lastLang: "—", lastGender: "—", lastText: "", lastVoice: "",
  queueDepth: 0, level: 0, startedAt: 0, error: "",
  latency: 0, latAvg: 0, latSamples: 0
};

async function getState() {
  const { pd_state } = await chrome.storage.session.get("pd_state");
  return { ...BLANK, ...(pd_state || {}) };
}
async function setState(patch) {
  const s = { ...(await getState()), ...patch };
  await chrome.storage.session.set({ pd_state: s });
  chrome.runtime.sendMessage({ type: "status", state: s }).catch(() => {});
  return s;
}

// ---------- subtitle cues (for the SRT export) ----------

async function addCue(start, end, text) {
  const { pd_cues } = await chrome.storage.session.get("pd_cues");
  const cues = pd_cues || [];
  cues.push({ start, end, text });
  await chrome.storage.session.set({ pd_cues: cues });
}

// ---------- diagnostics log ----------

async function log(msg, level = "info") {
  const { pd_log } = await chrome.storage.session.get("pd_log");
  const arr = pd_log || [];
  arr.push({ t: Date.now(), level, msg: String(msg).slice(0, 300) });
  while (arr.length > 250) arr.shift();
  await chrome.storage.session.set({ pd_log: arr });
  chrome.runtime.sendMessage({ type: "log-updated" }).catch(() => {});
}

// ---------- settings ----------

async function getSettings() {
  const { pd_settings } = await chrome.storage.local.get("pd_settings");
  const s = { ...DEFAULT_SETTINGS, ...(pd_settings || {}) };
  let changed = false;
  if (MODEL_MIGRATIONS[s.sttModel]) { s.sttModel = MODEL_MIGRATIONS[s.sttModel]; changed = true; }
  if (MODEL_MIGRATIONS[s.ttsModel]) { s.ttsModel = MODEL_MIGRATIONS[s.ttsModel]; changed = true; }
  if (changed) await chrome.storage.local.set({ pd_settings: s });
  return s;
}

async function persistModel(field, model) {
  const { pd_settings } = await chrome.storage.local.get("pd_settings");
  await chrome.storage.local.set({ pd_settings: { ...(pd_settings || {}), [field]: model } });
}

// ---------- model discovery (ask the key what it actually has) ----------

async function listModels(apiKey) {
  const out = [];
  let pageToken = "";
  for (let i = 0; i < 5; i++) {
    const url = `${GEMINI_BASE.replace(/\/models$/, "")}/models?pageSize=200&key=${encodeURIComponent(apiKey)}` +
                (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ListModels ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const data = await res.json();
    for (const m of data.models || []) {
      out.push({
        id: (m.name || "").replace(/^models\//, ""),
        methods: m.supportedGenerationMethods || [],
        display: m.displayName || ""
      });
    }
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  return out;
}

function classifyModels(models) {
  const gen = models.filter(m => m.methods.includes("generateContent"));
  const tts = gen.filter(m => /tts|speech/i.test(m.id));
  const stt = gen.filter(m =>
    !/tts|speech|embed|image|imagen|veo|aqa/i.test(m.id) && /flash|pro/i.test(m.id));
  const rank = (a, b) => {
    const ver = (s) => parseFloat((s.id.match(/(\d+\.?\d*)/) || [0, 0])[1]) || 0;
    return ver(b) - ver(a);
  };
  return { tts: tts.sort(rank), stt: stt.sort(rank), all: gen };
}

async function discoverModels() {
  const settings = await getSettings();
  if (!settings.apiKey) throw new Error("No API key saved");
  const models = await listModels(settings.apiKey);
  const c = classifyModels(models);
  await chrome.storage.local.set({
    pd_models: {
      fetchedAt: Date.now(),
      tts: c.tts.map(m => m.id),
      stt: c.stt.map(m => m.id)
    }
  });
  await log(`Your key exposes ${c.all.length} generateContent models — ${c.tts.length} speech, ${c.stt.length} usable for recognition`, "ok");
  if (c.tts.length) await log("Speech models available: " + c.tts.map(m => m.id).join(", "));
  else await log("No speech-capable model found on this key — TTS will not work", "error");
  chrome.runtime.sendMessage({ type: "models-updated" }).catch(() => {});
  return c;
}

// If every hardcoded fallback 404s, ask the API what exists and use that.
async function discoveredTtsModels() {
  const { pd_models } = await chrome.storage.local.get("pd_models");
  if (pd_models && pd_models.tts && pd_models.tts.length) return pd_models.tts;
  try {
    const c = await discoverModels();
    return c.tts.map(m => m.id);
  } catch (e) {
    await log("Model discovery failed: " + (e.message || e), "error");
    return [];
  }
}

async function withModelFallback(settings, field, fallbacks, fn) {
  const tried = [settings[field], ...fallbacks.filter(m => m !== settings[field])];
  let lastErr;
  for (const model of tried) {
    try {
      const result = await fn(model);
      if (model !== settings[field]) {
        settings[field] = model;
        await persistModel(field, model);
        await log(`Model retired by Google — switched to ${model}`, "warn");
      }
      return result;
    } catch (e) {
      lastErr = e;
      // Advance to the next model only for "this model is gone/unavailable" errors.
      // A 429 (quota) or 400 (bad request) is not fixed by trying another model.
      const em = String(e.message || e);
      if (!/\b404\b|not found|is not supported|not available/i.test(em)) throw e;
    }
  }
  throw lastErr;
}

// ---------- statistics ----------

const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

async function recordStats(patch) {
  const { pd_stats } = await chrome.storage.local.get("pd_stats");
  const s = pd_stats || { totals: {}, days: {}, domains: {}, langs: {}, genders: {} };
  s.genders = s.genders || {};
  const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
  const day = (s.days[dayKey()] = s.days[dayKey()] || {});
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v !== "number") continue;
    add(s.totals, k, v);
    add(day, k, v);
  }
  const st = await getState();
  if (st.host) {
    const dom = (s.domains[st.host] = s.domains[st.host] || {});
    if (patch.seconds) add(dom, "seconds", patch.seconds);
    if (patch.chunks) add(dom, "chunks", patch.chunks);
  }
  if (patch.lang) add(s.langs, patch.lang, 1);
  if (patch.gender) add(s.genders, patch.gender, 1);
  await chrome.storage.local.set({ pd_stats: s });
}

// ---------- offscreen document (with readiness handshake) ----------

async function ensureOffscreen() {
  if (!(await chrome.offscreen.hasDocument())) {
    await log("Creating offscreen document…");
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
      justification: "Capture tab audio and play back the Persian dub."
    });
  }
  // createDocument can resolve before the page's listeners exist — poll for them.
  for (let i = 0; i < 50; i++) {
    try {
      const r = await chrome.runtime.sendMessage({ type: "offscreen-ping" });
      if (r && r.ok) return true;
    } catch (e) { /* not listening yet */ }
    await sleep(100);
  }
  throw new Error("Offscreen document never became ready");
}

// ---------- start / stop ----------

async function startDubbing(tabId) {
  try {
    await chrome.storage.session.set({ pd_log: [], pd_cues: [] });
    const settings = { ...(await getSettings()), dubbingEnabled: true };
    if (!settings.apiKey) {
      await setState({ error: "No API key — add your Gemini key in Settings." });
      await log("No API key configured", "error");
      chrome.runtime.openOptionsPage();
      return;
    }

    const tab = await chrome.tabs.get(tabId);
    let host = "";
    try { host = new URL(tab.url).hostname.replace(/^www\./, ""); } catch (e) {}
    await setState({ tabId, host, title: tab.title || "", error: "", startedAt: Date.now(),
                     lastText: "", latency: 0, latAvg: 0, latSamples: 0 });
    await log(`Starting on ${host || "tab"}`);

    if (tab.audible === false) {
      await log("Tab reports no audio — make sure the video is actually playing", "warn");
    }

    if (settings.engine !== "chunked") {
      await log(`Engine: Gemini Live Translate (${settings.liveModel}) — one streaming session`);
    } else {
      await log("Engine: chunked REST pipeline");
    }

    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
    await log("Got media stream id");

    await ensureOffscreen();
    await log("Offscreen ready — sending start command");

    const res = await chrome.runtime.sendMessage({ type: "offscreen-start", streamId, settings });
    if (!res || !res.ok) throw new Error((res && res.error) || "Offscreen did not confirm capture");

    await chrome.storage.local.set({ subify_dubbing_enabled: true });
    await setState({ active: true });
    chrome.action.setBadgeText({ text: "فا" });
    chrome.action.setBadgeBackgroundColor({ color: "#0e7a5f" });
    await recordStats({ sessions: 1 });
  } catch (e) {
    await log("Start failed: " + (e.message || e), "error");
    await chrome.storage.local.set({ subify_dubbing_enabled: false });
    await setState({ active: false, error: String(e.message || e) });
    chrome.action.setBadgeText({ text: "" });
  }
}

async function stopDubbing(reason) {
  await chrome.storage.local.set({ subify_dubbing_enabled: false });
  await setState({ active: false, queueDepth: 0, level: 0 });
  chrome.action.setBadgeText({ text: "" });
  chrome.runtime.sendMessage({ type: "offscreen-stop" }).catch(() => {});
  if (reason) await log("Stopped: " + reason);
}

// ---------- Gemini ----------

async function transcribeAndTranslate(wavB64, settings, model) {
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(settings.apiKey)}`;
  const prompt =
    "You are a live dubbing engine. The attached audio is a short clip from a video.\n" +
    "1) Detect the spoken language and return its ISO 639-1 code (en, fa, ar, tr, fr, …).\n" +
    "2) Judge the voice of the MAIN speaker from its pitch and timbre and return " +
    "\"male\", \"female\", or \"unknown\" if there is no clear speech or you cannot tell.\n" +
    "3) Translate everything spoken into natural, colloquial Persian (Farsi) suited to voice " +
    "dubbing — fluent spoken register, not literal. Keep proper names as they are.\n" +
    "If there is no intelligible speech, return an empty translation.\n" +
    "Respond with ONLY this JSON: {\"lang\":\"\",\"gender\":\"\",\"fa\":\"\"}";

  const body = {
    contents: [{
      role: "user",
      parts: [
        { text: prompt },
        { inlineData: { mimeType: "audio/wav", data: wavB64 } }
      ]
    }],
    generationConfig: { temperature: 0.2, responseMimeType: "application/json" }
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`STT ${res.status}: ${(await res.text()).slice(0, 180)}`);
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").trim();
  let parsed;
  try { parsed = JSON.parse(text.replace(/```json|```/g, "").trim()); }
  catch (e) { parsed = {}; }
  return {
    lang: (parsed.lang || "?").toLowerCase(),
    gender: (parsed.gender || "unknown").toLowerCase(),
    fa: (parsed.fa || "").trim()
  };
}

function subtitleItemsAndPrompt(cues) {
  const items = cues.map(c => ({ id: String(c.id), text: String(c.text || '').trim() })).filter(x => x.text);
  const prompt =
    "Translate each YouTube subtitle into natural, colloquial Persian (Iranian Farsi).\n" +
    "Return one result per item, preserving every id and item order. Never omit, merge, or invent items.\n" +
    "Translate the FULL meaning including verbs, tense/aspect, pronouns, negation, phrasal verbs, idioms, and technical terms. Use everyday spoken Persian, not literary/bookish or word-for-word Persian.\n" +
    "Keep names, numbers, units, URLs, code, and domain terminology accurate. Use nearby items as context when a sentence is split across cues. Output only JSON: {\"results\":[{\"id\":\"original-id\",\"fa\":\"translation\"}]}.\n" +
    JSON.stringify(items);
  return { items, prompt };
}

function parseSubtitleResults(text, provider) {
  const cleaned = String(text || "").replace(/```json|```/g, "").trim();
  if (!cleaned) throw new Error(`${provider} returned no subtitle translation text`);
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (_) {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (!match) throw new Error(`${provider} returned invalid subtitle translation JSON`);
    try { parsed = JSON.parse(match[0]); } catch (_) { throw new Error(`${provider} returned invalid subtitle translation JSON`); }
  }
  const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed.results) ? parsed.results : [];
  const out = arr.map(x => ({ id: String(x.id || ""), fa: String(x.fa || "").trim() })).filter(x => x.id && x.fa);
  if (!out.length) throw new Error(`${provider} returned an empty subtitle translation`);
  return out;
}

async function translateSubtitleCuesGemini(cues, settings, model) {
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(settings.apiKey)}`;
  const { prompt } = subtitleItemsAndPrompt(cues);
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.15, maxOutputTokens: 4096 }
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Subtitle translation ${res.status}: ${raw.slice(0, 260)}`);
  const data = JSON.parse(raw);
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").trim();
  return parseSubtitleResults(text, "Gemini");
}

async function translateSubtitleCuesOpenRouter(cues, settings) {
  if (!settings.openRouterKey) throw new Error("No OpenRouter API key saved");
  const { prompt } = subtitleItemsAndPrompt(cues);
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.openRouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://www.youtube.com/",
      "X-Title": "subify YouTube Persian subtitles"
    },
    body: JSON.stringify({
      model: settings.openRouterModel || "openrouter/free",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.15,
      max_tokens: 4096
    })
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${raw.slice(0, 260)}`);
  const data = JSON.parse(raw);
  const text = data.choices?.[0]?.message?.content || "";
  return parseSubtitleResults(text, "OpenRouter");
}



async function translateSubtitleCuesOpenAI(cues, settings) {
  if (!settings.openaiKey) throw new Error("No OpenAI API key saved");
  const { prompt } = subtitleItemsAndPrompt(cues);
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.openaiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: settings.openaiModel || "gpt-5.6-luna",
      input: [
        { role: "user", content: [{ type: "input_text", text: prompt }] }
      ],
      temperature: 0.15,
      max_output_tokens: 4096
    })
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${raw.slice(0, 260)}`);
  const data = JSON.parse(raw);
  let text = String(data.output_text || "").trim();
  if (!text && Array.isArray(data.output)) {
    text = data.output.flatMap(item => Array.isArray(item.content) ? item.content : [])
      .map(part => part?.text || "").filter(Boolean).join("\n").trim();
  }
  return parseSubtitleResults(text, "OpenAI");
}

function isQuotaOrTransientError(error) {
  const e = String(error?.message || error || "");
  return /\b(429|500|502|503|504)\b|quota|rate.?limit|temporarily unavailable|resource exhausted/i.test(e);
}

async function translateSubtitleCues(cues, settings, model) {
  const provider = settings.subtitleProvider || "auto";
  if (provider === "openrouter") return translateSubtitleCuesOpenRouter(cues, settings);
  if (provider === "openai") return translateSubtitleCuesOpenAI(cues, settings);
  if (provider === "gemini") return translateSubtitleCuesGemini(cues, settings, model);

  // Auto: keep Gemini as the first choice, but do not let a Gemini quota error
  // kill subtitle rendering when the user supplied an OpenRouter key.
  try {
    return await translateSubtitleCuesGemini(cues, settings, model);
  } catch (e) {
    if (settings.openRouterKey && isQuotaOrTransientError(e)) {
      await log("Gemini subtitle quota/temporary error — switching this batch to OpenRouter", "warn");
      return translateSubtitleCuesOpenRouter(cues, settings);
    }
    if (settings.openaiKey && isQuotaOrTransientError(e)) {
      await log("Gemini subtitle quota/temporary error — switching this batch to OpenAI", "warn");
      return translateSubtitleCuesOpenAI(cues, settings);
    }
    throw e;
  }
}

async function testGeminiKey(settings) {
  if (!settings.apiKey) throw new Error("No Gemini API key saved");
  const models = await listModels(settings.apiKey);
  const usable = models.filter(m => m.methods.includes("generateContent"));
  if (!usable.length) throw new Error("Gemini accepted the key but exposes no generateContent model");
  // Make a real, tiny generateContent request so the button tests the key itself,
  // not merely permission to list models.
  const preferred = [settings.sttModel, ...STT_FALLBACKS, ...usable.map(m => m.id)]
    .filter(Boolean);
  let last = null;
  for (const model of [...new Set(preferred)]) {
    if (!usable.some(m => m.id === model)) continue;
    try {
      const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(settings.apiKey)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Reply with exactly: OK" }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 8 }
        })
      });
      const raw = await res.text();
      if (!res.ok) { last = new Error(`Gemini ${res.status}: ${raw.slice(0, 280)}`); continue; }
      const data = JSON.parse(raw);
      const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("").trim();
      if (text) return { ok: true, model, count: usable.length, total: models.length };
      last = new Error("Gemini accepted the key but returned no text from the test request");
    } catch (e) { last = e; }
  }
  throw last || new Error("Gemini key test failed");
}

async function testOpenRouter(settings) {
  if (!settings.openRouterKey) throw new Error("No OpenRouter API key saved");
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${settings.openRouterKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://www.youtube.com/",
      "X-Title": "subify YouTube Persian subtitles"
    },
    body: JSON.stringify({
      model: settings.openRouterModel || "openrouter/free",
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      temperature: 0
    })
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${raw.slice(0, 260)}`);
  const data = JSON.parse(raw);
  const text = String(data.choices?.[0]?.message?.content || "").trim();
  if (!text) throw new Error("OpenRouter accepted the key but returned no text");
  return { ok: true, model: data.model || settings.openRouterModel || "openrouter/free" };
}

function pickVoice(settings, gender) {
  if (!settings.autoVoiceByGender) return settings.maleVoice;
  if (gender === "female") return settings.femaleVoice;
  if (gender === "male") return settings.maleVoice;
  return settings.maleVoice; // unknown -> default narration voice
}

async function synthesizePersian(text, settings, model, voice, gender) {
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(settings.apiKey)}`;
  const style = gender === "female"
    ? "با صدای زنانه و لحن طبیعی گویندهٔ دوبله بخوان"
    : "با لحن طبیعی و روان گویندهٔ دوبله بخوان";
  const body = {
    contents: [{ role: "user", parts: [{ text: `${style}: ${text}` }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
    }
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 180)}`);
  const data = await res.json();
  const part = (data.candidates?.[0]?.content?.parts || []).find(p => p.inlineData);
  if (!part) throw new Error("TTS returned no audio");
  return part.inlineData.data;
}

// Streaming synthesis: play the first audio packet as soon as it arrives
// instead of waiting for the whole utterance to finish generating.
async function synthesizePersianStream(text, settings, model, voice, gender, onPacket) {
  const url = `${GEMINI_BASE}/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(settings.apiKey)}`;
  const style = gender === "female"
    ? "با صدای زنانه و لحن طبیعی گویندهٔ دوبله بخوان"
    : "با لحن طبیعی و روان گویندهٔ دوبله بخوان";
  const body = {
    contents: [{ role: "user", parts: [{ text: `${style}: ${text}` }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
    }
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 180)}`);
  if (!res.body) throw new Error("TTS stream unsupported here");

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", packets = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let j;
      try { j = JSON.parse(payload); } catch (e) { continue; }
      for (const p of (j.candidates?.[0]?.content?.parts || [])) {
        if (p.inlineData?.data) { packets++; onPacket(p.inlineData.data); }
      }
    }
  }
  if (!packets) throw new Error("TTS stream returned no audio");
  return packets;
}

// One place that knows how to get audio out of TTS no matter what fails:
//   1. try streaming down the known list
//   2. on "streaming not supported", retry the known list single-shot
//   3. on 404 anywhere (every known model gone/unavailable for this key),
//      ask the key what it actually has and try THOSE single-shot
// The 404 net is the important part — the "gemini-2.5-pro-tts not found" report
// came from a build where this net only covered the streaming branch.
async function synthesizeWithFullFallback(settings, runStream, runOnce) {
  const streamOn = settings.streamTts !== false;

  const tryKnown = async (fn) => {
    await withModelFallback(settings, "ttsModel", TTS_FALLBACKS, fn);
  };
  const tryDiscovered = async (fn) => {
    await log("No known speech model worked on this key — asking Google which models it has…", "warn");
    const found = await discoveredTtsModels();
    if (!found.length) {
      throw new Error("This API key has no speech-capable model available. " +
        "Open Settings and press ‘Load models from my API key’ to check, or use a key with TTS access.");
    }
    await log("Using discovered speech model(s): " + found.join(", "));
    await withModelFallback(settings, "ttsModel", found, fn);
  };

  try {
    if (streamOn) await tryKnown(runStream);
    else await tryKnown(runOnce);
  } catch (e) {
    const em = String(e.message || e);
    const streamingUnsupported = /unsupported here|stream returned no audio/i.test(em);
    const notFound = /\b404\b|not found|is not supported/i.test(em);

    try {
      if (streamingUnsupported && streamOn) {
        await log("Streaming not supported here — using single-shot synthesis", "warn");
        await tryKnown(runOnce);
      } else if (notFound) {
        await tryDiscovered(runOnce);
      } else {
        throw e;
      }
    } catch (e2) {
      // Last chance: whatever went wrong on the retry, if it's a model problem, discover.
      const em2 = String(e2.message || e2);
      if (/\b404\b|not found|is not supported/i.test(em2)) {
        await tryDiscovered(runOnce);
      } else {
        throw e2;
      }
    }
  }
}

// ---------- chunk pipeline ----------

async function handleChunk(msg) {
  const st = await getState();
  if (!st.active) { await log("Chunk arrived while inactive — ignored", "warn"); return; }
  const settings = await getSettings();
  await setState({ queueDepth: (st.queueDepth || 0) + 1 });

  try {
    await log(`Sending ${msg.seconds.toFixed(1)}s to ${settings.sttModel}…`);
    const { lang, gender, fa } = await withModelFallback(settings, "sttModel", STT_FALLBACKS,
      (m) => transcribeAndTranslate(msg.wavB64, settings, m));
    await recordStats({ sttCalls: 1, chunks: 1, seconds: msg.seconds, lang, gender });
    await log(`Detected: ${lang} / ${gender}${fa ? "" : " — no speech"}`);
    await setState({ lastLang: lang, lastGender: gender });

    if (!fa) return;
    if (settings.skipPersian && lang === "fa") {
      await recordStats({ skipped: 1 });
      await setState({ lastText: "(منبع فارسی است — رد شد)" });
      await log("Source is already Persian — skipped");
      return;
    }

    const voice = pickVoice(settings, gender);
    await log(`Synthesizing with ${voice} (${gender})…`);
    const emit = (pcmB64) => chrome.runtime.sendMessage({
      type: "offscreen-play",
      chunkId: msg.chunkId,
      pcmB64,
      sampleRate: 24000,
      playbackRate: settings.playbackRate,
      duckLevel: settings.duckLevel
    }).catch(() => {});

    const runStream = (m) => synthesizePersianStream(fa, settings, m, voice, gender, emit);
    const runOnce = async (m) => { emit(await synthesizePersian(fa, settings, m, voice, gender)); return 1; };

    await synthesizeWithFullFallback(settings, runStream, runOnce);
    await recordStats({ ttsCalls: 1, chars: fa.length });
    await setState({ lastText: fa, lastVoice: voice });
    await addCue(msg.startSec, msg.startSec + msg.seconds, fa);
  } catch (e) {
    const m = String(e.message || e);
    await log("Pipeline error: " + m, "error");
    await setState({ error: m.slice(0, 200) });
    await recordStats({ errors: 1 });
  } finally {
    const s2 = await getState();
    await setState({ queueDepth: Math.max(0, (s2.queueDepth || 1) - 1) });
  }
}

// ---------- self-test ----------

async function selfTest() {
  await chrome.storage.session.set({ pd_log: [] });
  await log("Self-test started");
  try {
    const settings = await getSettings();
    if (!settings.apiKey) throw new Error("No API key saved");
    await ensureOffscreen();
    await log("Offscreen ready");
    const voice = settings.femaleVoice;
    const speak = (m) => synthesizePersian("سلام. این یک آزمایش صدای دوبلهٔ فارسی است.", settings, m, voice, "female");
    let pcmB64;
    try {
      pcmB64 = await withModelFallback(settings, "ttsModel", TTS_FALLBACKS, speak);
    } catch (e) {
      if (!/\b404\b|not found|is not supported/i.test(String(e.message || e))) throw e;
      await log("Known speech models unavailable — discovering from your key…", "warn");
      const found = await discoveredTtsModels();
      if (!found.length) {
        throw new Error("This API key has no speech-capable model available. Use a key with TTS access.");
      }
      pcmB64 = await withModelFallback(settings, "ttsModel", found, speak);
    }
    await log("TTS returned audio — playing now", "ok");
    chrome.runtime.sendMessage({
      type: "offscreen-play", pcmB64, sampleRate: 24000, playbackRate: 1, duckLevel: 1
    }).catch(() => {});
    await log("Self-test passed — if you heard Persian speech, key, model and playback all work.", "ok");
  } catch (e) {
    await log("Self-test failed: " + (e.message || e), "error");
  }
}

// ---------- messaging ----------

chrome.runtime.onConnect.addListener((p) => {
  if (p.name === "subify-keepalive") p.onMessage.addListener(() => {});
});


async function testOpenAI(settings) {
  if (!settings.openaiKey) throw new Error("No OpenAI API key saved");
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Authorization": `Bearer ${settings.openaiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: settings.openaiModel || "gpt-5.6-luna", input: "Reply with exactly: OK" })
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${raw.slice(0, 260)}`);
  const data = JSON.parse(raw);
  const text = String(data.output_text || "").trim();
  if (!text) throw new Error("OpenAI accepted the key but returned no text");
  return { ok: true, model: data.model || settings.openaiModel || "gpt-5.6-luna" };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "subify-translate": {
        try {
          const settings = await getSettings();
          const cues = Array.isArray(msg.cues) ? msg.cues.slice(0, 12) : [];
          if (!cues.length) { sendResponse({ ok: true, results: [] }); break; }
          const provider = settings.subtitleProvider || "auto";
          if (provider === "openrouter") {
            if (!settings.openRouterKey) throw new Error("OpenRouter is selected, but no OpenRouter API key is saved");
            const results = await translateSubtitleCuesOpenRouter(cues, settings);
            sendResponse({ ok: true, provider: "openrouter", results });
            break;
          }
          if (provider === "openai") {
            if (!settings.openaiKey) throw new Error("OpenAI is selected, but no OpenAI API key is saved");
            const results = await translateSubtitleCuesOpenAI(cues, settings);
            sendResponse({ ok: true, provider: "openai", results });
            break;
          }
          if (provider === "gemini" && !settings.apiKey) throw new Error("Gemini انتخاب شده، اما کلید Gemini ذخیره نشده است");
          if (provider === "auto" && !settings.apiKey && !settings.openRouterKey && !settings.openaiKey) throw new Error("هیچ کلید Gemini، OpenRouter یا OpenAI ذخیره نشده است");
          let results, usedProvider;
          if (provider === "auto") {
            // Auto deliberately does NOT prefer Gemini. Use the explicitly configured
            // alternatives first, then fall back to Gemini when it is the only/last option.
            if (settings.openRouterKey) { results = await translateSubtitleCuesOpenRouter(cues, settings); usedProvider = "openrouter"; }
            else if (settings.openaiKey) { results = await translateSubtitleCuesOpenAI(cues, settings); usedProvider = "openai"; }
            else {
              const chosen = settings.geminiSubtitleModel || settings.sttModel;
              results = await withModelFallback({ ...settings, sttModel: chosen }, "sttModel", [chosen, ...STT_FALLBACKS], (m) => translateSubtitleCues(cues, { ...settings, subtitleProvider: "gemini" }, m));
              usedProvider = "gemini";
            }
          } else {
            if (provider === "gemini") {
              const chosen = settings.geminiSubtitleModel || settings.sttModel;
              results = await withModelFallback({ ...settings, sttModel: chosen }, "sttModel", [chosen, ...STT_FALLBACKS], (m) => translateSubtitleCues(cues, { ...settings, subtitleProvider: provider }, m));
            } else {
              results = await (provider === "openrouter" ? translateSubtitleCuesOpenRouter(cues, settings) : translateSubtitleCuesOpenAI(cues, settings));
            }
            usedProvider = provider;
          }
          sendResponse({ ok: true, provider: usedProvider, results });
        } catch (e) {
          await log("Subtitle translation failed: " + (e.message || e), "error");
          sendResponse({ ok: false, error: String(e.message || e) });
        }
        break;
      }
      case "subify-test-key": {
        try {
          const settings = await getSettings();
          const result = await testGeminiKey(settings);
          await log(`Gemini key valid — test model: ${result.model}; ${result.count} generateContent models / ${result.total} total.`, "ok");
          sendResponse(result);
        } catch (e) {
          await log("Gemini key test failed: " + (e.message || e), "error");
          sendResponse({ ok: false, error: String(e.message || e) });
        }
        break;
      }
      case "subify-test-openai": {
        try {
          const settings = await getSettings();
          const result = await testOpenAI(settings);
          await log(`OpenAI key valid — model: ${result.model}`, "ok");
          sendResponse(result);
        } catch (e) {
          await log("OpenAI key test failed: " + (e.message || e), "error");
          sendResponse({ ok: false, error: String(e.message || e) });
        }
        break;
      }
      case "subify-test-openrouter": {
        try {
          const settings = await getSettings();
          const result = await testOpenRouter(settings);
          await log(`OpenRouter connected — model: ${result.model}`, "ok");
          sendResponse(result);
        } catch (e) {
          await log("OpenRouter test failed: " + (e.message || e), "error");
          sendResponse({ ok: false, error: String(e.message || e) });
        }
        break;
      }
      case "subify-capture-shot": {
        try {
          const tabId=Number(msg.tabId); const tab=await chrome.tabs.get(tabId);
          const dataUrl=await chrome.tabs.captureVisibleTab(tab.windowId,{format:"png"});
          const id=`shot_${Date.now()}`;
          await chrome.storage.session.set({subify_last_shot:{id,dataUrl,title:tab.title||"Subify",url:tab.url||"",createdAt:Date.now()}});
          if(msg.download!==false) await chrome.downloads.download({url:dataUrl,filename:`Subify-${Date.now()}.png`,saveAs:true});
          sendResponse({ok:true,id,dataUrl});
        } catch(e){sendResponse({ok:false,error:String(e.message||e)});} break;
      }
      case "subify-vocab-enrich": {
        try { const settings=await getSettings(); const word=String(msg.word||"").trim(); if(!word)throw new Error("Word is empty"); const info=await enrichWord(settings,word,String(msg.sentence||"")); const key=`${String(msg.lang||"auto").split("-")[0]}:${word.toLowerCase()}`; const old=await vocabGet(key); const card={...(old||{}),word,lang:String(msg.lang||"auto").split("-")[0],meaning:String(info.meaning||""),example:String(info.example||""),pos:String(info.pos||""),level:String(info.level||""),sentence:String(msg.sentence||""),translation:String(msg.translation||""),box:old?.box||1,nextDueAt:old?.nextDueAt||Date.now(),updatedAt:Date.now(),history:old?.history||[]}; await vocabPut(key,card); sendResponse({ok:true,card}); } catch(e){sendResponse({ok:false,error:String(e.message||e)});} break;
      }
      case "subify-vocab-list": { try { const rows=await vocabList(); sendResponse({ok:true,rows:rows.map(x=>x.value)}); } catch(e){sendResponse({ok:false,error:String(e.message||e)});} break; }
      case "subify-vocab-grade": { try { const key=String(msg.key||""); const c=await vocabGet(key); if(!c)throw new Error("Card not found"); const grade=String(msg.grade||"again"); const box=Math.max(1,Math.min(5,Number(c.box||1)+(grade==="again"?-1:grade==="easy"?2:1))); const days=[0,1,3,7,14,30][box]||30; c.box=box;c.nextDueAt=Date.now()+days*86400000;c.lastGradedAt=Date.now();c.history=[...(c.history||[]),{grade,at:Date.now(),box}].slice(-30);await vocabPut(key,c);sendResponse({ok:true,card:c}); } catch(e){sendResponse({ok:false,error:String(e.message||e)});} break; }
      case "popup-start": {
        // Master button starts only the subtitle engine. Subtitle extraction
        // reads YouTube's timed caption track and does NOT capture tab audio.
        await chrome.storage.local.set({ subify_subtitle_enabled: true });
        try { await chrome.tabs.sendMessage(msg.tabId, { type: "subify-enable-subtitles" }); } catch (_) {}
        await setState({ error: "" });
        break;
      }
      case "popup-stop": {
        await chrome.storage.local.set({ subify_subtitle_enabled: false, subify_dubbing_enabled: false });
        await stopDubbing("stopped by user");
        try { await chrome.tabs.sendMessage(msg.tabId, { type: "subify-disable-subtitles" }); } catch (_) {}
        break;
      }
      case "popup-get-status": {
        const state = await setState({});
        sendResponse({ ok: true, state });
        break;
      }
      case "subify-set-dubbing": {
        const enabled = Boolean(msg.enabled);
        await chrome.storage.local.set({ subify_dubbing_enabled: enabled });
        if (enabled) await startDubbing(msg.tabId);
        else await stopDubbing("dubbing disabled");
        break;
      }
      case "popup-self-test": await selfTest(); break;
      case "popup-test-live": {
        await chrome.storage.session.set({ pd_log: [] });
        try {
          const s = await getSettings();
          if (!s.apiKey) { await log("No API key saved", "error"); break; }
          await ensureOffscreen();
          await chrome.runtime.sendMessage({ type: "offscreen-test-live", settings: s });
        } catch (e) { await log("Live test failed: " + (e.message || e), "error"); }
        break;
      }
      case "popup-discover-models":
        try { await discoverModels(); }
        catch (e) { await log("Discovery failed: " + (e.message || e), "error"); }
        break;
      case "chunk": await handleChunk(msg); break;
      case "level": await setState({ level: msg.rms }); break;
      case "latency": {
        const st = await getState();
        const n = (st.latSamples || 0) + 1;
        const avg = ((st.latAvg || 0) * (n - 1) + msg.seconds) / n;
        await setState({ latency: msg.seconds, latAvg: avg, latSamples: n });
        break;
      }
      case "popup-export": {
        try {
          await ensureOffscreen();
          const r = await chrome.runtime.sendMessage({ type: "offscreen-export", mode: msg.mode });
          if (!r || !r.ok || !r.url) {
            await log("Export failed: " + ((r && r.error) || "nothing to export"), "error");
            break;
          }
          if (!chrome.downloads || !chrome.downloads.download) {
            await log("Downloads permission missing — reload the extension after updating.", "error");
            break;
          }
          try {
            const id = await chrome.downloads.download({
              url: r.url, filename: msg.filename, saveAs: true
            });
            await log(`Saving ${msg.filename} — ${(r.bytes / 1048576).toFixed(1)} MB (download ${id})`, "ok");
          } catch (dlErr) {
            // Some Chrome builds reject cross-context blob URLs here; let the
            // page that asked for the export save it directly instead.
            await log("Downloads API refused the blob — saving from the page instead", "warn");
            chrome.runtime.sendMessage({
              type: "export-fallback", url: r.url, filename: msg.filename
            }).catch(() => {});
          }
          await recordStats({ exports: 1 });
        } catch (e) {
          await log("Export failed: " + (e.message || e), "error");
        }
        break;
      }
      case "log": await log(msg.msg, msg.level); break;
      case "capture-started": await log("Capture confirmed by offscreen", "ok"); break;
      case "live-ready": {
        await setState({ error: "" });
        if (Number.isInteger(msg.schemaVariant)) {
          const s = await getSettings();
          if (s.liveSetupVariant !== msg.schemaVariant) {
            await chrome.storage.local.set({
              pd_settings: { ...s, liveSetupVariant: msg.schemaVariant }
            });
            await log(`Remembered working setup schema (variant ${msg.schemaVariant}) — next session connects straight away`);
          }
        }
        break;
      }
      case "live-fatal":
      case "live-no-audio": {
        const s = await getSettings();
        const st = await getState();
        if (!st.active) break;
        if (s.autoFallback === false) {
          await setState({ error: "Live engine failed — " + (msg.error || "no audio returned") });
          await log("Auto-fallback is off, so dubbing has stopped.", "error");
          await stopDubbing("live engine failed");
          break;
        }
        await log("Falling back to the chunked engine so you still get audio…", "warn");
        await chrome.storage.local.set({ pd_settings: { ...s, engine: "chunked" } });
        const tabId = st.tabId;
        await stopDubbing("switching engine");
        if (tabId != null) {
          await new Promise(r => setTimeout(r, 600));
          await startDubbing(tabId);
          await log("Now running on the chunked engine. Re-enable Live in Settings once your key has access.", "warn");
        }
        break;
      }
      case "live-input":
        if (msg.lang) {
          const prev = (await getState()).lastLang;
          const code = String(msg.lang).split("-")[0].toLowerCase();
          await setState({ lastLang: code });
          if (code !== prev) await recordStats({ lang: code });
        }
        await recordStats({ liveInputChars: (msg.text || "").length });
        break;
      case "live-output": {
        const st2 = await getState();
        const acc = ((st2.lastText || "") + msg.text).slice(-400);
        await setState({ lastText: acc });
        await recordStats({ chars: (msg.text || "").length });
        break;
      }
      case "live-cue":
        await addCue(msg.start, msg.end, msg.text);
        await setState({ lastText: msg.text });
        await recordStats({ chunks: 1, seconds: Math.max(0, msg.end - msg.start) });
        break;
      case "capture-ended": await stopDubbing("tab audio ended"); break;
      case "capture-error":
        await setState({ error: msg.error || "Capture failed" });
        await stopDubbing("capture error");
        break;
    }
  })();
  return true;
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const s = await getState();
  if (s.active && tabId === s.tabId) stopDubbing("tab closed");
});
