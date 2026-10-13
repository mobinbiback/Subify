// Pure helpers for the full-page translator (page-translator.js and background.js).
// Which text is skipped, how text is batched, and the per-language translation cache (LRU).
// No browser API is used here, so the same file runs in the service worker (importScripts),
// in Firefox's background scripts, in the page before page-translator.js, and in node tests.
(function (root) {
  'use strict';

  const BATCH_MAX_ITEMS = 40;
  const BATCH_MAX_CHARS = 3000;
  const CACHE_MAX = 2000;
  const PAGE_AUTO_ORIGINS = ['https://*/*', 'http://*/*'];

  // Text whose parent element is one of these tags is never translated.
  const SKIP_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME',
    'INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'CODE', 'PRE', 'KBD', 'SAMP', 'MATH'];

  // An element matching this selector (or inside one) keeps its text: editors, notranslate blocks and Subify's own overlay.
  const SKIP_SELECTOR = [
    '[contenteditable]:not([contenteditable="false"])',
    '[translate="no"]',
    '.notranslate',
    '[role="textbox"]',
    '[id^="subify"]',
    '[class*="subify"]',
    '[data-subify]'
  ].join(',');

  function normalize(text) {
    return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  }

  // info: { tag: parent tag name, inSkipAncestor: parent.closest(SKIP_SELECTOR) is set, text: the node value }
  function shouldSkipText(info) {
    const text = normalize(info && info.text);
    if (text.length < 2) return true;
    if (!/\p{L}/u.test(text)) return true; // numbers, punctuation and symbols only
    if (/^(https?:\/\/|www\.)\S+$/i.test(text) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) return true;
    if (info && info.inSkipAncestor) return true;
    return SKIP_TAGS.includes(String((info && info.tag) || '').toUpperCase());
  }

  // Splits {id, text} items into request batches: at most maxItems items and about maxChars characters.
  // A single item longer than maxChars gets a batch of its own.
  function batchTexts(items, opts) {
    const maxItems = (opts && opts.maxItems) || BATCH_MAX_ITEMS;
    const maxChars = (opts && opts.maxChars) || BATCH_MAX_CHARS;
    const batches = [];
    let current = [];
    let chars = 0;
    for (const item of Array.isArray(items) ? items : []) {
      const len = normalize(item && item.text).length;
      if (current.length && (current.length >= maxItems || chars + len > maxChars)) {
        batches.push(current);
        current = [];
        chars = 0;
      }
      current.push(item);
      chars += len;
    }
    if (current.length) batches.push(current);
    return batches;
  }

  // 32-bit FNV-1a hash of a string, in base 36.
  function textHash(text) {
    let h = 0x811c9dc5;
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
  }

  function cacheKey(lang, text) {
    return String(lang || '').toLowerCase() + ':' + textHash(normalize(text));
  }

  // The cache is { seq, items }. Each item is { s: source text, o: translation, u: last-use number }.
  // The source text is stored too, so a hash collision reads as a miss instead of a wrong translation.
  function emptyCache() {
    return { seq: 0, items: {} };
  }

  function cacheLoad(raw) {
    if (!raw || typeof raw !== 'object' || !raw.items || typeof raw.items !== 'object') return emptyCache();
    return { seq: Number(raw.seq) || 0, items: raw.items };
  }

  function cacheGet(cache, lang, text) {
    const src = normalize(text);
    const key = cacheKey(lang, src);
    const entry = cache && cache.items && Object.prototype.hasOwnProperty.call(cache.items, key) ? cache.items[key] : null;
    if (!entry || entry.s !== src || !entry.o) return null;
    entry.u = ++cache.seq;
    return entry.o;
  }

  function cachePrune(cache, max) {
    const keys = Object.keys(cache.items);
    if (keys.length <= max) return cache;
    keys.sort((a, b) => cache.items[a].u - cache.items[b].u);
    for (const key of keys.slice(0, keys.length - max)) delete cache.items[key];
    return cache;
  }

  function cachePut(cache, lang, text, out, max) {
    const src = normalize(text);
    const value = normalize(out);
    if (!src || !value) return cache;
    cache.items[cacheKey(lang, src)] = { s: src, o: value, u: ++cache.seq };
    return cachePrune(cache, max || CACHE_MAX);
  }

  // The stored "translate every page" option, with defaults. enabled must be exactly true.
  function normalizePageAuto(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
      enabled: r.enabled === true,
      lang: String(r.lang || 'fa').split('-')[0].toLowerCase(),
      font: String(r.font || 'Vazirmatn')
    };
  }

  function isTranslatableUrl(url) {
    return /^https?:\/\//i.test(String(url || ''));
  }

  const api = {
    BATCH_MAX_ITEMS,
    BATCH_MAX_CHARS,
    CACHE_MAX,
    PAGE_AUTO_ORIGINS,
    SKIP_TAGS,
    SKIP_SELECTOR,
    normalize,
    shouldSkipText,
    batchTexts,
    textHash,
    cacheKey,
    emptyCache,
    cacheLoad,
    cacheGet,
    cachePut,
    cachePrune,
    normalizePageAuto,
    isTranslatableUrl
  };
  root.SubifyPageTranslateCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
