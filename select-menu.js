/* Subify select menu. Every native <select> on the popup and options pages gets the same
   picker as the language switcher (ui-language.js). The native select stays in the page,
   hidden, as the source of truth: its value, its change events and its option list are
   what the rest of the code reads and writes. The picker only mirrors them.
   Firefox keeps its own <select> dropdown (see the check below). */
(() => {
  if (window.__subifySelectMenu) return;
  window.__subifySelectMenu = true;

  // Firefox fallback: the owner reported that the custom picker did not open in Firefox. The
  // cause was not reproduced (no Firefox binary here), so Firefox skips the custom picker and
  // keeps its native <select>. Untested in real Firefox. Chrome keeps the custom picker.
  if (navigator.userAgent.includes("Firefox")) return;

  const CSS = `
.sel-picker{display:block;position:relative;width:100%;min-width:0}
.sel-native{display:none!important}
.sel-native[hidden]+.sel-picker,.sel-native[style*="display: none"]+.sel-picker,.sel-native[style*="display:none"]+.sel-picker{display:none!important}
.sel-picker .lang-trigger{width:100%;height:40px;justify-content:space-between;text-align:start}
.sel-picker .lang-trigger:disabled{opacity:.55;cursor:default;pointer-events:none}
.sel-label{flex:1;min-width:0;max-width:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:start}
.sel-menu{position:fixed!important;inset-inline-end:auto;top:auto;bottom:auto;overflow-y:auto;box-sizing:border-box;max-height:260px;display:none!important}
.sel-menu.sel-open{display:block!important;visibility:visible;opacity:1;transform:none;transition:none;animation:sfy-sel-in .16s ease both}
@keyframes sfy-sel-in{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.sel-menu.sel-open{animation:none}}
.sel-picker .lang-opt{justify-content:flex-start;text-align:start}
.sel-picker .lang-opt:disabled{opacity:.45;pointer-events:none}
.lang-picker.sel-picker .sel-trigger{font-size:11.5px}
.sel-menu .lang-opt{font-size:12px}`;

  const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
  const entries = new Map(); // select -> { wrap, trigger, label, menu, sig, observer }

  function injectStyle() {
    if (document.getElementById("subify-select-menu-style")) return;
    const st = document.createElement("style");
    st.id = "subify-select-menu-style";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function optionsOf(select) {
    return Array.from(select.options).map((o) => ({ value: o.value, label: o.textContent.trim(), disabled: o.disabled }));
  }

  function isOpen(entry) {
    return entry.menu.classList.contains("sel-open");
  }

  // The menu sits in <body> from the start, so no card or panel (overflow:hidden, transforms) can
  // clip it. While closed it is display:none, so it takes no room on the page. Opening and closing
  // only toggle classes and attributes: no node moves while an option is clicked.
  function openMenu(entry) {
    entry.menu.classList.add("sel-open");
    entry.wrap.dataset.open = "true";
    entry.trigger.setAttribute("aria-expanded", "true");
    placeMenu(entry);
  }

  function closeMenu(entry) {
    entry.wrap.dataset.open = "false";
    entry.trigger.setAttribute("aria-expanded", "false");
    entry.menu.classList.remove("sel-open");
  }

  function closeAll(except) {
    for (const entry of entries.values()) {
      if (entry !== except && isOpen(entry)) closeMenu(entry);
    }
  }

  // The menu is position:fixed, so the accordion/card that holds the select (overflow:hidden)
  // cannot clip it. It is placed from the trigger's rectangle each time it opens or the page moves.
  function placeMenu(entry) {
    const r = entry.trigger.getBoundingClientRect();
    const m = entry.menu;
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const openUp = below < 200 && above > below;
    const room = Math.max(120, Math.min(260, openUp ? above : below));
    // At least 220px wide (short fields would wrap their labels), kept on screen, aligned to the trigger's inline-end edge.
    const width = Math.min(Math.max(r.width, 220), window.innerWidth - 16);
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - 8 - width));
    m.style.left = `${left}px`;
    m.style.width = `${width}px`;
    m.style.maxHeight = `${room}px`;
    if (openUp) {
      m.style.top = "auto";
      m.style.bottom = `${window.innerHeight - r.top + 6}px`;
    } else {
      m.style.bottom = "auto";
      m.style.top = `${r.bottom + 6}px`;
    }
  }

  function rebuildMenu(select, entry) {
    entry.menu.textContent = "";
    for (const opt of optionsOf(select)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "lang-opt sel-opt";
      b.setAttribute("role", "option");
      b.dataset.value = opt.value;
      b.disabled = opt.disabled;
      const name = document.createElement("span");
      name.className = "lang-opt-name";
      name.textContent = opt.label;
      const tick = document.createElement("span");
      tick.className = "lang-opt-tick";
      tick.innerHTML = TICK;
      b.append(name, tick);
      b.addEventListener("click", (e) => {
        e.preventDefault();
        if (select.value !== opt.value) {
          select.value = opt.value; // the value override below also syncs the picker
          select.dispatchEvent(new Event("input", { bubbles: true }));
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
        sync(select);
        closeMenu(entry);
        entry.trigger.focus({ preventScroll: true });
      });
      entry.menu.appendChild(b);
    }
  }

  function sync(select) {
    const entry = entries.get(select);
    if (!entry) return;
    // Rebuild only when the option list itself changes. Picking an option keeps the same buttons.
    const sig = JSON.stringify(optionsOf(select));
    if (sig !== entry.sig) {
      entry.sig = sig;
      rebuildMenu(select, entry);
    }
    const current = select.options[select.selectedIndex];
    entry.label.textContent = current ? current.textContent.trim() : "";
    entry.trigger.disabled = select.disabled;
    entry.menu.querySelectorAll(".sel-opt").forEach((b) => {
      const on = current && b.dataset.value === current.value;
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function enhance(select) {
    if (entries.has(select)) return;
    if (select.multiple || select.size > 1 || select.closest("#lang-menu, .lang-picker")) return;

    const wrap = document.createElement("div");
    wrap.className = "lang-picker sel-picker";
    wrap.dataset.open = "false";

    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "lang-trigger sel-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");

    const label = document.createElement("span");
    label.className = "lang-trigger-name sel-label";
    const chev = document.createElement("span");
    chev.className = "lang-trigger-chev";
    chev.setAttribute("aria-hidden", "true");
    chev.innerHTML = CHEVRON;
    trigger.append(label, chev);

    const menu = document.createElement("div");
    menu.className = "lang-menu sel-menu";
    menu.setAttribute("role", "listbox");

    wrap.append(trigger);
    (document.body || document.documentElement).appendChild(menu);
    select.classList.add("sel-native");
    select.insertAdjacentElement("afterend", wrap);

    const entry = { wrap, trigger, label, menu, sig: "", observer: null };
    entries.set(select, entry);

    trigger.addEventListener("click", (e) => {
      e.preventDefault();
      if (isOpen(entry)) { closeMenu(entry); return; }
      closeAll(entry);
      openMenu(entry);
      const checked = menu.querySelector('[aria-checked="true"]') || menu.querySelector(".sel-opt");
      checked?.focus({ preventScroll: true });
    });
    trigger.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); trigger.click(); }
    });
    menu.addEventListener("keydown", (e) => {
      const items = Array.from(menu.querySelectorAll(".sel-opt:not(:disabled)"));
      const i = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length];
        next?.focus();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeMenu(entry);
        trigger.focus();
      }
    });

    // Programmatic changes (select.value = x) must update the picker too.
    Object.defineProperty(select, "value", {
      configurable: true,
      get() { return nativeValue.get.call(this); },
      set(v) { nativeValue.set.call(this, v); sync(this); },
    });
    select.addEventListener("change", () => sync(select));
    select.addEventListener("input", () => sync(select));

    // Options rebuilt or relabelled by page code, a disabled flag, or the page being hidden.
    entry.observer = new MutationObserver(() => sync(select));
    entry.observer.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled", "label", "hidden", "style"] });

    sync(select);
  }

  function enhanceAll(root = document) {
    injectStyle();
    root.querySelectorAll?.("select").forEach(enhance);
    if (root.matches?.("select")) enhance(root);
  }

  // Only a scroll of the page itself (the window) moves the trigger away from a fixed menu, so an
  // open menu closes. A scroll inside any other scroller (a card, a list) does not close it: the
  // menu is re-anchored to its trigger instead.
  document.addEventListener("scroll", (e) => {
    const pageScroll = e.target === document;
    for (const entry of entries.values()) {
      if (!isOpen(entry)) continue;
      if (e.target instanceof Node && entry.menu.contains(e.target)) continue;
      if (pageScroll) closeMenu(entry);
      else placeMenu(entry);
    }
  }, true);
  window.addEventListener("resize", () => {
    for (const entry of entries.values()) if (isOpen(entry)) closeMenu(entry);
  });

  // Close on outside click or Escape.
  document.addEventListener("click", (e) => {
    for (const entry of entries.values()) {
      if (!isOpen(entry)) continue;
      if (entry.wrap.contains(e.target) || entry.menu.contains(e.target)) continue;
      closeMenu(entry);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    for (const entry of entries.values()) if (isOpen(entry)) closeMenu(entry);
  });

  // Selects added later by page code (model lists, provider lists).
  const adder = new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes.forEach((n) => { if (n.nodeType === 1) enhanceAll(n); });
    }
  });
  adder.observe(document.documentElement, { childList: true, subtree: true });

  // Once ui-language has translated the option labels, refresh the picker text.
  document.addEventListener("subify-ui-language", () => {
    for (const select of entries.keys()) sync(select);
  });

  enhanceAll(document);
})();
