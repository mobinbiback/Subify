(() => {
  if (window.__subifyPageTranslatorInstalled) return;
  const CORE = globalThis.SubifyPageTranslateCore; // page-translate-core.js is injected first
  if (!CORE) return;
  window.__subifyPageTranslatorInstalled = true;

  // Text nodes we changed: node -> the page's own text, and node -> the translation we wrote.
  const originals = new Map();
  const translated = new Map();
  const originalRootState = { dir: null, lang: null };
  let mode = null;        // { lang, font, auto } while a translation is on
  let generation = 0;     // bumped on restore; answers from an older generation are dropped
  let running = null;     // the scan in progress
  let again = false;      // a scan was asked for while one was running
  let paused = false;     // an error stops auto mode until the next page load
  let observer = null;
  let scanTimer = null;
  let routeTimer = null;
  let lastHref = location.href;

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // Text nodes that should be translated now. A node the page rewrote since we translated it is treated as new text.
  function collectTextNodes() {
    const out = [];
    const root = document.body || document.documentElement;
    if (!root) return out;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const value = String(node.nodeValue || '');
        if (translated.has(node)) {
          if (translated.get(node) === value) return NodeFilter.FILTER_REJECT;
          translated.delete(node);
          originals.delete(node);
        }
        if (CORE.shouldSkipText({ tag: p.tagName, inSkipAncestor: !!p.closest(CORE.SKIP_SELECTOR), text: value })) return NodeFilter.FILTER_REJECT;
        if (!isVisible(p)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let n;
    while ((n = walker.nextNode())) out.push(n);
    return out;
  }

  function fontUrl(name) {
    const map = {
      Vazirmatn: 'fonts/Vazirmatn-Regular.ttf',
      Estedad: 'fonts/Estedad-Medium.ttf',
      Lalezar: 'fonts/Lalezar-Regular.ttf',
      Sahel: 'fonts/Sahel-Bold.ttf',
      Arad: 'fonts/AradFD-Regular.woff2',
      Inter: 'fonts/Inter-400.woff2',
      Poppins: 'fonts/Poppins-500.woff2',
      Montserrat: 'fonts/Montserrat-500.woff2'
    };
    return map[name] || map.Vazirmatn;
  }

  function applyPageStyle(targetLanguage, font) {
    if (originalRootState.dir === null) originalRootState.dir = document.documentElement.getAttribute('dir');
    if (originalRootState.lang === null) originalRootState.lang = document.documentElement.getAttribute('lang');
    const rtl = /^(fa|ar|he|ur|ps|ku)\b/i.test(String(targetLanguage || ''));
    document.documentElement.dir = rtl ? 'rtl' : 'ltr';
    document.documentElement.lang = String(targetLanguage || 'en');
    document.documentElement.dataset.subifyTranslated = 'true';
    let style = document.getElementById('__subify_page_translation_style');
    if (!style) {
      style = document.createElement('style');
      style.id = '__subify_page_translation_style';
      style.setAttribute('data-subify-page-translator', 'true');
      (document.head || document.documentElement).appendChild(style);
    }
    const family = JSON.stringify(font || 'Vazirmatn');
    const url = browser.runtime.getURL(fontUrl(font || 'Vazirmatn'));
    style.textContent = `@font-face{font-family:"SubifyPageFont";src:url(${JSON.stringify(url)}) format("truetype");font-display:swap;}html[data-subify-translated="true"] body,html[data-subify-translated="true"] body *:not([data-subify-preserve-font]){font-family:"SubifyPageFont",${family},sans-serif!important;}/* alignment is intentionally NOT changed: the page keeps its own text-align (e.g. justify) after translation */`;
  }

  // Puts every changed text node back, unless the page has written new text into it since.
  function restoreTexts() {
    generation++;
    for (const [node, text] of originals) {
      if (node && node.isConnected && translated.get(node) === node.nodeValue) node.nodeValue = text;
    }
    originals.clear();
    translated.clear();
  }

  // Sign-in prompt, shown when login is required and the free sources are used up (background.js refuses the batch).
  // It blocks the page until the learner signs in. The texts follow the extension's UI language (saved by ui-language.js).
  const GATE_TEXT = {
    fa: { title: 'برای ادامه وارد شو', desc: 'ده منبع رایگان بدون ورود استفاده شد. برای ادامهٔ ترجمهٔ صفحه‌ها وارد شو.', google: 'ورود با Google', github: 'ورود با GitHub', check: 'وارد شدم، ادامه بده' },
    en: { title: 'Sign in to continue', desc: 'The 10 free sources without sign-in are used up. Sign in to keep translating pages.', google: 'Sign in with Google', github: 'Sign in with GitHub', check: "I've signed in, continue" },
    ar: { title: 'سجّل الدخول للمتابعة', desc: 'انتهت المصادر العشرة المجانية بدون تسجيل الدخول. سجّل الدخول لمتابعة ترجمة الصفحات.', google: 'تسجيل الدخول بـ Google', github: 'تسجيل الدخول بـ GitHub', check: 'سجّلت الدخول، تابِع' },
    es: { title: 'Inicia sesión para continuar', desc: 'Se acabaron las 10 fuentes gratuitas sin iniciar sesión. Inicia sesión para seguir traduciendo páginas.', google: 'Iniciar sesión con Google', github: 'Iniciar sesión con GitHub', check: 'Ya inicié sesión, continuar' },
    tr: { title: 'Devam etmek için giriş yap', desc: 'Giriş yapmadan kullanılabilen 10 ücretsiz kaynak bitti. Sayfa çevirisine devam etmek için giriş yap.', google: 'Google ile giriş yap', github: 'GitHub ile giriş yap', check: 'Giriş yaptım, devam et' },
    fr: { title: 'Connectez-vous pour continuer', desc: 'Les 10 sources gratuites sans connexion sont épuisées. Connectez-vous pour continuer à traduire les pages.', google: 'Se connecter avec Google', github: 'Se connecter avec GitHub', check: "Je me suis connecté, continuer" },
    de: { title: 'Zum Weitermachen anmelden', desc: 'Die 10 kostenlosen Quellen ohne Anmeldung sind aufgebraucht. Melde dich an, um Seiten weiter zu übersetzen.', google: 'Mit Google anmelden', github: 'Mit GitHub anmelden', check: 'Ich bin angemeldet, weiter' }
  };
  async function showSignInGate() {
    if (document.getElementById('__subify_page_gate')) return;
    let lang = 'fa';
    try { const r = await browser.storage.local.get('subify_popup_language'); if (GATE_TEXT[r?.subify_popup_language]) lang = r.subify_popup_language; } catch (e) {}
    const t = GATE_TEXT[lang];
    const box = document.createElement('div');
    box.id = '__subify_page_gate';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-modal', 'true');
    box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(7,10,16,.72);font-family:Vazirmatn,system-ui,sans-serif';
    const card = document.createElement('div');
    card.style.cssText = 'width:min(340px,100%);padding:18px 18px 14px;border-radius:16px;background:#0b0f17;color:#eef1f8;border:1px solid rgba(124,92,255,.5);box-shadow:0 18px 60px rgba(0,0,0,.6);text-align:center;direction:' + (lang === 'fa' || lang === 'ar' ? 'rtl' : 'ltr');
    const btn = 'display:block;width:100%;height:40px;margin:0 0 8px;border-radius:11px;border:1px solid #2a3447;background:#111621;color:#eef1f8;font-weight:700;font-size:13px;font-family:inherit;cursor:pointer';
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:700;font-size:15px;margin-bottom:6px';
    title.textContent = t.title;
    const desc = document.createElement('div');
    desc.style.cssText = 'font-size:12px;opacity:.75;line-height:1.8;margin-bottom:12px';
    desc.textContent = t.desc;
    card.append(title, desc);
    [['google', t.google], ['github', t.github]].forEach(([provider, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.cssText = btn;
      b.textContent = label;
      b.addEventListener('click', () => { browser.runtime.sendMessage({ type: 'subify-auth-open', provider }).catch(() => {}); });
      card.appendChild(b);
    });
    const check = document.createElement('button');
    check.type = 'button';
    check.style.cssText = btn.replace('#111621', 'transparent');
    check.textContent = t.check;
    check.addEventListener('click', async () => {
      try {
        const st = await browser.runtime.sendMessage({ type: 'subify-auth-status', force: true });
        if (!st || (st.required && !st.user && !(st.trial && st.trial.allowed))) return;
        box.remove();
        paused = false;
        if (mode) scan().catch(() => { paused = true; });
      } catch (e) { /* background not reachable: the prompt stays */ }
    });
    card.appendChild(check);
    box.appendChild(card);
    (document.body || document.documentElement).appendChild(box);
  }

  async function translateBatch(batch, lang) {
    const r = await browser.runtime.sendMessage({ type: 'subify-page-translate', texts: batch, targetLanguage: lang });
    if (r?.authRequired) {
      void showSignInGate();
      throw new Error(r.error || 'Sign-in required');
    }
    if (!r?.ok) throw new Error(r?.error || 'Page translation failed');
    return Array.isArray(r.results) ? r.results : [];
  }

  async function translateNodes(nodes, gen, lang) {
    const items = nodes.map((node, i) => ({ id: String(i), text: CORE.normalize(node.nodeValue) }));
    let count = 0;
    for (const batch of CORE.batchTexts(items)) {
      if (gen !== generation) break;
      const results = await translateBatch(batch, lang);
      if (gen !== generation) break;
      const byId = new Map(results.map((x) => [String(x.id), String(x.text ?? x.translation ?? '').trim()]));
      for (const item of batch) {
        const node = nodes[Number(item.id)];
        const out = byId.get(item.id);
        if (!out || !node || !node.isConnected || CORE.normalize(node.nodeValue) !== item.text) continue;
        const raw = String(node.nodeValue);
        const value = raw.match(/^\s*/)[0] + out + raw.match(/\s*$/)[0];
        originals.set(node, raw);
        translated.set(node, value);
        node.nodeValue = value;
        count++;
      }
    }
    return count;
  }

  // One pass over the page. Calls made while a pass runs are folded into one more pass.
  function scan() {
    if (!mode || paused) return Promise.resolve(0);
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      let total = 0;
      try {
        do {
          again = false;
          if (!mode) break;
          total += await translateNodes(collectTextNodes(), generation, mode.lang);
        } while (again && mode);
      } finally {
        running = null;
      }
      return total;
    })();
    return running;
  }

  function scheduleScan(ms) {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scan().catch(() => { paused = true; });
    }, ms);
  }

  function checkRoute() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    scheduleScan(0);
  }

  // Auto mode only: watch for new text and for route changes inside the page.
  // A content script cannot see the page's own history.pushState calls, so the URL is checked on a timer and on popstate.
  function watch() {
    if (!observer && document.body) {
      observer = new MutationObserver(() => scheduleScan(400));
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    if (!routeTimer) {
      routeTimer = setInterval(checkRoute, 700);
      window.addEventListener('popstate', checkRoute);
      window.addEventListener('hashchange', checkRoute);
    }
  }

  async function start(lang, font, auto) {
    const target = String(lang || 'fa');
    if (mode && mode.lang !== target) restoreTexts();
    mode = { lang: target, font: font || 'Vazirmatn', auto: !!auto || !!(mode && mode.auto) };
    paused = false;
    applyPageStyle(target, mode.font);
    if (mode.auto) watch();
    if (running) await running.catch(() => {}); // let a pass for the old language end first
    try {
      const count = await scan();
      return { ok: true, count };
    } catch (e) {
      if (mode.auto) paused = true;
      return { ok: false, error: String(e.message || e) };
    }
  }

  async function restore() {
    mode = null;
    paused = false;
    clearTimeout(scanTimer);
    observer?.disconnect();
    observer = null;
    if (routeTimer) clearInterval(routeTimer);
    routeTimer = null;
    window.removeEventListener('popstate', checkRoute);
    window.removeEventListener('hashchange', checkRoute);
    restoreTexts();
    document.getElementById('__subify_page_gate')?.remove();
    document.documentElement.removeAttribute('data-subify-translated');
    if (originalRootState.dir === null) document.documentElement.removeAttribute('dir');
    else document.documentElement.setAttribute('dir', originalRootState.dir);
    if (originalRootState.lang === null) document.documentElement.removeAttribute('lang');
    else document.documentElement.setAttribute('lang', originalRootState.lang);
    originalRootState.dir = null;
    originalRootState.lang = null;
    document.getElementById('__subify_page_translation_style')?.remove();
    return { ok: true };
  }

  browser.runtime.onMessage.addListener(msg => {
    if (msg?.type === 'subify-page-translate-start') return start(msg.targetLanguage || 'fa', msg.font || 'Vazirmatn', msg.auto === true);
    if (msg?.type === 'subify-page-translate-restore') return restore();
  });
})();
