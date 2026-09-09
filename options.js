
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
    return await browser.runtime.sendMessage(message);
  } catch (error) {
    return { ok: false, error: error?.message || "ارتباط با افزونه برقرار نشد." };
  }
}

async function load() {
  try {
    const { pd_settings } = await browser.storage.local.get("pd_settings");
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
    const { pd_settings } = await browser.storage.local.get("pd_settings");
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

    await browser.storage.local.set({ pd_settings: next });
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
      const { pd_log = [] } = await browser.storage.session.get("pd_log");
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
      const { pd_log = [] } = await browser.storage.session.get("pd_log");
      log(pd_log.slice(-1)[0]?.msg || "تست صدای دوبله پایان یافت.");
    } catch (error) {
      log(error?.message || "دریافت گزارش تست ناموفق بود.", "err");
    }
  }, 2500);
};

$("copyLog").onclick = async () => {
  try {
    const { pd_log = [] } = await browser.storage.session.get("pd_log");
    const text = pd_log.map((entry) => `${new Date(entry.t).toISOString()} [${entry.level}] ${entry.msg}`).join("\n") || "(empty)";
    await navigator.clipboard.writeText(text);
    log("گزارش در کلیپ‌بورد کپی شد.", "ok");
  } catch (error) {
    log(`کپی گزارش ناموفق بود: ${error?.message || error}`, "err");
  }
};

// ---------- usage stats & cost estimate ----------

const PROVIDER_LABELS = { gemini: "Gemini", openrouter: "OpenRouter", openai: "OpenAI", custom: "Custom API" };

function fmtNum(n) { return Math.round(n || 0).toLocaleString("fa-IR"); }

async function loadStats() {
  try {
    const { pd_stats = {}, pd_settings = {} } = await browser.storage.local.get(["pd_stats", "pd_settings"]);
    const totals = pd_stats.totals || {};
    const providers = pd_stats.providers || {};
    const rates = pd_settings.costRates || {};

    const summary = $("statsSummary");
    const rows = [
      ["کاراکتر زیرنویس ترجمه‌شده", fmtNum((totals.subtitleCharsIn || 0) + (totals.subtitleCharsOut || 0))],
      ["ثانیهٔ دوبله‌شده", fmtNum(totals.seconds)],
      ["جلسهٔ دوبله", fmtNum(totals.sessions)],
      ["خروجی گرفته‌شده (WAV / MP3)", `${fmtNum(totals.exportsWav)} / ${fmtNum(totals.exportsMp3)}`]
    ];
    summary.innerHTML = rows.map(([label, value]) => `<div class="field"><label>${label}</label><div>${value}</div></div>`).join("");

    const provKeys = Object.keys(providers);
    $("statsEmpty").style.display = provKeys.length ? "none" : "block";
    const container = $("statsProviders");
    container.innerHTML = provKeys.map((key) => {
      const p = providers[key];
      const chars = (p.subtitleCharsIn || 0) + (p.subtitleCharsOut || 0);
      const rate = rates[key] || 0;
      const cost = rate ? ((chars / 1000) * rate) : null;
      const label = PROVIDER_LABELS[key] || key;
      const barPct = Math.max(4, Math.min(100, Math.round((chars / Math.max(1, Math.max(...provKeys.map(k => (providers[k].subtitleCharsIn || 0) + (providers[k].subtitleCharsOut || 0))))) * 100)));
      return `
        <div class="field wide" style="margin-bottom:10px">
          <label>${label} — ${fmtNum(p.subtitleCues)} خط، ${fmtNum(chars)} کاراکتر</label>
          <div style="background:var(--surface2);border-radius:8px;overflow:hidden;height:8px;margin:4px 0 8px"><div style="background:var(--teal);height:100%;width:${barPct}%"></div></div>
          <div class="grid">
            <div class="field"><label for="rate_${key}">نرخ به ازای هر ۱۰۰۰ کاراکتر</label><input id="rate_${key}" data-provider="${key}" class="cost-rate" type="number" min="0" step="0.01" value="${rate || ""}" placeholder="مثلاً تومان یا $"></div>
            <div class="field"><label>هزینهٔ تخمینی</label><div>${cost === null ? "— (نرخ رو وارد کن)" : cost.toLocaleString("fa-IR", { maximumFractionDigits: 2 })}</div></div>
          </div>
        </div>`;
    }).join("");

    container.querySelectorAll(".cost-rate").forEach((input) => {
      input.addEventListener("change", async () => {
        const { pd_settings: current = {} } = await browser.storage.local.get("pd_settings");
        const nextRates = { ...(current.costRates || {}), [input.dataset.provider]: Number(input.value) || 0 };
        await browser.storage.local.set({ pd_settings: { ...current, costRates: nextRates } });
        void loadStats();
      });
    });
  } catch (error) {
    log(`بارگذاری آمار ناموفق بود: ${error?.message || error}`, "err");
  }
}

// ---------- clear all data ----------

$("clearDataBtn").onclick = () => { $("clearConfirm").style.display = "block"; };
$("clearDataCancelBtn").onclick = () => { $("clearConfirm").style.display = "none"; };
$("clearDataConfirmBtn").onclick = async () => {
  $("clearDataConfirmBtn").disabled = true;
  const result = await safeSendMessage({ type: "subify-clear-all-data" });
  $("clearDataConfirmBtn").disabled = false;
  $("clearConfirm").style.display = "none";
  if (result?.ok) {
    $("clearDataStatus").textContent = "همهٔ داده‌ها پاک شد ✓";
    void load();
    void loadStats();
  } else {
    $("clearDataStatus").textContent = `ناموفق: ${result?.error || "خطای نامشخص"}`;
  }
};

void load();
void loadStats();
