// Toasts (bottom-right), modals, menus, tooltips, drawer.
import { html, esc, raw } from '../core/html.js';
import { icon, refreshIcons } from '../core/icons.js';

const ICONS = { ok: 'check', warn: 'alert-triangle', bad: 'alert-circle', info: 'info' };
export function toast(title, { type = 'info', body = '', action = null, ms = null } = {}) {
  const root = document.getElementById('toast-root');
  while (root.children.length >= 4) root.firstChild.remove();
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.setAttribute('role', type === 'bad' ? 'alert' : 'status');
  el.innerHTML = `${icon(ICONS[type] || 'info')}<div><div class="tt">${esc(title)}</div>` +
    (body ? `<div class="tb">${esc(body)}</div>` : '') +
    (action ? `<button class="tact">${esc(action.label)}</button>` : '') + `</div>
    <button class="icon-btn tx" aria-label="Dismiss">${icon('x')}</button>`;
  const kill = () => { el.classList.add('leaving'); setTimeout(() => el.remove(), 180); };
  el.querySelector('.tx').onclick = kill;
  if (action) el.querySelector('.tact').onclick = () => { action.onClick(); kill(); };
  root.appendChild(el);
  refreshIcons(el);
  const t = ms ?? (type === 'bad' ? 0 : type === 'warn' ? 7000 : 4500);
  if (t) {
    const to = setTimeout(kill, t);
    el.addEventListener('mouseenter', () => clearTimeout(to), { once: true });
  }
  return kill;
}

export function confirmDialog({ title, body, okLabel = 'Confirm', danger = false, requireText = null }) {
  return new Promise(resolve => {
    const root = document.getElementById('modal-root');
    root.innerHTML = html`
      <div class="modal-veil"><div class="modal" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="modal-b" style="padding-top:20px"><div class="row">
          <span class="tone-circle" style="background:var(--${danger ? 'bad' : 'info'}-soft);color:var(--${danger ? 'bad' : 'info'})">${raw(icon(danger ? 'alert-triangle' : 'info', 20))}</span>
          <h2 style="margin:0">${title}</h2></div>
          <p class="muted">${body}</p>
          ${requireText ? `<div class="field"><label>Type <b>${requireText}</b> to confirm</label><input class="input" id="cf-text" autocomplete="off"></div>` : ''}
        </div>
        <div class="modal-f"><button class="btn ghost" id="cf-no">Cancel</button>
        <button class="btn ${danger ? 'danger' : ''}" id="cf-ok" ${requireText ? 'disabled' : ''}>${okLabel}</button></div>
      </div></div>`;
    const prev = document.activeElement;
    const done = v => { root.innerHTML = ''; if (prev?.focus) prev.focus(); resolve(v); };
    root.querySelector('#cf-no').onclick = () => done(false);
    root.querySelector('.modal-veil').addEventListener('mousedown', e => { if (e.target.classList.contains('modal-veil') && !danger) done(false); });
    const ok = root.querySelector('#cf-ok');
    ok.onclick = () => done(true);
    if (requireText) {
      const inp = root.querySelector('#cf-text');
      inp.oninput = () => { ok.disabled = inp.value.trim() !== requireText; };
      setTimeout(() => inp.focus(), 50);
    } else setTimeout(() => ok.focus(), 50);
    const esc2 = e => { if (e.key === 'Escape' && !danger) { document.removeEventListener('keydown', esc2); done(false); } };
    document.addEventListener('keydown', esc2);
    refreshIcons(root);
  });
}

export function openModal({ title, body, actions = [], size = '' }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = html`
    <div class="modal-veil"><div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="modal-h"><h2>${title}</h2><button class="icon-btn" id="m-x" aria-label="Close">${raw(icon('x'))}</button></div>
      <div class="modal-b" id="m-body"></div>
      <div class="modal-f" id="m-foot"></div></div></div>`;
  const prev = document.activeElement;
  const close = () => { root.innerHTML = ''; if (prev?.focus) prev.focus(); };
  root.querySelector('#m-x').onclick = close;
  root.querySelector('.modal-veil').addEventListener('mousedown', e => { if (e.target.classList.contains('modal-veil')) close(); });
  const esc2 = e => { if (e.key === 'Escape') { document.removeEventListener('keydown', esc2); close(); } };
  document.addEventListener('keydown', esc2);
  const b = root.querySelector('#m-body');
  if (typeof body === 'string') b.innerHTML = body; else if (body) b.appendChild(body);
  const f = root.querySelector('#m-foot');
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (a.kind || '');
    btn.textContent = a.label;
    btn.onclick = () => { if (a.onClick) a.onClick(close); else close(); };
    f.appendChild(btn);
  }
  refreshIcons(root);
  return { root, close, body: b };
}

let menuEl = null;
export function closeMenu() { menuEl?.remove(); menuEl = null; }
export function openMenu(anchor, items) {
  closeMenu();
  menuEl = document.createElement('div');
  menuEl.className = 'menu menu-pop';
  menuEl.setAttribute('role', 'menu');
  for (const it of items) {
    if (it === '-') { menuEl.appendChild(document.createElement('hr')); continue; }
    if (it.header) { const h = document.createElement('div'); h.className = 'mhead'; h.textContent = it.header; menuEl.appendChild(h); continue; }
    const b = document.createElement('button');
    b.setAttribute('role', 'menuitem');
    if (it.danger) b.classList.add('danger');
    b.innerHTML = `${icon(it.icon || 'chevron-right')}<span>${esc(it.label)}</span>`;
    b.onclick = () => { closeMenu(); it.onClick?.(); };
    menuEl.appendChild(b);
  }
  document.body.appendChild(menuEl);
  const r = anchor.getBoundingClientRect();
  menuEl.style.top = Math.min(window.innerHeight - menuEl.offsetHeight - 8, r.bottom + 6) + 'px';
  menuEl.style.left = Math.max(8, Math.min(window.innerWidth - menuEl.offsetWidth - 8, r.right - menuEl.offsetWidth)) + 'px';
  refreshIcons(menuEl);
  const btns = [...menuEl.querySelectorAll('button')];
  btns[0]?.focus();
  menuEl.addEventListener('keydown', e => {
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
    if (e.key === 'Escape') closeMenu();
  });
  setTimeout(() => document.addEventListener('mousedown', function h(e) {
    if (!menuEl?.contains(e.target)) { closeMenu(); document.removeEventListener('mousedown', h); }
  }), 0);
}

export function openDrawer(title, node) {
  closeDrawer();
  const veil = document.createElement('div');
  veil.className = 'drawer-veil';
  const d = document.createElement('aside');
  d.className = 'drawer';
  d.setAttribute('role', 'dialog');
  d.innerHTML = `<div class="row" style="margin-bottom:12px"><h2 style="margin:0;flex:1">${esc(title)}</h2>
    <button class="icon-btn" aria-label="Close panel">${icon('x')}</button></div><div class="dbody"></div>`;
  d.querySelector('.dbody').appendChild(node);
  const close = () => { veil.remove(); d.remove(); };
  d.querySelector('.icon-btn').onclick = close;
  veil.onclick = close;
  document.body.append(veil, d);
  refreshIcons(d);
  return close;
}
export function closeDrawer() { document.querySelector('.drawer-veil')?.remove(); document.querySelector('.drawer')?.remove(); }

let tipEl = null;
export function tooltip(anchor, text) {
  const show = () => {
    hide();
    tipEl = document.createElement('div');
    tipEl.className = 'tip';
    tipEl.id = 'tooltip-root';
    tipEl.textContent = text;
    document.body.appendChild(tipEl);
    const r = anchor.getBoundingClientRect();
    tipEl.style.top = (r.bottom + 6) + 'px';
    tipEl.style.left = Math.max(8, r.left) + 'px';
  };
  const hide = () => { tipEl?.remove(); tipEl = null; };
  anchor.addEventListener('mouseenter', show);
  anchor.addEventListener('mouseleave', hide);
  anchor.addEventListener('focus', show);
  anchor.addEventListener('blur', hide);
}
