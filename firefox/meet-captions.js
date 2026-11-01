/* Subify: translated captions for Google Meet on desktop Chrome.
   Meet shows its own captions when the user turns CC on. This script reads the newest caption
   line from the page, translates it with the same backend as page translation, and shows it as
   a pill near the bottom of the call. It does not capture audio; it only reads text the page
   already shows. Captions stay off until the user presses the Subify button.
   Meet changes its class names often, so the caption area is found by a short list of known
   attributes first, then by the live region closest to the bottom of the screen. */
(() => {
  'use strict';
  if (window.top !== window) return;          // the call page itself, not its frames
  if (window.__subifyMeetCC) return;
  window.__subifyMeetCC = true;
  const api = globalThis.browser || globalThis.chrome;

  const STORE_KEY = 'subify_meet_cc';
  const SETTINGS_KEY = 'subify_settings';
  const UI_LANG_KEY = 'subify_popup_language';   // the popup's interface language (fa, en, ar, es, tr, fr, de)
  const UI = {
    fa: { toggle: 'زیرنویس Subify', signin: 'برای ترجمهٔ زیرنویس، از پنجرهٔ افزونه با حساب Subify وارد شو.' },
    en: { toggle: 'Subify captions', signin: 'Sign in to Subify from the extension popup to translate captions.' },
    ar: { toggle: 'ترجمة Subify', signin: 'سجّل الدخول إلى Subify من نافذة الإضافة لترجمة التعليقات المكتوبة.' },
    es: { toggle: 'Subtítulos Subify', signin: 'Inicia sesión en Subify desde la ventana de la extensión para traducir los subtítulos.' },
    tr: { toggle: 'Subify altyazı', signin: 'Altyazıyı çevirmek için eklenti penceresinden Subify hesabınla giriş yap.' },
    fr: { toggle: 'Sous-titres Subify', signin: 'Connecte-toi à Subify depuis la fenêtre de l’extension pour traduire les sous-titres.' },
    de: { toggle: 'Subify-Untertitel', signin: 'Melde dich in der Erweiterung bei Subify an, um die Untertitel zu übersetzen.' }
  };
  let uiLang = 'fa';
  const ui = (key) => (UI[uiLang] || UI.en)[key];
  const REGION_SELECTORS = ['[jsname="dsyhDe"]', '[jsname="YSxPC"]'];
  const POLL_MS = 350;            // wait after a DOM change before reading the captions
  const TRANSLATE_DELAY_MS = 900; // wait for a pause in speech before translating
  const MAX_WAIT_MS = 3500;       // translate at least this often while people keep talking
  const HIDE_AFTER_MS = 7000;     // the pill disappears when nothing new is said
  const CACHE_MAX = 300;

  let enabled = false;
  let targetLang = 'fa';
  let region = null;
  let regionLabel = '';
  let lastSeen = '';
  let lastTranslateAt = 0;
  let translateTimer = null;
  let hideTimer = null;
  let scheduled = false;
  let authBlocked = false;
  const cache = new Map();

  /* ---- own UI (shadow DOM, so the page's CSS does not reach it) ---- */
  const host = document.createElement('div');
  host.id = 'subify-meet-cc-host';
  host.style.cssText = 'all:initial;position:fixed;inset:0;pointer-events:none;z-index:2147483646;';
  const root = host.attachShadow({ mode: 'open' });
  const fontUrl = api.runtime.getURL('fonts/Vazirmatn-Regular.ttf');
  root.innerHTML = `
    <style>
      @font-face { font-family: 'SubifyMeetFa'; src: url('${fontUrl}') format('truetype'); font-weight: 300 900; }
      .cap { position: absolute; left: 50%; bottom: 112px; transform: translateX(-50%); width: min(88vw, 920px);
             display: flex; flex-direction: column; align-items: center; gap: 6px; pointer-events: none; }
      .cap[hidden], .toggle[hidden] { display: none !important; }
      .orig { direction: ltr; font: 500 14px/1.45 Inter, system-ui, sans-serif; color: #dfe7f3;
              background: rgba(8, 10, 14, 0.7); padding: 3px 12px; border-radius: 999px; text-align: center;
              text-shadow: 0 1px 4px #000; max-width: 100%; }
      .fa { direction: rtl; font: 700 22px/1.6 'SubifyMeetFa', Vazirmatn, Tahoma, sans-serif; color: #fff;
            background: rgba(8, 10, 14, 0.8); padding: 6px 16px; border-radius: 16px; text-align: center;
            text-shadow: 0 2px 7px #000; max-width: 100%; }
      .toggle { position: absolute; left: 16px; bottom: 18px; pointer-events: auto; height: 34px; padding: 0 14px;
                border: 0; border-radius: 999px; background: rgba(8, 10, 14, 0.82); color: #fff;
                font: 600 13px Inter, system-ui, sans-serif; cursor: pointer; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4); }
      .toggle[aria-pressed="true"] { background: #9b78ff; color: #0b0712; }
      .toggle:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    </style>
    <div class="cap" hidden>
      <div class="orig" dir="ltr"></div>
      <div class="fa" dir="rtl"></div>
    </div>
    <button class="toggle" type="button" aria-pressed="false"></button>`;
  const capEl = root.querySelector('.cap');
  const origEl = root.querySelector('.orig');
  const faEl = root.querySelector('.fa');
  const toggle = root.querySelector('.toggle');

  function setPressed() {
    toggle.textContent = ui('toggle');
    toggle.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  }

  function showSignIn() {
    origEl.textContent = '';
    faEl.textContent = ui('signin');
    capEl.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideCaption, 9000);
  }

  function hideCaption() {
    clearTimeout(hideTimer);
    capEl.hidden = true;
  }

  function show(orig, fa) {
    if (!enabled) return;
    origEl.textContent = orig;
    faEl.textContent = fa;
    capEl.hidden = false;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideCaption, HIDE_AFTER_MS);
  }

  /* ---- reading Meet's captions ---- */
  function readText(el) {
    return String(el.innerText || el.textContent || '').trim();
  }

  function findRegion() {
    for (const sel of REGION_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && readText(el)) {
        regionLabel = sel;
        return el;
      }
    }
    // Fallback: the live region with text that sits lowest on screen (captions sit above the control bar).
    let best = null;
    let bestScore = 0;
    document.querySelectorAll('[aria-live]').forEach((el) => {
      if (host.contains(el) || el.closest('[role="dialog"], [role="complementary"]')) return;
      const text = readText(el);
      if (!text) return;
      const r = el.getBoundingClientRect();
      if (r.height === 0 || r.bottom < window.innerHeight * 0.5) return;
      const score = r.bottom + Math.min(text.length, 400);
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
    });
    if (best) regionLabel = 'aria-live fallback';
    return best;
  }

  // The newest spoken line. Meet writes the speaker's name on its own short line above the words.
  function newestLine(el) {
    const lines = String(el.innerText || '')
      .split(/\n+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1);
    if (!lines.length) return '';
    let line = lines[lines.length - 1];
    const looksLikeName = (s) => s.length <= 30 && s.split(/\s+/).length <= 3 && !/[.!?؟،,:;]$/.test(s);
    if (looksLikeName(line) && lines.length > 1) line = lines[lines.length - 2];
    return line.slice(0, 300);
  }

  function tick() {
    scheduled = false;
    if (!enabled) return;
    if (!region || !region.isConnected) {
      region = findRegion();
      if (region) console.info('[Subify CC] caption area found:', regionLabel);
    }
    if (!region) return;
    const line = newestLine(region);
    if (!line || line === lastSeen) return;
    lastSeen = line;
    clearTimeout(translateTimer);
    if (Date.now() - lastTranslateAt > MAX_WAIT_MS) {
      translateLine(line);
    } else {
      translateTimer = setTimeout(() => translateLine(line), TRANSLATE_DELAY_MS);
    }
  }

  async function translateLine(line) {
    lastTranslateAt = Date.now();
    if (cache.has(line)) return show(line, cache.get(line));
    if (authBlocked) return;
    try {
      const r = await api.runtime.sendMessage({
        type: 'subify-page-translate',
        texts: [{ id: '0', text: line }],
        targetLanguage: targetLang
      });
      if (r && r.authRequired) {
        authBlocked = true;
        showSignIn();
        return;
      }
      const out = r && r.ok && Array.isArray(r.results) && r.results[0] ? String(r.results[0].text || '').trim() : '';
      if (!out) {
        if (r && r.error) console.warn('[Subify CC] translation failed:', r.error);
        return;
      }
      if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
      cache.set(line, out);
      show(line, out);
    } catch (e) {
      console.warn('[Subify CC] translation request failed:', e && e.message ? e.message : e);
    }
  }

  const observer = new MutationObserver(() => {
    if (!enabled || scheduled) return;
    scheduled = true;
    setTimeout(tick, POLL_MS);
  });

  function start() {
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    tick();
  }

  function stop() {
    observer.disconnect();
    clearTimeout(translateTimer);
    hideCaption();
  }

  function setEnabled(on) {
    enabled = !!on;
    setPressed();
    if (enabled) {
      authBlocked = false;
      lastSeen = '';
      start();
    } else {
      stop();
    }
    api.storage.local.set({ [STORE_KEY]: enabled }).catch(() => {});
  }

  toggle.addEventListener('click', () => setEnabled(!enabled));

  function applySettings(settings) {
    const lang = String((settings && settings.targetLanguage) || 'fa').split('-')[0].toLowerCase();
    if (lang !== targetLang) {
      targetLang = lang;
      cache.clear();
      lastSeen = '';
    }
  }

  function applyUiLang(value) {
    uiLang = UI[value] ? value : 'fa';
    setPressed();
  }

  api.storage.local.get([STORE_KEY, SETTINGS_KEY, UI_LANG_KEY]).then((got) => {
    applySettings(got[SETTINGS_KEY]);
    applyUiLang(got[UI_LANG_KEY]);
    (document.body || document.documentElement).appendChild(host);
    if (got[STORE_KEY]) setEnabled(true);
    else setPressed();
  }).catch(() => {
    (document.body || document.documentElement).appendChild(host);
    setPressed();
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[SETTINGS_KEY]) applySettings(changes[SETTINGS_KEY].newValue);
    if (changes[UI_LANG_KEY]) applyUiLang(changes[UI_LANG_KEY].newValue);
  });
})();
