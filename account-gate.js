var browser = globalThis.browser || globalThis.chrome; // Chrome has no browser global; same APIs live on chrome.*
/*! Subify account UI (popup + options), bilingual (فارسی / English).
 *  - popup: sign-in wall when login is required; a "My account" bar when signed in.
 *  - options: sign-in card; when signed in the page opens the MEMBER PANEL (profile, support tickets);
 *    the technical settings move into a collapsed "Advanced settings" section.
 *  All network access goes through background.js (the page never reads the session cookie). */
(function () {
  'use strict';
  var api = (typeof browser !== 'undefined' && browser.runtime) ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  if (!api || !api.runtime || !api.runtime.sendMessage) return;
  var SITE = 'https://sub-ify.site';
  var IS_OPTIONS = !!document.querySelector('main.wrap');
  var wallEl = null, timer = null, panel = null, bar = null, lastUser = null, view = { name: 'home' }, busy = false;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  /** both languages, always: the UI-language line first, English under it */
  function bi(fa, en, small) {
    var sub = small ? 'font-size:11px;opacity:.72;font-weight:400;margin-top:2px;' : 'font-size:10.5px;opacity:.7;font-weight:400;margin-top:1px;';
    // Persian line: translated by ui-language.js (kept Persian in English mode); English line: never translated.
    return '<span data-subify-keep-fa style="display:block">' + esc(fa) + '</span><span dir="ltr" data-subify-i18n-ignore style="display:block;' + sub + '">' + esc(en) + '</span>';
  }
  function el(tag, css, html) { var n = document.createElement(tag); if (css) n.style.cssText = css; if (html != null) n.innerHTML = html; return n; }
  function ask(type, extra) {
    return new Promise(function (resolve) {
      try {
        var p = api.runtime.sendMessage(Object.assign({ type: type }, extra || {}), function (r) { resolve(r || null); });
        if (p && p.then) p.then(function (r) { resolve(r || null); }, function () { resolve(null); });
      } catch (e) { resolve(null); }
    });
  }
  function openLogin(provider) {
    var url = SITE + '/auth/login.php?provider=' + provider + '&return=' + encodeURIComponent(SITE + '/?ext=1');
    if (api.tabs && api.tabs.create) api.tabs.create({ url: url }); else window.open(url, '_blank', 'noopener');
  }
  function btnCss(primary) {
    return 'display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;min-height:48px;margin:0 0 9px;padding:8px 12px;border-radius:13px;border:1px solid ' +
      (primary ? '#7c5cff' : '#2a3447') + ';background:' + (primary ? '#7c5cff' : '#111621') + ';color:#fff;font-family:inherit;font-size:13.5px;font-weight:700;cursor:pointer;text-align:center;line-height:1.5';
  }
  function providersOf(state) { return (state && state.providers) || {}; }
  function loginButtons(state, host, onOpen) {
    injectGateStyle();
    var pr = providersOf(state);
    function add(provider, icon, fa, en) {
      var b = el('button', '');
      b.type = 'button';
      b.className = 'sg-btn';
      b.innerHTML = '<span class="sg-ico">' + icon + '</span><span class="sg-txt">' + gbi(fa, en) + '</span>';
      b.addEventListener('click', function () { openLogin(provider); if (onOpen) onOpen(); });
      host.appendChild(b);
    }
    if (pr.google) add('google', GOOGLE_ICON, 'ادامه با Google', 'Continue with Google');
    if (pr.github) add('github', GITHUB_ICON, 'ادامه با GitHub', 'Continue with GitHub');
  }

  /* ------------------------------------------------------------- sign-in wall */
  var GOOGLE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5c-.3 1.5-1.1 2.7-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.9-3c-1.1.7-2.5 1.2-4 1.2-3.1 0-5.7-2.1-6.6-4.9H1.4v3.1C3.4 21.4 7.4 24 12 24z"/><path fill="#FBBC05" d="M5.4 14.4c-.2-.7-.4-1.5-.4-2.4s.1-1.6.4-2.4V6.5H1.4C.5 8.2 0 10 0 12s.5 3.8 1.4 5.5l4-3.1z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.5 1.8l3.4-3.4C17.9 1.2 15.2 0 12 0 7.4 0 3.4 2.6 1.4 6.5l4 3.1C6.3 6.9 8.9 4.8 12 4.8z"/></svg>';
  var GITHUB_ICON = '<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false"><path fill="#111" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>';
  var GATE_CSS = [
    '#subify-gate{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px 16px;overflow-y:auto;background:radial-gradient(120% 60% at 50% 0%,rgba(124,92,255,.18),transparent 62%),#0b0f17;color:#eef1f8;font:14px/1.7 "VazirUI",Vazirmatn,system-ui,sans-serif;-webkit-font-smoothing:antialiased}',
    '#subify-gate,#subify-gate *{letter-spacing:0!important;word-spacing:normal!important}',
    '#subify-gate .sg-card{width:100%;max-width:348px;text-align:center}',
    '#subify-gate .sg-logo{display:block;width:64px;height:64px;margin:0 auto 14px;border-radius:20px;box-shadow:0 12px 30px rgba(124,92,255,.35)}',
    '#subify-gate h1.sg-title{margin:0 0 8px;font-family:"EstedadUI","VazirUI",sans-serif;font-size:19px!important;font-weight:700;line-height:1.35;color:inherit}',
    '#subify-gate .sg-title .sg-en{font-size:12.5px;margin-top:4px}',
    '#subify-gate .sg-desc{margin:0 0 18px;font-size:12.5px;line-height:1.85;color:#9aa6bb}',
    '.sg-fa{display:block;font-family:"VazirUI",Vazirmatn,system-ui,sans-serif}',
    '.sg-en{display:block;font-family:"Inter",system-ui,sans-serif;direction:ltr;line-height:1.5}',
    '.sg-btn{box-sizing:border-box;display:flex;align-items:center;gap:12px;width:100%;min-height:54px;margin:0 0 10px;padding:9px 14px;border-radius:14px;border:1px solid #2a3447;background:#121927;color:inherit;font:inherit;text-align:start;cursor:pointer;transition:border-color .16s,background-color .16s,transform .08s}',
    '.sg-btn:hover{border-color:rgba(124,92,255,.65);background:#171f30}',
    '.sg-btn:active{transform:scale(.985)}',
    '.sg-btn:focus-visible{outline:2px solid #8b74ff;outline-offset:2px}',
    '.sg-btn:disabled{opacity:.6;cursor:progress}',
    '.sg-txt{display:block;flex:1;min-width:0}',
    '.sg-btn .sg-fa{font-size:14px;font-weight:700;line-height:1.35}',
    '.sg-btn .sg-en{font-size:11px;font-weight:500;margin-top:1px}',
    '.sg-btn:not(.is-primary) .sg-en{color:#aab3c2}',
    '.sg-ico{flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:#fff}',
    '.sg-btn.is-primary{justify-content:center;background:#6a4fe6;border-color:#6a4fe6;color:#fff;text-align:center}',
    '.sg-ghost{background:transparent;border-style:dashed;border-color:#34405a;margin-bottom:0}',
    '.sg-ghost .sg-fa{font-size:13px;font-weight:600}',
    '#subify-gate .sg-status{display:flex;align-items:center;justify-content:center;gap:8px;min-height:20px;margin:6px 0 4px;font-size:12px;color:#c3cbdc}',
    '#subify-gate .sg-status:empty{min-height:0;margin:0}',
    '.sg-status-txt{display:block;text-align:start}',
    '.sg-spin{flex:none;width:13px;height:13px;border-radius:50%;border:2px solid rgba(160,140,255,.28);border-top-color:#a994ff;animation:sg-spin .8s linear infinite}',
    '@keyframes sg-spin{to{transform:rotate(360deg)}}',
    '@media (prefers-reduced-motion:reduce){.sg-spin{animation-duration:2.4s}}',
    '#subify-gate .sg-hint{margin:14px 0 0;font-size:11.5px;line-height:1.8;color:#8f9bb0}',
    '.sg-error{margin:0 0 14px;padding:10px 14px;border-radius:12px;border:1px solid #ff6b7a40;background:#ff6b7a1f;color:#ffb3bb;font-size:12.5px;line-height:1.8;text-align:start}',
    ':root[data-theme="light"] .sg-error{color:#b42338;background:#ff6b7a14;border-color:#ff6b7a66}',
    ':root[data-theme="light"] #subify-gate{background:radial-gradient(120% 60% at 50% 0%,rgba(124,92,255,.10),transparent 62%),#f4f7fc;color:#1d2433}',
    ':root[data-theme="light"] #subify-gate .sg-desc,:root[data-theme="light"] #subify-gate .sg-hint,:root[data-theme="light"] #subify-gate .sg-status{color:#5d6777}',
    ':root[data-theme="light"] .sg-btn{background:#fff;border-color:rgba(60,70,95,.18);box-shadow:0 4px 14px rgba(40,55,80,.06)}',
    ':root[data-theme="light"] .sg-btn:not(.is-primary) .sg-en{color:#5d6777}',
    ':root[data-theme="light"] .sg-btn:hover{background:#f7f5ff;border-color:rgba(124,92,255,.55)}',
    ':root[data-theme="light"] .sg-ghost{background:transparent;border-color:rgba(60,70,95,.28);box-shadow:none}',
    ':root[data-theme="light"] .sg-btn.is-primary{background:#6a4fe6;border-color:#6a4fe6;color:#fff}',
    '#subify-gate .sg-btn.sg-ghost.is-primary{background:var(--solid,#6a4fe6)!important;border:1px solid var(--solid,#6a4fe6)!important;box-shadow:none!important}'
  ].join('\n');
  function injectGateStyle() {
    if (document.getElementById('subify-gate-style')) return;
    var s = document.createElement('style');
    s.id = 'subify-gate-style';
    s.textContent = GATE_CSS;
    (document.head || document.documentElement).appendChild(s);
  }
  // Translations for the status and offline lines added in this screen (ui-language.js keeps the rest).
  if (window.SubifyUI && typeof window.SubifyUI.register === 'function') window.SubifyUI.register({
    ar: { 'منتظر ورود تو هستیم…': 'بانتظار تسجيل دخولك…', 'در حال بررسی…': 'جارٍ التحقق…', 'اتصال به سرور ورود برقرار نشد': 'تعذّر الوصول إلى خادم تسجيل الدخول', 'اینترنت یا فیلترشکن را بررسی کن.': 'تحقّق من الإنترنت أو VPN.' },
    es: { 'منتظر ورود تو هستیم…': 'Esperando a que inicies sesión…', 'در حال بررسی…': 'Comprobando…', 'اتصال به سرور ورود برقرار نشد': 'No se pudo conectar con el servidor de acceso', 'اینترنت یا فیلترشکن را بررسی کن.': 'Revisa tu conexión o VPN.' },
    tr: { 'منتظر ورود تو هستیم…': 'Girişini bekliyoruz…', 'در حال بررسی…': 'Kontrol ediliyor…', 'اتصال به سرور ورود برقرار نشد': 'Giriş sunucusuna ulaşılamadı', 'اینترنت یا فیلترشکن را بررسی کن.': 'Bağlantını veya VPN’ini kontrol et.' },
    fr: { 'منتظر ورود تو هستیم…': 'En attente de votre connexion…', 'در حال بررسی…': 'Vérification en cours…', 'اتصال به سرور ورود برقرار نشد': 'Impossible de joindre le serveur de connexion', 'اینترنت یا فیلترشکن را بررسی کن.': 'Vérifiez votre connexion ou votre VPN.' },
    de: { 'منتظر ورود تو هستیم…': 'Warte auf deine Anmeldung…', 'در حال بررسی…': 'Wird geprüft…', 'اتصال به سرور ورود برقرار نشد': 'Der Anmeldeserver ist nicht erreichbar', 'اینترنت یا فیلترشکن را بررسی کن.': 'Prüfe deine Verbindung oder dein VPN.' }
  });
  var gateWaiting = false, gateSig = '';
  // Messages for a failed sign-in (the codes come from auth/callback.php; the same texts as the web app).
  var SIGNIN_ERR = {
    denied: ['ورود لغو شد', 'Sign-in was cancelled.'],
    state: ['نشست ورود منقضی شد؛ دوباره تلاش کن.', 'The sign-in session expired: please try again.'],
    config: ['ورود با این روش هنوز تنظیم نشده است.', 'This sign-in method is not set up yet.'],
    closed: ['ورود و ثبت‌نام فعلاً بسته است.', 'Sign-in and sign-up are closed for now.'],
    disabled: ['این حساب مسدود شده است.', 'This account has been blocked.'],
    noemail: ['ایمیل تأییدشده‌ای پیدا نشد؛ ایمیلت را در Google/GitHub تأیید کن.', 'No verified e-mail was found. Verify your e-mail with Google/GitHub first.'],
    provider: ['ارتباط با سرویس ورود برقرار نشد؛ کمی بعد دوباره تلاش کن.', 'Could not reach the sign-in service: try again shortly.'],
    rate: ['تلاش‌های زیاد؛ یک دقیقه صبر کن.', 'Too many attempts: wait a minute.'],
    server: ['مشکلی پیش آمد؛ دوباره تلاش کن.', 'Something went wrong: please try again.']
  };
  // background.js stores the failed sign-in code when the sign-in tab comes back; show it once.
  function showSignInNotice() {
    var store = api.storage && api.storage.local; if (!store) return;
    Promise.resolve(store.get('subifyAuthNotice')).then(function (r) {
      var n = r && r.subifyAuthNotice;
      if (!n || Date.now() - n.at > 15 * 60 * 1000) return;
      var box = document.getElementById('sg-notice'); var msg = SIGNIN_ERR[n.code];
      if (!box || !msg) return;
      box.innerHTML = '<p class="sg-error" role="alert">' + gbi(msg[0], msg[1]) + '</p>';
      Promise.resolve(store.remove('subifyAuthNotice')).catch(function () {});
    }).catch(function () {});
  }
  function gbi(fa, en) {
    return '<span class="sg-fa" data-subify-keep-fa>' + esc(fa) + '</span><span class="sg-en" dir="ltr" data-subify-i18n-ignore>' + esc(en) + '</span>';
  }
  function gateSignature(state) {
    if (state && state.offline) return 'offline';
    var pr = providersOf(state);
    return 'signin:' + (pr.google ? 'g' : '') + (pr.github ? 'h' : '');
  }
  function dropWall() {
    if (wallEl) { wallEl.remove(); wallEl = null; }
    if (timer) { clearInterval(timer); timer = null; }
  }
  function removeWall() { dropWall(); gateWaiting = false; gateSig = ''; }
  function setStatus(kind) {
    var st = document.getElementById('sg-status'); if (!st) return;
    if (kind === 'waiting') st.innerHTML = '<span class="sg-spin" aria-hidden="true"></span><span class="sg-status-txt">' + gbi('منتظر ورود تو هستیم…', 'Waiting for you to sign in…') + '</span>';
    else if (kind === 'checking') st.innerHTML = '<span class="sg-spin" aria-hidden="true"></span><span class="sg-status-txt">' + gbi('در حال بررسی…', 'Checking…') + '</span>';
    else st.innerHTML = '';
  }
  function markCheckPrimary() { var b = document.querySelector('#subify-gate .sg-ghost'); if (b) b.classList.add('is-primary'); }
  function wall(state) {
    dropWall();
    injectGateStyle();
    gateSig = gateSignature(state);
    wallEl = el('div', '');
    wallEl.id = 'subify-gate';
    wallEl.setAttribute('role', 'dialog');
    wallEl.setAttribute('aria-modal', 'true');
    wallEl.setAttribute('aria-labelledby', 'sg-title');
    var logo = '<img class="sg-logo" alt="" src="' + esc(api.runtime.getURL ? api.runtime.getURL('icons/icon128.png') : 'icons/icon128.png') + '">';
    var card = el('div', '');
    card.className = 'sg-card';
    if (state && state.offline) {
      card.innerHTML = logo +
        '<h1 class="sg-title" id="sg-title">' + gbi('اتصال به سرور ورود برقرار نشد', 'Could not reach the sign-in server') + '</h1>' +
        '<p class="sg-desc">' + gbi('اینترنت یا فیلترشکن را بررسی کن.', 'Check your connection or VPN.') + '</p>';
      var r = el('button', '');
      r.type = 'button';
      r.className = 'sg-btn is-primary';
      r.innerHTML = '<span class="sg-txt">' + gbi('تلاش دوباره', 'Try again') + '</span>';
      r.addEventListener('click', function () { refresh(true); });
      card.appendChild(r);
    } else {
      card.innerHTML = logo +
        '<h1 class="sg-title" id="sg-title">' + gbi('برای ادامه وارد شو', 'Sign in to continue') + '</h1>' +
        '<p class="sg-desc">' + gbi('برای استفاده از Subify باید با Google یا GitHub وارد شوی. ثبت‌نام همان لحظه انجام می‌شود.', 'You need to sign in with Google or GitHub to use Subify. Your account is created on the spot.') + '</p>' +
        (state && state.trial ? '<p class="sg-desc">' + gbi('ده منبع رایگان بدون ورود استفاده شد.', 'The 10 free sources without sign-in are used up.') + '</p>' : '') +
        '<div id="sg-notice"></div><div class="sg-actions"></div>' +
        '<div class="sg-status" id="sg-status" role="status" aria-live="polite"></div>' +
        '<p class="sg-hint">' + gbi('ورود در تب جدید باز می‌شود. بعد از پایان، این‌جا «وارد شدم» را بزن.', 'Sign-in opens in a new tab. When you are done, press “I’ve signed in” here.') + '</p>';
      var actions = card.querySelector('.sg-actions');
      loginButtons(state, actions, function () { gateWaiting = true; setStatus('waiting'); markCheckPrimary(); });
      var c = el('button', '');
      c.type = 'button';
      c.className = 'sg-btn sg-ghost';
      c.innerHTML = '<span class="sg-txt">' + gbi('وارد شدم؛ بررسی کن', "I've signed in (check)") + '</span>';
      c.addEventListener('click', function () {
        c.disabled = true;
        setStatus('checking');
        refresh(true).then(function () {
          var b = document.querySelector('#subify-gate .sg-ghost'); if (b) b.disabled = false;
          setStatus(gateWaiting ? 'waiting' : '');
        });
      });
      actions.appendChild(c);
      if (gateWaiting) { setStatus('waiting'); markCheckPrimary(); }
    }
    wallEl.appendChild(card);
    document.body.appendChild(wallEl);
    if (!(state && state.offline)) showSignInNotice();
    timer = setInterval(function () { refresh(true); }, 4000);
  }

  /* --------------------------------------------------------- popup account bar */
  function popupBar(user) {
    // Signed in: the account is a round icon button in the popup header, next to the theme switch.
    // The old text bar (name + "پنل کاربری") is gone.
    if (bar) { bar.remove(); bar = null; }
    popupAccountButton('حساب من / My account');
  }
  // Signed out during the trial: the same button, its tooltip says how many free videos are left.
  function popupGuestButton(trial) {
    var used = Number(trial.used) || 0, max = Number(trial.max) || 10;
    popupAccountButton('ورود اختیاری: ' + used + ' از ' + max + ' ویدیوی رایگان استفاده شده / Optional sign-in: ' + used + ' of ' + max + ' free videos used');
  }
  function popupAccountButton(title) {
    var existing = document.getElementById('subify-account-btn');
    if (existing) { existing.title = title; existing.setAttribute('aria-label', title); return; }
    var theme = document.querySelector('.theme-toggle') || document.getElementById('themeToggle');
    var host = theme ? theme.parentNode : document.querySelector('.header-actions');
    if (!host) return;
    var b = document.createElement('button');
    b.id = 'subify-account-btn';
    b.type = 'button';
    b.className = 'icon-btn';
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
    b.addEventListener('click', function () {
      var u = api.runtime.getURL ? api.runtime.getURL('options.html') : 'options.html';
      if (api.tabs && api.tabs.create) api.tabs.create({ url: u }); else window.open(u, '_blank');
    });
    if (theme) host.insertBefore(b, theme.nextSibling); else host.appendChild(b);
  }

  /* ------------------------------------------------------------ options: panel */
  /* The options page is a management panel: the account card lives in its fixed "حساب من" section
     and the connection status in the "افزونه" section. The page's other sections are not moved. */
  var panelKey = '';
  function panelHost() { return document.getElementById('sfy-account-host'); }
  function clearAccountHost() { var h = panelHost(); if (h) h.innerHTML = ''; panelKey = ''; }
  /** both languages on one line (pills and badges) */
  function inl(fa, en) { return '<span data-subify-keep-fa>' + esc(fa) + '</span> · <span dir="ltr" data-subify-i18n-ignore>' + esc(en) + '</span>'; }
  function card(inner) { return el('div', 'padding:14px;border-radius:16px;border:1px solid rgba(124,92,255,.35);background:rgba(124,92,255,.07);margin:0 0 12px'); }

  var TILE_CSS = 'min-height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.035);color:inherit;font:inherit;font-size:12px;cursor:pointer;padding:6px 8px;line-height:1.45;min-width:0';
  function providerLabel(p) { return p === 'github' ? 'GitHub' : (p === 'google' ? 'Google' : ''); }
  function renderPanel(user) {
    var host = panelHost(); if (!host) return;
    // Re-render only when the account changes: a refresh on focus must not wipe a ticket that is being typed.
    var key = String(user.id || '') + '|' + String(user.email || '');
    if (key === panelKey && host.firstChild) return;
    panelKey = key;
    host.innerHTML = '';
    var prov = providerLabel(user.provider);
    var head = card();
    head.style.cssText = 'padding:18px;border-radius:20px;border:1px solid var(--border);background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.018));margin:0 0 12px;min-width:0';
    head.innerHTML = '<div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;min-width:0">' +
      '<div style="flex:none;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#7c5cff,#58d8ff);color:#fff;display:grid;place-items:center;font-weight:700;font-size:18px">' + esc((user.name || user.email || '?').charAt(0).toUpperCase()) + '</div>' +
      '<div style="min-width:0;flex:1">' +
        '<b style="display:block;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(user.name || user.email) + '</b>' +
        '<span dir="ltr" style="display:block;font-size:11.5px;opacity:.7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:start">' + esc(user.email) + '</span>' +
        '<span style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">' +
          '<span class="sfy-pill ok" style="font-size:10px">' + inl('حساب فعال', 'Active account') + '</span>' +
          (prov ? '<span class="sfy-pill" style="font-size:10px">' + inl('ورود با ' + prov, 'Signed in with ' + prov) + '</span>' : '') +
        '</span>' +
      '</div></div>';
    var tiles = el('div', 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px');
    [['tickets', bi('تیکت‌های من', 'My tickets', true)], ['new', bi('تیکت جدید', 'New ticket', true)], ['out', bi('خروج', 'Sign out', true)]].forEach(function (x) {
      var b = el('button', TILE_CSS, x[1]);
      b.type = 'button';
      b.addEventListener('click', function () {
        if (x[0] === 'out') { ask('subify-auth-logout').then(function (s) { apply(s); }); return; }
        view = x[0] === 'new' ? { name: 'new' } : { name: 'list' }; renderView();
      });
      tiles.appendChild(b);
    });
    var links = el('div', 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:8px 0 14px');
    [['#statistics', bi('آمار من', 'My statistics', true)], ['#settings', bi('تنظیمات', 'Settings', true)], ['#learning', bi('یادگیری', 'Learning', true)]].forEach(function (x) {
      var b = el('button', TILE_CSS, x[1]);
      b.type = 'button';
      b.addEventListener('click', function () { location.hash = x[0].slice(1); });
      links.appendChild(b);
    });
    head.appendChild(tiles);
    head.appendChild(links);
    host.appendChild(head);
    var body = el('div', ''); body.id = 'subify-panel-body'; host.appendChild(body);
    renderView();
  }

  function setBody(html, node) {
    var body = document.getElementById('subify-panel-body'); if (!body) return null;
    body.innerHTML = html || ''; if (node) body.appendChild(node); return body;
  }
  var CAT = [['account', 'حساب کاربری', 'Account'], ['payment', 'پرداخت', 'Payment'], ['technical', 'خطا / فنی', 'Technical'], ['translation', 'ترجمه', 'Translation'], ['dub', 'دوبله / Live', 'Dub / Live'], ['bug', 'گزارش باگ', 'Bug report'], ['other', 'سایر', 'Other']];
  function catLabel(k) { for (var i = 0; i < CAT.length; i++) if (CAT[i][0] === k) return bi(CAT[i][1], CAT[i][2], true); return esc(k); }
  var ERR = { auth: ['لطفاً دوباره وارد شو', 'Please sign in again'], network: ['اتصال برقرار نشد', 'Connection failed'], rate: ['تعداد درخواست زیاد است؛ کمی بعد', 'Too many requests (try later)'], too_many_open: ['حداکثر ۵ تیکت باز داری؛ یکی را ببند', 'You can have 5 open tickets; close one first'], subject: ['موضوع را کامل‌تر بنویس (حداقل ۳ حرف)', 'Write a longer subject (at least 3 characters)'], body: ['متن را کامل‌تر بنویس', 'Write a little more detail'], server: ['خطای سرور؛ دوباره امتحان کن', 'Server error (try again)'] };
  function errText(code) { var e = ERR[code] || ERR.server; return bi(e[0], e[1], true); }

  function renderView() {
    if (!document.getElementById('subify-panel-body')) return;
    if (view.name === 'list') return showList();
    if (view.name === 'new') return showNew();
    if (view.name === 'thread') return showThread(view.id);
  }
  function showList() {
    setBody('<div style="font-size:12px;opacity:.7;padding:8px 0">' + bi('در حال بارگذاری…', 'Loading…', true) + '</div>');
    ask('subify-tickets-list').then(function (r) {
      if (!r || !r.ok) { setBody('<div style="color:#ff9aa8;font-size:12px;padding:6px 0">' + errText(r && r.error) + '</div>'); return; }
      var html = '<div style="font-size:12.5px;font-weight:700;margin:8px 0 6px">' + bi('تیکت‌های من', 'My tickets', true) + '</div>';
      var list = Array.isArray(r.tickets) ? r.tickets : [];
      if (!list.length) html += '<div style="font-size:12px;opacity:.75;line-height:1.9;padding:6px 0">' + bi('هنوز تیکتی نداری. اگر مشکلی داری، «تیکت جدید» را بزن.', "You have no tickets yet. If something is wrong, press “New ticket”.", true) + '</div>';
      setBody(html);
      var body = document.getElementById('subify-panel-body');
      list.forEach(function (t) {
        var b = el('button', 'display:block;width:100%;text-align:start;padding:10px 12px;margin:0 0 7px;border-radius:12px;border:1px solid rgba(255,255,255,.15);background:transparent;color:inherit;font:inherit;cursor:pointer');
        b.type = 'button';
        b.innerHTML = '<span style="display:block;font-weight:700;font-size:13px">' + (t.unread ? '● ' : '') + esc(t.subject) + '</span>' +
          '<span style="display:flex;gap:6px;flex-wrap:wrap;margin-top:5px;font-size:10.5px;opacity:.8">' +
          '<span>' + (t.status === 'closed' ? bi('بسته', 'Closed', true) : bi('باز', 'Open', true)) + '</span>' +
          '<span>' + catLabel(t.category).replace(/<span dir="ltr"[^>]*>/, '').replace('</span>', '') + '</span>' +
          '<span dir="ltr">' + new Date(t.updatedAt * 1000).toISOString().slice(0, 10) + '</span></span>';
        b.addEventListener('click', function () { view = { name: 'thread', id: t.id }; renderView(); });
        body.appendChild(b);
      });
    });
  }
  function showNew() {
    var f = el('div', '');
    f.innerHTML = '<div style="font-size:12.5px;font-weight:700;margin:8px 0 8px">' + bi('تیکت جدید', 'New ticket', true) + '</div>' +
      '<label style="display:block;font-size:11.5px;margin:0 0 4px">' + bi('دسته‌بندی', 'Category', true) + '</label>' +
      '<select id="sfyTkCat" style="width:100%;height:38px;border-radius:10px;margin-bottom:10px;padding:0 8px;font:inherit;font-size:12.5px">' +
      CAT.map(function (c) { return '<option value="' + c[0] + '">' + esc(c[1]) + ' · ' + esc(c[2]) + '</option>'; }).join('') + '</select>' +
      '<label style="display:block;font-size:11.5px;margin:0 0 4px">' + bi('موضوع', 'Subject', true) + '</label>' +
      '<input id="sfyTkSub" maxlength="120" style="width:100%;height:38px;border-radius:10px;margin-bottom:10px;padding:0 10px;font:inherit;font-size:12.5px">' +
      '<label style="display:block;font-size:11.5px;margin:0 0 4px">' + bi('شرح مشکل', 'Details', true) + '</label>' +
      '<textarea id="sfyTkBody" maxlength="4000" rows="6" style="width:100%;border-radius:10px;padding:9px 10px;font:inherit;font-size:12.5px;resize:vertical"></textarea>' +
      '<div id="sfyTkErr" style="color:#ff9aa8;font-size:12px;margin:8px 0 0"></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px"><button id="sfyTkSend" type="button" style="' + btnCss(true).replace('width:100%;', 'flex:1;') + '">' + bi('ارسال تیکت', 'Send ticket') + '</button></div>';
    setBody('', f);
    f.querySelector('#sfyTkSend').addEventListener('click', function () {
      var sub = f.querySelector('#sfyTkSub').value.trim(), txt = f.querySelector('#sfyTkBody').value.trim(), cat = f.querySelector('#sfyTkCat').value;
      var err = f.querySelector('#sfyTkErr'); err.innerHTML = '';
      if (sub.length < 3) { err.innerHTML = errText('subject'); return; }
      if (txt.length < 5) { err.innerHTML = errText('body'); return; }
      if (busy) return; busy = true;
      ask('subify-tickets-create', { subject: sub, category: cat, body: txt }).then(function (r) {
        busy = false;
        if (!r || !r.ok) { err.innerHTML = errText(r && r.error); return; }
        view = { name: 'thread', id: r.id }; renderView();
      });
    });
  }
  function showThread(id) {
    setBody('<div style="font-size:12px;opacity:.7;padding:8px 0">' + bi('در حال بارگذاری…', 'Loading…', true) + '</div>');
    ask('subify-tickets-get', { id: id }).then(function (r) {
      if (!r || !r.ok) { setBody('<div style="color:#ff9aa8;font-size:12px">' + errText(r && r.error) + '</div>'); return; }
      var t = r.ticket;
      var html = '<button id="sfyTkBack" type="button" style="border:0;background:none;color:inherit;font:inherit;font-size:12px;padding:6px 0;cursor:pointer;text-decoration:underline">' + bi('← همه تیکت‌ها', '← All tickets', true) + '</button>' +
        '<div style="font-size:13.5px;font-weight:700;margin:4px 0 2px">' + esc(t.subject) + '</div>' +
        '<div style="font-size:11px;opacity:.7;margin-bottom:10px">' + catLabel(t.category).replace('</span>', '</span>') + ' · ' + (t.status === 'closed' ? bi('بسته', 'Closed', true) : bi('باز', 'Open', true)) + '</div>';
      r.messages.forEach(function (m) {
        var mine = m.author === 'user';
        html += '<div style="margin:0 0 8px;padding:9px 11px;border-radius:12px;background:' + (mine ? 'rgba(255,255,255,.06)' : 'rgba(124,92,255,.14)') + ';margin-' + (mine ? 'inline-start' : 'inline-end') + ':18px">' +
          '<div style="font-size:10.5px;opacity:.7;margin-bottom:4px">' + (mine ? bi('شما', 'You', true) : bi('تیم Subify', 'Subify team', true)) + ' · <span dir="ltr">' + new Date(m.createdAt * 1000).toISOString().slice(0, 16).replace('T', ' ') + '</span></div>' +
          '<div style="font-size:12.5px;line-height:1.9;white-space:pre-wrap">' + esc(m.body) + '</div></div>';
      });
      html += '<textarea id="sfyTkReply" maxlength="4000" rows="3" placeholder="پاسخ / Reply" style="width:100%;border-radius:10px;padding:9px 10px;font:inherit;font-size:12.5px;margin-top:6px;resize:vertical"></textarea>' +
        '<div id="sfyTkErr" style="color:#ff9aa8;font-size:12px;min-height:14px;margin:4px 0"></div>' +
        '<button id="sfyTkSendReply" type="button" style="' + btnCss(true) + '">' + bi('ارسال پاسخ', 'Send reply') + '</button>';
      var node = el('div', ''); node.innerHTML = html; setBody('', node);
      node.querySelector('#sfyTkBack').addEventListener('click', function () { view = { name: 'list' }; renderView(); });
      node.querySelector('#sfyTkSendReply').addEventListener('click', function () {
        var txt = node.querySelector('#sfyTkReply').value.trim(); var err = node.querySelector('#sfyTkErr');
        if (txt.length < 1) { err.innerHTML = errText('body'); return; }
        if (busy) return; busy = true;
        ask('subify-tickets-reply', { id: id, body: txt }).then(function (rr) { busy = false; if (!rr || !rr.ok) { err.innerHTML = errText(rr && rr.error); return; } showThread(id); });
      });
    });
  }

  /* ------------------------------------------------------ options: signed out */
  function signedOutCard(state) {
    var host = panelHost(); if (!host) return;
    host.innerHTML = '';
    var c = card();
    c.innerHTML = '<div style="font-size:14px;font-weight:700;margin-bottom:4px">' + bi('حساب Subify', 'Subify account') + '</div>' +
      '<div style="font-size:12px;line-height:1.9;opacity:.8;margin-bottom:10px">' + bi('با حساب وارد شو تا تیکت پشتیبانی ثبت کنی و همگام‌سازی لغت‌ها فعال شود. ورود اختیاری است.', 'Sign in to open support tickets and sync your words. Sign-in is optional.', true) + '</div>';
    if (state && (state.providers && (state.providers.google || state.providers.github))) loginButtons(state, c);
    else c.appendChild(el('div', 'font-size:12px;opacity:.7', bi('ورود فعلاً فعال نیست.', 'Sign-in is not available right now.', true)));
    host.appendChild(c);
  }

  /* ------------------------------------------------------------- state machine */
  function apply(state) {
    if (!state) return;
    lastUser = state.user || null;
    // no-sign-in trial: while the first 10 videos are free, the wall stays down for this video
    var trialOpen = !!(state.trial && state.trial.allowed);
    if (state.required && !state.user && !trialOpen) {
      if (IS_OPTIONS) clearAccountHost();
      if (bar) { bar.remove(); bar = null; }
      var accBtn = document.getElementById('subify-account-btn'); if (accBtn) accBtn.remove();
      if (wallEl && gateSig === gateSignature(state)) return; // same screen: keep it (no flicker, no lost focus)
      wall(state); return;
    }
    removeWall();
    if (IS_OPTIONS) {
      if (state.user) renderPanel(state.user); else { panelKey = ''; signedOutCard(state); }
      renderExtStatus(state);
      // the dashboard (options.js) listens for this and shows the same state without asking again
      document.dispatchEvent(new CustomEvent('subify-auth-state', { detail: state }));
    } else if (state.user) {
      popupBar(state.user);
    } else if (state.required && state.trial) {
      popupGuestButton(state.trial);
    }
  }
  /* Connection rows for the "افزونه" section (one status per line, with a pill). */
  function renderExtStatus(state) {
    var host = document.getElementById('sfy-ext-status'); if (!host || !state) return;
    function row(label, cls, pill) {
      return '<div class="sfy-status-row"><span>' + label + '</span><span class="sfy-pill' + (cls ? ' ' + cls : '') + '">' + pill + '</span></div>';
    }
    var html = row(bi('اتصال به sub-ify.site', 'Connection to sub-ify.site', true), state.offline ? 'bad' : 'ok', state.offline ? inl('برقرار نشد', 'failed') : inl('برقرار', 'ok'));
    if (!state.offline) {
      html += row(bi('ثبت‌نام', 'Sign-up', true), '', state.open ? inl('روشن', 'on') : inl('خاموش', 'off'));
      html += row(bi('ورود اجباری', 'Login required', true), '', state.required ? inl('روشن', 'on') : inl('خاموش', 'off'));
    }
    host.innerHTML = html;
  }

  function refresh(force) { return ask('subify-auth-status', { force: !!force }).then(apply); }

  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(true); });
  window.addEventListener('focus', function () { refresh(true); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { refresh(false); }); else refresh(false);
})();
