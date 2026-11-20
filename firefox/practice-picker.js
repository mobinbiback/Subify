var browser = globalThis.browser || globalThis.chrome; // Chrome has no browser global; same APIs live on chrome.*
/* AI practice engine and model picker (Part 6). Shown at the top of the AI practice pages: chat, roleplay, shadowing and the word list.
 * One engine select: Subify Server, Gemini (own key) or Custom API (own key). It writes the settings the popup reads
 * (pd_settings.subtitleProvider and pd_settings.subifyModel), so the popup and the pages stay in step.
 * Subify Server rows come from auth/ai.php?action=state through the background bridge, and only when Subify Server is chosen.
 * Own-key engines show no price and make no server call. Price text comes from SubifyAiRoute.priceLabel (ai-route-core.js). */
(function () {
  "use strict";
  if (window.__sfyPracticePicker) return;
  window.__sfyPracticePicker = true;
  const R = window.SubifyAiRoute;
  const ENGINES = [
    { value: "subify", label: "Subify Server" },
    { value: "gemini", label: "Gemini (کلید خودت)" },
    { value: "custom", label: "Custom API (کلید خودت)" }
  ];
  // Stored values that are not one of the three engines still show, so the picker never hides the real setting.
  const EXTRA = { auto: "خودکار", openrouter: "OpenRouter (کلید خودت)", openai: "OpenAI (کلید خودت)" };
  const tr = (s) => (window.SubifyUI && typeof window.SubifyUI.t === "function" ? window.SubifyUI.t(s) : s);
  const lang = () => (window.SubifyUI && window.SubifyUI.lang) || "fa";
  const el = (tag, text, css) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (css) n.style.cssText = css;
    return n;
  };

  let box = null, engSel = null, modelWrap = null, modelSel = null, noteEl = null;
  let settings = {}, rows = [], defaultModel = "", stateSeq = 0;

  async function readSettings() {
    try { const r = await browser.storage.local.get("pd_settings"); return r.pd_settings || {}; } catch (e) { return {}; }
  }
  async function writeSettings(patch) {
    try {
      const cur = await readSettings();
      await browser.storage.local.set({ pd_settings: Object.assign({}, cur, patch) });
    } catch (e) { /* storage unavailable: the choice holds for this page only */ }
  }
  function current() { return settings.subtitleProvider || "auto"; }
  function configured(value) {
    if (value === "subify") return true;
    return !!R && R.hasKey(value, settings);
  }

  // One Subify Server row. Toman per 1M tokens when the server sends them; the old per-minute label otherwise.
  function rowLabel(r) {
    const price = R.priceLabel(r, lang(), tr);
    const name = "⁧" + r.model + "⁩";
    const off = r.allowed === false ? " · " + tr("برای حساب تو فعال نیست") : "";
    return name + " · " + price + off;
  }
  function note(value) {
    if (value === "subify") {
      return rows.length ? tr("درخواست‌ها با اعتبار Subify Server اجرا می‌شوند.")
        : tr("Subify Server برای این حساب در دسترس نیست. وارد حساب شو یا یکی از موتورهای کلید خودت را انتخاب کن.");
    }
    if (value === "gemini" && !configured(value)) return tr("کلید Gemini ذخیره نشده. در تنظیمات ذخیره کن.");
    if (value === "custom" && !configured(value)) return tr("Custom API کامل نیست. در تنظیمات آدرس، کلید و مدل را ذخیره کن.");
    return tr("با کلید خودت اجرا می‌شود. از اعتبار Subify Server کم نمی‌شود.");
  }

  function fillModels() {
    const want = settings.subifyModel || "";
    const allowed = rows.filter((r) => r.allowed !== false);
    const pick = rows.some((r) => r.model === want && r.allowed !== false) ? want
      : (allowed.some((r) => r.model === defaultModel) ? defaultModel : ((allowed[0] || {}).model || ""));
    modelSel.textContent = "";
    rows.forEach((r) => {
      const o = el("option", rowLabel(r));
      o.value = r.model;
      o.disabled = r.allowed === false;
      if (r.model === pick) o.selected = true;
      modelSel.appendChild(o);
    });
    if (pick && pick !== want) { settings.subifyModel = pick; writeSettings({ subifyModel: pick }); }
  }

  function render() {
    if (!box) return;
    const cur = current();
    engSel.querySelectorAll("option[data-extra]").forEach((o) => o.remove());
    if (!ENGINES.some((e) => e.value === cur)) {
      const o = el("option", tr(EXTRA[cur] || "خودکار"));
      o.value = cur;
      o.setAttribute("data-extra", "1");
      engSel.appendChild(o);
    }
    engSel.value = cur;
    Array.prototype.forEach.call(engSel.options, (o) => {
      if (!o.hasAttribute("data-extra")) o.disabled = o.value !== "subify" && !configured(o.value);
    });
    const subify = cur === "subify";
    modelWrap.style.display = subify && rows.length ? "" : "none";
    if (subify && rows.length) fillModels();
    noteEl.textContent = note(cur);
  }

  // Subify Server state, read through the background (the bridge). Own-key engines never ask.
  async function loadRows() {
    const seq = ++stateSeq;
    if (current() !== "subify") { rows = []; render(); return; }
    let st = null;
    try {
      const r = await browser.runtime.sendMessage({ type: "subify-api", path: "/auth/ai.php?action=state" });
      st = r && r.json && r.json.ok !== false ? r.json : null;
    } catch (e) { st = null; }
    if (seq !== stateSeq) return;
    const pick = (st && st.pick) || {};
    rows = st && st.path === "credits" && Array.isArray(pick.models) ? pick.models : [];
    defaultModel = pick.default || "";
    render();
  }

  async function choose(value) {
    settings.subtitleProvider = value;
    await writeSettings({ subtitleProvider: value });
    loadRows();
  }

  function build(host) {
    box = el("div", undefined, "margin:0 0 12px;padding:12px;border:1px solid rgba(127,127,127,.3);border-radius:14px;font-size:14px;line-height:1.7");
    box.id = "practice-picker";
    const lab = el("label", undefined, "display:flex;flex-direction:column;gap:6px");
    lab.appendChild(el("span", tr("موتور هوش مصنوعی")));
    engSel = el("select", undefined, "width:100%;padding:9px;border-radius:10px;font:inherit");
    ENGINES.forEach((e) => { const o = el("option", tr(e.label)); o.value = e.value; engSel.appendChild(o); });
    lab.appendChild(engSel);
    box.appendChild(lab);
    modelWrap = el("label", undefined, "display:none;flex-direction:column;gap:6px;margin-top:8px");
    modelWrap.appendChild(el("span", tr("مدل (Subify Server)")));
    modelSel = el("select", undefined, "width:100%;padding:9px;border-radius:10px;font:inherit");
    modelWrap.appendChild(modelSel);
    box.appendChild(modelWrap);
    noteEl = el("div", undefined, "font-size:12px;opacity:.75;margin-top:6px");
    box.appendChild(noteEl);
    engSel.addEventListener("change", () => choose(engSel.value));
    modelSel.addEventListener("change", () => {
      settings.subifyModel = modelSel.value;
      writeSettings({ subifyModel: modelSel.value });
    });
    host.insertBefore(box, host.firstChild);
  }

  async function init() {
    if (!R) return; // ai-route-core.js is loaded before this file on every page that uses it
    const host = document.getElementById("main") || document.querySelector("main") || document.body;
    settings = await readSettings();
    build(host);
    render();
    loadRows();
    try {
      browser.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes.pd_settings) return;
        settings = changes.pd_settings.newValue || {};
        loadRows();
      });
    } catch (e) { /* no storage events: the picker is read once */ }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
