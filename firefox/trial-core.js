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

  // Own-key engines are never gated. Any other engine name, including an unknown or empty one, is Subify Server (fails closed).
  const OWN_KEY_ENGINES = ['gemini', 'custom', 'openrouter', 'openai', 'own'];

  // The access rule for one AI request. background.js, the overlay and the tests all use this one function.
  // engine: 'subify' for Subify Server, 'own' or an own-key provider name for the user's own key.
  // switchOn: the subscription switch (auth/me.php subscription). signedIn: a member is signed in.
  // canary: a member on the billing canary list. It changes nothing here: with the switch off, everyone is already allowed.
  // Returns 'allow' (Subify Server may run; with the switch off the guest and legacy quotas apply as before),
  // 'needs_sign_in' (switch on and no member signed in) or 'own_key_free' (own key, never gated).
  function subifyAccessDecision(input) {
    const i = input || {};
    if (OWN_KEY_ENGINES.includes(String(i.engine || ''))) return 'own_key_free';
    if (i.switchOn && !i.signedIn) return 'needs_sign_in';
    return 'allow';
  }

  const api = { TRIAL_MAX, pageKey, take, refund, subifyAccessDecision };
  root.SubifyTrial = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
