const browser = globalThis.browser || globalThis.chrome;

const VERSION = (() => { try { return browser.runtime.getManifest().version; } catch (_) { return ""; } })();
const badge = document.getElementById("versionBadge");
if (badge) badge.textContent = document.documentElement.lang === "en" ? `Version ${VERSION}` : `نسخهٔ ${VERSION}`;

const KEY = "subify_whatsnew_seen_version";
const LANG_KEY = "subify_whatsnew_language";

function applyLanguage(lang) {
  lang = lang === "en" ? "en" : "fa";
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "en" ? "ltr" : "rtl";
  document.querySelectorAll("[data-lang]").forEach(el => el.classList.toggle("hidden", el.getAttribute("data-lang") !== lang));
  const toggle = document.getElementById("langToggle");
  if (toggle) { toggle.textContent = lang === "en" ? "FA" : "EN"; toggle.title = lang === "en" ? "Switch to Persian" : "تغییر به فارسی"; }
  if (badge) badge.textContent = lang === "en" ? `Version ${VERSION}` : `نسخهٔ ${VERSION}`;
  browser.storage.local.set({ [LANG_KEY]: lang }).catch(() => {});
}

async function acknowledge() {
  await browser.storage.local.set({ [KEY]: VERSION });
  try {
    const tab = await browser.tabs.getCurrent();
    if (tab?.id) { await browser.tabs.remove(tab.id); return; }
  } catch (_) {}
  window.close();
}

(async () => {
  let lang = "fa";
  try { const r = await browser.storage.local.get(LANG_KEY); lang = r?.[LANG_KEY] === "en" ? "en" : "fa"; } catch (_) {}
  applyLanguage(lang);
  document.getElementById("langToggle")?.addEventListener("click", () => applyLanguage(document.documentElement.lang === "en" ? "fa" : "en"));
  document.getElementById("gotIt")?.addEventListener("click", acknowledge);
  document.getElementById("gotItEn")?.addEventListener("click", acknowledge);
})();
