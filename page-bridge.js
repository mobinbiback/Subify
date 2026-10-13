var browser = globalThis.browser || globalThis.chrome; // Chrome has no browser global; same APIs live on chrome.*

(() => {
  'use strict';
  const id = 'subify-page-hook';
  if (document.getElementById(id)) return;
  const s = document.createElement('script');
  s.id = id;
  s.src = browser.runtime.getURL('page-hook.js');
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
})();
