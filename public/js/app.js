// App boot: routes, shell, shortcuts, session handling.
import { api, setSessionHandler } from './core/api.js';
import { register, route, navigate, current } from './core/router.js';
import { store } from './core/store.js';
import { refreshIcons } from './core/icons.js';
import { connectWs, disconnectWs, onEvent, typingNow, reconnectNow } from './core/ws.js';
import { renderShell, updateCounts, paintLive, shortcutsSheet } from './shell.js';
import { toast } from './components/overlays.js';
import { togglePalette } from './components/palette.js';
import { loginView } from './views/login.js';
import { inboxView } from './views/inbox.js';
import { overviewView } from './views/overview.js';
import { issuesView } from './views/issues.js';
import { issueView } from './views/issue.js';
import { deploymentsView } from './views/deployments.js';
import { websitesView } from './views/websites.js';
import { websiteView } from './views/website.js';
import { settingsView } from './views/settings.js';
import { teamView } from './views/team.js';
import { auditView } from './views/audit.js';
import { evalView } from './views/evaluation.js';

register('/login', async main => { loginView(main); });
register('/overview', overviewView);
register('/inbox', inboxView);
register('/issues', issuesView);
register('/issues/:id', (main, params, rp) => issueView(main, params, rp.id));
register('/deployments', deploymentsView);
register('/websites', websitesView);
register('/websites/:id', (main, params, rp) => websiteView(main, params, rp.id));
register('/settings', settingsView);
register('/team', teamView);
register('/audit', auditView);
register('/eval', evalView);

function guard(path) {
  const seg = path.split('/')[1];
  const role = store.me?.role;
  if (role === 'owner' || role === 'admin') return true;
  if (seg === 'audit') return role === 'reviewer'; // reviewers may read audit
  return !['settings', 'team', 'audit'].includes(seg); // viewers/reviewers keep the rest
}

async function boot() {
  setSessionHandler(() => {
    const had = !!store.me;
    store.me = null;
    disconnectWs();
    if (!had) { location.hash = '#/login'; route(); return; } // never logged in: no drama
    sessionStorage.setItem('bs-return', location.hash);
    import('./components/overlays.js').then(({ openModal }) => {
      openModal({ title: 'Session expired', body: 'Log in again to continue. Unsent text in forms is preserved.', actions: [{ label: 'Log in again', onClick: close => { close(); location.hash = '#/login'; } }] });
    });
    location.hash = '#/login';
    route();
  });
  try { store.me = (await api('/auth/me')).user; }
  catch { store.me = null; }
  if (!store.me) {
    location.hash = '#/login';
    await loginView(document.getElementById('main') || document.body);
    document.getElementById('app-shell').hidden = true;
  } else {
    document.getElementById('app-shell').hidden = false;
    renderShell();
    connectWs();
    if (!location.hash || location.hash === '#/') {
      try {
        const s = await api('/api/stats/overview');
        const awaiting = Number((s.byStatus.find(x => x.status === 'AWAITING_APPROVAL') || { c: 0 }).c);
        location.hash = awaiting ? '#/inbox' : '#/overview';
      } catch { location.hash = '#/overview'; }
    }
    await route();
    updateCounts();
  }
  window.addEventListener('hashchange', onHash);
  document.addEventListener('keydown', keys);
  document.addEventListener('ws-state', paintLive);
  onEvent(onWsEvent);
  refreshIcons();
}

async function onHash() {
  const { path } = current();
  if (path === '/login' && !store.me) {
    document.getElementById('app-shell').hidden = true;
    await loginView(document.getElementById('login-root').parentElement || document.body);
    return;
  }
  if (!store.me) { location.hash = '#/login'; return; }
  document.getElementById('app-shell').hidden = false;
  if (!guard(path)) {
    document.getElementById('main').innerHTML = `<div class="page"><div class="card"><div class="empty">
      <span class="eic"><i data-lucide="lock"></i></span><h3>Your role can't see this</h3>
      <p>You are signed in as <b>${store.me.role}</b>. Ask an owner or admin for access.</p>
      <a class="btn ghost" href="#/overview">Back to Overview</a></div></div></div>`;
    refreshIcons();
    return;
  }
  renderShell();
  await route();
  updateCounts();
}

function onWsEvent(m) {
  if (typingNow()) { updateCounts(); return; }
  if (m.type === 'APPROVAL_NEEDED') toast(`Approval needed: ${m.issueId}`, { type: 'warn', ms: 8000, action: { label: 'Open Inbox', onClick: () => navigate('#/inbox') } });
  const { path } = current();
  if (['/inbox', '/overview', '/deployments'].includes(path)) route();
  else if (path.startsWith('/issues/')) route();
  updateCounts();
}

let gPending = false;
function keys(e) {
  const tag = document.activeElement?.tagName;
  const typing = tag && /INPUT|TEXTAREA|SELECT/.test(tag);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); togglePalette(); return; }
  if (e.key === '?' && !typing) { e.preventDefault(); shortcutsSheet(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') {
    e.preventDefault();
    const f = document.querySelector('#f-q, #a-q');
    if (f) f.focus();
    else togglePalette();
    return;
  }
  if (e.key === 't') { document.getElementById('theme-cycle')?.click(); return; }
  if (e.key === 'g') { gPending = true; setTimeout(() => (gPending = false), 800); return; }
  if (gPending) {
    gPending = false;
    const map = { i: '#/issues', o: '#/overview', b: '#/inbox', w: '#/websites' };
    if (map[e.key]) { e.preventDefault(); navigate(map[e.key]); }
  }
  if (e.key === 'Escape') { import('./components/overlays.js').then(({ closeMenu, closeDrawer }) => { closeMenu(); closeDrawer(); }); }
}

boot();
