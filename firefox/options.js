
function setSafeHTML(el, html) {
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  el.replaceChildren(...Array.from(doc.body.childNodes).map(node => document.importNode(node, true)));
}
function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

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
  duckLevel: 0.3,
  dubGain: 1.6,
  playbackRate: 1,
  skipPersian: true,
  skipLangs: "",
  subtitleDomain: "general"
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
    // Upgrade the old built-in defaults only; explicit custom selections stay untouched.
    if (!pd_settings || pd_settings.sttModel === "gemini-3.1-flash-lite") s.sttModel = DEFAULTS.sttModel;
    if (!pd_settings || pd_settings.ttsModel === "gemini-2.5-flash-preview-tts") s.ttsModel = DEFAULTS.ttsModel;
    s.sttModel = MIGRATIONS[s.sttModel] || s.sttModel;
    s.ttsModel = MIGRATIONS[s.ttsModel] || s.ttsModel;

    $("engine").value = s.engine;
    $("liveModel").value = s.liveModel;
    $("liveVoice").value = s.liveVoice;
    $("sttModel").value = s.sttModel;
    $("ttsModel").value = s.ttsModel;
    $("recordMaxSeconds").value = Math.round(s.recordMaxSeconds / 60);
    $("autoFallback").checked = s.autoFallback !== false;
    $("recordSession").checked = s.recordSession !== false;
    $("skipPersian").checked = s.skipPersian !== false;
    $("skipLangs").value = s.skipLangs || "";
    $("subtitleDomain").value = s.subtitleDomain || "general";
  } catch (error) {
    log(`بارگذاری تنظیمات ناموفق بود: ${error?.message || error}`, "err");
  }
}

// Starting presets: one press saves the learning mode, level, subject and dub volume together.
const OPTION_PRESETS = {
  student: { learning: { smartMode: "study", highlightMode: "saved", cefr: "B2", replaySpeed: 0.85 }, subtitleDomain: "general", duckLevel: 0.2 },
  beginner: { learning: { smartMode: "active", highlightMode: "saved", cefr: "A2", replaySpeed: 0.75 }, subtitleDomain: "general", duckLevel: 0.4 },
  series: { learning: { smartMode: "relaxed", highlightMode: "off", cefr: "B1", replaySpeed: 1 }, subtitleDomain: "slang", duckLevel: 0.2 }
};
document.querySelectorAll("[data-preset]").forEach((button) => {
  button.onclick = async () => {
    const preset = OPTION_PRESETS[button.dataset.preset];
    if (!preset) return;
    try {
      const { pd_settings, subify_learning } = await browser.storage.local.get(["pd_settings", "subify_learning"]);
      const dub = { ...DEFAULTS, ...(pd_settings || {}), subtitleDomain: preset.subtitleDomain, duckLevel: preset.duckLevel };
      const learning = window.SubifyLearning.sanitizeLearning({ ...window.SubifyLearning.sanitizeLearning(subify_learning), ...preset.learning });
      await browser.storage.local.set({ pd_settings: dub, subify_learning: learning });
      learningCfg = learning;
      await load();
      await loadLearningSettings();
      log(`پیش‌تنظیم «${button.textContent.trim()}» ذخیره شد.`, "ok");
    } catch (error) {
      log(`ذخیره‌ی پیش‌تنظیم ناموفق بود: ${error?.message || error}`, "err");
    }
  };
});

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
      recordMaxSeconds: Math.max(5, Number($("recordMaxSeconds").value) || 90) * 60,
      autoFallback: $("autoFallback").checked,
      recordSession: $("recordSession").checked,
      skipPersian: $("skipPersian").checked,
      skipLangs: $("skipLangs").value.trim(),
      subtitleDomain: $("subtitleDomain").value
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

// ---------- API keys (moved here from the popup) ----------
// Keys live in pd_settings like before; the popup no longer edits them.

async function loadPanelKeys() {
  const { pd_settings = {} } = await browser.storage.local.get("pd_settings");
  $("pk-gemini").value = pd_settings.apiKey || "";
  $("pk-openrouter").value = pd_settings.openRouterKey || "";
  $("pk-openai").value = pd_settings.openaiKey || "";
}

async function savePanelKeys() {
  const { pd_settings = {} } = await browser.storage.local.get("pd_settings");
  await browser.storage.local.set({
    pd_settings: {
      ...pd_settings,
      apiKey: $("pk-gemini").value.trim(),
      openRouterKey: $("pk-openrouter").value.trim(),
      openaiKey: $("pk-openai").value.trim()
    }
  });
}

$("pk-save").onclick = async () => {
  await savePanelKeys();
  $("pk-status").textContent = "کلیدها ذخیره شدند ✓";
};

// Tests read the saved key from storage, so save what is on the screen first.
async function testPanelKey(type, label, failText) {
  await savePanelKeys();
  $("pk-status").textContent = `در حال تست ${label}…`;
  const r = await safeSendMessage({ type });
  $("pk-status").textContent = r?.ok ? `${label} متصل است • ${r.model || ""}` : (r?.error || failText);
}
$("pk-test-gemini").onclick = () => testPanelKey("subify-test-key", "Gemini", "کلید Gemini معتبر نیست یا هنوز تنظیم نشده است.");
$("pk-test-openrouter").onclick = () => testPanelKey("subify-test-openrouter", "OpenRouter", "اتصال OpenRouter ناموفق بود.");
$("pk-test-openai").onclick = () => testPanelKey("subify-test-openai", "OpenAI", "اتصال OpenAI ناموفق بود.");

void loadPanelKeys();

// Debug report (was the popup's «گزارش فنی»): last entries of the session log.
$("showLog").onclick = async () => {
  const box = $("techLog");
  try {
    const { pd_log = [] } = await browser.storage.session.get("pd_log");
    box.textContent = pd_log.slice(-30).map((e) => `${new Date(e.t).toLocaleTimeString("fa-IR")}  ${e.msg}`).join("\n") || "گزارشی ثبت نشده است.";
  } catch (error) {
    box.textContent = error?.message || "خواندن گزارش ناموفق بود.";
  }
  box.style.display = "block";
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
    const unit = pd_settings.costUnit === "tokens" ? "tokens" : "chars";
    if ($("costUnit")) $("costUnit").value = unit;
    renderActivity(pd_stats);

    const summary = $("statsSummary");
    const rows = [
      ["کاراکتر زیرنویس ترجمه‌شده", fmtNum((totals.subtitleCharsIn || 0) + (totals.subtitleCharsOut || 0))],
      ["ثانیهٔ دوبله‌شده", fmtNum(totals.seconds)],
      ["جلسهٔ دوبله", fmtNum(totals.sessions)],
      ["خروجی گرفته‌شده (WAV / MP3)", `${fmtNum(totals.exportsWav)} / ${fmtNum(totals.exportsMp3)}`]
    ];
    setSafeHTML(summary, rows.map(([label, value]) => `<div class="field"><label>${label}</label><div>${value}</div></div>`).join(""));

    const provKeys = Object.keys(providers);
    $("statsEmpty").style.display = provKeys.length ? "none" : "block";
    const container = $("statsProviders");
    // Rough estimate only — we count characters, not real API tokens, and the
    // chars-per-token ratio varies by language/model (Persian in particular
    // tends to tokenize less efficiently than English). Good enough for a
    // ballpark subscription-pricing calculation, not for exact billing.
    const CHARS_PER_TOKEN_ESTIMATE = 4;
    setSafeHTML(container, provKeys.map((key) => {
      const p = providers[key];
      const chars = (p.subtitleCharsIn || 0) + (p.subtitleCharsOut || 0);
      const rate = rates[key] || 0;
      const usageAmount = unit === "tokens" ? chars / CHARS_PER_TOKEN_ESTIMATE : chars;
      const usageUnitSize = unit === "tokens" ? 1_000_000 : 1000;
      const cost = rate ? ((usageAmount / usageUnitSize) * rate) : null;
      const rateLabel = unit === "tokens" ? "نرخ به ازای هر ۱ میلیون توکن (تخمینی)" : "نرخ به ازای هر ۱۰۰۰ کاراکتر";
      const label = escapeHtml(PROVIDER_LABELS[key] || key);
      const barPct = Math.max(4, Math.min(100, Math.round((chars / Math.max(1, Math.max(...provKeys.map(k => (providers[k].subtitleCharsIn || 0) + (providers[k].subtitleCharsOut || 0))))) * 100)));
      const usageLabel = unit === "tokens" ? `${fmtNum(usageAmount)} توکن (تخمینی)` : `${fmtNum(chars)} کاراکتر`;
      return `
        <div class="field wide" style="margin-bottom:10px">
          <label>${label}: ${fmtNum(p.subtitleCues)} خط، ${usageLabel}</label>
          <div style="background:var(--surface2);border-radius:8px;overflow:hidden;height:8px;margin:4px 0 8px"><div style="background:var(--teal);height:100%;width:${barPct}%"></div></div>
          <div class="grid">
            <div class="field"><label for="rate_${escapeHtml(key)}">${rateLabel}</label><input id="rate_${escapeHtml(key)}" data-provider="${escapeHtml(key)}" class="cost-rate" type="number" min="0" step="0.01" value="${rate || ""}" placeholder="مثلاً تومان یا $"></div>
            <div class="field"><label>هزینهٔ تخمینی</label><div>${cost === null ? "(نرخ رو وارد کن)" : cost.toLocaleString("fa-IR", { maximumFractionDigits: 2 })}</div></div>
          </div>
        </div>`;
    }).join(""));

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
    $("clearDataStatus").textContent = result.serverDeleted === false
      ? "داده‌های این دستگاه پاک شد. نسخهٔ سرور پاک نشد؛ اتصال را بررسی کن و دوباره امتحان کن."
      : "همهٔ داده‌ها پاک شد ✓";
    void load();
    void loadStats();
  } else {
    $("clearDataStatus").textContent = `ناموفق: ${result?.error || "خطای نامشخص"}`;
  }
};

// ---------- custom API providers ----------
// Moved here from the popup (see popup.js) — this page is a normal tab, so the
// permissions.request() prompt below doesn't blow away whatever the user just typed.

async function ensureCustomOriginPermission(base) {
  // Firefox/Android build: custom API settings must save without opening a
  // host-permission prompt. The Firefox manifest intentionally has no
  // optional host permissions.
  try {
    new URL(/^https?:\/\//i.test(base) ? base : `https://${base}`);
    return true;
  } catch (_) {
    $("cp-status").textContent = "Base URL معتبر نیست.";
    return false;
  }
}

async function loadCustomProviderList() {
  const { pd_settings = {} } = await browser.storage.local.get("pd_settings");
  const list = Array.isArray(pd_settings.customProviders) ? pd_settings.customProviders : [];
  const sel = $("cp-list");
  setSafeHTML(sel, list.length
    ? list.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}</option>`).join("")
    : `<option value="">هنوز سرویسی اضافه نشده</option>`);
  if (!list.length) { clearCustomProviderForm(); return; }
  sel.value = sel.dataset.pendingId || pd_settings.customProviderId || list[0].id;
  sel.dataset.pendingId = "";
  fillCustomProviderForm(sel.value, list);
}
function clearCustomProviderForm() {
  $("cp-name").value = ""; $("cp-base").value = ""; $("cp-key").value = ""; $("cp-model").value = "";
  $("cp-model-list-wrap").style.display = "none";
}
function fillCustomProviderForm(id, list) {
  const p = (list || []).find((x) => x.id === id);
  if (!p) { clearCustomProviderForm(); return; }
  $("cp-name").value = p.name || ""; $("cp-base").value = p.baseUrl || ""; $("cp-key").value = p.apiKey || ""; $("cp-model").value = p.model || "";
  $("cp-status").textContent = `سرویس فعال: ${p.name || "Custom API"}`;
}
async function saveCustomProviderForm() {
  const name = $("cp-name").value.trim() || "Custom API";
  const base = $("cp-base").value.trim();
  const key = $("cp-key").value.trim();
  const model = $("cp-model").value.trim();
  if (!base || !key || !model) { $("cp-status").textContent = "نام سرویس، Base URL، API Key و Model ID الزامی هستند."; return null; }
  if (!(await ensureCustomOriginPermission(base))) return null;
  const { pd_settings = {} } = await browser.storage.local.get("pd_settings");
  const list = Array.isArray(pd_settings.customProviders) ? [...pd_settings.customProviders] : [];
  const id = $("cp-list").dataset.newId || $("cp-list").value || `custom_${Date.now()}`;
  const item = { id, name, baseUrl: base, apiKey: key, model };
  const idx = list.findIndex((x) => x.id === id);
  if (idx >= 0) list[idx] = item; else list.push(item);
  await browser.storage.local.set({ pd_settings: { ...pd_settings, customProviders: list, customProviderId: id, subtitleProvider: "custom" } });
  $("cp-list").dataset.newId = ""; $("cp-list").dataset.pendingId = id;
  await loadCustomProviderList();
  $("cp-status").textContent = "سرویس ذخیره شد ✓";
  return item;
}
$("cp-list").addEventListener("change", async (e) => {
  const { pd_settings = {} } = await browser.storage.local.get("pd_settings");
  const list = Array.isArray(pd_settings.customProviders) ? pd_settings.customProviders : [];
  await browser.storage.local.set({ pd_settings: { ...pd_settings, customProviderId: e.target.value } });
  fillCustomProviderForm(e.target.value, list);
});
$("cp-save").addEventListener("click", saveCustomProviderForm);
$("cp-new").addEventListener("click", () => {
  $("cp-list").dataset.newId = `custom_${Date.now()}`;
  $("cp-list").value = "";
  clearCustomProviderForm();
  $("cp-status").textContent = "اطلاعات سرویس جدید رو وارد کن و ذخیره بزن.";
});
$("cp-delete").addEventListener("click", async () => {
  const id = $("cp-list").value;
  if (!id) return;
  const { pd_settings = {} } = await browser.storage.local.get("pd_settings");
  const list = (Array.isArray(pd_settings.customProviders) ? pd_settings.customProviders : []).filter((p) => p.id !== id);
  await browser.storage.local.set({ pd_settings: { ...pd_settings, customProviders: list, customProviderId: list[0]?.id || "", subtitleProvider: list.length ? "custom" : "auto" } });
  await loadCustomProviderList();
  $("cp-status").textContent = "سرویس حذف شد.";
});
$("cp-test").addEventListener("click", async () => {
  if (!(await saveCustomProviderForm())) return;
  const id = $("cp-list").value;
  const r = await safeSendMessage({ type: "subify-test-custom", id });
  $("cp-status").textContent = r?.ok ? `اتصال موفق ✓ • ${r.name} • ${r.model}` : (r?.error || "تست ناموفق بود.");
});
$("cp-models").addEventListener("click", async () => {
  if (!(await saveCustomProviderForm())) return;
  const id = $("cp-list").value;
  const r = await safeSendMessage({ type: "subify-list-custom-models", id });
  const wrap = $("cp-model-list-wrap"), sel = $("cp-model-list");
  if (!r?.ok) { $("cp-status").textContent = r?.error || "دریافت مدل‌ها ناموفق بود."; return; }
  sel.replaceChildren();
  r.models.forEach((m) => { const o = document.createElement("option"); o.value = m; o.textContent = m; sel.appendChild(o); });
  wrap.style.display = r.models.length ? "block" : "none";
  $("cp-status").textContent = r.models.length ? `${r.models.length} مدل پیدا شد.` : "مدلی برگردانده نشد؛ Model ID رو دستی وارد کن.";
});
$("cp-model-list").addEventListener("change", async (e) => { $("cp-model").value = e.target.value; await saveCustomProviderForm(); });


// #custom-providers is routed to the Settings section by showPanel() (end of this file).

void loadCustomProviderList();

$("costUnit")?.addEventListener("change", async (e) => {
  const { pd_settings = {} } = await browser.storage.local.get("pd_settings");
  await browser.storage.local.set({ pd_settings: { ...pd_settings, costUnit: e.target.value === "tokens" ? "tokens" : "chars" } });
  void loadStats();
});

void load();
void loadStats();


// ---------- learning settings & learning statistics (Smart Watching, highlighting, replay) ----------
const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const LEARN_STATUS_LABEL = { new: "تازه", learning: "در حال یادگیری", mastered: "یادگرفته‌شده" };

let learningCfg = null; // in-memory copy: rapid changes must not race each other through storage

async function loadLearningSettings() {
  const { subify_learning } = await browser.storage.local.get("subify_learning");
  const cfg = window.SubifyLearning.sanitizeLearning(subify_learning);
  learningCfg = cfg;
  $("lrnSmart").value = cfg.smartMode;
  $("lrnHighlight").value = cfg.highlightMode;
  $("lrnSpeed").value = String(cfg.replaySpeed);
  $("lrnReplay").checked = cfg.replayEnabled;
  $("lrnPause").checked = cfg.pauseAfterSentence;
  // The placeholder ("choose") shows until the learner picks a language, so an unset state is visible.
  $("lrnTarget").value = cfg.targetLangSet ? cfg.targetLang : "";
  $("lrnCefr").value = cfg.cefr;
  $("lrnExplain").value = cfg.explainLang;
  $("lrnNative").value = cfg.nativeLang;
  updateLangView();
}

function updateLangView() {
  const name = $("lrnTarget")?.selectedOptions?.[0]?.textContent || "…";
  const view = `${name} · سطح ${$("lrnCefr")?.value || "…"}`;
  setTxt("lrnTargetView", view);
  setTxt("toolsLangView", view);
}

async function saveLearningSetting(field, value) {
  if (!learningCfg) {
    const { subify_learning } = await browser.storage.local.get("subify_learning");
    learningCfg = window.SubifyLearning.sanitizeLearning(subify_learning);
  }
  learningCfg = window.SubifyLearning.sanitizeLearning({ ...learningCfg, [field]: value });
  await browser.storage.local.set({ subify_learning: learningCfg });
  $("lrnSaved").textContent = "✓";
}

async function loadLearningStats() {
  const L = window.SubifyLearning;
  const [{ pd_stats = {} }, vocab] = await Promise.all([
    browser.storage.local.get("pd_stats"),
    browser.runtime.sendMessage({ type: "subify-vocab-list" }).catch(() => null)
  ]);
  const rows = vocab?.ok ? vocab.rows : [];
  const s = L.learningStats(rows, Date.now());
  const t = pd_stats.totals || {};
  renderFeatures(t, s.reviews);
  $("lrnStats").innerHTML = [
    ["لغت‌های ذخیره‌شده", s.saved],
    ["در حال یادگیری", s.learning],
    ["تازه (هنوز مرور نشده)", s.newWords],
    ["یادگرفته‌شده", s.mastered],
    ["لغت‌های نوبت مرور", s.due],
    ["مرورهای ثبت‌شده", s.reviews],
    ["جمله‌های زیرنویس ترجمه‌شده", t.subtitleCues || 0],
    ["جلسه‌های زندهٔ شروع‌شده", t.sessions || 0]
  ].map(([label, value]) => `<div class="field"><label>${esc(label)}</label><div>${fmtNum(value)}</div></div>`).join("");

  const langs = Object.entries(s.byLang).sort((a, b) => b[1] - a[1]);
  $("lrnLangs").textContent = langs.length ? langs.map(([k, v]) => `${k}: ${fmtNum(v)}`).join("  ·  ") : "…";

  const plats = Object.entries(pd_stats.domains || {})
    .map(([host, d]) => [host, Number(d?.seconds || 0)])
    .filter(([, sec]) => sec > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  $("lrnPlatforms").textContent = plats.length ? plats.map(([h, sec]) => `${h}: ${fmtNum(sec)} ث`).join("  ·  ") : "…";

  $("lrnRecent").innerHTML = s.recent.length
    ? s.recent.map((r) => `<div>${esc(r.word)} <span class="hint">· ${esc(LEARN_STATUS_LABEL[r.status] || "")} · ${esc(r.updatedAt ? new Date(r.updatedAt).toLocaleDateString("fa-IR") : "")}</span></div>`).join("")
    : "…";
}

$("lrnSmart")?.addEventListener("change", (e) => void saveLearningSetting("smartMode", e.target.value));
$("lrnHighlight")?.addEventListener("change", (e) => void saveLearningSetting("highlightMode", e.target.value));
$("lrnSpeed")?.addEventListener("change", (e) => void saveLearningSetting("replaySpeed", Number(e.target.value)));
$("lrnReplay")?.addEventListener("change", (e) => void saveLearningSetting("replayEnabled", !!e.target.checked));
$("lrnPause")?.addEventListener("change", (e) => void saveLearningSetting("pauseAfterSentence", !!e.target.checked));
$("lrnTarget")?.addEventListener("change", async (e) => {
  if (!e.target.value) return; // the placeholder is not a choice
  await saveLearningSetting("targetLang", e.target.value);
  await saveLearningSetting("targetLangSet", true); // English saved this way counts as chosen too
  updateLangView();
});
$("lrnCefr")?.addEventListener("change", (e) => { void saveLearningSetting("cefr", e.target.value); updateLangView(); });
$("lrnExplain")?.addEventListener("change", (e) => void saveLearningSetting("explainLang", e.target.value));
$("lrnNative")?.addEventListener("change", async (e) => {
  const code = e.target.value;
  await saveLearningSetting("nativeLang", code);
  await saveLearningSetting("explainLang", code);
  $("lrnExplain").value = code;
  const { subify_settings = {} } = await browser.storage.local.get("subify_settings");
  await browser.storage.local.set({ subify_settings: { ...subify_settings, targetLanguage: code } });
});

void loadLearningSettings();
void loadLearningStats();

// ---------- management panel: sections (hash router), dashboard, statistics panels ----------
// Every number here is read from data this extension already stores on this device.

function setTxt(id, value) { const n = $(id); if (n) n.textContent = value; }

const PANEL_IDS = ["dashboard", "translate", "learning", "keys", "account"];

// Old and popup deep links map onto the merged sections.
const DEEP_LINKS = { "statistics": "dashboard", "settings": "translate", "extension": "account", "help": "account", "about": "account", "tech-report": "account", "privacy": "account", "custom-providers": "keys", "api-keys": "keys", "vocab-review": "learning", "learning-settings": "learning" };

function showPanel(afterNavigation = false) {
  const hash = (location.hash || "").replace("#", "");
  let name = DEEP_LINKS[hash] || hash;
  if (!PANEL_IDS.includes(name)) name = "dashboard";
  document.querySelectorAll(".dash-panel").forEach((p) => p.classList.toggle("is-active", p.dataset.panel === name));
  document.querySelectorAll(".dash-nav a[data-nav]").forEach((a) => {
    const on = a.dataset.nav === name;
    a.classList.toggle("is-active", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  const anchor = hash && hash !== name ? document.getElementById(hash) : null;
  if (anchor) {
    const fold = anchor.closest("details");
    if (fold) fold.open = true;
    anchor.scrollIntoView({ block: "start" });
  } else if (afterNavigation) {
    // only when the user moves between sections; a page opened with a hash stays at the top
    document.querySelector(".dash-layout")?.scrollIntoView({ block: "start" });
  }
}
window.addEventListener("hashchange", () => showPanel(true));

function renderActivity(pd_stats) {
  const box = $("statsActivity"); if (!box) return;
  const days = pd_stats.days || {};
  let any = false;
  const rows = [];
  for (let i = 0; i < 7; i++) {
    const key = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10); // same UTC day key as background.js
    const v = days[key] || {};
    if (v.sessions || v.seconds || v.subtitleCues) any = true;
    const label = new Date(`${key}T00:00:00Z`).toLocaleDateString("fa-IR", { month: "short", day: "numeric", timeZone: "UTC" });
    rows.push(`<div class="mini-row"><span>${escapeHtml(label)}</span><span>${fmtNum(v.sessions)}</span><span>${fmtNum(v.seconds)}</span><span>${fmtNum(v.subtitleCues)}</span></div>`);
  }
  if (!any) {
    box.innerHTML = `<p class="hint" style="margin:0">هنوز چیزی ترجمه یا دوبله نکرده‌ای. یک ویدیو را باز کن و زیرنویس را روشن کن؛ عددها همین‌جا ثبت می‌شوند.</p>`;
    return;
  }
  box.innerHTML = `<div class="mini-row head"><span>روز</span><span>جلسه</span><span>ثانیهٔ دوبله</span><span>خط زیرنویس</span></div>` + rows.join("");
}

function renderFeatures(t, reviews) {
  const box = $("statsFeatures"); if (!box) return;
  const items = [
    ["دوبله (جلسه)", t.sessions || 0],
    ["زیرنویس ترجمه‌شده (خط)", t.subtitleCues || 0],
    ["تشخیص گفتار (درخواست)", t.sttCalls || 0],
    ["خروجی صدا (WAV / MP3)", (t.exportsWav || 0) + (t.exportsMp3 || 0)],
    ["مرور لغت", reviews || 0]
  ].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!items.length) { box.innerHTML = `<span class="hint">هنوز قابلیتی استفاده نشده.</span>`; return; }
  const max = items[0][1];
  box.innerHTML = items.map(([label, v]) =>
    `<div class="bar-row"><span>${escapeHtml(label)} <b>· ${fmtNum(v)}</b></span><div class="bar"><i style="width:${Math.max(4, Math.round((v / max) * 100))}%"></i></div></div>`
  ).join("");
}

// Account state comes from account-gate.js (it dispatches subify-auth-state after each check).
let lastAuth = null;
document.addEventListener("subify-auth-state", (e) => { lastAuth = e.detail || null; void renderOverview(); });

function providerLabelOf(p) { return p === "github" ? "GitHub" : p === "google" ? "Google" : ""; }

function subtitleRouteLabel(s) {
  const p = s.subtitleProvider;
  if (!p || p === "auto") return "خودکار";
  if (p === "custom") {
    const list = Array.isArray(s.customProviders) ? s.customProviders : [];
    const c = list.find((x) => x.id === s.customProviderId) || list[0];
    return c?.name || "Custom API";
  }
  return PROVIDER_LABELS[p] || p;
}

async function renderOverview() {
  try {
    const [{ pd_stats = {}, pd_settings = {} }, vocab] = await Promise.all([
      browser.storage.local.get(["pd_stats", "pd_settings"]),
      browser.runtime.sendMessage({ type: "subify-vocab-list" }).catch(() => null)
    ]);
    const t = pd_stats.totals || {};

    if (!lastAuth) { setTxt("dbAccount", "…"); setTxt("dbAccountSub", "در حال بررسی"); }
    else if (lastAuth.user) { setTxt("dbAccount", lastAuth.user.name || lastAuth.user.email || "وارد شده"); setTxt("dbAccountSub", "ورود با " + (providerLabelOf(lastAuth.user.provider) || "حساب")); }
    else if (lastAuth.offline) { setTxt("dbAccount", "نامشخص"); setTxt("dbAccountSub", "اتصال به sub-ify.site برقرار نشد"); }
    else { setTxt("dbAccount", "وارد نشده"); setTxt("dbAccountSub", lastAuth.required ? "ورود لازم است" : "ورود اختیاری است"); }

    const engine = pd_settings.engine === "chunked" ? "Chunked fallback" : "Live Translate";
    const route = subtitleRouteLabel(pd_settings);
    setTxt("dbEngine", engine);
    setTxt("dbEngineSub", "ترجمهٔ زیرنویس: " + route);
    setTxt("extEngine", engine);
    setTxt("extSubProvider", route);
    try { setTxt("extVersion", browser.runtime.getManifest().version); } catch (e) { setTxt("extVersion", "…"); }

    setTxt("dbSeconds", fmtNum((t.seconds || 0) / 60));
    setTxt("dbSecondsSub", `${fmtNum(t.sessions || 0)} جلسهٔ دوبله`);

    const rows = vocab?.ok ? vocab.rows : [];
    const s = window.SubifyLearning ? window.SubifyLearning.learningStats(rows, Date.now()) : { saved: 0, due: 0 };
    setTxt("dbWords", fmtNum(s.saved));
    setTxt("dbDue", "نوبت مرور: " + fmtNum(s.due));

    const today = (pd_stats.days || {})[new Date().toISOString().slice(0, 10)] || {};
    const todayBox = $("dbToday");
    if (todayBox) {
      todayBox.innerHTML = [
        ["جلسهٔ دوبله", today.sessions],
        ["ثانیهٔ دوبله", today.seconds],
        ["خط زیرنویس", today.subtitleCues],
        ["خروجی صدا", (today.exportsWav || 0) + (today.exportsMp3 || 0)]
      ].map(([label, v]) => `<div class="kv"><label>${label}</label><div>${fmtNum(v)}</div></div>`).join("");
    }
  } catch (error) {
    console.warn("داشبورد: بارگذاری ناموفق بود", error);
  }
}

// ---------- collapsible boxes ----------
// Each titled section folds, with its title as the toggle. The nodes are moved, not rebuilt,
// so every control keeps its id and its listeners.
function makeSectionsFoldable() {
  document.querySelectorAll(".dash-panel .section").forEach((sec) => {
    const title = sec.firstElementChild;
    if (!title || title.tagName !== "H2") return;
    const fold = document.createElement("details");
    fold.className = "section fold";
    // Only the first section of each panel starts open; the rest stay folded until the user opens them.
    fold.open = sec === sec.parentElement.querySelector(".section");
    if (sec.id) { fold.id = sec.id; sec.removeAttribute("id"); }
    const summary = document.createElement("summary");
    summary.appendChild(title);
    const chev = document.createElement("span");
    chev.className = "fold-chev";
    chev.setAttribute("aria-hidden", "true");
    summary.appendChild(chev);
    const body = document.createElement("div");
    body.className = "fold-body";
    while (sec.firstChild) body.appendChild(sec.firstChild);
    fold.append(summary, body);
    sec.replaceWith(fold);
  });
}

makeSectionsFoldable();
showPanel();
void renderOverview();

// The free AI note under the API keys: on or off, and whether the key the user saved takes over.
async function loadFreeAiNote() {
  const note = $("freeAiNote");
  if (!note) return;
  try {
    const r = await fetch("https://sub-ify.site/auth/ai.php?action=state", { credentials: "include", cache: "no-store" });
    const s = await r.json();
    if (!s || s.ok === false || !s.enabled) {
      note.textContent = "هوش مصنوعی رایگان الان خاموش است یا وارد حساب نشده‌ای. کلید خودت را ذخیره کن، یا وارد حساب شو.";
      return;
    }
    const { pd_settings = {} } = await browser.storage.local.get("pd_settings");
    const usingKey = !!String(pd_settings.apiKey || "").trim();
    note.textContent = usingKey
      ? "کلید خودت ذخیره شده؛ درخواست‌ها با کلید تو می‌روند و سهمیه‌ی رایگان مصرف نمی‌شود."
      : `هوش مصنوعی رایگان فعال است و بدون کلید هم کار می‌کند. منابع این ماه: ${s.used || 0} از ${s.limit || 0}.`;
  } catch (_) {
    note.textContent = "هوش مصنوعی رایگان: وضعیت در دسترس نیست. اتصال به sub-ify.site را بررسی کن.";
  }
}
void loadFreeAiNote();

// Custom service starts: fill the name, address and model. The key is still typed by the user.
const CP_PRESETS = {
  deepseek: { name: "DeepSeek", base: "https://api.deepseek.com", model: "deepseek-flash" },
  gisoo: { name: "Gisoo", base: "https://gisoo.pro/api/v1", model: "gemini-3.1-flash-lite" },
};
document.querySelectorAll("[data-cp-preset]").forEach((button) => {
  button.addEventListener("click", () => {
    const preset = CP_PRESETS[button.dataset.cpPreset];
    if (!preset) return;
    $("cp-name").value = preset.name;
    $("cp-base").value = preset.base;
    $("cp-model").value = preset.model;
    $("cp-status").textContent = "الگو پر شد. کلید سرویس را وارد کن و «ذخیره و فعال‌سازی سرویس» را بزن.";
  });
});

// Full-sentence translations for the options page (same reason as the popup: the walker swaps single words only).
window.SubifyUI?.register({"en": {"پنل مدیریت افزونه · حساب، وضعیت، آمار و تنظیمات": "Subify extension panel · Account, status, stats and settings", "با حساب وارد شو تا تیکت پشتیبانی ثبت کنی و همگام‌سازی لغت‌ها فعال شود. ورود اختیاری است.": "Sign in to open support tickets and turn on vocabulary sync. Signing in is optional.", "نام کاربری یا ایمیل": "Username or email", "نسخه، مسیرهای فعال و تغییرات همین نسخه.": "Version, active paths and changes in this release.", "این نسخه": "This version", "این نسخه برای Google Chrome است. دوبلهٔ صدای همان تب را هم در همین نسخه انجام می‌دهد.": "This version is for Google Chrome. It also dubs the audio of the same tab.", "فقط اعدادی نشان داده می‌شن که این افزونه واقعاً اندازه گرفته. هیچ عددی حدس زده یا ساخته نمی‌شه.": "Only numbers this extension actually measured are shown. No number is guessed or made up.", "استفاده و برآورد هزینه": "Usage and cost estimate", "اعداد زیر مصرف واقعیِ همین افزونه‌ست.": "The numbers below are this extension's real usage.", "فعالیت ۷ روز اخیر": "Activity, last 7 days", "هنوز چیزی ترجمه یا دوبله نکرده‌ای. یک ویدیو را باز کن و زیرنویس را روشن کن؛ عددها همین‌جا ثبت می‌شوند.": "Nothing translated or dubbed yet. Open a video and turn on subtitles; the numbers will appear here.", "برای برآورد هزینه، نرخ هر سرویس رو خودت جلوش وارد کن، چون قیمت‌ها بین سرویس‌ها/مدل‌ها فرق داره و مدام تغییر می‌کنه، اینجا هیچ عددی حدس زده نمی‌شه؛ فقط مصرف تو در نرخی که خودت می‌دی ضرب می‌شه.": "To estimate costs, enter each service's rate yourself, because prices differ between services and models and change often. No number is guessed here; only your usage is multiplied by the rate you enter.", "قابلیت‌ها و پلتفرم‌ها": "Features and platforms", "پرمصرف‌ترین قابلیت‌ها (تعداد ثبت‌شده)": "Most used features (count recorded)", "هنوز قابلیتی استفاده نشده.": "No feature has been used yet.", "مرور لغت‌های ذخیره‌شده و تنظیمات یادگیری. دکمهٔ «یادگیری» توی پاپ‌آپ افزونه مستقیم صفحهٔ مرور لغت‌ها رو باز می‌کنه.": "Review your saved words and learning settings. The 'Learn' button in the extension popup opens the word review page directly.", "یکی را انتخاب کن · سطح B1": "Pick one · level B1", "صفحهٔ کامل لغت‌ها و مرور": "Full word list and review", "پیش‌تنظیم‌ها: یک بار بزن و حالت یادگیری، سطح، حوزهٔ ویدیو و صدای اصلی دوبله با هم تنظیم می‌شن و همان لحظه ذخیره می‌شن.": "Presets: click once and the learning mode, level, video area and original dubbing volume are set together and saved right away.", "تازه‌کار": "Beginner", "سریال و فیلم": "Series and movies", "مطالعه، یادگیری + توقف روی جمله‌ای که لغت مرور دارد": "Study, learn + pause on a sentence that has a word due for review", "یکی را انتخاب کن": "Pick one", "موتور و صدای دوبله، کلیدهای API و سرویس‌های اختصاصی، داده‌های ذخیره‌شده و گزارش فنی روی این دستگاه.": "The translation engine and dubbing voice, API keys and custom services, saved data and the diagnostic report are kept on this device.", "زبان‌هایی که بلدی (کد، جدا با ویرگول، مثلاً en, es). دوبله نمی‌شوند.": "Languages you know (code, comma separated, e.g. en, es). They are not dubbed.", "حوزه‌ی ویدیو برای ترجمه": "Video domain for translation", "عمومی": "General", "مهندسی نرم‌افزار": "Software engineering", "پزشکی": "Medicine", "عامیانه و اسلنگ": "Colloquial and slang", "هوش مصنوعی رایگان: وضعیت در دسترس نیست. اتصال به sub-ify.site را بررسی کن.": "Free AI is unavailable right now. Check the connection to sub-ify.site.", "کلیدها فقط روی همین دستگاه (Storage محلی مرورگر) ذخیره می‌شن و جز به همان سرویسی که انتخاب کردی ارسال نمی‌شن. مدل هر سرویس از تب «ترجمه» در پاپ‌آپ انتخاب می‌شه.": "Keys are stored only on this device (browser local storage) and are sent only to the service you chose. Each service's model is picked in the Translate tab of the popup.", "فقط ۴ چیز لازم است:": "Only 4 things are needed:", "اسم، آدرس، کلید و کد مدل. همه را از سایت همان سرویس کپی کن.": "Name, address, key and model code. Copy them all from that service's website.", "شروع از الگو:": "Start from a template:", "کلیدهای API و تمام تنظیمات فقط روی همین دستگاه (Storage محلی مرورگر) ذخیره می‌شن و جز به همون سرویسی که خودت انتخاب کردی (Gemini/OpenRouter/OpenAI/Custom) به‌جای دیگه‌ای ارسال نمی‌شن. تنها داده‌ای که جدا از این می‌رود، آمار ناشناس روزانهٔ زیر است و قابل خاموش‌کردن است. جزئیات کامل در فایل PRIVACY.md همراه افزونه.": "API keys and all settings are stored only on this device (browser local storage) and are sent nowhere except to the service you chose (Gemini, OpenRouter, OpenAI or Custom). The only other data sent is the anonymous daily usage stats below, which you can turn off. Full details are in PRIVACY.md included with the extension.", "گزارش فنی آخرین رویدادهای افزونه روی همین دستگاه است. برای پشتیبانی، گزارش را کپی کن و برایمان بفرست. تست Live و تست صدای دوبله فقط مسیر دوبله را امتحان می‌کنن؛ تست کلیدهای Gemini، OpenRouter و OpenAI در بخش «کلیدهای API» است.": "The technical report keeps the latest extension events on this device. For support, copy the report and send it to us. The Live and dubbing tests only try the dubbing path; the Gemini, OpenRouter and OpenAI key tests are in the 'API keys' section.", "نمایش گزارش": "Show report", "راهنما و پشتیبانی": "Help and support", "برای گزارش مشکل، ابتدا وارد حساب شو تا تیکت ثبت کنی؛ یا مستقیم در تلگرام پیام بده.": "To report a problem, sign in first so you can open a ticket, or message us directly on Telegram.", "پشتیبانی تلگرام": "Telegram support", "ثبت تیکت": "Open ticket", "راهنمای گام‌به‌گام": "Step-by-step guide", "حریم خصوصی": "Privacy", "سایت Subify": "Subify website", "برای کنترل سریع زیرنویس، موتور ترجمه و استایل از پاپ‌آپ افزونه استفاده کن؛ کلیدها و سرویس‌ها را اینجا در «تنظیمات» وارد کن.": "For quick control of subtitles, the translation engine and style, use the extension popup. Enter keys and services here in 'Settings'.", "زبان رابط کاربری": "UI language", "کلیدهای API و سرویس‌ها": "API keys and services", "این صفحه رو باز کن و با حساب گوگلت وارد شو:": "Open this page and sign in with your Google account:", "کلید Gemini برای همه‌چیز لازمه: زیرنویس، دوبله، واژه‌نامه و ترجمهٔ زنده. پلن رایگان سقف درخواست داره؛ اگه خطای quota دیدی، یه دقیقه صبر کن.": "A Gemini key is needed for everything: subtitles, dubbing, vocabulary and live translation. The free plan has a request limit; if you see a quota error, wait a minute."}, "ar": {"پنل مدیریت افزونه · حساب، وضعیت، آمار و تنظیمات": "لوحة الإضافة · الحساب والحالة والإحصاءات والإعدادات", "با حساب وارد شو تا تیکت پشتیبانی ثبت کنی و همگام‌سازی لغت‌ها فعال شود. ورود اختیاری است.": "سجّل الدخول لفتح تذاكر الدعم وتفعيل مزامنة المفردات. تسجيل الدخول اختياري.", "نام کاربری یا ایمیل": "اسم المستخدم أو البريد", "نسخه، مسیرهای فعال و تغییرات همین نسخه.": "الإصدار والمسارات النشطة وتغييرات هذا الإصدار.", "این نسخه": "هذا الإصدار", "این نسخه برای Google Chrome است. دوبلهٔ صدای همان تب را هم در همین نسخه انجام می‌دهد.": "هذا الإصدار لمتصفح Google Chrome، ويدبلج أيضًا صوت التبويب نفسه.", "فقط اعدادی نشان داده می‌شن که این افزونه واقعاً اندازه گرفته. هیچ عددی حدس زده یا ساخته نمی‌شه.": "تظهر فقط الأرقام التي قاسها هذا الإضافة فعلًا. لا يُخمَّن أي رقم ولا يُختلق.", "استفاده و برآورد هزینه": "الاستخدام وتقدير التكلفة", "اعداد زیر مصرف واقعیِ همین افزونه‌ست.": "الأرقام أدناه هي الاستخدام الفعلي لهذه الإضافة.", "فعالیت ۷ روز اخیر": "النشاط خلال آخر 7 أيام", "هنوز چیزی ترجمه یا دوبله نکرده‌ای. یک ویدیو را باز کن و زیرنویس را روشن کن؛ عددها همین‌جا ثبت می‌شوند.": "لم تترجم أو تدبلج شيئًا بعد. افتح فيديو وفعّل الترجمات، وستظهر الأرقام هنا.", "برای برآورد هزینه، نرخ هر سرویس رو خودت جلوش وارد کن، چون قیمت‌ها بین سرویس‌ها/مدل‌ها فرق داره و مدام تغییر می‌کنه، اینجا هیچ عددی حدس زده نمی‌شه؛ فقط مصرف تو در نرخی که خودت می‌دی ضرب می‌شه.": "لتقدير التكلفة، أدخل سعر كل خدمة بنفسك، لأن الأسعار تختلف بين الخدمات والنماذج وتتغير باستمرار. لا يُخمَّن أي رقم هنا؛ يُضرب استخدامك فقط في السعر الذي تدخله.", "قابلیت‌ها و پلتفرم‌ها": "الميزات والمنصات", "پرمصرف‌ترین قابلیت‌ها (تعداد ثبت‌شده)": "أكثر الميزات استخدامًا (العدد المسجَّل)", "هنوز قابلیتی استفاده نشده.": "لم تُستخدم أي ميزة بعد.", "مرور لغت‌های ذخیره‌شده و تنظیمات یادگیری. دکمهٔ «یادگیری» توی پاپ‌آپ افزونه مستقیم صفحهٔ مرور لغت‌ها رو باز می‌کنه.": "راجع كلماتك المحفوظة وإعدادات التعلّم. زر «التعلّم» في نافذة الإضافة يفتح صفحة مراجعة الكلمات مباشرة.", "یکی را انتخاب کن · سطح B1": "اختر واحدًا · المستوى B1", "صفحهٔ کامل لغت‌ها و مرور": "قائمة الكلمات الكاملة والمراجعة", "پیش‌تنظیم‌ها: یک بار بزن و حالت یادگیری، سطح، حوزهٔ ویدیو و صدای اصلی دوبله با هم تنظیم می‌شن و همان لحظه ذخیره می‌شن.": "الإعدادات الجاهزة: انقر مرة واحدة فيُضبط وضع التعلّم والمستوى ومجال الفيديو ومستوى صوت الدبلجة الأصلي معًا ويُحفظ فورًا.", "تازه‌کار": "مبتدئ", "سریال و فیلم": "المسلسلات والأفلام", "مطالعه، یادگیری + توقف روی جمله‌ای که لغت مرور دارد": "دراسة وتعلّم + توقف عند الجملة التي تحتوي كلمة حان وقت مراجعتها", "یکی را انتخاب کن": "اختر واحدًا", "موتور و صدای دوبله، کلیدهای API و سرویس‌های اختصاصی، داده‌های ذخیره‌شده و گزارش فنی روی این دستگاه.": "محرّك الترجمة وصوت الدبلجة ومفاتيح API والخدمات المخصّصة والبيانات المحفوظة وتقرير التشخيص تُحفظ على هذا الجهاز.", "زبان‌هایی که بلدی (کد، جدا با ویرگول، مثلاً en, es). دوبله نمی‌شوند.": "اللغات التي تتقنها (الرمز، مفصولة بفاصلة، مثل en, es). لا تُدبلج.", "حوزه‌ی ویدیو برای ترجمه": "مجال الفيديو للترجمة", "عمومی": "عام", "مهندسی نرم‌افزار": "هندسة البرمجيات", "پزشکی": "الطب", "عامیانه و اسلنگ": "العامية والعبارات الدارجة", "هوش مصنوعی رایگان: وضعیت در دسترس نیست. اتصال به sub-ify.site را بررسی کن.": "الذكاء الاصطناعي المجاني غير متاح الآن. تحقّق من الاتصال بـ sub-ify.site.", "کلیدها فقط روی همین دستگاه (Storage محلی مرورگر) ذخیره می‌شن و جز به همان سرویسی که انتخاب کردی ارسال نمی‌شن. مدل هر سرویس از تب «ترجمه» در پاپ‌آپ انتخاب می‌شه.": "تُحفظ المفاتيح على هذا الجهاز فقط (التخزين المحلي للمتصفح) ولا تُرسل إلا إلى الخدمة التي اخترتها. يُختار نموذج كل خدمة من تبويب «الترجمة» في النافذة.", "فقط ۴ چیز لازم است:": "تحتاج إلى 4 أشياء فقط:", "اسم، آدرس، کلید و کد مدل. همه را از سایت همان سرویس کپی کن.": "الاسم والعنوان والمفتاح ورمز النموذج. انسخها كلها من موقع الخدمة نفسها.", "شروع از الگو:": "ابدأ من قالب:", "کلیدهای API و تمام تنظیمات فقط روی همین دستگاه (Storage محلی مرورگر) ذخیره می‌شن و جز به همون سرویسی که خودت انتخاب کردی (Gemini/OpenRouter/OpenAI/Custom) به‌جای دیگه‌ای ارسال نمی‌شن. تنها داده‌ای که جدا از این می‌رود، آمار ناشناس روزانهٔ زیر است و قابل خاموش‌کردن است. جزئیات کامل در فایل PRIVACY.md همراه افزونه.": "تُحفظ مفاتيح API وكل الإعدادات على هذا الجهاز فقط (التخزين المحلي للمتصفح) ولا تُرسل إلا إلى الخدمة التي اخترتها (Gemini أو OpenRouter أو OpenAI أو Custom). البيانات الأخرى الوحيدة المُرسلة هي إحصاءات الاستخدام اليومية المجهولة أدناه، ويمكن إيقافها. التفاصيل الكاملة في ملف PRIVACY.md المرفق مع الإضافة.", "گزارش فنی آخرین رویدادهای افزونه روی همین دستگاه است. برای پشتیبانی، گزارش را کپی کن و برایمان بفرست. تست Live و تست صدای دوبله فقط مسیر دوبله را امتحان می‌کنن؛ تست کلیدهای Gemini، OpenRouter و OpenAI در بخش «کلیدهای API» است.": "يحفظ التقرير الفني آخر أحداث الإضافة على هذا الجهاز. للدعم، انسخ التقرير وأرسله إلينا. اختبارا Live والدبلجة يجرّبان مسار الدبلجة فقط، واختبارات مفاتيح Gemini وOpenRouter وOpenAI في قسم «مفاتيح API».", "نمایش گزارش": "عرض التقرير", "راهنما و پشتیبانی": "المساعدة والدعم", "برای گزارش مشکل، ابتدا وارد حساب شو تا تیکت ثبت کنی؛ یا مستقیم در تلگرام پیام بده.": "للإبلاغ عن مشكلة، سجّل الدخول أولًا لفتح تذكرة، أو راسلنا مباشرة على تلغرام.", "پشتیبانی تلگرام": "الدعم عبر تلغرام", "ثبت تیکت": "فتح تذكرة", "راهنمای گام‌به‌گام": "دليل خطوة بخطوة", "حریم خصوصی": "الخصوصية", "سایت Subify": "موقع Subify", "برای کنترل سریع زیرنویس، موتور ترجمه و استایل از پاپ‌آپ افزونه استفاده کن؛ کلیدها و سرویس‌ها را اینجا در «تنظیمات» وارد کن.": "للتحكم السريع في الترجمات ومحرّك الترجمة والنمط، استخدم نافذة الإضافة؛ وأدخل المفاتيح والخدمات هنا في «الإعدادات».", "زبان رابط کاربری": "لغة الواجهة", "کلیدهای API و سرویس‌ها": "مفاتيح API والخدمات", "این صفحه رو باز کن و با حساب گوگلت وارد شو:": "افتح هذه الصفحة وسجّل الدخول بحساب Google:", "کلید Gemini برای همه‌چیز لازمه: زیرنویس، دوبله، واژه‌نامه و ترجمهٔ زنده. پلن رایگان سقف درخواست داره؛ اگه خطای quota دیدی، یه دقیقه صبر کن.": "مفتاح Gemini ضروري لكل شيء: الترجمات والدبلجة والمفردات والترجمة الحية. الخطة المجانية لها حد للطلبات؛ إذا ظهر خطأ quota فانتظر دقيقة."}, "es": {"پنل مدیریت افزونه · حساب، وضعیت، آمار و تنظیمات": "Panel de Subify · Cuenta, estado, estadísticas y ajustes", "با حساب وارد شو تا تیکت پشتیبانی ثبت کنی و همگام‌سازی لغت‌ها فعال شود. ورود اختیاری است.": "Inicia sesión para abrir tickets de soporte y activar la sincronización de vocabulario. Es opcional.", "نام کاربری یا ایمیل": "Usuario o correo", "نسخه، مسیرهای فعال و تغییرات همین نسخه.": "Versión, rutas activas y cambios de esta versión.", "این نسخه": "Esta versión", "این نسخه برای Google Chrome است. دوبلهٔ صدای همان تب را هم در همین نسخه انجام می‌دهد.": "Esta versión es para Google Chrome y también dobla el audio de la misma pestaña.", "فقط اعدادی نشان داده می‌شن که این افزونه واقعاً اندازه گرفته. هیچ عددی حدس زده یا ساخته نمی‌شه.": "Solo se muestran los números que esta extensión midió realmente. Ningún número se adivina ni se inventa.", "استفاده و برآورد هزینه": "Uso y estimación de costos", "اعداد زیر مصرف واقعیِ همین افزونه‌ست.": "Los números de abajo son el uso real de esta extensión.", "فعالیت ۷ روز اخیر": "Actividad de los últimos 7 días", "هنوز چیزی ترجمه یا دوبله نکرده‌ای. یک ویدیو را باز کن و زیرنویس را روشن کن؛ عددها همین‌جا ثبت می‌شوند.": "Aún no has traducido ni doblado nada. Abre un video y activa los subtítulos; los números aparecerán aquí.", "برای برآورد هزینه، نرخ هر سرویس رو خودت جلوش وارد کن، چون قیمت‌ها بین سرویس‌ها/مدل‌ها فرق داره و مدام تغییر می‌کنه، اینجا هیچ عددی حدس زده نمی‌شه؛ فقط مصرف تو در نرخی که خودت می‌دی ضرب می‌شه.": "Para estimar costos, introduce tú la tarifa de cada servicio: los precios cambian entre servicios y modelos. Aquí no se adivina ningún número; solo se multiplica tu uso por la tarifa que escribas.", "قابلیت‌ها و پلتفرم‌ها": "Funciones y plataformas", "پرمصرف‌ترین قابلیت‌ها (تعداد ثبت‌شده)": "Funciones más usadas (cantidad registrada)", "هنوز قابلیتی استفاده نشده.": "Aún no se ha usado ninguna función.", "مرور لغت‌های ذخیره‌شده و تنظیمات یادگیری. دکمهٔ «یادگیری» توی پاپ‌آپ افزونه مستقیم صفحهٔ مرور لغت‌ها رو باز می‌کنه.": "Repasa tus palabras guardadas y los ajustes de aprendizaje. El botón «Aprender» del popup abre directamente la página de repaso.", "یکی را انتخاب کن · سطح B1": "Elige uno · nivel B1", "صفحهٔ کامل لغت‌ها و مرور": "Lista completa de palabras y repaso", "پیش‌تنظیم‌ها: یک بار بزن و حالت یادگیری، سطح، حوزهٔ ویدیو و صدای اصلی دوبله با هم تنظیم می‌شن و همان لحظه ذخیره می‌شن.": "Ajustes predefinidos: haz clic una vez y se configuran juntos el modo de aprendizaje, el nivel, el tema del video y el volumen original del doblaje, y se guardan al instante.", "تازه‌کار": "Principiante", "سریال و فیلم": "Series y películas", "مطالعه، یادگیری + توقف روی جمله‌ای که لغت مرور دارد": "Estudiar, aprender + pausa en la frase que tiene una palabra para repasar", "یکی را انتخاب کن": "Elige uno", "موتور و صدای دوبله، کلیدهای API و سرویس‌های اختصاصی، داده‌های ذخیره‌شده و گزارش فنی روی این دستگاه.": "El motor de traducción y la voz del doblaje, las claves de API, los servicios personalizados, los datos guardados y el informe técnico se mantienen en este dispositivo.", "زبان‌هایی که بلدی (کد، جدا با ویرگول، مثلاً en, es). دوبله نمی‌شوند.": "Idiomas que dominas (código, separados por coma, p. ej. en, es). No se doblan.", "حوزه‌ی ویدیو برای ترجمه": "Tema del video para la traducción", "عمومی": "General", "مهندسی نرم‌افزار": "Ingeniería de software", "پزشکی": "Medicina", "عامیانه و اسلنگ": "Coloquial y jerga", "هوش مصنوعی رایگان: وضعیت در دسترس نیست. اتصال به sub-ify.site را بررسی کن.": "La IA gratuita no está disponible ahora. Revisa la conexión a sub-ify.site.", "کلیدها فقط روی همین دستگاه (Storage محلی مرورگر) ذخیره می‌شن و جز به همان سرویسی که انتخاب کردی ارسال نمی‌شن. مدل هر سرویس از تب «ترجمه» در پاپ‌آپ انتخاب می‌شه.": "Las claves se guardan solo en este dispositivo (almacenamiento local del navegador) y solo se envían al servicio que elijas. El modelo de cada servicio se elige en la pestaña «Traducción» del popup.", "فقط ۴ چیز لازم است:": "Solo hacen falta 4 datos:", "اسم، آدرس، کلید و کد مدل. همه را از سایت همان سرویس کپی کن.": "Nombre, dirección, clave y código del modelo. Cópialos todos desde el sitio de ese servicio.", "شروع از الگو:": "Empezar desde una plantilla:", "کلیدهای API و تمام تنظیمات فقط روی همین دستگاه (Storage محلی مرورگر) ذخیره می‌شن و جز به همون سرویسی که خودت انتخاب کردی (Gemini/OpenRouter/OpenAI/Custom) به‌جای دیگه‌ای ارسال نمی‌شن. تنها داده‌ای که جدا از این می‌رود، آمار ناشناس روزانهٔ زیر است و قابل خاموش‌کردن است. جزئیات کامل در فایل PRIVACY.md همراه افزونه.": "Las claves de API y todos los ajustes se guardan solo en este dispositivo (almacenamiento local del navegador) y solo se envían al servicio que elijas (Gemini, OpenRouter, OpenAI o Custom). El único otro dato enviado son las estadísticas anónimas de uso diario de abajo, que puedes desactivar. Los detalles completos están en PRIVACY.md incluido con la extensión.", "گزارش فنی آخرین رویدادهای افزونه روی همین دستگاه است. برای پشتیبانی، گزارش را کپی کن و برایمان بفرست. تست Live و تست صدای دوبله فقط مسیر دوبله را امتحان می‌کنن؛ تست کلیدهای Gemini، OpenRouter و OpenAI در بخش «کلیدهای API» است.": "El informe técnico guarda los últimos eventos de la extensión en este dispositivo. Para soporte, copia el informe y envíanoslo. Las pruebas Live y de doblaje solo prueban la ruta de doblaje; las pruebas de claves de Gemini, OpenRouter y OpenAI están en la sección «Claves de API».", "نمایش گزارش": "Ver informe", "راهنما و پشتیبانی": "Ayuda y soporte", "برای گزارش مشکل، ابتدا وارد حساب شو تا تیکت ثبت کنی؛ یا مستقیم در تلگرام پیام بده.": "Para reportar un problema, inicia sesión primero para abrir un ticket, o escríbenos directamente por Telegram.", "پشتیبانی تلگرام": "Soporte por Telegram", "ثبت تیکت": "Abrir ticket", "راهنمای گام‌به‌گام": "Guía paso a paso", "حریم خصوصی": "Privacidad", "سایت Subify": "Sitio de Subify", "برای کنترل سریع زیرنویس، موتور ترجمه و استایل از پاپ‌آپ افزونه استفاده کن؛ کلیدها و سرویس‌ها را اینجا در «تنظیمات» وارد کن.": "Para controlar rápido los subtítulos, el motor de traducción y el estilo, usa el popup de la extensión. Introduce aquí las claves y los servicios en «Ajustes».", "زبان رابط کاربری": "Idioma de la interfaz", "کلیدهای API و سرویس‌ها": "Claves de API y servicios", "این صفحه رو باز کن و با حساب گوگلت وارد شو:": "Abre esta página e inicia sesión con tu cuenta de Google:", "کلید Gemini برای همه‌چیز لازمه: زیرنویس، دوبله، واژه‌نامه و ترجمهٔ زنده. پلن رایگان سقف درخواست داره؛ اگه خطای quota دیدی، یه دقیقه صبر کن.": "Para todo se necesita una clave de Gemini: subtítulos, doblaje, vocabulario y traducción en vivo. El plan gratuito tiene un límite de solicitudes; si ves un error de quota, espera un minuto."}, "tr": {"پنل مدیریت افزونه · حساب، وضعیت، آمار و تنظیمات": "Subify yönetim paneli · Hesap, durum, istatistik ve ayarlar", "با حساب وارد شو تا تیکت پشتیبانی ثبت کنی و همگام‌سازی لغت‌ها فعال شود. ورود اختیاری است.": "Destek talebi açmak ve kelime eşitlemesini açmak için giriş yap. Giriş isteğe bağlıdır.", "نام کاربری یا ایمیل": "Kullanıcı adı veya e-posta", "نسخه، مسیرهای فعال و تغییرات همین نسخه.": "Sürüm, etkin yollar ve bu sürümdeki değişiklikler.", "این نسخه": "Bu sürüm", "این نسخه برای Google Chrome است. دوبلهٔ صدای همان تب را هم در همین نسخه انجام می‌دهد.": "Bu sürüm Google Chrome içindir ve aynı sekmenin sesini de dublajlar.", "فقط اعدادی نشان داده می‌شن که این افزونه واقعاً اندازه گرفته. هیچ عددی حدس زده یا ساخته نمی‌شه.": "Yalnızca bu eklentinin gerçekten ölçtüğü sayılar gösterilir. Hiçbir sayı tahmin edilmez veya uydurulmaz.", "استفاده و برآورد هزینه": "Kullanım ve maliyet tahmini", "اعداد زیر مصرف واقعیِ همین افزونه‌ست.": "Aşağıdaki sayılar bu eklentinin gerçek kullanımıdır.", "فعالیت ۷ روز اخیر": "Son 7 günün etkinliği", "هنوز چیزی ترجمه یا دوبله نکرده‌ای. یک ویدیو را باز کن و زیرنویس را روشن کن؛ عددها همین‌جا ثبت می‌شوند.": "Henüz bir şey çevirmedin veya dublajlamadın. Bir video aç ve altyazıyı aç; sayılar burada görünecek.", "برای برآورد هزینه، نرخ هر سرویس رو خودت جلوش وارد کن، چون قیمت‌ها بین سرویس‌ها/مدل‌ها فرق داره و مدام تغییر می‌کنه، اینجا هیچ عددی حدس زده نمی‌شه؛ فقط مصرف تو در نرخی که خودت می‌دی ضرب می‌شه.": "Maliyet tahmini için her servisin fiyatını kendin gir; fiyatlar servisler ve modeller arasında farklı olup sık değişir. Burada hiçbir sayı tahmin edilmez; yalnızca kullanımın girdiğin fiyatla çarpılır.", "قابلیت‌ها و پلتفرم‌ها": "Özellikler ve platformlar", "پرمصرف‌ترین قابلیت‌ها (تعداد ثبت‌شده)": "En çok kullanılan özellikler (kayıtlı sayı)", "هنوز قابلیتی استفاده نشده.": "Henüz hiçbir özellik kullanılmadı.", "مرور لغت‌های ذخیره‌شده و تنظیمات یادگیری. دکمهٔ «یادگیری» توی پاپ‌آپ افزونه مستقیم صفحهٔ مرور لغت‌ها رو باز می‌کنه.": "Kaydettiğin kelimeleri ve öğrenme ayarlarını gözden geçir. Eklenti penceresindeki «Öğrenme» düğmesi doğrudan kelime tekrar sayfasını açar.", "یکی را انتخاب کن · سطح B1": "Birini seç · seviye B1", "صفحهٔ کامل لغت‌ها و مرور": "Tüm kelime listesi ve tekrar", "پیش‌تنظیم‌ها: یک بار بزن و حالت یادگیری، سطح، حوزهٔ ویدیو و صدای اصلی دوبله با هم تنظیم می‌شن و همان لحظه ذخیره می‌شن.": "Hazır ayarlar: bir kez tıkla; öğrenme modu, seviye, video alanı ve orijinal dublaj sesi birlikte ayarlanıp hemen kaydedilir.", "تازه‌کار": "Başlangıç", "سریال و فیلم": "Diziler ve filmler", "مطالعه، یادگیری + توقف روی جمله‌ای که لغت مرور دارد": "Çalış, öğren + tekrar zamanı gelen kelimeyi içeren cümlede dur", "یکی را انتخاب کن": "Birini seç", "موتور و صدای دوبله، کلیدهای API و سرویس‌های اختصاصی، داده‌های ذخیره‌شده و گزارش فنی روی این دستگاه.": "Çeviri motoru ve dublaj sesi, API anahtarları, özel servisler, kayıtlı veriler ve teknik rapor bu cihazda tutulur.", "زبان‌هایی که بلدی (کد، جدا با ویرگول، مثلاً en, es). دوبله نمی‌شوند.": "Bildiğin diller (kod, virgülle ayrılmış, örn. en, es). Bunlar dublajlanmaz.", "حوزه‌ی ویدیو برای ترجمه": "Çeviri için video alanı", "عمومی": "Genel", "مهندسی نرم‌افزار": "Yazılım mühendisliği", "پزشکی": "Tıp", "عامیانه و اسلنگ": "Konuşma dili ve argo", "هوش مصنوعی رایگان: وضعیت در دسترس نیست. اتصال به sub-ify.site را بررسی کن.": "Ücretsiz yapay zeka şu anda kullanılamıyor. sub-ify.site bağlantısını kontrol et.", "کلیدها فقط روی همین دستگاه (Storage محلی مرورگر) ذخیره می‌شن و جز به همان سرویسی که انتخاب کردی ارسال نمی‌شن. مدل هر سرویس از تب «ترجمه» در پاپ‌آپ انتخاب می‌شه.": "Anahtarlar yalnızca bu cihazda (tarayıcının yerel depolaması) saklanır ve yalnızca seçtiğin servise gönderilir. Her servisin modeli eklentinin «Çeviri» sekmesinden seçilir.", "فقط ۴ چیز لازم است:": "Yalnızca 4 şey gerekli:", "اسم، آدرس، کلید و کد مدل. همه را از سایت همان سرویس کپی کن.": "Ad, adres, anahtar ve model kodu. Hepsini o servisin web sitesinden kopyala.", "شروع از الگو:": "Bir şablondan başla:", "کلیدهای API و تمام تنظیمات فقط روی همین دستگاه (Storage محلی مرورگر) ذخیره می‌شن و جز به همون سرویسی که خودت انتخاب کردی (Gemini/OpenRouter/OpenAI/Custom) به‌جای دیگه‌ای ارسال نمی‌شن. تنها داده‌ای که جدا از این می‌رود، آمار ناشناس روزانهٔ زیر است و قابل خاموش‌کردن است. جزئیات کامل در فایل PRIVACY.md همراه افزونه.": "API anahtarları ve tüm ayarlar yalnızca bu cihazda (tarayıcının yerel depolaması) saklanır ve yalnızca seçtiğin servise (Gemini, OpenRouter, OpenAI veya Custom) gönderilir. Gönderilen tek başka veri, aşağıdaki anonim günlük kullanım istatistikleridir ve kapatılabilir. Tüm ayrıntılar eklentiyle gelen PRIVACY.md dosyasındadır.", "گزارش فنی آخرین رویدادهای افزونه روی همین دستگاه است. برای پشتیبانی، گزارش را کپی کن و برایمان بفرست. تست Live و تست صدای دوبله فقط مسیر دوبله را امتحان می‌کنن؛ تست کلیدهای Gemini، OpenRouter و OpenAI در بخش «کلیدهای API» است.": "Teknik rapor, eklentinin son olaylarını bu cihazda tutar. Destek için raporu kopyalayıp bize gönder. Live ve dublaj testleri yalnızca dublaj yolunu dener; Gemini, OpenRouter ve OpenAI anahtar testleri «API anahtarları» bölümündedir.", "نمایش گزارش": "Raporu göster", "راهنما و پشتیبانی": "Yardım ve destek", "برای گزارش مشکل، ابتدا وارد حساب شو تا تیکت ثبت کنی؛ یا مستقیم در تلگرام پیام بده.": "Bir sorunu bildirmek için önce giriş yap ve talep aç, ya da doğrudan Telegram'dan yaz.", "پشتیبانی تلگرام": "Telegram desteği", "ثبت تیکت": "Talep aç", "راهنمای گام‌به‌گام": "Adım adım rehber", "حریم خصوصی": "Gizlilik", "سایت Subify": "Subify web sitesi", "برای کنترل سریع زیرنویس، موتور ترجمه و استایل از پاپ‌آپ افزونه استفاده کن؛ کلیدها و سرویس‌ها را اینجا در «تنظیمات» وارد کن.": "Altyazı, çeviri motoru ve stili hızlıca denetlemek için eklentinin penceresini kullan; anahtarları ve servisleri burada «Ayarlar» bölümünden gir.", "زبان رابط کاربری": "Arayüz dili", "کلیدهای API و سرویس‌ها": "API anahtarları ve servisler", "این صفحه رو باز کن و با حساب گوگلت وارد شو:": "Bu sayfayı aç ve Google hesabınla giriş yap:", "کلید Gemini برای همه‌چیز لازمه: زیرنویس، دوبله، واژه‌نامه و ترجمهٔ زنده. پلن رایگان سقف درخواست داره؛ اگه خطای quota دیدی، یه دقیقه صبر کن.": "Her şey için bir Gemini anahtarı gerekir: altyazı, dublaj, kelime listesi ve canlı çeviri. Ücretsiz planın istek sınırı vardır; quota hatası görürsen bir dakika bekle."}, "fr": {"پنل مدیریت افزونه · حساب، وضعیت، آمار و تنظیمات": "Panneau Subify · Compte, état, statistiques et réglages", "با حساب وارد شو تا تیکت پشتیبانی ثبت کنی و همگام‌سازی لغت‌ها فعال شود. ورود اختیاری است.": "Connectez-vous pour ouvrir des tickets d'assistance et activer la synchronisation du vocabulaire. La connexion est facultative.", "نام کاربری یا ایمیل": "Nom d'utilisateur ou e-mail", "نسخه، مسیرهای فعال و تغییرات همین نسخه.": "Version, parcours actifs et modifications de cette version.", "این نسخه": "Cette version", "این نسخه برای Google Chrome است. دوبلهٔ صدای همان تب را هم در همین نسخه انجام می‌دهد.": "Cette version est pour Google Chrome. Elle double aussi l'audio de ce même onglet.", "فقط اعدادی نشان داده می‌شن که این افزونه واقعاً اندازه گرفته. هیچ عددی حدس زده یا ساخته نمی‌شه.": "Seuls les chiffres réellement mesurés par cette extension sont affichés. Aucun chiffre n'est deviné ni inventé.", "استفاده و برآورد هزینه": "Utilisation et estimation des coûts", "اعداد زیر مصرف واقعیِ همین افزونه‌ست.": "Les chiffres ci-dessous correspondent à l'usage réel de cette extension.", "فعالیت ۷ روز اخیر": "Activité des 7 derniers jours", "هنوز چیزی ترجمه یا دوبله نکرده‌ای. یک ویدیو را باز کن و زیرنویس را روشن کن؛ عددها همین‌جا ثبت می‌شوند.": "Rien n'est encore traduit ni doublé. Ouvrez une vidéo et activez les sous-titres ; les chiffres apparaîtront ici.", "برای برآورد هزینه، نرخ هر سرویس رو خودت جلوش وارد کن، چون قیمت‌ها بین سرویس‌ها/مدل‌ها فرق داره و مدام تغییر می‌کنه، اینجا هیچ عددی حدس زده نمی‌شه؛ فقط مصرف تو در نرخی که خودت می‌دی ضرب می‌شه.": "Pour estimer les coûts, saisissez vous-même le tarif de chaque service : les prix varient selon les services et les modèles et changent souvent. Aucun chiffre n'est deviné ici ; seule votre utilisation est multipliée par le tarif saisi.", "قابلیت‌ها و پلتفرم‌ها": "Fonctions et plateformes", "پرمصرف‌ترین قابلیت‌ها (تعداد ثبت‌شده)": "Fonctions les plus utilisées (nombre enregistré)", "هنوز قابلیتی استفاده نشده.": "Aucune fonction n'a encore été utilisée.", "مرور لغت‌های ذخیره‌شده و تنظیمات یادگیری. دکمهٔ «یادگیری» توی پاپ‌آپ افزونه مستقیم صفحهٔ مرور لغت‌ها رو باز می‌کنه.": "Revoyez vos mots enregistrés et vos réglages d'apprentissage. Le bouton « Apprentissage » du popup ouvre directement la page de révision.", "یکی را انتخاب کن · سطح B1": "Choisissez-en un · niveau B1", "صفحهٔ کامل لغت‌ها و مرور": "Liste complète des mots et révision", "پیش‌تنظیم‌ها: یک بار بزن و حالت یادگیری، سطح، حوزهٔ ویدیو و صدای اصلی دوبله با هم تنظیم می‌شن و همان لحظه ذخیره می‌شن.": "Préréglages : un clic règle ensemble le mode d'apprentissage, le niveau, le domaine de la vidéo et le volume d'origine du doublage, et enregistre aussitôt.", "تازه‌کار": "Débutant", "سریال و فیلم": "Séries et films", "مطالعه، یادگیری + توقف روی جمله‌ای که لغت مرور دارد": "Étudier, apprendre + pause sur la phrase contenant un mot à réviser", "یکی را انتخاب کن": "Choisissez-en un", "موتور و صدای دوبله، کلیدهای API و سرویس‌های اختصاصی، داده‌های ذخیره‌شده و گزارش فنی روی این دستگاه.": "Le moteur de traduction et la voix du doublage, les clés API, les services personnalisés, les données enregistrées et le rapport technique restent sur cet appareil.", "زبان‌هایی که بلدی (کد، جدا با ویرگول، مثلاً en, es). دوبله نمی‌شوند.": "Langues que vous maîtrisez (code, séparés par des virgules, ex. en, es). Elles ne sont pas doublées.", "حوزه‌ی ویدیو برای ترجمه": "Domaine de la vidéo pour la traduction", "عمومی": "Général", "مهندسی نرم‌افزار": "Génie logiciel", "پزشکی": "Médecine", "عامیانه و اسلنگ": "Langage courant et argot", "هوش مصنوعی رایگان: وضعیت در دسترس نیست. اتصال به sub-ify.site را بررسی کن.": "L'IA gratuite est indisponible pour le moment. Vérifiez la connexion à sub-ify.site.", "کلیدها فقط روی همین دستگاه (Storage محلی مرورگر) ذخیره می‌شن و جز به همان سرویسی که انتخاب کردی ارسال نمی‌شن. مدل هر سرویس از تب «ترجمه» در پاپ‌آپ انتخاب می‌شه.": "Les clés sont stockées uniquement sur cet appareil (stockage local du navigateur) et envoyées seulement au service choisi. Le modèle de chaque service se choisit dans l'onglet « Traduction » du popup.", "فقط ۴ چیز لازم است:": "Seulement 4 éléments sont nécessaires :", "اسم، آدرس، کلید و کد مدل. همه را از سایت همان سرویس کپی کن.": "Nom, adresse, clé et code du modèle. Copiez-les tous depuis le site de ce service.", "شروع از الگو:": "Partir d'un modèle :", "کلیدهای API و تمام تنظیمات فقط روی همین دستگاه (Storage محلی مرورگر) ذخیره می‌شن و جز به همون سرویسی که خودت انتخاب کردی (Gemini/OpenRouter/OpenAI/Custom) به‌جای دیگه‌ای ارسال نمی‌شن. تنها داده‌ای که جدا از این می‌رود، آمار ناشناس روزانهٔ زیر است و قابل خاموش‌کردن است. جزئیات کامل در فایل PRIVACY.md همراه افزونه.": "Les clés API et tous les réglages sont stockés uniquement sur cet appareil (stockage local du navigateur) et envoyés seulement au service choisi (Gemini, OpenRouter, OpenAI ou Custom). La seule autre donnée envoyée sont les statistiques d'usage quotidiennes anonymes ci-dessous, que vous pouvez désactiver. Les détails figurent dans PRIVACY.md fourni avec l'extension.", "گزارش فنی آخرین رویدادهای افزونه روی همین دستگاه است. برای پشتیبانی، گزارش را کپی کن و برایمان بفرست. تست Live و تست صدای دوبله فقط مسیر دوبله را امتحان می‌کنن؛ تست کلیدهای Gemini، OpenRouter و OpenAI در بخش «کلیدهای API» است.": "Le rapport technique garde les derniers événements de l'extension sur cet appareil. Pour l'assistance, copiez le rapport et envoyez-le-nous. Les tests Live et de doublage ne testent que le chemin du doublage ; les tests des clés Gemini, OpenRouter et OpenAI sont dans la section « Clés API ».", "نمایش گزارش": "Afficher le rapport", "راهنما و پشتیبانی": "Aide et assistance", "برای گزارش مشکل، ابتدا وارد حساب شو تا تیکت ثبت کنی؛ یا مستقیم در تلگرام پیام بده.": "Pour signaler un problème, connectez-vous d'abord pour ouvrir un ticket, ou écrivez-nous directement sur Telegram.", "پشتیبانی تلگرام": "Assistance Telegram", "ثبت تیکت": "Ouvrir un ticket", "راهنمای گام‌به‌گام": "Guide pas à pas", "حریم خصوصی": "Confidentialité", "سایت Subify": "Site Subify", "برای کنترل سریع زیرنویس، موتور ترجمه و استایل از پاپ‌آپ افزونه استفاده کن؛ کلیدها و سرویس‌ها را اینجا در «تنظیمات» وارد کن.": "Pour contrôler rapidement les sous-titres, le moteur de traduction et le style, utilisez le popup de l'extension. Saisissez ici les clés et services dans « Paramètres ».", "زبان رابط کاربری": "Langue de l'interface", "کلیدهای API و سرویس‌ها": "Clés API et services", "این صفحه رو باز کن و با حساب گوگلت وارد شو:": "Ouvrez cette page et connectez-vous avec votre compte Google :", "کلید Gemini برای همه‌چیز لازمه: زیرنویس، دوبله، واژه‌نامه و ترجمهٔ زنده. پلن رایگان سقف درخواست داره؛ اگه خطای quota دیدی، یه دقیقه صبر کن.": "Une clé Gemini est nécessaire pour tout : sous-titres, doublage, vocabulaire et traduction en direct. Le forfait gratuit a une limite de requêtes ; en cas d'erreur de quota, attendez une minute."}, "de": {"پنل مدیریت افزونه · حساب، وضعیت، آمار و تنظیمات": "Subify-Verwaltung · Konto, Status, Statistik und Einstellungen", "با حساب وارد شو تا تیکت پشتیبانی ثبت کنی و همگام‌سازی لغت‌ها فعال شود. ورود اختیاری است.": "Melde dich an, um Support-Tickets zu erstellen und die Wortsynchronisierung zu aktivieren. Die Anmeldung ist optional.", "نام کاربری یا ایمیل": "Benutzername oder E-Mail", "نسخه، مسیرهای فعال و تغییرات همین نسخه.": "Version, aktive Pfade und Änderungen dieser Version.", "این نسخه": "Diese Version", "این نسخه برای Google Chrome است. دوبلهٔ صدای همان تب را هم در همین نسخه انجام می‌دهد.": "Diese Version ist für Google Chrome. Sie synchronisiert auch den Ton desselben Tabs.", "فقط اعدادی نشان داده می‌شن که این افزونه واقعاً اندازه گرفته. هیچ عددی حدس زده یا ساخته نمی‌شه.": "Angezeigt werden nur Zahlen, die diese Erweiterung tatsächlich gemessen hat. Nichts wird geschätzt oder erfunden.", "استفاده و برآورد هزینه": "Nutzung und Kostenschätzung", "اعداد زیر مصرف واقعیِ همین افزونه‌ست.": "Die Zahlen unten zeigen die tatsächliche Nutzung dieser Erweiterung.", "فعالیت ۷ روز اخیر": "Aktivität der letzten 7 Tage", "هنوز چیزی ترجمه یا دوبله نکرده‌ای. یک ویدیو را باز کن و زیرنویس را روشن کن؛ عددها همین‌جا ثبت می‌شوند.": "Noch nichts übersetzt oder synchronisiert. Öffne ein Video und schalte Untertitel ein; die Zahlen erscheinen hier.", "برای برآورد هزینه، نرخ هر سرویس رو خودت جلوش وارد کن، چون قیمت‌ها بین سرویس‌ها/مدل‌ها فرق داره و مدام تغییر می‌کنه، اینجا هیچ عددی حدس زده نمی‌شه؛ فقط مصرف تو در نرخی که خودت می‌دی ضرب می‌شه.": "Für die Kostenschätzung trägst du den Preis jedes Dienstes selbst ein, weil Preise zwischen Diensten und Modellen abweichen und sich oft ändern. Hier wird nichts geschätzt; nur deine Nutzung wird mit dem eingetragenen Preis multipliziert.", "قابلیت‌ها و پلتفرم‌ها": "Funktionen und Plattformen", "پرمصرف‌ترین قابلیت‌ها (تعداد ثبت‌شده)": "Meistgenutzte Funktionen (erfasste Anzahl)", "هنوز قابلیتی استفاده نشده.": "Noch keine Funktion verwendet.", "مرور لغت‌های ذخیره‌شده و تنظیمات یادگیری. دکمهٔ «یادگیری» توی پاپ‌آپ افزونه مستقیم صفحهٔ مرور لغت‌ها رو باز می‌کنه.": "Gespeicherte Wörter und Lerneinstellungen durchsehen. Der Button „Lernen“ im Popup öffnet die Wortübersicht direkt.", "یکی را انتخاب کن · سطح B1": "Eins wählen · Niveau B1", "صفحهٔ کامل لغت‌ها و مرور": "Vollständige Wortliste und Wiederholung", "پیش‌تنظیم‌ها: یک بار بزن و حالت یادگیری، سطح، حوزهٔ ویدیو و صدای اصلی دوبله با هم تنظیم می‌شن و همان لحظه ذخیره می‌شن.": "Vorlagen: Ein Klick stellt Lernmodus, Niveau, Videobereich und Originallautstärke der Synchronisation gemeinsam ein und speichert sofort.", "تازه‌کار": "Anfänger", "سریال و فیلم": "Serien und Filme", "مطالعه، یادگیری + توقف روی جمله‌ای که لغت مرور دارد": "Lernen + Pause bei Sätzen, in denen ein Wort zur Wiederholung ansteht", "یکی را انتخاب کن": "Eins wählen", "موتور و صدای دوبله، کلیدهای API و سرویس‌های اختصاصی، داده‌های ذخیره‌شده و گزارش فنی روی این دستگاه.": "Übersetzungsmotor und Synchronstimme, API-Schlüssel, eigene Dienste, gespeicherte Daten und der technische Bericht bleiben auf diesem Gerät.", "زبان‌هایی که بلدی (کد، جدا با ویرگول، مثلاً en, es). دوبله نمی‌شوند.": "Sprachen, die du kannst (Code, durch Komma getrennt, z. B. en, es). Sie werden nicht synchronisiert.", "حوزه‌ی ویدیو برای ترجمه": "Videobereich für die Übersetzung", "عمومی": "Allgemein", "مهندسی نرم‌افزار": "Software-Engineering", "پزشکی": "Medizin", "عامیانه و اسلنگ": "Umgangssprache und Slang", "هوش مصنوعی رایگان: وضعیت در دسترس نیست. اتصال به sub-ify.site را بررسی کن.": "Die kostenlose KI ist gerade nicht verfügbar. Prüfe die Verbindung zu sub-ify.site.", "کلیدها فقط روی همین دستگاه (Storage محلی مرورگر) ذخیره می‌شن و جز به همان سرویسی که انتخاب کردی ارسال نمی‌شن. مدل هر سرویس از تب «ترجمه» در پاپ‌آپ انتخاب می‌شه.": "Schlüssel werden nur auf diesem Gerät gespeichert (lokaler Browser-Speicher) und nur an den gewählten Dienst gesendet. Das Modell jedes Dienstes wählst du im Reiter „Übersetzung“ des Popups.", "فقط ۴ چیز لازم است:": "Du brauchst nur 4 Angaben:", "اسم، آدرس، کلید و کد مدل. همه را از سایت همان سرویس کپی کن.": "Name, Adresse, Schlüssel und Modellcode. Kopiere alles von der Website dieses Dienstes.", "شروع از الگو:": "Mit einer Vorlage starten:", "کلیدهای API و تمام تنظیمات فقط روی همین دستگاه (Storage محلی مرورگر) ذخیره می‌شن و جز به همون سرویسی که خودت انتخاب کردی (Gemini/OpenRouter/OpenAI/Custom) به‌جای دیگه‌ای ارسال نمی‌شن. تنها داده‌ای که جدا از این می‌رود، آمار ناشناس روزانهٔ زیر است و قابل خاموش‌کردن است. جزئیات کامل در فایل PRIVACY.md همراه افزونه.": "API-Schlüssel und alle Einstellungen werden nur auf diesem Gerät gespeichert (lokaler Browser-Speicher) und nur an den gewählten Dienst (Gemini, OpenRouter, OpenAI oder Custom) gesendet. Einzige weitere Daten sind die anonymen täglichen Nutzungsstatistiken unten, die du abschalten kannst. Details stehen in der PRIVACY.md, die der Erweiterung beiliegt.", "گزارش فنی آخرین رویدادهای افزونه روی همین دستگاه است. برای پشتیبانی، گزارش را کپی کن و برایمان بفرست. تست Live و تست صدای دوبله فقط مسیر دوبله را امتحان می‌کنن؛ تست کلیدهای Gemini، OpenRouter و OpenAI در بخش «کلیدهای API» است.": "Der technische Bericht speichert die letzten Ereignisse der Erweiterung auf diesem Gerät. Für Support kopiere den Bericht und schicke ihn uns. Die Live- und Synchronisationstests prüfen nur den Synchronisationsweg; die Schlüsseltests für Gemini, OpenRouter und OpenAI findest du im Bereich „API-Schlüssel“.", "نمایش گزارش": "Bericht anzeigen", "راهنما و پشتیبانی": "Hilfe und Support", "برای گزارش مشکل، ابتدا وارد حساب شو تا تیکت ثبت کنی؛ یا مستقیم در تلگرام پیام بده.": "Um ein Problem zu melden, melde dich zuerst an, um ein Ticket zu erstellen, oder schreib uns direkt auf Telegram.", "پشتیبانی تلگرام": "Telegram-Support", "ثبت تیکت": "Ticket erstellen", "راهنمای گام‌به‌گام": "Schritt-für-Schritt-Anleitung", "حریم خصوصی": "Datenschutz", "سایت Subify": "Subify-Website", "برای کنترل سریع زیرنویس، موتور ترجمه و استایل از پاپ‌آپ افزونه استفاده کن؛ کلیدها و سرویس‌ها را اینجا در «تنظیمات» وارد کن.": "Für die schnelle Steuerung von Untertiteln, Übersetzungsmotor und Stil nutze das Popup der Erweiterung. Schlüssel und Dienste trägst du hier unter „Einstellungen“ ein.", "زبان رابط کاربری": "Oberflächensprache", "کلیدهای API و سرویس‌ها": "API-Schlüssel und Dienste", "این صفحه رو باز کن و با حساب گوگلت وارد شو:": "Öffne diese Seite und melde dich mit deinem Google-Konto an:", "کلید Gemini برای همه‌چیز لازمه: زیرنویس، دوبله، واژه‌نامه و ترجمهٔ زنده. پلن رایگان سقف درخواست داره؛ اگه خطای quota دیدی، یه دقیقه صبر کن.": "Für alles wird ein Gemini-Schlüssel benötigt: Untertitel, Synchronisation, Wortschatz und Live-Übersetzung. Der kostenlose Tarif hat ein Anfragelimit; bei einem Quota-Fehler eine Minute warten."}});

// What's new: shown once per installed version, on this device.
(function () {
  var box = document.getElementById('whatsNew');
  if (!box) return;
  var ver = '';
  try { ver = (globalThis.browser || globalThis.chrome).runtime.getManifest().version; } catch (_) {}
  var key = 'subify-whatsnew-seen', seen = '';
  try { seen = localStorage.getItem(key) || ''; } catch (_) {}
  var v = document.getElementById('wnVersion');
  if (v && ver) v.textContent = 'v' + ver;
  function close() { box.hidden = true; try { localStorage.setItem(key, ver); } catch (_) {} }
  document.getElementById('wnClose').addEventListener('click', close);
  box.addEventListener('click', function (e) { if (e.target === box) close(); });
  if (ver && seen !== ver) box.hidden = false;
})();
