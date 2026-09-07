
const __sby_p = (() => {
  const a = [77,111,98,105,110,98,105,98,97,107];
  return Object.freeze({
    id: a.map((n,i) => String.fromCharCode(n ^ 0)).join(''),
    stamp: 'subify-provenance-v2416'
  });
})();
(() => {
  'use strict';
  const id = 'subify-page-hook';
  if (document.getElementById(id)) return;
  const s = document.createElement('script');
  s.id = id;
  s.src = chrome.runtime.getURL('page-hook.js');
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
})();
