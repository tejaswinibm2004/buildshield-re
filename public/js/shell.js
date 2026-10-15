// Shell: topbar, sidebar, breadcrumbs, live chip, bell, theme, user menu.
import { html, esc } from './core/html.js';
import { icon, refreshIcons } from './core/icons.js';
import { store } from './core/store.js';
import { api } from './core/api.js';
import { navigate, current } from './core/router.js';
import { togglePalette } from './components/palette.js';
import { openMenu, toast } from './components/overlays.js';

const NAV = [
  { group: 'Work', items: [
    ['inbox', 'Inbox', 'inbox', '/inbox'],
    ['issues', 'Issues', 'bug', '/issues'],
    ['deployments', 'Deployments', 'rocket', '/deployments'],
  ]},
  { group: 'Sites', items: [
    ['websites', 'Websites', 'globe', '/websites'],
  ]},
  { group: 'Insight', items: [
    ['overview', 'Overview', 'activity', '/overview'],
    ['evaluation', 'Evaluation', 'flask-conical', '/eval'],
  ]},
  { group: 'Admin', items: [
    ['settings', 'Settings', 'settings', '/settings'],
    ['team', 'Team', 'users', '/team'],
    ['audit', 'Audit log', 'scroll-text', '/audit'],
  ]},
];
const ROLE_OK = { owner: 1, admin: 1, reviewer: ['inbox', 'issues', 'overview', 'websites'], viewer: ['overview', 'issues', 'websites'] };

export function roleAllows(key) {
  const r = store.me?.role;
  if (r === 'owner' || r === 'admin') return true;
  const list = ROLE_OK[r];
  return Array.isArray(list) ? list.includes(key) : false;
}

export function renderShell() {
  const { path } = current();
  const seg = path.split('/')[1] || 'overview';
  const side = document.getElementById('sidebar');
  side.innerHTML = `
    <a class="brand" href="#/overview" aria-label="BugShield home">
      <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="1.75"><path d="M16 3l9 3.4V14c0 5.6-3.8 9.9-9 12.6C10.8 23.9 7 19.6 7 14V6.4z"/><path d="M13.2 14.6l-2.3-2.3 1.4-1.4 1 1 4-4 1.4 1.4z" fill="currentColor" stroke="none"/></svg>
      <span class="brand-name"><b>Bug</b><span>Shield</span></span></a>
    <div id="site-slot"></div>
    ${NAV.map(g => {
      const items = g.items.filter(([k]) => roleAllows(k));
      if (!items.length) return '';
      return `<nav class="nav-group" aria-label="${g.group}"><div class="nav-label">${g.group}</div>` +
        items.map(([k, label, ic, href]) => `
          <a class="nav-item${seg === href.slice(1).split('/')[0] ? ' active' : ''}" ${seg === href.slice(1).split('/')[0] ? 'aria-current="page"' : ''} href="#${href}">
            ${icon(ic, 18)}<span class="lbl">${label}</span>
            <span class="count" data-count="${k}" hidden></span></a>`).join('') + '</nav>';
    }).join('')}
    <div class="nav-foot"><a class="health-mini" href="#/settings" id="health-mini"></a><div class="ver">BugShield v0.1.0</div></div>`;
  renderSiteSlot();
  refreshHealthMini();
  refreshIcons(side);

  const top = document.getElementById('topbar');
  const crumbs = breadcrumb(seg);
  top.innerHTML = `
    <button class="icon-btn" id="nav-collapse" aria-label="Menu">${icon('menu')}</button>
    <nav class="crumbs" aria-label="Breadcrumb">${crumbs}</nav>
    <span class="top-spacer"></span>
    <button class="search-trigger" id="search-btn">${icon('search')}<span>Search or jump to…</span><kbd>Ctrl K</kbd></button>
    <button class="live-chip off" id="live-chip" aria-label="Live updates status"><span class="dot mut"></span><span id="live-txt">Offline</span></button>
    <button class="icon-btn" id="bell-btn" aria-label="Notifications">${icon('bell')}<span class="nbadge" data-count="inbox" hidden></span></button>
    <button class="icon-btn" id="theme-cycle" aria-label="Change theme">${icon('moon')}</button>
    <button class="avatar" id="user-btn" aria-label="Account menu" aria-haspopup="menu"></button>`;
  top.querySelector('#search-btn').onclick = togglePalette;
  top.querySelector('#theme-cycle').onclick = cycleTheme;
  top.querySelector('#bell-btn').onclick = e => bellMenu(e.currentTarget);
  top.querySelector('#user-btn').onclick = e => userMenu(e.currentTarget, top.querySelector('#user-btn'));
  top.querySelector('#live-chip').onclick = () => navigate('#/settings');
  top.querySelector('#nav-collapse').onclick = () => document.getElementById('sidebar').classList.toggle('open');
  paintUser();
  refreshIcons(top);
  updateCounts();
  if (!document._wsPaint) { document.addEventListener('ws-state', paintLive); document._wsPaint = 1; }
  paintLive();
  renderMobileBar(seg);
}

function paintUser() {
  const me = store.me;
  if (!me) return;
  const av = document.getElementById('user-btn');
  av.textContent = (me.name || me.email).slice(0, 2).toUpperCase();
  av.style.background = 'var(--accent-soft)';
  av.style.color = 'var(--accent-text)';
}

function breadcrumb(seg) {
  const { path } = current();
  const parts = path.split('/').filter(Boolean);
  const names = { overview: 'Overview', inbox: 'Inbox', issues: 'Issues', deployments: 'Deployments', websites: 'Websites', settings: 'Settings', team: 'Team', audit: 'Audit log', eval: 'Evaluation' };
  let out = '';
  parts.forEach((p, i) => {
    const last = i === parts.length - 1;
    const label = names[p] || (/^[A-Z]+-/.test(p) ? p : names[p] || p);
    const href = '#' + '/' + parts.slice(0, i + 1).join('/');
    out += (i ? '<span class="sep">/</span>' : '') + (last ? `<span class="cur">${esc(label)}</span>` : `<a href="${href}">${esc(label)}</a>`);
  });
  return out || '<span class="cur">Overview</span>';
}

async function renderSiteSlot() {
  const slot = document.getElementById('site-slot');
  if (!slot) return;
  let sites = [];
  try { sites = (await api('/api/websites')).websites; } catch {}
  const cur = sites.find(w => String(w.id) === String(store.scopedSite));
  slot.innerHTML = `<button class="site-switch" id="site-sw" aria-haspopup="menu">${icon('globe')}
    <span class="nm">${cur ? esc(cur.name) : 'All websites'}</span>${icon('chevron-down', 14)}</button>`;
  slot.querySelector('#site-sw').onclick = e => {
    openMenu(e.currentTarget, [
      { label: 'All websites', icon: 'globe', onClick: () => { store.setScopedSite(null); renderSiteSlot(); } },
      '-',
      ...sites.map(w => ({ label: w.name, icon: 'globe', onClick: () => { store.setScopedSite(w.id); renderSiteSlot(); toast('Scoped to ' + w.name, { type: 'info', ms: 2000 }); } })),
      '-',
      { label: 'Connect a website +', icon: 'plus', onClick: () => navigate('#/websites?new=1') },
    ]);
  };
  refreshIcons(slot);
}

export async function updateCounts() {
  try {
    const s = await api('/api/stats/overview');
    const awaiting = Number((s.byStatus.find(x => x.status === 'AWAITING_APPROVAL') || { c: 0 }).c);
    const open = s.byStatus.filter(x => !['RESOLVED_AND_DEPLOYED', 'INVALID_REPORT', 'REJECTED_BY_ADMIN', 'ROLLED_BACK', 'FAILED'].includes(x.status)).reduce((a, x) => a + Number(x.c), 0);
    store.setCounts({ approvals: awaiting, open });
    document.querySelectorAll('[data-count="inbox"]').forEach(el => {
      el.hidden = !awaiting;
      el.textContent = awaiting;
      el.classList.toggle('amber', true);
    });
    document.querySelectorAll('[data-count="issues"]').forEach(el => { el.hidden = !open; el.textContent = open; });
    const bell = document.querySelector('#bell-btn .nbadge');
    if (bell) { bell.hidden = !awaiting; bell.textContent = awaiting; }
    const t = awaiting ? `(${awaiting}) Inbox - BugShield` : 'BugShield';
    if (document.title !== t) document.title = t;
  } catch { /* best effort */ }
}

async function refreshHealthMini() {
  const el = document.getElementById('health-mini');
  if (!el) return;
  try {
    const [s, integ] = await Promise.all([api('/api/stats/overview'), api('/api/settings/integrations-status')]);
    const ai = integ.ai?.configured, gh = !!s.health?.github;
    if (ai && gh) el.innerHTML = `<div class="row"><span class="dot ok"></span>All systems normal</div>`;
    else el.innerHTML = `<div class="row"><span class="dot ${ai ? 'ok' : 'bad'}"></span>AI</div><div class="row"><span class="dot ${gh ? 'ok' : 'bad'}"></span>GitHub</div>`;
  } catch { el.innerHTML = `<div class="row"><span class="dot mut"></span>Health unknown</div>`; }
}

function bellMenu(anchor) {
  api('/api/issues?status=AWAITING_APPROVAL&limit=5').then(j => {
    const items = j.issues.length ? j.issues.map(i => ({
      label: i.title.length > 40 ? i.title.slice(0, 40) + '…' : i.title, icon: 'alert-triangle',
      onClick: () => navigate('#/issues/' + i.id),
    })) : [{ label: 'Nothing needs you', icon: 'check', onClick: () => {} }];
    openMenu(anchor, [{ header: 'Needs your approval' }, ...items, '-', { label: 'Open Inbox', icon: 'inbox', onClick: () => navigate('#/inbox') }]);
  }).catch(() => toast('Could not load notifications', { type: 'bad' }));
}

function userMenu(anchor) {
  const me = store.me;
  openMenu(anchor, [
    { header: `${me.name || me.email} · ${me.role}` },
    { label: 'Change password', icon: 'key-round', onClick: () => navigate('#/settings?tab=team') },
    { label: 'Keyboard shortcuts', icon: 'command', onClick: () => shortcutsSheet() },
    '-',
    { label: 'Log out', icon: 'log-out', onClick: async () => {
      try { await api('/auth/logout', { method: 'POST' }); } catch {}
      store.me = null;
      const { disconnectWs } = await import('./core/ws.js');
      disconnectWs();
      location.hash = '#/login';
    }},
  ]);
}

export async function cycleTheme() {
  const order = ['dark', 'light', 'system'];
  const cur = localStorage.getItem('bs-theme') || 'dark';
  const next = order[(order.indexOf(cur) + 1) % order.length];
  const { setTheme } = await import('./core/store.js');
  setTheme(next);
  const names = { dark: 'moon', light: 'sun', system: 'monitor' };
  document.querySelectorAll('#theme-cycle').forEach(b => { b.innerHTML = `<i data-lucide="${names[next]}"></i>`; });
  const { refreshIcons } = await import('./core/icons.js');
  refreshIcons();
  toast('Theme: ' + next, { type: 'info', ms: 1500 });
}

export async function shortcutsSheet() {
  const rows = [['g then i', 'Issues'], ['g then o', 'Overview'], ['g then b', 'Inbox'], ['g then w', 'Websites'], ['/', 'Focus search'], ['Ctrl/⌘ K', 'Command palette'], ['j / k', 'Move between cards'], ['Enter', 'Open'], ['a', 'Approve (on card)'], ['r', 'Reject (opens confirm)'], ['t', 'Toggle theme'], ['?', 'This sheet'], ['Esc', 'Close']];
  const { openModal } = await import('./components/overlays.js');
  openModal({ title: 'Keyboard shortcuts', body: `<table class="tbl"><tbody>${rows.map(([k, v]) => `<tr><td><kbd>${k}</kbd></td><td>${v}</td></tr>`).join('')}</tbody></table>`, actions: [{ label: 'Done' }] });
}

function renderMobileBar(seg) {
  let bar = document.getElementById('mobilebar');
  if (!bar) {
    bar = document.createElement('nav');
    bar.id = 'mobilebar';
    bar.setAttribute('aria-label', 'Primary');
    document.body.appendChild(bar);
  }
  const items = [['inbox', 'Inbox', 'inbox'], ['issues', 'Issues', 'bug'], ['overview', 'Overview', 'activity'], ['websites', 'Sites', 'globe']];
  bar.innerHTML = items.map(([k, label, ic]) =>
    `<a href="#/${k === 'sites' ? 'websites' : k}" class="${seg === k || (k === 'sites' && seg === 'websites') ? 'active' : ''}">${icon(ic, 20)}${label}</a>`).join('') +
    `<a href="#/settings" class="${seg === 'settings' ? 'active' : ''}">${icon('more-horizontal', 20)}More</a>`;
  refreshIcons(bar);
}

export function paintLive() {  import('./core/ws.js').then(({ wsState }) => {
    const chip = document.getElementById('live-chip');
    if (!chip) return;
    const st = wsState();
    const txt = chip.querySelector('#live-txt');
    chip.classList.remove('on', 'retry');
    if (st === 'on') { chip.classList.add('on'); chip.querySelector('.dot').className = 'dot ok'; txt.textContent = 'Live'; }
    else if (st === 'retry') { chip.classList.add('retry'); chip.querySelector('.dot').className = 'dot warn'; txt.textContent = 'Reconnecting'; }
    else { chip.querySelector('.dot').className = 'dot mut'; txt.textContent = 'Offline'; }
  });
}
