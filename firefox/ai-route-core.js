// Provider routing for the AI pages (chat, summary, roleplay, writer, shadowing), pure helpers with no browser API.
// The provider the user chose in the subtitle settings (subtitleProvider) goes first; the other providers with a saved key follow.
// "auto" tries Gemini, OpenRouter, OpenAI, then Custom API. Audio needs Gemini: with another provider chosen, the reply names Gemini.
// The real calls live in background.js; the runners are passed in, so the tests can use fake providers.
// Loaded by background.js (importScripts in Chrome, background scripts in Firefox) and by extension/tests.
(function (root) {
  'use strict';

  const ORDER = ['gemini', 'openrouter', 'openai', 'custom'];

  const TEXT = {
    NO_KEY: 'برای این بخش هیچ کلید هوش مصنوعی ذخیره نشده. از آیکون Subify، تب «کلیدها» یک کلید را ذخیره کن: Gemini، OpenRouter، OpenAI یا Custom API.',
    NEEDS_GEMINI: 'این بخش صدا می‌خواهد، پس فقط با Gemini کار می‌کند. ارائه‌دهنده‌ی ترجمه را روی Gemini بگذار.',
    BAD_KEY: 'کلید ارائه‌دهنده‌ی انتخابی قبول نشد یا دسترسی ندارد. آن را در تنظیمات بررسی کن.',
    QUOTA: 'سقف درخواست‌های ارائه‌دهنده‌ی انتخابی پر شده. یک دقیقه صبر کن و دوباره امتحان کن.',
    FAILED: 'ارائه‌دهنده‌ی انتخابی جواب نداد. دوباره امتحان کن یا ارائه‌دهنده را عوض کن.'
  };

  // Does this provider have what it needs? settings: the stored extension settings (pd_settings).
  function hasKey(name, settings) {
    const s = settings || {};
    if (name === 'gemini') return !!s.apiKey;
    if (name === 'openrouter') return !!s.openRouterKey;
    if (name === 'openai') return !!s.openaiKey;
    if (name === 'custom') {
      const list = Array.isArray(s.customProviders) ? s.customProviders : [];
      const p = list.find((x) => String(x.id || '') === String(s.customProviderId || ''));
      return !!(p && p.apiKey && p.model && p.baseUrl);
    }
    return false;
  }

  // The providers to try, in order. Only providers with a saved key are listed.
  function orderFor(settings) {
    const want = settings && ORDER.includes(settings.subtitleProvider) ? settings.subtitleProvider : 'auto';
    const base = want === 'auto' ? ORDER : [want].concat(ORDER.filter((name) => name !== want));
    return base.filter((name) => hasKey(name, settings));
  }

  // Error text for a request that failed, by HTTP status (non-Gemini providers).
  function failureFor(status) {
    const s = Number(status) || 0;
    if (s === 401 || s === 403) return { ok: false, code: 'key', error: TEXT.BAD_KEY };
    if (s === 429) return { ok: false, code: 'quota', error: TEXT.QUOTA };
    return { ok: false, code: 'failed', error: TEXT.FAILED };
  }

  async function runOne(name, req, runners) {
    try {
      const answer = await runners[name](req);
      if (answer && answer.ok && String(answer.text || '').trim()) return answer;
      return { ok: false, code: 'empty', error: TEXT.FAILED };
    } catch (err) {
      return { ok: false, code: 'failed', error: TEXT.FAILED, detail: String((err && err.message) || err).slice(0, 160) };
    }
  }

  // Runs one request. req: { system, prompt, json, audio, temperature, maxTokens, videoId }.
  // runners: { gemini, openrouter, openai, custom } = async (req) => { ok, text, model } or { ok: false, code, error }.
  // Returns the first successful answer, or the last failure. A runner that throws counts as a failure.
  async function route(req, settings, runners) {
    const hasAudio = !!(req && req.audio && req.audio.base64);
    const wanted = settings && ORDER.includes(settings.subtitleProvider) ? settings.subtitleProvider : 'auto';

    if (hasAudio) {
      // Only Gemini reads audio. Another chosen provider gets the message that names Gemini.
      if (wanted !== 'auto' && wanted !== 'gemini') return { ok: false, code: 'needs-gemini', error: TEXT.NEEDS_GEMINI };
      if (!hasKey('gemini', settings)) return { ok: false, code: 'no-key', error: TEXT.NO_KEY };
      return runOne('gemini', req, runners);
    }

    const names = orderFor(settings);
    if (!names.length) return { ok: false, code: 'no-key', error: TEXT.NO_KEY };
    let last = null;
    for (const name of names) {
      const answer = await runOne(name, req, runners);
      if (answer.ok) return answer;
      last = answer;
    }
    return last;
  }

  const api = { ORDER, TEXT, hasKey, orderFor, failureFor, route };
  root.SubifyAiRoute = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
