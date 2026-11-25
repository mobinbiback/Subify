(() => {
  'use strict';
  if (window.__subifyTimedTextHookInstalled) return;
  window.__subifyTimedTextHookInstalled = true;
  // Lets the isolated-world overlay see that this MAIN-world hook is running (the two worlds share no JS globals).
  document.documentElement?.setAttribute('data-subify-hook', '1');

  const seen = new Set();

  const isTimedText = (raw) => {
    try {
      const u = new URL(String(raw), location.href);
      return u.hostname.endsWith('youtube.com') && u.pathname === '/api/timedtext';
    } catch (_) { return false; }
  };

  // Udemy renders captions purely client-side into an on-screen div, with no
  // native <track>/TextTrack and no timed data anywhere in the page's own
  // DOM (its "Transcript" sidebar has text but no timestamps at all). The
  // only place real per-cue timing exists is the actual .vtt file Udemy's
  // player fetches from its CDN once captions are turned on — a signed URL
  // on a CDN host that rotates, so match by the .vtt extension instead of a
  // hostname.
  const isUdemyVtt = (raw) => {
    try {
      if (!location.hostname.endsWith('udemy.com')) return false;
      const u = new URL(String(raw), location.href);
      return /\.vtt(?:[?#]|$)/i.test(u.pathname);
    } catch (_) { return false; }
  };

  const currentUdemyLectureId = () => {
    const m = location.pathname.match(/\/lecture\/(\d+)/);
    return m ? m[1] : '';
  };

  const emitUdemyVtt = (raw) => {
    if (!isUdemyVtt(raw)) return;
    try {
      const u = new URL(String(raw), location.href);
      const url = u.href;
      if (seen.has(url)) return;
      seen.add(url);
      if (seen.size > 80) {
        const first = seen.values().next().value;
        if (first) seen.delete(first);
      }
      const detail = JSON.stringify({ url, lectureId: currentUdemyLectureId() });
      window.dispatchEvent(new CustomEvent('subify-udemy-caption-url', { detail }));
    } catch (_) {}
  };

  const currentVideoId = () => {
    try { return new URL(location.href).searchParams.get('v') || ''; } catch (_) { return ''; }
  };

  const emit = (raw) => {
    emitUdemyVtt(raw);
    if (!isTimedText(raw)) return;
    try {
      const u = new URL(String(raw), location.href);
      // Only keep YouTube's original/source caption request. Auto-translation
      // requests contain tlang and are not the source track Subify translates.
      if (u.searchParams.has('tlang')) return;

      const url = u.href;
      const videoId = u.searchParams.get('v') || currentVideoId();
      if (!videoId) return;

      // The same timedtext URL can be visible through both the network hook and
      // Resource Timing. Deduplicate it, but still allow a new signed URL after
      // refresh/navigation.
      if (seen.has(url)) return;
      seen.add(url);
      if (seen.size > 80) {
        const first = seen.values().next().value;
        if (first) seen.delete(first);
      }

      const detail = JSON.stringify({
        url,
        lang: u.searchParams.get('lang') || '',
        kind: u.searchParams.get('kind') || '',
        videoId
      });

      // Content scripts run at document_idle, while YouTube may request the
      // captions much earlier. Keep the newest valid request available for the
      // content script to consume when it initializes.
      window.__subifyLastTimedText = detail;
      window.dispatchEvent(new CustomEvent('subify-youtube-timedtext', { detail }));
    } catch (_) {}
  };

  // IMPORTANT: Do not rely only on monkey-patching fetch/XHR. Recent YouTube
  // player code can retain its own references before an extension replaces
  // these globals, so the player request may bypass our wrappers completely.
  // Resource Timing still exposes the actual /api/timedtext URL that reached
  // the browser, including the short-lived Proof-of-Origin parameters.
  const scanResourceTiming = () => {
    try {
      const entries = performance?.getEntriesByType?.('resource') || [];
      for (const entry of entries) emit(entry?.name || '');
    } catch (_) {}
  };

  const installResourceObserver = () => {
    try {
      if (typeof PerformanceObserver !== 'function') return;
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) emit(entry?.name || '');
      });
      observer.observe({ type: 'resource', buffered: true });
      window.__subifyTimedTextPerformanceObserver = observer;
    } catch (_) {
      // Older Chromium builds may not accept the `type` form. The periodic
      // resource scan below remains as the fallback.
    }
  };

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url, ...rest) {
    emit(url);
    return nativeOpen.call(this, method, url, ...rest);
  };

  // v2.12.2: caption tracks of the player answers (/youtubei/v1/player), kept per video id. An answer is used only when its own
  // videoDetails.videoId is the video in the address bar, so an ad's answer can never be taken for the main video's.
  const playerAnswers = new Map();
  const rememberPlayerAnswer = (j) => {
    try {
      const vid = j?.videoDetails?.videoId;
      const tracks = j?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (!vid || !Array.isArray(tracks) || !tracks.length) return;
      playerAnswers.set(vid, tracks);
      if (playerAnswers.size > 12) playerAnswers.delete(playerAnswers.keys().next().value);
    } catch (_) {}
  };
  const isPlayerCall = (raw) => { try { return /\/youtubei\/v1\/player(?:[?#]|$)/.test(new URL(String(raw), location.href).pathname + '?'); } catch (_) { return false; } };

  const nativeFetch = window.fetch;
  window.fetch = function(input, init) {
    let raw = '';
    try {
      raw = typeof input === 'string' || input instanceof URL ? input : input?.url;
      emit(raw);
    } catch (_) {}
    const p = nativeFetch.call(this, input, init);
    try {
      if (isPlayerCall(raw)) p.then((res) => { try { res.clone().json().then(rememberPlayerAnswer).catch(() => {}); } catch (_) {} }, () => {});
    } catch (_) {}
    return p;
  };

  // Let the isolated-world content script request a caption reload without
  // touching YouTube's visible CC button. This is materially more reliable
  // than an off -> on DOM click cycle when YouTube restored CC=ON after a
  // refresh but did not rebuild the caption request.
  const normalizeTrackForPlayer = (track) => {
    if (!track || typeof track !== 'object') return null;
    // YouTube's player API expects the caption-track descriptor, not the signed
    // baseUrl. Never pass the URL back into the player. The URL is only used by
    // the network-capture path after the player itself creates a fresh request.
    const out = {};
    for (const key of ['languageCode', 'vssId', 'kind', 'rtl', 'name']) {
      if (track[key] != null) out[key] = track[key];
    }
    if (!out.languageCode && !out.vssId && !out.kind) return null;
    return out;
  };

  const reloadCaptions = (hard = false, requestedTrack = null) => {
    try {
      const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (!player || typeof player.setOption !== 'function') return false;

      const track = normalizeTrackForPlayer(requestedTrack);

      // A plain `captions/reload` is not sufficient after a YouTube SPA/page
      // refresh when the captions module retained its previous state. In that
      // case YouTube can keep CC visually ON while never issuing a new
      // timedtext request. Reset the module, select the actual track again, and
      // only then ask the player to reload it. This mirrors the sequence used
      // by working YouTube subtitle extensions.
      if (hard) {
        try { player.unloadModule?.('captions'); } catch (_) {}
        try { player.loadModule?.('captions'); } catch (_) {}
      } else {
        try { player.loadModule?.('captions'); } catch (_) {}
      }

      if (track) {
        try { player.setOption('captions', 'track', track); } catch (_) {}
      }
      try { player.setOption('captions', 'reload', true); return true; } catch (_) {}

      // Some player builds accept the track only after a second module load.
      if (hard && track) {
        try { player.loadModule?.('captions'); } catch (_) {}
        try { player.setOption('captions', 'track', track); } catch (_) {}
        try { player.setOption('captions', 'reload', true); return true; } catch (_) {}
      }
    } catch (_) {}
    return false;
  };

  window.addEventListener('subify-youtube-reload-captions', (event) => {
    const hard = !!event?.detail?.hard;
    const requestedTrack = event?.detail?.track || null;
    reloadCaptions(hard, requestedTrack);
    // The player may create the caption request asynchronously. Give Resource
    // Timing another chance immediately after the reload command.
    setTimeout(scanResourceTiming, hard ? 450 : 250);
    setTimeout(scanResourceTiming, hard ? 1200 : 900);
  });

  // YouTube is an SPA. A fresh watch page and an in-place navigation both need
  // the same Resource Timing sweep.
  document.addEventListener('yt-navigate-finish', () => {
    seen.clear();
    setTimeout(scanResourceTiming, 0);
    setTimeout(scanResourceTiming, 500);
  }, true);

  // Answers the overlay's request for the player's own caption tracks. Runs in the MAIN world,
  // so movie_player.getPlayerResponse() is reachable. Replies inside dispatchEvent, so the caller
  // reads the answer synchronously. Ad responses are never returned.
  // v2.12.2: a strict chain, each source checked against the video id in the address bar (ad answers are never used):
  // 1) the /youtubei/v1/player answers seen on the wire, 2) movie_player.getPlayerResponse(), 3) window.ytInitialPlayerResponse
  // (a hard refresh, when no player request fires). Nothing is returned while an ad owns the player.
  const adActive = (player) => !!(player && player.classList && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting')));
  const slimTracks = (tracks) => (Array.isArray(tracks) ? tracks.filter(t => t && t.baseUrl).map(t => ({
    baseUrl: t.baseUrl, languageCode: t.languageCode || '', kind: t.kind || '', name: t.name || null, vssId: t.vssId || ''
  })) : []);
  window.addEventListener('subify-youtube-get-player-response', () => {
    let reply = { videoId: '', tracks: [] };
    try {
      const want = currentVideoId();
      const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
      if (!adActive(player)) {
        const sources = [
          () => (want && playerAnswers.has(want) ? { videoDetails: { videoId: want }, captions: { playerCaptionsTracklistRenderer: { captionTracks: playerAnswers.get(want) } } } : null),
          () => (player && typeof player.getPlayerResponse === 'function' ? player.getPlayerResponse() : null),
          () => window.ytInitialPlayerResponse || null
        ];
        for (const get of sources) {
          let resp = null;
          try { resp = get(); } catch (_) {}
          const vid = resp?.videoDetails?.videoId || '';
          if (!vid || (want && vid !== want)) continue;
          if (!reply.videoId) reply.videoId = vid;
          const tracks = slimTracks(resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks);
          if (tracks.length) { reply = { videoId: vid, tracks }; break; }
        }
      }
    } catch (_) {}
    window.dispatchEvent(new CustomEvent('subify-youtube-player-response', { detail: JSON.stringify(reply) }));
  });

  installResourceObserver();
  scanResourceTiming();
  // Small, low-frequency safety net. This is deliberately not a hot loop and
  // only scans the browser's already-recorded resource list.
  setInterval(scanResourceTiming, 1500);
})();
