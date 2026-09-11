
// Subify Lite — background service worker
// Subtitle translation ONLY — no tab-audio capture, no dubbing, no offscreen
// document. This build exists because Firefox (desktop and Android) and
// Safari (iOS) don't implement chrome.tabCapture/chrome.offscreen at all —
// see PRIVACY.md and README.md for the full explanation. Everything here
// reads a video's existing captions (via the content script) and translates
// the text; it never touches tab audio.

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

const DEFAULT_SETTINGS = {
  apiKey: "",
  openRouterKey: "",
  openaiKey: "",
  subtitleProvider: "auto", // "auto" prefers OpenRouter, then OpenAI, then Gemini when keys exist
  openRouterModel: "openrouter/free",
  openaiModel: "gpt-5.6-luna",
  geminiSubtitleModel: "gemini-3.1-flash-lite",
  customProviders: [],
  customProviderId: ""
};

// Old model IDs -> current ones, applied to geminiSubtitleModel on load.
const MODEL_MIGRATIONS = {
  "gemini-2.0-flash": "gemini-3.5-flash",
  "gemini-2.0-flash-lite": "gemini-3.1-flash-lite",
  "gemini-2.5-flash": "gemini-3.5-flash",
  "gemini-2.5-flash-lite": "gemini-3.1-flash-lite"
};
const GEMINI_TEXT_FALLBACKS = ["gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3-flash"];

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
// storyboards IndexedDB). It also asks any open tabs to wipe their own
// on-page translation cache — that IndexedDB lives under the video site's
// origin (content scripts see the page's storage, not the extension's), so
// it can't be reached from here directly. A pending-clear flag covers tabs
// that aren't open right now; subtitle-overlay.js checks it on load.
const LOCAL_KEYS_TO_CLEAR = ["pd_models","pd_settings","pd_stats","subify_last_shot","subify_settings","subify_subtitle_enabled"];
async function clearAllLocalData(){
  try{
    const tabs=await browser.tabs.query({url:["https://www.youtube.com/*","https://www.youtube-nocookie.com/*","https://vimeo.com/*","https://*.vimeo.com/*","https://player.vimeo.com/*","https://www.aparat.com/*","https://aparat.com/*","https://www.coursera.org/*"]});
    await Promise.all(tabs.map(t=>browser.tabs.sendMessage(t.id,{type:"subify-clear-local-cache"}).catch(()=>{})));
  }catch(e){}
  if(_subifyDbPromise){ try{ (await _subifyDbPromise).close(); }catch(e){} }
  _subifyDbPromise=null;
  await new Promise(resolve=>{ const req=indexedDB.deleteDatabase("subify-local"); req.onsuccess=req.onerror=req.onblocked=()=>resolve(); });
  await browser.storage.local.remove(LOCAL_KEYS_TO_CLEAR);
  await browser.storage.session.clear();
  await browser.storage.local.set({ subify_pending_clear: true });
  await log("All local Subify data cleared by the user.", "warn");
}
async function enrichWord(settings,word,sentence){
  const prompt=`Translate and explain the vocabulary item for a Persian learner. Return ONLY JSON: {"word":"","meaning":"","example":"","pos":"","level":""}. Word: ${word}\nSentence: ${sentence}\nMeaning must be concise natural Persian. Example must be a short Persian sentence.`;
  if((settings.subtitleProvider||"auto")!=="openrouter" && settings.apiKey){
    const model=settings.geminiSubtitleModel||GEMINI_TEXT_FALLBACKS[0];
    const r=await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(settings.apiKey)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{temperature:.15,responseMimeType:"application/json"}})});
    const raw=await r.text();if(!r.ok)throw new Error(`Gemini ${r.status}: ${raw.slice(0,220)}`);const d=JSON.parse(raw);return JSON.parse((d.candidates?.[0]?.content?.parts||[]).map(p=>p.text||"").join("").replace(/```json|```/g,"").trim());
  }
  if(settings.openRouterKey){const r=await fetch(`${OPENROUTER_BASE}/chat/completions`,{method:"POST",headers:{Authorization:`Bearer ${settings.openRouterKey}`,"Content-Type":"application/json","X-Title":"subify vocabulary"},body:JSON.stringify({model:settings.openRouterModel||"openrouter/free",messages:[{role:"user",content:prompt}],temperature:.15})});const raw=await r.text();if(!r.ok)throw new Error(`OpenRouter ${r.status}: ${raw.slice(0,220)}`);const d=JSON.parse(raw);return JSON.parse(String(d.choices?.[0]?.message?.content||"").replace(/```json|```/g,"").trim());}
  throw new Error("No Gemini or OpenRouter key saved");
}

// ---------- state (kept minimal — just enough for the popup's error line) ----------

const BLANK = { error: "" };
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
  const { pd_settings } = await browser.storage.local.get("pd_settings");
  const s = { ...DEFAULT_SETTINGS, ...(pd_settings || {}) };
  if (MODEL_MIGRATIONS[s.geminiSubtitleModel]) {
    s.geminiSubtitleModel = MODEL_MIGRATIONS[s.geminiSubtitleModel];
    await browser.storage.local.set({ pd_settings: s });
  }
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

async function discoverModels() {
  const settings = await getSettings();
  if (!settings.apiKey) throw new Error("No API key saved");
  const models = await listModels(settings.apiKey);
  const gen = models.filter(m => m.methods.includes("generateContent") && !/tts|speech|embed|image|imagen|veo|aqa/i.test(m.id));
  await browser.storage.local.set({
    pd_models: { fetchedAt: Date.now(), all: gen.map(m => ({ id: m.id, methods: m.methods, display: m.display })) }
  });
  await log(`Your key exposes ${gen.length} usable text models.`, "ok");
  browser.runtime.sendMessage({ type: "models-updated" }).catch(() => {});
  return { all: gen };
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
  const { pd_stats } = await browser.storage.local.get("pd_stats");
  const s = pd_stats || { totals: {}, days: {}, providers: {} };
  s.providers = s.providers || {};
  const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };
  const day = (s.days[dayKey()] = s.days[dayKey()] || {});
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v !== "number") continue;
    add(s.totals, k, v);
    add(day, k, v);
  }
  // Per-provider breakdown feeds the usage/cost dashboard in options.html,
  // which multiplies these by a rate the user enters themselves rather than
  // us guessing current pricing.
  if (patch.provider) {
    const bucket = (s.providers[patch.provider] = s.providers[patch.provider] || {});
    for (const [k, v] of Object.entries(patch)) {
      if (typeof v !== "number") continue;
      add(bucket, k, v);
    }
  }
  await browser.storage.local.set({ pd_stats: s });
}

// ---------- subtitle translation ----------

function cleanSubtitleText(text) {
  return String(text || "")
    .replace(/\[(music|muzik|müzik|applause|laughter|laughing|sound effects?|موسیقی|تشویق|خنده)\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function subtitleItemsAndPrompt(cues) {
  const items = cues.map(c => ({ id: String(c.id), text: cleanSubtitleText(c.text) })).filter(x => x.text);
  const prompt =
    "You are a professional Persian subtitle translator. Translate into natural spoken Persian used in Iran.\n" +
    "Do NOT translate word-by-word or like a book. Make it sound like a real person speaking.\n" +
    "Use correct Persian verbs, tenses and natural expressions. Keep technical terms accurate.\n" +
    "Examples: 'Stop being stubborn' = 'لجبازی رو بس کن' not 'لجبازی را متوقف کن'.\n" +
    "Remove non-speech labels like music, applause, laughter and sound descriptions.\n" +
    "Keep names, numbers, units, code and URLs unchanged. Output ONLY compact JSON.\n" +
    "Format: {\"results\":[{\"id\":\"original-id\",\"fa\":\"translation\"}]}\n" +
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
    // NOTE: batches can carry up to 24 cues (see "subify-translate" below) and Persian
    // JSON output runs heavier on tokens than the source text — keep this high enough
    // that a full batch's JSON never gets clipped mid-object.
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
  const {prompt}=subtitleItemsAndPrompt(cues);
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
      await log(`Rate-limited (attempt ${i + 1}) — retrying in ${Math.round(delaysMs[i] / 100) / 10}s…`, "warn");
      await new Promise((r) => setTimeout(r, delaysMs[i]));
    }
  }
}

async function translateSubtitleCues(cues, settings, model) {
  const provider = settings.subtitleProvider || "auto";
  if (provider === "openrouter") return translateSubtitleCuesOpenRouter(cues, settings);
  if (provider === "openai") return translateSubtitleCuesOpenAI(cues, settings);
  if (provider === "custom") return translateSubtitleCuesCustom(cues, settings);
  if (provider === "gemini") return withTransientRetry(() => translateSubtitleCuesGemini(cues, settings, model));

  // Auto: keep Gemini as the first choice, but do not let a Gemini quota error
  // kill subtitle rendering when the user supplied an OpenRouter key.
  try {
    return await withTransientRetry(() => translateSubtitleCuesGemini(cues, settings, model));
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

  // Do not use /models as the key test. Some valid Gemini API keys can call
  // generateContent while model listing is restricted and returns 403.
  const preferred = [settings.geminiSubtitleModel, ...GEMINI_TEXT_FALLBACKS].filter(Boolean);

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
      if (text) return { ok: true, model };
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

// ---------- messaging ----------

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "subify-translate": {
        try {
          const settings = await getSettings();
          const cues = Array.isArray(msg.cues) ? msg.cues.slice(0, 24) : [];
          if (!cues.length) { sendResponse({ ok: true, results: [] }); break; }
          const provider = settings.subtitleProvider || "auto";
          const recordUsage = (usedProvider, results) => {
            const charsIn = cues.reduce((n, c) => n + String(c?.text || "").length, 0);
            const charsOut = (results || []).reduce((n, r) => n + String(r?.fa || "").length, 0);
            return recordStats({ subtitleCues: cues.length, subtitleCharsIn: charsIn, subtitleCharsOut: charsOut, provider: usedProvider }).catch(() => {});
          };
          if (provider === "openrouter") {
            if (!settings.openRouterKey) throw new Error("OpenRouter is selected, but no OpenRouter API key is saved");
            const results = await translateSubtitleCuesOpenRouter(cues, settings);
            await recordUsage("openrouter", results);
            sendResponse({ ok: true, provider: "openrouter", results });
            break;
          }
          if (provider === "custom") {
            const results = await translateSubtitleCuesCustom(cues, settings);
            await recordUsage("custom", results);
            sendResponse({ ok: true, provider: "custom", results });
            break;
          }
          if (provider === "openai") {
            if (!settings.openaiKey) throw new Error("OpenAI is selected, but no OpenAI API key is saved");
            const results = await translateSubtitleCuesOpenAI(cues, settings);
            await recordUsage("openai", results);
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
              const chosen = settings.geminiSubtitleModel;
              results = await withModelFallback({ ...settings, geminiSubtitleModel: chosen }, "geminiSubtitleModel", GEMINI_TEXT_FALLBACKS, (m) => translateSubtitleCues(cues, { ...settings, subtitleProvider: "gemini" }, m));
              usedProvider = "gemini";
            }
          } else {
            if (provider === "gemini") {
              const chosen = settings.geminiSubtitleModel;
              results = await withModelFallback({ ...settings, geminiSubtitleModel: chosen }, "geminiSubtitleModel", GEMINI_TEXT_FALLBACKS, (m) => translateSubtitleCues(cues, { ...settings, subtitleProvider: provider }, m));
            } else {
              results = await (provider === "openrouter" ? translateSubtitleCuesOpenRouter(cues, settings) : translateSubtitleCuesOpenAI(cues, settings));
            }
            usedProvider = provider;
          }
          await recordUsage(usedProvider, results);
          sendResponse({ ok: true, provider: usedProvider, results });
        } catch (e) {
          await log("Subtitle translation failed: " + (e.message || e), "error");
          sendResponse({ ok: false, error: String(e.message || e) });
        }
        break;
      }
      case "subify-clear-all-data": {
        try { await clearAllLocalData(); sendResponse({ ok: true }); }
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
          await log(`Gemini key valid — test model: ${result.model}`, "ok");
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
      case "subify-test-custom": {
        try { const settings=await getSettings(); const result=await testCustomProvider(settings,msg.id); await log(`Custom API valid — ${result.name} • model: ${result.model}`,"ok"); sendResponse(result); }
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
      case "subify-vocab-enrich": {
        try { const settings=await getSettings(); const word=String(msg.word||"").trim(); if(!word)throw new Error("Word is empty"); const info=await enrichWord(settings,word,String(msg.sentence||"")); const key=`${String(msg.lang||"auto").split("-")[0]}:${word.toLowerCase()}`; const old=await vocabGet(key); const card={...(old||{}),word,lang:String(msg.lang||"auto").split("-")[0],meaning:String(info.meaning||""),example:String(info.example||""),pos:String(info.pos||""),level:String(info.level||""),sentence:String(msg.sentence||""),translation:String(msg.translation||""),box:old?.box||1,nextDueAt:old?.nextDueAt||Date.now(),updatedAt:Date.now(),history:old?.history||[]}; await vocabPut(key,card); sendResponse({ok:true,card}); } catch(e){sendResponse({ok:false,error:String(e.message||e)});} break;
      }
      case "subify-vocab-list": { try { const rows=await vocabList(); sendResponse({ok:true,rows:rows.map(x=>x.value)}); } catch(e){sendResponse({ok:false,error:String(e.message||e)});} break; }
      case "subify-vocab-grade": { try { const key=String(msg.key||""); const c=await vocabGet(key); if(!c)throw new Error("Card not found"); const grade=String(msg.grade||"again"); const box=Math.max(1,Math.min(5,Number(c.box||1)+(grade==="again"?-1:grade==="easy"?2:1))); const days=[0,1,3,7,14,30][box]||30; c.box=box;c.nextDueAt=Date.now()+days*86400000;c.lastGradedAt=Date.now();c.history=[...(c.history||[]),{grade,at:Date.now(),box}].slice(-30);await vocabPut(key,c);sendResponse({ok:true,card:c}); } catch(e){sendResponse({ok:false,error:String(e.message||e)});} break; }
      case "popup-start": {
        await browser.storage.local.set({ subify_subtitle_enabled: true });
        try { await browser.tabs.sendMessage(msg.tabId, { type: "subify-enable-subtitles" }); } catch (_) {}
        await setState({ error: "" });
        break;
      }
      case "popup-stop": {
        await browser.storage.local.set({ subify_subtitle_enabled: false });
        try { await browser.tabs.sendMessage(msg.tabId, { type: "subify-disable-subtitles" }); } catch (_) {}
        break;
      }
      case "popup-get-status": {
        const state = await setState({});
        sendResponse({ ok: true, state });
        break;
      }
      case "popup-discover-models":
        try { await discoverModels(); }
        catch (e) { await log("Discovery failed: " + (e.message || e), "error"); }
        break;
      case "log": await log(msg.msg, msg.level); break;
    }
  })();
  return true;
});
