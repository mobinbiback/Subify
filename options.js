
const __sby_p = (() => {
  const a = [77,111,98,105,110,98,105,98,97,107];
  return Object.freeze({
    id: a.map((n,i) => String.fromCharCode(n ^ 0)).join(''),
    stamp: 'subify-provenance-v2416'
  });
})();
const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  engine: "live",
  liveModel: "gemini-3.5-live-translate-preview",
  liveVoice: "auto",
  sttModel: "gemini-3.5-flash",
  ttsModel: "gemini-3.1-flash-tts-preview",
  autoFallback: true,
  recordSession: true,
  recordMaxSeconds: 5400,
  duckLevel: 0.12,
  dubGain: 1.6,
  playbackRate: 1,
  skipPersian: true
};

const MIGRATIONS = {
  "gemini-2.0-flash": "gemini-3.5-flash",
  "gemini-2.5-flash": "gemini-3.5-flash",
  "gemini-2.5-flash-lite": "gemini-3.1-flash-lite",
  "gemini-2.5-flash-tts": "gemini-3.1-flash-tts-preview",
  "gemini-2.5-pro-tts": "gemini-3.1-flash-tts-preview"
};

function log(message, cls = "") {
  const diag = $("diag");
  if (!diag) return;
  diag.className = `diag ${cls}`;
  diag.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
}

async function safeSendMessage(message) {
  try {
    return await chrome.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, error: error?.message || "ارتباط با افزونه برقرار نشد." };
  }
}

async function load() {
  try {
    const { pd_settings } = await chrome.storage.local.get("pd_settings");
    const s = { ...DEFAULTS, ...(pd_settings || {}) };
    s.sttModel = MIGRATIONS[s.sttModel] || s.sttModel;
    s.ttsModel = MIGRATIONS[s.ttsModel] || s.ttsModel;

    $("engine").value = s.engine;
    $("liveModel").value = s.liveModel;
    $("liveVoice").value = s.liveVoice;
    $("sttModel").value = s.sttModel;
    $("ttsModel").value = s.ttsModel;
    $("dubGain").value = s.dubGain;
    $("duckLevel").value = s.duckLevel;
    $("playbackRate").value = s.playbackRate;
    $("recordMaxSeconds").value = Math.round(s.recordMaxSeconds / 60);
    $("autoFallback").checked = s.autoFallback !== false;
    $("recordSession").checked = s.recordSession !== false;
    $("skipPersian").checked = s.skipPersian !== false;
  } catch (error) {
    log(`بارگذاری تنظیمات ناموفق بود: ${error?.message || error}`, "err");
  }
}

$("saveBtn").onclick = async () => {
  try {
    const { pd_settings } = await chrome.storage.local.get("pd_settings");
    const current = { ...DEFAULTS, ...(pd_settings || {}) };
    const next = {
      ...current,
      engine: $("engine").value,
      liveModel: $("liveModel").value,
      liveVoice: $("liveVoice").value,
      sttModel: $("sttModel").value,
      ttsModel: $("ttsModel").value,
      dubGain: Number($("dubGain").value),
      duckLevel: Number($("duckLevel").value),
      playbackRate: Number($("playbackRate").value),
      recordMaxSeconds: Math.max(5, Number($("recordMaxSeconds").value) || 90) * 60,
      autoFallback: $("autoFallback").checked,
      recordSession: $("recordSession").checked,
      skipPersian: $("skipPersian").checked
    };

    await chrome.storage.local.set({ pd_settings: next });
    $("saved").style.opacity = "1";
    setTimeout(() => { $("saved").style.opacity = "0"; }, 1600);
    log("تنظیمات پیشرفتهٔ دوبله ذخیره شد.", "ok");
  } catch (error) {
    log(`ذخیره تنظیمات ناموفق بود: ${error?.message || error}`, "err");
  }
};

$("testLive").onclick = async () => {
  log("تست اتصال Live شروع شد...");
  const result = await safeSendMessage({ type: "popup-test-live" });
  if (result?.ok === false && result?.error) {
    log(result.error, "err");
    return;
  }
  setTimeout(async () => {
    try {
      const { pd_log = [] } = await chrome.storage.session.get("pd_log");
      log(pd_log.slice(-1)[0]?.msg || "تست Live پایان یافت.");
    } catch (error) {
      log(error?.message || "دریافت گزارش تست ناموفق بود.", "err");
    }
  }, 2500);
};

$("selfTest").onclick = async () => {
  log("تست صدای دوبله شروع شد...");
  const result = await safeSendMessage({ type: "popup-self-test" });
  if (result?.ok === false && result?.error) {
    log(result.error, "err");
    return;
  }
  setTimeout(async () => {
    try {
      const { pd_log = [] } = await chrome.storage.session.get("pd_log");
      log(pd_log.slice(-1)[0]?.msg || "تست صدای دوبله پایان یافت.");
    } catch (error) {
      log(error?.message || "دریافت گزارش تست ناموفق بود.", "err");
    }
  }, 2500);
};

$("copyLog").onclick = async () => {
  try {
    const { pd_log = [] } = await chrome.storage.session.get("pd_log");
    const text = pd_log.map((entry) => `${new Date(entry.t).toISOString()} [${entry.level}] ${entry.msg}`).join("\n") || "(empty)";
    await navigator.clipboard.writeText(text);
    log("گزارش در کلیپ‌بورد کپی شد.", "ok");
  } catch (error) {
    log(`کپی گزارش ناموفق بود: ${error?.message || error}`, "err");
  }
};

void load();
