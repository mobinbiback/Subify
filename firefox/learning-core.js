/* Subify learning core — pure helpers shared by the subtitle overlay and the options page.
 * No DOM and no browser APIs here, so it can be unit-tested in Node.
 * Card model comes from the vocabulary store (background.js): { word, lang, nextDueAt, history[], updatedAt } plus the
 * spaced-repetition fields { state, ease, interval, reps, lapses }. Older cards only have a five-box number (box);
 * srsMigrate() turns them into the new fields when they are read.
 */
(function (root) {
  "use strict";

  const HIGHLIGHT_MODES = ["off", "saved", "new", "learning", "mastered", "spotlight"];
  const SMART_MODES = ["relaxed", "learning", "active", "study"];
  const REPLAY_SPEEDS = [0.75, 0.85, 1];
  const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
  // One list for the learning language and the grammar-explanation language.
  const LANG_CODES = ["fa", "en", "ar", "tr", "es", "fr", "de", "it", "pt", "ru", "ja", "ko", "zh", "hi"];
  const LANG_NAMES_EN = {
    fa: "Persian (Farsi)", en: "English", ar: "Arabic", tr: "Turkish", es: "Spanish", fr: "French", de: "German",
    it: "Italian", pt: "Portuguese", ru: "Russian", ja: "Japanese", ko: "Korean", zh: "Chinese", hi: "Hindi"
  };
  const TARGET_LANGS = LANG_CODES;  // the language of the video being learned
  const EXPLAIN_LANGS = LANG_CODES; // the language grammar explanations are written in
  const DEFAULT_LEARNING = {
    highlightMode: "off",      // which saved words to highlight in subtitles
    smartMode: "relaxed",      // relaxed = normal viewing; learning = highlight + replay; active = learning + pause after each sentence
    replaySpeed: 0.85,         // speed used by the per-sentence replay button
    replayEnabled: true,       // show the replay button on the original-language line
    pauseAfterSentence: false, // only used in "active" mode; opt-in
    targetLang: "en",          // the language of the video being learned: highlights and grammar apply only to it
    targetLangSet: false,      // true once the learner picked targetLang (English alone may be the default, see sanitizeLearning)
    cefr: "B1",              // CEFR level used to pitch grammar explanations
    explainLang: "fa",         // language grammar explanations are written in
    nativeLang: "fa"           // the user's own language: subtitles and dubbing are translated into it
  };

  // Lower-case word with surrounding punctuation removed. Used on both sides of every lookup.
  function normWord(w) {
    return String(w || "").normalize("NFC").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLowerCase();
  }

  // "en-US" -> "en". Empty, "?" and "auto" all mean "language unknown".
  function langBase(code) {
    const c = String(code || "").split("-")[0].trim().toLowerCase();
    return c === "?" ? "auto" : (c || "auto");
  }

  function wordKey(lang, w) {
    return `${langBase(lang)}:${normWord(w)}`;
  }

  // True when the subtitles on screen are in the learning language (or their language is unknown).
  // Highlights and the grammar button only make sense for that language.
  function isLearningSource(cfg, trackLang) {
    const src = langBase(trackLang);
    return src === "auto" || src === sanitizeLearning(cfg).targetLang;
  }

  // ---------- spaced repetition (SM-2 style) ----------
  // A card has: state, ease (factor, starts at 2.5, never below 1.3), interval (days), nextDueAt (ms), reps, lapses, history[].
  //  new      = saved, never graded
  //  learning = after its first grade, or a review card that was missed (lapse); comes back in minutes or hours
  //  review   = graduated; each good answer multiplies the interval by the ease
  //  mastered = a review card whose interval is at least 21 days (shown by srsPhase, not stored as a state)
  const SRS_STATES = ["new", "learning", "review"];
  const SRS_GRADES = ["again", "hard", "good", "easy"];
  const SRS_DEFAULT_EASE = 2.5;
  const SRS_MIN_EASE = 1.3;
  const SRS_MASTERED_DAYS = 21;
  const SRS_MAX_DAYS = 3650;
  const SRS_HISTORY_MAX = 30;
  const SRS_RELEARN_DAYS = 10 / 1440;  // again: back in 10 minutes
  const SRS_LEARN_HARD_DAYS = 0.5;     // hard while learning: 12 hours
  const SRS_LEARN_GOOD_DAYS = 1;       // good while learning: graduate to review after 1 day
  const SRS_LEARN_EASY_DAYS = 4;       // easy while learning: graduate after 4 days
  const LEGACY_BOX_DAYS = [1, 3, 7, 14, 30]; // the old five-box table, used only to migrate old cards
  const DAY_MS = 86400000;

  function numOr(v, fallback) {
    const n = typeof v === "number" ? v : (typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);
    return Number.isFinite(n) ? n : fallback;
  }

  // Box number for the old views: new 1, learning 2, review under 7 days 3, under 21 days 4, mastered 5.
  function srsBox(state, interval) {
    if (state === "new") return 1;
    if (state === "learning") return 2;
    const d = Number(interval) || 0;
    return d < 7 ? 3 : (d < SRS_MASTERED_DAYS ? 4 : 5);
  }

  // Returns a complete copy of a card in the new model. Never changes the input.
  // New-format cards pass through; old box-based cards are converted from their box and history.
  function srsMigrate(card, now) {
    if (!card || typeof card !== "object") return null;
    const t = Number(now || Date.now());
    const history = Array.isArray(card.history) ? card.history : [];
    let state = card.state;
    let interval = numOr(card.interval, NaN);
    if (!SRS_STATES.includes(state) || !Number.isFinite(interval) || interval < 0) {
      // A word at box 1 with no grades is new. A higher box means it was graded, even if its history was not kept.
      const box = Math.min(5, Math.max(1, Math.round(numOr(card.box, 1))));
      if (!history.length && !card.lastGradedAt && box <= 1) {
        state = "new";
        interval = 0;
      } else {
        state = box >= 3 ? "review" : "learning";
        interval = LEGACY_BOX_DAYS[box - 1];
      }
    }
    const ease = Math.max(SRS_MIN_EASE, numOr(card.ease, SRS_DEFAULT_EASE));
    const reps = numOr(card.reps, history.length);
    const lapses = numOr(card.lapses, history.filter(h => h && h.grade === "again").length);
    const nextDueAt = numOr(card.nextDueAt, t);
    return { ...card, state, ease, interval, reps, lapses, nextDueAt, box: srsBox(state, interval), history };
  }

  // The display phase: new, learning, review or mastered.
  function srsPhase(card) {
    const m = srsMigrate(card);
    if (!m) return null;
    if (m.state === "new") return "new";
    if (m.state === "learning") return "learning";
    return m.interval >= SRS_MASTERED_DAYS ? "mastered" : "review";
  }

  // Status used by highlights, stats and the overlay CSS: new, learning (learning or review under 21 days) or mastered.
  function statusOf(card) {
    const p = srsPhase(card);
    if (p === null) return null;
    if (p === "new") return "new";
    return p === "mastered" ? "mastered" : "learning";
  }

  // One grade. Pure: returns the updated card; the caller stores it.
  //  review:            again -> learning in 10 min, ease -0.2, lapse
  //                     hard  -> interval x1.2, ease -0.15
  //                     good  -> interval x ease
  //                     easy  -> interval x ease x1.3, ease +0.15
  //  new or learning:   again -> 10 min, hard -> 12 h, good -> review in 1 day, easy -> review in 4 days
  // Every review interval is at least one day longer than the previous one.
  function srsGrade(card, grade, now) {
    const g = String(grade || "");
    if (!SRS_GRADES.includes(g)) throw new Error("Unknown grade: " + g);
    const t = Number(now || Date.now());
    const c = srsMigrate(card, t);
    if (!c) throw new Error("Card is required");
    const grow = (days, factor) => Math.min(SRS_MAX_DAYS, Math.max(days + 1, Math.round(days * factor)));
    let state = c.state, ease = c.ease, interval = c.interval, lapses = c.lapses;
    if (state === "review") {
      if (g === "again") { ease -= 0.2; lapses += 1; state = "learning"; interval = SRS_RELEARN_DAYS; }
      else if (g === "hard") { ease -= 0.15; interval = grow(interval, 1.2); }
      else if (g === "good") { interval = grow(interval, ease); }
      else { ease += 0.15; interval = grow(interval, ease * 1.3); }
    } else if (g === "again") {
      state = "learning"; interval = SRS_RELEARN_DAYS;
    } else if (g === "hard") {
      state = "learning"; interval = SRS_LEARN_HARD_DAYS;
    } else if (g === "good") {
      state = "review"; interval = SRS_LEARN_GOOD_DAYS;
    } else {
      state = "review"; interval = SRS_LEARN_EASY_DAYS; ease += 0.15;
    }
    ease = Math.max(SRS_MIN_EASE, Math.round(ease * 100) / 100);
    const entry = { grade: g, at: t, interval, ease, box: srsBox(state, interval) };
    return {
      ...c,
      state, ease, interval, lapses,
      reps: c.reps + 1,
      nextDueAt: t + Math.round(interval * DAY_MS),
      box: entry.box,
      lastGradedAt: t,
      updatedAt: t,
      history: [...c.history, entry].slice(-SRS_HISTORY_MAX)
    };
  }

  function isDue(card, now) {
    return !!card && Number(card.nextDueAt || 0) <= Number(now || Date.now());
  }

  function matchesMode(mode, card, now) {
    if (!card) return false;
    switch (mode) {
      case "saved": return true;
      case "new": return statusOf(card) === "new";
      case "learning": return statusOf(card) === "learning";
      case "mastered": return statusOf(card) === "mastered";
      case "spotlight": return isDue(card, now);
      default: return false;
    }
  }

  // Index by language + word, so the same word saved in two languages keeps both cards.
  // Cards without a known language are stored under "auto" and match any learning language.
  function buildIndex(rows) {
    const idx = new Map();
    for (const c of rows || []) {
      if (!c || !c.word) continue;
      const k = wordKey(c.lang, c.word);
      if (k.endsWith(":")) continue;
      const prev = idx.get(k);
      if (!prev || Number(c.updatedAt || 0) > Number(prev.updatedAt || 0)) idx.set(k, c);
    }
    return idx;
  }

  // Card for a word in the given learning language: the exact language first, then unknown-language cards.
  function lookupCard(index, cfg, word) {
    if (!index) return null;
    const target = sanitizeLearning(cfg).targetLang;
    return index.get(wordKey(target, word)) || index.get(wordKey("auto", word)) || null;
  }

  function sanitizeLearning(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const out = { ...DEFAULT_LEARNING };
    if (HIGHLIGHT_MODES.includes(r.highlightMode)) out.highlightMode = r.highlightMode;
    if (SMART_MODES.includes(r.smartMode)) out.smartMode = r.smartMode;
    const speed = Number(r.replaySpeed);
    if (REPLAY_SPEEDS.includes(speed)) out.replaySpeed = speed;
    if (typeof r.replayEnabled === "boolean") out.replayEnabled = r.replayEnabled;
    if (typeof r.pauseAfterSentence === "boolean") out.pauseAfterSentence = r.pauseAfterSentence;
    if (TARGET_LANGS.includes(r.targetLang)) out.targetLang = r.targetLang;
    // Chosen = the learner picked it. Saves from before the flag count as chosen only for a non-English language:
    // English alone may just be the default, so the AI pages ask for a choice.
    out.targetLangSet = r.targetLangSet === true || (TARGET_LANGS.includes(r.targetLang) && r.targetLang !== "en");
    if (CEFR_LEVELS.includes(r.cefr)) out.cefr = r.cefr;
    if (EXPLAIN_LANGS.includes(r.explainLang)) out.explainLang = r.explainLang;
    if (LANG_CODES.includes(r.nativeLang)) out.nativeLang = r.nativeLang;
    return out;
  }

  // The highlight mode that is actually applied: Learning and Active turn highlighting on
  // (as "saved") unless the user picked a specific mode.
  function effectiveHighlight(cfg) {
    const c = sanitizeLearning(cfg);
    if (c.highlightMode !== "off") return c.highlightMode;
    return c.smartMode === "relaxed" ? "off" : "saved";
  }

  // Statistics computed only from stored cards. Nothing here is estimated.
  function learningStats(rows, now) {
    const t = Number(now || Date.now());
    const out = { saved: 0, newWords: 0, learning: 0, mastered: 0, due: 0, reviews: 0, byLang: {}, recent: [] };
    for (const c of rows || []) {
      if (!c || !c.word) continue;
      out.saved++;
      const st = statusOf(c);
      if (st === "new") out.newWords++;
      else if (st === "learning") out.learning++;
      else out.mastered++;
      if (isDue(c, t)) out.due++;
      out.reviews += Array.isArray(c.history) ? c.history.length : 0;
      const lang = String(c.lang || "auto").split("-")[0];
      out.byLang[lang] = (out.byLang[lang] || 0) + 1;
    }
    out.recent = (rows || [])
      .filter(c => c && c.word)
      .slice()
      .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
      .slice(0, 5)
      .map(c => ({ word: c.word, lang: c.lang || "auto", updatedAt: Number(c.updatedAt || 0), status: statusOf(c) }));
    return out;
  }

  // ---------- Anki export ----------
  // Anki's plain text import: tab separated, no HTML. Front = word, Back = meaning, example and grammar note,
  // Tags = subify, the language code and the CEFR level. Tabs and line breaks inside a field become spaces.
  function ankiText(v) {
    return String(v == null ? "" : v).replace(/[\t\r\n]+/g, " ").replace(/ {2,}/g, " ").trim();
  }
  function ankiBack(c) {
    const meaning = ankiText(c.meaning || c.translation);
    const example = ankiText(c.example);
    const exampleFa = ankiText(c.exampleFa);
    const exampleLine = example ? (exampleFa ? `${example} (${exampleFa})` : example) : "";
    const note = ankiText(c.note || (c.grammar && c.grammar.grammar));
    return [meaning, exampleLine, note].filter(Boolean).join(" · ");
  }
  function ankiTags(c) {
    const tags = ["subify"];
    const lang = langBase(c.lang);
    if (lang && lang !== "auto") tags.push(lang);
    const level = String(c.level || "").trim();
    if (/^[A-Za-z0-9]+$/.test(level)) tags.push(level.toUpperCase());
    return tags.join(" ");
  }
  // Checked against Anki's own importer: a line that starts with "#" is read as a comment and the row is dropped,
  // and a cell that starts with a quote is read as CSV quoting (the quote marks vanish). A cell with a quote or a
  // leading "#" is therefore wrapped in quotes, with each inner quote doubled. Other cells stay as they are.
  function ankiCell(s) {
    return /^#|"/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  // The "#" lines tell Anki how to read the file. The third column is the tag column.
  function toAnkiTsv(rows) {
    const lines = ["#separator:tab", "#html:false", "#tags column:3"];
    for (const c of rows || []) {
      const front = ankiText(c && c.word);
      if (!front) continue;
      lines.push([ankiCell(front), ankiCell(ankiBack(c)), ankiTags(c)].join("\t"));
    }
    return lines.join("\n") + "\n";
  }

  // Source video of a card, as saved by subify-vocab-enrich: { title, videoId, t, url }. Cards saved before that have
  // no source: every source cell is empty. The link opens the video at the saved second when the id is a YouTube id.
  function ankiSource(c) {
    const s = c && c.source && typeof c.source === "object" ? c.source : null;
    if (!s) return { title: "", id: "", link: "", time: "" };
    const title = ankiText(s.title);
    const id = YT_ID_RE.test(String(s.videoId || "").trim()) ? String(s.videoId).trim() : "";
    const hasT = s.t !== null && s.t !== undefined && s.t !== "" && Number.isFinite(Number(s.t)) && Number(s.t) >= 0;
    const sec = hasT ? Math.floor(Number(s.t)) : null;
    const url = String(s.url || "").trim();
    const link = id
      ? `https://www.youtube.com/watch?v=${id}${sec !== null ? `&t=${sec}` : ""}`
      : (/^https?:\/\/\S+$/i.test(url) ? url : "");
    return { title, id, link, time: sec !== null ? formatMmSs(sec) : "" };
  }
  // The learn page's export (spec 40). Columns 1 to 3 are the same as toAnkiTsv (Front, Back, Tags; tags are column 3).
  // Columns 4 to 8 are added: Source video (title), Video ID, Source link (opens the video at the time), Timestamp (mm:ss),
  // Audio. Audio is always empty: a clip of the video's sound would need the tab's audio stream, which an extension
  // cannot read for an arbitrary video, so none is invented. Anki maps the columns to note fields in its import dialog.
  const ANKI_SOURCE_COLUMNS = ["Source video", "Video ID", "Source link", "Timestamp", "Audio"];
  // r21: the card's extra fields go after the source columns (9 to 13). Old cards leave them empty.
  function toAnkiTsvSourced(rows) {
    const lines = ["#separator:tab", "#html:false", "#tags column:3"];
    for (const c of rows || []) {
      const front = ankiText(c && c.word);
      if (!front) continue;
      const src = ankiSource(c);
      lines.push([
        ankiCell(front), ankiCell(ankiBack(c)), ankiTags(c),
        ankiCell(src.title), ankiCell(src.id), ankiCell(src.link), ankiCell(src.time), "",
        ...ankiRichCells(c).map(ankiCell)
      ].join("\t"));
    }
    return lines.join("\n") + "\n";
  }

  // ---------- vocabulary cards: extra fields and word lists (r21) ----------
  // Adapted from Vocabulary-Learner by MohammadReza Qaderi (MR-Qaderi), used with the author's written permission (2026-10-11).
  // The extra card fields (collocations, a second example, common mistakes, a usage note, category tags) and the
  // word-list paste mode come from that app. The prompt and the copy are our own.
  // Model output is untrusted: every field is cleaned here, and a missing or bad field gives an empty value. Nothing throws.
  const CARD_TAG_KEYS = ["travel", "food", "work", "study", "family", "health", "technology", "money", "feelings", "nature"];
  const WORD_LIST_MAX = 30;   // items taken from one paste
  const WORD_BATCH_MAX = 10;  // items per AI call
  const WORD_ITEM_MAX = 60;   // a longer line is a sentence, not a word, so it is skipped
  const CARD_TEXT_MAX = 240;
  const ANKI_RICH_COLUMNS = ["Collocations", "Example 2", "Common mistakes", "Usage note", "Categories"];

  // One piece of text: no tabs or line breaks, single spaces, capped length.
  function cardText(v, max) {
    return String(v == null ? "" : v).replace(/[\t\r\n]+/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, max || CARD_TEXT_MAX);
  }
  // A list of short strings. A plain string is split on the usual separators (Persian, Latin comma, semicolon, bar, newline).
  function cardList(v, max, itemMax) {
    const items = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[،,;|\n]+/) : [];
    const out = [];
    for (const item of items) {
      const s = cardText(item, itemMax || 60);
      if (s && !out.some(x => x.toLowerCase() === s.toLowerCase())) out.push(s);
      if (out.length >= max) break;
    }
    return out;
  }
  // One common mistake: { wrong, right, note }. Accepts an object or a "wrong → right" string. Both forms are needed.
  function cardMistake(m) {
    let wrong = "", right = "", note = "";
    if (m && typeof m === "object") {
      wrong = cardText(m.wrong, 80);
      right = cardText(m.right, 80);
      note = cardText(m.note);
    } else if (typeof m === "string") {
      const parts = m.split(/\s*(?:→|->|=>)\s*/);
      if (parts.length >= 2) {
        wrong = cardText(parts[0], 80);
        right = cardText(parts.slice(1).join(" "), 80);
      }
    }
    if (!wrong || !right || wrong.toLowerCase() === right.toLowerCase()) return null;
    return { wrong, right, note };
  }
  function cardMistakes(v) {
    const list = Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
    const out = [];
    for (const m of list) {
      const one = cardMistake(m);
      if (one) out.push(one);
      if (out.length >= 2) break;
    }
    return out;
  }
  // Category tags: only keys from CARD_TAG_KEYS, at most three.
  function cardTags(v) {
    const items = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,;|،]+/) : [];
    const out = [];
    for (const item of items) {
      const key = String(item == null ? "" : item).trim().toLowerCase();
      if (CARD_TAG_KEYS.includes(key) && !out.includes(key)) out.push(key);
      if (out.length >= 3) break;
    }
    return out;
  }
  // The optional fields of one card. Always the same keys, empty when the model left them out.
  function richCardFields(info) {
    const o = info && typeof info === "object" ? info : {};
    return {
      collocations: cardList(o.collocations, 3, 60),
      example2: cardText(o.example2),
      example2Fa: cardText(o.example2Fa),
      mistakes: cardMistakes(o.mistakes),
      contextNote: cardText(o.contextNote),
      tags: cardTags(o.tags)
    };
  }
  // Every field a card takes from one AI entry: the dictionary fields plus the optional ones.
  function entryCardFields(info) {
    const o = info && typeof info === "object" ? info : {};
    const text = v => (v == null ? "" : String(v));
    const list = v => (Array.isArray(v) ? v.map(text).filter(Boolean) : []);
    return {
      lemma: text(o.lemma), ipa: text(o.ipa), pos: text(o.pos), meaning: text(o.meaning), definition: text(o.definition),
      synonyms: list(o.synonyms), example: text(o.example), exampleFa: text(o.exampleFa),
      forms: text(o.forms), note: text(o.note), level: text(o.level),
      ...richCardFields(o)
    };
  }
  // The five extra Anki cells for a card, in ANKI_RICH_COLUMNS order. Not yet quoted (toAnkiTsvSourced does that).
  function ankiRichCells(c) {
    const o = c && typeof c === "object" ? c : {};
    const ex2 = ankiText(o.example2);
    const ex2Fa = ankiText(o.example2Fa);
    return [
      cardList(o.collocations, 3, 60).join(" · "),
      ex2 ? (ex2Fa ? `${ex2} (${ex2Fa})` : ex2) : "",
      cardMistakes(o.mistakes).map(m => `${m.wrong} → ${m.right}${m.note ? ` (${m.note})` : ""}`).join(" · "),
      ankiText(o.contextNote),
      cardTags(o.tags).join(", ")
    ].map(ankiText);
  }
  // Splits a pasted list. One item per line, or items separated by an en dash. A leading bullet or number is removed,
  // repeats (any case) are dropped, and lines longer than WORD_ITEM_MAX are skipped. Only the first max items are kept.
  function splitWordList(text, max) {
    const cap = Math.max(1, Math.min(WORD_LIST_MAX, Math.floor(Number(max) || WORD_LIST_MAX)));
    const seen = new Set();
    const all = [];
    let tooLong = 0;
    for (const piece of String(text == null ? "" : text).split(/\r?\n|\s*–\s*/)) {
      const s = piece.replace(/^\s*(?:[-*•]+\s*|\d{1,3}[.)]\s+)/, "").replace(/\s+/g, " ").trim();
      if (!s) continue;
      if (s.length > WORD_ITEM_MAX) { tooLong++; continue; }
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(s);
    }
    return { items: all.slice(0, cap), total: all.length, over: Math.max(0, all.length - cap), tooLong, isList: all.length >= 2 };
  }
  // The prompt for one batch of words (at most WORD_BATCH_MAX). The reply is { "entries": [...] }, one entry per word, same order.
  // lang is the language code of the list, or "auto". No CEFR level is asked for: each entry gives the level of its own word.
  function wordListPrompt(words, lang) {
    const items = (Array.isArray(words) ? words : []).slice(0, WORD_BATCH_MAX).map((w, i) => `${i + 1}. ${cardText(w, WORD_ITEM_MAX)}`).join("\n");
    const code = langBase(lang);
    const langLine = code && code !== "auto" ? `All items are in language code "${code}" unless an item clearly says otherwise.` : "Detect the language of each item.";
    return `You are a bilingual dictionary for a Persian-speaking learner. Make one dictionary entry for each item below.\n` +
      `Return ONLY one JSON object: {"entries":[...]}. Use one entry per item, in the same order, and the same number of entries.\n` +
      `Each entry has exactly these keys: {"word":"","langCode":"","lemma":"","ipa":"","pos":"","meaning":"","definition":"","synonyms":[],"example":"","exampleFa":"","forms":"","note":"","level":"","collocations":[],"example2":"","example2Fa":"","mistakes":[{"wrong":"","right":"","note":""}],"contextNote":"","tags":[]}\n\n` +
      `- "word": the item as written.\n` +
      `- "langCode": ISO 639-1 code of the item's language, for example en or de.\n` +
      `- "lemma": base form. "ipa": IPA of the lemma between slashes, or "".\n` +
      `- "pos": part of speech in Persian, one short label.\n` +
      `- "meaning": precise Persian meaning, up to 3 short equivalents separated by «،».\n` +
      `- "definition": one simple definition in the item's language, at most 20 words.\n` +
      `- "synonyms": up to 4 synonyms in the item's language.\n` +
      `- "example": one NEW short sentence with the item, in the item's language. "exampleFa": its Persian translation.\n` +
      `- "forms": useful inflections, or "". "note": one short Persian usage tip, or "". "level": one of مبتدی، متوسط، پیشرفته.\n` +
      `- "collocations": 2 or 3 short phrases the item often goes with, in its language.\n` +
      `- "example2" and "example2Fa": a second, different short sentence and its Persian translation.\n` +
      `- "mistakes": 0 to 2 common learner mistakes. Each has "wrong" (the wrong form), "right" (the correct form) and "note" (a short Persian reason). [] if none.\n` +
      `- "contextNote": one short Persian note on when and where people use it (formal or casual, spoken or written), or "".\n` +
      `- "tags": 0 to 3 keys, only from: travel, food, work, study, family, health, technology, money, feelings, nature. [] if none fits.\n` +
      `- If an item is not a real word or phrase, set "meaning" to "" and leave the other fields empty.\n` +
      `${langLine} Never invent words.\n\n` +
      `Items:\n${items}`;
  }
  // Pairs each word with its entry from a batch reply. Matches by the word (any case), else by position when the entry has no word.
  // A word with no entry that has a meaning gets null.
  function matchWordEntries(words, reply) {
    const list = reply && Array.isArray(reply.entries) ? reply.entries : Array.isArray(reply) ? reply : [];
    const byWord = new Map();
    for (const e of list) {
      if (e && typeof e === "object" && cardText(e.word)) byWord.set(cardText(e.word).toLowerCase(), e);
    }
    return (Array.isArray(words) ? words : []).map((w, i) => {
      const at = list[i];
      const hit = byWord.get(cardText(w).toLowerCase()) || (at && typeof at === "object" && !cardText(at.word) ? at : null);
      return hit && cardText(hit.meaning) ? hit : null;
    });
  }

  // ---------- timestamped notes ----------
  function noteSeconds(n) {
    return Math.max(0, Math.floor(numOr(n && n.t, 0)));
  }
  // mm:ss (minutes can go past 59 for long videos)
  function formatMmSs(sec) {
    const s = Math.max(0, Math.floor(numOr(sec, 0)));
    return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
  // Where a note or a card's source opens: the YouTube watch page at the time, or the stored http(s) URL, or "".
  const YT_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  function sourceOpenUrl(n) {
    if (!n || typeof n !== "object") return "";
    const id = String(n.videoId || "").trim();
    if (YT_ID_RE.test(id)) return `https://www.youtube.com/watch?v=${id}&t=${noteSeconds(n)}`;
    const url = String(n.url || "").trim();
    return /^https?:\/\/\S+$/i.test(url) ? url : "";
  }
  // Notes grouped by video title. Inside a group, notes are in video order; groups are newest first.
  function groupNotes(notes) {
    const map = new Map();
    for (const n of Array.isArray(notes) ? notes : []) {
      if (!n || typeof n !== "object") continue;
      const title = String(n.title || "").trim();
      if (!map.has(title)) map.set(title, { title, notes: [], latest: 0 });
      const g = map.get(title);
      g.notes.push({ ...n, t: noteSeconds(n), text: String(n.text || "") });
      g.latest = Math.max(g.latest, numOr(n.createdAt, 0));
    }
    const out = [...map.values()];
    for (const g of out) g.notes.sort((a, b) => (a.t - b.t) || (numOr(a.createdAt, 0) - numOr(b.createdAt, 0)));
    out.sort((a, b) => b.latest - a.latest);
    return out;
  }

  // ---------- practice seed: one video's context for roleplay and writing (spec 27 and 29) ----------
  // The overlay or the learn page writes { videoId, title, topic, cues, createdAt } under PRACTICE_SEED_KEY.
  // roleplay.html and writer.html read it. Cues are { start, end, text }, at most SEED_MAX_CUES of them.
  const PRACTICE_SEED_KEY = "subify_practice_seed";
  const SEED_MAX_CUES = 12;
  const SEED_STOP = new Set(("the and that with this have from they will your what about there their would which when just like know going "
    + "really think gonna were been them then than into also some more very make want because here where said does didn "
    + "und der die das ist nicht ein eine mit auf für que los las por para une est pas avec dans qui").split(/\s+/));
  function seedText(v, max) {
    return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
  }
  // Up to `count` cues around time t (the cue playing at t, or the first cue after it), in video order.
  function seedCuesAround(cues, t, count) {
    const list = (Array.isArray(cues) ? cues : []).filter(c => c && seedText(c.text, 300));
    if (!list.length) return [];
    const n = Math.max(1, Math.min(Number(count) || SEED_MAX_CUES, SEED_MAX_CUES));
    const at = Number(t) || 0;
    let i = list.findIndex(c => at >= Number(c.start) && at < Number(c.end));
    if (i < 0) i = list.findIndex(c => Number(c.start) >= at);
    if (i < 0) i = list.length - 1;
    const to = Math.min(list.length, Math.max(0, i - Math.floor(n / 2)) + n);
    const from = Math.max(0, to - n);
    return list.slice(from, to).map(c => ({
      start: Math.max(0, numOr(c.start, 0)), end: Math.max(0, numOr(c.end, 0)), text: seedText(c.text, 300)
    }));
  }
  // The most frequent content words of the cues, comma separated. A topic line without an extra AI call.
  function seedTopic(cues, limit) {
    const counts = new Map();
    for (const c of Array.isArray(cues) ? cues : []) {
      for (const raw of String(c && c.text || "").toLocaleLowerCase().split(/[^\p{L}\p{M}']+/u)) {
        const w = raw.replace(/^'+|'+$/g, "");
        if (w.length < 4 || SEED_STOP.has(w) || /\d/.test(w)) continue;
        counts.set(w, (counts.get(w) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit || 6)
      .map(([w]) => w)
      .join(", ");
  }
  // Returns a clean seed, or null when there is neither a title nor any usable cue.
  function practiceSeed(raw) {
    if (!raw || typeof raw !== "object") return null;
    const cues = (Array.isArray(raw.cues) ? raw.cues : [])
      .map(c => ({ start: Math.max(0, numOr(c && c.start, 0)), end: Math.max(0, numOr(c && c.end, 0)), text: seedText(c && c.text, 300) }))
      .filter(c => c.text)
      .slice(0, SEED_MAX_CUES);
    const title = seedText(raw.title, 200);
    if (!title && !cues.length) return null;
    const videoId = String(raw.videoId || "").trim();
    return {
      videoId: /^[A-Za-z0-9_-]{1,80}$/.test(videoId) ? videoId : "",
      title,
      topic: seedText(raw.topic, 200) || seedTopic(cues),
      cues,
      createdAt: numOr(raw.createdAt, Date.now())
    };
  }

  // ---------- AI practice context: saved words and recent videos (spec 27 and 29) ----------
  // Pure helpers. ai-core.js reads the cards (IndexedDB) and the video log (storage) and passes them in.
  const PRACTICE_WORDS_MAX = 10;
  const PRACTICE_TITLES_MAX = 5;
  // The overlay keeps one entry per video: { videoId, title, at }, newest first. Written by subtitle-overlay.js.
  const VIDEO_HISTORY_KEY = "subify_video_history";
  const VIDEO_HISTORY_MAX = 8;
  // Saved words for the learning language (cards in that language, or with no language). Words due for review come
  // first, most overdue first; then the most recently added or changed. At most 10: [{ word, meaning }], no repeats.
  function practiceWords(cards, opts) {
    const o = opts || {};
    const target = langBase(o.target);
    const now = numOr(o.now, Date.now());
    const limit = Math.max(1, Math.min(PRACTICE_WORDS_MAX, Math.floor(numOr(o.limit, PRACTICE_WORDS_MAX))));
    const pool = (Array.isArray(cards) ? cards : []).filter(c => {
      if (!c || typeof c !== "object" || !seedText(c.word, 80)) return false;
      const lang = langBase(c.lang);
      return target === "auto" || lang === "auto" || lang === target;
    });
    const due = pool.filter(c => isDue(c, now)).sort((a, b) => numOr(a.nextDueAt, 0) - numOr(b.nextDueAt, 0));
    const recent = pool.filter(c => !isDue(c, now)).sort((a, b) => numOr(b.updatedAt, 0) - numOr(a.updatedAt, 0));
    const out = [];
    const seen = new Set();
    for (const c of [...due, ...recent]) {
      const key = normWord(c.word);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ word: seedText(c.word, 80), meaning: seedText(c.meaning || c.translation, 120) });
      if (out.length >= limit) break;
    }
    return out;
  }
  // Clean video log: one entry per videoId, valid title, newest first, at most VIDEO_HISTORY_MAX entries.
  function sanitizeVideoHistory(raw) {
    const seen = new Set();
    const out = [];
    for (const h of Array.isArray(raw) ? raw : []) {
      if (!h || typeof h !== "object") continue;
      const title = seedText(h.title, 200);
      const videoId = String(h.videoId || "").trim();
      if (!title || !/^[A-Za-z0-9_-]{1,80}$/.test(videoId) || seen.has(videoId)) continue;
      seen.add(videoId);
      out.push({ videoId, title, at: numOr(h.at, 0) });
      if (out.length >= VIDEO_HISTORY_MAX) break;
    }
    return out;
  }
  // Titles for the AI prompt, newest first: the logged videos, then the sources of saved cards (no repeats).
  function recentVideoTitles(history, cards, limit) {
    const max = Math.max(1, Math.min(VIDEO_HISTORY_MAX, Math.floor(numOr(limit, PRACTICE_TITLES_MAX))));
    const out = [];
    const seen = new Set();
    const add = (t) => {
      const key = t.toLocaleLowerCase();
      if (!t || seen.has(key)) return;
      seen.add(key);
      out.push(t);
    };
    for (const h of sanitizeVideoHistory(history)) add(h.title);
    const fromCards = (Array.isArray(cards) ? cards : [])
      .filter(c => c && c.source && typeof c.source === "object" && !isPracticeSource(c.source))
      .sort((a, b) => numOr(b.updatedAt, 0) - numOr(a.updatedAt, 0));
    for (const c of fromCards) {
      if (out.length >= max) break;
      add(seedText(c.source.title, 200));
    }
    return out.slice(0, max);
  }

  // ---------- words saved from a roleplay lesson (r21) ----------
  // The source of such a card is the practice itself (kind "practice"), never a video. Video titles and the source
  // line skip it.
  const PRACTICE_SOURCE_TITLE = "Roleplay practice";
  function practiceSource() {
    return { title: PRACTICE_SOURCE_TITLE, kind: "practice", videoId: "", t: null, url: "" };
  }
  function isPracticeSource(source) {
    return Boolean(source && typeof source === "object" && source.kind === "practice");
  }
  // One new card for a lesson word, with the same spaced-repetition start as a card saved from a video.
  // Null when the word has no letters. opts.lang is the practice language; opts.level is the learner's CEFR level.
  function practiceCard(w, opts) {
    const o = opts || {};
    const word = seedText(w && w.word, 80).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (!normWord(word)) return null;
    const now = numOr(o.now, Date.now());
    return {
      word,
      lang: langBase(o.lang),
      meaning: seedText(w.meaning, 200),
      example: seedText(w.example, 300),
      level: seedText(o.level, 8),
      sentence: "",
      translation: "",
      box: 1,
      state: "new",
      ease: SRS_DEFAULT_EASE,
      interval: 0,
      reps: 0,
      lapses: 0,
      nextDueAt: now,
      history: [],
      createdAt: now,
      updatedAt: now,
      source: practiceSource()
    };
  }
  // Plans a save of lesson words: { cards: [{ key, card }], skipped: [word] }. A word is skipped when it is already saved
  // (opts.existing lists the wordKey of every saved card) or when it repeats an earlier word in the same list.
  // Keys are wordKey values, so "Hotel" and "hotel" are one word. Every card is in the practice language.
  function planPracticeSaves(words, opts) {
    const o = opts || {};
    const lang = langBase(o.lang);
    const taken = new Set(Array.isArray(o.existing) ? o.existing : []);
    const cards = [];
    const skipped = [];
    for (const w of Array.isArray(words) ? words : []) {
      const card = practiceCard(w, { lang, now: o.now, level: o.level });
      if (!card) continue;
      const key = wordKey(lang, card.word);
      if (taken.has(key)) {
        skipped.push(card.word);
        continue;
      }
      taken.add(key);
      cards.push({ key, card });
    }
    return { cards, skipped };
  }

  const api = {
    PRACTICE_SEED_KEY, SEED_MAX_CUES, seedCuesAround, seedTopic, practiceSeed,
    VIDEO_HISTORY_KEY, PRACTICE_WORDS_MAX, practiceWords, sanitizeVideoHistory, recentVideoTitles,
    PRACTICE_SOURCE_TITLE, practiceSource, isPracticeSource, practiceCard, planPracticeSaves,
    HIGHLIGHT_MODES, SMART_MODES, REPLAY_SPEEDS, DEFAULT_LEARNING,
    LANG_CODES, LANG_NAMES_EN, TARGET_LANGS, CEFR_LEVELS, EXPLAIN_LANGS,
    SRS_STATES, SRS_GRADES, SRS_DEFAULT_EASE, SRS_MIN_EASE, SRS_MASTERED_DAYS,
    normWord, langBase, wordKey, isLearningSource, statusOf, srsPhase, srsMigrate, srsGrade, srsBox,
    isDue, matchesMode, buildIndex, lookupCard,
    sanitizeLearning, effectiveHighlight, learningStats,
    toAnkiTsv, toAnkiTsvSourced, ANKI_SOURCE_COLUMNS, ankiSource, formatMmSs, sourceOpenUrl, groupNotes,
    CARD_TAG_KEYS, WORD_LIST_MAX, WORD_BATCH_MAX, ANKI_RICH_COLUMNS, cardText, richCardFields, entryCardFields,
    cardMistakes, cardTags, ankiRichCells, splitWordList, wordListPrompt, matchWordEntries
  };
  root.SubifyLearning = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
