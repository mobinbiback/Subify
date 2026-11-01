var browser = globalThis.browser || globalThis.chrome; // Chrome has no browser global; same APIs live on chrome.*

(() => {
  "use strict";

  // ---------- grammar panel labels: follow subify_learning.explainLang ----------
  // fa, en and the five UI-language codes have their own labels; every other explanation language uses English.
  const GRAMMAR_UI = {
    fa: { button: "گرامر", hint: "توضیح گرامر این جمله", head: "گرامر این جمله", close: "بستن", loading: "در حال تحلیل جمله…", failed: "توضیح گرامر دریافت نشد", empty: "توضیحی دریافت نشد.", rows: ["معنی جمله", "زمان فعل", "ساختار جمله", "قاعدهٔ گرامری", "چرا این ساختار؟", "جایگزین‌های طبیعی", "جایگزین ساده‌تر", "جایگزین پیشرفته‌تر"] },
    en: { button: "Grammar", hint: "Grammar of this sentence", head: "Grammar of this sentence", close: "Close", loading: "Analyzing the sentence…", failed: "Grammar explanation could not be loaded", empty: "No explanation was received.", rows: ["Sentence meaning", "Verb tense", "Sentence structure", "Grammar rule", "Why this structure?", "Natural alternatives", "Simpler alternative", "More advanced alternative"] },
    ar: { button: "قواعد", hint: "شرح قواعد هذه الجملة", head: "قواعد هذه الجملة", close: "إغلاق", loading: "جارٍ تحليل الجملة…", failed: "تعذّر الحصول على شرح القواعد", empty: "لم يصل أي شرح.", rows: ["معنى الجملة", "زمن الفعل", "بنية الجملة", "قاعدة نحوية", "لماذا هذه البنية؟", "بدائل طبيعية", "بديل أبسط", "بديل أكثر تقدّماً"] },
    es: { button: "Gramática", hint: "Gramática de esta oración", head: "Gramática de esta oración", close: "Cerrar", loading: "Analizando la oración…", failed: "No se pudo obtener la explicación gramatical", empty: "No se recibió ninguna explicación.", rows: ["Significado de la oración", "Tiempo verbal", "Estructura de la oración", "Regla gramatical", "¿Por qué esta estructura?", "Alternativas naturales", "Alternativa más sencilla", "Alternativa más avanzada"] },
    tr: { button: "Dilbilgisi", hint: "Bu cümlenin dilbilgisi açıklaması", head: "Bu cümlenin dilbilgisi", close: "Kapat", loading: "Cümle analiz ediliyor…", failed: "Dilbilgisi açıklaması alınamadı", empty: "Açıklama alınmadı.", rows: ["Cümlenin anlamı", "Fiil zamanı", "Cümle yapısı", "Dilbilgisi kuralı", "Neden bu yapı?", "Doğal alternatifler", "Daha basit alternatif", "Daha ileri alternatif"] },
    fr: { button: "Grammaire", hint: "Grammaire de cette phrase", head: "Grammaire de cette phrase", close: "Fermer", loading: "Analyse de la phrase…", failed: "Explication grammaticale indisponible", empty: "Aucune explication reçue.", rows: ["Sens de la phrase", "Temps du verbe", "Structure de la phrase", "Règle grammaticale", "Pourquoi cette structure ?", "Alternatives naturelles", "Alternative plus simple", "Alternative plus avancée"] },
    de: { button: "Grammatik", hint: "Grammatik dieses Satzes", head: "Grammatik dieses Satzes", close: "Schließen", loading: "Satz wird analysiert…", failed: "Grammatik-Erklärung konnte nicht geladen werden", empty: "Keine Erklärung erhalten.", rows: ["Satzbedeutung", "Verbzeit", "Satzstruktur", "Grammatikregel", "Warum diese Struktur?", "Natürliche Alternativen", "Einfachere Alternative", "Fortgeschrittenere Alternative"] }
  };

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
    learnCfg: null, vocabIndex: null, vocabIndexAt: 0, vocabLoading: false, replay: null, pausedForCue: null,
    videoId: "",
    cues: [],
    translations: new Map(),
    translating: new Set(),
    translationQueueRunning: false,
    translationChain: Promise.resolve(),
    translationEpoch: 0,
    settings: { ...DEFAULTS },
    session: 0,
    trackKey: "",
    trackUrl: "",
    trackLanguage: "",
    currentTrack: null,
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
    capturedUdemyVttUrl: "",
    persistentCacheKey: "",
    persistentCacheLoaded: false,
    cloudSyncedCueKeys: new Set(),
    fixedCueKeys: new Set(),      // lines this person corrected; kept on this browser, never pushed as a shared guess
    transcriptEdit: null,         // { cueId, draft, busy } while a transcript line is open for editing
    transcriptNote: null,         // { cueId, text, tone } status under the last corrected line
    cloudSyncBusy: false,
    aheadPump: null,
    aheadBusy: false,
    videoSettingsLoaded: false,
    drag: null,
    nativeBottomOffset: null,
    karaokeRaf: 0,
    karaokeLead: 0.08,
    liveCue: null,        // {start,end,text} in real video-timeline seconds — see pumpLiveCaption()
    liveHoldAt: null,     // video-time position to pause at until a finished cue arrives — see pumpLivePacing()
    liveForcedPause: false,
    liveHoldSetAt: 0,
    liveTimeBase: 0,      // video.currentTime when capture started — offscreen.js's cue timestamps count from 0 at that moment, not from the video's actual position
    lastAutoCcClickAt: 0,
    autoEnabledNativeCC: false,   // true only while Subify — not the viewer — is the reason CC is on
    lastNativeCcOnObserved: null,
    lastLiveCueStart: null,
    generatedCues: [],
    generatedCueSeq: 0,
    udemyCcObserver: null,
    udemyCcBodyObserver: null,
    udemyCcLastText: "",
    transcriptPanelEl: null,
    transcriptPanelTimer: null,
    wordPopupEl: null,
    wasAdShowing: null,
    shortVideoSkipped: false,
    ignoreCapturedUntil: 0,
    ccSuggestDismissed: false,
    ccSuggestAt: 0,
    nativeCcRefreshInFlight: false,
    nativeCcRefreshAt: 0,
    nativeCcRefreshAttempts: 0,
    nativeCcRefreshTimer: null,
    scanTimer: null,
    videoEventsBoundTo: null,
    videoEventHandlers: null,
    karaokeWords: [],
    karaokeIndex: -1,
    karaokeCueId: ""
  };

  // Every cache/track identity below folds in the CURRENT target language via
  // this helper — not just the source video/track. Without this, switching
  // target language (or loading a fresh tab after switching it earlier) would
  // silently reuse another language's cached translations, since the video's
  // native caption track itself doesn't change when only the target language
  // does. Baking it into the key means each (video, source track, target
  // language) triple gets its own cache slot automatically — no explicit
  // "clear everything" step needed, and it survives a page refresh correctly
  // because it's re-derived from state.settings.targetLanguage every time,
  // never from a one-off "the user just changed it" event.
  function withTargetLang(key) {
    return `${key}|tl:${state.settings?.targetLanguage || "fa"}`;
  }

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
    const face = (name, file, weight) => `@font-face{font-family:"${name}";src:url("${browser.runtime.getURL(file)}") format("truetype");font-weight:${weight};font-style:normal;font-display:swap;}`;
    style.textContent = [
      face("Lalezar", "fonts/Lalezar-Regular.ttf", "100 900"),
      face("Vazirmatn", "fonts/Vazirmatn-Regular.ttf", "400"),
      face("Vazirmatn", "fonts/Vazirmatn-Medium.ttf", "500 900"),
      face("Vazirmatn", "fonts/Vazirmatn-Light.ttf", "100 300"),
      face("Estedad", "fonts/Estedad-Regular.ttf", "400"),
      face("Estedad", "fonts/Estedad-Medium.ttf", "500 900"),
      face("Estedad", "fonts/Estedad-Light.ttf", "100 300"),
      face("IRANYekanX", "fonts/IRANYekanX-Regular.ttf", "400"),
      face("IRANYekanX", "fonts/IRANYekanX-Medium.ttf", "500 600"),
      face("IRANYekanX", "fonts/IRANYekanX-Bold.ttf", "700 900"),
      face("DigiTitr", "fonts/Digi-Titr-Plus-Bold-Circle.ttf", "700"),
      face("Sahel", "fonts/Sahel.ttf", "100 600"),
      face("Sahel", "fonts/Sahel-Bold.ttf", "700 900"),
      face("Peyda", "fonts/Peyda-Medium.ttf", "100 600"),
      face("Peyda", "fonts/Peyda-Bold.ttf", "700 900"),
      face("VazirmatnVariable", "fonts/Vazirmatn-VariableFont_wght.ttf", "100 900"),
      // AradFD's four "weights" are really four separate static font files, not
      // one variable/weight-range family — registering them all under a shared
      // "AradFD" family (as before) meant the browser silently picked whichever
      // bucket matched the page's requested numeric weight, ignoring which of
      // the four the user actually picked in the Typography selector (e.g.
      // "AradFD Light" could render as Bold under a bold style preset). Each
      // gets its own dedicated family spanning the full weight range instead,
      // so the exact file chosen in the selector is always the one rendered.
      `@font-face{font-family:"AradFDRegular";src:url("${browser.runtime.getURL("fonts/AradFD-Regular.woff2")}") format("woff2");font-weight:100 900;font-style:normal;font-display:swap;}`,
      `@font-face{font-family:"AradFDLight";src:url("${browser.runtime.getURL("fonts/AradFD-Light.woff2")}") format("woff2");font-weight:100 900;font-style:normal;font-display:swap;}`,
      `@font-face{font-family:"AradFDMedium";src:url("${browser.runtime.getURL("fonts/AradFD-Medium.woff2")}") format("woff2");font-weight:100 900;font-style:normal;font-display:swap;}`,
      `@font-face{font-family:"AradFDBold";src:url("${browser.runtime.getURL("fonts/AradFD-Bold.woff2")}") format("woff2");font-weight:100 900;font-style:normal;font-display:swap;}`,
      ...Object.entries({Inter:FONT_FILE_SPECS.Inter,Poppins:FONT_FILE_SPECS.Poppins,Montserrat:FONT_FILE_SPECS.Montserrat}).flatMap(([fam,specs])=>specs.map(([file,weight,range])=>`@font-face{font-family:"${fam}";src:url("${browser.runtime.getURL("fonts/"+file)}") format("woff2");font-weight:${weight};font-style:normal;font-display:swap;unicode-range:${range};}`))
    ].join("\n");
    document.documentElement.appendChild(style);
  }

  // Single source of truth for Typography -> CSS font-family, shared by both
  // the normal cue renderer (makeLine) and the Live-caption renderer
  // (renderLiveCaptionText) so a selected font renders identically in both
  // modes. Only the three approved fonts (Lalezar/Vazirmatn/Estedad) plus
  // fonts actually bundled under /fonts are listed — see the Typography
  // acceptance list in popup.html's #style-font selector, which this must
  // stay in sync with.
  const OVERLAY_FONT_MAP = {
    Lalezar: '"Lalezar",sans-serif',
    Vazirmatn: '"Vazirmatn",sans-serif',
    Estedad: '"Estedad",sans-serif',
    IRANYekanX: '"IRANYekanX",sans-serif',
    DigiTitr: '"DigiTitr",sans-serif',
    Sahel: '"Sahel",sans-serif',
    Peyda: '"Peyda",sans-serif',
    VazirmatnVariable: '"VazirmatnVariable",sans-serif',
    AradFDRegular: '"AradFDRegular",sans-serif',
    AradFDMedium: '"AradFDMedium",sans-serif',
    AradFDBold: '"AradFDBold",sans-serif',
    AradFDLight: '"AradFDLight",sans-serif',
    // English display fonts — Persian text falls through to Vazirmatn.
    Inter: '"Inter","Vazirmatn",sans-serif',
    Poppins: '"Poppins","Vazirmatn",sans-serif',
    Montserrat: '"Montserrat","Vazirmatn",sans-serif'
  };

  // Fonts are ALSO loaded through the FontFace API (fetch the bundled file,
  // hand the bytes to FontFace) instead of relying only on the @font-face
  // <style> that installFonts() injects. A page's CSP font-src (YouTube and
  // others restrict it) can silently block extension-URL @font-face rules,
  // which shows up as "the font never changes on the video" even though the
  // popup's own preview (an extension page, no page CSP) renders it fine.
  // FontFace objects built from raw bytes are not subject to font-src.
  const LATIN_RANGE = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
  const LATIN_EXT_RANGE = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";
  const FONT_FILE_SPECS = {
    Lalezar: [["Lalezar-Regular.ttf", "100 900"]],
    Vazirmatn: [["Vazirmatn-Regular.ttf", "400"], ["Vazirmatn-Medium.ttf", "500 900"], ["Vazirmatn-Light.ttf", "100 300"]],
    Estedad: [["Estedad-Regular.ttf", "400"], ["Estedad-Medium.ttf", "500 900"], ["Estedad-Light.ttf", "100 300"]],
    IRANYekanX: [["IRANYekanX-Regular.ttf", "400"], ["IRANYekanX-Medium.ttf", "500 600"], ["IRANYekanX-Bold.ttf", "700 900"]],
    DigiTitr: [["Digi-Titr-Plus-Bold-Circle.ttf", "700"]],
    Sahel: [["Sahel.ttf", "100 600"], ["Sahel-Bold.ttf", "700 900"]],
    Peyda: [["Peyda-Medium.ttf", "100 600"], ["Peyda-Bold.ttf", "700 900"]],
    VazirmatnVariable: [["Vazirmatn-VariableFont_wght.ttf", "100 900"]],
    AradFDRegular: [["AradFD-Regular.woff2", "100 900"]],
    AradFDLight: [["AradFD-Light.woff2", "100 900"]],
    AradFDMedium: [["AradFD-Medium.woff2", "100 900"]],
    AradFDBold: [["AradFD-Bold.woff2", "100 900"]],
    Inter: [["Inter-400.woff2", "100 600", LATIN_RANGE], ["Inter-ext-400.woff2", "100 600", LATIN_EXT_RANGE], ["Inter-700.woff2", "700 900", LATIN_RANGE], ["Inter-ext-700.woff2", "700 900", LATIN_EXT_RANGE]],
    Poppins: [["Poppins-500.woff2", "100 600", LATIN_RANGE], ["Poppins-ext-500.woff2", "100 600", LATIN_EXT_RANGE], ["Poppins-700.woff2", "700 900", LATIN_RANGE], ["Poppins-ext-700.woff2", "700 900", LATIN_EXT_RANGE]],
    Montserrat: [["Montserrat-500.woff2", "100 700", LATIN_RANGE], ["Montserrat-ext-500.woff2", "100 700", LATIN_EXT_RANGE], ["Montserrat-800.woff2", "800 900", LATIN_RANGE], ["Montserrat-ext-800.woff2", "800 900", LATIN_EXT_RANGE]]
  };
  const fontFamiliesRequested = new Set();
  function ensureFontFamilyLoaded(family) {
    if (!family || fontFamiliesRequested.has(family) || !FONT_FILE_SPECS[family] || typeof FontFace === "undefined") return;
    fontFamiliesRequested.add(family);
    for (const [file, weight, range] of FONT_FILE_SPECS[family]) {
      (async () => {
        try {
          const buf = await (await fetch(browser.runtime.getURL(`fonts/${file}`))).arrayBuffer();
          const desc = { weight, style: "normal", display: "swap" };
          if (range) desc.unicodeRange = range;
          const face = new FontFace(family, buf, desc);
          await face.load();
          document.fonts.add(face);
        } catch (e) { fontFamiliesRequested.delete(family); log("font load failed", family, file, e); }
      })();
    }
  }
  function ensureOverlayFontsFor(fontKey) {
    const stack = OVERLAY_FONT_MAP[fontKey] || OVERLAY_FONT_MAP.Lalezar;
    for (const m of stack.matchAll(/"([^"]+)"/g)) ensureFontFamilyLoaded(m[1]);
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
      if (host.endsWith("twitter.com") || host === "x.com" || host.endsWith(".x.com")) {
        // https://x.com/<user>/status/<id>
        const m = u.pathname.match(/\/status\/(\d+)/);
        return m ? m[1] : "";
      }
      if (host.endsWith("instagram.com")) {
        // https://www.instagram.com/reel/<shortcode>/ or /p/<shortcode>/ or /tv/<shortcode>/
        const m = u.pathname.match(/\/(?:reel|p|tv)\/([a-zA-Z0-9_-]+)/);
        return m ? m[1] : "";
      }
      if (host.endsWith("facebook.com")) {
        // https://www.facebook.com/watch/?v=<id> or /reel/<id> or /.../videos/<id>/
        const v = u.searchParams.get("v");
        if (v) return v;
        const m = u.pathname.match(/\/(?:reel|videos)\/(\d+)/);
        return m ? m[1] : "";
      }
      if (host.endsWith("tiktok.com")) {
        // https://www.tiktok.com/@user/video/<id>
        const m = u.pathname.match(/\/video\/(\d+)/);
        return m ? m[1] : "";
      }
      if (host.endsWith("threads.com") || host.endsWith("threads.net")) {
        // https://www.threads.com/@user/post/<shortcode>
        const m = u.pathname.match(/\/post\/([a-zA-Z0-9_-]+)/);
        return m ? m[1] : "";
      }
      if (host.endsWith("udemy.com")) {
        // https://www.udemy.com/course/<slug>/learn/lecture/<id>
        const m = u.pathname.match(/\/lecture\/(\d+)/);
        return m ? m[1] : u.pathname;
      }
      if (host.endsWith("linkedin.com")) {
        // https://www.linkedin.com/learning/<course-slug>/<video-slug>
        const m = u.pathname.match(/\/learning\/([^/?#]+\/[^/?#]+)/);
        return m ? m[1] : u.pathname;
      }
      if (host === "courses.edx.org" || host === "learning.edx.org") {
        // Legacy LMS: https://courses.edx.org/courses/<course-id>/courseware/.../<unit-id>/
        // Learner MFE: https://learning.edx.org/course/course-v1:.../block-v1:.../block-v1:<unit-id>/...
        const legacy = u.pathname.match(/\/courseware\/.*?\/([a-zA-Z0-9_@:+-]+)\/?$/);
        if (legacy) return legacy[1];
        const blocks = u.pathname.match(/block-v1:[^/]+/g);
        if (blocks?.length) return blocks[blocks.length - 1];
        return u.pathname;
      }
      if (host.endsWith("ted.com")) {
        // https://www.ted.com/talks/<talk-slug>
        const m = u.pathname.match(/\/talks\/([a-zA-Z0-9_-]+)/);
        return m ? m[1] : u.pathname;
      }
      if (host.endsWith("khanacademy.org")) {
        // https://www.khanacademy.org/.../v/<video-slug> — most KA videos are
        // YouTube iframe embeds anyway, handled by the youtube.com branch above
        // (all_frames:true) once inside the iframe; this only covers the rare
        // page-level fallback if KA ever serves its own <video> directly.
        return u.pathname;
      }
      return "";
    } catch (_) { return ""; }
  }

  // On single-video pages (YouTube, Vimeo, Aparat, Coursera) this is just the
  // one <video> element — unchanged behavior. Feed-style platforms (X/Twitter,
  // Instagram) can have several <video> elements on screen at once (autoplay
  // previews in a timeline); prefer the largest on-screen one as the video the
  // person is actually watching, rather than always the first in DOM order.
  function pickPrimaryVideo() {
    const all = Array.from(document.querySelectorAll("video.html5-main-video, video.video-stream, video"));
    if (all.length <= 1) return all[0] || null;
    let best = null, bestArea = 0;
    for (const v of all) {
      const r = v.getBoundingClientRect();
      const area = Math.max(0, r.width) * Math.max(0, r.height);
      if (area > bestArea) { bestArea = area; best = v; }
    }
    return best || all[0];
  }

  function getVideo() {
    const video = pickPrimaryVideo();
    if (video !== state.video) {
      state.video = video;
      bindVideoEvents(video);
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

  function bindVideoEvents(video) {
    if (state.videoEventsBoundTo === video) return;

    if (state.videoEventsBoundTo && state.videoEventHandlers) {
      const old = state.videoEventsBoundTo;
      const h = state.videoEventHandlers;
      for (const [name, fn] of Object.entries(h)) old.removeEventListener(name, fn);
    }

    state.videoEventsBoundTo = video || null;
    state.videoEventHandlers = null;
    if (!video) return;

    const onTimeUpdate = () => renderAtCurrentTime();
    const onSeek = () => {
      state.lastShownId = "";
      state.karaokeIndex = -1;
      renderAtCurrentTime();
    };
    const onPlay = () => {
      scheduleScan(0);
      renderAtCurrentTime();
    };
    const onLoadedMetadata = () => {
      scheduleScan(0);
      renderAtCurrentTime();
    };

    state.videoEventHandlers = {
      timeupdate: onTimeUpdate,
      seeking: onSeek,
      seeked: onSeek,
      play: onPlay,
      loadedmetadata: onLoadedMetadata
    };
    video.addEventListener("timeupdate", onTimeUpdate, { passive: true });
    video.addEventListener("seeking", onSeek, { passive: true });
    video.addEventListener("seeked", onSeek, { passive: true });
    video.addEventListener("play", onPlay, { passive: true });
    video.addEventListener("loadedmetadata", onLoadedMetadata, { passive: true });
  }

  function scheduleScan(delay = 0) {
    if (state.scanTimer) clearTimeout(state.scanTimer);
    state.scanTimer = setTimeout(() => {
      state.scanTimer = null;
      scan();
      scheduleScan(state.cues.length ? 1200 : 450);
    }, Math.max(0, delay));
  }

  function resetTrack() {
    state.cues = [];
    state.generatedCues = [];
    state.translations.clear();
    state.translating.clear();
    state.translationQueueRunning = false;
    state.trackKey = "";
    state.trackUrl = "";
    state.trackLanguage = "";
    state.currentTrack = null;
    state.capturedCaptionUrl = "";
    state.capturedCaptionLang = "";
    state.capturedUdemyVttUrl = "";
    state.persistentCacheKey = "";
    state.persistentCacheLoaded = false;
    if (state.aheadPump) { clearInterval(state.aheadPump); state.aheadPump = null; }
    state.aheadBusy = false;
    state.fetching = false;
    state.lastShownId = "";
    state.liveCandidate = null;
    clearTimeout(state.liveTimer);
    state.liveTimer = null;
    if (state.liveForcedPause) { state.video?.play().catch(() => {}); }
    liveHold.capturing = false;
    liveHoldReset();
    liveRefreshButton();
    state.liveCue = null;
    state.liveHoldAt = null;
    state.liveForcedPause = false;
    state.lastLiveCueStart = null;
    state.autoEnabledNativeCC = false;
    state.lastNativeCcOnObserved = null;
    state.ccSuggestDismissed = false;
    state.ccSuggestAt = 0;
    state.nativeCcRefreshInFlight = false;
    state.nativeCcRefreshAt = 0;
    state.nativeCcRefreshAttempts = 0;
    if (state.nativeCcRefreshTimer) { clearTimeout(state.nativeCcRefreshTimer); state.nativeCcRefreshTimer = null; }
    state.karaokeWords = [];
    state.karaokeIndex = -1;
    state.karaokeCueId = "";
    if (state.udemyCcObserver) { state.udemyCcObserver.disconnect(); state.udemyCcObserver = null; }
    if (state.udemyCcBodyObserver) { state.udemyCcBodyObserver.disconnect(); state.udemyCcBodyObserver = null; }
    state.udemyCcLastText = "";
    hideCcSuggest();
    state.session++;
    // Restart the per-frame loop: it was cancelled here and nothing else restarted it, which left
    // karaoke highlighting and the learning pause/replay checks without a frame loop after a video change.
    startKaraokeLoop();
    checkBootstrapTimedText();
  }

  // Proof that a caption track exists even when none of Subify's own
  // discovery tiers have managed to read it yet (see checkCaptionSuggestion):
  // if YouTube's own caption box is actually rendering text right now, a
  // real subtitle track is unambiguously there — "we haven't found it" must
  // never be presented as "it doesn't exist" (that's a different, false
  // claim). Checked directly against the DOM rather than any cached flag.
  function nativeCaptionsRendering() {
    const el = state.player?.querySelector('.ytp-caption-window-container, .captions-text');
    return !!(el && el.textContent && el.textContent.trim().length > 0);
  }

  function hideCcSuggest() {
    document.getElementById("subify-cc-suggest")?.remove();
  }

  // Point 3 of the workflow: a video having no reachable captions must never
  // just silently mean "no subtitles" — Subify can still produce them from
  // the audio (the same STT pipeline dubbing already uses, in captions-only
  // mode so the video's own audio keeps playing untouched). Starting tab
  // audio capture is never done silently, though — it's a real permission
  // with real resource cost, so this only ever offers a one-click opt-in
  // once discovery has had a fair chance and clearly found nothing, and
  // never appears again for this video once dismissed, once real captions
  // are found after all, or once dubbing/generated captions are running.
  function checkCaptionSuggestion(now) {
    if (state.cues.length || state.generatedCues.length || state.ccSuggestDismissed) { hideCcSuggest(); return; }
    if (!state.player || document.getElementById("subify-cc-suggest")) return;
    // YouTube's own caption box is rendering real text — a track unambiguously
    // exists, Subify has just not managed to read it yet (see Tier 1–4 in
    // getCaptionTracks()). Never claim "no captions" in that case; keep the
    // grace clock from starting at all so discovery gets unlimited time to
    // eventually catch a network request or a transcript-panel read instead
    // of this turning into a false "doesn't exist" claim.
    if (nativeCaptionsRendering()) { state.ccSuggestAt = 0; return; }
    if (!state.ccSuggestAt) { state.ccSuggestAt = Date.now(); return; }
    // Give normal discovery (native track, captured network request, the
    // YouTube-watch-page fallback) a real chance first — showing this the
    // instant a video starts would just be noise for the (much more common)
    // case where a real caption track shows up within a couple of seconds.
    if (Date.now() - state.ccSuggestAt < 5000) return;
    browser.storage.local.get("subify_dubbing_enabled").then(({ subify_dubbing_enabled }) => {
      if (subify_dubbing_enabled === true) return; // already running — activeCue() will pick up generatedCues itself
      if (state.cues.length || state.generatedCues.length || state.ccSuggestDismissed) return;
      if (document.getElementById("subify-cc-suggest")) return;
      const box = document.createElement("div");
      box.id = "subify-cc-suggest";
      box.className = "subify-cc-suggest";
      box.innerHTML = `
        <span class="subify-cc-suggest-text">Subify نتونست زیرنویس یوتیوب رو بگیره. از روی صدا بسازمش؟</span>
        <button type="button" class="subify-cc-suggest-yes">بله، بساز</button>
        <button type="button" class="subify-cc-suggest-no" aria-label="بستن">✕</button>
      `;
      box.querySelector(".subify-cc-suggest-no").addEventListener("click", () => {
        state.ccSuggestDismissed = true;
        hideCcSuggest();
      });
      box.querySelector(".subify-cc-suggest-yes").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.textContent = "در حال شروع…";
        try {
          const { pd_settings = {} } = await browser.storage.local.get("pd_settings");
          // Captions-only: generate translated captions from audio without
          // replacing the video's own sound with a TTS dub.
          await browser.storage.local.set({ pd_settings: { ...pd_settings, dubbingAudioEnabled: false } });
          const r = await browser.runtime.sendMessage({ type: "subify-set-dubbing", enabled: true });
          if (r?.authRequired) subifyAuthBlockNow();
          if (!r?.ok) throw new Error(r?.error || "failed");
          await browser.storage.local.set({ subify_dubbing_enabled: true });
          state.ccSuggestDismissed = true;
          hideCcSuggest();
        } catch (e) {
          btn.disabled = false;
          btn.textContent = "بله، بساز";
          const textEl = box.querySelector(".subify-cc-suggest-text");
          if (textEl) textEl.textContent = String(e?.message || "شروع نشد (دوباره امتحان کن)");
        }
      });
      state.player.appendChild(box);
    }).catch(() => {});
  }


  // Picks up a timedtext URL page-hook.js already captured for THIS video
  // before subtitle-overlay.js's own event listener was attached (it only
  // runs at document_idle; YouTube can issue the request as early as
  // document_start if captions were already on from a previous visit). Only
  // accepted when the URL's own `v` param matches the current video, so a
  // stale capture from a prior SPA navigation is never used for the wrong
  // video. Without this, that race meant waiting for the slower discovery
  // tiers (or a second timedtext request that may not come) before any
  // caption appeared at all.
  async function checkBootstrapTimedText() {
    try {
      const raw = window.__subifyLastTimedText;
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.videoId && state.videoId && data.videoId !== state.videoId) return;
      await handleCapturedTimedText(raw);
      // A bootstrap URL is single-use. Keeping a stale signed URL around can
      // poison a later SPA navigation to another video.
      window.__subifyLastTimedText = null;
    } catch (_) {}
  }

  function getNativeSubtitleButton() {
    return state.player?.querySelector('.ytp-subtitles-button, button.ytp-subtitles-button') ||
      document.querySelector('.html5-video-player .ytp-subtitles-button');
  }

  function nativeSubtitlesOn() {
    const b = getNativeSubtitleButton();
    return !!b && b.getAttribute('aria-pressed') === 'true';
  }

  // Turns YouTube CC on only when the user has not already enabled it. Once
  // CC is ON, caption acquisition uses the player reload API below instead of
  // repeatedly clicking the visible button. This avoids the refresh bug where
  // YouTube restores the button as ON but does not rebuild its caption request.
  function ensureNativeCaptionsOn() {
    if (Date.now() - (state.lastAutoCcClickAt || 0) < 2000) return;
    const btn = getNativeSubtitleButton();
    if (!btn || btn.getAttribute('aria-pressed') === 'true') return;
    state.lastAutoCcClickAt = Date.now();
    state.autoEnabledNativeCC = true;
    btn.click();
    log('auto-enabled YouTube captions to capture the timed track');
  }

  function getCaptionTrackForPlayerReload() {
    try {
      const direct = captionTracksFromResponse(extractPlayerResponseFromDom());
      if (direct.length) return pickTrack(direct);
    } catch (_) {}
    return state.currentTrack && !state.currentTrack.native ? state.currentTrack : null;
  }

  function requestNativeCaptionReload(hard = false) {
    try {
      const track = getCaptionTrackForPlayerReload();
      const safeTrack = track ? {
        languageCode: track.languageCode || '',
        vssId: track.vssId || track.vss_id || '',
        kind: track.kind || (track.isAutoGenerated ? 'asr' : ''),
        rtl: !!track.rtl,
        name: track.name || null
      } : null;
      window.dispatchEvent(new CustomEvent('subify-youtube-reload-captions', {
        detail: { hard: !!hard, videoId: state.videoId || getVideoIdFromUrl(), track: safeTrack }
      }));
      return true;
    } catch (e) {
      log('caption reload event failed', e);
      return false;
    }
  }

  function forceNativeCaptionRefresh() {
    if (state.nativeCcRefreshInFlight) return;
    if (state.cues.length || state.capturedCaptionUrl || nativeCaptionsRendering()) return;
    if (!nativeSubtitlesOn()) return;

    const now = Date.now();
    if (now - (state.nativeCcRefreshAt || 0) < 1800) return;

    state.nativeCcRefreshInFlight = true;
    state.nativeCcRefreshAt = now;
    state.nativeCcRefreshAttempts += 1;
    const hard = state.nativeCcRefreshAttempts >= 2;
    requestNativeCaptionReload(hard);
    log(`requested YouTube caption reload (attempt ${state.nativeCcRefreshAttempts}, hard=${hard})`);

    // Do not declare success merely because the DOM button is still ON. The
    // actual success signal is a captured timedtext request or parsed cues.
    //
    // There used to be a hard cap (3 attempts) here, plus a self-scheduled
    // retry 950ms later. Both were bugs: the 950ms retry always landed
    // *before* the 1800ms cooldown above had elapsed, so it silently did
    // nothing instead of actually retrying — leaving, in practice, only one
    // real soft attempt and one real hard attempt before the cap permanently
    // stopped all retries for that video. When YouTube's player didn't act on
    // either of those two tries, the only way out was the viewer manually
    // toggling YouTube's own CC button off and on (a real user gesture,
    // which YouTube always honors, unlike our reload API calls).
    //
    // Retrying is cheap (a no-op module reload call) and this is only ever
    // reached while there is still no caption to show, so there is no good
    // reason to ever stop: just keep retrying, gated by the cooldown above,
    // for as long as CC stays ON with nothing rendering. scan() already calls
    // this on every tick (~450-500ms while undiscovered), which is what
    // actually drives each retry once its cooldown clears — this timer's only
    // job is to release the in-flight guard afterward.
    state.nativeCcRefreshTimer = setTimeout(() => {
      state.nativeCcRefreshTimer = null;
      state.nativeCcRefreshInFlight = false;
    }, 950);
  }

  // Detects the viewer clicking YouTube's CC button themselves. If they turn
  // it off after Subify auto-turned it on, that's still just them taking the
  // decision back — either way it's no longer "Subify's" to revert later. Call
  // on every scan tick so ownership never goes stale.
  function trackNativeCcOwnership() {
    const on = nativeSubtitlesOn();
    if (state.lastNativeCcOnObserved != null && on !== state.lastNativeCcOnObserved
        && Date.now() - (state.lastAutoCcClickAt || 0) > 500) {
      state.autoEnabledNativeCC = false;
    }
    state.lastNativeCcOnObserved = on;
  }

  // Undoes ensureNativeCaptionsOn()'s click when Subify's own subtitle feature
  // turns off — so a viewer who never touched YouTube's CC button themselves
  // isn't left with it stuck on (and no idea Subify was the one that flipped
  // it). Never touches it if the viewer has interacted with it since.
  function revertAutoEnabledNativeCC() {
    if (!state.autoEnabledNativeCC) return;
    state.autoEnabledNativeCC = false;
    const btn = getNativeSubtitleButton();
    if (btn && btn.getAttribute('aria-pressed') === 'true') btn.click();
  }

  async function ensureSettingsLoaded() {
    if (state.videoSettingsLoaded) return;
    if (!state.videoId) state.videoId = getVideoIdFromUrl();
    if (!state.videoId) return;
    try {
      await loadSettings();
    } catch (e) {
      log(`settings load failed before caption processing: ${e?.message || e}`, 'warn');
    }
  }

  async function handleCapturedTimedText(detail) {
    // On a hard refresh, page-hook.js can capture timedtext before the idle
    // content script has finished loading settings. If we start translation
    // immediately, the first batch can run with DEFAULTS (usually no API key)
    // and fail silently. The captions themselves still load, which makes this
    // bug look like "refresh fixed subtitles but translation is broken".
    await ensureSettingsLoaded();
    if (!detail || state.settings.subtitleEnabled === false) return;
    // Ignore ad timedtext requests entirely. Keep the already-discovered main-video
    // track alive so skipping the ad cannot erase the real transcript.
    if (state.player?.classList?.contains("ad-showing")) return;
    try {
      const data = typeof detail === 'string' ? JSON.parse(detail) : detail;
      const url = String(data?.url || '');
      if (!url || !url.includes('/api/timedtext')) return;
      if (/[?&]tlang=/.test(url)) return;
      if (data?.videoId && state.videoId && data.videoId !== state.videoId) return;
      state.capturedCaptionUrl = url;
      state.capturedCaptionLang = String(data?.lang || '');
      log(`captured YouTube timedtext (${state.capturedCaptionLang || 'auto'})`);
      void fetchCapturedTrack(url, state.session);
    } catch (_) {}
  }

  async function fetchCapturedTrack(url, session) {
    await ensureSettingsLoaded();
    if (!url || session !== state.session) return;
    if (state.fetching) return;
    const cacheKey = url;
    const cached = state.trackCache.get(cacheKey);
    if (cached?.length) {
      state.cues = cached;
      state.trackKey = withTargetLang(`${state.videoId}|captured|${url}`);
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
      const key = withTargetLang(`${state.videoId}|captured|${url}`);
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

  // Udemy has no native <track>, and neither its Transcript sidebar nor its
  // on-screen caption box carry per-cue timing (see the long comment above
  // observeUdemyCaptionBox). The one place real timing exists is the actual
  // .vtt file Udemy's own player fetches once captions are turned on —
  // page-hook.js's Resource Timing sweep on udemy.com catches that request
  // (including one that fired before this script loaded) and hands the URL
  // here. This is strictly better than the live caption-box observer: it
  // gets the FULL timed cue list up front, so translation can run ahead of
  // playback instead of just-in-time per line. Once real cues land here,
  // activeCue() prefers state.cues over state.generatedCues automatically,
  // so the box-observer fallback (if it had already started) steps aside on
  // its own — no coordination needed between the two paths.
  async function handleCapturedUdemyVtt(detail) {
    await ensureSettingsLoaded();
    if (!detail || state.settings.subtitleEnabled === false) return;
    try {
      const data = typeof detail === 'string' ? JSON.parse(detail) : detail;
      const url = String(data?.url || '');
      if (!url) return;
      // A stale request from the previous lecture can still surface via
      // Resource Timing right after an in-page (SPA) navigation to a new
      // lecture; state.videoId is this Udemy page's lecture id (see
      // getVideoIdFromUrl), so drop anything that doesn't match it.
      if (data?.lectureId && state.videoId && data.lectureId !== state.videoId) return;
      if (state.capturedUdemyVttUrl === url) return;
      state.capturedUdemyVttUrl = url;
      log('captured Udemy caption .vtt url');
      void fetchCapturedUdemyVtt(url, state.session);
    } catch (_) {}
  }

  async function fetchCapturedUdemyVtt(url, session) {
    await ensureSettingsLoaded();
    if (!url || session !== state.session) return;
    if (state.fetching) return;
    const cached = state.trackCache.get(url);
    if (cached?.length) {
      state.cues = cached;
      state.trackKey = withTargetLang(`${state.videoId}|udemy-vtt|${url}`);
      state.trackUrl = url;
      await loadPersistentTranslations();
      const now = Number(state.video?.currentTime || 0);
      void queueTranslateAll(cached, session, now);
      return;
    }
    state.fetching = true;
    try {
      // Signed CDN URL — the signature itself is the auth, so this is
      // fetched without credentials. A credentialed cross-origin request
      // would be blocked outright if the CDN answers with a wildcard
      // Access-Control-Allow-Origin, which is the common case for this kind
      // of signed-asset host.
      const res = await fetch(url, { credentials: 'omit', cache: 'no-store' });
      const body = await res.text();
      if (!res.ok || !body.trim()) throw new Error(`udemy vtt HTTP ${res.status}`);
      const cues = parseVtt(body);
      if (!cues.length) throw new Error('udemy vtt returned no cues');
      if (session !== state.session) return;
      const key = withTargetLang(`${state.videoId}|udemy-vtt|${url}`);
      const old = new Map(state.translations);
      state.cues = cues;
      state.trackKey = key;
      state.trackUrl = url;
      state.persistentCacheLoaded = false;
      state.translations.clear();
      for (const [id, fa] of old) if (cues.some(c => c.id === id)) state.translations.set(id, fa);
      state.trackCache.set(url, cues);
      await loadPersistentTranslations();
      log(`loaded ${cues.length} vtt cues from Udemy`);
      void publishSubtitleCues();
      const now = Number(state.video?.currentTime || 0);
      void queueTranslateAll(cues, session, now);
    } catch (e) {
      log('captured udemy vtt fetch failed', e);
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
    classic:{bg:'#0B0E13',color:'#F8FAFC',hl:'#FFB35C',radius:10,weight:600,shadowBlur:8,outlineWidth:0,padding:9,max:86,position:'bottom',effect:'classic'},
    youtube:{bg:'#050505',color:'#FFFFFF',hl:'#FFFFFF',radius:3,weight:600,shadowBlur:2,outlineWidth:0,padding:5,max:82,position:'bottom',effect:'youtube'},
    pill:{bg:'#FFFFFF',color:'#111318',hl:'#B66A00',radius:999,weight:700,shadowBlur:10,outlineWidth:0,padding:9,max:86,position:'bottom',effect:'pill'},
    snapchat:{bg:'#FFFC00',color:'#050505',hl:'#E50000',radius:4,weight:800,shadowBlur:5,outlineWidth:0,padding:7,max:92,position:'bottom',effect:'snapchat'},
    cinema:{bg:'#050505',color:'#F7F1E5',hl:'#E8C878',radius:1,weight:500,shadowBlur:22,outlineWidth:0,padding:4,max:78,position:'bottom',effect:'cinema'},
    minimal:{bg:'#11151B',color:'#F2F4F7',hl:'#AEB8C7',radius:4,weight:500,shadowBlur:0,outlineWidth:0,padding:5,max:80,position:'bottom',effect:'minimal'},
    typewriter:{bg:'#0B0E13',color:'#F8FAFC',hl:'#FF4FD8',radius:4,weight:600,shadowBlur:8,outlineWidth:0,padding:7,max:88,position:'bottom',effect:'typewriter'},
    sunset:{bg:'#3B1022',color:'#FFF4E9',hl:'#FFD166',radius:18,weight:700,shadowBlur:20,outlineWidth:0,padding:10,max:88,position:'bottom',effect:'sunset'},
    blueprint:{bg:'#07131A',color:'#E9FDFF',hl:'#4FF8FF',radius:2,weight:600,shadowBlur:10,outlineWidth:1,padding:7,max:88,position:'bottom',effect:'blueprint'}
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
    const faFontFamily=OVERLAY_FONT_MAP[s.font]||OVERLAY_FONT_MAP.Lalezar;
    const enFontFamily=OVERLAY_FONT_MAP[s.fontEn||"Inter"]||OVERLAY_FONT_MAP.Inter;
    ensureOverlayFontsFor(s.font);
    ensureOverlayFontsFor(s.fontEn||"Inter");
    // Apply the Persian/translation font and English/original font separately.
    // YouTube can apply !important typography rules inside the player, so use
    // explicit inline declarations on the actual text-bearing nodes.
    el.style.setProperty("font-family", faFontFamily, "important");
    el.querySelectorAll(".subify-subtitle-line--fa").forEach(node=>{
      node.style.setProperty("font-family", faFontFamily, "important");
      node.querySelectorAll(".subify-subtitle-text,.subify-word").forEach(x=>x.style.setProperty("font-family", faFontFamily, "important"));
    });
    el.querySelectorAll(".subify-subtitle-line--orig").forEach(node=>{
      node.style.setProperty("font-family", enFontFamily, "important");
      node.querySelectorAll(".subify-subtitle-text,.subify-word").forEach(x=>x.style.setProperty("font-family", enFontFamily, "important"));
    });
    // FontFace loads asynchronously. Re-apply after the selected face is
    // available so switching fonts in the popup is reflected immediately.
    const fontFamilyName = String(s.font || "Lalezar");
    const fontEnName = String(s.fontEn || "Inter");
    if (document.fonts?.load) {
      Promise.all([document.fonts.load(`700 30px "${fontFamilyName}"`),document.fonts.load(`700 30px "${fontEnName}"`)]).then(()=>{
        if (state.player?.contains(el)) {
          el.style.setProperty("font-family", faFontFamily, "important");
          el.querySelectorAll(".subify-subtitle-line--fa").forEach(node=>{
            node.style.setProperty("font-family", faFontFamily, "important");
            node.querySelectorAll(".subify-subtitle-text,.subify-word").forEach(x=>x.style.setProperty("font-family", faFontFamily, "important"));
          });
          el.querySelectorAll(".subify-subtitle-line--orig").forEach(node=>{
            node.style.setProperty("font-family", enFontFamily, "important");
            node.querySelectorAll(".subify-subtitle-text,.subify-word").forEach(x=>x.style.setProperty("font-family", enFontFamily, "important"));
          });
        }
      }).catch(()=>{});
    }
    el.style.fontSize=`${size}px`;
    el.style.setProperty("--subify-bg",hexRgba(s.bgColor||p.bg,opacity));
    el.style.setProperty("--ink",s.textColor||p.color);
    el.style.setProperty("--ink-2",s.highlightColor||p.hl);
    el.style.setProperty("--ink-3",s.highlightColor||p.hl);
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
    el.dataset.effect=String(p.effect||preset).toLowerCase();
    el.classList.toggle("subify-preset-pill",preset==="pill");
  }

  function hide() {
    const el = state.player?.querySelector(`#${OVERLAY_ID}`);
    if (!el) return;
    el.classList.remove("subify-visible");
    el.textContent = "";
  }

  // Separate, deliberately simple display path for Live-engine STT captions
  // (see background.js's "live-cue" handler) — used only when there's no
  // real caption track to translate and no chunk-engine generated cues
  // either (typically a live stream, or a video YouTube never generated
  // captions for). Bypasses activeCue()/showCue() entirely; scan() steps
  // aside to pumpLiveCaption()/pumpLivePacing() below in that case.
  //
  // Each cue still carries the real video-timeline start/end it was spoken
  // at (see offscreen.js), but translation+TTS takes real time, so by the
  // time a cue finishes, playback may already be past cue.start. Showing it
  // immediately on arrival would mean the caption tracks the (also delayed)
  // dub audio instead of the real video position, drifting further behind
  // the longer the video plays. pumpLivePacing() avoids that by holding
  // playback at the moment new speech starts (state.liveHoldAt, set from
  // "live-speech-start") until the finished cue for it arrives — so once
  // playback resumes, the caption always lands on its real timestamp.
  function renderLiveCaptionText(text) {
    installFonts();
    const el = ensureOverlay();
    if (!el) return;
    // Selected-font pipeline: Typography setting -> OVERLAY_FONT_MAP -> here.
    // Set explicitly on the text-bearing elements too (not just the shared
    // overlay ancestor) so the exact selected font renders in Live mode the
    // same as normal cues, regardless of any inherited/cascaded value.
    const fontFamily = OVERLAY_FONT_MAP[state.settings.font] || OVERLAY_FONT_MAP.Lalezar;
    el.textContent = "";
    const line = document.createElement("div");
    line.className = "subify-subtitle-line subify-live-caption";
    line.setAttribute("dir", "rtl");
    line.style.setProperty("font-family", fontFamily, "important");
    const span = document.createElement("span");
    span.className = "subify-subtitle-text";
    span.style.setProperty("font-family", fontFamily, "important");
    span.textContent = clean(text);
    line.appendChild(span);
    el.appendChild(line);
    el.classList.add("subify-visible");
  }

  function pumpLiveCaption(now) {
    const cue = state.liveCue;
    if (!cue) return;
    if (now >= cue.start && now < cue.end) {
      if (state.lastLiveCueStart !== cue.start) {
        state.lastLiveCueStart = cue.start;
        if (state.settings.subtitleEnabled) renderLiveCaptionText(cue.text);
      }
    } else if (now >= cue.end) {
      hide();
    }
  }

  // Holds the video right at the start of an in-progress (not yet
  // translated) utterance instead of letting it play on past it. Released as
  // soon as the matching "subify-live-cue" arrives (see the onMessage
  // handler below) or after LIVE_HOLD_TIMEOUT_MS as a safety net, in case a
  // cue is ever dropped (e.g. the model connection hiccups).
  const LIVE_HOLD_TIMEOUT_MS = 12000;
  function pumpLivePacing(video, now) {
    if (state.liveHoldAt != null && now >= state.liveHoldAt - 0.05) {
      if (!video.paused && !state.liveForcedPause) {
        video.pause();
        state.liveForcedPause = true;
        state.liveHoldSetAt = Date.now();
      } else if (state.liveForcedPause && Date.now() - state.liveHoldSetAt > LIVE_HOLD_TIMEOUT_MS) {
        log("live caption took too long: releasing the hold and continuing without it");
        state.liveHoldAt = null;
        state.liveForcedPause = false;
        video.play().catch(() => {});
      }
    }
  }

  // ---------- Live Class: pausing a live stream in Active mode ----------
  // Active mode (smartMode "active") on live captions: a pause control holds the caption queue and pauses the primary
  // video. The captured audio keeps running while the video is paused, so on resume the caption clock moves back by
  // the time spent paused. Cues that arrive during the pause are kept and only the newest still on screen is shown.
  // The pause also stops the live dub in offscreen.js (liveNotifyPause, relayed by background.js). The original tab audio and
  // the recording keep running. Without a video element there is no control, and the options page keeps its note.
  const LIVE_PAUSE_UI = {
    fa: { pause: "مکث", play: "ادامه پخش" }, en: { pause: "Pause", play: "Resume" }, ar: { pause: "إيقاف مؤقت", play: "متابعة" },
    es: { pause: "Pausar", play: "Reanudar" }, tr: { pause: "Duraklat", play: "Devam et" }, fr: { pause: "Pause", play: "Reprendre" },
    de: { pause: "Pause", play: "Fortsetzen" }
  };
  function livePauseUi() {
    return LIVE_PAUSE_UI[String(state.learnCfg?.nativeLang || "fa")] || LIVE_PAUSE_UI.en;
  }
  const liveHold = { capturing: false, userPaused: false, held: [], pausedWall: 0, video: null, button: null, resume: null, early: [], settleTimer: 0 };
  // Meeting tiles (Google Meet, Zoom, Teams, Webex) play a MediaStream over WebRTC. Its currentTime only moves while
  // frames arrive, so a participant with the camera off freezes it while the meeting audio, and so the live dub,
  // keeps going. Live captions are timed on the video clock: for a MediaStream that is still playing but has stalled,
  // the clock runs on wall time instead. Other video (YouTube live, HLS) keeps its own clock.
  const liveClock = { video: null, videoT: 0, t: 0, wall: 0 };
  function liveClockNow(video) {
    const vt = Number(video.currentTime || 0);
    const wall = Date.now();
    if (liveClock.video !== video || video.srcObject == null) {
      liveClock.video = video; liveClock.videoT = vt; liveClock.t = vt; liveClock.wall = wall;
      return vt;
    }
    const dt = Math.min(3, Math.max(0, (wall - liveClock.wall) / 1000));
    liveClock.wall = wall;
    const moved = Math.abs(vt - liveClock.videoT) > 0.001;
    liveClock.videoT = vt;
    if (moved || video.paused) liveClock.t = vt;
    else liveClock.t += dt;
    return liveClock.t;
  }
  function liveCanPause() {
    return !!(liveHold.capturing && state.video && state.player && state.learnCfg && state.learnCfg.smartMode === "active");
  }
  // Clears a hold left from an earlier capture. The video is played again if the hold had paused it.
  function liveHoldReset() {
    liveHold.resume = null;
    liveHold.early = [];
    if (!liveHold.userPaused) return;
    liveHold.userPaused = false;
    liveHold.held = [];
    liveHold.pausedWall = 0;
    liveNotifyPause(false);
    try { state.video?.play().catch(() => {}); } catch (_) { /* the player refused: nothing else to undo */ }
  }
  function liveBeginCapture() {
    liveClock.video = null;
    liveHold.capturing = true;
    liveHoldReset();
    liveRefreshButton();
  }
  // The page's pause also pauses the live dub in the offscreen document (through background.js). Active mode only.
  function liveNotifyPause(on) {
    try { browser.runtime.sendMessage({ type: "subify-live-pause", paused: !!on }).catch(() => {}); } catch (_) { /* no runtime: nothing to tell */ }
  }
  function liveUserPause() {
    if (!liveCanPause() || liveHold.userPaused) return;
    if (liveHold.resume) liveSettleResume(state.video, Infinity);
    liveHold.userPaused = true;
    liveHold.pausedWall = Date.now();
    liveHold.held = [];
    state.liveHoldAt = null;
    state.liveForcedPause = false;
    try { state.video.pause(); } catch (_) { /* the hold still stops new captions */ }
    liveNotifyPause(true);
    liveRefreshButton();
  }
  function liveUserResume() {
    if (!liveHold.userPaused) return;
    const v = state.video;
    liveHold.userPaused = false;
    const pausedFor = Math.max(0, (Date.now() - liveHold.pausedWall) / 1000);
    liveHold.pausedWall = 0;
    // The captured audio ran on during the pause. How far the caption clock moves back depends on where the player
    // continues from: liveSettleResume() measures it on the first playing ticks. Cues that were held keep their times.
    liveHold.resume = { wall: Date.now(), from: Number(v?.currentTime || 0), pausedFor };
    const now = Number(v?.currentTime || 0);
    const held = liveHold.held.filter((c) => c.end > now);
    liveHold.held = [];
    state.liveHoldAt = null;
    state.liveForcedPause = false;
    if (held.length) { state.liveCue = held[held.length - 1]; state.lastLiveCueStart = null; }
    try { v?.play().catch(() => {}); } catch (_) { /* the player refused: captions continue without it */ }
    liveNotifyPause(false);
    liveRefreshButton();
  }
  // After a resume the player either continues from the paused point (a DVR window) or jumps forward to the live edge.
  // The caption clock moves back by the part of the pause the video did not jump over: a full move for DVR, none for a
  // live-edge jump. Measured on the first tick that plays (at least 0.3 s after the resume); `now` is the video time.
  function liveSettleResume(video, now) {
    const r = liveHold.resume;
    if (!r || !video) return;
    // now === Infinity: the viewer paused again before the player settled, so the pause is taken as a continuation.
    const settling = now === Infinity;
    const elapsed = (Date.now() - r.wall) / 1000;
    // A player that stays paused for 3 s after the resume is treated as continuing from the paused point.
    if (!settling && (elapsed < 0.3 || (video.paused && elapsed < 3))) return;
    const jump = settling ? 0 : Math.min(r.pausedFor, Math.max(0, now - r.from - elapsed));
    state.liveTimeBase -= r.pausedFor - jump;
    liveHold.resume = null;
    const early = liveHold.early;
    liveHold.early = [];
    if (early.length) showLiveCue(early[early.length - 1]);
  }
  // subify-live-cue: while the hold is on, the cue waits; otherwise it is shown as before.
  function liveCueAt(msg) {
    return { start: state.liveTimeBase + (Number(msg.start) || 0), end: state.liveTimeBase + (Number(msg.end) || 0), text: msg.text };
  }
  function showLiveCue(msg) {
    state.liveHoldAt = null;
    state.liveCue = liveCueAt(msg);
    if (state.liveForcedPause) { state.liveForcedPause = false; state.video?.play().catch(() => {}); }
  }
  function onLiveCue(msg) {
    if (liveHold.userPaused) {
      liveHold.held = [...liveHold.held, liveCueAt(msg)].slice(-5);
      return;
    }
    // Between a resume and its settle the clock is not final: the cue waits, so it is timed after the shift.
    if (liveHold.resume) {
      liveHold.early = [...liveHold.early, msg].slice(-5);
      // No timeupdate comes while the player stays paused: a settle is forced 3.1 s after the resume at the latest.
      if (!liveHold.settleTimer) liveHold.settleTimer = setTimeout(() => { liveHold.settleTimer = 0; renderAtCurrentTime(); }, 3100);
      return;
    }
    showLiveCue(msg);
  }
  // The player's own pause and play count as the viewer's pause and resume. Our own pauses are skipped: they set
  // liveHold.userPaused first, and a pacing pause sets state.liveForcedPause.
  function liveBindVideo(v) {
    if (!v || liveHold.video === v) return;
    liveHold.video = v;
    v.addEventListener("pause", () => {
      if (!v.paused || liveHold.userPaused || state.liveForcedPause || !liveCanPause()) return;
      liveHold.userPaused = true;
      liveHold.pausedWall = Date.now();
      liveHold.held = [];
      state.liveHoldAt = null;
      liveNotifyPause(true);
      liveRefreshButton();
    });
    v.addEventListener("play", () => { if (liveHold.userPaused) liveUserResume(); });
  }
  // The control sits in the player, top right, and shows only while Active mode runs on a live stream with a video.
  function liveRefreshButton() {
    liveBindVideo(state.video);
    const show = liveCanPause();
    let b = liveHold.button;
    if (!show) { if (b) b.hidden = true; return; }
    if (!b) {
      b = document.createElement("button");
      b.type = "button";
      b.id = "subify-live-pause";
      b.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (liveHold.userPaused) liveUserResume(); else liveUserPause();
      });
      liveHold.button = b;
    }
    if (b.parentElement !== state.player) state.player.appendChild(b);
    const ui = livePauseUi();
    b.textContent = liveHold.userPaused ? ui.play : ui.pause;
    b.setAttribute("aria-label", b.textContent);
    b.setAttribute("aria-pressed", String(liveHold.userPaused));
    b.hidden = false;
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
      state.cloudSyncedCueKeys = new Set();
      state.fixedCueKeys = new Set();
      state.transcriptEdit = null;
      state.transcriptNote = null;
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

  // IMPORTANT: YouTube's caption baseUrl is signed and can change after every
  // page reload. Never use it as the persistent-cache identity. A refresh can
  // therefore keep the same video/track while receiving a completely new URL.
  // The old implementation hashed the URL, which made the cache look empty.
  function stableTrackIdentity(track = null) {
    const t = track || state.currentTrack || {};
    const lang = String(t.languageCode || state.trackLanguage || "auto").toLowerCase();
    const vssId = String(t.vssId || t.vss_id || "");
    const kind = String(t.kind || (t.isAutoGenerated ? "asr" : "manual") || "");
    const name = trackName(t);
    return `${state.videoId || "unknown-video"}|${lang}|${kind}|${vssId}|${name}`;
  }

  function cueFingerprint(c) {
    return `${Number(c?.start || 0).toFixed(3)}|${Number(c?.end || 0).toFixed(3)}|${hash(clean(c?.text || ""))}`;
  }

  // The key the shared cache uses for a line. Must match cueFingerprintForCloud in
  // background.js and the web app's subtitleCache.js, or rows written by one path
  // are never found by another.
  function cloudCueKey(c) {
    return hash(`${Number(c?.start || 0).toFixed(3)}|${Number(c?.end || 0).toFixed(3)}|${String(c?.text || "").trim()}`);
  }

  function persistentCacheKey() {
    const identity = state.trackKey || stableTrackIdentity();
    return identity ? `subify_tr_${hash(identity)}` : "";
  }

  async function loadPersistentTranslations() {
    const key=persistentCacheKey(); if(!key||state.persistentCacheLoaded)return;
    state.persistentCacheKey=key; state.persistentCacheLoaded=true;
    state.cloudSyncedCueKeys = new Set();
    state.fixedCueKeys = new Set();
    try {
      // Local cache remains the fast/offline path.
      const data=await subifyIdbGet("translations",key);
      const rows=Array.isArray(data?.rows)?data.rows:[];
      const byId=new Map();
      const byFp=new Map();
      const fixedIds=new Set();
      const fixedCks=new Set();
      for(const row of rows){
        const id=String(row?.id||"");
        const fa=clean(row?.fa||row?.translation||"");
        if(!fa) continue;
        if(id) byId.set(id,fa);
        const fp=String(row?.fp||"");
        if(fp) byFp.set(fp,fa);
        if(row?.fixed){ if(id) fixedIds.add(id); if(row?.ck) fixedCks.add(String(row.ck)); }
      }
      for(const cue of state.cues){
        const fa=byId.get(String(cue.id)) || byFp.get(cueFingerprint(cue));
        if(fa) state.translations.set(cue.id,fa);
        const ck=cloudCueKey(cue);
        if(fixedIds.has(String(cue.id)) || fixedCks.has(ck)) state.fixedCueKeys.add(ck);
      }

      // Cloud cache is the durable cross-refresh/device path.
      try {
        const targetLanguage = String(state.settings?.targetLanguage || "fa").toLowerCase();
        const cloud = await browser.runtime.sendMessage({
          type: "subify-cloud-cache-get",
          payload: {
            video_id: String(state.videoId || ""),
            track_key: String(state.trackKey || key),
            target_language: targetLanguage
          }
        });
        const cloudRows = Array.isArray(cloud?.rows) ? cloud.rows : [];
        const cloudByCue = new Map();
        for (const row of cloudRows) {
          const cueKey = String(row?.cue_key || "");
          const translation = clean(row?.translation || "");
          if (!cueKey || !translation) continue;
          cloudByCue.set(cueKey, translation);
          state.cloudSyncedCueKeys.add(cueKey);
        }
        // The shared version wins over an old local guess, so a corrected line reaches
        // people who already watched it. A line this person fixed stays as they wrote it.
        for (const cue of state.cues) {
          const ck = cloudCueKey(cue);
          const tr = cloudByCue.get(ck);
          if (tr && !state.fixedCueKeys.has(ck)) state.translations.set(cue.id, tr);
        }
        // Counts for the anonymous daily report: lines on this video, and how many came from the shared cache.
        browser.runtime.sendMessage({ type: "subify-stat", key: "cacheCues", asked: state.cues.length, hit: state.cues.filter((c) => cloudByCue.has(cloudCueKey(c))).length }).catch(() => {});
        if (cloudRows.length) log(`loaded ${cloudRows.length} cloud-cached translations`);
      } catch (e) {
        log("cloud translation cache unavailable; continuing with local cache", e);
      }

      if(rows.length)log(`loaded ${rows.length} cached subtitle translations from IndexedDB`);
      if(rows.length) schedulePersistentCacheWrite();
    } catch(e){log("IndexedDB translation cache read failed",e);}
  }

  let cacheWriteTimer=null;
  function schedulePersistentCacheWrite(){
    if(!state.persistentCacheKey)return;
    clearTimeout(cacheWriteTimer);
    cacheWriteTimer=setTimeout(async()=>{
      try {
        const rows=[...state.translations.entries()].map(([id,fa])=>{
          const cue=state.cues.find(c=>String(c.id)===String(id));
          return cue ? {
            id,
            fa,
            fp:cueFingerprint(cue),
            ck:cloudCueKey(cue),
            fixed:state.fixedCueKeys.has(cloudCueKey(cue)),
            start:Number(cue.start)||0,
            end:Number(cue.end)||0,
            text:clean(cue.text||"")
          } : null;
        }).filter(Boolean).slice(0,12000);

        await subifyIdbPut("translations",state.persistentCacheKey,{
          version:5,updatedAt:Date.now(),
          rows:rows.map(r=>({id:r.id,fa:r.fa,fp:r.fp,ck:r.ck,fixed:r.fixed}))
        });

        // Sync only machine translations this browser has not already confirmed on the server.
        // A line the person corrected stays local until the shared correction is accepted,
        // so a single person's guess never becomes the shared translation.
        const pending = rows.filter(r => !r.fixed && !state.cloudSyncedCueKeys.has(r.ck)).slice(0,500);
        if (!pending.length || state.cloudSyncBusy) return;
        state.cloudSyncBusy = true;
        try {
          const targetLanguage = String(state.settings?.targetLanguage || "fa").toLowerCase();
          const result = await browser.runtime.sendMessage({
            type: "subify-cloud-cache-put",
            payload: {
              video_id: String(state.videoId || ""),
              track_key: String(state.trackKey || state.persistentCacheKey),
              target_language: targetLanguage,
              rows: pending.map(r=>({
                cue_key:r.ck,
                start_sec:r.start,
                end_sec:r.end,
                source_text:r.text,
                translation:r.fa
              }))
            }
          });
          if (result?.ok) pending.forEach(r=>state.cloudSyncedCueKeys.add(r.ck));
          else log("cloud cache sync failed", result?.error || "unknown error");
        } finally {
          state.cloudSyncBusy = false;
        }
      }catch(e){log("translation cache write failed",e);}
    },1000);
  }

  // Saves a person's own fix for one line. It applies on this browser right away.
  // The shared cache only changes once the server has seen the same text from a
  // second signed-in person (/cache/correct). Anything less stays local.
  async function correctCueTranslation(cue, text) {
    const fixed = clean(text);
    if (!fixed || !cue) return { ok: false, code: "empty", error: "empty" };
    const ck = cloudCueKey(cue);
    state.translations.set(cue.id, fixed);
    state.fixedCueKeys.add(ck);
    state.lastShownId = "";
    schedulePersistentCacheWrite();
    let result;
    try {
      result = await browser.runtime.sendMessage({
        type: "subify-cloud-cache-correct",
        payload: {
          video_id: String(state.videoId || ""),
          track_key: String(state.trackKey || state.persistentCacheKey),
          target_language: String(state.settings?.targetLanguage || "fa").toLowerCase(),
          cue: { start: Number(cue.start) || 0, end: Number(cue.end) || 0, text: String(cue.text || "") },
          translation: fixed
        }
      });
    } catch (e) {
      result = { ok: false, code: "network", error: String(e?.message || e) };
    }
    if (result?.ok && result.status === "applied") state.cloudSyncedCueKeys.add(ck);
    return result || { ok: false, code: "network", error: "no response" };
  }

  function correctionNoteText(result) {
    if (result?.ok && result.status === "applied") return "ثبت شد. این ترجمه حالا برای همه کاربرهای Subify هم درست شده.";
    if (result?.ok) {
      const n = Number(result.confirmations) || 1;
      const need = Number(result.needed) || 2;
      return `اصلاحت ثبت شد و فعلاً روی همین مرورگر هست. ${n} از ${need} تأیید لازم است. وقتی یه نفر دیگه هم همین متن رو بفرسته، برای همه درست می‌شه.`;
    }
    if (result?.code === "sign_in_required") return "فعلاً فقط روی همین مرورگر ذخیره شد. برای اینکه برای همه هم درست بشه، وارد حساب Subify شو.";
    if (result?.code === "rate_limited") return "زیاد اصلاح فرستادی. چند دقیقه دیگه دوباره امتحان کن. اصلاحت روی همین مرورگر ذخیره شده.";
    return "فعلاً فقط روی همین مرورگر ذخیره شد. به سرور وصل نشد. کمی بعد دوباره ویرایش کن تا برای همه هم ثبت بشه.";
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
    el.addEventListener("click",e=>{const w=e.target.closest(".subify-subtitle-line--orig .subify-word");if(!w||!state.activeCue)return;const word=clean(w.textContent).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu,"");if(!word)return;void lookUpWord(w,word,state.activeCue.text,state.activeFa);
      // Learning modes: a word lookup pauses the video so the learner can read it; closing the popup resumes.
      const v=state.video;if(v&&!v.paused&&state.learnCfg&&state.learnCfg.smartMode&&state.learnCfg.smartMode!=="relaxed"){v.pause();state.lookupPaused=true;}});
    const done=()=>{if(!state.drag)return;state.drag=null;el.classList.remove("subify-dragging");const id=state.videoId||getVideoIdFromUrl();if(id)browser.storage.local.set({[`subify_video_${id}`]:{positionX:state.settings.positionX,positionY:state.settings.positionY,positionMode:"custom"}}).catch(()=>{});};el.addEventListener("pointerup",done);el.addEventListener("pointercancel",done);
  }
  function cueWords(cue,text){const parts=clean(text).match(/\S+\s*/g)||[clean(text)];const dur=Math.max(.1,cue.end-cue.start);const src=Array.isArray(cue.words)&&cue.words.length?cue.words:null;return parts.map((w,i)=>{const t=src?.[i];return{text:w,start:Number(t?.start??cue.start+dur*i/parts.length),end:Number(t?.end??cue.start+dur*(i+1)/parts.length)};});}
  function makeLine(cue,text,cls,original){const fontKey=original?(state.settings.fontEn||'Inter'):state.settings.font;const fontFamily=OVERLAY_FONT_MAP[fontKey]||OVERLAY_FONT_MAP.Lalezar;const line=document.createElement("div");line.className=`subify-subtitle-line ${cls}`;line.setAttribute("dir",original?/^[\x00-\x7F]/.test(text)?"ltr":"rtl":"rtl");line.style.setProperty("font-family",fontFamily,"important");const span=document.createElement("span");span.className="subify-subtitle-text";span.style.setProperty("font-family",fontFamily,"important");const effect=String(state.settings.effect||state.settings.preset||"").toLowerCase();if(effect==="typewriter"){const chars=Math.max(1,Array.from(clean(text)).length);span.style.setProperty("--fx-type-width",`${Math.min(120,chars)}ch`);span.style.setProperty("--fx-type-steps",String(Math.min(120,chars)));}if(state.settings.karaokeEnabled!==false){for(const w of cueWords(cue,text)){const x=document.createElement("span");x.className="subify-word";x.style.setProperty("font-family",fontFamily,"important");x.textContent=w.text;x.dataset.start=w.start;x.dataset.end=w.end;span.appendChild(x);}}else span.textContent=clean(text);line.appendChild(span);if(original){if((state.learnCfg||LRN.sanitizeLearning(null)).replayEnabled)line.appendChild(makeReplayButton(cue));{const lcfg=state.learnCfg||LRN.sanitizeLearning(null);if(LRN.isLearningSource(lcfg,state.trackLanguage||state.capturedCaptionLang||""))line.appendChild(makeGrammarButton(cue));}}return line;}
  function updateKaraoke(el, now){
    if(state.settings.karaokeEnabled===false || !el) return;
    const words = state.karaokeWords;
    if(!words.length) return;

    const t = Number(now || 0) + Number(state.karaokeLead || 0);
    let idx = state.karaokeIndex;

    // Seeking backwards inside the same cue is rare, so only do the full
    // reset on an actual rewind. Normal playback advances one word at a time.
    if (idx >= 0 && t < Number(words[idx]?.dataset.start || 0)) {
      for (const w of words) w.classList.remove("sung", "active");
      idx = -1;
    }

    while (idx + 1 < words.length && t >= Number(words[idx + 1]?.dataset.start || 0)) idx++;

    if (idx !== state.karaokeIndex) {
      const prev = state.karaokeIndex;
      if (prev >= 0 && words[prev]) words[prev].classList.remove("active");
      for (let i = Math.max(0, prev + 1); i <= idx; i++) words[i]?.classList.add("sung");
      state.karaokeIndex = idx;
    }

    const current = idx >= 0 ? words[idx] : null;
    if (current) {
      const end = Number(current.dataset.end || 0);
      current.classList.toggle("active", t < end);
    }
  }

  function startKaraokeLoop(){
    if(state.karaokeRaf) cancelAnimationFrame(state.karaokeRaf);
    const tick=()=>{
      state.karaokeRaf=requestAnimationFrame(tick);
      try { checkReplayAndPause(); } catch (e) {}
      if(!state.video || state.video.paused || !state.settings.subtitleEnabled || state.settings.karaokeEnabled===false)return;
      const el=state.player?.querySelector(`#${OVERLAY_ID}`);
      if(!el || !el.classList.contains("subify-visible") || !state.karaokeWords.length)return;
      updateKaraoke(el,Number(state.video.currentTime||0)+Number(state.settings?.subtitleOffsetSec||0));
    };
    state.karaokeRaf=requestAnimationFrame(tick);
  }
  // ---------- Subify account gate (in-page prompt) ----------
  // When the site admin made login mandatory and nobody is signed in, subtitles are hidden and a sign-in prompt is shown on the
  // player. The decision comes from background.js (it asks sub-ify.site); this code only reacts to it.
  const subifyAuth = { blocked: false, el: null, timer: null, providers: {}, checking: false };
  function subifyAuthText() {
    // both languages always: Persian line, then English line
    const pair = (fa, en) => `${fa}<br><span style="opacity:.72;font-size:.85em;font-weight:400;direction:ltr;display:inline-block;margin-top:2px">${en}</span>`;
    return {
      title: pair("برای استفاده از Subify وارد شو", "Sign in to use Subify"),
      sub: pair("ورود با Google یا GitHub چند ثانیه طول می‌کشد.", "Signing in with Google or GitHub takes a few seconds."),
      google: pair("ورود با Google", "Sign in with Google"),
      github: pair("ورود با GitHub", "Sign in with GitHub"),
      check: pair("وارد شدم", "I've signed in")
    };
  }
  function subifyAuthHide() {
    if (subifyAuth.el) { subifyAuth.el.remove(); subifyAuth.el = null; }
  }
  function subifyAuthShow() {
    document.querySelectorAll(".subify-visible").forEach(e => e.classList.remove("subify-visible"));
    if (subifyAuth.el && subifyAuth.el.isConnected) return;
    const t = subifyAuthText();
    const box = document.createElement("div");
    box.className = "subify-auth-gate";
    box.setAttribute("role", "alertdialog");
    box.style.cssText = "position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483000;width:min(340px,86%);padding:18px 18px 14px;border-radius:16px;background:rgba(10,14,22,.94);color:#eef1f8;border:1px solid rgba(124,92,255,.5);box-shadow:0 18px 60px rgba(0,0,0,.6);text-align:center;font-family:Vazirmatn,system-ui,sans-serif;direction:rtl";
    const btn = "display:block;width:100%;height:40px;margin:0 0 8px;border-radius:11px;border:1px solid #2a3447;background:#111621;color:#eef1f8;font-weight:700;font-size:13px;font-family:inherit;cursor:pointer";
    box.innerHTML = '<div style="font-size:26px;margin-bottom:4px">🔒</div><div style="font-weight:700;font-size:15px;font-family:inherit;margin-bottom:4px">' + t.title + '</div><div style="font-size:12px;opacity:.7;line-height:1.9;margin-bottom:12px">' + t.sub + "</div>";
    [["google", t.google], ["github", t.github]].forEach(([p, label]) => {
      if (subifyAuth.providers && subifyAuth.providers[p] === false) return;
      const b = document.createElement("button"); b.type = "button"; b.style.cssText = btn; b.innerHTML = label;
      b.addEventListener("click", ev => { ev.stopPropagation(); browser.runtime.sendMessage({ type: "subify-auth-open", provider: p }).catch(() => {}); });
      box.appendChild(b);
    });
    const c = document.createElement("button"); c.type = "button"; c.style.cssText = btn.replace("#111621", "transparent"); c.innerHTML = t.check;
    c.addEventListener("click", ev => { ev.stopPropagation(); void subifyAuthCheck(true); });
    box.appendChild(c);
    ["click", "mousedown", "dblclick", "keydown", "keyup", "pointerdown"].forEach(n => box.addEventListener(n, e => e.stopPropagation()));
    (state.player || document.body).appendChild(box);
    subifyAuth.el = box;
  }
  async function subifyAuthCheck(force) {
    if (subifyAuth.checking) return;
    subifyAuth.checking = true;
    try {
      const r = await browser.runtime.sendMessage({ type: "subify-auth-status", force: !!force, videoId: new URL(location.href).searchParams.get("v") || "" });
      subifyAuth.providers = (r && r.providers) || {};
      const was = subifyAuth.blocked;
      subifyAuth.blocked = !!(r && r.required && !r.user && !(r.trial && r.trial.allowed));
      if (subifyAuth.blocked) subifyAuthShow();
      else { subifyAuthHide(); if (was) { state.lastShownId = ""; void loadSettings(); } }
    } catch (e) { /* background not reachable: keep the previous state */ }
    finally { subifyAuth.checking = false; }
  }
  function subifyAuthSchedule() {
    clearTimeout(subifyAuth.timer);
    subifyAuth.timer = setTimeout(async () => { await subifyAuthCheck(false); subifyAuthSchedule(); }, subifyAuth.blocked ? 3500 : 90000);
  }
  // background.js refused a translation or dubbing request (the free sources are used up): block now and show the prompt.
  function subifyAuthBlockNow() {
    subifyAuth.blocked = true;
    subifyAuthShow();
    subifyAuthSchedule();
  }
  // The free Subify AI (owner's key on the server) refused a batch: say why, once per reason per page load.
  const subifyFreeNoticeSeen = new Set();
  function subifyFreeAiNotice(text, code) {
    if (!text || subifyFreeNoticeSeen.has(code)) return;
    subifyFreeNoticeSeen.add(code);
    const box = document.createElement("div");
    box.className = "subify-free-notice";
    box.setAttribute("role", "status");
    box.style.cssText = "position:absolute;left:50%;bottom:16%;transform:translateX(-50%);z-index:2147483000;width:min(380px,86%);padding:9px 14px;border-radius:12px;background:rgba(10,14,22,.94);color:#eef1f8;border:1px solid rgba(124,92,255,.5);box-shadow:0 12px 40px rgba(0,0,0,.5);text-align:center;font:600 13px/1.8 Vazirmatn,system-ui,sans-serif;direction:rtl;pointer-events:none";
    box.textContent = text;
    (state.player || document.body).appendChild(box);
    setTimeout(() => box.remove(), 9000);
  }
  // ---------- end Subify account gate ----------

  // ---------- learning: saved-word highlighting, sentence replay, Smart Watching ----------
  // Pure logic lives in learning-core.js (window.SubifyLearning). This block only touches the DOM and the video.
  const LRN = globalThis.SubifyLearning;
  const cueKey = (c) => String(c?.id ?? c?.start);
  async function loadLearningConfig() {
    try {
      const r = await browser.storage.local.get("subify_learning");
      state.learnCfg = LRN.sanitizeLearning(r.subify_learning);
    } catch (e) { state.learnCfg = LRN.sanitizeLearning(null); }
    if (LRN.effectiveHighlight(state.learnCfg) !== "off") void refreshVocabIndex(true);
    reapplyHighlight();
    refreshGrammarButtons();
    liveRefreshButton();
  }
  async function refreshVocabIndex(force) {
    if (state.vocabLoading) return;
    if (!force && Date.now() - state.vocabIndexAt < 30000) return;
    state.vocabLoading = true;
    try {
      const r = await browser.runtime.sendMessage({ type: "subify-vocab-list" });
      if (r?.ok && Array.isArray(r.rows)) {
        state.vocabIndex = LRN.buildIndex(r.rows);
        state.vocabIndexAt = Date.now();
        reapplyHighlight();
      }
    } catch (e) { /* background asleep or extension reloading: keep the last index */ }
    finally { state.vocabLoading = false; }
  }
  function applyHighlight(root) {
    const cfg = state.learnCfg || LRN.sanitizeLearning(null);
    const mode = LRN.effectiveHighlight(cfg);
    const now = Date.now();
    // Highlights only apply when the subtitles are in the learning language (see isLearningSource).
    const learning = LRN.isLearningSource(cfg, state.trackLanguage || state.capturedCaptionLang || "");
    let dueHit = false;
    for (const w of root.querySelectorAll(".subify-subtitle-line--orig .subify-word")) {
      w.classList.remove("subify-vw", "subify-vw-new", "subify-vw-learning", "subify-vw-mastered", "subify-vw-due");
      if (mode === "off" || !state.vocabIndex || !learning) continue;
      const card = LRN.lookupCard(state.vocabIndex, cfg, w.textContent);
      if (!card || !LRN.matchesMode(mode, card, now)) continue;
      w.classList.add("subify-vw", `subify-vw-${LRN.statusOf(card)}`);
      if (LRN.isDue(card, now)) { w.classList.add("subify-vw-due"); dueHit = true; }
    }
    if (dueHit && cfg.smartMode === "study") stopForDueWord();
  }
  // Study mode: pause once when a line with a word due for review appears, so the learner sees it.
  // Each line stops at most once; resuming plays on, and the next due line stops again.
  function stopForDueWord() {
    const cue = state.activeCue, v = state.video;
    if (!cue || !v || v.paused || state.replay || !state.settings?.subtitleEnabled) return;
    const key = cueKey(cue);
    if (state.dueStopKey === key) return;
    state.dueStopKey = key;
    v.pause();
  }
  function reapplyHighlight() {
    const el = document.getElementById(OVERLAY_ID);
    if (el && el.classList.contains("subify-visible")) applyHighlight(el);
  }

  // ---------- AI pages (r18): cue snapshot, timestamped notes, links to the AI pages ----------
  // The snapshot is what the AI pages read: the current video's title, URL and its last cues (text only).
  const SNAPSHOT_KEY = "subify_cues_snapshot";
  const SNAPSHOT_MAX_CUES = 300;
  const NOTES_KEY = "subify_notes";
  const NOTES_MAX = 2000;
  let snapshotSource = null;
  let snapshotSig = "";
  function pageVideoTitle() {
    return clean(document.title).replace(/^\(\d+\)\s*/, "").replace(/\s+-\s+YouTube$/i, "").slice(0, 200);
  }
  // The video log for the AI pages (spec 27 and 29): one entry per video, newest first, title and id only.
  // Written when the video or its title changes, not on every cue, so it stays small.
  const VIDEO_HISTORY_KEY = "subify_video_history";
  const VIDEO_HISTORY_MAX = 50;
  let historyMark = "";
  function rememberVideo(videoId, title) {
    const mark = videoId + "|" + title;
    if (!videoId || !title || mark === historyMark) return;
    historyMark = mark;
    try {
      browser.storage.local.get(VIDEO_HISTORY_KEY).then((r) => {
        const rest = (Array.isArray(r[VIDEO_HISTORY_KEY]) ? r[VIDEO_HISTORY_KEY] : []).filter((h) => h && h.videoId !== videoId);
        return browser.storage.local.set({ [VIDEO_HISTORY_KEY]: [{ videoId, title, at: Date.now() }, ...rest].slice(0, VIDEO_HISTORY_MAX) });
      }).catch(() => {});
    } catch (_) { /* storage unavailable: the AI pages just have no video list */ }
  }
  // Where the viewer stopped, for the account panel's "open on YouTube at this time" link. It is kept on the same
  // list entry as the video. Saved every five seconds while the video plays, and once when it pauses. In the first
  // five seconds, or in the last fifteen, the position is 0 (start from the beginning).
  const POSITION_SAVE_MS = 5000;
  let positionSaved = { videoId: "", position: -1 };
  let positionAt = 0;
  function rememberPosition() {
    const video = state.video;
    const videoId = state.videoId || getVideoIdFromUrl();
    const title = pageVideoTitle();
    if (!video || !videoId || !title || !Number.isFinite(video.currentTime)) return;
    const now = Date.now();
    if (now - positionAt < POSITION_SAVE_MS) return;
    const duration = Number.isFinite(video.duration) ? Math.floor(video.duration) : 0;
    let position = Math.floor(video.currentTime);
    if (position < 5 || (duration && position > duration - 15)) position = 0;
    if (video.paused && positionSaved.videoId === videoId && positionSaved.position === position) return;
    positionAt = now;
    positionSaved = { videoId, position };
    try {
      browser.storage.local.get(VIDEO_HISTORY_KEY).then((r) => {
        const list = Array.isArray(r[VIDEO_HISTORY_KEY]) ? r[VIDEO_HISTORY_KEY] : [];
        const rest = list.filter((h) => h && h.videoId !== videoId);
        return browser.storage.local.set({ [VIDEO_HISTORY_KEY]: [{ videoId, title, at: now, position, duration }, ...rest].slice(0, VIDEO_HISTORY_MAX) });
      }).catch(() => {});
    } catch (_) { /* storage unavailable: no position is saved */ }
  }
  setInterval(rememberPosition, 1000);

  function saveCueSnapshot() {
    const cues = state.cues;
    if (!Array.isArray(cues) || !cues.length || cues === snapshotSource) return;
    snapshotSource = cues;
    const videoId = state.videoId || getVideoIdFromUrl();
    if (!videoId) return;
    const rows = cues
      .slice(-SNAPSHOT_MAX_CUES)
      .map((c) => ({ start: Number(c.start) || 0, end: Number(c.end) || 0, text: clean(c.text) }))
      .filter((c) => c.text);
    if (!rows.length) return;
    const sig = [videoId, rows.length, hash(rows.map((r) => r.text).join("\n"))].join("|");
    if (sig === snapshotSig) return;
    snapshotSig = sig;
    rememberVideo(videoId, pageVideoTitle());
    try {
      browser.storage.local.set({ [SNAPSHOT_KEY]: { videoId, title: pageVideoTitle(), url: location.href, cues: rows } }).catch(() => {});
    } catch (_) { /* storage unavailable: the AI pages will say there is no snapshot */ }
  }

  // Labels for the overlay follow the viewer's own language (subify_learning.nativeLang). Unknown codes use English.
  const AI_UI = {
    fa: { note: "یادداشت برای این لحظه", saved: "ذخیره شد", failed: "ذخیره نشد", ai: "ابزارهای هوش مصنوعی", chat: "گفت‌وگو با ویدیو", summary: "خلاصهٔ ویدیو", roleplay: "نقش‌آفرینی", writer: "نوشتن از ویدیو", shadow: "تمرین تلفظ", practice: "تمرین این ویدیو", writeVideo: "نوشتن از این ویدیو", seek: "برو به این لحظه" },
    en: { note: "Note at this moment", saved: "Saved", failed: "Not saved", ai: "AI tools", chat: "Chat about the video", summary: "Video summary", roleplay: "Roleplay", writer: "Write from the video", shadow: "Pronunciation practice", practice: "Practice this video", writeVideo: "Write from this video", seek: "Jump to this moment" },
    ar: { note: "ملاحظة عند هذه اللحظة", saved: "تم الحفظ", failed: "تعذّر الحفظ", ai: "أدوات الذكاء الاصطناعي", chat: "محادثة حول الفيديو", summary: "ملخص الفيديو", roleplay: "لعب الأدوار", writer: "الكتابة من الفيديو", shadow: "تدريب النطق", practice: "تدرّب على هذا الفيديو", writeVideo: "اكتب من هذا الفيديو", seek: "انتقل إلى هذه اللحظة" },
    es: { note: "Nota en este momento", saved: "Guardado", failed: "No se pudo guardar", ai: "Herramientas de IA", chat: "Chat sobre el video", summary: "Resumen del video", roleplay: "Juego de roles", writer: "Escribir desde el video", shadow: "Práctica de pronunciación", practice: "Practicar con este video", writeVideo: "Escribir a partir de este video", seek: "Ir a este momento" },
    tr: { note: "Bu an için not", saved: "Kaydedildi", failed: "Kaydedilemedi", ai: "YZ araçları", chat: "Video hakkında sohbet", summary: "Video özeti", roleplay: "Rol yapma", writer: "Videodan yaz", shadow: "Telaffuz pratiği", practice: "Bu videoyla pratik yap", writeVideo: "Bu videodan yaz", seek: "Bu ana git" },
    fr: { note: "Note à ce moment", saved: "Enregistré", failed: "Échec de l’enregistrement", ai: "Outils IA", chat: "Discuter de la vidéo", summary: "Résumé de la vidéo", roleplay: "Jeu de rôle", writer: "Écrire à partir de la vidéo", shadow: "Entraînement à la prononciation", practice: "S’entraîner avec cette vidéo", writeVideo: "Écrire à partir de cette vidéo", seek: "Aller à ce moment" },
    de: { note: "Notiz zu diesem Moment", saved: "Gespeichert", failed: "Nicht gespeichert", ai: "KI-Werkzeuge", chat: "Chat über das Video", summary: "Videozusammenfassung", roleplay: "Rollenspiel", writer: "Aus dem Video schreiben", shadow: "Aussprache üben", practice: "Mit diesem Video üben", writeVideo: "Aus diesem Video schreiben", seek: "Zu diesem Moment springen" }
  };
  function aiUi() {
    return AI_UI[String(state.learnCfg?.nativeLang || "fa")] || AI_UI.en;
  }

  // Quick note (spec 37): saves the time and the current subtitle line to subify_notes.
  function makeNoteButton(cue) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "subify-note-btn";
    b.textContent = "✎";
    b.title = aiUi().note;
    b.setAttribute("aria-label", aiUi().note);
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); void saveTimestampNote(cue, b); });
    return b;
  }
  async function saveTimestampNote(cue, btn) {
    const videoId = state.videoId || getVideoIdFromUrl();
    const video = state.video || getVideo();
    const videoTime = video ? Number(video.currentTime) : NaN;
    const t = Number.isFinite(videoTime) ? videoTime : Number(cue?.start) || 0;
    const note = {
      id: `${videoId || "video"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      videoId: videoId || "",
      title: pageVideoTitle(),
      t: Math.round(t * 10) / 10,
      text: clean(cue?.text || ""),
      createdAt: Date.now()
    };
    const u = aiUi();
    try {
      const got = await browser.storage.local.get(NOTES_KEY);
      const rows = Array.isArray(got[NOTES_KEY]) ? got[NOTES_KEY] : [];
      rows.push(note);
      await browser.storage.local.set({ [NOTES_KEY]: rows.slice(-NOTES_MAX) });
      flashNoteButton(btn, "✓", u.saved);
    } catch (_) {
      flashNoteButton(btn, "!", u.failed);
    }
  }
  function flashNoteButton(btn, mark, label) {
    if (!btn) return;
    const base = aiUi().note;
    btn.textContent = mark;
    btn.setAttribute("aria-label", label);
    setTimeout(() => {
      btn.textContent = "✎";
      btn.setAttribute("aria-label", base);
    }, 1600);
  }
  function attachNoteButton(el, cue) {
    const lines = el.querySelectorAll(".subify-subtitle-line");
    if (lines.length) lines[lines.length - 1].appendChild(makeNoteButton(cue));
  }
  function openAiPage(page) {
    try { browser.runtime.sendMessage({ type: "subify-open-page", page }).catch(() => {}); } catch (_) { /* extension reloaded */ }
  }
  // Spec 27 and 29: the roleplay and writing pages start from this video. The title, a topic and the cues around
  // the current time go to subify_practice_seed; the page reads them and shows a way out.
  async function openAiPageForVideo(page) {
    const source = state.cues.length ? state.cues : state.generatedCues;
    const now = Number(state.video?.currentTime || 0) + Number(state.settings?.subtitleOffsetSec || 0);
    const cues = LRN.seedCuesAround(source, now, LRN.SEED_MAX_CUES);
    const seed = LRN.practiceSeed({
      videoId: state.videoId || getVideoIdFromUrl(), title: pageVideoTitle(), topic: LRN.seedTopic(cues), cues, createdAt: Date.now()
    });
    try {
      if (seed) await browser.storage.local.set({ [LRN.PRACTICE_SEED_KEY]: seed });
      else await browser.storage.local.remove(LRN.PRACTICE_SEED_KEY);
    } catch (_) { /* the page still opens, just without this video */ }
    openAiPage(page);
  }
  // Moves the video to a time (transcript rows, timestamp buttons, notes from the learn page).
  function seekVideoTo(t) {
    const video = state.video || getVideo();
    if (!video) return;
    try { video.currentTime = Math.max(0, Number(t) || 0); video.play?.().catch(() => {}); } catch (_) { /* the player refused the seek */ }
  }

  function makeReplayButton(cue) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "subify-replay";
    b.title = "پخش دوباره این جمله";
    b.setAttribute("aria-label", "پخش دوباره این جمله");
    b.textContent = "↻";
    // The overlay captures the pointer on pointerdown (for dragging); keep the button out of that path so its click is a real click.
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); replaySentence(cue); });
    return b;
  }
  // Plays one subtitle sentence at the chosen speed, then stops at its end.
  function replaySentence(cue) {
    const v = state.video;
    if (!v || !cue) return;
    const speed = LRN.REPLAY_SPEEDS.includes(state.learnCfg?.replaySpeed) ? state.learnCfg.replaySpeed : 1;
    const prevRate = state.replay ? state.replay.prevRate : (v.playbackRate || 1);
    state.replay = { cue, prevRate, startedAt: performance.now() };
    state.pausedForCue = null;
    try { v.playbackRate = speed; v.currentTime = Math.max(0, Number(cue.start) || 0); } catch (e) {}
    v.play().catch(() => {});
  }
  // Called every animation frame. Ends a replay at the sentence end, and in Active mode pauses at each sentence end.
  function checkReplayAndPause() {
    const v = state.video;
    if (!v) return;
    const t = Number(v.currentTime || 0);
    if (state.replay) {
      const { cue, prevRate, startedAt } = state.replay;
      const start = Number(cue.start) || 0, end = Number(cue.end) || 0;
      // Right after a seek some players report a stale position for a moment; only cancel once the grace window has passed.
      const settling = performance.now() - startedAt < 1500;
      if (t >= end - 0.05 || (!settling && (t < start - 1 || t > end + 1))) {
        state.replay = null;
        try { v.playbackRate = prevRate || 1; } catch (e) {}
        if (t >= end - 0.05 && t <= end + 1) { state.pausedForCue = cueKey(cue); v.pause(); }
      }
      return;
    }
    const cfg = state.learnCfg;
    const cue = state.activeCue;
    if (!cfg || cfg.smartMode !== "active" || !cfg.pauseAfterSentence || !cue || v.paused || !state.settings?.subtitleEnabled) return;
    if (state.pausedForCue !== cueKey(cue) && t >= Number(cue.end) - 0.05 && t <= Number(cue.end) + 1) {
      state.pausedForCue = cueKey(cue);
      v.pause();
    }
  }
  function showCue(cue,fa,now){
    if (subifyAuth.blocked) { subifyAuthShow(); return; }
    state.activeCue=cue; state.activeFa=fa||"";
    if (LRN.effectiveHighlight(state.learnCfg || LRN.sanitizeLearning(null)) !== "off") void refreshVocabIndex(false);
    const el=ensureOverlay(); if(!el)return;
    const mode=state.settings.displayMode||"translation";
    el.textContent="";
    if(mode!=="translation")el.appendChild(makeLine(cue,cue.text,"subify-subtitle-line--orig",true));
    if(mode!=="original"&&fa)el.appendChild(makeLine(cue,fa,"subify-subtitle-line--fa",false));
    applyHighlight(el);
    attachNoteButton(el, cue);
    el.classList.add("subify-visible");
    state.karaokeWords = state.settings.karaokeEnabled!==false ? Array.from(el.querySelectorAll(".subify-word")) : [];
    state.karaokeIndex = -1;
    state.karaokeCueId = cue.id;
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
      line.style.transform=`translateX(${x-50}%)`;
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
    // A <track> element only gets fetched and parsed once its TextTrack's
    // mode is "hidden" or "showing" — .cues stays null while it's
    // "disabled". Per spec a track's own `default` attribute should flip
    // this automatically, but that doesn't fire reliably on every player
    // (seen on H5P's video wrapper, used by some edX courses: a real
    // <track kind="subtitles" default> with a real .vtt src, yet .cues
    // stayed empty). Force it on ourselves — "hidden" rather than
    // "showing" so the browser's own caption bar doesn't render on top of
    // Subify's overlay.
    for (let i = 0; i < video.textTracks.length; i++) {
      const t = video.textTracks[i];
      if (t && ["subtitles", "captions"].includes(t.kind) && t.mode === "disabled") {
        try { t.mode = "hidden"; } catch (_) {}
      }
    }
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

  function parseTimestampToSeconds(text) {
    const parts = String(text || "").trim().split(":").map(Number);
    if (!parts.length || parts.some((n) => Number.isNaN(n))) return NaN;
    return parts.reduceRight((acc, val, idx, arr) => acc + val * Math.pow(60, arr.length - 1 - idx), 0);
  }

  function waitFor(check, timeoutMs = 4000, stepMs = 150) {
    return new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const v = check();
        if (v) return resolve(v);
        if (Date.now() - started > timeoutMs) return resolve(null);
        setTimeout(tick, stepMs);
      };
      tick();
    });
  }

  // Tier 4, last resort — only reached when the network-based tiers above
  // (embedded player response, native TextTracks, a fresh watch-page fetch)
  // all come up empty. Forces YouTube's own "Show transcript" panel open and
  // reads the rendered DOM — the same trick several standalone YouTube
  // transcript extensions use as their fallback. YouTube's DOM/class names
  // here change over time and aren't a stable public API, so this is
  // deliberately defensive (several selector attempts, silent bail-out) —
  // treat it as best-effort, not guaranteed, and expect it may need updating
  // if YouTube reshuffles the transcript panel's markup.
  async function scrapeYouTubeTranscriptPanel() {
    try {
      let panel = document.querySelector("ytd-transcript-segment-list-renderer");
      let openedByUs = false;
      if (!panel || !panel.querySelector("ytd-transcript-segment-renderer")) {
        const btn =
          document.querySelector('ytd-video-description-transcript-section-renderer button') ||
          Array.from(document.querySelectorAll('button, tp-yt-paper-item, ytd-menu-service-item-renderer'))
            .find((el) => /transcript|بازنویسی|رونوشت|متن‌نوشت/i.test(el.getAttribute?.("aria-label") || el.textContent || ""));
        if (!btn) return [];
        btn.click();
        openedByUs = true;
        panel = await waitFor(() => {
          const p = document.querySelector("ytd-transcript-segment-list-renderer");
          return p && p.querySelector("ytd-transcript-segment-renderer") ? p : null;
        });
      }
      if (!panel) return [];
      const segs = Array.from(panel.querySelectorAll("ytd-transcript-segment-renderer"));
      if (!segs.length) return [];
      const rawCues = segs.map((seg) => ({
        start: parseTimestampToSeconds(seg.querySelector(".segment-timestamp")?.textContent),
        text: clean(seg.querySelector(".segment-text")?.textContent || seg.textContent || "")
      })).filter((c) => c.text && Number.isFinite(c.start));
      for (let i = 0; i < rawCues.length; i++) {
        rawCues[i].end = i + 1 < rawCues.length ? rawCues[i + 1].start : rawCues[i].start + 6;
      }
      if (openedByUs) {
        try { document.querySelector('ytd-engagement-panel-title-header-renderer #visibility-button button')?.click(); } catch (_) {}
      }
      if (!rawCues.length) return [];
      return [{
        languageCode: "",
        name: { simpleText: "Transcript panel" },
        baseUrl: "",
        native: true,
        scraped: true,
        cues: normalizeCues(rawCues)
      }];
    } catch (e) {
      log("transcript panel scrape failed", e);
      return [];
    }
  }

  // Shared by Coursera and TED: both only expose one timestamp per
  // paragraph/block (not per phrase), so spread each paragraph's phrases
  // across its time span proportional to character length — an
  // approximation, but far better than lumping several sentences onto one
  // instant. `paragraphs` is [{ start, phrases: [text, ...] }, ...].
  function cuesFromTimedParagraphs(paragraphs) {
    const rawCues = [];
    for (let i = 0; i < paragraphs.length; i++) {
      const { start, phrases } = paragraphs[i];
      const totalChars = phrases.reduce((s, t) => s + t.length, 0) || 1;
      const paragraphEnd = i + 1 < paragraphs.length
        ? paragraphs[i + 1].start
        : start + phrases.reduce((s, t) => s + Math.max(2, t.length / 12), 0);
      let cursor = start;
      for (const text of phrases) {
        const share = Math.max(0.3, (text.length / totalChars) * Math.max(0.3, paragraphEnd - start));
        rawCues.push({ start: cursor, text });
        cursor += share;
      }
    }
    for (let i = 0; i < rawCues.length; i++) {
      rawCues[i].end = i + 1 < rawCues.length ? rawCues[i + 1].start : rawCues[i].start + 4;
    }
    return rawCues;
  }

  // Coursera's video player does not expose a native <track>/TextTrack for
  // most courses — captions only exist inside its own "Transcript" side
  // panel (.rc-Transcript > .rc-Paragraph, each with one .timestamp button
  // and several `span[data-cue]` phrases). getNativeTextTrackCues() finds
  // nothing there, so without this, getCaptionTracks() returned [] on every
  // single scan (every ~500ms, forever, per scan()'s scanGateMs backoff) —
  // that endless failed-discovery loop, not translation itself, is almost
  // certainly what showed up as the video lagging on Coursera. Once this
  // returns real cues, scan() backs off to its normal 1.5s cadence.
  async function scrapeCourseraTranscriptPanel() {
    try {
      let panel = document.querySelector(".rc-Transcript");
      if (!panel || !panel.querySelector(".rc-Paragraph")) {
        const btn = Array.from(document.querySelectorAll("button"))
          .find((el) => /transcript/i.test(el.getAttribute?.("aria-label") || el.textContent || ""));
        if (!btn) return [];
        btn.click();
        panel = await waitFor(() => {
          const p = document.querySelector(".rc-Transcript");
          return p && p.querySelector(".rc-Paragraph") ? p : null;
        });
      }
      if (!panel) return [];

      const paragraphs = Array.from(panel.querySelectorAll(".rc-Paragraph"))
        .map((p) => ({
          start: parseTimestampToSeconds(p.querySelector(".timestamp")?.textContent),
          phrases: Array.from(p.querySelectorAll("[data-cue]"))
            .map((el) => clean((el.getAttribute("aria-label") || "").replace(/^play video from\s*/i, "")))
            .filter(Boolean)
        }))
        .filter((p) => Number.isFinite(p.start) && p.phrases.length);
      if (!paragraphs.length) return [];

      const rawCues = cuesFromTimedParagraphs(paragraphs);
      if (!rawCues.length) return [];
      return [{
        languageCode: "",
        name: { simpleText: "Transcript panel" },
        baseUrl: "",
        native: true,
        scraped: true,
        cues: normalizeCues(rawCues)
      }];
    } catch (e) {
      log("coursera transcript panel scrape failed", e);
      return [];
    }
  }

  // TED's "Read transcript" panel has the same shape as Coursera's: one
  // timestamp per block (mm:ss, e.g. "01:18"), each block holding several
  // `div[role="button"][aria-label]` phrases (the aria-label is the clean
  // sentence text — the visible <span> can have a mid-sentence line break).
  // No stable wrapper class is exposed, so paragraph blocks are found by
  // their timestamp button's own text (a bare "m:ss"/"mm:ss" pattern) rather
  // than a class name, which is far more likely to survive a TED redesign.
  async function scrapeTedTranscriptPanel() {
    try {
      const isTimeButton = (b) => /^\d{1,2}:\d{2}$/.test((b.textContent || "").trim());
      let timeButtons = Array.from(document.querySelectorAll("button")).filter(isTimeButton);
      if (!timeButtons.length) {
        const btn = document.getElementById("transcript-control") ||
          Array.from(document.querySelectorAll("button")).find((el) => /transcript/i.test(el.textContent || ""));
        if (!btn) return [];
        btn.click();
        const found = await waitFor(() => {
          const found = Array.from(document.querySelectorAll("button")).filter(isTimeButton);
          return found.length ? found : null;
        });
        timeButtons = found || [];
      }
      if (!timeButtons.length) return [];

      const paragraphs = timeButtons.map((btn) => {
        const container = btn.closest(".mb-6") || btn.parentElement?.parentElement || btn.parentElement;
        return {
          start: parseTimestampToSeconds(btn.textContent),
          phrases: container
            ? Array.from(container.querySelectorAll('[role="button"][aria-label]'))
                .map((el) => clean(el.getAttribute("aria-label") || ""))
                .filter(Boolean)
            : []
        };
      }).filter((p) => Number.isFinite(p.start) && p.phrases.length);
      if (!paragraphs.length) return [];

      const rawCues = cuesFromTimedParagraphs(paragraphs);
      if (!rawCues.length) return [];
      return [{
        languageCode: "",
        name: { simpleText: "Transcript panel" },
        baseUrl: "",
        native: true,
        scraped: true,
        cues: normalizeCues(rawCues)
      }];
    } catch (e) {
      log("ted transcript panel scrape failed", e);
      return [];
    }
  }

  // TED's Next.js page embeds the ENTIRE transcript — every line with its
  // own exact millisecond timestamp — directly in
  // <script id="__NEXT_DATA__">, present in the page's initial HTML before
  // any "Read transcript" click. This is strictly better than DOM-scraping
  // the transcript panel (scrapeTedTranscriptPanel below): real per-line
  // timing instead of one timestamp per paragraph that then has to be
  // interpolated across several sentences. Try this first; fall back to the
  // DOM scraper only if TED ever ships a talk page without this data.
  async function getTedTranscriptFromNextData() {
    try {
      const script = document.getElementById("__NEXT_DATA__");
      if (!script?.textContent) return [];
      const data = JSON.parse(script.textContent);
      const videoData = data?.props?.pageProps?.videoData;
      const paragraphs = videoData?.transcriptData?.translation?.paragraphs;
      if (!Array.isArray(paragraphs) || !paragraphs.length) return [];

      // __NEXT_DATA__ is only guaranteed fresh on this page's initial SSR
      // load. TED is a client-routed SPA, and navigating from one talk to
      // another does not necessarily rewrite this script tag with the new
      // talk's data. Cross-check against the current URL's slug so a stale
      // (previous talk's) transcript never gets shown as if it were this
      // one.
      const currentSlug = (location.pathname.match(/\/talks\/([a-zA-Z0-9_-]+)/) || [])[1];
      if (currentSlug && videoData.slug && currentSlug !== videoData.slug) return [];

      const rawCues = [];
      for (const p of paragraphs) {
        for (const c of p?.cues || []) {
          const text = clean(String(c?.text || "").replace(/\n/g, " "));
          const start = Number(c?.time) / 1000;
          if (!text || !Number.isFinite(start)) continue;
          rawCues.push({ start, text });
        }
      }
      if (!rawCues.length) return [];
      rawCues.sort((a, b) => a.start - b.start);
      for (let i = 0; i < rawCues.length; i++) {
        rawCues[i].end = i + 1 < rawCues.length ? rawCues[i + 1].start : rawCues[i].start + 4;
      }
      return [{
        languageCode: videoData?.internalLanguageCode || "",
        name: { simpleText: "Transcript" },
        baseUrl: "",
        native: true,
        scraped: true,
        cues: normalizeCues(rawCues)
      }];
    } catch (e) {
      log("ted __NEXT_DATA__ transcript parse failed", e);
      return [];
    }
  }

  // Khan Academy's transcript list gives a REAL timestamp on every single
  // line (ul[itemprop="transcript"] > li > button, e.g. "0:00", "0:01",
  // "0:02" ...), unlike Coursera/TED's DOM panels which only have one
  // timestamp per paragraph. So no interpolation needed here — this is as
  // accurate as a native track. The first item's button also carries a
  // "Current transcript segment: " screen-reader prefix; strip it before
  // matching the leading timestamp.
  async function scrapeKhanAcademyTranscript() {
    try {
      const items = document.querySelectorAll('ul[itemprop="transcript"] > li');
      if (!items.length) return [];
      const rawCues = [];
      for (const li of items) {
        const btn = li.querySelector("button");
        if (!btn) continue;
        const raw = clean(btn.textContent || "").replace(/^current transcript segment:\s*/i, "");
        const m = raw.match(/^(\d{1,2}:\d{2})\s*(.*)$/);
        if (!m) continue;
        const start = parseTimestampToSeconds(m[1]);
        const text = clean(m[2]);
        if (!text || !Number.isFinite(start)) continue;
        rawCues.push({ start, text });
      }
      if (!rawCues.length) return [];
      for (let i = 0; i < rawCues.length; i++) {
        rawCues[i].end = i + 1 < rawCues.length ? rawCues[i + 1].start : rawCues[i].start + 4;
      }
      return [{
        languageCode: "",
        name: { simpleText: "Transcript" },
        baseUrl: "",
        native: true,
        scraped: true,
        cues: normalizeCues(rawCues)
      }];
    } catch (e) {
      log("khan academy transcript scrape failed", e);
      return [];
    }
  }

  async function scrapeTranscriptPanel() {
    if (location.hostname.endsWith("coursera.org")) return await scrapeCourseraTranscriptPanel();
    if (location.hostname.endsWith("ted.com")) {
      const fromNextData = await getTedTranscriptFromNextData();
      if (fromNextData.length) return fromNextData;
      return await scrapeTedTranscriptPanel();
    }
    if (location.hostname.endsWith("khanacademy.org")) return await scrapeKhanAcademyTranscript();
    return await scrapeYouTubeTranscriptPanel();
  }

  // Walking every <script> on a YouTube page and parsing the player JSON is expensive,
  // so the answer is cached per video (a miss is remembered for a few seconds). A response
  // that belongs to another video (soft navigation keeps the old script) is ignored.
  let domPlayerCache = { videoId: "", response: null, at: 0 };
  function extractPlayerResponseForVideo(videoId) {
    if (!videoId) return extractPlayerResponseFromDom();
    const c = domPlayerCache;
    if (c.videoId === videoId && (c.response || Date.now() - c.at < 4000)) return c.response;
    let response = extractPlayerResponseFromDom();
    const owner = response?.videoDetails?.videoId;
    if (owner && owner !== videoId) response = null;
    domPlayerCache = { videoId, response, at: Date.now() };
    return response;
  }
  let watchTracksCache = null; // { videoId, tracks, at } from the last successful watch-page lookup

  async function getCaptionTracks() {
    const videoId = state.videoId || getVideoIdFromUrl();
    const direct = captionTracksFromResponse(extractPlayerResponseForVideo(videoId));
    if (direct.length) return direct;

    const native = getNativeTextTrackCues();
    if (native.length) return native;

    const isYouTubeHost = location.hostname.endsWith("youtube.com") || location.hostname.endsWith("youtube-nocookie.com");
    if (!videoId || !isYouTubeHost) return await scrapeTranscriptPanel();
    if (watchTracksCache && watchTracksCache.videoId === videoId && Date.now() - watchTracksCache.at < 300000) return watchTracksCache.tracks;
    if (state.watchFetchPromise) return state.watchFetchPromise;
    if (state.trackDiscoveryFailedAt && Date.now() - state.trackDiscoveryFailedAt < 6000) return [];
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

    const fetched = await state.watchFetchPromise;
    if (fetched.length) {
      watchTracksCache = { videoId, tracks: fetched, at: Date.now() };
      return fetched;
    }
    return await scrapeTranscriptPanel();
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
    const trackKey = withTargetLang(stableTrackIdentity(track));
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
      state.currentTrack = track;
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

  async function _translateBatchNow(cues, session, epoch = state.translationEpoch) {
    const fresh = cues
      .filter(c => c?.text && !state.translations.has(c.id) && !state.translating.has(c.id))
      .slice(0, 20);
    if (!fresh.length || session !== state.session || epoch !== state.translationEpoch) return false;
    if (subifyAuth.blocked) { subifyAuthShow(); return false; }

    fresh.forEach(c => state.translating.add(c.id));
    try {
      const response = await browser.runtime.sendMessage({
        type: "subify-translate",
        cues: fresh,
        videoId: state.videoId,
        trackKey: state.trackKey || state.persistentCacheKey,
        targetLanguage: String(state.settings?.targetLanguage || "fa").toLowerCase(),
        sourceLanguage: String(state.trackLanguage || state.capturedCaptionLang || "").split(/[-_]/)[0].toLowerCase()
      });
      if (response?.authRequired) subifyAuthBlockNow();
      if (response?.freeAi && session === state.session) subifyFreeAiNotice(response.error, response.code);
      if (session !== state.session || epoch !== state.translationEpoch || !response?.ok) {
        log("subtitle translation batch failed: " + (response?.code || "no-answer") + (response?.error ? " - " + response.error : ""));
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
      // Every cue of this video is translated: the background reports the video as finished. It sends action=done once per
      // video, and only when the owner's key translated part of it. A partial run never reaches this check.
      if (added > 0 && session === state.session && state.cues.every(c => !c?.text || state.translations.has(c.id))) {
        browser.runtime.sendMessage({ type: "subify-free-video-done", videoId: state.videoId }).catch(() => {});
      }
      return added > 0;
    } catch (e) {
      log("subtitle translation failed", e);
      // After the extension is reloaded, this page still runs the old overlay, which can no longer reach the extension.
      if (!browser.runtime?.id || /Extension context invalidated/i.test(String(e?.message || e))) subifyFreeAiNotice("Subify به‌روز شد. این صفحه را یک بار رفرش کن تا ترجمه ادامه پیدا کند.", "stale");
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
    const epoch = state.translationEpoch;
    const task = () => _translateBatchNow(cues, session, epoch);
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
    // Subtitle translation follows the subtitles switch (extraction does not translate on its own).
    if (!Array.isArray(cues) || !cues.length || session !== state.session || state.aheadBusy || state.settings.subtitleEnabled === false) return;
    const end = now + aheadSeconds;
    const pending = (c) => c?.text && !state.translations.has(c.id) && !state.translating.has(c.id);
    // Nearest the playhead first. When that stretch is done (or the video resumed far in), the earliest untranslated
    // lines are translated, so the start of the video is never left untranslated.
    let targets = cues.filter(c => pending(c) && c.end >= now - 1000 && c.start <= end).slice(0, maxCues);
    if (!targets.length) targets = cues.filter(pending).slice(0, maxCues);
    if (!targets.length) return;
    state.aheadBusy = true;
    try {
      // Keep a small amount of parallelism so the runway fills noticeably faster
      // without turning subtitle translation into an uncontrolled request burst.
      // Small batches, three at a time, nearest cues first. A short request comes back in seconds, so the
      // runway fills before the playhead reaches it, and one slow reply does not hold up the whole window.
      // The first batch is small (4 lines) so the first subtitles appear at once.
      const PARALLEL = 3;
      const batches = [];
      for (let at = 0, size = 4; at < targets.length; at += size, size = 8) batches.push(targets.slice(at, at + size));
      for (let g = 0; g < batches.length && session === state.session; g += PARALLEL) {
        const epoch = state.translationEpoch;
        const results = await Promise.all(batches.slice(g, g + PARALLEL).map(b => _translateBatchNow(b, session, epoch)));
        if (results.some(ok => !ok) && session === state.session) {
          await new Promise(r => setTimeout(r, 450));
        }
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
    // Manual sync correction (seconds): positive pulls captions earlier
    // relative to real video time, negative pushes them later. Needed
    // because several of the newly-added platforms (Coursera, TED's DOM
    // fallback, Udemy's live-captured cues) only have approximate timing.
    const shifted = now + Number(state.settings?.subtitleOffsetSec || 0);
    let found = null;
    const source = state.cues.length ? state.cues : state.generatedCues;
    for (const cue of source) {
      if (shifted >= cue.start && shifted < cue.end) found = cue;
    }
    return found;
  }

  function addGeneratedCue(start, end, text) {
    const a = Number(start), b = Number(end);
    const t = clean(text);
    if (!t || !Number.isFinite(a) || !Number.isFinite(b) || b <= a) return;
    const cue = {
      id: `generated-${++state.generatedCueSeq}`,
      start: Math.max(0, a),
      end: Math.max(a, b),
      text: t
    };
    state.generatedCues.push(cue);
    if (state.generatedCues.length > 1000) state.generatedCues.splice(0, state.generatedCues.length - 1000);

    // Keep playback aligned even when the AI result arrives after its source start.
    // Rendering follows the video's own currentTime on the next scan.
    const now = Number(state.video?.currentTime || 0);
    if (!state.cues.length && now >= cue.start && now < cue.end) {
      state.lastShownId = cue.id;
      showCue(cue, cue.text, now);
    }
  }

  // Udemy has no DOM source anywhere with a full, timed cue list (see
  // scrapeTranscriptPanel's dispatcher: Udemy is deliberately not routed
  // there). Its "Transcript" sidebar has text but no timestamps at all, and
  // video.textTracks is empty because Udemy renders captions itself, purely
  // in JS, into this one on-screen box (data-purpose="captions-cue-text" —
  // a stable Udemy hook; do NOT match its CSS-module class, e.g.
  // "...-KMBV6", which is a build-time hash that changes on every deploy).
  // So the only option is building the cue list live, one line at a time,
  // as the box's text changes — unlike addGeneratedCue() above, this text
  // is the original English/etc. line, not a ready Persian translation, so
  // it must NOT be shown immediately the way addGeneratedCue() does: it's
  // pushed straight into state.generatedCues and left for the normal
  // renderAtCurrentTime() loop, which already auto-requests translateBatch()
  // for any cue with no cached translation yet and displays it once ready.
  function addUdemyCaptionCue(start, end, text) {
    const a = Number(start), b = Number(end);
    const t = clean(text);
    if (!t || !Number.isFinite(a) || !Number.isFinite(b) || b <= a) return;
    const cue = {
      id: `udemy-cc-${++state.generatedCueSeq}`,
      start: Math.max(0, a),
      end: Math.max(a, b),
      text: t
    };
    state.generatedCues.push(cue);
    if (state.generatedCues.length > 1000) state.generatedCues.splice(0, state.generatedCues.length - 1000);
  }

  function observeUdemyCaptionBox() {
    if (state.udemyCcObserver || state.udemyCcBodyObserver) return;

    const closePrevAt = (now) => {
      const prev = state.generatedCues[state.generatedCues.length - 1];
      if (prev && prev.end > now) prev.end = Math.max(prev.start + 0.3, now);
    };

    const onBoxChange = () => {
      const video = state.video;
      if (!video) return;
      const box = document.querySelector('[data-purpose="captions-cue-text"]');
      const text = clean(box?.textContent || "");
      const now = Number(video.currentTime || 0);
      if (!text) {
        if (state.udemyCcLastText) closePrevAt(now);
        state.udemyCcLastText = "";
        return;
      }
      if (text === state.udemyCcLastText) return;
      closePrevAt(now);
      // Provisional 6s end — trimmed down to the real gap either by the
      // next line's closePrevAt() call above, or left as-is if this turns
      // out to be the last line of the video.
      addUdemyCaptionCue(now, now + 6, text);
      state.udemyCcLastText = text;
    };

    const attach = () => {
      const box = document.querySelector('[data-purpose="captions-cue-text"]');
      if (!box?.parentElement) return false;
      state.udemyCcObserver = new MutationObserver(onBoxChange);
      state.udemyCcObserver.observe(box.parentElement, { childList: true, subtree: true, characterData: true });
      onBoxChange();
      return true;
    };

    if (attach()) return;
    // CC likely isn't turned on yet — Subify does not know Udemy's caption
    // menu layout well enough to auto-click it (unlike YouTube's CC
    // button), so just wait for the viewer to turn it on themselves and
    // attach the moment the box appears.
    state.udemyCcBodyObserver = new MutationObserver(() => {
      if (attach()) { state.udemyCcBodyObserver.disconnect(); state.udemyCcBodyObserver = null; }
    });
    state.udemyCcBodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  async function refreshTrack() {
    const tracks = await getCaptionTracks();
    if (!tracks.length) return;
    const track = pickTrack(tracks);
    if (!track) return;
    const key = withTargetLang(stableTrackIdentity(track));
    if (track.native && track.cues?.length) {
      if (key === state.trackKey) return;
      const old = new Map(state.translations);
      state.cues = track.cues;
      state.currentTrack = track;
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

  // Shared by the message-based enable/disable handlers below and by the
  // in-player control panel's own toggle, so both stay perfectly in sync
  // instead of re-implementing the same on/off logic twice.
  function setSubtitleEnabled(next) {
    state.settings.subtitleEnabled = next;
    browser.storage.local.set({ subify_subtitle_enabled: next });
    if (next) {
      void refreshTrack();
    } else {
      if (state.aheadPump) { clearInterval(state.aheadPump); state.aheadPump = null; }
      if (state.liveForcedPause) { state.liveForcedPause = false; state.video?.play().catch(() => {}); }
      state.liveHoldAt = null;
      revertAutoEnabledNativeCC();
      hide();
    }
    const wrap = document.getElementById("subify-player-wrap");
    wrap?.querySelector("#subify-player-btn")?.classList.toggle("subify-player-btn-on", next);
    const panelToggle = wrap?.querySelector("#subify-panel-subtitle");
    if (panelToggle) panelToggle.checked = next;
  }

  const PANEL_LANGUAGE_LABELS = {
    fa: "فارسی", en: "English", ar: "العربية", tr: "Türkçe", es: "Español",
    de: "Deutsch", fr: "Français", pt: "Português", ru: "Русский",
    hi: "हिन्दी", zh: "中文", ja: "日本語", ko: "한국어", it: "Italiano"
  };
  // Persian name of each language, for status text (unlike PANEL_LANGUAGE_LABELS
  // above, which shows each language in its own script for the picker itself).
  const PANEL_LANGUAGE_FA_NAME = {
    fa: "فارسی", en: "انگلیسی", ar: "عربی", tr: "ترکی", es: "اسپانیایی",
    de: "آلمانی", fr: "فرانسوی", pt: "پرتغالی", ru: "روسی", hi: "هندی",
    zh: "چینی", ja: "ژاپنی", ko: "کره‌ای", it: "ایتالیایی"
  };
  const PANEL_FONT_LABELS = {
    Lalezar: "Lalezar", Vazirmatn: "Vazirmatn", Estedad: "Estedad",
    VazirmatnVariable: "Vazirmatn Variable", IRANYekanX: "IRANYekanX",
    Peyda: "Peyda", Sahel: "Sahel", AradFDRegular: "AradFD Regular",
    AradFDMedium: "AradFD Medium", AradFDBold: "AradFD Bold",
    AradFDLight: "AradFD Light", DigiTitr: "Digi Titr Plus Bold Circle"
  };

  // Persists a partial style change (font/position) the same way the popup's
  // Style tab does — into the shared subify_settings bucket — then reuses
  // loadSettings() to apply it immediately, so the panel needs no separate
  // "apply" plumbing of its own.
  async function applyPanelSetting(patch) {
    state.settings = { ...state.settings, ...patch };
    const { subify_settings = {} } = await browser.storage.local.get("subify_settings");
    await browser.storage.local.set({ subify_settings: { ...subify_settings, ...patch } });
    state.videoSettingsLoaded = false;
    void loadSettings();
  }

  async function togglePanelDubbing(next) {
    const checkbox = document.getElementById("subify-panel-dubbing");
    try {
      const r = await browser.runtime.sendMessage({ type: "subify-set-dubbing", enabled: next });
      if (r?.authRequired) subifyAuthBlockNow();
      if (!r?.ok) { if (checkbox) checkbox.checked = !next; return; }
      await browser.storage.local.set({ subify_dubbing_enabled: next });
    } catch (_) {
      if (checkbox) checkbox.checked = !next;
    }
  }

  function buildPlayerPanel() {
    const panel = document.createElement("div");
    panel.id = "subify-player-panel";
    panel.className = "subify-player-panel";
    panel.addEventListener("click", (e) => e.stopPropagation());
    // Kept deliberately short: only the things worth touching mid-playback
    // without breaking flow (on/off, dubbing, a quick sync nudge). Language,
    // font, position, tone and glossary all live in the extension's popup —
    // repeating them here too was both confusing (which one is "the real
    // setting"?) and made the panel too long.
    panel.innerHTML = `
      <span class="subify-glass" aria-hidden="true"></span>
      <div class="subify-panel-head">
        <span class="subify-panel-title">Subify</span>
        <label class="subify-panel-switch" title="روشن/خاموش Subify">
          <input type="checkbox" id="subify-panel-subtitle">
          <span class="subify-panel-switch-track"></span>
        </label>
      </div>
      <label class="subify-panel-row subify-panel-toggle-row">
        <span id="subify-panel-dubbing-label">دوبلهٔ</span>
        <label class="subify-panel-switch subify-panel-switch-sm">
          <input type="checkbox" id="subify-panel-dubbing">
          <span class="subify-panel-switch-track"></span>
        </label>
      </label>
      <div class="subify-panel-row subify-panel-offset-row">
        <span>هماهنگی زیرنویس</span>
        <span class="subify-panel-offset-controls">
          <button type="button" id="subify-panel-offset-minus" title="دیرتر نشون بده">−</button>
          <span id="subify-panel-offset-value">0.0s</span>
          <button type="button" id="subify-panel-offset-plus" title="زودتر نشون بده">+</button>
        </span>
      </div>
      <div class="subify-panel-actions">
        <button type="button" id="subify-panel-transcript"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h8"/></svg><span>ترنسکریپت</span></button>
        <button type="button" id="subify-panel-more" title="تنظیمات Subify" aria-label="تنظیمات Subify"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg><span>تنظیمات</span></button>
      </div>
      <div class="subify-panel-ai">
        <button type="button" id="subify-panel-ai-toggle" class="subify-panel-ai-toggle" aria-expanded="false" aria-controls="subify-panel-ai-menu"></button>
        <div id="subify-panel-ai-menu" class="subify-panel-ai-menu" role="group" hidden>
          <button type="button" data-ai-page="chat.html" data-ai-key="chat"></button>
          <button type="button" data-ai-page="summary.html" data-ai-key="summary"></button>
          <button type="button" data-ai-seed="roleplay.html" data-ai-key="practice"></button>
          <button type="button" data-ai-seed="writer.html" data-ai-key="writeVideo"></button>
          <button type="button" data-ai-page="shadow.html" data-ai-key="shadow"></button>
        </div>
      </div>
      <div class="subify-panel-hint">زبان، فونت، لحن و واژه‌نامه: آیکون Subify کنار نوار آدرس</div>
    `;
    panel.querySelector("#subify-panel-subtitle").addEventListener("change", (e) => setSubtitleEnabled(e.target.checked));
    panel.querySelector("#subify-panel-dubbing").addEventListener("change", (e) => togglePanelDubbing(e.target.checked));
    // AI tools: a small group of links that open the extension pages in a new tab.
    const aiToggle = panel.querySelector("#subify-panel-ai-toggle");
    const aiMenu = panel.querySelector("#subify-panel-ai-menu");
    const paintAi = () => {
      const u = aiUi();
      aiToggle.textContent = u.ai + " ▾";
      aiMenu.querySelectorAll("[data-ai-key]").forEach((b) => { b.textContent = u[b.dataset.aiKey] || b.dataset.aiKey; });
    };
    const setAiOpen = (open) => {
      aiMenu.hidden = !open;
      aiToggle.setAttribute("aria-expanded", String(open));
    };
    aiToggle.addEventListener("click", () => {
      paintAi();
      setAiOpen(aiMenu.hidden);
      if (!aiMenu.hidden) aiMenu.querySelector("button")?.focus();
    });
    aiMenu.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setAiOpen(false);
      aiToggle.focus();
    });
    aiMenu.querySelectorAll("[data-ai-page]").forEach((b) => {
      b.addEventListener("click", () => openAiPage(b.dataset.aiPage));
    });
    aiMenu.querySelectorAll("[data-ai-seed]").forEach((b) => {
      b.addEventListener("click", () => void openAiPageForVideo(b.dataset.aiSeed));
    });
    paintAi();
    const stepOffset = (delta) => {
      const current = Number(state.settings?.subtitleOffsetSec || 0);
      const next = Math.round((current + delta) * 10) / 10;
      applyPanelSetting({ subtitleOffsetSec: next });
      syncPlayerPanel(panel);
    };
    panel.querySelector("#subify-panel-offset-minus").addEventListener("click", () => stepOffset(-0.5));
    panel.querySelector("#subify-panel-offset-plus").addEventListener("click", () => stepOffset(0.5));
    panel.querySelector("#subify-panel-transcript").addEventListener("click", () => toggleTranscriptPanel());
    panel.querySelector("#subify-panel-more").addEventListener("click", () => {
      panel.classList.remove("subify-panel-open");
      // The background opens the options page; a content script cannot do it.
      browser.runtime.sendMessage({ type: "subify-open-options" }).catch(() => {});
    });
    return panel;
  }

  function syncPlayerPanel(panel) {
    if (!panel) return;
    const s = state.settings || {};
    const langCode = s.targetLanguage || "fa";
    const dubLabel = panel.querySelector("#subify-panel-dubbing-label");
    if (dubLabel) dubLabel.textContent = "دوبلهٔ";
    const subtitleToggle = panel.querySelector("#subify-panel-subtitle");
    if (subtitleToggle) subtitleToggle.checked = s.subtitleEnabled !== false;
    const dubbingToggle = panel.querySelector("#subify-panel-dubbing");
    if (dubbingToggle && document.activeElement !== dubbingToggle) {
      browser.storage.local.get("subify_dubbing_enabled").then(({ subify_dubbing_enabled }) => {
        dubbingToggle.checked = subify_dubbing_enabled === true;
      });
    }
    const offsetValue = panel.querySelector("#subify-panel-offset-value");
    if (offsetValue) {
      const off = Number(s.subtitleOffsetSec || 0);
      offsetValue.textContent = `${off > 0 ? "+" : ""}${off.toFixed(1)}s`;
    }
  }

  // A direct control inside YouTube's own player control bar (next to
  // captions/settings/fullscreen): clicking it opens a small, deliberately
  // short panel (enable/disable, dubbing, a sync-offset nudge, and links to
  // the transcript panel / full settings) instead of just flipping one
  // switch. Language/font/position/tone/glossary live in the popup only —
  // see buildPlayerPanel's own comment for why. YouTube-only: needs .ytp-right-controls,
  // which doesn't have a reliable equivalent on Vimeo/Aparat/Coursera/
  // Twitter/Instagram without live testing there — those platforms still
  // get subtitles/dubbing, just via the toolbar popup instead of this panel.
  // One page-level listener for every player panel. Adding one per remount piled up
  // listeners on YouTube's page for as long as the tab stayed open.
  let outsideCloseBound = false;
  function ensureOutsideCloseListener() {
    if (outsideCloseBound) return;
    outsideCloseBound = true;
    document.addEventListener("click", (e) => {
      document.querySelectorAll(".subify-player-panel.subify-panel-open").forEach((panel) => {
        if (!panel.parentElement?.contains(e.target)) panel.classList.remove("subify-panel-open");
      });
    });
  }

  // YouTube keeps its own control bar, so the Subify button goes into it there. Every other
  // supported platform gets a small button floating over the top-right corner of its video.
  // Both use the same panel.
  function isYouTubeHost() {
    return /(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(location.hostname);
  }

  function createPlayerWrap() {
    const wrap = document.createElement("div");
    wrap.id = "subify-player-wrap";
    wrap.className = "subify-player-wrap";

    const btn = document.createElement("button");
    btn.id = "subify-player-btn";
    btn.className = "ytp-button subify-player-btn";
    btn.title = "Subify (زیرنویس، دوبله و تنظیمات)";
    btn.setAttribute("aria-label", "Subify");
    const icon = document.createElement("img");
    icon.src = browser.runtime.getURL("icons/icon48.png");
    icon.width = 20;
    icon.height = 20;
    icon.style.cssText = "display:block;border-radius:5px";
    icon.alt = "";
    btn.appendChild(icon);

    const panel = buildPlayerPanel();

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const opening = !panel.classList.contains("subify-panel-open");
      panel.classList.toggle("subify-panel-open", opening);
      if (opening) syncPlayerPanel(panel);
    });
    // Click-outside-to-close is handled by one page-level listener.
    ensureOutsideCloseListener();

    wrap.appendChild(panel);
    wrap.appendChild(btn);
    return wrap;
  }

  function ensurePlayerButton() {
    if (isYouTubeHost()) ensureYouTubePlayerButton();
    else ensureFloatingPlayerButton();
  }

  function ensureYouTubePlayerButton() {
    const controls = document.querySelector(".ytp-right-controls");
    if (!controls) return;
    ensureFontFamilyLoaded("Vazirmatn");
    const isOn = state.settings?.subtitleEnabled !== false;
    let wrap = controls.querySelector("#subify-player-wrap");
    if (wrap) {
      wrap.querySelector("#subify-player-btn")?.classList.toggle("subify-player-btn-on", isOn);
      if (wrap.querySelector(".subify-player-panel.subify-panel-open")) {
        syncPlayerPanel(wrap.querySelector(".subify-player-panel"));
      }
      return;
    }
    // Fullscreen and theater-mode changes can remount the control bar; the next tick builds a fresh wrap.
    wrap = createPlayerWrap();
    wrap.querySelector("#subify-player-btn").classList.toggle("subify-player-btn-on", isOn);
    controls.insertBefore(wrap, controls.firstChild);
  }

  function ensureFloatingPlayerButton() {
    const video = state.video || getVideo();
    let wrap = document.getElementById("subify-player-wrap");
    if (!video || video.tagName !== "VIDEO") {
      if (wrap) wrap.style.display = "none";
      return;
    }
    ensureFontFamilyLoaded("Vazirmatn");
    const isOn = state.settings?.subtitleEnabled !== false;
    if (!wrap) {
      wrap = createPlayerWrap();
      wrap.classList.add("subify-player-floating");
    }
    wrap.querySelector("#subify-player-btn")?.classList.toggle("subify-player-btn-on", isOn);
    if (wrap.querySelector(".subify-player-panel.subify-panel-open")) {
      syncPlayerPanel(wrap.querySelector(".subify-player-panel"));
    }
    // In fullscreen only the fullscreen element and its children are drawn, so the button moves into it.
    const fullscreen = document.fullscreenElement;
    const host = fullscreen && fullscreen.tagName !== "VIDEO" ? fullscreen : document.body;
    if (wrap.parentElement !== host) host.appendChild(wrap);
    placeFloatingPlayerButton(wrap, video);
  }

  function placeFloatingPlayerButton(wrap, video) {
    const r = video.getBoundingClientRect();
    const onScreen = r.width >= 200 && r.height >= 120 && r.bottom > 0 && r.top < window.innerHeight;
    if (!onScreen) { wrap.style.display = "none"; return; }
    wrap.style.display = "flex";
    wrap.style.top = `${Math.max(8, Math.round(r.top + 10))}px`;
    wrap.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right + 10))}px`;
  }

  // Keeps the floating button on the video while the page scrolls or resizes, one frame at a time.
  let floatingPlaceFrame = 0;
  function scheduleFloatingPlace() {
    if (floatingPlaceFrame) return;
    floatingPlaceFrame = requestAnimationFrame(() => {
      floatingPlaceFrame = 0;
      const wrap = document.getElementById("subify-player-wrap");
      const video = state.video || getVideo();
      if (wrap?.classList.contains("subify-player-floating") && video?.tagName === "VIDEO") {
        placeFloatingPlayerButton(wrap, video);
      }
    });
  }

  let playerButtonTimer = null;
  function startPlayerButtonWatch() {
    if (playerButtonTimer) return;
    if (!isYouTubeHost()) {
      window.addEventListener("scroll", scheduleFloatingPlace, { capture: true, passive: true });
      window.addEventListener("resize", scheduleFloatingPlace, { passive: true });
    }
    // The button must not depend on the subtitle scan alone: scan() returns early until a player is known,
    // and YouTube re-renders its control bar on navigation, fullscreen and ad breaks.
    playerButtonTimer = setInterval(() => {
      try { ensurePlayerButton(); } catch (e) { log("player button", e); }
    }, 1000);
  }

  function renderAtCurrentTime() {
    const video = state.video || getVideo();
    if (!video || !state.player || !state.settings.subtitleEnabled) return;
    const videoNow = Number(video.currentTime || 0);
    // Live captions only (no cue list at all): the live clock. See liveClockNow().
    const now = !state.cues.length && !state.generatedCues.length ? liveClockNow(video) : videoNow;
    liveSettleResume(video, now);

    if (!state.cues.length) {
      pumpLivePacing(video, now);
      if (!state.generatedCues.length) {
        pumpLiveCaption(now);
        return;
      }
    }

    const cue = activeCue(now);
    if (!cue) {
      hide();
      return;
    }

    const fa = state.translations.get(cue.id);
    if (!fa) {
      if (!state.translating.has(cue.id)) void translateBatch([cue], state.session);
      return;
    }

    if (cue.id !== state.lastShownId) {
      state.lastShownId = cue.id;
      showCue(cue, fa, now);
    } else {
      const el = ensureOverlay();
      if (el) {
        el.classList.add("subify-visible");
        updateKaraoke(el, now);
      }
    }
  }

  function scan() {
    const video = getVideo();
    if (!video || !state.player) {
      hide();
      return;
    }
    ensurePlayerButton();

    // YouTube can reuse the same SPA page/video URL while playing an ad first.
    // The ad and the main video may therefore share the same videoId. Reset the
    // subtitle track when the player enters/leaves an ad so ad cues/translations
    // can never leak into the main video.
    const adShowing = !!state.player?.classList?.contains("ad-showing");
    if (state.wasAdShowing !== null && state.wasAdShowing !== adShowing) {
      // Invalidate any translation request that belonged to the ad phase.
      // YouTube can reuse the same video id for the ad and the main video, so
      // a stale in-flight request must never leave the real video's queue stuck
      // on "در حال ترجمه…" after Skip Ad.
      state.translationEpoch++;
      state.translationChain = Promise.resolve();
      state.translating.clear();
      state.aheadBusy = false;
      state.videoSettingsLoaded = false;
      state.lastShownId = "";
      state.shortVideoSkipped = false;
      // YouTube can reuse the same videoId for the ad and the main video.
      // Never destroy an already-discovered main-video track here: doing so
      // makes the transcript disappear immediately after Skip Ad.
      state.ignoreCapturedUntil = Date.now() + (adShowing ? 1500 : 2500);
      hide();
      if (!adShowing) {
        // If the main track was not discovered before the ad, rebuild it now.
        // If it already exists, leave it intact and only re-check native CC.
        setTimeout(() => {
          if (!state.wasAdShowing && state.settings.subtitleEnabled) {
            if (!state.cues.length) {
              requestNativeCaptionReload(true);
              void refreshTrack();
            } else {
              renderAtCurrentTime();
              void translateWindow(state.cues, state.session, Number(state.video?.currentTime || 0), 180, 80);
            }
          }
        }, 350);
      }
    }
    state.wasAdShowing = adShowing;
    if (adShowing) {
      hide();
      return;
    }

    const id = getVideoIdFromUrl();
    if (id && id !== state.videoId) {
      state.videoId = id;
      state.videoSettingsLoaded = false;
      state.shortVideoSkipped = false;
      state.ignoreCapturedUntil = 0;
      resetTrack();
    }

    if (location.href !== state.lastUrl) {
      state.lastUrl = location.href;
      const newId = getVideoIdFromUrl();
      if (newId !== state.videoId) {
        state.videoId = newId;
        state.videoSettingsLoaded = false;
        state.shortVideoSkipped = false;
        state.ignoreCapturedUntil = 0;
        resetTrack();
      }
    }

    // Do not translate YouTube clips/ads that are 20 seconds or shorter.
    // Wait until metadata gives us a real duration so an uninitialized video
    // is not mistaken for a short one.
    const duration = Number(video.duration || 0);
    if (duration > 0 && duration <= 20) {
      if (!state.shortVideoSkipped) {
        state.shortVideoSkipped = true;
        resetTrack();
      }
      hide();
      return;
    }
    state.shortVideoSkipped = false;

    if (!state.videoSettingsLoaded && state.videoId) void loadSettings();
    // Extraction runs even with subtitles off, so the cue list is ready the moment they are
    // turned on (and dubbing has cues to work from). Only drawing, translating and touching
    // YouTube's own CC button depend on the subtitles switch.
    const subtitlesOn = state.settings.subtitleEnabled !== false;
    const now = Number(video.currentTime || 0);
    // Poll faster while nothing has been found yet — the first few seconds
    // after a video starts are exactly when a slow discovery gate is most
    // noticeable. Once a track is found, back off to the normal 1.5s cadence
    // (no reason to hammer discovery/CC-click checks after that point).
    const scanGateMs = state.cues.length ? 3000 : 500;
    if (Date.now() - state.lastScan > scanGateMs) {
      state.lastScan = Date.now();
      if (state.capturedCaptionUrl && !state.cues.length) void fetchCapturedTrack(state.capturedCaptionUrl, state.session);
      else if (state.videoId) void refreshTrack();
      // page-hook.js only ever sees a usable (Proof-of-Origin-tokened)
      // /api/timedtext request when YouTube's OWN player actually issues one —
      // which normally only happens once the viewer toggles CC on themselves.
      // Click it on their behalf so translation works without that manual step.
      if (subtitlesOn && !state.capturedCaptionUrl && !state.cues.length) ensureNativeCaptionsOn();
      if (subtitlesOn) trackNativeCcOwnership();
      // Udemy exposes no timed cue list anywhere (see scrapeTranscriptPanel);
      // once state.cues comes back empty for it, fall back to watching its
      // on-screen caption box live (see observeUdemyCaptionBox). No-op once
      // already attached, and no-op entirely if the viewer never turns CC on.
      if (subtitlesOn && !state.cues.length && location.hostname.endsWith("udemy.com")) observeUdemyCaptionBox();
    }

    // Snapshot for the AI pages. Runs even with subtitles off, as the cue list is loaded either way.
    saveCueSnapshot();

    if (!subtitlesOn) {
      hide();
      return;
    }

    checkCaptionSuggestion(now);

    // YouTube can restore the CC button as ON after a refresh while its
    // caption module has not rebuilt the actual timedtext request. Do not
    // simulate an OFF -> ON click here. Ask YouTube's own player API to
    // reload the captions module, then let the MAIN-world page hook capture
    // the real Proof-of-Origin timedtext URL via Resource Timing.
    if (!state.capturedCaptionUrl && !state.cues.length && nativeSubtitlesOn() && !nativeCaptionsRendering()) {
      forceNativeCaptionRefresh();
    }

    renderAtCurrentTime();

    // Keep a bounded translation runway ahead of the playhead. This is now
    // driven from the lightweight scan path rather than every 100ms.
    if (!state.aheadBusy && state.cues.length) void translateWindow(state.cues, state.session, now, 60, 40);
  }

  async function loadSettings(){
    const [{subify_settings},{subify_subtitle_enabled}]=await Promise.all([browser.storage.local.get("subify_settings"),browser.storage.local.get("subify_subtitle_enabled")]);
    const base={...DEFAULTS,...(subify_settings||{})};let per={};const id=state.videoId||getVideoIdFromUrl();if(id){try{const r=await browser.storage.local.get(`subify_video_${id}`);per=r[`subify_video_${id}`]||{};}catch(_){}}
    state.settings={...DEFAULTS,...base,...per,subtitleEnabled:subify_subtitle_enabled!==false};state.videoSettingsLoaded=true;installFonts();const el=state.player?.querySelector(`#${OVERLAY_ID}`);if(el){applyOverlayStyle(el);positionOverlay(el);}if(!state.settings.subtitleEnabled)hide();
  }

  window.addEventListener('subify-youtube-timedtext', (event) => { void handleCapturedTimedText(event.detail); });
  window.addEventListener('subify-udemy-caption-url', (event) => { void handleCapturedUdemyVtt(event.detail); });

  // The page-hook can capture /api/timedtext before this document-idle script
  // exists. Initialize the current video first, load the real user/provider
  // settings, and only then consume the stashed request. This ordering is
  // essential after refresh: captions may arrive before settings, while the
  // translation provider/key lives in those settings.
  state.videoId = getVideoIdFromUrl();
  getVideo();
  void (async () => {
    await ensureSettingsLoaded();
    await checkBootstrapTimedText();
    // If a caption arrived during settings initialization, explicitly kick the
    // translation runway again now that the provider configuration is known.
    if (state.cues.length && state.settings.subtitleEnabled) {
      void queueTranslateAll(state.cues, state.session, Number(state.video?.currentTime || 0));
    }
  })();

  // Instant dictionary-style popup for a clicked word — shown immediately
  // next to the word, in addition to (not instead of) saving it for later
  // review in the learning section (learn.html).
  function closeWordPopup() {
    state.wordPopupEl?.remove();
    state.wordPopupEl = null;
    if (state.lookupPaused) {
      state.lookupPaused = false;
      const v = state.video;
      if (v && v.paused) void v.play().catch(() => {});
    }
  }

  // ---------- grammar panel labels: helpers (table of labels is declared at the top of this script) ----------
  function grammarUI() {
    const code = (state.learnCfg || LRN.sanitizeLearning(null)).explainLang;
    return Object.prototype.hasOwnProperty.call(GRAMMAR_UI, code) ? GRAMMAR_UI[code] : GRAMMAR_UI.en;
  }
  function applyGrammarButtonLabel(b) {
    const ui = grammarUI();
    b.title = ui.hint;
    b.setAttribute("aria-label", ui.hint);
    b.textContent = ui.button;
  }
  function refreshGrammarButtons() {
    document.querySelectorAll(".subify-grammar-btn").forEach((b) => applyGrammarButtonLabel(b));
  }

  // ---------- contextual grammar: the grammar button on each original subtitle line ----------
  function makeGrammarButton(cue) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "subify-grammar-btn";
    applyGrammarButtonLabel(b);
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); void showGrammarPopup(b, cue); });
    return b;
  }
  function neighbourCueText(cue) {
    const source = state.cues.length ? state.cues : (state.generatedCues || []);
    const i = source.findIndex((c) => c.id === cue.id);
    if (i < 0) return { prev: "", next: "" };
    return { prev: clean(source[i - 1]?.text || ""), next: clean(source[i + 1]?.text || "") };
  }
  function placePopup(anchorEl, el) {
    const rect = anchorEl.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    let top = rect.top - el.offsetHeight - 10;
    if (top < 8) top = Math.min(rect.bottom + 10, window.innerHeight - el.offsetHeight - 8);
    const left = Math.min(Math.max(8, rect.left), vw - el.offsetWidth - 8);
    el.style.top = `${Math.max(8, top) + window.scrollY}px`;
    el.style.left = `${left + window.scrollX}px`;
  }
  function armOutsideClose(anchorEl, el) {
    const onDocClick = (e) => {
      if (state.wordPopupEl !== el) { document.removeEventListener("click", onDocClick, true); return; }
      if (!el.contains(e.target) && !anchorEl.contains(e.target)) {
        closeWordPopup();
        document.removeEventListener("click", onDocClick, true);
      }
    };
    setTimeout(() => document.addEventListener("click", onDocClick, true), 0);
  }
  function grammarRow(label, text, ltr) {
    const row = document.createElement("div");
    row.className = "subify-grammar-row";
    const b = document.createElement("b");
    b.textContent = label;
    const v = document.createElement("div");
    v.className = "subify-grammar-text";
    v.textContent = text;
    if (ltr) v.dir = "ltr";
    row.append(b, v);
    return row;
  }
  function fillGrammarBody(body, g, error, ui) {
    body.textContent = "";
    if (!g) {
      body.classList.add("subify-word-popup-loading");
      body.textContent = ui.failed + (error ? ": " + error : ".");
      return;
    }
    const rows = [
      [ui.rows[0], g.meaning, false],
      [ui.rows[1], g.tense, false],
      [ui.rows[2], g.structure, false],
      [ui.rows[3], g.grammar, false],
      [ui.rows[4], g.why, false],
      [ui.rows[5], (g.natural || []).join("  ·  "), true],
      [ui.rows[6], g.simpler, true],
      [ui.rows[7], g.advanced, true]
    ];
    for (const [label, text, ltr] of rows) if (text) body.appendChild(grammarRow(label, text, ltr));
    if (!body.childNodes.length) body.textContent = ui.empty;
  }
  async function showGrammarPopup(anchorEl, cue) {
    const sentence = clean(cue.text || "");
    if (!sentence) return;
    if (!state.grammarCache) state.grammarCache = new Map();
    closeWordPopup();
    installFonts();
    const ui = grammarUI();
    applyGrammarButtonLabel(anchorEl);
    const el = document.createElement("div");
    el.id = "subify-word-popup";
    el.className = "subify-grammar-popup";
    el.dir = "rtl";
    const head = document.createElement("div");
    head.className = "subify-word-popup-head";
    const title = document.createElement("span");
    title.className = "subify-word-popup-word";
    title.textContent = ui.head;
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "subify-word-popup-close";
    closeBtn.textContent = "✕";
    closeBtn.setAttribute("aria-label", ui.close);
    head.append(title, closeBtn);
    const body = document.createElement("div");
    body.className = "subify-grammar-body";
    body.textContent = ui.loading;
    el.append(head, body);
    document.body.appendChild(el);
    state.wordPopupEl = el;
    placePopup(anchorEl, el);
    closeBtn.addEventListener("click", closeWordPopup);
    armOutsideClose(anchorEl, el);

    const gcfg = state.learnCfg || LRN.sanitizeLearning(null);
    const key = `${cueKey(cue)}|${gcfg.cefr}|${gcfg.explainLang}`;
    let grammar = state.grammarCache.get(key) || null;
    if (!grammar) {
      try {
        const { prev, next } = neighbourCueText(cue);
        const r = await browser.runtime.sendMessage({ type: "subify-grammar", sentence, prev, next, translation: state.translations.get(cue.id) || "", lang: state.trackLanguage || "auto", cefr: gcfg.cefr, explainLang: gcfg.explainLang });
        if (!r?.ok || !r.grammar) throw new Error(r?.error || "no reply");
        grammar = r.grammar;
        state.grammarCache.set(key, grammar);
      } catch (err) {
        if (state.wordPopupEl === el) { fillGrammarBody(body, null, String(err?.message || err), ui); placePopup(anchorEl, el); }
        return;
      }
    }
    if (state.wordPopupEl === el) { fillGrammarBody(body, grammar, "", ui); placePopup(anchorEl, el); }
  }

  function showWordDefinitionPopup(anchorEl, card, opts = {}) {
    closeWordPopup();
    installFonts();
    const el = document.createElement("div");
    el.id = "subify-word-popup";
    el.dir = "rtl";
    const mk = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

    const head = mk("div", "subify-word-popup-head");
    head.appendChild(mk("span", "subify-word-popup-word", card.word || ""));
    head.lastChild.dir = "ltr";
    if (card.ipa) { const ipa = mk("span", "subify-word-popup-ipa", card.ipa); ipa.dir = "ltr"; head.appendChild(ipa); }
    if (card.pos) head.appendChild(mk("span", "subify-word-popup-pos", card.pos));
    const closeBtn = mk("button", "subify-word-popup-close", "✕");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "بستن");
    head.appendChild(closeBtn);
    el.appendChild(head);

    if (opts.loading) {
      el.appendChild(mk("div", "subify-word-popup-loading", "در حال دریافت توضیح کامل…"));
    } else {
      if (card.meaning) el.appendChild(mk("div", "subify-word-popup-meaning", card.meaning));
      if (card.definition) { const d = mk("div", "subify-word-popup-def", card.definition); d.dir = "ltr"; el.appendChild(d); }
      const syn = Array.isArray(card.synonyms) ? card.synonyms.filter(Boolean) : [];
      if (syn.length) { const r = mk("div", "subify-word-popup-line"); r.appendChild(mk("b", null, "مترادف: ")); const v = mk("span", null, syn.join(" · ")); v.dir = "ltr"; r.appendChild(v); el.appendChild(r); }
      if (card.forms) { const r = mk("div", "subify-word-popup-line"); r.appendChild(mk("b", null, "شکل‌ها: ")); const v = mk("span", null, card.forms); v.dir = "ltr"; r.appendChild(v); el.appendChild(r); }
      if (card.example) {
        const ex = mk("div", "subify-word-popup-example");
        const en = mk("div", null, card.example); en.dir = "ltr"; ex.appendChild(en);
        if (card.exampleFa) ex.appendChild(mk("div", "subify-word-popup-example-fa", card.exampleFa));
        el.appendChild(ex);
      }
      if (card.note) el.appendChild(mk("div", "subify-word-popup-note", "💡 " + card.note));
      if (!card.meaning && !card.definition) el.appendChild(mk("div", "subify-word-popup-loading", opts.error ? "توضیح دریافت نشد: " + opts.error : "توضیحی دریافت نشد."));
      const foot = card.enriched ? "ذخیره شد در بخش یادگیری" + (card.level ? ` · سطح ${card.level}` : "")
                                 : "کلمه ذخیره شد؛ توضیح کامل رو از بخش یادگیری بگیر";
      el.appendChild(mk("div", "subify-word-popup-foot", foot));
    }

    document.body.appendChild(el);
    state.wordPopupEl = el;

    const rect = anchorEl.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    let top = rect.top - el.offsetHeight - 10;
    if (top < 8) top = Math.min(rect.bottom + 10, window.innerHeight - el.offsetHeight - 8);
    const left = Math.min(Math.max(8, rect.left), vw - el.offsetWidth - 8);
    el.style.top = `${Math.max(8, top) + window.scrollY}px`;
    el.style.left = `${left + window.scrollX}px`;

    closeBtn.addEventListener("click", closeWordPopup);
    const onDocClick = (e) => {
      if (!state.wordPopupEl || state.wordPopupEl !== el) { document.removeEventListener("click", onDocClick, true); return; }
      if (!el.contains(e.target) && e.target !== anchorEl && !anchorEl.contains(e.target)) {
        closeWordPopup();
        document.removeEventListener("click", onDocClick, true);
      }
    };
    setTimeout(() => document.addEventListener("click", onDocClick, true), 0);
  }

  // Click-to-define flow shared by the live subtitle and the transcript panel:
  // open the popup instantly in a loading state, then swap in the full entry.
  async function lookUpWord(anchorEl, word, sentence, translation) {
    anchorEl.classList.add("subify-saving");
    showWordDefinitionPopup(anchorEl, { word }, { loading: true });
    try {
      const r = await browser.runtime.sendMessage({ type: "subify-vocab-enrich", word, sentence, translation, fromSubtitle: true, lang: state.trackLanguage || "auto", t: state.video ? state.video.currentTime : null });
      if (r?.ok && r.card) {
        if (!state.vocabIndex) state.vocabIndex = new Map();
        state.vocabIndex.set(LRN.wordKey(r.card && r.card.lang, word), r.card);
        reapplyHighlight();
        showWordDefinitionPopup(anchorEl, r.card, { error: r.aiError });
      }
      else showWordDefinitionPopup(anchorEl, { word }, { error: r?.error || "ذخیره نشد" });
    } catch (err) {
      showWordDefinitionPopup(anchorEl, { word }, { error: String(err?.message || err) });
    } finally {
      anchorEl.classList.remove("subify-saving");
    }
  }

  // Full transcript panel: a floating, searchable list of every cue with its
  // Persian translation (once ready) and the original line, click-to-jump.
  // Reuses state.cues/state.generatedCues + state.translations directly — no
  // separate data path. Attached to document.body (not state.player) so it
  // is never clipped by a player container's overflow:hidden, and works the
  // same on every platform since it doesn't depend on any site's own DOM.
  function formatMmSs(totalSeconds) {
    const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const m = Math.floor(s / 60), r = s % 60;
    const h = Math.floor(m / 60);
    const mm = h ? String(m % 60).padStart(2, "0") : String(m);
    return (h ? `${h}:${mm}` : mm) + ":" + String(r).padStart(2, "0");
  }

  function closeTranscriptPanel() {
    if (state.transcriptPanelTimer) { clearInterval(state.transcriptPanelTimer); state.transcriptPanelTimer = null; }
    state.transcriptPanelEl?.remove();
    state.transcriptPanelEl = null;
    state.transcriptEdit = null;
    closeWordPopup();
  }

  function renderTranscriptList(query, preserveScroll) {
    const panel = state.transcriptPanelEl;
    const list = panel?.querySelector("#subify-transcript-list");
    if (!list) return;
    const source = state.cues.length ? state.cues : state.generatedCues;
    const q = clean(query || "").toLowerCase();
    const scrollTop = preserveScroll ? list.scrollTop : 0;
    // Rows are rebuilt on each refresh. Remember which time button had the keyboard focus, and give it back.
    const focusCue = list.contains(document.activeElement) && document.activeElement.classList.contains("subify-transcript-time")
      ? (document.activeElement.closest(".subify-transcript-row")?.dataset.cueId || "") : "";
    if (!source.length) {
      list.innerHTML = `<div class="subify-transcript-empty">هنوز زیرنویسی پیدا نشده.</div>`;
      return;
    }
    list.innerHTML = "";
    const now = Number(state.video?.currentTime || 0) + Number(state.settings?.subtitleOffsetSec || 0);
    // A time is a button only when this page has a video to jump in; without one it stays plain text.
    const hasVideo = !!(state.video || getVideo());
    for (const cue of source) {
      const fa = state.translations.get(cue.id) || "";
      const orig = clean(cue.text || "");
      if (q && !fa.toLowerCase().includes(q) && !orig.toLowerCase().includes(q)) continue;
      const row = document.createElement("div");
      row.className = "subify-transcript-row" + (now >= cue.start && now < cue.end ? " subify-transcript-row-active" : "");
      row.dataset.cueId = cue.id;
      const time = document.createElement(hasVideo ? "button" : "span");
      time.className = "subify-transcript-time";
      time.textContent = formatMmSs(cue.start);
      if (hasVideo) {
        // Enter and Space work on this button. Its click stops here, so the row does not seek twice.
        time.type = "button";
        time.setAttribute("aria-label", aiUi().seek + " " + formatMmSs(cue.start));
        time.addEventListener("click", (e) => { e.stopPropagation(); seekVideoTo(cue.start); });
      }
      const textWrap = document.createElement("div");
      textWrap.className = "subify-transcript-text";
      if (state.transcriptEdit && state.transcriptEdit.cueId === cue.id) {
        textWrap.appendChild(buildCueEditor(cue));
      } else {
        const faLine = document.createElement("div");
        faLine.className = "subify-transcript-fa";
        faLine.textContent = fa || "در حال ترجمه…";
        textWrap.appendChild(faLine);
        if (fa) {
          const editBtn = document.createElement("button");
          editBtn.type = "button";
          editBtn.className = "subify-transcript-edit";
          editBtn.textContent = "ویرایش ترجمه";
          editBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            state.transcriptEdit = { cueId: cue.id, draft: fa, busy: false, focusPending: true };
            refreshTranscriptList();
          });
          textWrap.appendChild(editBtn);
        }
      }
      if (state.transcriptNote && state.transcriptNote.cueId === cue.id) {
        const noteEl = document.createElement("div");
        noteEl.className = "subify-transcript-note" + (state.transcriptNote.tone === "warn" ? " subify-transcript-note-warn" : "");
        noteEl.textContent = state.transcriptNote.text;
        textWrap.appendChild(noteEl);
      }
      if (orig) {
        // Clickable per word, same "click to save to vocabulary" behavior as
        // the live overlay's original-language line — resolved against this
        // row's own cue (not state.activeCue, which only tracks whatever the
        // video is playing right now, not whatever the person is reading here).
        const origLine = document.createElement("div");
        origLine.className = "subify-transcript-orig";
        origLine.dir = "ltr";
        for (const w of cueWords(cue, orig)) {
          const span = document.createElement("span");
          span.className = "subify-word subify-transcript-word";
          span.textContent = w.text;
          origLine.appendChild(span);
        }
        textWrap.appendChild(origLine);
      }
      row.appendChild(time);
      row.appendChild(textWrap);
      row.addEventListener("click", (e) => {
        if (e.target.closest(".subify-word, .subify-transcript-editor, .subify-transcript-edit, .subify-transcript-note")) return;
        if (state.video) { try { state.video.currentTime = cue.start; state.video.play?.().catch(() => {}); } catch (_) {} }
      });
      list.appendChild(row);
    }
    if (focusCue) list.querySelector(`.subify-transcript-row[data-cue-id="${CSS.escape(focusCue)}"] .subify-transcript-time`)?.focus({ preventScroll: true });
    if (preserveScroll) list.scrollTop = scrollTop;
  }

  function refreshTranscriptList() {
    const q = state.transcriptPanelEl?.querySelector("#subify-transcript-search")?.value || "";
    renderTranscriptList(q, true);
  }

  function cancelCueEdit() {
    state.transcriptEdit = null;
    refreshTranscriptList();
  }

  async function saveCueEdit(cue) {
    const edit = state.transcriptEdit;
    if (!edit || edit.cueId !== cue.id || edit.busy) return;
    const text = clean(edit.draft || "");
    if (!text) {
      state.transcriptNote = { cueId: cue.id, text: "ترجمه نمی‌تونه خالی باشه.", tone: "warn" };
      edit.focusPending = true;
      refreshTranscriptList();
      return;
    }
    if (text === clean(state.translations.get(cue.id) || "")) {
      state.transcriptEdit = null;
      refreshTranscriptList();
      return;
    }
    edit.busy = true;
    refreshTranscriptList();
    const result = await correctCueTranslation(cue, text);
    state.transcriptEdit = null;
    state.transcriptNote = { cueId: cue.id, text: correctionNoteText(result), tone: result?.ok ? "ok" : "warn" };
    refreshTranscriptList();
  }

  function buildCueEditor(cue) {
    const edit = state.transcriptEdit;
    const wrap = document.createElement("div");
    wrap.className = "subify-transcript-editor";
    const ta = document.createElement("textarea");
    ta.className = "subify-transcript-input";
    ta.dir = "rtl";
    ta.rows = 2;
    ta.value = edit.draft;
    ta.disabled = !!edit.busy;
    ta.setAttribute("aria-label", "ترجمه این خط");
    ta.addEventListener("input", () => { if (state.transcriptEdit) state.transcriptEdit.draft = ta.value; });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { e.preventDefault(); cancelCueEdit(); }
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void saveCueEdit(cue); }
    });
    const actions = document.createElement("div");
    actions.className = "subify-transcript-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "subify-transcript-save";
    save.textContent = edit.busy ? "در حال ذخیره…" : "ذخیره";
    save.disabled = !!edit.busy;
    save.addEventListener("click", (e) => { e.stopPropagation(); void saveCueEdit(cue); });
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "subify-transcript-cancel";
    cancel.textContent = "انصراف";
    cancel.disabled = !!edit.busy;
    cancel.addEventListener("click", (e) => { e.stopPropagation(); cancelCueEdit(); });
    actions.append(save, cancel);
    wrap.append(ta, actions);
    wrap.addEventListener("click", (e) => e.stopPropagation());
    if (edit.focusPending && !edit.busy) {
      edit.focusPending = false;
      setTimeout(() => { try { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } catch (_) {} }, 0);
    }
    return wrap;
  }

  function openTranscriptPanel() {
    if (state.transcriptPanelEl) return;
    installFonts();
    const el = document.createElement("div");
    el.id = "subify-transcript-panel";
    el.dir = "rtl";
    el.innerHTML = `
      <div class="subify-transcript-head">
        <span class="subify-transcript-title">ترنسکریپت</span>
        <input id="subify-transcript-search" type="text" placeholder="جستجو…">
        <button type="button" id="subify-transcript-close" aria-label="بستن">✕</button>
      </div>
      <div id="subify-transcript-list" class="subify-transcript-list"></div>
    `;
    document.body.appendChild(el);
    state.transcriptPanelEl = el;
    el.querySelector("#subify-transcript-close").addEventListener("click", closeTranscriptPanel);
    el.querySelector("#subify-transcript-search").addEventListener("input", (e) => renderTranscriptList(e.target.value, true));
    el.querySelector("#subify-transcript-list").addEventListener("click", (e) => {
      const w = e.target.closest(".subify-word");
      if (!w) return;
      e.stopPropagation();
      const cueId = w.closest(".subify-transcript-row")?.dataset.cueId;
      const source = state.cues.length ? state.cues : state.generatedCues;
      const cue = source.find((c) => c.id === cueId);
      const word = clean(w.textContent).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (!word || !cue) return;
      void lookUpWord(w, word, cue.text, state.translations.get(cue.id) || "");
    });
    renderTranscriptList("");
    // Translations land asynchronously and the active-row highlight tracks
    // playback, so refresh on a light poll rather than threading a redraw
    // callback through every translation/timeupdate path.
    // Re-render only when something visible changes (search text, the active row, or new translations).
    // The old 1.5 s timer rebuilt every row and word on each tick, which made long transcripts lag.
    let lastTranscriptSig = "";
    state.transcriptPanelTimer = setInterval(() => {
      // Don't rebuild rows while someone is typing a correction; it would drop their draft.
      if (state.transcriptEdit) return;
      const query = el.querySelector("#subify-transcript-search")?.value || "";
      const src = state.cues.length ? state.cues : state.generatedCues;
      const now = Number(state.video?.currentTime || 0) + Number(state.settings?.subtitleOffsetSec || 0);
      const active = src.findIndex((c) => now >= c.start && now < c.end);
      const sig = [query, src.length, state.translations.size, active].join("|");
      if (sig === lastTranscriptSig) return;
      lastTranscriptSig = sig;
      renderTranscriptList(query, true);
    }, 1500);
  }

  function toggleTranscriptPanel() {
    if (state.transcriptPanelEl) closeTranscriptPanel();
    else openTranscriptPanel();
  }

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type === 'subify-enable-subtitles') {
      setSubtitleEnabled(true);
      sendResponse({ ok: true });
      return false;
    }
    if (msg?.type === 'subify-disable-subtitles') {
      setSubtitleEnabled(false);
      sendResponse({ ok: true });
      return false;
    }

    if (msg?.type === 'subify-style-updated') {
      void loadSettings();
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
            state.trackKey = withTargetLang(`${state.videoId}|${track.languageCode || ''}|native`);
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

  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type !== "subify-popup-progress") return;
    const cues = Array.isArray(state.cues) ? state.cues : [];
    let done = 0;
    for (const c of cues) if (state.translations.has(c.id) || state.translations.has(String(c.id))) done++;
    sendResponse({ total: cues.length, done });
  });
  browser.runtime.onMessage.addListener((msg,sender,sendResponse)=>{if(msg?.type==="subify-get-current-cue"){const now=Number(state.video?.currentTime||0),cue=activeCue(now);sendResponse({ok:true,cue:cue?{id:cue.id,start:cue.start,end:cue.end,text:cue.text,fa:state.translations.get(cue.id)||""}:null,videoId:state.videoId,currentTime:now});return false;}if(msg?.type==="subify-refresh-settings"){state.videoSettingsLoaded=false;void loadSettings();sendResponse({ok:true});return false;}if(msg?.type==="subify-clear-local-cache"){void clearLocalCache().then(()=>sendResponse({ok:true}));return true;}if(msg?.type==="subify-target-language-changed"){(async()=>{state.translations.clear();state.lastShownId="";state.persistentCacheLoaded=false;state.persistentCacheKey="";await loadSettings();if(state.trackKey){const base=state.trackKey.replace(/\|tl:[^|]*$/,"");state.trackKey=withTargetLang(base);}await loadPersistentTranslations();if(state.cues.length)void queueTranslateAll(state.cues,state.session,Number(state.video?.currentTime||0));sendResponse({ok:true});})();return true;}if(msg?.type==="subify-live-capture-started"){liveBeginCapture();state.liveTimeBase=Number(state.video?.currentTime||0);state.liveCue=null;state.liveHoldAt=null;state.liveForcedPause=false;state.lastLiveCueStart=null;return false;}if(msg?.type==="subify-live-hold"){if(!liveHold.userPaused)state.liveHoldAt=state.liveTimeBase+(Number(msg.at)||0);return false;}if(msg?.type==="subify-live-cue"){onLiveCue(msg);return false;}if(msg?.type==="subify-toggle-transcript"){toggleTranscriptPanel();sendResponse({ok:true,open:Boolean(state.transcriptPanelEl)});return false;}if(msg?.type==="subify-generated-subtitle-cue"){addGeneratedCue(msg.start,msg.end,msg.text);return false;}return false;});

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.subify_settings || changes.subify_subtitle_enabled) void loadSettings();
    if (changes.subify_learning) void loadLearningConfig();
    // Dubbing and subtitles are independent features. Turning dubbing off
    // must never clear, hide, or otherwise interrupt the subtitle renderer.
  });

  // The learn page asks the tab that plays this video to jump to a note's time. ok:false when there is no video here.
  browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.type !== "subify-seek") return false;
    const video = state.video || getVideo();
    const t = Number(msg.t);
    const sameVideo = !msg.videoId || !state.videoId || msg.videoId === state.videoId;
    if (!video || !Number.isFinite(t) || !sameVideo) { sendResponse({ ok: false }); return false; }
    seekVideoTo(t);
    sendResponse({ ok: true });
    return false;
  });

  installFonts();
  void checkPendingClear();
  void loadSettings();
  void loadLearningConfig();
  void subifyAuthCheck(true); subifyAuthSchedule();
  scheduleScan(0);
  startPlayerButtonWatch();
  startKaraokeLoop();
})();
