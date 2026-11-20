// Part 7 (Chrome and Firefox lite): the wallet and history screen, the top-up screen (job amount, custom amount, plans), the
// payment tab, and the refresh when the popup opens or gets focus again. One file for both trees, loaded by popup.html.
// Server calls go through the background bridge ("subify-api"). The VPN warning is drawn only by topupHtml().
(function (root) {
  "use strict";

  const MIN_TOMAN = 10000;               // the server's minimum custom top-up (PAY_CUSTOM_MIN_TOMAN)
  const MAX_TOMAN = 50000000;            // PAY_CUSTOM_MAX_TOMAN
  const PAY_TIMEOUT_MS = 30000;          // creating an invoice can wait for the gateway
  const RETURN_GAP_MS = 1500;            // a focus right after the popup opens does not ask the server again
  const RECENT_MS = 2 * 60 * 60 * 1000;  // the server never expires an unpaid invoice, so older ones are not shown as waiting
  const PENDING = ["created", "pending", "paid_unverified"];
  const FAILED = ["failed", "expired", "cancelled", "mismatch"];
  const VPN_TEXT = "⚠️ توجه: قبل از ورود به درگاه پرداخت، حتماً VPN خود را خاموش کنید";

  // Labels only. Prices and plans come from auth/pay.php?action=plans.
  const PLAN_NAMES = { starter: "استارتر", pro: "حرفه‌ای", ultra: "اولترا", topup: "شارژ اعتبار" };
  const BILLING = { monthly: "ماهانه", quarterly: "سه‌ماهه", one_time: "یک‌باره" };
  const KIND = { trial: "اعتبار آزمایشی", purchased: "خریداری‌شده" };
  const STATUS = { granted: "پرداخت‌شده", created: "در انتظار", pending: "در انتظار", paid_unverified: "در انتظار",
    failed: "ناموفق", expired: "ناموفق", cancelled: "ناموفق", mismatch: "مغایرت" };
  const FEATURE = { chat: "چت", writer: "نویسنده", roleplay: "نقش‌آفرینی", shadow: "شدوینگ", dub: "دوبله",
    subtitle: "زیرنویس", translate: "ترجمه" };
  const ERR_TEXT = {
    sign_in: "برای خرید اول وارد حساب کاربری‌ات شو.",
    amount_low: "کمترین مبلغ شارژ {n} تومان است.",
    amount_high: "مبلغ از سقف هر پرداخت بیشتر است.",
    bad_amount: "مبلغ را فقط با عدد و به تومان وارد کن.",
    pay_not_ready: "درگاه پرداخت هنوز آماده نیست. بعداً دوباره امتحان کن.",
    plan_not_sold: "این بسته الان فروخته نمی‌شود.",
  };
  const ERR_DEFAULT = "ساخت فاکتور انجام نشد. دوباره امتحان کن.";
  const NET_TEXT = "اتصال به سرور برقرار نشد. اینترنت را بررسی کن.";
  const TAB_TEXT = "تب درگاه باز نشد. دوباره امتحان کن.";

  // Text in the UI language (SubifyUI from ui-language.js), Persian when it is not loaded. {name} parts come from vars.
  function T(s, vars) {
    let out = root.SubifyUI && typeof root.SubifyUI.t === "function" ? root.SubifyUI.t(s) : s;
    if (vars) Object.keys(vars).forEach((k) => { out = out.split("{" + k + "}").join(String(vars[k])); });
    return out;
  }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  function uiLang() {
    const ui = root.SubifyUI && root.SubifyUI.lang;
    const doc = typeof document !== "undefined" ? document.documentElement : null;
    return String(ui || (doc && doc.lang) || "fa").split("-")[0];
  }
  function fmt(n) {
    const v = Number(n) || 0;
    const R = root.SubifyAiRoute;
    const s = R && typeof R.formatToman === "function" ? R.formatToman(v, uiLang()) : null;
    return s != null ? s : v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  }
  function toman(n) { return T("{n} تومان", { n: fmt(n) }); }
  function tomanOrUnknown(n) { return n == null ? T("نامشخص") : toman(n); }
  function fmtDate(v) {
    const n = Number(v);
    if (!v || !isFinite(n)) return "";
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return isNaN(d) ? "" : d.toLocaleDateString(uiLang() === "fa" ? "fa-IR" : "en-US", { year: "numeric", month: "long", day: "numeric" });
  }
  // A toman figure from the server: name_toman, else name_micro / 1e6, else null.
  function tomanField(o, name) {
    if (!o) return null;
    if (typeof o[name + "_toman"] === "number") return o[name + "_toman"];
    if (typeof o[name + "_micro"] === "number") return o[name + "_micro"] / 1e6;
    return null;
  }

  // The amount paid for a job: its estimated toman rounded up, and never below the minimum.
  function jobAmount(job) {
    const j = Number(job);
    return Math.max(MIN_TOMAN, j > 0 && isFinite(j) ? Math.ceil(j) : 0);
  }
  // A custom amount typed by the member: Persian and Arabic digits and separators are read; {toman} or {err}.
  function parseAmount(raw) {
    const s = String(raw == null ? "" : raw)
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[٬,\s]/g, "");
    if (!/^\d{1,12}$/.test(s)) return { err: "bad_amount" };
    const n = Number(s);
    if (n < MIN_TOMAN) return { err: "amount_low" };
    if (n > MAX_TOMAN) return { err: "amount_high" };
    return { toman: n };
  }
  function isGatewayUrl(u) { return typeof u === "string" && /^https:\/\/\S+$/i.test(u); }

  // Invoices still waiting for the gateway, created within RECENT_MS of nowSec (unix seconds).
  function pendingList(list, nowSec) {
    const cutoff = (nowSec || Math.floor(Date.now() / 1000)) - RECENT_MS / 1000;
    return (list || []).filter((v) => PENDING.includes(v.status) && Number(v.created || 0) >= cutoff);
  }
  function isWaiting(st) {
    return !!st.lastOrder || pendingList(st.data && st.data.invoices, st.data && st.data.now).length > 0;
  }

  // ---- HTML pieces. Every value from the server goes through esc(). ----
  function head(title) {
    return '<div class="sfw-head"><button type="button" class="sfw-btn ghost" data-sfw="back">' + esc(T("بازگشت")) + "</button>" +
      "<strong>" + esc(title) + "</strong></div>";
  }
  function note(text) { return '<p class="sfw-note">' + esc(text) + "</p>"; }
  function btn(act, label, extra, cls) {
    return '<button type="button" class="sfw-btn ' + (cls || "") + '" data-sfw="' + act + '"' + (extra || "") + ">" + esc(label) + "</button>";
  }
  function msgHtml(st) { return '<p class="sfw-msg ' + esc(st.msgKind) + '" role="status">' + esc(st.msg) + "</p>"; }
  function waitingHtml(st) {
    if (!isWaiting(st)) return "";
    return '<div class="sfw-wait" role="status"><strong>' + esc(T("در انتظار تسویه")) + "</strong><p>" +
      esc(T("پرداخت هنوز تأیید نشده است. بعد از پرداخت، این بخش خودکار به‌روز می‌شود. اگر پرداخت کرده‌ای، چند لحظه بعد دوباره بررسی کن.")) +
      "</p>" + btn("refresh", T("بررسی دوباره"), "", "ghost") + "</div>";
  }
  function errorHtml(err, retryAct, failText) {
    const isSignIn = err.error === "sign_in";
    const reason = isSignIn ? T("برای دیدن کیف پول وارد حساب کاربری‌ات شو.") : T(failText);
    const cause = !isSignIn && err.error ? note(T("علت: {reason}", { reason: String(err.error) + (err.status ? " · HTTP " + err.status : "") })) : "";
    const signIn = isSignIn ? '<div class="sfw-row">' + btn("sign-in", T("ورود با Google"), ' data-provider="google"') +
      btn("sign-in", T("ورود با GitHub"), ' data-provider="github"') + "</div>" : "";
    return '<div class="sfw-error" role="alert"><p>' + esc(reason) + "</p>" + cause + signIn + btn(retryAct, T("تلاش دوباره")) + "</div>";
  }
  function balanceHtml(w, minute) {
    const av = tomanField(w, "available");
    const bc = minuteCount(av, minute);
    const mpB = bc === null ? "" : T("معادل حدود {m} دقیقه ترجمه با مدل پایه", { m: dig(bc) });
    return '<section class="sfw-card sfw-balance"><span class="sfw-k">' + esc(T("قابل استفاده")) + "</span>" +
      '<div class="sfw-big">' + esc(tomanOrUnknown(av == null ? null : Math.max(0, av))) + "</div>" +
      (mpB ? '<div style="font-size:12px;opacity:.75;margin-bottom:6px">' + esc(mpB) + "</div>" : "") +
      '<div class="sfw-row"><span>' + esc(T("کل موجودی")) + "</span><b>" + esc(tomanOrUnknown(tomanField(w, "balance"))) + "</b></div>" +
      '<div class="sfw-row"><span>' + esc(T("در نگهداری برای کار در حال اجرا")) + "</span><b>" + esc(tomanOrUnknown(tomanField(w, "held"))) + "</b></div></section>";
  }
  function lotsHtml(lots) {
    let h = '<h3 class="sfw-h">' + esc(T("اعتبارهای فعال")) + "</h3>";
    const live = (lots || []).filter((l) => (tomanField(l, "remaining") || 0) > 0);
    if (!live.length) return h + note(T("اعتبار فعالی نداری."));
    live.forEach((l) => {
      const exp = fmtDate(l.expires_at);
      h += '<div class="sfw-card sm"><div class="sfw-row"><strong>' + esc(KIND[l.kind] ? T(KIND[l.kind]) : T("سایر")) + "</strong><b>" +
        esc(toman(tomanField(l, "remaining"))) + "</b></div><div class=\"sfw-sub\">" +
        esc(exp ? T("انقضا: {date}", { date: exp }) : T("بدون تاریخ انقضا")) + "</div></div>";
    });
    return h;
  }
  function invoicesHtml(list) {
    if (!list || !list.length) return note(T("هنوز پرداختی ثبت نشده است."));
    return list.map((v) => '<div class="sfw-card sm"><div class="sfw-row"><span class="sfw-sub">' + esc(fmtDate(v.created)) + "</span><strong>" +
      esc(STATUS[v.status] ? T(STATUS[v.status]) : String(v.status || "")) + '</strong></div><div class="sfw-ltr">' + esc(v.order_id || "") +
      '</div><div class="sfw-sub">' + esc(toman(v.amount_toman)) + "</div></div>").join("");
  }
  function usageHtml(list) {
    if (!list || !list.length) return note(T("هنوز مصرفی ثبت نشده است."));
    return list.map((d) => {
      const cost = typeof d.cost_toman === "number" ? d.cost_toman : (typeof d.toman_cost === "number" ? d.toman_cost : null);
      return '<div class="sfw-card sm"><div class="sfw-row"><strong>' + esc(FEATURE[d.feature] ? T(FEATURE[d.feature]) : T("سایر")) +
        '</strong><span class="sfw-sub">' + esc(fmtDate(d.created)) + '</span></div><div class="sfw-sub">' +
        esc(tomanOrUnknown(cost)) + "</div></div>";
    }).join("");
  }
  // Translation minutes a toman buys with the base model (auth/wallet.php minute); null when unknown.
  function dig(n) { return root.SubifyUI && typeof root.SubifyUI.digits === "function" ? root.SubifyUI.digits(String(n)) : String(n); }
  function minuteCount(toman, minute) {
    const per = minute && Number(minute.toman_per_minute) > 0 ? Number(minute.toman_per_minute) : 0;
    const v = Number(toman) || 0;
    return per && v > 0 ? Math.floor(v / per) : null;
  }
  function planRow(p, minute) {
    const name = PLAN_NAMES[p.plan_code] ? T(PLAN_NAMES[p.plan_code]) : String(p.plan_code || "");
    const bill = BILLING[p.billing] ? T(BILLING[p.billing]) : String(p.billing || "");
    const credit = typeof p.credit_micro === "number" ? p.credit_micro / 1e6 : null;
    const mc = credit == null ? null : minuteCount(credit, minute);
    const mp = mc === null ? "" : T("حدود {m} دقیقه ترجمه (با مدل پایه)", { m: dig(mc) });
    const line = credit == null ? "" : (p.plan_code === "topup"
      ? (mp ? T("{n} تومان اعتبار · {m}", { n: fmt(credit), m: mp }) : T("اعتبار {n} تومان", { n: fmt(credit) }))
      : (mp ? T("{n} تومان اعتبار · {m} · اعتبار {days} روز", { n: fmt(credit), m: mp, days: dig(Number(p.period_days) || 0) })
        : T("اعتبار {n} تومان · {days} روز", { n: fmt(credit), days: fmt(Number(p.period_days) || 0) })));
    return '<div class="sfw-plan"><div><strong>' + esc(name) + (bill ? " · " + esc(bill) : "") + '</strong><div class="sfw-sub">' +
      esc(line) + '</div></div><button type="button" class="sfw-btn main" data-sfw="pay-plan" data-code="' + esc(p.plan_code) +
      '" data-billing="' + esc(p.billing) + '">' + esc(toman(p.price_toman)) + "</button></div>";
  }
  function plansHtml(st) {
    if (st.plansErr) return errorHtml(st.plansErr, "retry-plans", "بسته‌ها بارگذاری نشد.");
    if (!st.plans) return note(T("در حال بارگذاری بسته‌ها…"));
    if (!st.plans.length) return note(T("هیچ بسته‌ای برای فروش نیست."));
    const pm = (st.data && st.data.minute) || st.planMinute || null;
    const subs = st.plans.filter((p) => p.plan_code !== "topup");
    const tops = st.plans.filter((p) => p.plan_code === "topup");
    let h = "";
    if (subs.length) h += '<h3 class="sfw-h">' + esc(T("اشتراک")) + "</h3>" + subs.map((p) => planRow(p, pm)).join("");
    if (tops.length) h += '<h3 class="sfw-h">' + esc(T("شارژ اعتبار")) + "</h3>" + tops.map((p) => planRow(p, pm)).join("");
    return h;
  }

  // The wallet screen: balance, the trial and purchased lots, the payment and usage history. No red warning here.
  function walletHtml(st) {
    let h = head(T("کیف پول Subify")) + waitingHtml(st);
    if (st.msg) h += msgHtml(st);
    if (st.walletErr) return h + errorHtml(st.walletErr, "refresh", "کیف پول بارگذاری نشد.");
    if (!st.data) return h + note(T("در حال بارگذاری کیف پول…"));
    const w = st.data.wallet || {};
    h += balanceHtml(w, st.data.minute);
    h += '<div class="sfw-actions">' + btn("open-topup", T("شارژ کیف پول"), ' data-from="wallet"', "main wide") + "</div>";
    h += lotsHtml(w.lots);
    h += '<h3 class="sfw-h">' + esc(T("تاریخچه پرداخت‌ها")) + "</h3>" + invoicesHtml(st.data.invoices);
    h += '<h3 class="sfw-h">' + esc(T("تاریخچه مصرف")) + "</h3>" + usageHtml(st.data.deductions);
    return '<div class="sfw-page">' + h + "</div>";
  }

  // The top-up screen. The VPN warning is the first thing in it, and the only place it is drawn.
  function topupHtml(st) {
    let h = head(T("شارژ کیف پول")) + waitingHtml(st);
    if (st.job != null) {
      h += '<section class="sfw-card"><div class="sfw-sub">' + esc(T("هزینهٔ تقریبی این کار: {n} تومان", { n: fmt(st.job) })) +
        '</div><div class="sfw-sub">' + esc(T("مبلغ پرداخت: {n} تومان", { n: fmt(jobAmount(st.job)) })) + "</div>" +
        btn("pay-job", T("پرداخت همین مبلغ و شارژ کیف پول"), "", "main wide") + "</section>";
    }
    h += '<section class="sfw-card"><strong class="sfw-h">' + esc(T("مبلغ دلخواه")) + "</strong>" +
      '<p class="sfw-sub">' + esc(T("مبلغ را به تومان بنویس. حداقل {n} تومان.", { n: fmt(MIN_TOMAN) })) + "</p>" +
      '<input class="sfw-input" data-field="custom" type="text" inputmode="numeric" autocomplete="off" placeholder="' + esc(fmt(MIN_TOMAN)) +
      '" aria-label="' + esc(T("مبلغ دلخواه")) + '">' + btn("pay-custom", T("پرداخت این مبلغ"), "", "main wide") + "</section>";
    h += plansHtml(st);
    if (st.msg) h += msgHtml(st);
    return '<div class="sfw-vpn" role="alert">' + esc(T(VPN_TEXT)) + "</div>" + '<div class="sfw-page">' + h + "</div>";
  }

  function screenHtml(st) {
    if (st.screen === "topup") return topupHtml(st);
    if (st.screen === "wallet") return walletHtml(st);
    return "";
  }
  // The button in the cost card. It opens the top-up screen; the payment itself is started from there.
  function jobButtonHtml(job) {
    const j = Number(job) > 0 ? Math.ceil(Number(job)) : "";
    return '<div class="sfw-entry-row">' + btn("open-topup", T("شارژ کیف پول برای این کار"), ' data-from="main" data-job="' + j + '"', "main wide") + "</div>";
  }

  // The controller: all state and server calls. Each call sends one bridge request and never throws.
  function createController(deps) {
    const d = deps || {};
    const send = d.send;
    const openTab = d.openTab;
    const now = d.now || (() => Date.now());
    const listeners = [];
    const st = { screen: "main", from: "main", data: null, walletErr: null, plans: null, plansErr: null, job: null,
      msg: "", msgKind: "", busy: false, lastOrder: null, last: -Infinity };

    function emit() { listeners.forEach((f) => f(st)); }
    function set(patch) { Object.assign(st, patch); emit(); }
    async function ask(req) {
      let r = null;
      try { r = await send(req); } catch (e) { r = null; }
      return r && typeof r === "object" ? r : { ok: false, status: 0, error: "network" };
    }

    // auth/wallet.php. The server settles unpaid invoices when it is read, so a second read shows the new state.
    async function refreshWallet() {
      const r = await ask({ path: "/auth/wallet.php" });
      if (r.ok && r.json && r.json.ok) {
        st.data = r.json;
        st.walletErr = null;
        if (st.lastOrder) {
          const inv = (r.json.invoices || []).find((v) => v.order_id === st.lastOrder.order_id);
          if (inv && inv.status === "granted") { st.msg = T("اعتبار به کیف پول اضافه شد."); st.msgKind = "ok"; st.lastOrder = null; }
          else if (inv && FAILED.includes(inv.status)) { st.msg = T("پرداخت انجام نشد یا باطل شد. دوباره امتحان کن."); st.msgKind = "err"; st.lastOrder = null; }
        }
      } else {
        st.data = null;
        st.walletErr = { error: (r.json && r.json.error) || r.error || "network", status: r.status || 0 };
      }
      emit();
      return !st.walletErr;
    }
    // The popup opened, or the window got focus. Asks the server at most once per RETURN_GAP_MS unless forced.
    async function returnToPopup(force) {
      const t = now();
      if (!force && t - st.last < RETURN_GAP_MS) return false;
      st.last = t;
      return refreshWallet();
    }
    // auth/pay.php?action=plans: the prices and plans are the server's, nothing is kept here.
    async function loadPlans() {
      const r = await ask({ path: "/auth/pay.php?action=plans" });
      if (r.ok && r.json && r.json.ok && Array.isArray(r.json.plans)) set({ plans: r.json.plans, planMinute: r.json.minute || null, plansErr: null });
      else set({ plans: null, plansErr: { error: (r.json && r.json.error) || r.error || "network", status: r.status || 0 } });
    }
    // Creates the invoice, then opens the gateway in a NEW tab. This tab and the popup stay where they are.
    async function order(path, body, kind) {
      if (st.busy) return false;
      st.busy = true;
      set({ msg: T("در حال انتقال به درگاه…"), msgKind: "" });
      const r = await ask({ path, method: "POST", body, timeoutMs: PAY_TIMEOUT_MS });
      st.busy = false;
      const j = r.json && typeof r.json === "object" ? r.json : {};
      if (!(r.ok && j.ok && isGatewayUrl(j.payment_url))) {
        const netErr = r.error === "network" || r.error === "timeout";
        const text = netErr ? NET_TEXT : (ERR_TEXT[j.error] || ERR_DEFAULT);
        set({ msg: T(text, { n: fmt(MIN_TOMAN) }), msgKind: "err" });
        return false;
      }
      st.lastOrder = { order_id: String(j.order_id || ""), kind: kind || "" };
      set({ msg: T("درگاه پرداخت در یک تب جدید باز شد. بعد از پرداخت به این پنجره برگرد."), msgKind: "pending" });
      try {
        await openTab(j.payment_url);
      } catch (e) {
        st.lastOrder = null;
        set({ msg: T(TAB_TEXT), msgKind: "err" });
        return false;
      }
      return true;
    }
    // The job amount: max(MIN_TOMAN, job), never less than the job.
    function payJob() { return order("/auth/pay.php?action=create_custom", { toman: jobAmount(st.job) }, "topup"); }
    function payCustom(raw) {
      const r = parseAmount(raw);
      if (r.err) { set({ msg: T(ERR_TEXT[r.err], { n: fmt(MIN_TOMAN) }), msgKind: "err" }); return Promise.resolve(false); }
      return order("/auth/pay.php?action=create_custom", { toman: r.toman }, "topup");
    }
    function payPlan(code, billing) {
      return order("/auth/pay.php?action=create", { plan_code: String(code || ""), billing: String(billing || "") }, code === "topup" ? "topup" : "plan");
    }

    function openWallet() { set({ screen: "wallet", from: "main", msg: "", msgKind: "" }); return refreshWallet(); }
    function openTopup(job, from) {
      const n = Number(job);
      set({ screen: "topup", from: from === "wallet" ? "wallet" : "main", job: n > 0 && isFinite(n) ? n : null, msg: "", msgKind: "" });
      return loadPlans();
    }
    function back() { set({ screen: st.screen === "topup" && st.from === "wallet" ? "wallet" : "main", msg: "", msgKind: "" }); }
    function close() { set({ screen: "main", msg: "", msgKind: "" }); }

    function onChange(f) { listeners.push(f); }
    function state() { return st; }
    return { state, onChange, refreshWallet, returnToPopup, loadPlans, openWallet, openTopup, back, close, payJob, payCustom, payPlan };
  }

  // Browser only. opts: root (the screen element), statusEl (one line in the translate tab), send, openTab, signIn, now.
  // Clicks are handled on the document, so the cost-card button and the screen both work. Opening the popup refreshes once,
  // and a focus event refreshes again only after RETURN_GAP_MS.
  function mount(opts) {
    const o = opts || {};
    const c = createController({ send: o.send, openTab: o.openTab, now: o.now });
    const rootEl = o.root;
    const statusEl = o.statusEl;
    c.onChange((st) => {
      if (rootEl) {
        const keep = rootEl.querySelector ? rootEl.querySelector('[data-field="custom"]') : null;
        const kept = keep ? keep.value : null;
        rootEl.hidden = st.screen === "main";
        rootEl.innerHTML = screenHtml(st);
        const again = rootEl.querySelector ? rootEl.querySelector('[data-field="custom"]') : null;
        if (again && kept != null) again.value = kept;
      }
      if (statusEl) statusEl.textContent = isWaiting(st) ? T("در انتظار تسویه") : "";
      const entry = typeof document !== "undefined" && document.querySelector ? document.querySelector('[data-sfw="open-wallet"]') : null;
      if (entry) entry.dataset.waiting = isWaiting(st) ? "1" : "";
    });
    const acts = {
      "open-wallet": () => c.openWallet(),
      "open-topup": (el) => c.openTopup(el.dataset.job, el.dataset.from),
      back: () => c.back(),
      close: () => c.close(),
      refresh: () => c.refreshWallet(),
      "retry-plans": () => c.loadPlans(),
      "pay-job": () => c.payJob(),
      "pay-custom": () => c.payCustom(rootEl && rootEl.querySelector ? ((rootEl.querySelector('[data-field="custom"]') || {}).value) : ""),
      "pay-plan": (el) => c.payPlan(el.dataset.code, el.dataset.billing),
      "sign-in": (el) => { if (o.signIn) o.signIn(el.dataset.provider === "github" ? "github" : "google"); },
    };
    if (typeof document !== "undefined") {
      document.addEventListener("click", (e) => {
        const t = e.target;
        const el = t && typeof t.closest === "function" ? t.closest("[data-sfw]") : null;
        const f = el && acts[el.dataset.sfw];
        if (f) { e.preventDefault(); f(el); }
      });
    }
    if (typeof window !== "undefined") window.addEventListener("focus", () => { c.returnToPopup(false); });
    c.returnToPopup(true);
    return c;
  }

  const api = { MIN_TOMAN, MAX_TOMAN, VPN_TEXT, RECENT_MS, RETURN_GAP_MS, PENDING, FAILED, PLAN_NAMES, BILLING, KIND, STATUS, FEATURE,
    ERR_TEXT, ERR_DEFAULT, NET_TEXT, TAB_TEXT, T, jobAmount, parseAmount, pendingList, isWaiting, screenHtml, walletHtml,
    topupHtml, plansHtml, planRow, errorHtml, jobButtonHtml, createController, mount };
  root.SubifyWallet = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
