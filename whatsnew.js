const browser = globalThis.browser || globalThis.chrome;

try {
  const version = browser.runtime.getManifest().version;
  const badge = document.getElementById("versionBadge");
  if (badge) badge.textContent = `نسخهٔ ${version}`;
} catch (e) {}

document.getElementById("gotIt")?.addEventListener("click", () => {
  window.close();
});
