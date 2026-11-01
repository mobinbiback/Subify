var browser = globalThis.browser || globalThis.chrome; // Chrome has no browser global; same APIs live on chrome.*
/* Subify AI pages (r18): helpers shared by chat, summary, roleplay, writer and shadowing.
 * Loaded after learning-core.js and ui-language.js. Every model call goes through background.js
 * ("subify-ai-generate"), so the Gemini key never leaves the extension worker.
 * AI text is always written with textContent or text nodes, never as HTML. */
(function (root) {
  "use strict";
  const LRN = root.SubifyLearning;
  const SNAPSHOT_KEY = "subify_cues_snapshot";
  const LANG_NAMES = {
    fa: "Persian (Farsi)", en: "English", ar: "Arabic", tr: "Turkish", es: "Spanish", fr: "French", de: "German",
    it: "Italian", pt: "Portuguese", ru: "Russian", ja: "Japanese", ko: "Korean", zh: "Chinese", hi: "Hindi"
  };
  const BCP47 = {
    fa: "fa-IR", en: "en-US", ar: "ar-SA", tr: "tr-TR", es: "es-ES", fr: "fr-FR", de: "de-DE",
    it: "it-IT", pt: "pt-BR", ru: "ru-RU", ja: "ja-JP", ko: "ko-KR", zh: "zh-CN", hi: "hi-IN"
  };
  const CEFR = ["A1", "A2", "B1", "B2", "C1", "C2"];
  const STOP = new Set(("the and that with this have from they will your what about there their would which when just like know going "
    + "really think gonna were been them then than into also some more very make want because here where said does didn "
    + "und der die das ist nicht ein eine mit auf für que los las por para une est pas avec dans qui").split(/\s+/));

  // Translation helper: the page text is the Persian key; ui-language.js holds the other languages.
  const tt = (s) => (root.SubifyUI && typeof root.SubifyUI.t === "function" ? root.SubifyUI.t(s) : String(s));

  async function learning() {
    try {
      const r = await browser.storage.local.get("subify_learning");
      return LRN.sanitizeLearning(r.subify_learning);
    } catch (_) {
      return LRN.sanitizeLearning(null);
    }
  }
  // { native, target, nativeName, targetName, cefr }: the answer language is nativeLang, the dialogue language is targetLang.
  async function languages() {
    const cfg = await learning();
    return {
      native: cfg.nativeLang,
      target: cfg.targetLang,
      nativeName: LANG_NAMES[cfg.nativeLang] || LANG_NAMES.en,
      targetName: LANG_NAMES[cfg.targetLang] || LANG_NAMES.en,
      cefr: cfg.cefr
    };
  }
  // The snapshot written by subtitle-overlay.js: { videoId, title, url, cues: [{start, end, text}] }, or null.
  async function snapshot() {
    try {
      const r = await browser.storage.local.get(SNAPSHOT_KEY);
      const s = r[SNAPSHOT_KEY];
      return s && Array.isArray(s.cues) && s.cues.length ? s : null;
    } catch (_) {
      return null;
    }
  }

  // The video a practice page works on (spec 27 and 29), written by the overlay or the learn page. Null when none.
  const SEED_KEY = LRN.PRACTICE_SEED_KEY;
  async function seed() {
    try {
      const r = await browser.storage.local.get(SEED_KEY);
      return LRN.practiceSeed(r[SEED_KEY]);
    } catch (_) {
      return null;
    }
  }
  async function clearSeed() {
    try { await browser.storage.local.remove(SEED_KEY); } catch (_) { /* storage unavailable: nothing to clear */ }
  }
  // Calls cb with the new seed (or null) whenever the stored seed changes.
  function onSeedChange(cb) {
    try {
      browser.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes[SEED_KEY]) cb(LRN.practiceSeed(changes[SEED_KEY].newValue));
      });
    } catch (_) { /* no storage events */ }
  }

  // Saved words and recent videos for the practice pages (spec 27 and 29). Cards are the learn page's vocabulary
  // (IndexedDB "subify-local", store "vocab", the same database as background.js). Missing data gives empty lists.
  function vocabCards() {
    return new Promise((resolve) => {
      try {
        const req = indexedDB.open("subify-local", 2);
        req.onupgradeneeded = () => {
          const d = req.result;
          for (const s of ["translations", "vocab", "shots", "storyboards"]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
        };
        req.onerror = () => resolve([]);
        req.onsuccess = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains("vocab")) { d.close(); resolve([]); return; }
          const rows = [];
          const tx = d.transaction("vocab", "readonly");
          tx.objectStore("vocab").openCursor().onsuccess = (e) => {
            const c = e.target.result;
            if (c) { rows.push(c.value); c.continue(); }
          };
          tx.oncomplete = () => { d.close(); resolve(rows); };
          tx.onerror = () => { d.close(); resolve([]); };
        };
      } catch (_) { resolve([]); }
    });
  }
  async function videoLog() {
    try {
      const r = await browser.storage.local.get(LRN.VIDEO_HISTORY_KEY);
      return LRN.sanitizeVideoHistory(r[LRN.VIDEO_HISTORY_KEY]);
    } catch (_) {
      return [];
    }
  }
  // { words: [{ word, meaning }] (up to 10, learning language), titles: [string] (up to 5, newest first) }.
  async function practiceContext() {
    const cfg = await learning();
    const [cards, log] = await Promise.all([vocabCards(), videoLog()]);
    return {
      words: LRN.practiceWords(cards, { target: cfg.targetLang, now: Date.now() }),
      titles: LRN.recentVideoTitles(log, cards, 5)
    };
  }
  // Prompt text for the lists above. The model gets them as data; the callers say how to use them.
  function wordsText(words) {
    return (words || []).map((w) => w.word + (w.meaning ? " (" + w.meaning + ")" : "")).join("; ");
  }
  function titlesText(titles) {
    return (titles || []).map((t) => "\"" + t + "\"").join("; ");
  }

  // Sends one request to the worker. Always resolves to { ok, text } or { ok:false, code, error }.
  async function ask(opts) {
    const fail = (code, error) => ({ ok: false, code, error });
    try {
      const res = await browser.runtime.sendMessage({
        type: opts.type || "subify-ai-generate",
        system: opts.system || "",
        prompt: opts.prompt || "",
        messages: Array.isArray(opts.messages) ? opts.messages : undefined,
        feature: opts.feature || "",
        json: !!opts.json,
        audio: opts.audio || undefined,
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        videoId: opts.videoId || ""
      });
      if (!res || typeof res !== "object") return fail("unknown", "پاسخی از افزونه نیامد. صفحه را دوباره باز کن.");
      return res;
    } catch (_) {
      return fail("network", "پاسخی از افزونه نیامد. صفحه را دوباره باز کن.");
    }
  }
  // Same as ask(), but the reply is parsed. Returns { ok, data } or { ok:false, code, error }.
  async function askJson(opts) {
    const res = await ask({ ...opts, json: true });
    if (!res.ok) return { ok: false, code: res.code, error: res.error };
    const data = parseJson(res.text);
    if (!data || typeof data !== "object") {
      return { ok: false, code: "bad-json", error: "جواب هوش مصنوعی قابل خواندن نبود. دوباره امتحان کن." };
    }
    return { ok: true, data };
  }
  function parseJson(text) {
    const t = String(text || "").replace(/```json|```/gi, "").trim();
    try { return JSON.parse(t); } catch (_) { /* try the first object below */ }
    const m = t.match(/[\[{][\s\S]*[\]}]/);
    if (m) { try { return JSON.parse(m[0]); } catch (_) { /* give up */ } }
    return null;
  }
  // Message shown for a failed call (the text is translated by ui-language.js when it is in the dictionary).
  function errorText(res) {
    return tt((res && res.error) || "پاسخی گرفته نشد. دوباره امتحان کن.");
  }

  function mmss(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
  }
  // "[mm:ss] text" lines, from the start of the snapshot, up to maxChars.
  function transcript(cues, maxChars) {
    const lines = [];
    let size = 0;
    for (const c of cues || []) {
      const line = `[${mmss(c.start)}] ${c.text}`;
      if (size + line.length > (maxChars || 24000)) break;
      lines.push(line);
      size += line.length + 1;
    }
    return lines.join("\n");
  }
  // Most frequent content words in the snapshot (no AI call). Used for word lists.
  function topWords(cues, limit) {
    const counts = new Map();
    for (const c of cues || []) {
      for (const raw of String(c.text || "").toLocaleLowerCase().split(/[^\p{L}\p{M}']+/u)) {
        const w = raw.replace(/^'+|'+$/g, "");
        if (w.length < 4 || STOP.has(w) || /\d/.test(w)) continue;
        counts.set(w, (counts.get(w) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit || 20)
      .map(([w]) => w);
  }
  // Lower-case, punctuation-free word list, for comparing a learner's words with a target sentence.
  function words(text) {
    return String(text || "").normalize("NFC").toLocaleLowerCase().split(/[^\p{L}\p{M}\p{N}']+/u)
      .map((w) => w.replace(/^'+|'+$/g, "")).filter(Boolean);
  }
  // Loose text match for quotes the model returns: ignores case, spacing, quotes and Arabic/Persian variants.
  function normalizeForMatch(s) {
    return String(s || "").normalize("NFKC")
      .replace(/[‘’ʼ`´]/g, "'").replace(/[“”«»]/g, '"')
      .replace(/ي/g, "ی").replace(/ك/g, "ک")
      .replace(/[​-‏‪-‮⁦-⁩﻿]/g, "")
      .replace(/\s+/g, " ").trim().toLocaleLowerCase();
  }
  function includesQuote(source, quote) {
    const q = normalizeForMatch(quote);
    return !!q && normalizeForMatch(source).includes(q);
  }

  // Quote grounding and word diff. Same rules as web-app/src/services/grounding.js and diff.js: keep them in step.
  // Lower-case, punctuation-free text for comparing a quote with a learner line (ZWNJ removed, Arabic letters mapped).
  function normalizeQuote(value) {
    return String(value == null ? "" : value).normalize("NFKC")
      .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, "")
      .replace(/\u0640/g, "")
      .replace(/\u064A/g, "\u06CC").replace(/\u0643/g, "\u06A9")
      .replace(/['\u2018\u2019\u201B\u02BC\u0060\u00B4]/g, "")
      .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
      .replace(/\s+/g, " ").trim().toLowerCase();
  }
  // The quote occurs in one normalized line as whole words, or ignoring spaces (Persian compounds).
  function lineHasQuote(line, quote) {
    if (!quote || !line) return false;
    let at = line.indexOf(quote);
    while (at >= 0) {
      const end = at + quote.length;
      if ((at === 0 || line[at - 1] === " ") && (end === line.length || line[end] === " ")) return true;
      at = line.indexOf(quote, at + 1);
    }
    const squashed = quote.replace(/ /g, "");
    return squashed.length >= 4 && line.replace(/ /g, "").includes(squashed);
  }
  function quoteInLines(quote, lines) {
    const q = normalizeQuote(quote);
    if (!q) return false;
    return (Array.isArray(lines) ? lines : []).some((line) => lineHasQuote(normalizeQuote(line), q));
  }
  // Keeps only the corrections whose quote (original) and the five-area quotes are in the learner's lines.
  // Returns { lesson, dropped }: the lesson with the grounded items, and how many corrections were removed.
  function groundLesson(lesson, learnerLines) {
    const corrections = lesson && Array.isArray(lesson.corrections) ? lesson.corrections : [];
    const kept = corrections.filter((item) => quoteInLines(item && item.original, learnerLines));
    const out = { ...lesson, corrections: kept };
    if (lesson && lesson.areas && typeof lesson.areas === "object") {
      out.areas = {};
      for (const k of Object.keys(lesson.areas)) {
        const a = lesson.areas[k] || {};
        const quotes = Array.isArray(a.quotes) ? a.quotes : [];
        out.areas[k] = { ...a, quotes: quotes.filter((q) => quoteInLines(q, learnerLines)) };
      }
    }
    return { lesson: out, dropped: corrections.length - kept.length };
  }
  // Words to upgrade (writer, round 21). Adapted from LingoPen by MohammadReza Qaderi (MR-Qaderi), used with the author's written permission (2026-10-11).
  // Keeps only the items whose original is really in the learner's text (the same matching as the quotes above),
  // with a different better form, no repeats, at most 5. Items that fail are dropped without a message.
  const UPGRADE_MAX = 5;
  function keepUpgrades(items, learnerText) {
    const clip = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
    const lines = String(learnerText == null ? "" : learnerText).split("\n");
    const seen = new Set();
    const out = [];
    for (const item of Array.isArray(items) ? items : []) {
      const original = clip(item && item.original, 200);
      const better = clip(item && item.better, 200);
      if (!original || !better) continue;
      const key = normalizeQuote(original);
      if (!key || seen.has(key) || key === normalizeQuote(better)) continue;
      if (!quoteInLines(original, lines)) continue;
      seen.add(key);
      out.push({ original, better, note: clip(item && item.note, 300) });
      if (out.length === UPGRADE_MAX) break;
    }
    return out;
  }
  // Word-level LCS diff: segments [{ type: "same" | "add" | "del", text }]; null when the texts are too long.
  const DIFF_MAX_CELLS = 4000000;
  const DIFF_TOKEN = /\s+|[\p{L}\p{M}\p{N}]+(?:[\u200C'\u2019-]+[\p{L}\p{M}\p{N}]+)*|\S/gu;
  function diffTokenize(text) {
    const tokens = [];
    let lead = "";
    for (const part of String(text == null ? "" : text).match(DIFF_TOKEN) || []) {
      if (/^\s+$/u.test(part)) lead += part;
      else { tokens.push({ text: part, lead }); lead = ""; }
    }
    return { tokens, tail: lead };
  }
  function diffMerge(ops) {
    const out = [];
    for (const op of ops) {
      const last = out[out.length - 1];
      if (last && last.type === op.type) last.text += op.text;
      else out.push({ type: op.type, text: op.text });
    }
    return out;
  }
  function diffWords(original, corrected) {
    const a = diffTokenize(original);
    const b = diffTokenize(corrected);
    const n = a.tokens.length;
    const m = b.tokens.length;
    if ((n + 1) * (m + 1) > DIFF_MAX_CELLS) return null;
    const w = m + 1;
    const table = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i * w + j] = a.tokens[i].text === b.tokens[j].text
          ? table[(i + 1) * w + j + 1] + 1
          : Math.max(table[(i + 1) * w + j], table[i * w + j + 1]);
      }
    }
    const ops = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      const ta = a.tokens[i];
      const tb = b.tokens[j];
      if (ta.text === tb.text) { ops.push({ type: "same", text: tb.lead + tb.text }); i++; j++; }
      else if (table[(i + 1) * w + j] >= table[i * w + j + 1]) { ops.push({ type: "del", text: ta.lead + ta.text }); i++; }
      else { ops.push({ type: "add", text: tb.lead + tb.text }); j++; }
    }
    for (; i < n; i++) ops.push({ type: "del", text: a.tokens[i].lead + a.tokens[i].text });
    for (; j < m; j++) ops.push({ type: "add", text: b.tokens[j].lead + b.tokens[j].text });
    if (a.tail === b.tail) {
      if (b.tail) ops.push({ type: "same", text: b.tail });
    } else {
      if (a.tail) ops.push({ type: "del", text: a.tail });
      if (b.tail) ops.push({ type: "add", text: b.tail });
    }
    return diffMerge(ops);
  }

  // DOM helper. attrs: class, text, on (event map), any other attribute. Children may be nodes, strings or arrays.
  function h(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === "text") n.textContent = v;
      else if (k === "on") { for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn); }
      else if (k === "class") n.className = v;
      else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      n.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }
  // Renders AI text. "mm:ss" stamps become highlighted spans; everything else stays plain text.
  function richText(text) {
    const frag = document.createDocumentFragment();
    const s = String(text || "");
    const re = /\b(\d{1,2}:\d{2})\b/g;
    let last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) frag.append(s.slice(last, m.index));
      frag.append(h("span", { class: "ai-ts" }, m[1]));
      last = m.index + m[0].length;
    }
    if (last < s.length) frag.append(s.slice(last));
    return frag;
  }
  // Puts the snapshot status in a container: which video is used, or what to do when there is none.
  function renderContext(container, snap) {
    container.textContent = "";
    if (snap) {
      container.append(
        h("span", { class: "ai-ctx-dot", "aria-hidden": "true" }),
        h("div", { class: "ai-ctx-body" },
          h("strong", { text: snap.title || tt("ویدیوی بدون عنوان") }),
          h("span", { class: "ai-muted", text: tt("از زیرنویسی که روی صفحه بود ساخته شده") + " · " + snap.cues.length + " " + tt("جمله") })
        )
      );
      container.classList.add("is-ready");
    } else {
      container.append(
        h("span", { class: "ai-ctx-dot ai-ctx-dot--off", "aria-hidden": "true" }),
        h("div", { class: "ai-ctx-body" },
          h("strong", { text: tt("ویدیویی برای این بخش پیدا نشد") }),
          h("span", { class: "ai-muted", text: tt("ویدیو را در YouTube باز کن و زیرنویس را روشن کن. بعد دوباره به این صفحه برگرد.") })
        )
      );
      container.classList.remove("is-ready");
    }
  }
  // The "from this video" banner: title, topic and the way out to the plain page. onExit clears the seed.
  function renderSeed(container, seedObj, onExit) {
    container.textContent = "";
    if (!seedObj) {
      container.classList.remove("is-ready");
      return;
    }
    const facts = [];
    if (seedObj.topic) facts.push(h("span", { class: "ai-ltr ai-muted ai-small", text: seedObj.topic }));
    if (seedObj.cues.length) facts.push(h("span", { class: "ai-muted ai-small", text: seedObj.cues.length + " " + tt("جمله") }));
    container.append(
      h("span", { class: "ai-ctx-dot", "aria-hidden": "true" }),
      h("div", { class: "ai-ctx-body" },
        h("span", { class: "ai-muted ai-small", text: tt("از این ویدیو") }),
        h("strong", { text: seedObj.title || tt("ویدیوی بدون عنوان") }),
        h("span", { class: "ai-row ai-small" }, facts.flatMap((f, i) => (i ? [h("span", { class: "ai-muted", "aria-hidden": "true", text: "·" }), f] : [f])))),
      h("button", { type: "button", class: "ai-btn ai-btn--ghost ai-seed-exit", text: tt("ادامه بدون این ویدیو"), on: { click: () => { if (onExit) onExit(); } } })
    );
    container.classList.add("is-ready");
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(String(text || "")); return true; } catch (_) { return false; }
  }

  // ---------- learning-language gate (practice pages) ----------
  // The practice calls need the learning language. Until the learner picks it, the page shows #lang-gate with a button to
  // the picker (options.html#learning), and #lang-chip shows the language once it is chosen. The page's controls follow
  // onChange(chosen, cfg), which runs at once and after every change to the learning settings.
  const LANG_NAMES_FA = {
    fa: "فارسی", en: "انگلیسی", ar: "عربی", tr: "ترکی", es: "اسپانیایی", fr: "فرانسوی", de: "آلمانی",
    it: "ایتالیایی", pt: "پرتغالی", ru: "روسی", ja: "ژاپنی", ko: "کره‌ای", zh: "چینی", hi: "هندی"
  };
  function openLearningPicker() {
    try {
      const opened = browser.tabs.create({ url: browser.runtime.getURL("options.html#learning") });
      if (opened && typeof opened.catch === "function") opened.catch(() => {});
    } catch (_) { /* no tabs API: the notice still says what to do */ }
  }
  function watchLearning(onChange) {
    const show = (cfg) => {
      const chosen = !!cfg.targetLangSet;
      const gate = document.getElementById("lang-gate");
      const chip = document.getElementById("lang-chip");
      if (gate) gate.hidden = chosen;
      if (chip) {
        chip.hidden = !chosen;
        chip.textContent = chosen ? tt("زبان یادگیری") + ": " + tt(LANG_NAMES_FA[cfg.targetLang] || cfg.targetLang) : "";
      }
      if (typeof onChange === "function") onChange(chosen, cfg);
    };
    const pick = document.getElementById("lang-pick");
    if (pick) pick.addEventListener("click", openLearningPicker);
    learning().then(show);
    try {
      browser.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes.subify_learning) show(LRN.sanitizeLearning(changes.subify_learning.newValue));
      });
    } catch (_) { /* no storage events: the state is read once */ }
  }

  root.SubifyAI = {
    LANG_NAMES, LANG_NAMES_FA, BCP47, CEFR, tt,
    learning, languages, snapshot, ask, askJson, parseJson, errorText, watchLearning,
    mmss, transcript, topWords, words, includesQuote, normalizeForMatch,
    normalizeQuote, quoteInLines, groundLesson, keepUpgrades, UPGRADE_MAX, diffWords,
    h, richText, renderContext, copyText,
    SEED_KEY, seed, clearSeed, onSeedChange, renderSeed,
    practiceContext, wordsText, titlesText
  };
  if (typeof module !== "undefined" && module.exports) module.exports = root.SubifyAI;
})(typeof globalThis !== "undefined" ? globalThis : this);
