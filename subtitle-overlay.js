
(() => {
  "use strict";

  // Subify subtitle engine.
  // Architecture uses YouTube's own timed-caption pipeline:
  // 1) discover captionTracks from the YouTube player response/watch page,
  // 2) fetch one complete timed track, cache it, and
  // 3) render a separate Persian layer without replacing YouTube's native captions.

  const OVERLAY_ID = "subify-subtitle-overlay";
  const FONT_STYLE_ID = "subify-fonts";
  const DEFAULTS = {
    subtitleEnabled: true,
    font: "Lalezar",
    fontSize: 30,
    bgOpacity: 0.78,
    bottom: 11,
    sourceLanguage: "auto",
    alignUnderNative: true,
    displayMode: "translation",
    karaokeEnabled: true,
    preset: "pill",
    textColor: "#ffffff",
    highlightColor: "#FFB35C",
    bgColor: "#080A0E",
    maxWidth: 86,
    positionX: 50,
    positionY: 82,
    positionMode: "bottom",
    lineHeight: 1.42,
    outlineColor: "#000000",
    outlineWidth: 0,
    shadowColor: "#000000",
    shadowBlur: 7,
    borderRadius: 7,
    padding: 8,
    customWeight: 700
  };

  const state = {
    video: null,
    player: null,
    videoId: "",
    cues: [],
    translations: new Map(),
    translating: new Set(),
    translationQueueRunning: false,
    translationChain: Promise.resolve(),
    settings: { ...DEFAULTS },
    session: 0,
    trackKey: "",
    trackUrl: "",
    trackLanguage: "",
    trackCache: new Map(),
    fetching: false,
    lastShownId: "",
    lastUrl: location.href,
    lastScan: 0,
    lastPosition: 0,
    watchFetchPromise: null,
    lastTrackDiscoveryAttempt: 0,
    trackDiscoveryFailedAt: 0,
    capturedCaptionUrl: "",
    capturedCaptionLang: "",
    persistentCacheKey: "",
    persistentCacheLoaded: false,
    aheadPump: null,
    aheadBusy: false,
    videoSettingsLoaded: false,
    drag: null,
    nativeBottomOffset: null,
    karaokeRaf: 0,
    karaokeLead: 0.08
  };

  const clean = (s) => String(s ?? "")
    .replace(/<br\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim();

  const hash = (s) => {
    let h = 2166136261;
    const x = String(s);
    for (let i = 0; i < x.length; i++) h = Math.imul(h ^ x.charCodeAt(i), 16777619);
    return (h >>> 0).toString(16);
  };

  function log(...args) {
    try { console.debug("[subify]", ...args); } catch (_) {}
  }

  function installFonts() {
    if (document.getElementById(FONT_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = FONT_STYLE_ID;
    style.textContent = `@font-face{font-family:"Lalezar";src:url("${browser.runtime.getURL("fonts/Lalezar-Regular.ttf")}") format("truetype");font-weight:100 900;font-style:normal;font-display:swap;}`;
    document.documentElement.appendChild(style);
  }

  function getVideoIdFromUrl(url = location.href) {
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, "");
      if (host.includes("youtu.be")) return u.pathname.slice(1).split("/")[0] || "";
      if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) return u.searchParams.get("v") || "";
      if (host.endsWith("vimeo.com")) {
        // https://vimeo.com/123456789  or  https://player.vimeo.com/video/123456789
        const m = u.pathname.match(/(?:\/video\/)?(\d{6,})/);
        return m ? m[1] : "";
      }
      if (host.endsWith("aparat.com")) {
        // https://www.aparat.com/v/xxxxxxx
        const m = u.pathname.match(/\/v\/([a-zA-Z0-9]+)/);
        return m ? m[1] : "";
      }
      if (host.endsWith("coursera.org")) {
        // https://www.coursera.org/learn/<course>/lecture/<id>/<slug>
        const m = u.pathname.match(/\/lecture\/([a-zA-Z0-9]+)/);
        return m ? m[1] : u.pathname; // fall back to the path — still stable per-lecture
      }
      return "";
    } catch (_) { return ""; }
  }

  function getVideo() {
    const video = document.querySelector("video.html5-main-video, video.video-stream, video");
    if (video !== state.video) {
      state.video = video;
      let player = video?.closest(".html5-video-player") || document.querySelector(".html5-video-player") || null;
      if (!player && video) {
        // Generic (non-YouTube) host: no known player-chrome container, so mount
        // the overlay on the video's own parent instead. It needs to be a
        // positioning context for the overlay's `position:absolute; inset:0`
        // (see content.css) to line up with the video — force that only when
        // the site hasn't already made it one, so we don't disturb its layout.
        player = video.parentElement || video;
        if (player && getComputedStyle(player).position === "static") {
          player.style.position = "relative";
        }
      }
      state.player = player;
    }
    return video;
  }

  function resetTrack() {
    state.cues = [];
    state.translations.clear();
    state.translating.clear();
    state.translationQueueRunning = false;
    state.trackKey = "";
    state.trackUrl = "";
    state.trackLanguage = "";
    state.capturedCaptionUrl = "";
    state.capturedCaptionLang = "";
    state.persistentCacheKey = "";
    state.persistentCacheLoaded = false;
    if (state.aheadPump) { clearInterval(state.aheadPump); state.aheadPump = null; }
    state.aheadBusy = false;
    state.fetching = false;
    state.lastShownId = "";
    state.liveCandidate = null;
    clearTimeout(state.liveTimer);
    state.liveTimer = null;
    state.session++;
    if (state.karaokeRaf) { cancelAnimationFrame(state.karaokeRaf); state.karaokeRaf = 0; }
  }

  function getNativeSubtitleButton() {
    return state.player?.querySelector('.ytp-subtitles-button, button.ytp-subtitles-button') ||
      document.querySelector('.html5-video-player .ytp-subtitles-button');
  }

  function nativeSubtitlesOn() {
    const b = getNativeSubtitleButton();
    return !!b && b.getAttribute('aria-pressed') === 'true';
  }

  function handleCapturedTimedText(detail) {
    if (!detail || state.settings.subtitleEnabled === false) return;
    try {
      const data = typeof detail === 'string' ? JSON.parse(detail) : detail;
      const url = String(data?.url || '');
      if (!url || !url.includes('/api/timedtext')) return;
      if (/[?&]tlang=/.test(url)) return;
      state.capturedCaptionUrl = url;
      state.capturedCaptionLang = String(data?.lang || '');
      log(`captured YouTube timedtext (${state.capturedCaptionLang || 'auto'})`);
      void fetchCapturedTrack(url, state.session);
    } catch (_) {}
  }

  async function fetchCapturedTrack(url, session) {
    if (!url || session !== state.session) return;
    if (state.fetching) return;
    const cacheKey = url;
    const cached = state.trackCache.get(cacheKey);
    if (cached?.length) {
      state.cues = cached;
      state.trackKey = `${state.videoId}|captured|${url}`;
      state.trackUrl = url;
      state.trackLanguage = state.capturedCaptionLang || state.trackLanguage || '';
      await loadPersistentTranslations();
      const now = Number(state.video?.currentTime || 0);
      void queueTranslateAll(cached, session, now);
      return;
    }
    state.fetching = true;
    try {
      const res = await fetch(url, {
        credentials: 'include',
        cache: 'no-store',
        headers: { Accept: 'application/json, text/xml, text/vtt, */*' }
      });
      const body = await res.text();
      if (!res.ok || !body.trim()) throw new Error(`timedtext HTTP ${res.status}`);
      let cues = [];
      const trimmed = body.trim();
      if (trimmed.startsWith('{')) {
        try { cues = parseJson3(trimmed); } catch (_) {}
      }
      if (!cues.length && trimmed.startsWith('<')) {
        try { cues = parseXml(trimmed); } catch (_) {}
      }
      if (!cues.length && /^WEBVTT/i.test(trimmed)) {
        try { cues = parseVtt(trimmed); } catch (_) {}
      }
      if (!cues.length) throw new Error('timedtext returned no cues');
      if (session !== state.session) return;
      const key = `${state.videoId}|captured|${url}`;
      const old = new Map(state.translations);
      state.cues = cues;
      state.trackKey = key;
      state.trackUrl = url;
      state.trackLanguage = state.capturedCaptionLang || '';
      state.persistentCacheLoaded = false;
      state.translations.clear();
      for (const [id, fa] of old) if (cues.some(c => c.id === id)) state.translations.set(id, fa);
      state.trackCache.set(url, cues);
      await loadPersistentTranslations();
      log(`loaded ${cues.length} timedtext cues from YouTube`);
      void publishSubtitleCues();
      const now = Number(state.video?.currentTime || 0);
      void queueTranslateAll(cues, session, now);
    } catch (e) {
      log('captured timedtext fetch failed', e);
    }
  }

  function ensureOverlay() {
    if (!state.player) return null;
    let el = state.player.querySelector(`#${OVERLAY_ID}`);
    if (!el) {
      el = document.createElement("div");
      el.id = OVERLAY_ID;
      el.setAttribute("dir", "rtl");
      el.setAttribute("aria-live", "polite");
      el.setAttribute("role", "status");
      state.player.appendChild(el);
    }
    applyOverlayStyle(el);
    return el;
  }

  const STYLE_PRESETS={
    classic:{bg:"#080A0E",color:"#fff",hl:"#FFB35C",radius:7,weight:600,shadowBlur:6,outlineWidth:0,padding:8,max:86,position:"bottom"},
    youtube:{bg:"#000000",color:"#fff",hl:"#FFB35C",radius:2,weight:600,shadowBlur:5,outlineWidth:0,padding:7,max:84,position:"bottom"},
    tiktok:{bg:"#000000",color:"#fff",hl:"#fff",radius:8,weight:800,shadowBlur:8,outlineWidth:3,padding:8,max:88,position:"middle"},
    pill:{bg:"#FFFFFF",color:"#111111",hl:"#B66A00",radius:999,weight:700,shadowBlur:5,outlineWidth:0,padding:9,max:86,position:"bottom"},
    snapchat:{bg:"#000000",color:"#fff",hl:"#FFB35C",radius:2,weight:600,shadowBlur:3,outlineWidth:0,padding:8,max:96,position:"bottom"},
    cinema:{bg:"#000000",color:"#F7F4EE",hl:"#FFB35C",radius:0,weight:500,shadowBlur:14,outlineWidth:0,padding:6,max:82,position:"bottom"},
    minimal:{bg:"#000000",color:"#fff",hl:"#FFB35C",radius:2,weight:600,shadowBlur:4,outlineWidth:1,padding:5,max:82,position:"bottom"}
  };
  function hexRgba(hex,a){const m=String(hex||"").match(/^#([0-9a-f]{6})$/i);if(!m)return`rgba(8,10,14,${a})`;const n=parseInt(m[1],16);return`rgba(${n>>16},${n>>8&255},${n&255},${a})`;}
  function applyOverlayStyle(el){
    const s=state.settings,p=STYLE_PRESETS[String(s.preset||"pill").toLowerCase()]||STYLE_PRESETS.pill;
    const size=Math.max(16,Math.min(54,Number(s.fontSize)||30)),opacity=Math.max(.05,Math.min(.98,Number(s.bgOpacity)||.78));
    const preset=String(s.preset||"pill").toLowerCase();
    const radius=Number.isFinite(Number(s.borderRadius))?Math.max(0,Math.min(999,Number(s.borderRadius))):p.radius;
    const pad=Number.isFinite(Number(s.padding))?Math.max(0,Math.min(30,Number(s.padding))):p.padding;
    const weight=Number.isFinite(Number(s.customWeight))?Math.max(300,Math.min(900,Number(s.customWeight))):p.weight;
    const outlineWidth=Number.isFinite(Number(s.outlineWidth))?Math.max(0,Math.min(8,Number(s.outlineWidth))):p.outlineWidth;
    const shadowBlur=Number.isFinite(Number(s.shadowBlur))?Math.max(0,Math.min(30,Number(s.shadowBlur))):p.shadowBlur;
    el.style.fontFamily=`"Lalezar",sans-serif`;
    el.style.fontSize=`${size}px`;
    el.style.setProperty("--subify-bg",hexRgba(s.bgColor||p.bg,opacity));
    el.style.setProperty("--subify-color",s.textColor||p.color);
    el.style.setProperty("--subify-highlight",s.highlightColor||p.hl);
    el.style.setProperty("--subify-radius",`${radius}px`);
    el.style.setProperty("--subify-weight",weight);
    el.style.setProperty("--subify-line-height",String(Number(s.lineHeight)||1.42));
    el.style.setProperty("--subify-shadow",shadowBlur?`0 2px ${shadowBlur}px ${s.shadowColor||"#000000"}`:"none");
    el.style.setProperty("--subify-outline",outlineWidth?`${outlineWidth}px ${s.outlineColor||"#000000"}`:"none");
    el.style.setProperty("--subify-pad",`${pad}px ${Math.max(6,pad*1.6)}px`);
    el.style.setProperty("--subify-max",`${Number(s.maxWidth||p.max)}%`);
    el.style.setProperty("--subify-fallback-bottom",`${Math.max(3,Math.min(40,Number(s.bottom)||11))}%`);
    el.style.setProperty("--subify-drag-x", "0px");
    el.dataset.preset=preset;
    el.classList.toggle("subify-preset-pill",preset==="pill");
  }

  function hide() {
    const el = state.player?.querySelector(`#${OVERLAY_ID}`);
    if (!el) return;
    el.classList.remove("subify-visible");
    el.textContent = "";
  }

  let _subifyDbPromise = null;
  function subifyDb() {
    if (_subifyDbPromise) return _subifyDbPromise;
    _subifyDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open("subify-local", 2);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains("translations")) d.createObjectStore("translations");
        if (!d.objectStoreNames.contains("vocab")) d.createObjectStore("vocab");
        if (!d.objectStoreNames.contains("shots")) d.createObjectStore("shots");
        if (!d.objectStoreNames.contains("storyboards")) d.createObjectStore("storyboards");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return _subifyDbPromise;
  }
  async function subifyIdbGet(store, key) {
    const d = await subifyDb();
    return new Promise((resolve, reject) => { const r=d.transaction(store,"readonly").objectStore(store).get(key); r.onsuccess=()=>resolve(r.result||null); r.onerror=()=>reject(r.error); });
  }
  async function subifyIdbPut(store, key, value) {
    const d = await subifyDb();
    return new Promise((resolve, reject) => { const r=d.transaction(store,"readwrite").objectStore(store).put(value,key); r.onsuccess=()=>resolve(); r.onerror=()=>reject(r.error); });
  }

  // Runs on this page's own IndexedDB (youtube.com origin — see the note by
  // subifyDb() above), triggered either by a direct message from the popup/
  // options "Clear all data" button, or by the subify_pending_clear flag for
  // tabs that weren't open when that button was pressed.
  async function clearLocalCache() {
    try {
      if (_subifyDbPromise) { try { (await _subifyDbPromise).close(); } catch (e) {} }
      _subifyDbPromise = null;
      state.translations.clear();
      state.persistentCacheLoaded = false;
      state.persistentCacheKey = "";
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase("subify-local");
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });
      log("local translation cache cleared");
    } catch (e) { log("clearLocalCache failed", e); }
  }
  async function checkPendingClear() {
    try {
      const { subify_pending_clear } = await browser.storage.local.get("subify_pending_clear");
      if (subify_pending_clear) { await clearLocalCache(); await browser.storage.local.remove("subify_pending_clear"); }
    } catch (e) {}
  }

  function persistentCacheKey() {
    return state.trackKey ? `subify_tr_${hash(state.trackKey)}` : "";
  }

  async function loadPersistentTranslations() {
    const key=persistentCacheKey(); if(!key||state.persistentCacheLoaded)return;
    state.persistentCacheKey=key; state.persistentCacheLoaded=true;
    try { const data=await subifyIdbGet("translations",key); const rows=Array.isArray(data?.rows)?data.rows:[]; for(const row of rows){const id=String(row?.id||"");const fa=clean(row?.fa||"");if(id&&fa)state.translations.set(id,fa);} if(rows.length)log(`loaded ${rows.length} cached subtitle translations from IndexedDB`); } catch(e){log("IndexedDB translation cache read failed",e);}
  }
  let cacheWriteTimer=null;
  function schedulePersistentCacheWrite(){
    if(!state.persistentCacheKey)return; clearTimeout(cacheWriteTimer);
    cacheWriteTimer=setTimeout(async()=>{try{const rows=[...state.translations.entries()].map(([id,fa])=>({id,fa}));await subifyIdbPut("translations",state.persistentCacheKey,{version:2,updatedAt:Date.now(),rows:rows.slice(0,12000)});}catch(e){log("IndexedDB translation cache write failed",e);}},250);
  }

  async function publishSubtitleCues(extra = []) {
    try {
      const cues = [...state.cues, ...extra]
        .map(c => ({ id: c.id, start: Number(c.start), end: Number(c.end), text: clean(c.text || ""), fa: clean(state.translations.get(c.id) || c.fa || "") }))
        .filter(c => Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start && (c.text || c.fa));
      const unique = new Map();
      for (const c of cues) unique.set(String(c.id), c);
      await browser.storage.session.set({ subify_export_cues: [...unique.values()].slice(-5000) });
    } catch (_) {}
  }

  function installDrag(el){if(el.dataset.dragReady)return;el.dataset.dragReady="1";
    el.addEventListener("pointerdown",e=>{if(!e.target.closest(".subify-subtitle-line"))return;const r=state.player?.getBoundingClientRect();if(!r)return;state.drag={id:e.pointerId,r};el.setPointerCapture?.(e.pointerId);el.classList.add("subify-dragging");e.preventDefault();});
    el.addEventListener("pointermove",e=>{if(!state.drag||state.drag.id!==e.pointerId)return;const d=state.drag,x=Math.max(3,Math.min(97,(e.clientX-d.r.left)/d.r.width*100)),y=Math.max(3,Math.min(92,(e.clientY-d.r.top)/d.r.height*100));state.settings.positionX=Math.round(x*10)/10;state.settings.positionY=Math.round(y*10)/10;state.settings.positionMode="custom";el.style.left="0";el.style.right="0";el.style.top="0";el.style.bottom="0";el.style.transform="none";el.style.justifyContent="flex-start";el.style.alignItems="stretch";el.style.paddingTop=`${y}%`;el.style.paddingBottom="0";el.style.setProperty("--subify-drag-x",`${e.clientX-(d.r.left+d.r.width/2)}px`);});
    el.addEventListener("click",async e=>{const w=e.target.closest(".subify-subtitle-line--orig .subify-word");if(!w||!state.activeCue)return;const word=clean(w.textContent);if(!word)return;w.classList.add("subify-saving");try{const r=await browser.runtime.sendMessage({type:"subify-vocab-enrich",word,sentence:state.activeCue.text,translation:state.activeFa,lang:state.trackLanguage||"auto"});w.title=r?.ok?"لغت ذخیره شد؛ در بخش یادگیری ببینید":(r?.error||"ذخیره نشد");}catch(err){w.title=String(err?.message||err);}finally{w.classList.remove("subify-saving");}});
    const done=()=>{if(!state.drag)return;state.drag=null;el.classList.remove("subify-dragging");const id=state.videoId||getVideoIdFromUrl();if(id)browser.storage.local.set({[`subify_video_${id}`]:{positionX:state.settings.positionX,positionY:state.settings.positionY,positionMode:"custom"}}).catch(()=>{});};el.addEventListener("pointerup",done);el.addEventListener("pointercancel",done);
  }
  function cueWords(cue,text){const parts=clean(text).match(/\S+\s*/g)||[clean(text)];const dur=Math.max(.1,cue.end-cue.start);const src=Array.isArray(cue.words)&&cue.words.length?cue.words:null;return parts.map((w,i)=>{const t=src?.[i];return{text:w,start:Number(t?.start??cue.start+dur*i/parts.length),end:Number(t?.end??cue.start+dur*(i+1)/parts.length)};});}
  function makeLine(cue,text,cls,original){const line=document.createElement("div");line.className=`subify-subtitle-line ${cls}`;line.setAttribute("dir",original?/^[\x00-\x7F]/.test(text)?"ltr":"rtl":"rtl");const span=document.createElement("span");span.className="subify-subtitle-text";if(state.settings.karaokeEnabled!==false){for(const w of cueWords(cue,text)){const x=document.createElement("span");x.className="subify-word";x.textContent=w.text;x.dataset.start=w.start;x.dataset.end=w.end;span.appendChild(x);}}else span.textContent=clean(text);line.appendChild(span);return line;}
  function updateKaraoke(el,now){
    if(state.settings.karaokeEnabled===false || !el)return;
    const t=Number(now||0)+Number(state.karaokeLead||0);
    el.querySelectorAll(".subify-word").forEach(w=>{
      const a=Number(w.dataset.start),b=Number(w.dataset.end);
      w.classList.toggle("sung",t>=a);
      w.classList.toggle("active",t>=a&&t<b);
    });
  }
  function startKaraokeLoop(){
    if(state.karaokeRaf)cancelAnimationFrame(state.karaokeRaf);
    const tick=()=>{
      state.karaokeRaf=requestAnimationFrame(tick);
      if(!state.video || !state.settings.subtitleEnabled || state.settings.karaokeEnabled===false)return;
      const el=state.player?.querySelector(`#${OVERLAY_ID}`);
      if(!el || !el.classList.contains("subify-visible"))return;
      updateKaraoke(el,Number(state.video.currentTime||0));
    };
    state.karaokeRaf=requestAnimationFrame(tick);
  }
  function showCue(cue,fa,now){
    state.activeCue=cue; state.activeFa=fa||"";
    const el=ensureOverlay(); if(!el)return;
    const mode=state.settings.displayMode||"translation";
    el.textContent="";
    if(mode!=="translation")el.appendChild(makeLine(cue,cue.text,"subify-subtitle-line--orig",true));
    if(mode!=="original"&&fa)el.appendChild(makeLine(cue,fa,"subify-subtitle-line--fa",false));
    el.classList.add("subify-visible");
    positionOverlay(el); installDrag(el); updateKaraoke(el,now);
  }

  function getNativeCaptionRect() {
    const player = state.player;
    if (!player) return null;
    const nodes = [
      ...document.querySelectorAll(
        ".ytp-caption-window-container .ytp-caption-window, .ytp-caption-window-container .ytp-caption-segment, .caption-window .ytp-caption-window, .caption-window .ytp-caption-segment"
      )
    ].filter(n => {
      const r = n.getBoundingClientRect();
      const cs = getComputedStyle(n);
      return r.width > 0 && r.height > 0 && cs.display !== "none";
    });
    if (!nodes.length) return null;

    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const n of nodes) {
      const r = n.getBoundingClientRect();
      left = Math.min(left, r.left);
      top = Math.min(top, r.top);
      right = Math.max(right, r.right);
      bottom = Math.max(bottom, r.bottom);
    }
    return { left, top, right, bottom };
  }

  function positionOverlay(el){
    if(!el)return;
    const p=state.player?.getBoundingClientRect(); if(!p)return;
    const mode=String(state.settings.positionMode||"bottom");
    const x=Math.max(2,Math.min(98,Number(state.settings.positionX??50)));
    const lines=[...el.querySelectorAll(".subify-subtitle-line")];
    // The overlay itself always spans the full video. Only the subtitle group is positioned.
    el.style.inset="0";
    el.style.left="0"; el.style.right="0"; el.style.top="0"; el.style.bottom="0";
    el.style.transform="none";
    el.style.alignItems="center";
    el.style.justifyContent="flex-end";
    el.style.paddingBottom="9%";
    el.style.paddingTop="0";
    if(mode==="middle"){
      el.style.justifyContent="center";
      el.style.paddingBottom="0";
    }else if(mode==="top"){
      el.style.justifyContent="flex-start";
      el.style.paddingTop="11%";
      el.style.paddingBottom="0";
    }else if(mode==="custom"){
      el.style.justifyContent="flex-start";
      el.style.paddingTop=`${Math.max(3,Math.min(92,Number(state.settings.positionY??82)))}%`;
      el.style.paddingBottom="0";
    }else{
      // Match the usual YouTube caption baseline. If we observed native captions,
      // preserve their measured distance from the bottom; otherwise use 9%.
      if(state.settings.alignUnderNative!==false && state.nativeBottomOffset!=null){
        el.style.paddingBottom=`${Math.max(4,Math.min(p.height-8,state.nativeBottomOffset))}px`;
      }
    }
    for(const line of lines){
      line.style.position="relative";
      line.style.left="auto";
      line.style.top="auto";
      line.style.bottom="auto";
      line.style.transform="translateX(${x-50}%)";
      line.style.marginLeft="0";
      line.style.marginRight="0";
    }
  }
  function findJsonValue(text, marker) {
    const markerIndex = text.indexOf(marker);
    if (markerIndex < 0) return null;
    const eq = text.indexOf("=", markerIndex + marker.length);
    if (eq < 0) return null;
    let start = eq + 1;
    while (/\s/.test(text[start] || "")) start++;
    if (text[start] !== "{") return null;

    let depth = 0, quote = false, escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') quote = false;
        continue;
      }
      if (ch === '"') { quote = true; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, i + 1)); } catch (_) { return null; }
        }
      }
    }
    return null;
  }

  function extractPlayerResponseFromDom() {
    const globals = ["ytInitialPlayerResponse", "ytplayer.config"];
    for (const script of document.scripts) {
      const text = script.textContent || "";
      if (!text) continue;
      if (text.includes("ytInitialPlayerResponse")) {
        const obj = findJsonValue(text, "ytInitialPlayerResponse");
        if (obj) return obj;
      }
      if (text.includes("ytplayer.config")) {
        const obj = findJsonValue(text, "ytplayer.config");
        if (obj?.args?.player_response) {
          try { return JSON.parse(obj.args.player_response); } catch (_) {}
        }
      }
    }
    for (const name of globals) {
      try {
        const value = name === "ytInitialPlayerResponse" ? window[name] : null;
        if (value?.captions) return value;
      } catch (_) {}
    }
    return null;
  }

  function captionTracksFromResponse(response) {
    const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
    if (!Array.isArray(tracks)) return [];
    return tracks.filter(t => t?.baseUrl).map(t => ({
      ...t,
      isAutoGenerated: String(t.kind || '').toLowerCase() === 'asr'
    }));
  }

  function decodeEscapedUrl(url) {
    return String(url || "")
      .replace(/\\u0026/g, "&")
      .replace(/\\u003d/g, "=")
      .replace(/&amp;/g, "&");
  }

  function getNativeTextTrackCues() {
    const video = state.video;
    if (!video?.textTracks) return [];
    const tracks = [];
    for (let i = 0; i < video.textTracks.length; i++) {
      const t = video.textTracks[i];
      if (!t || !["subtitles", "captions"].includes(t.kind)) continue;
      if (!t.cues || !t.cues.length) continue;
      const cues = [];
      for (let j = 0; j < t.cues.length; j++) {
        const c = t.cues[j];
        const text = clean(c?.text || "");
        if (!text) continue;
        cues.push({ start: Number(c.startTime), end: Number(c.endTime), text });
      }
      if (cues.length) tracks.push({
        languageCode: t.language || "",
        name: { simpleText: t.label || t.language || "" },
        baseUrl: "",
        native: true,
        cues: normalizeCues(cues)
      });
    }
    return tracks;
  }

  async function getCaptionTracks() {
    const direct = captionTracksFromResponse(extractPlayerResponseFromDom());
    if (direct.length) return direct;

    const native = getNativeTextTrackCues();
    if (native.length) return native;

    const videoId = state.videoId || getVideoIdFromUrl();
    if (!videoId) return [];
    if (state.watchFetchPromise) return state.watchFetchPromise;
    if (state.trackDiscoveryFailedAt && Date.now() - state.trackDiscoveryFailedAt < 10000) return [];
    if (Date.now() - state.lastTrackDiscoveryAttempt < 1500) return [];
    state.lastTrackDiscoveryAttempt = Date.now();

    state.watchFetchPromise = (async () => {
      try {
        const url = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
        const res = await fetch(url, { credentials: "include", cache: "no-store" });
        if (!res.ok) throw new Error(`watch page HTTP ${res.status}`);
        const html = await res.text();
        const marker = '"captionTracks":';
        const idx = html.indexOf(marker);
        if (idx < 0) { state.trackDiscoveryFailedAt = Date.now(); return []; }
        let start = idx + marker.length;
        while (/\s/.test(html[start] || "")) start++;
        if (html[start] !== "[") { state.trackDiscoveryFailedAt = Date.now(); return []; }
        let depth = 0, quote = false, escaped = false;
        for (let i = start; i < html.length; i++) {
          const ch = html[i];
          if (quote) {
            if (escaped) escaped = false;
            else if (ch === "\\") escaped = true;
            else if (ch === '"') quote = false;
            continue;
          }
          if (ch === '"') { quote = true; continue; }
          if (ch === "[") depth++;
          else if (ch === "]") {
            depth--;
            if (depth === 0) {
              try {
                const parsed = JSON.parse(html.slice(start, i + 1));
                const tracks = Array.isArray(parsed) ? parsed.filter(t => t?.baseUrl).map(t => ({
                  ...t,
                  isAutoGenerated: String(t.kind || '').toLowerCase() === 'asr'
                })) : [];
                if (!tracks.length) state.trackDiscoveryFailedAt = Date.now();
                return tracks;
              } catch (_) { state.trackDiscoveryFailedAt = Date.now(); return []; }
            }
          }
        }
      } catch (e) {
        log("caption track discovery failed", e);
      } finally {
        state.watchFetchPromise = null;
      }
      return [];
    })();

    return state.watchFetchPromise;
  }

  function trackName(track) {
    return clean(track?.name?.simpleText || track?.name?.runs?.map(r => r?.text || "").join("") || track?.languageName?.simpleText || "");
  }

  function pickTrack(tracks) {
    if (!tracks.length) return null;
    const wanted = String(state.settings.sourceLanguage || "auto").toLowerCase();
    const langOf = t => String(t.languageCode || '').toLowerCase();
    const sameLang = (t, code) => langOf(t) === code || langOf(t).startsWith(`${code}-`);
    const byLanguage = code => tracks.filter(t => sameLang(t, code));
    const preferManual = list => list.find(t => !t.isAutoGenerated) || list.find(t => t.isAutoGenerated) || list[0] || null;
    const preferAuto = list => list.find(t => t.isAutoGenerated) || list.find(t => !t.isAutoGenerated) || list[0] || null;

    if (wanted !== "auto") {
      const matches = byLanguage(wanted);
      if (matches.length) return preferManual(matches);
      const english = byLanguage('en');
      return preferManual(english) || tracks[0];
    }

    // Auto means: prefer YouTube's automatic-caption (ASR) track. This is
    // selected from YouTube's own captionTracks data and never inferred from
    // audio captured by Subify.
    return preferAuto(tracks);
  }

  function buildTrackUrl(track, format) {
    // Keep YouTube's original signed caption URL intact.
    // YouTube caption URLs can contain short-lived/signature-related query
    // parameters. Rebuilding the URL and deleting lang/kind/name/tlang can
    // produce HTTP 200 with an empty caption body, which looks successful but
    // gives us no cues to render.
    const raw = decodeEscapedUrl(track?.baseUrl || "");
    if (!raw) return "";
    try {
      const url = new URL(raw, location.origin);
      if (format) url.searchParams.set("fmt", format);
      else url.searchParams.delete("fmt");
      return url.href;
    } catch (_) {
      return raw;
    }
  }

  function cueId(start, end, text) {
    return `${Number(start).toFixed(3)}|${Number(end).toFixed(3)}|${hash(text)}`;
  }

  function normalizeCues(cues) {
    const sorted = cues
      .filter(c => c && c.text && Number.isFinite(c.start) && Number.isFinite(c.end) && c.end > c.start)
      .sort((a, b) => a.start - b.start || a.end - b.end);

    const out = [];
    for (const cue of sorted) {
      const text = clean(cue.text);
      if (!text) continue;
      const prev = out[out.length - 1];
      if (prev && text === prev.text && cue.start <= prev.end + 0.25) {
        prev.end = Math.max(prev.end, cue.end);
        prev.id = cueId(prev.start, prev.end, prev.text);
        continue;
      }
      out.push({ start: cue.start, end: cue.end, text, words: Array.isArray(cue.words)?cue.words:null, id: cueId(cue.start, cue.end, text) });
    }
    return out;
  }

  function parseJson3(text) {
    const data = JSON.parse(text);
    const events = Array.isArray(data.events) ? data.events : [];
    const cues = [];
    for (let i = 0; i < events.length; i++) {
      const e = events[i] || {};
      const cueText = clean(Array.isArray(e.segs) ? e.segs.map(x => x?.utf8 || "").join("") : "");
      if (!cueText) continue;
      const start = Number(e.tStartMs || 0) / 1000;
      let duration = Number(e.dDurationMs || 0) / 1000;
      if (!(duration > 0)) {
        const next = events.slice(i + 1).find(x => Number.isFinite(Number(x?.tStartMs)));
        const nextStart = next ? Number(next.tStartMs) / 1000 : start + 2.5;
        duration = Math.max(0.25, Math.min(8, nextStart - start));
      }
      const words=[]; if(Array.isArray(e.segs)&&e.segs.length){for(let si=0;si<e.segs.length;si++){const seg=e.segs[si]||{},raw=clean(seg.utf8||"");if(!raw)continue;const off=Number(seg.tOffsetMs),ws=Number.isFinite(off)?start+off/1000:start;const next=si+1<e.segs.length?Number(e.segs[si+1]?.tOffsetMs):NaN;const we=Number.isFinite(next)?start+next/1000:start+Math.max(.15,duration);const toks=raw.match(/\S+\s*/g)||[raw];toks.forEach((tok,ti)=>words.push({text:tok,start:ws+(we-ws)*ti/toks.length,end:ws+(we-ws)*(ti+1)/toks.length}));}} cues.push({ start, end: start + Math.max(0.15, duration), text: cueText, words });
    }
    return normalizeCues(cues);
  }

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, "text/xml");
    if (doc.querySelector("parsererror")) throw new Error("invalid XML caption response");
    const nodes = [...doc.querySelectorAll("text")];
    if (!nodes.length) return [];
    return normalizeCues(nodes.map(n => {
      const start = Number(n.getAttribute("start") || 0);
      const dur = Number(n.getAttribute("dur") || 0);
      const words=[];const segs=[...n.querySelectorAll(":scope > s")];if(segs.length){for(let i=0;i<segs.length;i++){const raw=clean(segs[i].textContent||"");if(!raw)continue;const rel=Number(segs[i].getAttribute("t")),a=Number.isFinite(rel)?start+rel/1000:start,next=i+1<segs.length?Number(segs[i+1].getAttribute("t")):NaN,b=Number.isFinite(next)?start+next/1000:start+Math.max(.15,dur||2.5),toks=raw.match(/\S+\s*/g)||[raw];toks.forEach((tok,ti)=>words.push({text:tok,start:a+(b-a)*ti/toks.length,end:a+(b-a)*(ti+1)/toks.length}));}}return { start, end: start + Math.max(0.15, dur || 2.5), text: n.textContent || "", words };
    }));
  }

  function parseVtt(text) {
    const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/);
    const cues = [];
    const toSec = (s) => {
      const m = String(s).trim().replace(",", ".").match(/^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})$/);
      if (!m) return NaN;
      return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line.includes("-->")) continue;
      const [a, b] = line.split("-->");
      const start = toSec(a.trim().split(/\s+/)[0]);
      const end = toSec(b.trim().split(/\s+/)[0]);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      const textLines = [];
      for (i = i + 1; i < lines.length && lines[i].trim(); i++) textLines.push(lines[i]);
      cues.push({ start, end, text: textLines.join(" ") });
    }
    return normalizeCues(cues);
  }

  async function fetchTrack(track) {
    if (!track?.baseUrl || state.fetching) return;
    const trackKey = `${state.videoId}|${track.languageCode || ""}|${track.baseUrl}`;
    if (trackKey === state.trackKey && state.cues.length) return;

    state.fetching = true;
    const session = state.session;
    const cacheKey = track.baseUrl;
    try {
      let cues = state.trackCache.get(cacheKey);
      if (!cues) {
        // json3 preserves YouTube cue timing while keeping the original
        // signed baseUrl and only change the output format. If a particular
        // format is rejected/empty, fall back without destroying the URL.
        const formats = ["json3", "srv3", "vtt", ""];
        let lastError = null;
        for (const format of formats) {
          try {
            const url = buildTrackUrl(track, format);
            if (!url) throw new Error("caption URL is empty");
            const res = await fetch(url, {
              credentials: "include",
              cache: "no-store",
              headers: { Accept: "application/json, text/xml, text/vtt, */*" }
            });
            const body = await res.text();
            // Some YouTube caption endpoints occasionally return partial chunks.
            // Retry with a cache-busted request instead of silently exporting half a subtitle.
            if (res.ok && body.length < 80 && format !== "") {
              await new Promise(r => setTimeout(r, 300));
              continue;
            }
            if (!res.ok) {
              lastError = new Error(`caption HTTP ${res.status}`);
              continue;
            }
            if (!body.trim()) {
              lastError = new Error("caption response was empty");
              continue;
            }
            let parsed = [];
            try {
              if (format === "json3" || body.trim().startsWith("{")) parsed = parseJson3(body);
            } catch (_) {}
            if (!parsed.length && (format === "srv3" || body.trim().startsWith("<"))) {
              try { parsed = parseXml(body); } catch (_) {}
            }
            if (!parsed.length && (format === "vtt" || /^WEBVTT/i.test(body.trim()))) {
              try { parsed = parseVtt(body); } catch (_) {}
            }
            if (parsed.length) {
              cues = parsed;
              break;
            }
            lastError = new Error(`caption ${format || "default"} returned no cues`);
          } catch (e) {
            lastError = e;
          }
        }
        if (!cues?.length) throw lastError || new Error("YouTube caption track contains no cues");
        state.trackCache.set(cacheKey, cues);
      }

      if (session !== state.session) return;
      const old = new Map(state.translations);
      const ids = new Set(cues.map(c => c.id));
      state.cues = cues;
      state.trackKey = trackKey;
      state.trackUrl = track.baseUrl;
      state.trackLanguage = track.languageCode || "";
      state.translations.clear();
      for (const [id, fa] of old) if (ids.has(id)) state.translations.set(id, fa);

      await loadPersistentTranslations();
      log(`loaded ${cues.length} YouTube captions (${track.languageCode || "unknown"}: ${trackName(track)})`);
      void publishSubtitleCues();
      const now = Number(state.video?.currentTime || 0);
      void queueTranslateAll(cues, session, now);
    } catch (e) {
      const native = getNativeTextTrackCues();
      const wanted = String(state.settings.sourceLanguage || "auto").toLowerCase();
      const nativeTrack = native.length && (wanted === "auto" || native.some(t => t.languageCode === wanted))
        ? native.find(t => wanted === "auto" || t.languageCode === wanted) || native[0]
        : null;
      if (nativeTrack?.cues?.length && session === state.session) {
        state.cues = nativeTrack.cues;
        state.trackKey = trackKey;
        state.trackUrl = "native";
        state.trackLanguage = nativeTrack.languageCode || "";
        state.translations.clear();
        log(`network caption fetch failed; using ${state.cues.length} native YouTube cues instead`);
        void queueTranslateAll(state.cues, session, Number(state.video?.currentTime || 0));
      } else {
        log("YouTube caption fetch failed", e);
      }
    } finally {
      state.fetching = false;
    }
  }

  async function _translateBatchNow(cues, session) {
    const fresh = cues
      .filter(c => c?.text && !state.translations.has(c.id) && !state.translating.has(c.id))
      .slice(0, 20);
    if (!fresh.length || session !== state.session) return false;

    fresh.forEach(c => state.translating.add(c.id));
    try {
      const response = await browser.runtime.sendMessage({ type: "subify-translate", cues: fresh });
      if (session !== state.session || !response?.ok) {
        log("subtitle translation batch failed");
        return false;
      }
      let added = 0;
      const returned = new Set();
      for (const result of response.results || []) {
        const fa = clean(result?.fa);
        if (result?.id && fa) {
          const id = String(result.id);
          state.translations.set(id, fa);
          returned.add(id);
          added++;
        }
      }
      schedulePersistentCacheWrite();
      void publishSubtitleCues();

      // Do not fire extra one-cue requests when a provider omits an item.
      // The missing cues remain eligible for the next queued window pass.
      const missing = fresh.filter(c => !returned.has(String(c.id)));
      if (missing.length) log(`translation batch returned ${returned.size}/${fresh.length}; ${missing.length} cue(s) will be retried on the next queue pass`, "warn");
      return added > 0;
    } catch (e) {
      log("subtitle translation failed", e);
      return false;
    } finally {
      fresh.forEach(c => state.translating.delete(c.id));
    }
  }

  // Serialize translation calls so a seek, settings refresh, or subtitle scan
  // cannot create a burst of concurrent provider requests. One request at a time
  // is deliberately conservative for free/rate-limited API plans.
  async function translateBatch(cues, session) {
    if (session !== state.session) return false;
    const task = () => _translateBatchNow(cues, session);
    const run = state.translationChain.then(task, task);
    state.translationChain = run.catch(() => false);
    return run;
  }

  // Subify translation runway: keep a bounded amount of translated material ahead
  // of the playhead instead of translating an entire long video immediately.
  // showing anything, and do NOT wait until a cue is already on screen. The full
  // timed track is known immediately; translation runs ahead in bounded batches.
  // This keeps the original YouTube timing authoritative while the Persian line is
  // ready before the playhead reaches it.
  async function translateWindow(cues, session, now = 0, aheadSeconds = 60, maxCues = 40) {
    if (!Array.isArray(cues) || !cues.length || session !== state.session || state.aheadBusy) return;
    const end = now + aheadSeconds;
    const targets = cues
      .filter(c => c?.text && c.end >= now - 1000 && c.start <= end && !state.translations.has(c.id) && !state.translating.has(c.id))
      .slice(0, maxCues);
    if (!targets.length) return;
    state.aheadBusy = true;
    try {
      // Keep one provider request in flight. Gemini free/rate-limited keys are
      // happier with a steady runway than a burst of parallel calls.
      for (let i = 0; i < targets.length && session === state.session; i += 20) {
        const ok = await translateBatch(targets.slice(i, i + 20), session);
        if (!ok) await new Promise(r => setTimeout(r, 1200));
      }
    } finally {
      state.aheadBusy = false;
    }
  }

  function startAheadPump(session) {
    if (state.aheadPump) clearInterval(state.aheadPump);
    state.aheadPump = setInterval(() => {
      if (session !== state.session || !state.settings.subtitleEnabled) return;
      const video = state.video;
      if (!video || video.ended) return;
      // Once the user has engaged the video, pre-translate while playing or paused.
      // This is especially useful when the user pauses to read.
      if (video.paused && Number(video.currentTime || 0) <= 0.25) return;
      void translateWindow(state.cues, session, Number(video.currentTime || 0), 180, 80);
    }, 1000);
  }

  async function queueTranslateAll(cues, session, now = 0) {
    if (!Array.isArray(cues) || !cues.length || session !== state.session) return;
    await loadPersistentTranslations();
    startAheadPump(session);
    await translateWindow(cues, session, now, 180, 80);
  }

  async function translateAhead(cues, session, now, seconds) {
    if (session !== state.session) return;
    await translateWindow(cues, session, now, Math.min(60, Number(seconds) || 60), 40);
  }

  async function translateAllForExport(session) {
    await loadPersistentTranslations();
    const pending = state.cues.filter(c => c?.text && !state.translations.has(c.id));
    if (!pending.length) return;
    const batchSize = 20;
    for (let i = 0; i < pending.length && session === state.session; i += batchSize) {
      await translateBatch(pending.slice(i, i + batchSize), session);
      schedulePersistentCacheWrite();
      await publishSubtitleCues();
    }
  }

  function currentNativeCaption() {
    const nodes = [...document.querySelectorAll(
      ".ytp-caption-window-container .ytp-caption-segment, .caption-window .ytp-caption-segment"
    )];
    return clean(nodes.map(n => n.textContent || "").join(" "));
  }

  function activeCue(now) {
    let found = null;
    for (const cue of state.cues) {
      if (now >= cue.start && now < cue.end) found = cue;
    }
    return found;
  }

  async function refreshTrack() {
    const tracks = await getCaptionTracks();
    if (!tracks.length) return;
    const track = pickTrack(tracks);
    if (!track) return;
    const key = `${state.videoId}|${track.languageCode || ""}|${track.baseUrl || "native"}`;
    if (track.native && track.cues?.length) {
      if (key === state.trackKey) return;
      const old = new Map(state.translations);
      state.cues = track.cues;
      state.trackKey = key;
      state.trackUrl = "native";
      state.trackLanguage = track.languageCode || "";
      state.translations.clear();
      for (const [id, fa] of old) if (state.cues.some(c => c.id === id)) state.translations.set(id, fa);
      log(`using ${state.cues.length} native YouTube caption cues (${state.trackLanguage || "unknown"})`);
      void queueTranslateAll(state.cues, state.session, Number(state.video?.currentTime || 0));
      return;
    }
    if (key !== state.trackKey) await fetchTrack(track);
  }

  function scan() {
    const video = getVideo();
    if (!video || !state.player) {
      hide();
      return;
    }

    const id = getVideoIdFromUrl();
    if (id && id !== state.videoId) {
      state.videoId = id;
      state.videoSettingsLoaded = false;
      resetTrack();
    }

    if (location.href !== state.lastUrl) {
      state.lastUrl = location.href;
      const newId = getVideoIdFromUrl();
      if (newId !== state.videoId) {
        state.videoId = newId;
        state.videoSettingsLoaded = false;
        resetTrack();
      }
    }

    if (!state.videoSettingsLoaded && state.videoId) void loadSettings();
    if (!state.settings.subtitleEnabled) {
      hide();
      return;
    }

    const now = Number(video.currentTime || 0);
    if (Date.now() - state.lastScan > 1500) {
      state.lastScan = Date.now();
      if (state.capturedCaptionUrl && !state.cues.length) void fetchCapturedTrack(state.capturedCaptionUrl, state.session);
      else if (state.videoId) void refreshTrack();
    }

    // The only subtitle source is YouTube's own timed caption track. Gemini
    // audio/STT is deliberately never used to create subtitle timing.
    const cue = activeCue(now);
    if (!cue) {
      hide();
      return;
    }

    const fa = state.translations.get(cue.id);
    if (!fa) {
      // Keep the current cue slot alive while Gemini is translating it.
      // The next scan will render it as soon as the translation lands.
      if (!state.translating.has(cue.id)) void translateBatch([cue], state.session);
      return;
    }

    if (cue.id !== state.lastShownId) {
      state.lastShownId = cue.id;
      showCue(cue,fa,now);
    } else {
      const el = ensureOverlay();
      if (el) { positionOverlay(el); el.classList.add("subify-visible"); updateKaraoke(el,now); }
    }

    // Keep a Subify translation runway ahead of the playhead. The active cue itself
    // is translated immediately as a safety net, while the pump keeps future
    // cues ready so playback never waits on Gemini.
    if (!state.aheadBusy) void translateWindow(state.cues, state.session, now, 60, 40);
  }

  async function loadSettings(){
    const [{subify_settings},{subify_subtitle_enabled}]=await Promise.all([browser.storage.local.get("subify_settings"),browser.storage.local.get("subify_subtitle_enabled")]);
    const base={...DEFAULTS,...(subify_settings||{})};let per={};const id=state.videoId||getVideoIdFromUrl();if(id){try{const r=await browser.storage.local.get(`subify_video_${id}`);per=r[`subify_video_${id}`]||{};}catch(_){}}
    state.settings={...DEFAULTS,...base,...per,subtitleEnabled:subify_subtitle_enabled!==false};state.videoSettingsLoaded=true;installFonts();const el=state.player?.querySelector(`#${OVERLAY_ID}`);if(el){applyOverlayStyle(el);positionOverlay(el);}if(!state.settings.subtitleEnabled)hide();
  }

  window.addEventListener('subify-youtube-timedtext', (event) => handleCapturedTimedText(event.detail));

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'subify-enable-subtitles') {
      state.settings.subtitleEnabled = true;
      browser.storage.local.set({ subify_subtitle_enabled: true });
      void refreshTrack();
      sendResponse({ ok: true });
      return false;
    }
    if (msg?.type === 'subify-disable-subtitles') {
      state.settings.subtitleEnabled = false;
      if (state.aheadPump) { clearInterval(state.aheadPump); state.aheadPump = null; }
      browser.storage.local.set({ subify_subtitle_enabled: false });
      hide();
      sendResponse({ ok: true });
      return false;
    }

    if (msg?.type === 'subify-refresh-captions') {
      (async () => {
        try {
          if (!state.settings.subtitleEnabled) {
            // Keep this in sync with the 'subify-enable-subtitles' handler above —
            // otherwise the popup toggle stays "off" while playback silently has
            // subtitles on, and the setting reverts on the next page load.
            state.settings.subtitleEnabled = true;
            browser.storage.local.set({ subify_subtitle_enabled: true });
            browser.runtime.sendMessage({ type: 'subify-subtitles-auto-enabled' }).catch(() => {});
          }
          const tracks = await getCaptionTracks();
          const track = pickTrack(tracks);
          if (!track) throw new Error('YouTube automatic captions are not available for this video');
          if (track.native && track.cues?.length) {
            const old = new Map(state.translations);
            state.cues = track.cues;
            state.trackKey = `${state.videoId}|${track.languageCode || ''}|native`;
            state.trackUrl = 'native';
            state.trackLanguage = track.languageCode || '';
            state.translations.clear();
            for (const [id, fa] of old) if (state.cues.some(c => c.id === id)) state.translations.set(id, fa);
          } else {
            await fetchTrack(track);
          }
          const now = Number(state.video?.currentTime || 0);
          if (msg.translateAll) await translateAllForExport(state.session);
          else await translateAhead(state.cues, state.session, now, 180);
          await publishSubtitleCues();
          sendResponse({ ok: true, count: state.cues.length, language: state.trackLanguage, cues: state.cues.map(c => ({
            id: c.id, start: c.start, end: c.end, text: c.text, fa: clean(state.translations.get(c.id) || c.fa || '')
          })) });
        } catch (e) {
          log('caption export/refresh failed', e);
          sendResponse({ ok: false, error: String(e.message || e) });
        }
      })();
      return true;
    }
    return false;
  });

  browser.runtime.onMessage.addListener((msg,sender,sendResponse)=>{if(msg?.type==="subify-get-current-cue"){const now=Number(state.video?.currentTime||0),cue=activeCue(now);sendResponse({ok:true,cue:cue?{id:cue.id,start:cue.start,end:cue.end,text:cue.text,fa:state.translations.get(cue.id)||""}:null,videoId:state.videoId,currentTime:now});return false;}if(msg?.type==="subify-refresh-settings"){state.videoSettingsLoaded=false;void loadSettings();sendResponse({ok:true});return false;}if(msg?.type==="subify-clear-local-cache"){void clearLocalCache().then(()=>sendResponse({ok:true}));return true;}return false;});

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.subify_settings || changes.subify_subtitle_enabled) void loadSettings();
    // Dubbing and subtitles are independent features. Turning dubbing off
    // must never clear, hide, or otherwise interrupt the subtitle renderer.
  });

  installFonts();
  void checkPendingClear();
  void loadSettings();
  setInterval(scan, 100);
  startKaraokeLoop();
})();
