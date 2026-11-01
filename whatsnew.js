(() => {
// Scoped on purpose: ui-language.js shares the page's global scope and also declares "browser".
const browser = globalThis.browser || globalThis.chrome;

// Version shown in the badge; the text itself is translated by ui-language.js.
const VERSION = (() => { try { return browser.runtime.getManifest().version; } catch (_) { return ""; } })();
const badge = document.getElementById("versionBadge");
if (badge && VERSION) badge.textContent = "v" + VERSION;

const KEY = "subify_whatsnew_seen_version";

async function acknowledge() {
  try { await browser.storage.local.set({ [KEY]: VERSION }); } catch (_) {}
  try {
    const tab = await browser.tabs.getCurrent();
    if (tab?.id) { await browser.tabs.remove(tab.id); return; }
  } catch (_) {}
  window.close();
}

document.getElementById("gotIt")?.addEventListener("click", acknowledge);
})();
