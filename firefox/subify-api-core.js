// Part 1 API bridge (Chrome and Firefox lite). Every member-endpoint call from the extension goes through here, in the background.
// Content scripts and pages send {type: "subify-api", path, method, body, force} to the background; this module does the fetch.
// Credential method: the session cookie that sub-ify.site sets (HttpOnly, SameSite=None; Secure, Domain=.sub-ify.site),
// sent with credentials "include". The extension holds no token and sends no X-Sfy-Token: the server has no token handoff for extensions.
// Chrome loads this file with importScripts in background.js; Firefox lists it in manifest.json (background scripts).
(function (root) {
  "use strict";

  const SITE = "https://sub-ify.site";
  const COOKIE_NAME = "sfy_sess"; // the site's session cookie: the token itself (64 hex)
  const COOKIE_URLS = ["https://sub-ify.site", "https://app.sub-ify.site"]; // hosts with a permission in the manifest
  const ALLOWED_PATHS = ["/auth/me.php", "/auth/wallet.php", "/auth/pay.php", "/auth/ai.php", "/auth/vocab.php"];
  const TIMEOUT_MS = 15000;
  const ME_TTL_MS = 60000;

  // The path with its query when it is one of the member endpoints, else "". The query may hold only plain characters.
  function checkedPath(path) {
    const s = String(path || "");
    const i = s.indexOf("?");
    const base = i < 0 ? s : s.slice(0, i);
    if (!ALLOWED_PATHS.includes(base)) return "";
    if (i >= 0 && !/^[A-Za-z0-9_=&.%-]*$/.test(s.slice(i + 1))) return "";
    return s;
  }

  function create(deps) {
    const d = deps || {};
    const fetchFn = d.fetch || ((url, init) => globalThis.fetch(url, init));
    const site = d.site || SITE;
    const timeoutMs = d.timeoutMs || TIMEOUT_MS;
    const meTtlMs = d.meTtlMs || ME_TTL_MS;
    const now = d.now || (() => Date.now());
    let meCache = null; // { at, value }

    // The site's session token, read from its cookie with the cookies permission. A background request is cross-site, so the
    // browser may not send the cookie itself; the token goes in X-Sfy-Token instead (the server accepts that header).
    async function siteToken() {
      const ns = d.cookies || ((globalThis.browser && globalThis.browser.cookies) || (globalThis.chrome && globalThis.chrome.cookies));
      if (!ns || typeof ns.get !== "function") return "";
      for (const url of COOKIE_URLS) {
        try {
          const c = await ns.get({ url, name: COOKIE_NAME });
          if (c && /^[a-f0-9]{64}$/.test(c.value || "")) return c.value;
        } catch (_) { /* try the next host */ }
      }
      return "";
    }

    // One request, never throws. 2xx: {ok:true, status, json}. Other answers: {ok:false, status, json, error:"http"}.
    // No answer: {ok:false, status:0, error:"timeout"|"network"}.
    async function raw(path, method, body, ms) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), ms || timeoutMs);
      const init = { method, credentials: "include", cache: "no-store", signal: ctrl.signal, headers: { Accept: "application/json" } };
      if (method === "POST") {
        init.headers["Content-Type"] = "text/plain;charset=UTF-8";
        init.body = JSON.stringify(body == null ? {} : body);
      }
      const tok = await siteToken();
      if (tok) init.headers["X-Sfy-Token"] = tok;
      try {
        const res = await fetchFn(site + path, init);
        const text = await res.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch (_) { json = null; }
        return res.ok ? { ok: true, status: res.status, json } : { ok: false, status: res.status, json, error: "http" };
      } catch (e) {
        return { ok: false, status: 0, error: ctrl.signal.aborted ? "timeout" : "network" };
      } finally {
        clearTimeout(timer);
      }
    }

    // The account snapshot (auth/me.php), kept for meTtlMs. force=true asks the server again. Failures are kept too.
    async function me(force) {
      const t = now();
      if (!force && meCache && t - meCache.at < meTtlMs) return meCache.value;
      const value = await raw("/auth/me.php", "GET");
      meCache = { at: t, value };
      return value;
    }

    // The one entry point for messages. Only the member endpoints (me, wallet, pay, ai, vocab), GET or POST.
    async function call(req) {
      const r = req || {};
      const path = checkedPath(r.path);
      if (!path) return { ok: false, status: 0, error: "path" };
      const method = String(r.method || "GET").toUpperCase();
      if (method !== "GET" && method !== "POST") return { ok: false, status: 0, error: "method" };
      if (method === "GET" && path === "/auth/me.php") return me(!!r.force);
      // r.timeoutMs (optional, at most 120 s) is for calls that take longer than the default, such as a practice reply.
      return raw(path, method, r.body, r.timeoutMs > 0 ? Math.min(Number(r.timeoutMs), 120000) : 0);
    }

    // After sign-out: the next me.php read goes to the server.
    function forgetMe() { meCache = null; }

    return { call, me, forgetMe, raw };
  }

  const api = { SITE, ALLOWED_PATHS, checkedPath, create };
  root.SubifyApiCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
