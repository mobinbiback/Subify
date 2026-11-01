var browser = globalThis.browser || globalThis.chrome; // Chrome has no browser global; same APIs live on chrome.*

// Subify — background service worker
// Pipeline: offscreen capture -> WAV chunk -> Gemini (transcribe + detect language
// + detect speaker gender + translate to Persian) -> Gemini TTS with a gender-matched
// voice -> offscreen playback with ducking.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

// Show What's New after an update, and at browser startup until the user acknowledges it.
// The acknowledgement is stored per extension version so the page does not keep reopening.
const WHATSNEW_SEEN_KEY = "subify_whatsnew_seen_version";
async function openWhatsNewIfNeeded(force = false) {
  try {
    const version = browser.runtime.getManifest().version;
    const stored = await browser.storage.local.get(WHATSNEW_SEEN_KEY);
    if (force || stored?.[WHATSNEW_SEEN_KEY] !== version) {
      await browser.tabs.create({ url: browser.runtime.getURL("whatsnew.html") });
    }
  } catch (_) {}
}

browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === "update") {
    browser.storage.local.set({ [WHATSNEW_SEEN_KEY]: "" }).then(() => openWhatsNewIfNeeded(true)).catch(() => {});
  }
});

browser.runtime.onStartup.addListener(() => {
  openWhatsNewIfNeeded(false);
});


const DEFAULT_SETTINGS = {
  apiKey: "",
  openRouterKey: "",
  openaiKey: "",
  subtitleProvider: "auto", // "auto" prefers OpenRouter, then OpenAI, then Gemini when keys exist
  targetLanguage: "fa",     // subtitle + dubbing output language — see LANGUAGE_NAMES below
  openRouterModel: "openrouter/free",
  openaiModel: "gpt-5.6-luna",
  customProviders: [],
  customProviderId: "",
  dubbingAudioEnabled: true, // false = "captions only": Live engine still runs (Gemini's live-translate model is audio-in/audio-out, no text-only mode to ask for instead), we just don't play the dubbed audio locally — see offscreen.js playLiveAudio()
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
  duckLevel: 0.20,
  dubGain: 1.6,
  playbackRate: 1.0,
  skipPersian: true,
  skipLangs: "",
  subtitleDomain: "general",
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

// "Clear all data" — see PRIVACY.md. This wipes everything the extension
// stores under its own origin (settings incl. API keys, stats, vocab/shots/
// storyboards IndexedDB). It also asks any open YouTube tabs to wipe their
// own on-page translation cache — that IndexedDB lives under youtube.com's
// origin (content scripts see the page's storage, not the extension's), so
// it can't be reached from here directly. A pending-clear flag covers tabs
// that aren't open right now; subtitle-overlay.js checks it on load.
const LOCAL_KEYS_TO_CLEAR = ["pd_models","pd_settings","pd_stats","subify_dubbing_enabled","subify_last_shot","subify_settings","subify_subtitle_enabled","subifyPageCache","subify_install_id","subify_telemetry_last"];
async function clearAllLocalData(){
  // Server copy: when signed in, the account's vocabulary and tickets are deleted on the server too.
  // Vocabulary is cleared with tombstones, so other devices remove their copies on their next sync.
  // Returns null when not signed in, true when the server confirmed, false when it could not be reached.
  let serverDeleted = null;
  try {
    const res = await fetch(SUBIFY_SITE + "/auth/account-data.php", {
      method: "POST", credentials: "include", headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ scope: "all" })
    });
    if (res.status !== 401) {
      const data = await res.json().catch(() => null);
      serverDeleted = !!(res.ok && data && data.ok);
    }
  } catch (e) { serverDeleted = false; }
  try{
    const tabs=await browser.tabs.query({url:["https://www.youtube.com/*","https://www.youtube-nocookie.com/*","https://vimeo.com/*","https://*.vimeo.com/*","https://player.vimeo.com/*","https://www.aparat.com/*","https://aparat.com/*","https://www.coursera.org/*","https://meet.google.com/*","https://*.zoom.us/*","https://teams.microsoft.com/*","https://teams.live.com/*","https://*.webex.com/*"]});
    await Promise.all(tabs.map(t=>browser.tabs.sendMessage(t.id,{type:"subify-clear-local-cache"}).catch(()=>{})));
  }catch(e){}
  if(_subifyDbPromise){ try{ (await _subifyDbPromise).close(); }catch(e){} }
  _subifyDbPromise=null;
  await new Promise(resolve=>{ const req=indexedDB.deleteDatabase("subify-local"); req.onsuccess=req.onerror=req.onblocked=()=>resolve(); });
  await browser.storage.local.remove(LOCAL_KEYS_TO_CLEAR);
  await browser.storage.session.clear();
  await browser.storage.local.set({ subify_pending_clear: true });
  await log("All local Subify data cleared by the user.", "warn");
  return serverDeleted;
}
// One text-in/text-out call routed through whichever provider the user
// picked for subtitles (Gemini / OpenRouter / OpenAI / custom OpenAI-compatible).
// In "auto" every configured provider is tried in turn.
async function callTextLLM(settings,prompt,opts={}){
  const want=settings.subtitleProvider||"auto";
  // No key of the learner's own at all (word cards, grammar, explanations): the owner's key on the server, within the free allowance.
  const hasOwnKey=!!(settings.apiKey||settings.openRouterKey||settings.openaiKey||(getCustomProvider(settings)||{}).apiKey);
  if(!hasOwnKey){
    const free=await subifyPracticeFree({feature:"",messages:[{role:"user",content:prompt}],temperature:opts.fast?0.1:0.15,maxTokens:Number(opts.maxTokens)||2048});
    if(free.ok){
      // A reply cut at the token limit is not valid JSON for the callers: say so instead of a parse error.
      if(free.cut) throw new Error("پاسخ هوش مصنوعی کامل نشد؛ دوباره امتحان کن");
      return free.text;
    }
    throw new Error(free.error||"AI is not available");
  }
  const runners={
    gemini:async()=>{
      if(!settings.apiKey) throw new Error("No Gemini key");
      const model=settings.sttModel||STT_FALLBACKS[0];
      const gen={temperature:.15,responseMimeType:"application/json"}; if(opts.fast) gen.thinkingConfig={thinkingBudget:0};
      let r=await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(settings.apiKey)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:gen})});
      let raw=await r.text();
      if(!r.ok && opts.fast && r.status===400 && /thinking/i.test(raw)){ delete gen.thinkingConfig; r=await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(settings.apiKey)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:gen})}); raw=await r.text(); }
      if(!r.ok) throw new Error(`Gemini ${r.status}: ${raw.slice(0,200)}`);
      return (JSON.parse(raw).candidates?.[0]?.content?.parts||[]).map(p=>p.text||"").join("");
    },
    openrouter:async()=>{
      if(!settings.openRouterKey) throw new Error("No OpenRouter key");
      const r=await fetch(`${OPENROUTER_BASE}/chat/completions`,{method:"POST",headers:{Authorization:`Bearer ${settings.openRouterKey}`,"Content-Type":"application/json","X-Title":"subify vocabulary"},body:JSON.stringify({model:settings.openRouterModel||"openrouter/free",messages:[{role:"user",content:prompt}],temperature:.15})});
      const raw=await r.text(); if(!r.ok) throw new Error(`OpenRouter ${r.status}: ${raw.slice(0,200)}`);
      return String(JSON.parse(raw).choices?.[0]?.message?.content||"");
    },
    openai:async()=>{
      if(!settings.openaiKey) throw new Error("No OpenAI key");
      const r=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${settings.openaiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:settings.openaiModel||"gpt-5.6-luna",input:[{role:"user",content:[{type:"input_text",text:prompt}]}],temperature:.15,max_output_tokens:opts.maxTokens||1500})});
      const raw=await r.text(); if(!r.ok) throw new Error(`OpenAI ${r.status}: ${raw.slice(0,200)}`);
      const d=JSON.parse(raw); let t=String(d.output_text||"").trim();
      if(!t&&Array.isArray(d.output)) t=d.output.flatMap(i=>Array.isArray(i.content)?i.content:[]).map(x=>x?.text||"").join("\n");
      return t;
    },
    custom:async()=>{
      const p=getCustomProvider(settings);
      if(!p||!p.apiKey||!p.model) throw new Error("Custom API not configured");
      const base=normalizeCustomBaseUrl(p.baseUrl);
      const url=/\/chat\/completions$/i.test(base)?base:`${base}/chat/completions`;
      const r=await fetch(url,{method:"POST",headers:{Authorization:`Bearer ${p.apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:p.model,messages:[{role:"user",content:prompt}],temperature:.15,max_tokens:opts.maxTokens||1500})});
      const raw=await r.text(); if(!r.ok) throw new Error(`Custom API ${r.status}: ${raw.slice(0,200)}`);
      const d=JSON.parse(raw); return String(d.choices?.[0]?.message?.content||d.output_text||"");
    }
  };
  const order=want==="auto"?["gemini","openrouter","openai","custom"]:[want,...["gemini","openrouter","openai","custom"].filter(x=>x!==want)];
  let lastErr=null;
  for(const name of order){
    try{ const text=await runners[name](); if(String(text).trim()) return text; }
    catch(e){ lastErr=e; if(name===want) await log(`vocab: ${name} failed: ${e.message}`,"warn"); }
  }
  throw lastErr||new Error("No AI provider configured");
}

function parseJsonLoose(text){
  const t=String(text||"").replace(/```json|```/g,"").trim();
  try{ return JSON.parse(t); }catch(_){}
  const m=t.match(/\{[\s\S]*\}/); if(m) return JSON.parse(m[0]);
  throw new Error("AI reply was not valid JSON");
}

async function fetchDictionaryFallback(word, lang, translation="") {
  const cleanWord = String(word || "").trim();
  const base = { word: cleanWord, lemma: cleanWord, ipa: "", pos: "", meaning: String(translation || "").trim(), definition: "", synonyms: [], example: "", exampleFa: "", forms: "", note: "", level: "", enriched: false };
  if (!cleanWord || !/^[A-Za-z][A-Za-z' -]*$/.test(cleanWord)) return base;
  try {
    const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(cleanWord)}`);
    if (r.ok) {
      const data = await r.json();
      const entry = Array.isArray(data) ? data[0] : null;
      const phon = entry?.phonetics?.find(x => x?.text)?.text || "";
      const meanings = Array.isArray(entry?.meanings) ? entry.meanings : [];
      const m = meanings.find(x => Array.isArray(x?.definitions) && x.definitions.some(d => d?.definition)) || meanings[0];
      const defs = Array.isArray(m?.definitions) ? m.definitions : [];
      const d = defs.find(x => x?.definition) || defs[0] || {};
      const allDefs = meanings.flatMap(x => Array.isArray(x?.definitions) ? x.definitions : []);
      const synonyms = [...new Set([...(m?.synonyms || []), ...(d?.synonyms || []), ...allDefs.flatMap(x => x?.synonyms || [])].filter(Boolean))].slice(0,4);
      const example = d?.example || defs.find(x => x?.example)?.example || allDefs.find(x => x?.example)?.example || "";
      const forms = Array.isArray(entry?.meanings) ? entry.meanings.flatMap(x => Array.isArray(x?.definitions) ? x.definitions : []).map(x => x?.example).filter(Boolean).slice(0,0) : [];
      base.lemma = String(entry?.word || cleanWord);
      base.ipa = phon;
      base.pos = String(m?.partOfSpeech || "");
      base.definition = String(d?.definition || "");
      base.synonyms = synonyms;
      base.example = String(example || "");
      base.forms = forms.join(" · ");
      base.note = "تعریف و نقش دستوری از واژه‌نامهٔ انگلیسی؛ معنی فارسی از متن/ترجمهٔ Subify.";
      if (base.pos === "noun") base.pos = "اسم";
      else if (base.pos === "verb") base.pos = "فعل";
      else if (base.pos === "adjective") base.pos = "صفت";
      else if (base.pos === "adverb") base.pos = "قید";
      else if (base.pos === "pronoun") base.pos = "ضمیر";
      else if (base.pos === "preposition") base.pos = "حرف اضافه";
      else if (base.pos === "conjunction") base.pos = "حرف ربط";
      else if (base.pos === "interjection") base.pos = "صوت";
      else if (base.pos === "article") base.pos = "حرف تعریف";
    }
  } catch (_) {}
  // If a translation is available, keep it as the visible Persian sense.
  if (!base.meaning && translation) base.meaning = String(translation).trim();
  return base;
}

// ---------- begin contextual grammar ----------
const grammarCache = new Map(); // "lang|cefr|explainLang|sentence|prev|next" -> grammar, kept for this worker's lifetime
const GRAMMAR_CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"]; // same list as CEFR_LEVELS in learning-core.js (background cannot import it)
// Same codes as LANG_CODES / LANG_NAMES_EN in learning-core.js: grammar explanations can be written in any of them.
const GRAMMAR_LANG_NAMES = {
  fa: "Persian (Farsi)", en: "English", ar: "Arabic", tr: "Turkish", es: "Spanish", fr: "French", de: "German",
  it: "Italian", pt: "Portuguese", ru: "Russian", ja: "Japanese", ko: "Korean", zh: "Chinese", hi: "Hindi"
};
function cleanGrammarText(v) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, 600); }
async function explainSentenceGrammar(settings, sentence, prev, next, translation, lang, cefr, explainLang) {
  const explainName = GRAMMAR_LANG_NAMES[explainLang] || GRAMMAR_LANG_NAMES.fa;
  const prompt =
    `You are a patient language teacher. A learner clicked one subtitle sentence in a video. ` +
    `Explain the grammar of THIS sentence, and use the neighbouring lines so the meaning in context is right. ` +
    `Write every explanation in clear ${explainName}. Keep example sentences in the source language.\n\n` +
    `Return ONLY JSON with exactly these keys:\n` +
    `{"meaning":"","tense":"","structure":"","grammar":"","why":"","natural":[],"simpler":"","advanced":""}\n\n` +
    `Source language: ${lang || "auto"}\n` +
    `Learner CEFR level: ${cefr}. Pitch every explanation and alternative at this level.\n` +
    `Sentence: ${sentence}\n` +
    `Previous line: ${prev || "-"}\n` +
    `Next line: ${next || "-"}\n` +
    `Translation shown to the learner: ${translation || "-"}\n\n` +
    `- "meaning": what the sentence means in ${explainName}, in this context.\n` +
    `- "tense": the verb tense or aspect used and why it fits here; "" if the sentence has no verb.\n` +
    `- "structure": the parts of the sentence in order (subject, verb, object, clauses, modifiers).\n` +
    `- "grammar": the main grammar rule(s) this sentence uses, explained simply.\n` +
    `- "why": why this structure is used here (context, emphasis, politeness, or style).\n` +
    `- "natural": up to 2 natural ways to say the same thing, in the source language.\n` +
    `- "simpler": one simpler sentence with the same meaning, in the source language.\n` +
    `- "advanced": one more advanced or formal sentence with the same meaning, in the source language.\n` +
    `Keep each field short (about 60 words at most). Do not invent context that the lines do not show.`;
  const info = parseJsonLoose(await callTextLLM(settings, prompt));
  return {
    meaning: cleanGrammarText(info.meaning),
    tense: cleanGrammarText(info.tense),
    structure: cleanGrammarText(info.structure),
    grammar: cleanGrammarText(info.grammar),
    why: cleanGrammarText(info.why),
    natural: (Array.isArray(info.natural) ? info.natural : []).map(cleanGrammarText).filter(Boolean).slice(0, 2),
    simpler: cleanGrammarText(info.simpler),
    advanced: cleanGrammarText(info.advanced)
  };
}
// ---------- end contextual grammar ----------

async function enrichWord(settings,word,sentence,sourceLine=""){
  // r21: a word clicked in a subtitle keeps that line as its example. The model only translates it then.
  const line=String(sourceLine||"").trim();
  const prompt=
    `You are a bilingual English–Persian dictionary. A Persian-speaking learner clicked the word/phrase below inside a real ` +
    `sentence. Give a COMPLETE dictionary entry for it as used in THIS sentence. Return ONLY JSON with exactly these keys:\n` +
    `{"word":"","lemma":"","ipa":"","pos":"","meaning":"","definition":"","synonyms":[],"example":"","exampleFa":"","forms":"","note":"","level":"","collocations":[],"example2":"","example2Fa":"","mistakes":[{"wrong":"","right":"","note":""}],"contextNote":"","tags":[]}\n\n` +
    `Word: ${word}\nSentence: ${sentence}\n\n` +
    `- "lemma": base/dictionary form (e.g. running -> run).\n` +
    `- "ipa": IPA pronunciation of the lemma between slashes, or "" if the source language is not English.\n` +
    `- "pos": grammatical role IN THIS SENTENCE, one short Persian label: اسم، فعل، صفت، قید، ضمیر، حرف اضافه، حرف ربط، حرف تعریف، صوت، عبارت. Never empty.\n` +
    `- "meaning": precise natural Persian meaning for THIS sentence (one clear sense; up to 3 short Persian equivalents separated by «،»).\n` +
    `- "definition": one simple definition in the source language (max 20 words).\n` +
    `- "synonyms": up to 4 source-language synonyms.\n` +
    (line
      ? `- "example": copy this exact line and do not write a new one: ${line}\n`
      : `- "example": one NEW short example sentence in the source language using the word.\n`) +
    `- "exampleFa": Persian translation of the example.\n` +
    `- "forms": useful inflections (e.g. "run / ran / run / running" or "plural: children"), or "".\n` +
    `- "note": one short Persian usage tip (idiom, register, common collocation, confusion with a similar word), or "".\n` +
    `- "level": one of: مبتدی، متوسط، پیشرفته.\n` +
    `- "collocations": 2 or 3 short phrases the word often goes with, in the source language.\n` +
    `- "example2" and "example2Fa": a second, different short example sentence in the source language, and its Persian translation.\n` +
    `- "mistakes": 0 to 2 common learner mistakes with this word. Each has "wrong" (the wrong form), "right" (the correct form) and "note" (a short Persian reason). [] if none.\n` +
    `- "contextNote": one short Persian note on when and where people use it (formal or casual, spoken or written), or "".\n` +
    `- "tags": 0 to 3 keys, only from: travel, food, work, study, family, health, technology, money, feelings, nature. [] if none fits.`;
  return parseJsonLoose(await callTextLLM(settings,prompt,{fast:true}));
}


// ---------- state (persisted: MV3 workers get evicted mid-session) ----------

const BLANK = {
  active: false, tabId: null, host: "", title: "",
  lastLang: "…", lastGender: "…", lastText: "", lastVoice: "",
  queueDepth: 0, level: 0, startedAt: 0, error: "",
  latency: 0, latAvg: 0, latSamples: 0
};

async function getState() {
  const { pd_state } = await browser.storage.session.get("pd_state");
  return { ...BLANK, ...(pd_state || {}) };
}
async function setState(patch) {
  const s = { ...(await getState()), ...patch };
  await browser.storage.session.set({ pd_state: s });
  browser.runtime.sendMessage({ type: "status", state: s }).catch(() => {});
  return s;
}

// ---------- subtitle cues (for the SRT export) ----------

async function addCue(start, end, text) {
  const { pd_cues } = await browser.storage.session.get("pd_cues");
  const cues = pd_cues || [];
  cues.push({ start, end, text });
  await browser.storage.session.set({ pd_cues: cues });
}

// ---------- diagnostics log ----------

async function log(msg, level = "info") {
  const { pd_log } = await browser.storage.session.get("pd_log");
  const arr = pd_log || [];
  arr.push({ t: Date.now(), level, msg: String(msg).slice(0, 300) });
  while (arr.length > 250) arr.shift();
  await browser.storage.session.set({ pd_log: arr });
  browser.runtime.sendMessage({ type: "log-updated" }).catch(() => {});
}

// ---------- settings ----------

async function getSettings() {
  const { pd_settings, subify_settings } = await browser.storage.local.get(["pd_settings", "subify_settings"]);
  const s = { ...DEFAULT_SETTINGS, ...(pd_settings || {}) };
  // targetLanguage is edited from the popup's language selectors and the
  // in-player panel, both of which write to subify_settings (the subtitle
  // style/behavior bucket), not pd_settings (the API-key/model bucket this
  // function otherwise reads). Every consumer of getSettings() — subtitle
  // translation, chunked dubbing, and the Live engine — needs the real
  // value here, or it silently always translates to Persian regardless of
  // what the user picked.
  if (subify_settings && subify_settings.targetLanguage) s.targetLanguage = subify_settings.targetLanguage;
  // Same bridge, for the same reason: translationTone and glossary are also
  // edited from the popup and land in subify_settings, not pd_settings.
  if (subify_settings && subify_settings.translationTone) s.translationTone = subify_settings.translationTone;
  if (subify_settings && Array.isArray(subify_settings.glossary)) s.glossary = subify_settings.glossary;
  let changed = false;
  // Upgrade only the extension's former built-in defaults.
  if (s.sttModel === "gemini-3.1-flash-lite") { s.sttModel = DEFAULT_SETTINGS.sttModel; changed = true; }
  if (s.ttsModel === "gemini-2.5-flash-preview-tts") { s.ttsModel = DEFAULT_SETTINGS.ttsModel; changed = true; }
  if (MODEL_MIGRATIONS[s.sttModel]) { s.sttModel = MODEL_MIGRATIONS[s.sttModel]; changed = true; }
  if (MODEL_MIGRATIONS[s.ttsModel]) { s.ttsModel = MODEL_MIGRATIONS[s.ttsModel]; changed = true; }
  if (changed) await browser.storage.local.set({ pd_settings: s });
  return s;
}

async function persistModel(field, model) {
  const { pd_settings } = await browser.storage.local.get("pd_settings");
  await browser.storage.local.set({ pd_settings: { ...(pd_settings || {}), [field]: model } });
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
  await browser.storage.local.set({
    pd_models: {
      fetchedAt: Date.now(),
      tts: c.tts.map(m => m.id),
      stt: c.stt.map(m => m.id),
      all: c.all.map(m => ({ id: m.id, methods: m.methods, display: m.display }))
    }
  });
  await log(`Your key exposes ${c.all.length} generateContent models: ${c.tts.length} speech, ${c.stt.length} usable for recognition`, "ok");
  if (c.tts.length) await log("Speech models available: " + c.tts.map(m => m.id).join(", "));
  else await log("No speech-capable model found on this key: TTS will not work", "error");
  browser.runtime.sendMessage({ type: "models-updated" }).catch(() => {});
  return c;
}

// If every hardcoded fallback 404s, ask the API what exists and use that.
async function discoveredTtsModels() {
  const { pd_models } = await browser.storage.local.get("pd_models");
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
        await log(`Model retired by Google: switched to ${model}`, "warn");
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

// Activity for the daily report: seconds of work per UTC hour of the day, and the longest sitting of the day.
// A sitting is work with no gap longer than ACTIVITY_GAP_MS between its parts. Only the number of seconds is kept.
const ACTIVITY_GAP_MS = 10 * 60 * 1000;
function touchActivity(s, day, secs) {
  const now = Date.now();
  const hours = Array.isArray(day.hours) && day.hours.length === 24 ? day.hours : new Array(24).fill(0);
  hours[new Date(now).getUTCHours()] += Math.round(secs);
  day.hours = hours;
  const run = s.run && typeof s.run === "object" ? s.run : { last: 0, secs: 0 };
  const continuing = now - (run.last || 0) <= ACTIVITY_GAP_MS;
  run.secs = (continuing ? (run.secs || 0) : 0) + secs;
  run.last = now;
  s.run = run;
  day.maxRun = Math.max(day.maxRun || 0, Math.round(run.secs));
}

async function recordStats(patch) {
  const { pd_stats } = await browser.storage.local.get("pd_stats");
  const s = pd_stats || { totals: {}, days: {}, domains: {}, langs: {}, genders: {}, providers: {} };
  s.genders = s.genders || {};
  s.providers = s.providers || {};
  const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
  const day = (s.days[dayKey()] = s.days[dayKey()] || {});
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v !== "number") continue;
    add(s.totals, k, v);
    add(day, k, v);
  }
  // Per-provider breakdown (subtitle translation only, so far — dubbing always
  // uses the user's Gemini key/models regardless of subtitleProvider). Feeds
  // the usage/cost dashboard in options.html, which multiplies these by a
  // rate the user enters themselves rather than us guessing current pricing.
  if (patch.provider) {
    const bucket = (s.providers[patch.provider] = s.providers[patch.provider] || {});
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v !== "number") continue;
      add(bucket, k, v);
    }
  }
  const st = await getState();
  if (st.host) {
    const dom = (s.domains[st.host] = s.domains[st.host] || {});
    if (patch.seconds) add(dom, "seconds", patch.seconds);
    if (patch.chunks) add(dom, "chunks", patch.chunks);
  }
  if (patch.lang) add(s.langs, patch.lang, 1);
  // Seconds of speech per source language (sent to the server as "langs"). Subtitle batches pass langCode;
  // the live speech path passes lang. Kept apart from s.langs so that counter keeps its old meaning.
  const langCode = patch.langCode || patch.lang;
  if (langCode && typeof patch.langSeconds === "number" && /^[a-z]{2,3}$/.test(langCode)) add(day.langSec = day.langSec || {}, langCode, patch.langSeconds);
  if (patch.gender) add(s.genders, patch.gender, 1);
  // Hour of the day and the longest sitting (see touchActivity). Only work seconds count here.
  const workSecs = (Number(patch.subtitleSeconds) || 0) + (Number(patch.dubSeconds) || 0) + (Number(patch.liveCaptionSeconds) || 0);
  if (workSecs > 0) touchActivity(s, day, workSecs);
  await browser.storage.local.set({ pd_stats: s });
  scheduleSoonReport();
}

// ---------- anonymous daily report ----------
// Sends the day's counters (the same numbers as above, never the log or any text) to sub-ify.site.
// The server keeps one row per install and day; a new report for the same day replaces the old one.
// Always on: the daily report is not optional (see PRIVACY.md).
const TELEMETRY_URL = "https://sub-ify.site/subify-api/usage";
const TELEMETRY_TOTAL_KEYS = ["sessions", "subtitleCues", "subtitleFiles", "subtitleSeconds", "dubSeconds", "liveCaptionSeconds", "cacheCuesAsked", "cacheCuesHit", "ttsCalls", "exports"];

async function telemetryInstallId() {
  const { subify_install_id } = await browser.storage.local.get("subify_install_id");
  if (/^[a-f0-9]{32}$/.test(subify_install_id || "")) return subify_install_id;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  await browser.storage.local.set({ subify_install_id: id });
  return id;
}

// When the browser is signed in to sub-ify.site, this install is linked to the account once per account,
// so the account panel can show its usage. Failures are silent: the next report tries again.
async function linkInstallToAccount(install) {
  try {
    const me = await subifyAuthState(false);
    if (!me || !me.ok) return;
    // Signed out: forget the link, so the next sign-in links this install again.
    if (!me.user) {
      await browser.storage.local.remove("subify_linked_user");
      return;
    }
    const { subify_linked_user } = await browser.storage.local.get("subify_linked_user");
    if (subify_linked_user === me.user.id) return;
    const res = await fetch(SUBIFY_SITE + "/subify-api/account/link-install", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ install })
    });
    if (res.ok) await browser.storage.local.set({ subify_linked_user: me.user.id });
  } catch (e) {
    // offline or blocked: try again with the next report
  }
}

async function sendDailyReport() {
  const { subify_telemetry_last, pd_stats } = await browser.storage.local.get(["subify_telemetry_last", "pd_stats"]);
  const days = (pd_stats && pd_stats.days) || {};
  const install = await telemetryInstallId();
  await linkInstallToAccount(install);
  const today = dayKey();
  const weekAgo = dayKey(new Date(Date.now() - 6 * 86400000));
  // From the last day that went through, or a week back. Today is always sent again, because it keeps growing.
  const start = subify_telemetry_last && subify_telemetry_last >= weekAgo ? subify_telemetry_last : weekAgo;
  let allSent = true;
  for (let t = Date.parse(start + "T00:00:00Z"); t <= Date.parse(today + "T00:00:00Z"); t += 86400000) {
    const day = new Date(t).toISOString().slice(0, 10);
    const d = days[day];
    if (!d) continue;
    const totals = {};
    for (const k of TELEMETRY_TOTAL_KEYS) totals[k] = Math.round(Number(d[k]) || 0);
    const langs = {};
    for (const [code, secs] of Object.entries(d.langSec || {})) langs[code] = Math.round(Number(secs) || 0);
    const hours = [];
    for (let h = 0; h < 24; h++) hours.push(Math.round(Number(Array.isArray(d.hours) ? d.hours[h] : 0) || 0));
    const maxRunSeconds = Math.round(Number(d.maxRun) || 0);
    try {
      const res = await fetch(TELEMETRY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ install, day, totals, langs, hours, maxRunSeconds })
      });
      if (!res.ok) allSent = false;
    } catch (e) {
      allSent = false;
    }
  }
  if (allSent) await browser.storage.local.set({ subify_telemetry_last: today });
}

// ---------- history sync: the video list (YouTube, with the stopping point) ----------
// The overlay keeps subify_video_history (newest first, up to 50 videos). Each video goes to the account as
// "yt:<id>", with its title and where the viewer stopped. A video removed from the list is removed from the
// account too, and a video deleted in the account panel is removed from this list.
const SUBIFY_VIDEO_HISTORY_KEY = "subify_video_history";
async function syncVideoHistory() {
  const store = await browser.storage.local.get([SUBIFY_VIDEO_HISTORY_KEY, "subify_history_sent_video", "subify_history_cursor_video"]);
  const install = await telemetryInstallId();
  await linkInstallToAccount(install);
  const raw = Array.isArray(store[SUBIFY_VIDEO_HISTORY_KEY]) ? store[SUBIFY_VIDEO_HISTORY_KEY] : [];
  const list = raw.filter((v) => v && /^[A-Za-z0-9_-]{6,20}$/.test(String(v.videoId || "")));
  const ids = new Set(list.map((v) => v.videoId));
  const sent = store.subify_history_sent_video || {};
  const cursor = Number(store.subify_history_cursor_video) || 0;
  const now = Date.now();
  const items = list.map((v) => ({
    key: "yt:" + v.videoId,
    updatedAt: Number(v.at) || now,
    data: {
      type: "video",
      videoId: v.videoId,
      title: String(v.title || "").slice(0, 200),
      position: Math.max(0, Math.floor(Number(v.position) || 0)),
      duration: Math.max(0, Math.floor(Number(v.duration) || 0))
    }
  }));
  const deleted = Object.keys(sent).filter((id) => !ids.has(id)).map((id) => ({ key: "yt:" + id, at: now }));
  let res;
  try {
    res = await fetch(SUBIFY_SITE + "/subify-api/history/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ install, cursor, items, deleted })
    });
  } catch (e) {
    return;
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || !body.ok) return;

  const gone = new Set((body.deleted || []).map((d) => String(d.key || "").replace(/^yt:/, "")).filter(Boolean));
  const current = await browser.storage.local.get(SUBIFY_VIDEO_HISTORY_KEY);
  const latest = Array.isArray(current[SUBIFY_VIDEO_HISTORY_KEY]) ? current[SUBIFY_VIDEO_HISTORY_KEY] : [];
  const kept = gone.size ? latest.filter((v) => v && !gone.has(v.videoId)) : null;
  const nextSent = {};
  for (const v of kept || latest) if (v && v.videoId) nextSent[v.videoId] = true;
  const write = { subify_history_sent_video: nextSent, subify_history_cursor_video: Number(body.cursor) || now };
  if (kept) write[SUBIFY_VIDEO_HISTORY_KEY] = kept;
  await browser.storage.local.set(write);
}

// After counting changes, one report goes out a few minutes later, so a finished translation shows up soon.
// Only one such report is pending at a time; the regular report every six hours stays as the fallback.
async function scheduleSoonReport() {
  try {
    if (await browser.alarms.get("subify-telemetry-soon")) return;
    browser.alarms.create("subify-telemetry-soon", { delayInMinutes: 3 });
  } catch (e) {
    // alarms unavailable: the six-hour report still runs
  }
}

browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "subify-telemetry" || alarm.name === "subify-telemetry-soon") sendDailyReport().catch(() => {});
  if (alarm.name === "subify-history") syncVideoHistory().catch(() => {});
});
browser.alarms.create("subify-telemetry", { delayInMinutes: 5, periodInMinutes: 360 });
browser.alarms.create("subify-history", { delayInMinutes: 2, periodInMinutes: 15 });

// ---------- offscreen document (with readiness handshake) ----------

async function ensureOffscreen() {
  if (!(await browser.offscreen.hasDocument())) {
    await log("Creating offscreen document…");
    await browser.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
      justification: "Capture tab audio and play back the Persian dub."
    });
  }
  // createDocument can resolve before the page's listeners exist — poll for them.
  for (let i = 0; i < 50; i++) {
    try {
      const r = await browser.runtime.sendMessage({ type: "offscreen-ping" });
      if (r && r.ok) return true;
    } catch (e) { /* not listening yet */ }
    await sleep(100);
  }
  throw new Error("Offscreen document never became ready");
}

// ---------- start / stop ----------

async function startDubbing(tabId) {
  try {
    await browser.storage.session.set({ pd_log: [], pd_cues: [] });
    const baseSettings = await getSettings();
    // dubbingAudioEnabled:false = "captions only" — see offscreen.js's playLiveAudio().
    const settings = { ...baseSettings, dubbingEnabled: baseSettings.dubbingAudioEnabled !== false };
    if (!settings.apiKey) {
      await setState({ error: "No API key: add your Gemini key in Settings." });
      await log("No API key configured", "error");
      browser.runtime.openOptionsPage();
      return;
    }

    const tab = await browser.tabs.get(tabId);
    let host = "";
    try { host = new URL(tab.url).hostname.replace(/^www\./, ""); } catch (e) {}
    await setState({ tabId, host, title: tab.title || "", error: "", startedAt: Date.now(),
                     lastText: "", latency: 0, latAvg: 0, latSamples: 0 });
    await log(`Starting on ${host || "tab"}`);

    if (tab.audible === false) {
      await log("Tab reports no audio: make sure the video is actually playing", "warn");
    }

    if (settings.engine !== "chunked") {
      await log(`Engine: Gemini Live Translate (${settings.liveModel}): one streaming session`);
    } else {
      await log("Engine: chunked REST pipeline");
    }

    const streamId = await browser.tabCapture.getMediaStreamId({ targetTabId: tabId });
    await log("Got media stream id");

    await ensureOffscreen();
    await log("Offscreen ready: sending start command");

    const res = await browser.runtime.sendMessage({ type: "offscreen-start", streamId, settings });
    if (!res || !res.ok) throw new Error((res && res.error) || "Offscreen did not confirm capture");

    // offscreen.js's capturedSec (used for live-cue/live-hold timestamps) counts
    // from 0 at this exact moment, not from the video's actual position — this
    // tells the content script what video.currentTime is *right now* so it can
    // translate those relative timestamps back into real video time.
    browser.tabs.sendMessage(tabId, { type: "subify-live-capture-started" }).catch(() => {});

    // Captions go with the dub. Without this the live dub runs but no text shows.
    await browser.storage.local.set({ subify_subtitle_enabled: true });
    browser.tabs.sendMessage(tabId, { type: "subify-enable-subtitles" }).catch(() => {});

    await browser.storage.local.set({ subify_dubbing_enabled: true });
    await setState({ active: true });
    browser.action.setBadgeText({ text: "فا" });
    browser.action.setBadgeBackgroundColor({ color: "#0e7a5f" });
    await recordStats({ sessions: 1 });
  } catch (e) {
    await log("Start failed: " + (e.message || e), "error");
    await browser.storage.local.set({ subify_dubbing_enabled: false });
    await setState({ active: false, error: String(e.message || e) });
    browser.action.setBadgeText({ text: "" });
  }
}

async function stopDubbing(reason) {
  await browser.storage.local.set({ subify_dubbing_enabled: false });
  await setState({ active: false, queueDepth: 0, level: 0 });
  browser.action.setBadgeText({ text: "" });
  browser.runtime.sendMessage({ type: "offscreen-stop" }).catch(() => {});
  if (reason) await log("Stopped: " + reason);
}

// ---------- Gemini ----------

async function transcribeAndTranslate(wavB64, settings, model) {
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(settings.apiKey)}`;
  const lang = targetLangCode(settings);
  const prompt =
    "You are a live dubbing engine. The attached audio is a short clip from a video.\n" +
    "1) Detect the spoken language and return its ISO 639-1 code (en, fa, ar, tr, fr, …).\n" +
    "2) Judge the voice of the MAIN speaker from its pitch and timbre and return " +
    "\"male\", \"female\", or \"unknown\" if there is no clear speech or you cannot tell.\n" +
    (lang === "fa"
      ? "3) Translate everything spoken into natural, colloquial Persian (Farsi) suited to voice " +
        "dubbing — understand the full meaning, tone and any idiom/slang first, then write the most natural " +
        "spoken Persian equivalent (never a literal, word-for-word rendering). Keep proper names as they are. " +
        "Do not add a trailing full stop (.) at the end unless the sentence needs ؟ or !.\n"
      : `3) Translate everything spoken into natural, fluent, idiomatic ${LANGUAGE_NAMES[lang]} suited to voice ` +
        "dubbing — understand the full meaning, tone and any idiom/slang first, then write the most natural " +
        "spoken equivalent, never a literal, word-for-word rendering. Keep proper names as they are.\n") +
    "Also transcribe the spoken source faithfully in the \"source\" field.\n" +
    "If there is no intelligible speech, return empty source and translation.\n" +
    "Respond with ONLY this JSON: {\"lang\":\"\",\"gender\":\"\",\"source\":\"\",\"translation\":\"\"}";

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
  let out = String(parsed.translation || parsed.text || parsed.fa || "").trim();
  if (lang === "fa") out = applyPersianPunctuation(out);
  return {
    lang: (parsed.lang || "?").toLowerCase(),
    gender: (parsed.gender || "unknown").toLowerCase(),
    source: cleanSubtitleText(parsed.source || ""),
    fa: out,
    translation: out
  };
}

function cleanSubtitleText(text) {
  return String(text || "")
    .replace(/\[(music|muzik|müzik|applause|laughter|laughing|sound effects?|موسیقی|تشویق|خنده)\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Multilingual subtitle/dubbing target languages. "fa" (Persian) stays the
// default and keeps its own richer, colloquial-Persian prompt below; every
// other entry shares one generic high-quality prompt template.
const LANGUAGE_NAMES = {
  fa: "Persian (Farsi)", en: "English", ar: "Arabic", tr: "Turkish",
  es: "Spanish", fr: "French", de: "German", pt: "Portuguese",
  ru: "Russian", hi: "Hindi", zh: "Chinese (Simplified)", ja: "Japanese",
  ko: "Korean", it: "Italian"
};
function targetLangCode(settings) {
  const c = String(settings?.targetLanguage || "fa").toLowerCase();
  return LANGUAGE_NAMES[c] ? c : "fa";
}
function isPersianTarget(settings) { return targetLangCode(settings) === "fa"; }

// Section 4 of the update spec: Persian subtitles read more natural without
// a trailing sentence-ending "." (full stop) — Persian speech/subtitling
// convention doesn't punctuate every line the way English prose does. Only
// a plain Latin/Arabic full stop at the very end is dropped; "؟", "!", "…"
// and mid-sentence punctuation (commas, quotation marks) are left alone.
function applyPersianPunctuation(text) {
  return String(text || "").trim().replace(/[.\u06D4]+$/u, "").trim();
}

// Subject hint for the translator: the viewer picks the field of the video, and the translation keeps its terms exact.
const SUBTITLE_DOMAIN_HINTS = {
  software: "The video is about software engineering. Translate technical terms precisely and keep the common English term in parentheses on first use.\n",
  medicine: "The video is about medicine. Translate medical terms precisely and keep the English term in parentheses on first use.\n",
  law: "The video is about law. Translate legal terms precisely and keep the English term in parentheses on first use.\n",
  slang: "The speech is informal slang. Use a natural colloquial equivalent in the target language, not a literal one.\n"
};

function subtitleItemsAndPrompt(cues, settings) {
  const items = cues.map(c => ({ id: String(c.id), text: cleanSubtitleText(c.text) })).filter(x => x.text);
  const lang = targetLangCode(settings);
  const domainLine =
    "Correctly and consistently handle terminology from these domains when it appears: programming, software " +
    "engineering, AI, machine learning, computer science, cybersecurity, law, data protection, science, business, " +
    "finance, education, movies/TV dialogue, and casual conversation. Keep the same term for the same concept " +
    "across the whole batch.\n";
  const glossaryEntries = Array.isArray(settings?.glossary)
    ? settings.glossary.filter(g => g && String(g.term || "").trim() && String(g.translation || "").trim())
    : [];
  const glossaryLine = glossaryEntries.length
    ? "Always translate these exact terms this way, every time they appear, regardless of surrounding context " +
      "(case-insensitive match on the source term):\n" +
      glossaryEntries.map(g => `- "${String(g.term).trim()}" -> "${String(g.translation).trim()}"`).join("\n") + "\n"
    : "";
  // "auto" (default) leaves the speaker's own register intact — the
  // per-language blocks below already do that in detail. An explicit
  // choice here overrides it for every line, regardless of how the
  // source actually sounds.
  const toneLine = settings?.translationTone === "formal"
    ? "Override the speaker's natural register: render every single line in formal, polite, respectful language " +
      "(formal pronouns/verb forms where the target language distinguishes them), even where the source speech " +
      "is casual, slangy or blunt.\n"
    : settings?.translationTone === "friendly"
    ? "Override the speaker's natural register: render every single line in warm, casual, friendly everyday " +
      "language (informal pronouns/verb forms where the target language distinguishes them), even where the " +
      "source speech is formal or stiff.\n"
    : settings?.translationTone === "academic"
    ? "Override the speaker's natural register: render every single line the way it would sound in a formal " +
      "academic presentation to a professor or committee — precise, neutral, third-person-distanced phrasing, " +
      "correct technical/disciplinary terminology, no slang, no filler words, no contractions — even where the " +
      "source speech itself is casual, rambling or colloquial.\n"
    : "";
  const sharedTail =
    domainLine +
    glossaryLine +
    toneLine +
    "Remove non-speech labels like music, applause, laughter and sound descriptions.\n" +
    "Keep names, numbers, units, code and URLs unchanged. Output ONLY compact JSON.\n" +
    `The target language is ${LANGUAGE_NAMES[lang]}. Do NOT translate into Persian unless the target language is Persian.\n` +
    "Format: {\"results\":[{\"id\":\"original-id\",\"translation\":\"translation\"}]}\n";

  // Each of these is a native, idiomatically-written instruction block in
  // its own target language (not an English template with the language name
  // substituted in) — meaning-first, non-literal, tone-preserving, with the
  // exact same substantive rules in every language: understand full context
  // before translating; never translate idioms/slang/proverbs/irony word for
  // word; keep the speaker's register (casual/formal/humor/poetic/romantic/
  // street slang); pick the sense a real native speaker would actually say
  // when several are possible; leave proper names/brands/foreign terms
  // alone; never guess at unclear audio without real contextual evidence;
  // and the same priority order (correct meaning > naturalness > context >
  // tone > idiom/emotion > subtitle formatting). Languages outside this set
  // fall through to the generic template below.
  const NATIVE_PROMPTS = {
    fa:
      "شما یک مترجم حرفه‌ای زیرنویس فارسی هستید. ترجمه باید روان، دقیق، طبیعی و کاملاً متناسب با فضای گفت‌وگو باشد؛ " +
      "به هیچ‌وجه حالت ترجمهٔ ماشینی یا کلمه‌به‌کلمه نداشته باشد.\n" +
      "اول مفهوم کامل جمله، فضای صحبت، لحن گوینده، اصطلاح‌ها، عامیانه‌ها و کنایه‌ها و منظور واقعی گوینده را بفهم، " +
      "بعد طبیعی‌ترین معادل فارسی را بنویس — در صورت نیاز کل ساختار جمله را تغییر بده، به‌شرطی که معنی و احساس اصلی حفظ شود.\n" +
      "اگر ترجمهٔ تحت‌اللفظی جمله‌ای بی‌معنی یا عجیب در فارسی می‌سازد، این کار ممنوع است — باید مفهوم واقعی منتقل شود " +
      "(مثلاً عبارتی ترکی مثل «Sebebi yâr» هرگز نباید به‌شکل نادرست و تحت‌اللفظی مثل «سببش یارت» ترجمه شود؛ " +
      "باید کاربرد واقعی‌اش فهمیده شود و معادل طبیعی فارسی نوشته شود). همین قانون برای اصطلاح، ضرب‌المثل، عبارت " +
      "عاشقانه/ادبی/شاعرانه، طنز، عامیانه و کنایه هم صدق می‌کند.\n" +
      "لحن گوینده را حفظ کن: صمیمی→صمیمی، محاوره‌ای→محاوره‌ای، رسمی→رسمی، طنز→طنز، شاعرانه→شاعرانه، " +
      "عاشقانه→طبیعی و احساسی، خیابانی/اسلنگ→معادل طبیعی و قابل‌فهم فارسی. اگر چند ترجمهٔ طبیعی ممکن است، همیشه " +
      "همانی را انتخاب کن که برای یک فارسی‌زبان واقعی طبیعی‌تر است.\n" +
      "اسم‌های خاص، اسم افراد، مکان‌ها، برندها و اصطلاح‌های خارجی را بی‌دلیل تغییر نده. اگر بخشی نامفهوم است، بی‌دلیل " +
      "حدس نزن؛ فقط زمانی از کانتکست برای بازسازی استفاده کن که شواهد کافی وجود داشته باشد.\n" +
      "اولویت: درستی معنی > طبیعی‌بودن > حفظ کانتکست > حفظ لحن > حفظ اصطلاح و احساس > حفظ ساختار زیرنویس.\n" +
      "یک نقطهٔ سادهٔ (.) در انتهای جمله را، وقتی نشانهٔ معنادار (؟ ! …) نیست، حذف کن؛ کاما و علامت نقل‌قول را در " +
      "جای لازم نگه دار.\n",
    en:
      "You are a professional subtitle translator producing natural, idiomatic English — never robotic or " +
      "word-for-word.\n" +
      "First understand the full meaning of the line: context, the speaker's tone, idioms, slang, sarcasm, and " +
      "what they actually mean — then write the most natural English equivalent, restructuring the sentence " +
      "completely if needed, as long as the meaning and feeling survive intact.\n" +
      "If a literal translation would sound strange or meaningless in English, that literal version is not " +
      "allowed — convey the real meaning instead. The same applies to idioms, proverbs, romantic or poetic " +
      "lines, humor, slang, and sarcasm (e.g. a line like the Turkish 'Sebebi yâr' should never become a stiff, " +
      "incorrect literal phrase — figure out what it actually means and phrase it the way a native English " +
      "speaker would).\n" +
      "Match the speaker's register: casual stays casual, formal stays formal, humor stays funny, poetic stays " +
      "poetic, romantic lines stay warm and natural, street slang gets a natural English slang equivalent. When " +
      "more than one natural translation is possible, pick whichever a real native English speaker would " +
      "actually say.\n" +
      "Never alter proper names, people, places, brands, or foreign terms without reason. Never guess at " +
      "unclear audio — only fill a gap from context when there is real evidence for it.\n" +
      "Priority order: correct meaning > natural phrasing > context > tone > idiom/emotion > subtitle " +
      "formatting.\n",
    tr:
      "Sen profesyonel bir altyazı çevirmenisin ve çevirin doğal, akıcı ve bağlama tam oturan bir Türkçe olmalı " +
      "— asla makine çevirisi ya da kelime kelime çeviri gibi durmamalı.\n" +
      "Önce cümlenin tam anlamını, bağlamı, konuşmacının tonunu, deyimleri, argoyu ve gerçek niyetini kavra, " +
      "sonra en doğal Türkçe karşılığını yaz; gerekirse cümle yapısını tamamen değiştir, yeter ki anlam ve " +
      "duygu korunsun.\n" +
      "Birebir çeviri Türkçede anlamsız ya da tuhaf bir cümle oluşturuyorsa bu kesinlikle yasak — gerçek anlam " +
      "aktarılmalı. Aynı kural deyimler, atasözleri, romantik/edebi/şiirsel ifadeler, mizah, argo ve kinaye için " +
      "de geçerli ('Sebebi yâr' gibi bir ifade asla yanlış ve birebir çevrilmemeli — gerçek kullanımı anlaşılıp " +
      "doğal bir karşılık yazılmalı).\n" +
      "Konuşmacının tonunu koru: samimi→samimi, günlük konuşma dili→günlük konuşma dili, resmi→resmi, " +
      "esprili→esprili, şiirsel→şiirsel, romantik→doğal ve duygusal, sokak dili/argo→doğal ve anlaşılır bir " +
      "Türkçe karşılık. Birden fazla doğal çeviri mümkünse, gerçek bir Türkçe konuşucunun söyleyeceği ifadeyi " +
      "seç.\n" +
      "Özel isimleri, kişi adlarını, yer adlarını, marka isimlerini ve yabancı terimleri sebepsiz yere değiştirme. " +
      "Anlaşılmayan bir kısmı asla tahmin etme; bağlamı sadece yeterli kanıt olduğunda kullan.\n" +
      "Öncelik sırası: anlamın doğruluğu > doğallık > bağlamın korunması > tonun korunması > deyim ve duygunun " +
      "korunması > altyazı biçiminin korunması.\n",
    es:
      "Eres un traductor profesional de subtítulos y tu traducción al español debe sonar natural, fluida y " +
      "perfectamente adaptada al contexto — nunca como una traducción automática o palabra por palabra.\n" +
      "Primero entiende el significado completo de la frase, el contexto, el tono del hablante, los modismos, " +
      "la jerga y la intención real; luego escribe el equivalente más natural en español, cambiando la " +
      "estructura de la frase si hace falta, siempre que se conserve el significado y el sentimiento original.\n" +
      "Si una traducción literal suena rara o no tiene sentido en español, esa traducción literal queda " +
      "prohibida — hay que transmitir el significado real. La misma regla aplica a modismos, refranes, frases " +
      "románticas o poéticas, humor, jerga e ironía (una expresión como la turca 'Sebebi yâr' nunca debería " +
      "traducirse de forma literal e incorrecta; hay que entender su uso real y dar un equivalente natural).\n" +
      "Mantén el registro del hablante: cercano→cercano, coloquial→coloquial, formal→formal, gracioso→gracioso, " +
      "poético→poético, romántico→cálido y natural, callejero/jerga→un equivalente natural y comprensible en " +
      "español. Si hay varias traducciones naturales posibles, elige la que diría un hispanohablante nativo de " +
      "verdad.\n" +
      "No cambies nombres propios, personas, lugares, marcas ni términos extranjeros sin motivo. Nunca inventes " +
      "una parte que no se entiende; usa el contexto para reconstruirla solo cuando haya evidencia suficiente.\n" +
      "Orden de prioridad: exactitud del significado > naturalidad > contexto > tono > modismos y emoción > " +
      "formato del subtítulo.\n",
    de:
      "Du bist ein professioneller Untertitel-Übersetzer, und deine deutsche Übersetzung muss natürlich, " +
      "flüssig und genau zum Kontext passen — niemals wie eine Maschinenübersetzung oder Wort-für-Wort-" +
      "Übertragung klingen.\n" +
      "Verstehe zuerst die volle Bedeutung des Satzes, den Kontext, den Tonfall des Sprechers, Redewendungen, " +
      "Slang und die tatsächliche Absicht — schreibe dann die natürlichste deutsche Entsprechung, notfalls mit " +
      "komplett anderem Satzbau, solange Bedeutung und Gefühl erhalten bleiben.\n" +
      "Wenn eine wörtliche Übersetzung im Deutschen seltsam oder sinnlos klingt, ist diese wörtliche Version " +
      "verboten — die eigentliche Bedeutung muss vermittelt werden. Dieselbe Regel gilt für Redewendungen, " +
      "Sprichwörter, romantische oder poetische Zeilen, Humor, Slang und Ironie (ein Ausdruck wie das türkische " +
      "„Sebebi yâr“ sollte niemals falsch wörtlich übersetzt werden — erst die tatsächliche Bedeutung verstehen, " +
      "dann ein natürliches deutsches Äquivalent finden).\n" +
      "Behalte den Ton des Sprechers bei: locker→locker, umgangssprachlich→umgangssprachlich, förmlich→förmlich, " +
      "witzig→witzig, poetisch→poetisch, romantisch→warm und natürlich, Straßenslang→ein natürliches, " +
      "verständliches deutsches Äquivalent. Wenn mehrere natürliche Übersetzungen möglich sind, wähle die, die " +
      "ein echter deutscher Muttersprachler tatsächlich sagen würde.\n" +
      "Ändere Eigennamen, Personen, Orte, Marken oder fremdsprachige Begriffe nicht ohne Grund. Rate niemals bei " +
      "unverständlichen Stellen — nutze den Kontext zur Rekonstruktion nur, wenn es dafür ausreichend " +
      "Anhaltspunkte gibt.\n" +
      "Prioritätsreihenfolge: inhaltliche Richtigkeit > Natürlichkeit > Kontext > Ton > Redewendung und Emotion " +
      "> Untertitelformat.\n",
    it:
      "Sei un traduttore professionista di sottotitoli e la tua traduzione in italiano deve suonare naturale, " +
      "scorrevole e perfettamente calata nel contesto — mai come una traduzione automatica o parola per " +
      "parola.\n" +
      "Prima capisci il significato completo della frase, il contesto, il tono di chi parla, i modi di dire, lo " +
      "slang e l'intenzione reale; poi scrivi l'equivalente italiano più naturale, cambiando pure del tutto la " +
      "struttura della frase, purché restino intatti significato ed emozione.\n" +
      "Se una traduzione letterale suona strana o senza senso in italiano, quella traduzione letterale è vietata " +
      "— va reso il significato vero. Vale la stessa regola per modi di dire, proverbi, frasi romantiche o " +
      "poetiche, umorismo, slang e ironia (un'espressione come quella turca 'Sebebi yâr' non va mai tradotta " +
      "letteralmente in modo scorretto: bisogna capire il suo uso reale e trovare un equivalente naturale in " +
      "italiano).\n" +
      "Mantieni il registro di chi parla: colloquiale→colloquiale, informale→informale, formale→formale, " +
      "comico→comico, poetico→poetico, romantico→caldo e naturale, slang di strada→un equivalente naturale e " +
      "comprensibile in italiano. Se sono possibili più traduzioni naturali, scegli quella che direbbe davvero " +
      "un madrelingua italiano.\n" +
      "Non modificare nomi propri, persone, luoghi, marchi o termini stranieri senza motivo. Non indovinare mai " +
      "una parte incomprensibile; usa il contesto per ricostruirla solo quando ci sono prove sufficienti.\n" +
      "Ordine di priorità: correttezza del significato > naturalezza > contesto > tono > modi di dire ed " +
      "emozione > formato del sottotitolo.\n"
  };

  const prompt = NATIVE_PROMPTS[lang]
    ? NATIVE_PROMPTS[lang] + sharedTail + JSON.stringify(items)
    : `You are a professional subtitle translator. Translate into natural, fluent, native-sounding ${LANGUAGE_NAMES[lang]}, ` +
      "understanding full context, tone, idiom and intent before choosing the most natural phrasing rather than " +
      "a literal one — appropriate for spoken dialogue and educational/technical content alike.\n" +
      sharedTail +
      JSON.stringify(items);
  const domainNote = SUBTITLE_DOMAIN_HINTS[settings && settings.subtitleDomain] || "";
  return { items, prompt: domainNote + prompt, lang };
}

function parseSubtitleResults(text, provider, lang = "fa") {
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
  const out = arr
    .map(x => {
      const translation = String(
        x.translation ?? x.text ?? x[lang] ?? x.fa ?? ""
      ).trim();
      const text = lang === "fa" ? applyPersianPunctuation(translation) : translation;
      // Keep `fa` as a compatibility alias because older UI/export code reads it.
      return { id: String(x.id || ""), text, fa: text, translation: text };
    })
    .filter(x => x.id && x.text);
  if (!out.length) throw new Error(`${provider} returned an empty subtitle translation`);
  return out;
}

async function translateSubtitleCuesGemini(cues, settings, model) {
  const url = `${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(settings.apiKey)}`;
  const { prompt, lang } = subtitleItemsAndPrompt(cues, settings);
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    // NOTE: batches can carry up to 24 cues (see "subify-translate" below) and Persian
    // JSON output runs heavier on tokens than the source text — 2048 was clipping
    // longer batches mid-JSON and breaking parseSubtitleResults(). Matched to the
    // 4096 ceiling already used by the OpenRouter/OpenAI/Custom code paths.
    generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
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
  return parseSubtitleResults(text, "Gemini", lang);
}

async function translateSubtitleCuesOpenRouter(cues, settings) {
  if (!settings.openRouterKey) throw new Error("No OpenRouter API key saved");
  const { prompt, lang } = subtitleItemsAndPrompt(cues, settings);
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
  return parseSubtitleResults(text, "OpenRouter", lang);
}



async function translateSubtitleCuesOpenAI(cues, settings) {
  if (!settings.openaiKey) throw new Error("No OpenAI API key saved");
  const { prompt, lang } = subtitleItemsAndPrompt(cues, settings);
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
  return parseSubtitleResults(text, "OpenAI", lang);
}


function normalizeCustomBaseUrl(url){
  let u=String(url||"").trim().replace(/\/+$/,'');
  if(!u) throw new Error("Custom API Base URL خالی است");
  if(!/^https?:\/\//i.test(u)) u="https://"+u;
  return u;
}
function getCustomProvider(settings, id){
  const list=Array.isArray(settings.customProviders)?settings.customProviders:[];
  return list.find(p=>String(p.id||"")===String(id||settings.customProviderId||""))||null;
}
async function translateSubtitleCuesCustom(cues, settings){
  const provider=getCustomProvider(settings);
  if(!provider) throw new Error("Custom API انتخاب شده، اما سرویسی تنظیم نشده است");
  if(!provider.apiKey) throw new Error(`برای ${provider.name||'Custom API'} کلید API ذخیره نشده است`);
  if(!provider.model) throw new Error(`برای ${provider.name||'Custom API'} شناسه مدل ترجمه وارد نشده است`);
  const {prompt}=subtitleItemsAndPrompt(cues, settings);
  const base=normalizeCustomBaseUrl(provider.baseUrl);
  const url=/\/chat\/completions$/i.test(base)?base:`${base}/chat/completions`;
  const res=await fetch(url,{method:"POST",headers:{"Authorization":`Bearer ${provider.apiKey}`,"Content-Type":"application/json","X-Title":"Subify YouTube Persian subtitles"},body:JSON.stringify({model:provider.model,messages:[{role:"user",content:prompt}],temperature:0.15,max_tokens:4096})});
  const raw=await res.text();
  if(!res.ok) throw new Error(`Custom API ${res.status}: ${raw.slice(0,260)}`);
  let data; try{data=JSON.parse(raw)}catch(_){throw new Error("Custom API پاسخ JSON معتبر نداد")}
  const text=data.choices?.[0]?.message?.content||data.output_text||"";
  return parseSubtitleResults(String(text),provider.name||"Custom API");
}
async function listCustomModels(provider){
  if(!provider?.apiKey) throw new Error("کلید Custom API وارد نشده است");
  const base=normalizeCustomBaseUrl(provider.baseUrl);
  const url=/\/models$/i.test(base)?base:`${base}/models`;
  const res=await fetch(url,{headers:{"Authorization":`Bearer ${provider.apiKey}`}});
  const raw=await res.text();
  if(!res.ok) throw new Error(`Model list ${res.status}: ${raw.slice(0,220)}`);
  const data=JSON.parse(raw);
  return Array.isArray(data.data)?data.data.map(x=>String(x.id||x.name||"")).filter(Boolean):[];
}
async function testCustomProvider(settings,id){
  const provider=getCustomProvider(settings,id);
  if(!provider) throw new Error("Custom API پیدا نشد");
  if(!provider.apiKey) throw new Error("کلید API وارد نشده است");
  if(!provider.model) throw new Error("Model ID وارد نشده است");
  const base=normalizeCustomBaseUrl(provider.baseUrl);
  const url=/\/chat\/completions$/i.test(base)?base:`${base}/chat/completions`;
  const res=await fetch(url,{method:"POST",headers:{"Authorization":`Bearer ${provider.apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model:provider.model,messages:[{role:"user",content:"Reply with exactly: OK"}],temperature:0,max_tokens:8})});
  const raw=await res.text();
  if(!res.ok) throw new Error(`Custom API ${res.status}: ${raw.slice(0,260)}`);
  return {ok:true,name:provider.name||"Custom API",model:provider.model};
}

function isQuotaOrTransientError(error) {
  const e = String(error?.message || error || "");
  return /\b(429|500|502|503|504)\b|quota|rate.?limit|temporarily unavailable|resource exhausted/i.test(e);
}

// A 429/503 means "try again shortly", not "this model is gone" (that's what
// withModelFallback already handles via 404s) — a couple of short backoff
// attempts on the SAME model/call clears most transient rate-limit blips
// without silently swallowing a persistent problem.
async function withTransientRetry(fn, delaysMs = [1200, 2800]) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= delaysMs.length || !isQuotaOrTransientError(e)) throw e;
      await log(`Rate-limited (attempt ${i + 1}): retrying in ${Math.round(delaysMs[i] / 100) / 10}s…`, "warn");
      await new Promise((r) => setTimeout(r, delaysMs[i]));
    }
  }
}

async function translateSubtitleCues(cues, settings, model) {
  const provider = settings.subtitleProvider || "auto";
  if (provider === "openrouter") return translateSubtitleCuesOpenRouter(cues, settings);
  if (provider === "openai") return translateSubtitleCuesOpenAI(cues, settings);
  if (provider === "custom") return translateSubtitleCuesCustom(cues, settings);
  if (provider === "gemini") return translateSubtitleCuesGemini(cues, settings, model);

  // Auto: keep Gemini as the first choice, but do not let a Gemini quota error
  // kill subtitle rendering when the user supplied an OpenRouter key.
  try {
    return await translateSubtitleCuesGemini(cues, settings, model);
  } catch (e) {
    if (settings.openRouterKey && isQuotaOrTransientError(e)) {
      await log("Gemini subtitle quota/temporary error: switching this batch to OpenRouter", "warn");
      return translateSubtitleCuesOpenRouter(cues, settings);
    }
    if (settings.openaiKey && isQuotaOrTransientError(e)) {
      await log("Gemini subtitle quota/temporary error: switching this batch to OpenAI", "warn");
      return translateSubtitleCuesOpenAI(cues, settings);
    }
    throw e;
  }
}

async function testGeminiKey(settings) {
  if (!settings.apiKey) throw new Error("No Gemini API key saved");

  // Do not use /models as the key test. Some valid Gemini API keys can call
  // generateContent while model listing is restricted and returns 403.
  const preferred = [
    settings.geminiSubtitleModel,
    settings.sttModel,
    "gemini-3.1-flash-lite",
    "gemini-3.5-flash",
    "gemini-3-flash"
  ].filter(Boolean);

  let last = null;
  for (const model of [...new Set(preferred)]) {
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
      if (text) return { ok: true, model, discovery: "optional" };
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
    await log("No known speech model worked on this key: asking Google which models it has…", "warn");
    const found = await discoveredTtsModels();
    if (!found.length) {
      throw new Error("This API key has no speech-capable model available. " +
        "Open Settings and press ‘Load models from my API key’ to check, or use a key with TTS access.");
    }
    await log("Using discovered speech model(s): " + found.join(", "));
    await withModelFallback(settings, "ttsModel", found, fn);
  };

  try {
    if (streamOn) await withTransientRetry(() => tryKnown(runStream));
    else await withTransientRetry(() => tryKnown(runOnce));
  } catch (e) {
    const em = String(e.message || e);
    const streamingUnsupported = /unsupported here|stream returned no audio/i.test(em);
    const notFound = /\b404\b|not found|is not supported/i.test(em);

    try {
      if (streamingUnsupported && streamOn) {
        await log("Streaming not supported here: using single-shot synthesis", "warn");
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
  if (!st.active) { await log("Chunk arrived while inactive: ignored", "warn"); return; }
  const settings = await getSettings();
  await setState({ queueDepth: (st.queueDepth || 0) + 1 });

  try {
    await log(`Sending ${msg.seconds.toFixed(1)}s to ${settings.sttModel}…`);
    const { lang, gender, source, translation } = await withModelFallback(settings, "sttModel", STT_FALLBACKS,
      (m) => transcribeAndTranslate(msg.wavB64, settings, m));
    await recordStats({ sttCalls: 1, chunks: 1, seconds: msg.seconds, lang, gender, langSeconds: msg.seconds });

    // Publish the source transcript immediately on the VIDEO timeline.
    // This intentionally happens before TTS so the subtitle is never delayed
    // or synced to the generated/dubbed audio. Restarting the video from 0
    // therefore follows the original video's timing.
    if (source && st.tabId != null) {
      browser.tabs.sendMessage(st.tabId, {
        type: "subify-generated-subtitle-cue",
        start: msg.startSec,
        end: msg.startSec + msg.seconds,
        text: source
      }).catch(() => {});
    }
    await log(`Detected: ${lang} / ${gender}${translation ? "" : ": no speech"}`);
    await setState({ lastLang: lang, lastGender: gender });

    if (!translation) return;
    const knownLangs = String(settings.skipLangs || "").toLowerCase().split(/[\s,،]+/).filter(Boolean);
    if ((settings.skipPersian && lang === "fa") || knownLangs.includes(String(lang).toLowerCase())) {
      await recordStats({ skipped: 1 });
      await setState({ lastText: "(زبان منبع را بلدی: رد شد)" });
      await log("Source language is one the viewer knows: skipped");
      return;
    }

    const voice = pickVoice(settings, gender);
    await log(`Synthesizing with ${voice} (${gender})…`);
    const emit = (pcmB64) => browser.runtime.sendMessage({
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
    await recordStats({ ttsCalls: 1, chars: fa.length, dubSeconds: msg.seconds });
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
  await browser.storage.session.set({ pd_log: [] });
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
      await log("Known speech models unavailable: discovering from your key…", "warn");
      const found = await discoveredTtsModels();
      if (!found.length) {
        throw new Error("This API key has no speech-capable model available. Use a key with TTS access.");
      }
      pcmB64 = await withModelFallback(settings, "ttsModel", found, speak);
    }
    await log("TTS returned audio: playing now", "ok");
    browser.runtime.sendMessage({
      type: "offscreen-play", pcmB64, sampleRate: 24000, playbackRate: 1, duckLevel: 1
    }).catch(() => {});
    await log("Self-test passed: if you heard Persian speech, key, model and playback all work.", "ok");
  } catch (e) {
    await log("Self-test failed: " + (e.message || e), "error");
  }
}


// ---------- Subify provider badge ----------
// The popup shows which provider handled the last subtitle batch, and what it replaced.
function noteSubtitleProvider(provider, from = "") {
  return browser.storage.local.set({ subify_provider_status: { provider: String(provider || ""), from: String(from || ""), at: Date.now() } }).catch(() => {});
}

// ---------- Subify cloud translation cache ----------
const SUBIFY_CLOUD_CACHE_URL = "https://sub-ify.site/subify-api/cache";

async function subifyCloudCacheGet(payload) {
  const res = await fetch(`${SUBIFY_CLOUD_CACHE_URL}/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  const raw = await res.text();
  let data = {};
  try { data = JSON.parse(raw); } catch (_) {}
  if (!res.ok || !data?.ok) throw new Error(data?.error || `Cloud cache GET HTTP ${res.status}`);
  return data;
}

async function subifyCloudCachePut(payload) {
  const res = await fetch(`${SUBIFY_CLOUD_CACHE_URL}/put`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  const raw = await res.text();
  let data = {};
  try { data = JSON.parse(raw); } catch (_) {}
  if (!res.ok || !data?.ok) throw new Error(data?.error || `Cloud cache PUT HTTP ${res.status}`);
  return data;
}


// A person's fix for one line. The server only shares it after a second signed-in
// person sends the same text (see /cache/correct). Needs the member session cookie.
async function subifyCloudCacheCorrect(payload) {
  const cue = payload?.cue || {};
  const body = {
    video_id: String(payload?.video_id || ""),
    track_key: String(payload?.track_key || ""),
    target_language: String(payload?.target_language || "fa").toLowerCase(),
    cue_key: cueFingerprintForCloud(cue),
    start_sec: Number(cue.start) || 0,
    end_sec: Number(cue.end) || 0,
    source_text: String(cue.text || ""),
    translation: String(payload?.translation || "").trim()
  };
  const res = await fetch(`${SUBIFY_CLOUD_CACHE_URL}/correct`, {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (res.status === 401) return { ok: false, code: "sign_in_required", error: "sign_in_required" };
  if (res.status === 429) return { ok: false, code: "rate_limited", error: "rate_limited" };
  const raw = await res.text();
  let data = {};
  try { data = JSON.parse(raw); } catch (_) {}
  if (!res.ok || !data?.ok) throw new Error(data?.error || `Cloud correction HTTP ${res.status}`);
  return data;
}

async function syncSubtitleBatchToCloud({ videoId, trackKey, targetLanguage, cues, results }) {
  if (!videoId || !trackKey || !Array.isArray(cues) || !Array.isArray(results) || !results.length) return null;
  const byId = new Map();
  for (const r of results) {
    const id = String(r?.id ?? '');
    const tr = String(r?.fa ?? r?.translation ?? r?.text ?? '').trim();
    if (id && tr) byId.set(id, tr);
  }
  const rows = cues.map(c => {
    const id = String(c?.id ?? '');
    const translation = byId.get(id) || '';
    if (!id || !translation) return null;
    return {
      cue_key: cueFingerprintForCloud(c),
      start_sec: Number(c?.start) || 0,
      end_sec: Number(c?.end) || 0,
      source_text: String(c?.text || ''),
      translation
    };
  }).filter(Boolean);
  if (!rows.length) return null;
  return subifyCloudCachePut({
    video_id: String(videoId),
    track_key: String(trackKey),
    target_language: String(targetLanguage || 'fa').toLowerCase(),
    rows
  });
}

function cueFingerprintForCloud(c) {
  const text = String(c?.text || '').trim();
  const start = Number(c?.start || 0).toFixed(3);
  const end = Number(c?.end || 0).toFixed(3);
  let h = 2166136261;
  const input = `${start}|${end}|${text}`;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

// ---------- messaging ----------

browser.runtime.onConnect.addListener((p) => {
  if (p.name === "subify-keepalive") p.onMessage.addListener(() => {});
});

// Dub volume changes apply to a running Chrome dub live. The offscreen page has no
// chrome.storage, so the background (which can read storage) forwards the value.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.pd_settings) return;
  const value = changes.pd_settings.newValue || {};
  const gain = Number(value.dubGain);
  if (Number.isFinite(gain)) browser.runtime.sendMessage({ type: "offscreen-set-dub-gain", value: gain }).catch(() => {});
  // Original-volume slider in the popup: the next sentence uses the new level.
  const duck = Number(value.duckLevel);
  if (Number.isFinite(duck)) browser.runtime.sendMessage({ type: "offscreen-set-duck", value: duck }).catch(() => {});
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

// ---------- Full-page translation ----------
// Lines already translated into this language come from the local cache (chrome.storage.local, LRU).
// Only the rest go to the user's own AI key. The helpers are in page-translate-core.js.
if (typeof importScripts === "function") importScripts("page-translate-core.js");
// Free-source counting for the no-sign-in trial (trial-core.js). Chrome loads it here; Firefox lists it in manifest.json.
if (typeof importScripts === "function") importScripts("trial-core.js");
// Provider routing for the AI pages (ai-route-core.js). Chrome loads it here; Firefox lists it in manifest.json.
if (typeof importScripts === "function") importScripts("ai-route-core.js");
const PAGE_CORE = globalThis.SubifyPageTranslateCore;
let pageCacheWriteChain = Promise.resolve();
async function pageCacheRead() {
  try {
    const { subifyPageCache } = await browser.storage.local.get("subifyPageCache");
    return PAGE_CORE.cacheLoad(subifyPageCache);
  } catch (e) { return PAGE_CORE.emptyCache(); }
}
function pageCacheWrite(cache) {
  pageCacheWriteChain = pageCacheWriteChain.then(() => browser.storage.local.set({ subifyPageCache: cache })).catch(() => {});
  return pageCacheWriteChain;
}

async function translatePageTexts(texts, targetLanguage) {
  const settings = await getSettings();
  const lang = String(targetLanguage || settings.targetLanguage || "fa").split("-")[0].toLowerCase();
  const cues = (Array.isArray(texts) ? texts : []).slice(0, PAGE_CORE.BATCH_MAX_ITEMS).map((x, i) => ({
    id: String(x?.id ?? i),
    text: String(x?.text || "").trim()
  })).filter(x => x.text);
  if (!cues.length) return { ok: true, results: [] };
  const cache = await pageCacheRead();
  const results = [];
  const misses = [];
  for (const cue of cues) {
    const hit = PAGE_CORE.cacheGet(cache, lang, cue.text);
    if (hit) results.push({ id: cue.id, text: hit });
    else misses.push(cue);
  }
  if (misses.length) {
    const fresh = await translatePageCuesFresh(misses, { ...settings, targetLanguage: lang });
    const byId = new Map(misses.map(c => [c.id, c]));
    for (const r of fresh) {
      const src = byId.get(String(r?.id));
      const out = String(r?.text || r?.translation || "").trim();
      if (!src || !out) continue;
      PAGE_CORE.cachePut(cache, lang, src.text, out);
      results.push({ id: src.id, text: out });
    }
    await pageCacheWrite(cache);
  }
  return { ok: true, results };
}

// One provider call for the lines that are not cached yet.
async function translatePageCuesFresh(cues, pageSettings) {
  const provider = pageSettings.subtitleProvider || "auto";
  let results;
  if (provider === "openrouter") results = await translateSubtitleCuesOpenRouter(cues, pageSettings);
  else if (provider === "openai") results = await translateSubtitleCuesOpenAI(cues, pageSettings);
  else if (provider === "custom") results = await translateSubtitleCuesCustom(cues, pageSettings);
  else if (provider === "gemini") {
    if (!pageSettings.apiKey) throw new Error("Gemini انتخاب شده، اما کلید Gemini ذخیره نشده است");
    const chosen = pageSettings.geminiSubtitleModel || pageSettings.sttModel;
    results = await withModelFallback({ ...pageSettings, sttModel: chosen }, "sttModel", [chosen, ...STT_FALLBACKS],
      (m) => translateSubtitleCues(cues, { ...pageSettings, subtitleProvider: "gemini" }, m));
  } else {
    if (pageSettings.openRouterKey) results = await translateSubtitleCuesOpenRouter(cues, pageSettings);
    else if (pageSettings.openaiKey) results = await translateSubtitleCuesOpenAI(cues, pageSettings);
    else if (pageSettings.apiKey) {
      const chosen = pageSettings.geminiSubtitleModel || pageSettings.sttModel;
      results = await withModelFallback({ ...pageSettings, sttModel: chosen }, "sttModel", [chosen, ...STT_FALLBACKS],
        (m) => translateSubtitleCues(cues, { ...pageSettings, subtitleProvider: "gemini" }, m));
    } else throw new Error("هیچ کلید Gemini، OpenAI یا OpenRouter ذخیره نشده است");
  }
  return Array.isArray(results) ? results : [];
}

// Full-page translation on every page. When the option is on, each finished page load gets the translator
// (page-translator.js). The translator then follows route changes and new text inside that page by itself.
browser.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (!info || info.status !== "complete") return;
  try {
    const { subify_settings = {} } = await browser.storage.local.get("subify_settings");
    const cfg = PAGE_CORE.normalizePageAuto(subify_settings.pageAutoTranslate);
    if (!cfg.enabled || !PAGE_CORE.isTranslatableUrl(tab && tab.url)) return;
    await browser.scripting.executeScript({ target: { tabId }, files: ["page-translate-core.js", "page-translator.js"] });
    await browser.tabs.sendMessage(tabId, { type: "subify-page-translate-start", targetLanguage: cfg.lang, font: cfg.font, auto: true });
  } catch (e) { /* no access to this page, or the tab closed */ }
});

// ---------- Subify account gate (login required) ----------
// The session cookie lives on sub-ify.site (HttpOnly). The extension never sees a token: it only asks
// https://sub-ify.site/auth/me.php "who is signed in?" and the answer is cached for one minute.
const SUBIFY_SITE = "https://sub-ify.site";
const SUBIFY_GATED = new Set(["subify-translate", "subify-page-translate", "subify-vocab-enrich", "subify-vocab-batch", "subify-grammar", "subify-vocab-grammar", "popup-start", "popup-test-live", "subify-cloud-cache-get", "subify-cloud-cache-put", "subify-cache-status", "subify-set-dubbing", "subify-set-dubbing-audio"]);
let subifyAuthCache = { at: 0, value: null };

async function subifyAuthState(force) {
  const now = Date.now();
  if (!force && subifyAuthCache.value && now - subifyAuthCache.at < 60000) return subifyAuthCache.value;
  let value;
  try {
    const res = await fetch(SUBIFY_SITE + "/auth/me.php", { credentials: "include", cache: "no-store" });
    const j = await res.json();
    if (!j || !j.ok) throw new Error("bad response");
    value = { ok: true, required: !!j.required, open: !!j.registration, providers: j.providers || {}, user: j.user || null, fetchedAt: now };
    try { await browser.storage.local.set({ subifyLoginRequired: value.required }); } catch (e) {}
  } catch (e) {
    // server unreachable: stay open unless login was required the last time we could check (fail closed)
    let was = false;
    try { was = !!(await browser.storage.local.get("subifyLoginRequired")).subifyLoginRequired; } catch (e2) {}
    value = { ok: false, offline: true, required: was, open: was, providers: {}, user: null, fetchedAt: now, error: String(e && e.message || e) };
  }
  subifyAuthCache = { at: now, value };
  return value;
}

const SUBIFY_AUTH_ERROR = "ده ویدیوی اول بدون ورود رایگان بود؛ برای ادامه وارد شو (روی آیکون افزونه بزن ← ورود) · The first 10 videos were free without sign-in; sign in to continue (click the extension icon → Sign in)";

// ---------- no-sign-in trial: the first 10 sources work without an account ----------
// Only applies when sub-ify.site requires login. A source counts once, on its first gated action:
// a video (subtitles, dubbing, AI on that video) is its video id; a full-page translation is the page URL.
// The counting rules live in trial-core.js (SubifyTrial), which the tests cover.
const SUBIFY_TRIAL_VIDEOS = 10;
let subifyTrialLock = Promise.resolve();
function subifyTrialVideoIdOf(url) { try { return new URL(String(url || "")).searchParams.get("v") || ""; } catch (e) { return ""; } }
function subifyTrialDirectVideoId(msg) {
  const direct = msg && (msg.videoId || (msg.payload && (msg.payload.videoId || msg.payload.video_id)));
  return direct ? String(direct) : "";
}
async function subifyTrialTabUrl(msg, sender) {
  let url = sender && sender.tab && sender.tab.url;
  if (!url && msg && msg.tabId) { try { url = (await browser.tabs.get(msg.tabId)).url; } catch (e) {} }
  return String(url || "");
}
async function subifyTrialVideoId(msg, sender) {
  return subifyTrialDirectVideoId(msg) || subifyTrialVideoIdOf(await subifyTrialTabUrl(msg, sender));
}
// The key this request counts as: a page translation counts its page, every other gated request counts its video.
async function subifyTrialKeyOf(type, msg, sender) {
  if (type === "subify-page-translate") return SubifyTrial.pageKey(await subifyTrialTabUrl(msg, sender));
  return subifyTrialVideoId(msg, sender);
}
// Registers the source (if there is room) and says whether this request may run.
function subifyTrialTake(key) {
  const run = async () => {
    if (!key) return false;
    const { subifyTrialVideos = [] } = await browser.storage.local.get("subifyTrialVideos");
    const r = SubifyTrial.take(subifyTrialVideos, key, SUBIFY_TRIAL_VIDEOS);
    if (r.added) await browser.storage.local.set({ subifyTrialVideos: r.list });
    return r.allowed;
  };
  const next = subifyTrialLock.then(run, run);
  subifyTrialLock = next.catch(() => {});
  return next.catch(() => false);
}
async function subifyTrialStatus(videoId) {
  const { subifyTrialVideos = [] } = await browser.storage.local.get("subifyTrialVideos");
  const used = subifyTrialVideos.length;
  return { max: SUBIFY_TRIAL_VIDEOS, used, allowed: used < SUBIFY_TRIAL_VIDEOS || (!!videoId && subifyTrialVideos.includes(videoId)) };
}

// Returns the message to show when this request has to wait for sign-in, or "" when it may run.
// A request tied to a video counts toward the no-sign-in trial. An AI request with no video never counts.
async function subifyAuthBlock(type, msg, sender) {
  if (!SUBIFY_GATED.has(type)) return "";
  const a = await subifyAuthState(false);
  if (!(a.required && !a.user)) return "";
  const videoId = await subifyTrialVideoId(msg, sender);
  if (await subifyTrialTake(await subifyTrialKeyOf(type, msg, sender))) return "";
  return SUBIFY_AUTH_ERROR;
}

// ---------- free Subify AI for subtitles (owner's key on the server, monthly allowance) ----------
// Used only when the user has no usable text-AI key for the chosen provider. sub-ify.site/auth/ai.php identifies the
// signed-in member by the session cookie and counts each video (source yt:<id>) once per month. No key is in the extension.
const SUBIFY_FREE_AI_TEXT = {
  auth: "برای ترجمه‌ی رایگان Subify وارد حساب شو، یا کلید AI خودت را ذخیره کن",
  disabled: "ترجمه‌ی رایگان Subify فعلاً خاموش است؛ کلید AI خودت را ذخیره کن",
  quota: "سهمیه‌ی رایگان ماهانه‌ات تمام شده؛ کلید AI خودت را ذخیره کن، دوستانت را دعوت کن یا اشتراک بگیر",
  capacity: "ظرفیت ترجمه‌ی رایگان الان پر است؛ کمی بعد دوباره امتحان کن",
  network: "اتصال به سرور Subify برقرار نشد؛ اینترنت را بررسی کن و دوباره امتحان کن",
  upstream: "سرویس هوش مصنوعی Subify پاسخ نداد؛ چند دقیقه دیگر دوباره امتحان کن",
  empty: "هوش مصنوعی جواب خالی داد؛ در پنل مدیریت «تست اتصال» را بزن و مدل دیگری انتخاب کن",
  failed: "ترجمه‌ی رایگان انجام نشد؛ دوباره امتحان کن"
};
const SUBIFY_FREE_AI_STATUS_CODES = { 401: "auth", 402: "quota", 403: "disabled", 429: "capacity", 502: "upstream", 503: "capacity", 504: "upstream" };
const SUBIFY_FREE_AI_HOLD_MS = 60000;
let subifyFreeAiHold = { until: 0, code: "" };
const subifyFreeAiFinishSeen = new Set();

function subifyFreeAiCode(code) {
  return Object.prototype.hasOwnProperty.call(SUBIFY_FREE_AI_TEXT, code) ? code : "failed";
}
function subifyFreeAiError(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

// True when the chosen provider has a saved key this translation can use (the same rules as the branches in subify-translate).
function subifyHasTextKey(settings, provider) {
  if (provider === "openrouter") return !!settings.openRouterKey;
  if (provider === "openai") return !!settings.openaiKey;
  if (provider === "custom") return !!(getCustomProvider(settings) || {}).apiKey;
  if (provider === "gemini") return !!settings.apiKey;
  return !!(settings.openRouterKey || settings.openaiKey || settings.apiKey);
}

// One subtitle batch through the owner's key on the server. Throws an Error whose .code is a key of SUBIFY_FREE_AI_TEXT.
async function subifyFreeAiTranslate(cues, settings, videoId) {
  if (!videoId) throw subifyFreeAiError("failed");
  if (Date.now() < subifyFreeAiHold.until) throw subifyFreeAiError(subifyFreeAiHold.code);
  // A refusal or a lost connection pauses this fallback for a minute, so the overlay's one-second pump does not call the server every time.
  const refuse = (code) => {
    const c = subifyFreeAiCode(code);
    // A slow or failed server call pauses only briefly; a refusal (quota, capacity, sign-in) pauses for a minute.
    const ms = c === "upstream" || c === "network" || c === "empty" ? 6000 : SUBIFY_FREE_AI_HOLD_MS;
    subifyFreeAiHold = { until: Date.now() + ms, code: c };
    return subifyFreeAiError(c);
  };
  const { prompt, lang } = subtitleItemsAndPrompt(cues, settings);
  let res;
  try {
    res = await fetch(SUBIFY_SITE + "/auth/ai.php?action=chat", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        install: await telemetryInstallId(),
        source: "yt:" + videoId,
        kind: "translate",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
        max_tokens: 4096
      })
    });
  } catch (e) {
    throw refuse("network");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The server's reason goes to the extension log, so a failure can be traced without the server logs.
    await log(`Free Subify AI: HTTP ${res.status} ${data.error || ""}`.trim(), "warn");
    throw refuse(data.error || SUBIFY_FREE_AI_STATUS_CODES[res.status] || "failed");
  }
  let results = [];
  try { results = parseSubtitleResults(String(data.choices?.[0]?.message?.content || ""), "Subify", lang); } catch (e) { results = []; }
  // An empty or unreadable answer is said on the page, not left as a line stuck on "در حال ترجمه".
  if (!Array.isArray(results) || !results.length) { await log("Free Subify AI: reply had no subtitle lines", "warn"); throw refuse("empty"); }
  return results;
}

// Per browser session (storage.session): the videos the owner's key translated part of ("served"), and the ones reported finished ("done").
async function subifyFreeAiVideos() {
  try {
    const { subify_free_ai_videos } = await browser.storage.session.get("subify_free_ai_videos");
    return subify_free_ai_videos || { served: [], done: [] };
  } catch (e) { return { served: [], done: [] }; }
}
async function subifyFreeAiMark(kind, videoId) {
  const s = await subifyFreeAiVideos();
  if (!s[kind].includes(videoId)) s[kind].push(videoId);
  try { await browser.storage.session.set({ subify_free_ai_videos: s }); } catch (e) { /* no session storage: the in-memory guard still holds */ }
}
// The overlay reports that every cue of a video is translated. action=done goes out once per video per browser session,
// and only when the owner's key translated part of that video. Partial or failed runs never send it.
async function subifyFreeAiFinish(videoId) {
  if (!videoId || subifyFreeAiFinishSeen.has(videoId)) return;
  subifyFreeAiFinishSeen.add(videoId);
  const s = await subifyFreeAiVideos();
  if (!s.served.includes(videoId) || s.done.includes(videoId)) return;
  await subifyFreeAiMark("done", videoId);
  fetch(SUBIFY_SITE + "/auth/ai.php?action=done", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "yt:" + videoId })
  }).catch(() => {});
}

let subifyVocabTimer = null;
function scheduleVocabSync() {
  clearTimeout(subifyVocabTimer);
  subifyVocabTimer = setTimeout(() => { subifyVocabSync().catch(() => {}); }, 3000);
}

async function subifyLogout() {
  try { await fetch(SUBIFY_SITE + "/auth/logout.php", { method: "POST", credentials: "include" }); } catch (e) {}
  subifyAuthCache = { at: 0, value: null };
}
// ---------- sign-in result: a failed sign-in returns to sub-ify.site with ?sfy_auth=<code>; keep the code for the gate ----------
browser.tabs.onUpdated.addListener((tabId, info, tab) => {
  const url = (info && info.url) || (tab && tab.url) || "";
  if (!url.startsWith(SUBIFY_SITE + "/")) return;
  const m = /[?&]sfy_auth=([a-z]+)/.exec(url);
  if (!m) return;
  try { Promise.resolve(browser.storage.local.set({ subifyAuthNotice: { code: m[1], at: Date.now() } })).catch(() => {}); } catch (e) {}
});
// ---------- end sign-in result ----------
// ---------- end Subify account gate ----------

// ---------- Subify support tickets (signed-in members) ----------
async function subifyTicketCall(method, body, id) {
  try {
    const url = SUBIFY_SITE + "/auth/tickets.php" + (method === "GET" && id ? "?id=" + encodeURIComponent(String(id)) : "");
    const res = await fetch(url, {
      method, credentials: "include",
      headers: method === "POST" ? { "Content-Type": "text/plain;charset=UTF-8" } : undefined,
      body: method === "POST" ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) return { ok: false, error: res.status === 401 ? "auth" : ((data && data.error) || "server"), status: res.status };
    return data;
  } catch (e) {
    return { ok: false, error: "network" };
  }
}
// ---------- end Subify support tickets ----------



// ---------- Subify vocabulary sync (signed-in users only) ----------
// Same protocol as the web app: POST /auth/vocab.php, last write wins by updatedAt, deletes are tombstones.
// Cards stay in IndexedDB; only the account name/e-mail and the card data cross the network, and only when signed in.
async function subifyVocabSync() {
  try {
    const a = await subifyAuthState(false);
    if (!a.user) return { ok: false, error: "auth" };
    const st = (await browser.storage.local.get(["subifyVocabCursor", "subifyVocabPushedAt", "subifyVocabTombs"])) || {};
    const cursor = Number(st.subifyVocabCursor || 0);
    const pushedAt = Number(st.subifyVocabPushedAt || 0);
    const tombs = st.subifyVocabTombs || {};
    const startedAt = Date.now();
    const rows = await vocabList();
    const cards = rows.filter(r => (Number(r.value.updatedAt) || 0) >= pushedAt - 1000)
      .slice(0, 400).map(r => ({ k: r.key, updatedAt: Number(r.value.updatedAt) || startedAt, data: r.value }));
    const deleted = Object.entries(tombs).filter(([, at]) => Number(at) >= pushedAt - 1000)
      .slice(0, 100).map(([k, at]) => ({ k, at: Number(at) }));
    const res = await fetch(SUBIFY_SITE + "/auth/vocab.php", {
      method: "POST", credentials: "include", headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ cursor, cards, deleted })
    });
    if (res.status === 401) return { ok: false, error: "auth" };
    const data = await res.json().catch(() => null);
    if (!res.ok || !data || !data.ok) return { ok: false, error: "server" };
    let pulled = 0;
    for (const c of data.cards || []) {
      if (!c.data || typeof c.data !== "object") continue;
      const mine = await vocabGet(c.k);
      if (!mine || (Number(c.updatedAt) || 0) > (Number(mine.updatedAt) || 0)) {
        await vocabPut(c.k, { ...c.data, updatedAt: Number(c.updatedAt) }); pulled++;
      }
    }
    for (const d of data.deleted || []) {
      const mine = await vocabGet(d.k);
      if (mine && (Number(mine.updatedAt) || 0) <= Number(d.at)) { await deleteVocabKey(d.k); pulled++; }
      if (!mine || (Number(mine.updatedAt) || 0) <= Number(d.at)) tombs[d.k] = Number(d.at);
    }
    await browser.storage.local.set({ subifyVocabCursor: data.cursor, subifyVocabPushedAt: startedAt, subifyVocabTombs: tombs });
    return { ok: true, pushed: cards.length + deleted.length, pulled };
  } catch (e) {
    return { ok: false, error: "network" };
  }
}
async function deleteVocabKey(key){const d=await subifyDb();return new Promise((res,rej)=>{const r=d.transaction("vocab","readwrite").objectStore("vocab").delete(key);r.onsuccess=()=>res();r.onerror=()=>rej(r.error);});}
async function recordVocabTombstone(key){ try { const st=await browser.storage.local.get("subifyVocabTombs"); const t=st.subifyVocabTombs||{}; t[key]=Date.now(); await browser.storage.local.set({subifyVocabTombs:t}); } catch(e){} }
// The SRS grade is the one learn.js uses (srsGrade in learning-core.js). Chrome's service worker loads that file
// with importScripts when the worker starts. Firefox's background page has no importScripts, so it loads the file
// with a dynamic import the first time a grade is saved. Either way the functions are the same ones learn.js calls.
if (typeof importScripts === "function") importScripts("learning-core.js");
async function subifyLearning() {
  if (!globalThis.SubifyLearning) await import(browser.runtime.getURL("learning-core.js"));
  if (!globalThis.SubifyLearning || typeof globalThis.SubifyLearning.srsGrade !== "function") throw new Error("SRS library not loaded");
  return globalThis.SubifyLearning;
}
// Where a saved word came from: the page tab's title and URL, the video id, and the playback time when the sender
// sends it. Only a web page tab counts; a save from an extension page (learn page, popup) gives no source, so the
// card keeps the source it already has.
function subifyCardSource(msg, sender) {
  const tab = sender && sender.tab;
  const url = String((tab && tab.url) || "");
  if (!/^https?:\/\//i.test(url)) return null;
  const videoId = String(msg.videoId || subifyTrialVideoIdOf(url) || "");
  const tn = msg.t === undefined || msg.t === null || msg.t === "" ? NaN : Number(msg.t);
  return { title: String(tab.title || "").trim().slice(0, 300), videoId, t: Number.isFinite(tn) && tn >= 0 ? Math.floor(tn) : null, url: url.slice(0, 2000) };
}
// ---------- end Subify vocabulary sync ----------

// ---------- Subify AI pages (chat, summary, roleplay, writer, shadowing) ----------
// The AI pages are extension pages. They send one request type, "subify-ai-generate",
// and this worker calls Gemini with the user's own key. Replies: { ok, text } or { ok:false, code, error }.
const SUBIFY_AI_PAGES = ["chat.html", "summary.html", "roleplay.html", "writer.html", "shadow.html"];
function subifyAiFriendlyError(status, raw) {
  const s = Number(status) || 0;
  if (s === 429) return { code: "quota", error: "سقف درخواست‌های Gemini پر شده. یک دقیقه صبر کن و دوباره امتحان کن." };
  if (s === 401 || s === 403) return { code: "key", error: "کلید Gemini معتبر نیست یا دسترسی ندارد. کلید را در تب «کلیدها» بررسی کن." };
  if (s === 400) return { code: "bad-request", error: "Gemini این درخواست را قبول نکرد. متن یا صدا را کوتاه‌تر کن و دوباره امتحان کن." };
  if (s >= 500) return { code: "server", error: "سرور Gemini الان در دسترس نیست. کمی بعد دوباره امتحان کن." };
  return { code: "unknown", error: "پاسخی از هوش مصنوعی گرفته نشد. دوباره امتحان کن.", detail: String(raw || "").slice(0, 160) };
}
async function subifyAiGenerate(settings, req) {
  // req comes from SubifyAiRoute.prepare: req.messages is the whole conversation, in order (or the one prompt).
  const contents = (Array.isArray(req.messages) ? req.messages : []).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.content) }]
  }));
  if (!contents.length) contents.push({ role: "user", parts: [{ text: String(req.prompt || "") }] });
  if (req.audio && req.audio.base64) {
    const mime = String(req.audio.mime || "audio/wav").split(";")[0].trim() || "audio/wav";
    contents[contents.length - 1].parts.unshift({ inlineData: { mimeType: mime, data: String(req.audio.base64) } });
  }
  const generationConfig = {
    temperature: Math.min(Math.max(Number(req.temperature) || 0.4, 0), 1),
    maxOutputTokens: Math.min(Math.max(Number(req.maxTokens) || 2048, 256), 8192)
  };
  if (req.json) generationConfig.responseMimeType = "application/json";
  const body = { contents, generationConfig };
  if (req.system) body.systemInstruction = { parts: [{ text: String(req.system) }] };
  // Same model order as the subtitle engine. Only a "model not found" reply moves on to the next model.
  const models = [settings.sttModel || STT_FALLBACKS[0], ...STT_FALLBACKS].filter((m, i, a) => a.indexOf(m) === i);
  let lastStatus = 0, lastRaw = "";
  for (const model of models) {
    let r, raw;
    try {
      r = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(settings.apiKey)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      });
      raw = await r.text();
    } catch (e) {
      return { ok: false, code: "network", error: "اتصال به Gemini برقرار نشد. اینترنت را بررسی کن و دوباره امتحان کن.", detail: String(e.message || e) };
    }
    if (!r.ok) {
      lastStatus = r.status; lastRaw = raw;
      if (r.status === 404) continue;
      return { ok: false, ...subifyAiFriendlyError(r.status, raw) };
    }
    let data = {};
    try { data = JSON.parse(raw); } catch (_) { data = {}; }
    const candidate = data.candidates?.[0] || {};
    // The text is not trimmed here: a continuation is joined to it (ai-route-core.js).
    const text = (candidate.content?.parts || []).map((p) => p.text || "").join("");
    if (!text.trim()) return { ok: false, code: "empty", error: "هوش مصنوعی جواب خالی داد. دوباره امتحان کن یا متن را کمی تغییر بده." };
    return { ok: true, text, model, cut: candidate.finishReason === "MAX_TOKENS" };
  }
  return { ok: false, ...subifyAiFriendlyError(lastStatus, lastRaw) };
}
// The AI pages (chat, summary, roleplay, writer, shadowing) and the roleplay memo are not gated: no sign-in, no trial count.

// ---------- AI pages: provider routing (round 21) ----------
// The provider the user chose (subtitleProvider) goes first, then the others with a saved key (ai-route-core.js).
// Gemini uses subifyAiGenerate above. OpenRouter, OpenAI and Custom API take one chat call each, with the same key settings.
async function subifyProviderText(name, settings, req) {
  // req comes from SubifyAiRoute.prepare: req.messages is the whole conversation, in order (or the one prompt).
  const system = String(req.system || "");
  const turns = Array.isArray(req.messages) && req.messages.length ? req.messages : [{ role: "user", content: String(req.prompt || "") }];
  const maxTokens = Math.min(Math.max(Number(req.maxTokens) || 2048, 256), 8192);
  const temperature = Math.min(Math.max(Number(req.temperature) || 0.4, 0), 1);
  const chat = (system ? [{ role: "system", content: system }] : [])
    .concat(turns.map((m) => ({ role: m.role, content: String(m.content) })));
  const chatCut = (d) => d.choices?.[0]?.finish_reason === "length";
  let url, headers, body, model, read, cut;
  if (name === "openrouter") {
    model = settings.openRouterModel || "openrouter/free";
    url = `${OPENROUTER_BASE}/chat/completions`;
    headers = { Authorization: `Bearer ${settings.openRouterKey}`, "Content-Type": "application/json", "X-Title": "subify chat" };
    body = { model, messages: chat, temperature, max_tokens: maxTokens };
    read = (d) => String(d.choices?.[0]?.message?.content || "");
    cut = chatCut;
  } else if (name === "openai") {
    // Same call as the subtitle and vocabulary calls above (Responses API).
    model = settings.openaiModel || "gpt-5.6-luna";
    url = "https://api.openai.com/v1/responses";
    headers = { Authorization: `Bearer ${settings.openaiKey}`, "Content-Type": "application/json" };
    body = {
      model,
      input: turns.map((m) => ({ role: m.role, content: m.role === "user" ? [{ type: "input_text", text: String(m.content) }] : String(m.content) })),
      temperature,
      max_output_tokens: maxTokens
    };
    if (system) body.instructions = system;
    read = (d) => {
      let t = String(d.output_text || "");
      if (!t.trim() && Array.isArray(d.output)) t = d.output.flatMap((i) => (Array.isArray(i.content) ? i.content : [])).map((x) => x?.text || "").join("\n");
      return t;
    };
    cut = (d) => d.status === "incomplete" && d.incomplete_details?.reason === "max_output_tokens";
  } else {
    const p = getCustomProvider(settings);
    if (!p) return { ok: false, code: "no-key", error: SubifyAiRoute.TEXT.NO_KEY };
    const base = normalizeCustomBaseUrl(p.baseUrl);
    model = p.model;
    url = /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
    headers = { Authorization: `Bearer ${p.apiKey}`, "Content-Type": "application/json" };
    body = { model, messages: chat, temperature, max_tokens: maxTokens };
    read = (d) => String(d.choices?.[0]?.message?.content || d.output_text || "");
    cut = chatCut;
  }
  const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  const raw = await res.text();
  if (!res.ok) return { ok: false, ...SubifyAiRoute.failureFor(res.status) };
  let data = {};
  try { data = JSON.parse(raw); } catch (_) { data = {}; }
  // Not trimmed: a continuation is joined to it (ai-route-core.js).
  const text = String(read(data) || "");
  if (!text.trim()) return { ok: false, code: "empty", error: SubifyAiRoute.TEXT.FAILED };
  return { ok: true, text, model, cut: !!cut(data) };
}
// Practice calls with no own key (chat, writer, roleplay, shadow): the owner's key on the server, one daily cap per feature.
// Text only, so audio never comes here. The server's error codes become Persian messages in ai-route-core.js (freeFailure).
async function subifyPracticeFree(req) {
  const feature = SubifyAiRoute.FREE_FEATURES.includes(req.feature) ? req.feature : "";
  const turns = (Array.isArray(req.messages) ? req.messages : []).map((m) => ({ role: m.role, content: String(m.content) }));
  const messages = (req.system ? [{ role: "system", content: String(req.system) }] : []).concat(turns);
  const temperature = Math.min(Math.max(Number(req.temperature) || 0.4, 0), 1);
  const maxTokens = Math.min(Math.max(Number(req.maxTokens) || 2048, 256), 8192);
  let res;
  try {
    res = await fetch(SUBIFY_SITE + "/auth/ai.php?action=chat", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ install: await telemetryInstallId(), feature, source: "", kind: String(req.kind || ""), messages, temperature, max_tokens: maxTokens })
    });
  } catch (e) {
    return { ok: false, code: "network", error: SubifyAiRoute.FREE_TEXT.network };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return SubifyAiRoute.freeFailure(res.status, data, feature);
  const choice = data.choices?.[0] || {};
  const text = String(choice.message?.content ?? "");
  if (!text.trim()) return { ok: false, code: "empty", error: SubifyAiRoute.FREE_TEXT.failed };
  return { ok: true, text, model: "subify", cut: choice.finish_reason === "length" };
}
// Runs one AI page request (chat, summary, roleplay, writer, shadowing, roleplay memo) through the chosen provider.
// With no own key at all, a practice call (req.feature) goes to the free allowance.
async function subifyAiRoute(req) {
  const settings = await getSettings();
  return SubifyAiRoute.route(req, settings, {
    gemini: (r) => subifyAiGenerate(settings, r),
    openrouter: (r) => subifyProviderText("openrouter", settings, r),
    openai: (r) => subifyProviderText("openai", settings, r),
    custom: (r) => subifyProviderText("custom", settings, r),
    free: (r) => subifyPracticeFree(r)
  });
}

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const authError = await subifyAuthBlock(msg.type, msg, sender);
    if (authError) {
      sendResponse({ ok: false, authRequired: true, error: authError });
      return;
    }
    switch (msg.type) {
      case "subify-auth-open": {
        const p = msg.provider === "github" ? "github" : "google";
        try { await browser.tabs.create({ url: SUBIFY_SITE + "/auth/login.php?provider=" + p + "&return=" + encodeURIComponent(SUBIFY_SITE + "/?ext=1") }); sendResponse({ ok: true }); } catch (e) { sendResponse({ ok: false }); }
        break;
      }
      case "subify-tickets-list": { sendResponse(await subifyTicketCall("GET", null)); break; }
      case "subify-tickets-get": { sendResponse(await subifyTicketCall("GET", null, msg.id)); break; }
      case "subify-tickets-create": { sendResponse(await subifyTicketCall("POST", { action: "create", subject: String(msg.subject || ""), category: String(msg.category || "other"), body: String(msg.body || "") })); break; }
      case "subify-tickets-reply": { sendResponse(await subifyTicketCall("POST", { action: "reply", id: Number(msg.id) || 0, body: String(msg.body || "") })); break; }
      case "subify-auth-status": {
        const st = await subifyAuthState(!!msg.force);
        sendResponse({ ...st, trial: await subifyTrialStatus(msg.videoId ? String(msg.videoId) : "") });
        break;
      }
      case "subify-auth-logout": {
        await subifyLogout();
        sendResponse(await subifyAuthState(true));
        break;
      }
      case "subify-cloud-cache-get": {
        try {
          const result = await subifyCloudCacheGet(msg.payload || {});
          sendResponse(result);
        } catch (e) {
          sendResponse({ ok: false, error: String(e.message || e) });
        }
        break;
      }
      case "subify-stat": {
        // Counters from the popup and the subtitle overlay for the anonymous daily report. Only these keys count.
        if (msg.key === "subtitleFiles") await recordStats({ subtitleFiles: 1 });
        if (msg.key === "cacheCues") {
          const n = (v) => Math.max(0, Math.min(200000, Math.round(Number(v) || 0)));
          await recordStats({ cacheCuesAsked: n(msg.asked), cacheCuesHit: n(msg.hit) });
        }
        sendResponse({ ok: true });
        break;
      }
      case "subify-cache-status": {
        try {
          const res = await fetch(`${SUBIFY_CLOUD_CACHE_URL}/status`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ video_id: String(msg.videoId || ""), target_language: String(msg.targetLanguage || "fa").toLowerCase() })
          });
          const data = await res.json().catch(() => ({}));
          sendResponse({ ok: !!data.ok, rows: Number(data.rows) || 0 });
        } catch (e) {
          sendResponse({ ok: false, rows: 0 });
        }
        break;
      }
      case "subify-cloud-cache-put": {
        try {
          const result = await subifyCloudCachePut(msg.payload || {});
          sendResponse(result);
        } catch (e) {
          sendResponse({ ok: false, error: String(e.message || e) });
        }
        break;
      }
      case "subify-cloud-cache-correct": {
        try {
          const result = await subifyCloudCacheCorrect(msg.payload || {});
          sendResponse(result);
        } catch (e) {
          sendResponse({ ok: false, code: "network", error: String(e.message || e) });
        }
        break;
      }
      case "subify-free-video-done": {
        try { await subifyFreeAiFinish(String(msg.videoId || "")); } catch (e) { /* ignore: done is best effort */ }
        sendResponse({ ok: true });
        break;
      }
      case "subify-translate": {
        try {
          const settings = await getSettings();
          const cues = Array.isArray(msg.cues) ? msg.cues.slice(0, 24) : [];
          if (!cues.length) { sendResponse({ ok: true, results: [] }); break; }
          const provider = settings.subtitleProvider || "auto";
          let fallbackFrom = "";
          const recordUsage = (usedProvider, results) => {
            const charsIn = cues.reduce((n, c) => n + String(c?.text || "").length, 0);
            const charsOut = (results || []).reduce((n, r) => n + String(r?.text || r?.translation || r?.fa || "").length, 0);
            noteSubtitleProvider(usedProvider, fallbackFrom);
            const subtitleSeconds = cues.reduce((n, c) => n + Math.max(0, (Number(c?.end) || 0) - (Number(c?.start) || 0)), 0);
            const srcLang = String(msg.sourceLanguage || "").toLowerCase();
            return recordStats({ subtitleCues: cues.length, subtitleSeconds: Math.round(subtitleSeconds), subtitleCharsIn: charsIn, subtitleCharsOut: charsOut, provider: usedProvider, ...(srcLang ? { langCode: srcLang, langSeconds: Math.round(subtitleSeconds) } : {}) }).catch(() => {});
          };
          // No usable key for the chosen provider: the batch goes to the owner's key on the server (monthly free allowance).
          if (!subifyHasTextKey(settings, provider)) {
            const freeVideoId = String(msg.videoId || (await subifyTrialVideoId(msg, sender)) || "");
            try {
              const results = await subifyFreeAiTranslate(cues, settings, freeVideoId);
              await subifyFreeAiMark("served", freeVideoId);
              await recordUsage("subify", results);
              try { await syncSubtitleBatchToCloud({ videoId: msg.videoId, trackKey: msg.trackKey, targetLanguage: msg.targetLanguage, cues, results }); } catch (e) { await log("Cloud cache sync failed: " + (e.message || e), "warn"); }
              sendResponse({ ok: true, provider: "subify", results });
            } catch (e) {
              const code = subifyFreeAiCode(e.code);
              await log("Free Subify AI batch not translated: " + code, "warn");
              sendResponse({ ok: false, freeAi: true, code, error: SUBIFY_FREE_AI_TEXT[code] });
            }
            break;
          }
          if (provider === "openrouter") {
            if (!settings.openRouterKey) throw new Error("OpenRouter is selected, but no OpenRouter API key is saved");
            const results = await translateSubtitleCuesOpenRouter(cues, settings);
            await recordUsage("openrouter", results);
            try { await syncSubtitleBatchToCloud({ videoId: msg.videoId, trackKey: msg.trackKey, targetLanguage: msg.targetLanguage, cues, results }); } catch (e) { await log("Cloud cache sync failed: " + (e.message || e), "warn"); }
            sendResponse({ ok: true, provider: "openrouter", results });
            break;
          }
          if (provider === "custom") {
            const results = await translateSubtitleCuesCustom(cues, settings);
            await recordUsage("custom", results);
            try { await syncSubtitleBatchToCloud({ videoId: msg.videoId, trackKey: msg.trackKey, targetLanguage: msg.targetLanguage, cues, results }); } catch (e) { await log("Cloud cache sync failed: " + (e.message || e), "warn"); }
            sendResponse({ ok: true, provider: "custom", results });
            break;
          }
          if (provider === "openai") {
            if (!settings.openaiKey) throw new Error("OpenAI is selected, but no OpenAI API key is saved");
            const results = await translateSubtitleCuesOpenAI(cues, settings);
            await recordUsage("openai", results);
            try { await syncSubtitleBatchToCloud({ videoId: msg.videoId, trackKey: msg.trackKey, targetLanguage: msg.targetLanguage, cues, results }); } catch (e) { await log("Cloud cache sync failed: " + (e.message || e), "warn"); }
            sendResponse({ ok: true, provider: "openai", results });
            break;
          }
          if (provider === "gemini" && !settings.apiKey) throw new Error("Gemini انتخاب شده، اما کلید Gemini ذخیره نشده است");
          if (provider === "auto" && !settings.apiKey && !settings.openRouterKey && !settings.openaiKey) throw new Error("هیچ کلید Gemini، OpenRouter یا OpenAI ذخیره نشده است");
          let results, usedProvider;
          if (provider === "auto") {
            // Auto does NOT prefer Gemini. Each configured provider is tried in turn:
            // OpenRouter, then OpenAI, then Gemini. A quota or temporary error moves the
            // batch to the next one, and the popup shows which provider handled it.
            const chain = [];
            if (settings.openRouterKey) chain.push(["openrouter", () => translateSubtitleCuesOpenRouter(cues, settings)]);
            if (settings.openaiKey) chain.push(["openai", () => translateSubtitleCuesOpenAI(cues, settings)]);
            if (settings.apiKey) chain.push(["gemini", () => {
              const chosen = settings.geminiSubtitleModel || settings.sttModel;
              return withModelFallback({ ...settings, sttModel: chosen }, "sttModel", [chosen, ...STT_FALLBACKS], (m) => translateSubtitleCues(cues, { ...settings, subtitleProvider: "gemini" }, m));
            }]);
            for (let i = 0; i < chain.length; i++) {
              try {
                results = await chain[i][1]();
                usedProvider = chain[i][0];
                break;
              } catch (e) {
                if (i === chain.length - 1 || !isQuotaOrTransientError(e)) throw e;
                fallbackFrom = fallbackFrom || chain[i][0];
                await log(`${chain[i][0]} quota or temporary error; this batch goes to ${chain[i + 1][0]}`, "warn");
              }
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
          await recordUsage(usedProvider, results);
          try { await syncSubtitleBatchToCloud({ videoId: msg.videoId, trackKey: msg.trackKey, targetLanguage: msg.targetLanguage, cues, results }); } catch (e) { await log("Cloud cache sync failed: " + (e.message || e), "warn"); }
          sendResponse({ ok: true, provider: usedProvider, results });
        } catch (e) {
          await log("Subtitle translation failed: " + (e.message || e), "error");
          sendResponse({ ok: false, error: String(e.message || e) });
        }
        break;
      }
      case "subify-page-translate": {
        try { sendResponse(await translatePageTexts(msg.texts, msg.targetLanguage)); }
        catch (e) { await log("Page translation failed: " + (e.message || e), "error"); sendResponse({ ok:false, error:String(e.message || e) }); }
        break;
      }
      case "subify-clear-all-data": {
        try { const serverDeleted = await clearAllLocalData(); sendResponse({ ok: true, serverDeleted }); }
        catch (e) { sendResponse({ ok: false, error: String(e.message || e) }); }
        break;
      }
      case "subify-discover-models": {
        try {
          const result = await discoverModels();
          sendResponse({ ok: true, models: result.all.map(m=>m.id) });
        } catch (e) {
          await log("Model discovery failed: " + (e.message || e), "error");
          sendResponse({ ok: false, error: String(e.message || e) });
        }
        break;
      }
      case "subify-test-key": {
        try {
          const settings = await getSettings();
          const result = await testGeminiKey(settings);
          await log(`Gemini key valid: test model: ${result.model}; ${result.count} generateContent models / ${result.total} total.`, "ok");
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
          await log(`OpenAI key valid: model: ${result.model}`, "ok");
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
          await log(`OpenRouter connected: model: ${result.model}`, "ok");
          sendResponse(result);
        } catch (e) {
          await log("OpenRouter test failed: " + (e.message || e), "error");
          sendResponse({ ok: false, error: String(e.message || e) });
        }
        break;
      }
      case "subify-test-custom": {
        try { const settings=await getSettings(); const result=await testCustomProvider(settings,msg.id); await log(`Custom API valid: ${result.name} • model: ${result.model}`,"ok"); sendResponse(result); }
        catch(e){ await log("Custom API test failed: "+(e.message||e),"error"); sendResponse({ok:false,error:String(e.message||e)}); }
        break;
      }
      case "subify-list-custom-models": {
        try { const settings=await getSettings(); const p=getCustomProvider(settings,msg.id); const models=await listCustomModels(p); sendResponse({ok:true,models}); }
        catch(e){ sendResponse({ok:false,error:String(e.message||e)}); }
        break;
      }
      case "subify-capture-shot": {
        try {
          const tabId=Number(msg.tabId); const tab=await browser.tabs.get(tabId);
          const dataUrl=await browser.tabs.captureVisibleTab(tab.windowId,{format:"png"});
          const id=`shot_${Date.now()}`;
          await browser.storage.session.set({subify_last_shot:{id,dataUrl,title:tab.title||"Subify",url:tab.url||"",createdAt:Date.now()}});
          if(msg.download!==false) await browser.downloads.download({url:dataUrl,filename:`Subify-${Date.now()}.png`,saveAs:true});
          sendResponse({ok:true,id,dataUrl});
        } catch(e){sendResponse({ok:false,error:String(e.message||e)});} break;
      }
      case "subify-grammar": {
        try {
          const sentence = String(msg.sentence || "").trim();
          if (!sentence) throw new Error("Sentence is empty");
          const lang = String(msg.lang || "auto").split("-")[0];
          const prev = String(msg.prev || ""), next = String(msg.next || "");
          const cefr = GRAMMAR_CEFR.includes(msg.cefr) ? msg.cefr : "B1";
          const explainLang = GRAMMAR_LANG_NAMES[msg.explainLang] ? msg.explainLang : "fa";
          const key = [lang, cefr, explainLang, sentence, prev, next].join("|");
          if (grammarCache.has(key)) { sendResponse({ ok: true, grammar: grammarCache.get(key), cached: true }); break; }
          const settings = await getSettings();
          const grammar = await explainSentenceGrammar(settings, sentence, prev, next, String(msg.translation || ""), lang, cefr, explainLang);
          const filled = Object.values(grammar).some((v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)));
          if (!filled) throw new Error("AI reply had no grammar explanation");
          if (grammarCache.size > 300) grammarCache.clear();
          grammarCache.set(key, grammar);
          sendResponse({ ok: true, grammar });
        } catch (e) { sendResponse({ ok: false, error: String(e.message || e) }); }
        break;
      }
      case "subify-vocab-enrich": {
        try {
          const settings=await getSettings();
          const word=String(msg.word||"").trim(); if(!word) throw new Error("Word is empty");
          const lang=String(msg.lang||"auto").split("-")[0];
          const key=`${lang}:${word.toLowerCase()}`;
          const old=await vocabGet(key);
          const source=subifyCardSource(msg,sender);
          const base={...(old||{}),word,lang,sentence:String(msg.sentence||""),translation:String(msg.translation||""),box:old?.box||1,nextDueAt:old?.nextDueAt||Date.now(),updatedAt:Date.now(),history:old?.history||[],...(source?{source}:{})};
          // Saved immediately, so a click is never lost even if the AI call fails.
          await vocabPut(key,base); scheduleVocabSync();
          // r21: a word clicked in a subtitle keeps that subtitle line as its example. The generated example is only the fallback.
          const srcLine=msg.fromSubtitle?String(base.sentence||""):"";
          let card=base, aiError="", aiInfo=null;
          try {
            const L=await subifyLearning();
            // Fetch the fast deterministic dictionary and the context-aware AI entry
            // at the same time. Previously these were sequential, so a slow AI
            // response was followed by another network round-trip for the fallback.
            const [aiResult, fallbackResult] = await Promise.allSettled([
              enrichWord(settings,word,base.sentence,srcLine),
              fetchDictionaryFallback(word,lang,base.translation)
            ]);
            const fallback = fallbackResult.status === "fulfilled" ? fallbackResult.value : null;
            if (aiResult.status !== "fulfilled") {
              aiError=String(aiResult.reason?.message||aiResult.reason||"");
              card={...base,...(fallback||{}),enriched:Boolean(fallback?.definition||fallback?.pos||fallback?.ipa),updatedAt:Date.now()};
              if (!card.meaning && base.translation) card.meaning = base.translation;
            } else {
              aiInfo=aiResult.value;
              card={...base,...L.entryCardFields(aiInfo),enriched:false,updatedAt:Date.now()};
              // AI is the context-aware source, but it can return a partial card.
              // Fill only missing dictionary fields from the already-running fallback.
              for (const k of ["lemma","ipa","pos","meaning","definition","example","forms","note","level"]) {
                if (!card[k] && fallback?.[k]) card[k]=fallback[k];
              }
              if (!card.synonyms?.length && fallback?.synonyms?.length) card.synonyms=fallback.synonyms;
            }
            if (srcLine) {
              card.example=srcLine;
              card.exampleFa=(aiInfo&&card.exampleFa)||base.translation||"";
            }
            card.enriched=Boolean(card.meaning||card.definition||card.pos||card.ipa||card.example||card.synonyms?.length);
            await vocabPut(key,card);
          } catch(e){
            aiError=String(e.message||e);
            const fallback=await fetchDictionaryFallback(word,lang,base.translation);
            card={...base,...fallback,enriched:Boolean(fallback.definition||fallback.pos||fallback.ipa),updatedAt:Date.now()};
            if (!card.meaning && base.translation) card.meaning = base.translation;
            if (srcLine) { card.example=srcLine; card.exampleFa=base.translation||""; }
            await vocabPut(key, card);
          }
          sendResponse({ok:true,card,aiError});
        } catch(e){sendResponse({ok:false,error:String(e.message||e)});}
        break;
      }
      case "subify-vocab-batch": {
        // r21 word-list mode: one AI call for up to WORD_BATCH_MAX words. Each word that comes back with a meaning is saved
        // the same way as a clicked word. Words without an entry are returned in "missing" and not saved.
        try {
          const settings=await getSettings();
          const L=await subifyLearning();
          const words=(Array.isArray(msg.words)?msg.words:[]).map(w=>String(w==null?"":w).trim()).filter(Boolean).slice(0,L.WORD_BATCH_MAX);
          if(!words.length) throw new Error("No words");
          const lang=String(msg.lang||"auto").split("-")[0]||"auto";
          const reply=parseJsonLoose(await callTextLLM(settings,L.wordListPrompt(words,lang),{fast:true,maxTokens:4000}));
          const entries=L.matchWordEntries(words,reply);
          const cards=[], missing=[];
          for(let i=0;i<words.length;i++){
            const entry=entries[i];
            if(!entry){ missing.push(words[i]); continue; }
            const code=String(entry.langCode||"").trim().toLowerCase();
            const cardLang=/^[a-z]{2,3}$/.test(code)?code:lang;
            const key=`${cardLang}:${words[i].toLowerCase()}`;
            const old=await vocabGet(key);
            const card={...(old||{}),word:words[i],lang:cardLang,sentence:old?.sentence||"",translation:old?.translation||"",box:old?.box||1,nextDueAt:old?.nextDueAt||Date.now(),history:old?.history||[],...L.entryCardFields(entry),enriched:true,updatedAt:Date.now()};
            await vocabPut(key,card);
            cards.push(card);
          }
          if(cards.length) scheduleVocabSync();
          sendResponse({ok:true,cards,missing});
        } catch(e){sendResponse({ok:false,error:String(e.message||e)});}
        break;
      }
      case "subify-vocab-sync": { sendResponse(await subifyVocabSync()); break; }
      case "subify-vocab-grammar": {
        try {
          const key=String(msg.key||"");
          const g=msg.grammar&&typeof msg.grammar==="object"?msg.grammar:null;
          if(!g) throw new Error("No grammar to save");
          const c=await vocabGet(key); if(!c) throw new Error("Card not found");
          const short=(v)=>String(v==null?"":v).replace(/\s+/g," ").trim().slice(0,600);
          const grammar={};
          for(const k of ["meaning","tense","structure","grammar","why","simpler","advanced"]) grammar[k]=short(g[k]);
          grammar.natural=(Array.isArray(g.natural)?g.natural:[]).map(short).filter(Boolean).slice(0,2);
          await vocabPut(key,{...c,grammar,grammarAt:Date.now()}); scheduleVocabSync();
          sendResponse({ok:true});
        } catch(e){ sendResponse({ok:false,error:String(e.message||e)}); }
        break;
      }
      case "subify-account-videos": {
        try {
          const res = await fetch(SUBIFY_SITE + "/subify-api/account/history?limit=20", { credentials: "include", cache: "no-store" });
          if (res.status === 401 || res.status === 403) { sendResponse({ ok: true, signedIn: false, items: [] }); break; }
          const j = await res.json();
          if (!j || !j.ok) throw new Error("bad response");
          const items = (j.items || [])
            .filter((i) => i && i.data && i.data.type === "video" && /^[A-Za-z0-9_-]{6,20}$/.test(String(i.data.videoId || "")))
            .map((i) => ({ videoId: String(i.data.videoId), title: String(i.data.title || i.data.videoId).slice(0, 140), position: Number(i.data.position) || 0 }));
          sendResponse({ ok: true, signedIn: true, items });
        } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
        break;
      }
      case "subify-vocab-list": { try { const rows=await vocabList(); sendResponse({ok:true,rows:rows.map(x=>x.value)}); } catch(e){sendResponse({ok:false,error:String(e.message||e)});} break; }
      case "subify-roleplay-save": {
        // Words from a roleplay lesson: new cards in the practice language, with the practice as their source. No AI call,
        // so this type is not gated. A word already saved, or repeated in the list, is skipped and never saved twice.
        try {
          const L=await subifyLearning();
          const lang=String(msg.lang||"auto").split("-")[0];
          const rows=await vocabList();
          const existing=rows.map(r=>L.wordKey(r.value.lang,r.value.word));
          const words=(Array.isArray(msg.words)?msg.words:[]).slice(0,20);
          const plan=L.planPracticeSaves(words,{lang,existing,now:Date.now(),level:String(msg.level||"")});
          const tombs=(await browser.storage.local.get("subifyVocabTombs")).subifyVocabTombs||{};
          let cleared=false;
          for(const item of plan.cards){
            await vocabPut(item.key,item.card);
            // Saving a word again cancels an older delete, as the web app does.
            if(tombs[item.key]){ delete tombs[item.key]; cleared=true; }
          }
          if(cleared) await browser.storage.local.set({subifyVocabTombs:tombs});
          if(plan.cards.length) scheduleVocabSync();
          sendResponse({ok:true,saved:plan.cards.map(item=>item.card.word),skipped:plan.skipped});
        } catch(e){ sendResponse({ok:false,error:String(e.message||e)}); }
        break;
      }
      case "subify-vocab-grade": {
        // Same grading as learn.js: srsGrade() moves the card and keeps the old box-based cards working (srsMigrate).
        try {
          const key=String(msg.key||"");
          const c=await vocabGet(key); if(!c) throw new Error("Card not found");
          const L=await subifyLearning();
          const next=L.srsGrade(c,String(msg.grade||"again"),Date.now());
          await vocabPut(key,next); scheduleVocabSync();
          sendResponse({ok:true,card:next});
        } catch(e){ sendResponse({ok:false,error:String(e.message||e)}); }
        break;
      }
      case "popup-start": {
        // Master button starts only the subtitle engine. Subtitle extraction
        // reads YouTube's timed caption track and does NOT capture tab audio.
        await browser.storage.local.set({ subify_subtitle_enabled: true });
        try { await browser.tabs.sendMessage(msg.tabId, { type: "subify-enable-subtitles" }); } catch (_) {}
        await setState({ error: "" });
        break;
      }
      case "popup-stop": {
        await browser.storage.local.set({ subify_subtitle_enabled: false, subify_dubbing_enabled: false });
        await stopDubbing("stopped by user");
        try { await browser.tabs.sendMessage(msg.tabId, { type: "subify-disable-subtitles" }); } catch (_) {}
        break;
      }
      case "subify-open-options": {
        // Content scripts (the YouTube player panel) cannot open the options page themselves.
        try { await browser.runtime.openOptionsPage(); sendResponse({ ok: true }); } catch (e) { sendResponse({ ok: false, error: String(e.message || e) }); }
        break;
      }
      case "popup-get-status": {
        const state = await setState({});
        sendResponse({ ok: true, state });
        break;
      }
      case "subify-set-dubbing": {
        // tabId is normally supplied by the popup (which has tabs access);
        // a content script (e.g. the in-player Subify control) can't query
        // its own tab id, so fall back to the sender's tab when omitted.
        const tabId = Number.isInteger(Number(msg.tabId)) && msg.tabId != null ? Number(msg.tabId) : Number(sender?.tab?.id);
        if (!Number.isInteger(tabId)) throw new Error("تب فعال پیدا نشد");
        if (msg.enabled) {
          await startDubbing(tabId);
          const st = await getState();
          sendResponse({ ok: st.active, state: st, error: st.error || "" });
        } else {
          await stopDubbing("dubbing disabled by user");
          sendResponse({ ok: true, state: await getState() });
        }
        break;
      }
      case "subify-set-dubbing-audio": {
        // Live-toggle the "captions only" preference without restarting the
        // whole capture session, when dubbing is already running.
        try {
          const r = await browser.runtime.sendMessage({ type: "offscreen-set-dubbing", enabled: Boolean(msg.enabled) });
          sendResponse({ ok: true, ...r });
        } catch (e) { sendResponse({ ok: false, error: String(e.message || e) }); }
        break;
      }
      case "popup-self-test":
        await selfTest();
        sendResponse({ ok: true });
        break;
      case "popup-test-live": {
        await browser.storage.session.set({ pd_log: [] });
        try {
          const settings = await getSettings();
          if (!settings.apiKey) throw new Error("کلید Gemini ذخیره نشده است");
          await ensureOffscreen();
          const r = await browser.runtime.sendMessage({ type: "offscreen-test-live", settings });
          sendResponse(r || { ok: false, error: "Live test returned no result" });
        } catch (e) {
          await log("Live test failed: " + (e.message || e), "error");
          sendResponse({ ok: false, error: String(e.message || e) });
        }
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
          const r = await browser.runtime.sendMessage({ type: "offscreen-export", mode: msg.mode, format: msg.format });
          if (!r || !r.ok || !r.url) {
            const error = (r && r.error) || "nothing to export";
            await log("Export failed: " + error, "error");
            sendResponse({ ok: false, error });
            break;
          }
          if (!browser.downloads || !browser.downloads.download) {
            const error = "Downloads permission missing. Reload the extension after updating.";
            await log(error, "error");
            sendResponse({ ok: false, error });
            break;
          }
          try {
            const id = await browser.downloads.download({
              url: r.url, filename: msg.filename, saveAs: true
            });
            await log(`Saving ${msg.filename}: ${(r.bytes / 1048576).toFixed(1)} MB (download ${id})`, "ok");
          } catch (dlErr) {
            const error = `Download API failed: ${dlErr?.message || dlErr}`;
            await log(error, "error");
            sendResponse({ ok: false, error });
            break;
          }
          await recordStats({ exports: 1, [msg.format === "mp3" ? "exportsMp3" : "exportsWav"]: 1 });
          sendResponse({ ok: true, bytes: r.bytes, seconds: r.seconds, filename: msg.filename });
        } catch (e) {
          const error = String(e.message || e);
          await log("Export failed: " + error, "error");
          sendResponse({ ok: false, error });
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
            await browser.storage.local.set({
              pd_settings: { ...s, liveSetupVariant: msg.schemaVariant }
            });
            await log(`Remembered working setup schema (variant ${msg.schemaVariant}): next session connects straight away`);
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
          await setState({ error: "Live engine failed: " + (msg.error || "no audio returned") });
          await log("Auto-fallback is off, so dubbing has stopped.", "error");
          await stopDubbing("live engine failed");
          break;
        }
        await log("Falling back to the chunked engine so you still get audio…", "warn");
        await browser.storage.local.set({ pd_settings: { ...s, engine: "chunked" } });
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
      case "live-cue": {
        await addCue(msg.start, msg.end, msg.text);
        await setState({ lastText: msg.text });
        await recordStats({ chunks: 1, seconds: Math.max(0, msg.end - msg.start), liveCaptionSeconds: Math.max(0, msg.end - msg.start) });
        // Show it as an on-screen caption too — this is what makes "captions
        // only" (dubbingAudioEnabled:false) actually useful for videos with no
        // native captions (e.g. a live stream): the Live engine is already
        // transcribing+translating, so just display what it produces.
        // Carries the real video-timeline start/end (not a wall-clock
        // duration) — subtitle-overlay.js displays it exactly when playback
        // reaches that window, and releases the hold set by "live-speech-start".
        const liveState = await getState();
        if (liveState.tabId != null) {
          browser.tabs.sendMessage(liveState.tabId, {
            type: "subify-live-cue",
            start: msg.start,
            end: msg.end,
            text: msg.text
          }).catch(() => {});
        }
        break;
      }
      case "subify-live-pause": {
        // The page's Active-mode pause: the live dub waits in the offscreen document (see offscreen.js setLivePaused).
        try { await browser.runtime.sendMessage({ type: "offscreen-live-pause", paused: Boolean(msg.paused) }); } catch (_) {}
        break;
      }
      case "live-speech-start": {
        const liveState = await getState();
        if (liveState.tabId != null) {
          browser.tabs.sendMessage(liveState.tabId, {
            type: "subify-live-hold",
            at: msg.at
          }).catch(() => {});
        }
        break;
      }
      case "subify-roleplay-memo":
      case "subify-ai-generate": {
        try {
          sendResponse(await subifyAiRoute(msg));
        } catch (e) { sendResponse({ ok: false, code: "unknown", error: "خطای ناشناخته در هوش مصنوعی. دوباره امتحان کن.", detail: String(e.message || e) }); }
        break;
      }
      case "subify-open-page": {
        const page = SUBIFY_AI_PAGES.includes(msg.page) ? msg.page : "";
        if (page) { try { await browser.tabs.create({ url: browser.runtime.getURL(page) }); } catch (e) {} }
        break;
      }
      case "capture-ended": await stopDubbing("tab audio ended"); break;
      case "capture-error":
        await setState({ error: msg.error || "Capture failed" });
        await stopDubbing("capture error");
        break;
    }
  })();
  // Keep the channel open for request/response messages only.
  const requestTypes = new Set(["subify-tickets-reply", "subify-tickets-create", "subify-tickets-get", "subify-tickets-list", "subify-capture-shot", "subify-auth-status", "subify-auth-logout", "subify-auth-open", "subify-vocab-sync", 
    "subify-stat", "subify-cloud-cache-get", "subify-cloud-cache-put", "subify-cloud-cache-correct",
    "subify-translate", "subify-free-video-done", "subify-clear-all-data", "subify-discover-models",
    "subify-test-key", "subify-test-openai", "subify-test-openrouter",
    "subify-test-custom", "subify-list-custom-models",
    "popup-get-status", "subify-open-options", "popup-test-live", "popup-self-test",
    "subify-set-dubbing", "subify-set-dubbing-audio",
    "subify-vocab-enrich", "subify-vocab-batch", "subify-grammar", "subify-vocab-grammar", "subify-vocab-list", "subify-account-videos", "subify-vocab-grade", "subify-roleplay-save", "subify-page-translate", "subify-ai-generate", "subify-roleplay-memo"
  ]);
  return requestTypes.has(msg?.type);
});

browser.tabs.onRemoved.addListener(async (tabId) => {
  const s = await getState();
  if (s.active && tabId === s.tabId) stopDubbing("tab closed");
});
