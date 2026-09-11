
const $ = (id) => document.getElementById(id);

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

async function load() {}

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
      ["خط زیرنویس ترجمه‌شده", fmtNum(totals.subtitleCues)]
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
  sel.innerHTML = list.length
    ? list.map((p) => `<option value="${p.id}">${p.name || p.id}</option>`).join("")
    : `<option value="">— هنوز سرویسی اضافه نشده —</option>`;
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
  sel.innerHTML = "";
  r.models.forEach((m) => { const o = document.createElement("option"); o.value = m; o.textContent = m; sel.appendChild(o); });
  wrap.style.display = r.models.length ? "block" : "none";
  $("cp-status").textContent = r.models.length ? `${r.models.length} مدل پیدا شد.` : "مدلی برگردانده نشد؛ Model ID رو دستی وارد کن.";
});
$("cp-model-list").addEventListener("change", async (e) => { $("cp-model").value = e.target.value; await saveCustomProviderForm(); });

if (location.hash === "#custom-providers") {
  document.getElementById("custom-providers")?.scrollIntoView();
}

void loadCustomProviderList();

void load();
void loadStats();
