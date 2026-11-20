var browser = globalThis.browser || globalThis.chrome; // Chrome has no browser global; same APIs live on chrome.*
// AI video chat (r18): questions about the snapshot video, answered in the viewer's own language with mm:ss stamps.
// The last 6 messages go with each question (ai-route-core.js chatWindow, the r12 web window). Turns are kept in memory only (a page reload clears them).
(() => {
  "use strict";
  const A = window.SubifyAI;
  const R = window.SubifyAiRoute;
  const TRANSCRIPT_CHARS = 16000;
  const KEEP_MESSAGES = 12; // kept in memory; only the last 6 are sent
  const state = { snap: null, langs: null, turns: [], words: [], busy: false, langChosen: false };
  const $ = (id) => document.getElementById(id);
  const log = $("log"), form = $("form"), input = $("question"), send = $("send"), status = $("status");

  function setStatus(text, kind) {
    status.className = "ai-status" + (kind ? " is-" + kind : "");
    status.textContent = text || "";
  }

  function renderSnapshotState() {
    A.renderContext($("ctx"), state.snap);
    const ready = !!state.snap && state.langChosen;
    input.disabled = !ready || state.busy;
    send.disabled = !ready || state.busy;
    input.setAttribute("aria-describedby", ready ? "status" : "ctx");
    document.querySelectorAll(".ai-chip").forEach((b) => { b.disabled = !ready; });
    if (!ready) setStatus("");
  }

  function addMessage(kind, text) {
    const empty = $("empty");
    if (empty) empty.remove();
    const who = kind === "user" ? "شما" : kind === "ai" ? "پاسخ" : "خطا";
    const body = kind === "ai" ? A.richText(text) : document.createTextNode(text);
    const node = A.h("div", { class: "ai-msg ai-msg--" + kind },
      A.h("span", { class: "ai-msg-who", text: A.tt(who) }), body);
    if (kind === "err") node.setAttribute("role", "alert");
    log.append(node);
    node.scrollIntoView({ block: "nearest" });
  }

  // The last 6 messages that fit (ai-route-core.js chatWindow), then the new question.
  function buildMessages(question) {
    return R.chatWindow(state.turns).concat([{ role: "user", content: question }]);
  }
  // The lean prompt (ai-route-core.js chatSystem): the target words and the transcript are the only context.
  function buildSystem() {
    const L = state.langs;
    return R.chatSystem({ targetName: L.targetName, nativeName: L.nativeName, title: state.snap.title, words: state.words,
      transcript: A.transcript(state.snap.cues, TRANSCRIPT_CHARS) });
  }

  function rememberTurn(question, answer) {
    state.turns.push({ role: "user", text: question }, { role: "assistant", text: answer });
    while (state.turns.length > KEEP_MESSAGES) state.turns.shift();
  }

  async function onSubmit(e) {
    e.preventDefault();
    const question = input.value.trim();
    if (!question || state.busy || !state.snap || !state.langChosen) return;
    state.busy = true;
    renderSnapshotState();
    addMessage("user", question);
    input.value = "";
    setStatus("");
    status.append(A.h("span", { class: "ai-loading" }, A.h("i"), A.h("i"), A.h("i"),
      A.h("span", { class: "ai-muted", text: A.tt("در حال پاسخ دادن…") })));
    try { state.words = (await A.practiceContext()).words; } catch (_) { state.words = []; }
    const res = await A.ask({
      system: buildSystem(),
      messages: buildMessages(question),
      feature: "chat",
      temperature: 0.3,
      maxTokens: R.CHAT_MAX_TOKENS,
      noContinue: true,
      videoId: state.snap.videoId
    });
    state.busy = false;
    status.textContent = "";
    renderSnapshotState();
    if (!res.ok) {
      addMessage("err", A.errorText(res));
      input.value = question;
      input.focus();
      return;
    }
    const answer = String(res.text || "").trim();
    addMessage("ai", answer);
    rememberTurn(question, answer);
    input.focus();
  }

  function onKey(e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  }

  async function loadSnapshot() {
    state.snap = await A.snapshot();
    renderSnapshotState();
  }

  async function init() {
    state.langs = await A.languages();
    A.watchLearning((chosen) => { state.langChosen = chosen; renderSnapshotState(); });
    await loadSnapshot();
    form.addEventListener("submit", onSubmit);
    input.addEventListener("keydown", onKey);
    document.querySelectorAll(".ai-chip").forEach((b) => {
      b.addEventListener("click", () => { input.value = b.dataset.q || ""; input.focus(); });
    });
    $("reset").addEventListener("click", () => {
      state.turns = [];
      log.querySelectorAll(".ai-msg").forEach((n) => n.remove());
      const empty = document.createElement("p");
      empty.id = "empty";
      empty.className = "ai-empty";
      empty.textContent = A.tt("هنوز سؤالی نپرسیده‌ای. یکی از پیشنهادها را بزن یا خودت بنویس.");
      log.append(empty);
      setStatus("");
    });
    try {
      browser.storage.onChanged.addListener((changes, area) => {
        if (area === "local" && changes["subify_cues_snapshot"]) loadSnapshot();
      });
    } catch (_) { /* storage events are not available: the page still works after a reload */ }
  }

  init();
})();
