var browser = globalThis.browser || globalThis.chrome; // Chrome has no browser global; same APIs live on chrome.*

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
  let origin;
  try { origin = new URL(/^https?:\/\//i.test(base) ? base : `https://${base}`).origin + "/*"; }
  catch (_) { $("cp-status").textContent = "Base URL معتبر نیست."; return false; }
  try {
    if (await browser.permissions.contains({ origins: [origin] })) return true;
    const granted = await browser.permissions.request({ origins: [origin] });
    if (!granted) $("cp-status").textContent = `بدون اجازهٔ دسترسی به ${origin} نمی‌شه این سرویس رو استفاده کرد.`;
    return granted;
  } catch (e) { $("cp-status").textContent = "درخواست دسترسی ناموفق بود: " + (e.message || e); return false; }
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
  $("lrnTarget").value = cfg.targetLang;
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
$("lrnTarget")?.addEventListener("change", (e) => { void saveLearningSetting("targetLang", e.target.value); updateLangView(); });
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

const PANEL_IDS = ["dashboard", "account", "extension", "statistics", "learning", "settings", "help"];

// Old and popup deep links map onto the merged sections.
const DEEP_LINKS = { "custom-providers": "settings", "api-keys": "settings", "vocab-review": "learning", "learning-settings": "learning", "tech-report": "settings" };

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
  box.innerHTML = `<div class="mini-row head"><span>روز</span><span>جلسه</span><span>ثانیهٔ دوبله</span><span>خط زیرنویس</span></div>` +
    rows.join("") +
    (any ? "" : `<p class="hint" style="margin:6px 0 0">در ۷ روز اخیر فعالیتی ثبت نشده.</p>`);
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
    fold.open = true;
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
