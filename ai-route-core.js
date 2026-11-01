// Provider routing for the AI pages (chat, summary, roleplay, writer, shadowing), pure helpers with no browser API.
// The provider the user chose in the subtitle settings (subtitleProvider) goes first; the other providers with a saved key follow.
// "auto" tries Gemini, OpenRouter, OpenAI, then Custom API. Audio needs Gemini: with another provider chosen, the reply names Gemini.
// A practice call (feature: chat, writer, roleplay or shadow) with no saved key at all goes to the server's free allowance
// (runners.free). That route is text only, so audio never goes there.
// A reply cut by the length limit gets one continuation call (plain text only). A conversation (req.messages) is sent whole
// and in order; when the request would pass the byte budget, the oldest turns go first.
// The real calls live in background.js; the runners are passed in, so the tests can use fake providers.
// Loaded by background.js (importScripts in Chrome, background scripts in Firefox) and by extension/tests.
(function (root) {
  'use strict';

  const ORDER = ['gemini', 'openrouter', 'openai', 'custom'];
  const FREE_FEATURES = ['chat', 'writer', 'roleplay', 'shadow', 'other'];
  const FEATURE_FA = { chat: 'چت', writer: 'نوشتن', roleplay: 'نقش‌آفرینی', shadow: 'تلفظ', other: 'خلاصه و واژه‌ها' };
  // The server reads a request body of at most 60,000 bytes. The system text and the messages stay under this budget.
  const BODY_BUDGET = 58000;
  // Single-prompt calls keep the caps they always had (characters).
  const PROMPT_MAX = 60000;
  const SYSTEM_MAX = 8000;
  const CONVERSATION_SYSTEM_MAX = 40000;
  const CONTINUE_TEXT = 'Continue exactly where you stopped. Do not repeat anything you already wrote.';

  const TEXT = {
    NO_KEY: 'برای این بخش هیچ کلید هوش مصنوعی ذخیره نشده. از آیکون Subify، تب «کلیدها» یک کلید را ذخیره کن: Gemini، OpenRouter، OpenAI یا Custom API.',
    NEEDS_GEMINI: 'این بخش صدا می‌خواهد، پس فقط با Gemini کار می‌کند. ارائه‌دهنده‌ی ترجمه را روی Gemini بگذار.',
    BAD_KEY: 'کلید ارائه‌دهنده‌ی انتخابی قبول نشد یا دسترسی ندارد. آن را در تنظیمات بررسی کن.',
    QUOTA: 'سقف درخواست‌های ارائه‌دهنده‌ی انتخابی پر شده. یک دقیقه صبر کن و دوباره امتحان کن.',
    FAILED: 'ارائه‌دهنده‌ی انتخابی جواب نداد. دوباره امتحان کن یا ارائه‌دهنده را عوض کن.'
  };
  // The free allowance for practice calls (no own key). {feature} is the Persian name of the feature.
  const FREE_TEXT = {
    auth: 'برای این بخش بدون کلید خودت، اول وارد حساب Subify شو. یا کلید AI خودت را در تنظیمات ذخیره کن.',
    disabled: 'این بخش رایگان الان برای حساب تو در دسترس نیست. کلید AI خودت را در تنظیمات ذخیره کن.',
    capped: 'سقف امروز «{feature}» پر شده. فردا دوباره امتحان کن، یا کلید AI خودت را در تنظیمات ذخیره کن.',
    capacity: 'ظرفیت رایگان الان پر است. چند دقیقه بعد دوباره امتحان کن.',
    network: 'اتصال به سرور Subify برقرار نشد. اینترنت را بررسی کن و دوباره امتحان کن.',
    empty: 'هوش مصنوعی جواب خالی داد. در پنل مدیریت «تست اتصال» را بزن و مدل دیگری انتخاب کن.',
    failed: 'هوش مصنوعی رایگان جواب نداد. دوباره امتحان کن.'
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

  // Error for a refused free-allowance call, by HTTP status and the server's error code (misc_limit = that feature's daily cap).
  // 402 (free sources used up) is a per-subtitle-source message, so for practice it reads as capacity.
  function freeFailure(status, body, feature) {
    const s = Number(status) || 0;
    const data = body && typeof body === 'object' ? body : {};
    if (s === 401) return { ok: false, code: 'auth', error: FREE_TEXT.auth };
    if (s === 403) return { ok: false, code: 'disabled', error: FREE_TEXT.disabled };
    if (s === 402 || s === 503) return { ok: false, code: 'capacity', error: FREE_TEXT.capacity };
    if (data.error === 'empty') return { ok: false, code: 'empty', error: FREE_TEXT.empty };
    if (s === 429 && data.error === 'misc_limit') {
      const key = FREE_FEATURES.includes(data.feature) ? data.feature : feature;
      const who = FEATURE_FA[key] || 'این بخش';
      return { ok: false, code: 'capped', error: FREE_TEXT.capped.replace('{feature}', who) };
    }
    return { ok: false, code: 'failed', error: FREE_TEXT.failed };
  }

  // UTF-8 size of a text, the way the server counts a request body.
  function byteLength(text) {
    return new TextEncoder().encode(String(text == null ? '' : text)).length;
  }

  // The messages a call sends: req.messages when it has turns, otherwise the single prompt (capped as it always was).
  function messagesOf(req) {
    const list = Array.isArray(req.messages)
      ? req.messages
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.content == null ? '' : m.content) !== '')
        .map((m) => ({ role: m.role, content: String(m.content) }))
      : [];
    if (list.length) return list;
    return [{ role: 'user', content: String(req.prompt || '').slice(0, PROMPT_MAX) }];
  }

  // Keeps the system text and the messages within the budget. The oldest turn goes first (a user message with its answer),
  // and the last message stays. Only when nothing else can go is the system text, then the last message, shortened.
  function fitTo(system, messages, budget) {
    const size = (s, list) => byteLength(JSON.stringify({ system: s, messages: list }));
    const list = messages.slice();
    let sys = String(system || '');
    while (size(sys, list) > budget && list.length > 1) {
      list.shift();
      while (list.length > 1 && list[0].role !== 'user') list.shift();
    }
    while (size(sys, list) > budget) {
      if (sys.length > 0) {
        sys = sys.slice(0, Math.floor(sys.length * 0.9));
      } else if (list.length && list[list.length - 1].content.length > 0) {
        const last = list[list.length - 1];
        list[list.length - 1] = { role: last.role, content: last.content.slice(0, Math.floor(last.content.length * 0.9)) };
      } else {
        break;
      }
    }
    return { system: sys, messages: list };
  }

  // The request as the runners get it: system text and messages. Every call is fitted to the byte budget (the server's
  // body limit of 60,000 bytes), so the oldest turns go first. Other fields of req stay as they are.
  function prepare(req) {
    const r = req || {};
    const conversation = Array.isArray(r.messages) && r.messages.length > 0;
    let system = String(r.system || '').slice(0, conversation ? CONVERSATION_SYSTEM_MAX : SYSTEM_MAX);
    const fitted = fitTo(system, messagesOf(r), BODY_BUDGET);
    return { ...r, system: fitted.system, messages: fitted.messages };
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

  // A reply the length limit cut (answer.cut) gets one more call that continues it, and the two parts are joined.
  // Plain text only: a JSON reply cannot be joined. If the continuation fails, the cut reply is kept as it is.
  async function continueCut(run, answer, prepared) {
    if (!answer || !answer.ok || !answer.cut || prepared.json) return answer;
    const next = prepare({
      ...prepared,
      messages: [...prepared.messages, { role: 'assistant', content: answer.text }, { role: 'user', content: CONTINUE_TEXT }]
    });
    let more = null;
    try { more = await run(next); } catch (_) { more = null; }
    if (!more || !more.ok || !String(more.text || '').trim()) return answer;
    return { ok: true, text: answer.text + more.text, model: answer.model, cut: !!more.cut };
  }

  // The free allowance: one call, with the same continuation rule. Its codes come from freeFailure (the server's answer).
  async function callFree(run, prepared) {
    let answer = null;
    try { answer = await run(prepared); } catch (_) { return { ok: false, code: 'failed', error: FREE_TEXT.failed }; }
    if (!answer || typeof answer !== 'object') return { ok: false, code: 'failed', error: FREE_TEXT.failed };
    if (!answer.ok) return answer.error ? answer : { ok: false, code: 'failed', error: FREE_TEXT.failed };
    if (!String(answer.text || '').trim()) return { ok: false, code: 'empty', error: FREE_TEXT.failed };
    return continueCut(run, answer, prepared);
  }

  // Runs one request. req: { system, prompt, messages, feature, json, audio, temperature, maxTokens, videoId }.
  // runners: { gemini, openrouter, openai, custom, free } = async (req) => { ok, text, model, cut } or { ok: false, code, error }.
  // Returns the first successful answer, or the last failure. A runner that throws counts as a failure.
  async function route(req, settings, runners) {
    const hasAudio = !!(req && req.audio && req.audio.base64);
    const wanted = settings && ORDER.includes(settings.subtitleProvider) ? settings.subtitleProvider : 'auto';
    const prepared = prepare(req);

    if (hasAudio) {
      // Only Gemini reads audio. Another chosen provider gets the message that names Gemini.
      if (wanted !== 'auto' && wanted !== 'gemini') return { ok: false, code: 'needs-gemini', error: TEXT.NEEDS_GEMINI };
      if (!hasKey('gemini', settings)) return { ok: false, code: 'no-key', error: TEXT.NO_KEY };
      return runOne('gemini', prepared, runners);
    }

    const names = orderFor(settings);
    if (!names.length) {
      if (runners.free && req && FREE_FEATURES.includes(req.feature)) {
        return callFree(runners.free, prepare(req));
      }
      return { ok: false, code: 'no-key', error: TEXT.NO_KEY };
    }
    let last = null;
    for (const name of names) {
      const answer = await runOne(name, prepared, runners);
      if (answer.ok) return continueCut((r) => runners[name](r), answer, prepared);
      last = answer;
    }
    return last;
  }

  const api = {
    ORDER, FREE_FEATURES, FEATURE_FA, BODY_BUDGET, TEXT, FREE_TEXT,
    hasKey, orderFor, failureFor, freeFailure, byteLength, messagesOf, fitTo, prepare, route
  };
  root.SubifyAiRoute = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
