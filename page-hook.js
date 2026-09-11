
(() => {
  'use strict';
  if (window.__subifyTimedTextHookInstalled) return;
  window.__subifyTimedTextHookInstalled = true;

  const isTimedText = (raw) => {
    try {
      const u = new URL(String(raw), location.href);
      return u.hostname.endsWith('youtube.com') && u.pathname === '/api/timedtext';
    } catch (_) { return false; }
  };

  const emit = (raw) => {
    if (!isTimedText(raw)) return;
    try {
      const u = new URL(String(raw), location.href);
      // Keep only the original/source track. `tlang` is YouTube's translated
      // track. More importantly, only accept the URL that the YouTube player
      // itself minted with a Proof-of-Origin token. Token-less timedtext URLs
      // often return HTTP 200 with an empty body. Subify uses the same reliable
      // strategy to obtain the authoritative, fully timed caption file.
      if (u.searchParams.has('tlang')) return;
      window.dispatchEvent(new CustomEvent('subify-youtube-timedtext', {
        detail: JSON.stringify({
          url: u.href,
          lang: u.searchParams.get('lang') || '',
          kind: u.searchParams.get('kind') || ''
        })
      }));
    } catch (_) {}
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    emit(url);
    return nativeOpen.call(this, method, url, ...rest);
  };

  const nativeFetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      const raw = typeof input === 'string' || input instanceof URL ? input : input?.url;
      emit(raw);
    } catch (_) {}
    return nativeFetch.call(this, input, init);
  };
})();
