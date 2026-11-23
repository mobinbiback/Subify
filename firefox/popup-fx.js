// One tooltip for the popup. Any element with data-tip shows its text (translated through
// SubifyUI.t) in a single fixed bubble, clamped inside the 380px window. No pointer tracking,
// no blur, so hovering costs nothing per frame.
(() => {
  const tip = document.createElement('div');
  tip.className = 'sfx-tip';
  tip.setAttribute('role', 'tooltip');
  let cur = null;

  const label = (el) => {
    const raw = el.getAttribute('data-tip') || '';
    try { return window.SubifyUI && window.SubifyUI.t ? window.SubifyUI.t(raw) : raw; } catch (e) { return raw; }
  };
  const target = (e) => (e.target && e.target.closest ? e.target.closest('[data-tip]') : null);

  const place = (el) => {
    const r = el.getBoundingClientRect();
    tip.style.left = '0px';
    tip.style.top = '0px';
    const w = Math.min(tip.offsetWidth, 240);
    const h = tip.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const x = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, vw - w - 8));
    let y = r.top - h - 8;
    if (y < 8) y = r.bottom + 8;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  };
  const hide = () => { cur = null; tip.classList.remove('on'); };
  const show = (el) => {
    const text = label(el);
    if (!text) return hide();
    cur = el;
    tip.textContent = text;
    tip.setAttribute('dir', document.documentElement.dir || 'auto');
    if (!tip.isConnected) document.body.appendChild(tip);
    tip.classList.add('on');
    place(el);
  };

  document.addEventListener('pointerover', (e) => {
    const el = target(e);
    if (el && el !== cur) show(el);
    else if (!el) hide();
  }, { passive: true });
  document.addEventListener('pointerout', (e) => {
    const el = target(e);
    if (el && !el.contains(e.relatedTarget)) hide();
  }, { passive: true });
  document.addEventListener('focusin', (e) => { const el = target(e); if (el) show(el); else hide(); });
  document.addEventListener('focusout', hide);
  window.addEventListener('scroll', hide, { passive: true, capture: true });
  window.addEventListener('resize', hide);
})();
