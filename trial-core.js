// Free-source counting for the no-sign-in trial (pure helpers, no browser API).
// A source is one video (subtitles or dubbing: the bare video id, as before) or one full-page translation
// (the page URL without its #fragment). The same source counts once; the eleventh new source is refused.
// Loaded by background.js (importScripts in Chrome, background scripts in Firefox) and by extension/tests.
(function (root) {
  'use strict';

  const TRIAL_MAX = 10;
  const PAGE_PREFIX = 'page:';

  // Key for a full-page translation. Empty when the tab is not a normal web page (no key, so nothing is counted).
  function pageKey(url) {
    const text = String(url || '');
    if (!/^https?:\/\//i.test(text)) return '';
    return PAGE_PREFIX + text.split('#')[0].slice(0, 2000);
  }

  // Decides one source against the stored list. Returns the list to save when a new source was added.
  // allowed: false when there is no key or the list is full and this source is new.
  function take(list, key, max) {
    const current = Array.isArray(list) ? list : [];
    const limit = Number.isFinite(max) ? max : TRIAL_MAX;
    if (!key) return { allowed: false, added: false, list: current };
    if (current.includes(key)) return { allowed: true, added: false, list: current };
    if (current.length >= limit) return { allowed: false, added: false, list: current };
    return { allowed: true, added: true, list: current.concat([key]) };
  }

  // Gives a source back, for example when the learner closes the screen-share picker before the share starts.
  // Only a key that is in the list is removed; the list returned is a new array.
  function refund(list, key) {
    const current = Array.isArray(list) ? list : [];
    if (!key || !current.includes(key)) return { removed: false, list: current };
    return { removed: true, list: current.filter((item) => item !== key) };
  }

  const api = { TRIAL_MAX, pageKey, take, refund };
  root.SubifyTrial = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
