/* BugShield dashboard SPA — vanilla JS, no build step. Talks only to the JSON API. */
'use strict';
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'bugshield' };
let me = null;
let cleanup = null; // per-route cleanup (polling timers)
let wsState = 'off';

/* ---------------- utils ---------------- */
const $ = (sel, root = document) => root.querySelector(sel);
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function shortId(id) { return esc(id); }
async function api(path, opts = {}) {
  const r = await fetch(path, { credentials: 'same-origin', headers: H, ...opts });
  if (r.status === 401 && !location.hash.startsWith('#/login')) { me = null; location.hash = '#/login'; route(); throw new Error('Session expired — please log in again.'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || ('Request failed (HTTP ' + r.status + ')'));
  return j;
}
function toast(msg, type = 'info', ms = 4200) {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, ms);
}
function confirmDialog({ title, body, okLabel = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-veil"><div class="modal" role="dialog" aria-modal="true">
      <h3>${esc(title)}</h3><p>${body}</p>
      <div class="row"><button class="btn ${danger ? 'danger' : ''}" id="cf-ok">${esc(okLabel)}</button>
      <button class="btn ghost" id="cf-no">Cancel</button></div></div></div>`;
    const done = v => { root.innerHTML = ''; resolve(v); };
    $('#cf-ok').onclick = () => done(true);
    $('#cf-no').onclick = () => done(false);
  });
}
function copyText(t, label = 'Copied to clipboard') {
  const done = () => toast(label, 'ok', 2500);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(t).then(done).catch(() => fallback());
  else fallback();
  function fallback() { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch { toast('Copy failed — select manually', 'bad'); } ta.remove(); }
}
function timeAgo(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 86400 * 7) return Math.floor(s / 86400) + 'd ago';
  return new Date(iso).toLocaleDateString();
}
function fmtDT(iso) { const d = new Date(iso); return Number.isNaN(d) ? '—' : d.toLocaleString(); }
function fmtTime(iso) { return `<span title="${esc(fmtDT(iso))}">${esc(timeAgo(iso))}</span>`; }
function skeleton(n = 3) { return Array.from({ length: n }, () => '<div class="skel"></div>').join(''); }
function emptyState(icon, title, sub) {
  return `<div class="empty"><span class="big">${icon}</span><b>${esc(title)}</b><p class="muted">${esc(sub)}</p></div>`;
}

/* ---------------- status meta (every pipeline state) ---------------- */
const STATUS = {
  RECEIVED: ['Received', 'info', 0], DEDUPLICATED: ['Duplicate', 'mut', 0],
  TRIAGING: ['Locating code', 'info', 1], ANALYZING: ['Analyzing', 'info', 1],
  INVALID_REPORT: ['Not a bug', 'mut', 0], NOT_REPRODUCIBLE_IN_CODE: ['Not found in code', 'mut', 0],
  SOURCE_UNAVAILABLE: ['Repo unavailable', 'warn', 0], AI_UNAVAILABLE: ['AI unavailable', 'warn', 0],
  PATCHING: ['Patching', 'info', 1], PATCH_FAILED: ['Patch failed', 'bad', 0],
  VALIDATING: ['Validating', 'info', 1], VALIDATION_FAILED: ['Validation failed', 'bad', 0],
  AWAITING_APPROVAL: ['Needs approval', 'warn', 1], REJECTED_BY_ADMIN: ['Rejected', 'mut', 0],
  APPROVED: ['Approved', 'ok', 0], PUSHING: ['Committing', 'info', 1],
  DEPLOYING: ['Deploying', 'info', 1], RESOLVED_AND_DEPLOYED: ['Live', 'ok', 0],
  DEPLOY_TIMEOUT: ['Deploy timeout', 'warn', 0], ROLLED_BACK: ['Rolled back', 'warn', 0],
  FAILED: ['Failed', 'bad', 0],
};
const TERMINAL = new Set(['RESOLVED_AND_DEPLOYED', 'INVALID_REPORT', 'REJECTED_BY_ADMIN', 'ROLLED_BACK', 'FAILED', 'PATCH_FAILED', 'VALIDATION_FAILED', 'DEPLOY_TIMEOUT', 'NOT_REPRODUCIBLE_IN_CODE', 'SOURCE_UNAVAILABLE', 'AI_UNAVAILABLE']);
function pill(status) {
  const [label, tone, blink] = STATUS[status] ?? [status, 'mut', 0];
  return `<span class="pill tone-${tone}${blink ? ' blink' : ''}">${esc(label)}</span>`;
}
function stepClass(s) {
  s = String(s).toLowerCase();
  if (/ok|pass|approve|done|live|received|resolved/.test(s)) return 's-ok';
  if (/fail|reject|invalid|error|timeout/.test(s)) return 's-bad';
  if (/pause|wait|concern|unverified|warn|skip|empty/.test(s)) return 's-warn';
  return 's-info';
}

/* ---------------- shell / nav ---------------- */
const ROUTES = [
  ['overview', 'Overview'], ['websites', 'Websites'], ['issues', 'Issues'],
  ['settings', 'Settings'], ['audit', 'Audit log'], ['eval', 'Evaluation'],
];
let badgeCounts = {};
function renderShell() {
  $('#shell').hidden = false;
  $('#login-root').innerHTML = '';
  $('#me-chip').textContent = me ? `${me.email} · ${me.role}` : '';
  const cur = (location.hash || '#/overview').split('/')[1] || 'overview';
  $('#nav').innerHTML = ROUTES.map(([k, label]) => {
    const badge = badgeCounts[k] ? `<span class="count">${badgeCounts[k]}</span>` : '';
    return `<a href="#/${k}" class="${cur === k ? 'on' : ''}"><span>${label}</span>${badge}</a>`;
  }).join('');
}
async function refreshBadges() {
  if (!me) return;
  try {
    const s = await api('/api/stats/overview');
    const awaiting = (s.byStatus.find(x => x.status === 'AWAITING_APPROVAL') || { c: 0 }).c;
    badgeCounts = awaiting ? { issues: awaiting } : {};
    if (me) renderShell();
  } catch { /* badges are best-effort */ }
}

/* ---------------- boot / routing ---------------- */
async function boot() {
  applyTheme(localStorage.getItem('bs-theme') || 'dark', true);
  $('#theme-btn').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next); toast(`Theme: ${next} mode`, 'info', 2000);
  };
  $('#logout-btn').onclick = async () => { try { await api('/auth/logout', { method: 'POST' }); } catch {} try { if (sock) sock.close(); } catch {} me = null; setLive('off', 'offline'); location.hash = '#/login'; route(); };
  window.addEventListener('hashchange', route);
  try { me = (await api('/auth/me')).user; } catch { me = null; }
  connectWs();
  await route();
  refreshBadges();
}
function applyTheme(t, silent) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem('bs-theme', t);
  if (!silent) $('#theme-btn').textContent = t === 'dark' ? 'Theme' : 'Theme';
}
async function route() {
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  if (!me) {
    try { me = (await api('/auth/me')).user; } catch { return loginView(); }
  }
  renderShell();
  if (me && wsState === 'off') connectWs();
  const h = location.hash || '#/overview';
  const app = $('#app');
  app.innerHTML = skeleton(4);
  try {
    if (h.startsWith('#/issues/')) return issueDetail(h.split('/')[2]);
    if (h.startsWith('#/websites/')) return websiteDetail(h.split('/')[2]);
    if (h.includes('websites')) return websitesView();
    if (h.includes('issues')) return issuesView();
    if (h.includes('settings')) return settingsView();
    if (h.includes('audit')) return auditView();
    if (h.includes('eval')) return evalView();
    return overviewView();
  } catch (e) {
    app.innerHTML = `<div class="card">${emptyState('!', 'Could not load this page', e.message)}</div>`;
  }
}

/* ---------------- login ---------------- */
function loginView() {
  $('#shell').hidden = true;
  $('#login-root').innerHTML = `<div class="login-wrap"><form class="login-card" id="lf">
    <h1>BugShield</h1><p class="muted">Sign in to the dashboard.</p>
    <div class="grid-form" style="grid-template-columns:1fr">
      <label class="f">Email<input id="le" type="email" autocomplete="username" required></label>
      <label class="f">Password
        <span class="pw-wrap"><input id="lp" type="password" autocomplete="current-password" required minlength="1">
        <button type="button" class="icon-btn" id="pw-show" title="Show password">Show</button></span>
      </label>
    </div>
    <div class="field-err" id="le-err"></div>
    <button class="btn" type="submit" style="width:100%">Log in</button>
    <p class="muted small">First run: the owner account comes from <span class="mono">BOOTSTRAP_OWNER_EMAIL/PASSWORD</span>.</p>
  </form></div>`;
  $('#pw-show').onclick = () => { const p = $('#lp'); p.type = p.type === 'password' ? 'text' : 'password'; };
  $('#lf').onsubmit = async e => {
    e.preventDefault();
    $('#le-err').textContent = '';
    try {
      const r = await fetch('/auth/login', { method: 'POST', headers: H, credentials: 'same-origin', body: JSON.stringify({ email: $('#le').value, password: $('#lp').value }) });
      const j = await r.json();
      if (!j.success) throw new Error(j.error?.message || 'Login failed');
      me = j.user; connectWs(); location.hash = '#/overview'; route(); refreshBadges();
    } catch (err) { $('#le-err').textContent = err.message; }
  };
}

/* ---------------- overview ---------------- */
async function overviewView() {
  const [s, integ] = await Promise.all([
    api('/api/stats/overview'),
    api('/api/settings/integrations-status').catch(() => null),
  ]);
  const byStatus = s.byStatus || [];
  const total = byStatus.reduce((a, x) => a + Number(x.c), 0);
  const open = byStatus.filter(x => !TERMINAL.has(x.status)).reduce((a, x) => a + Number(x.c), 0);
  const live = (byStatus.find(x => x.status === 'RESOLVED_AND_DEPLOYED') || { c: 0 }).c;
  const max = Math.max(1, ...byStatus.map(x => Number(x.c)));
  let hist = '';
  try {
    const iss = await api('/api/issues?limit=100');
    const days = Array(14).fill(0);
    for (const is of iss.issues) {
      const d = Math.floor((Date.now() - new Date(is.created_at).getTime()) / 86400000);
      if (d >= 0 && d < 14) days[13 - d]++;
    }
    const m = Math.max(1, ...days);
    hist = `<div class="hist" title="Issues per day, last 14 days">${days.map(v => `<div style="height:${Math.max(4, Math.round(v / m * 100))}%" title="${v}"></div>`).join('')}</div>
      <p class="muted small">Issues per day · last 14 days</p>`;
  } catch { hist = ''; }
  const ai = integ?.ai ?? s.health?.ai;
  $('#app').innerHTML = `
    <h2>Overview</h2>
    <div class="stat-cards">
      <div class="stat"><div class="n">${open}</div><div class="l">Open issues</div></div>
      <div class="stat"><div class="n">${live}</div><div class="l">Fixed &amp; live</div></div>
      <div class="stat"><div class="n">${total}</div><div class="l">Total reports</div></div>
      <div class="stat"><div class="n">${(s.lastDeploy || []).length ? fmtTime(s.lastDeploy[0].created_at) : '—'}</div><div class="l">Last deploy</div></div>
    </div>
    <div class="grid2">
      <div class="card"><h3>Issues by status</h3>
        ${byStatus.length ? `<div class="dist">${byStatus.map(x => `
          <div class="drow"><span>${pill(x.status)}</span><span class="track"><i style="width:${Math.round(Number(x.c) / max * 100)}%"></i></span><b>${x.c}</b></div>`).join('')}</div>`
        : emptyState('Inbox', 'No issues yet', 'Reports from your site widgets will appear here.')}
        ${hist}
      </div>
      <div class="card"><h3>System health</h3>
        <div class="kv">
          <div><dt>AI</dt><dd>${ai?.configured ? `Configured · <span class="mono">${esc(ai.model || '')}</span>` : `<span class="pill tone-warn">AI unavailable</span> ${esc(ai?.reason || 'set AI_API_KEY')}`}</dd></div>
          <div><dt>GitHub</dt><dd>${s.health?.github ? '<span class="pill tone-ok">Token set</span>' : '<span class="pill tone-warn">Not configured</span>'}</dd></div>
        </div>
        ${!ai?.configured ? '<div class="callout warn">Issues will park at <b>AI_UNAVAILABLE</b> until an AI key is set. Nothing breaks — the pipeline waits honestly.</div>' : ''}
        ${!s.health?.github ? '<div class="callout warn">No GitHub token — repos cannot be read and fixes cannot ship.</div>' : ''}
        <h3 class="mt">Recent deployments</h3>
        ${(s.lastDeploy || []).length ? `<table class="tbl"><tr><th>Issue</th><th>Commit</th><th>Status</th><th>When</th></tr>
          ${s.lastDeploy.map(d => `<tr><td><a href="#/issues/${esc(d.issue_id)}">${esc(d.issue_id)}</a></td>
          <td>${d.commit_url ? `<a href="${esc(d.commit_url)}" target="_blank" rel="noopener">${esc((d.commit_sha || '').slice(0, 7))}</a>` : esc((d.commit_sha || '').slice(0, 7))}</td>
          <td>${pill(d.status === 'live' ? 'RESOLVED_AND_DEPLOYED' : d.status === 'reverted' ? 'ROLLED_BACK' : d.status === 'timeout' ? 'DEPLOY_TIMEOUT' : 'DEPLOYING')}</td>
          <td>${fmtTime(d.created_at)}</td></tr>`).join('')}</table>`
        : '<p class="muted">No deployments yet.</p>'}
      </div>
    </div>`;
  try { $('#health-foot').textContent = `API ok · AI ${ai?.configured ? 'configured' : 'unavailable'} · GitHub ${s.health?.github ? 'set' : 'missing'}`; } catch {}
}

/* ---------------- websites ---------------- */
async function websitesView() {
  const w = await api('/api/websites');
  $('#app').innerHTML = `
    <h2>Websites</h2>
    <div class="card"><h3>Connect a website</h3>
      <form id="wf"><div class="grid-form">
        <label class="f">Name<input id="wn" required placeholder="My shop"></label>
        <label class="f">GitHub repo URL<input id="wr" placeholder="https://github.com/owner/repo"></label>
        <label class="f">Branch<input id="wb" value="main"></label>
        <label class="f">Site URL<span class="hint">Public address of the site</span><input id="ws" placeholder="https://site.onrender.com"></label>
        <label class="f">Health URL<span class="hint">Optional probe target</span><input id="wh" placeholder="https://site.onrender.com/"></label>
        <label class="f">Subfolder<span class="hint">If the site lives in a repo subfolder</span><input id="wroot" placeholder="packages/web"></label>
      </div>
      <div class="row mt"><button class="btn" type="submit">Connect website</button></div>
      <div class="field-err" id="w-err"></div></form>
    </div>
    <div class="card"><h3>Connected (${w.websites.length})</h3>
      ${w.websites.length ? `<table class="tbl"><tr><th>Name</th><th>Repo</th><th>Site</th><th></th></tr>
        ${w.websites.map(x => `<tr><td><b>${esc(x.name)}</b></td>
          <td class="mono">${esc(x.repo_owner)}/${esc(x.repo_name)}@${esc(x.branch)}</td>
          <td>${x.site_url ? `<a href="${esc(x.site_url)}" target="_blank" rel="noopener">${esc(x.site_url)}</a>` : '<span class="muted">—</span>'}</td>
          <td><a class="btn ghost sm" href="#/websites/${x.id}">Manage</a></td></tr>`).join('')}</table>`
      : emptyState('Globe', 'No websites connected', 'Connect your first site above to get a widget snippet and ingestion key.')}
    </div>`;
  $('#wf').onsubmit = async e => {
    e.preventDefault(); $('#w-err').textContent = '';
    try {
      const j = await api('/api/websites', { method: 'POST', body: JSON.stringify({
        name: $('#wn').value, repo_url: $('#wr').value, branch: $('#wb').value || 'main',
        site_url: $('#ws').value, health_url: $('#wh').value, root_path: $('#wroot').value }) });
      showKeyModal(j.ingestionKey);
      toast('Website connected', 'ok'); websitesView(); refreshBadges();
    } catch (err) { $('#w-err').textContent = err.message; }
  };
}
function showKeyModal(key) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-veil"><div class="modal" role="dialog" aria-modal="true">
    <h3>Ingestion key — shown once</h3>
    <p class="muted small">Store it now. It lives in the client site's env; protection is the origin allow-list + rate limits, not secrecy.</p>
    <pre class="code" id="key-pre">${esc(key)}</pre>
    <div class="row"><button class="btn" id="key-copy">Copy key</button><button class="btn ghost" id="key-close">Done</button></div></div></div>`;
  $('#key-copy').onclick = () => copyText(key, 'Key copied — store it now');
  $('#key-close').onclick = () => { root.innerHTML = ''; };
}
async function websiteDetail(id) {
  const d = await api('/api/websites/' + id);
  const w = d.website;
  const snippet = `<div id="bugshield-widget"></div>\n<script src="${location.origin}/sdk/bugshield.js"\n  data-app-id="${w.id}" data-key="bsk_PASTE_KEY_HERE"><\/script>`;
  $('#app').innerHTML = `
    <p><a href="#/websites">← Websites</a></p><h2>${esc(w.name)}</h2>
    <div class="grid2">
      <div class="card"><h3>Widget snippet</h3>
        <p class="muted small">Paste into the client site (or wire <span class="mono">BUGSHIELD_HOST / APP_ID / INGESTION_KEY</span> into its build). The key below is a placeholder — use a real key from below.</p>
        <div class="snippet"><pre class="code" id="snip">${esc(snippet)}</pre><button class="btn ghost sm copy-btn" id="snip-copy">Copy</button></div>
        <h3 class="mt">Connection tests</h3><div id="test-out"><button class="btn ghost sm" id="test-btn">Run tests</button></div>
      </div>
      <div class="card"><h3>Settings</h3>
        <form id="ef"><div class="grid-form">
          <label class="f">Name<input id="ew-name" value="${esc(w.name)}"></label>
          <label class="f">Repo URL<input id="ew-repo" value="${esc(w.repo_url)}"></label>
          <label class="f">Branch<input id="ew-branch" value="${esc(w.branch)}"></label>
          <label class="f">Subfolder<input id="ew-root" value="${esc(w.root_path || '')}"></label>
          <label class="f">Site URL<input id="ew-site" value="${esc(w.site_url || '')}"></label>
          <label class="f">Health URL<input id="ew-health" value="${esc(w.health_url || '')}"></label>
          <label class="f">Version path<input id="ew-ver" value="${esc(w.version_path || '/version.json')}"></label>
        </div>
        <label class="check mt"><input type="checkbox" id="ew-always" ${w.always_require_approval ? 'checked' : ''}>
          <span>Always require human approval for this site<span class="hint"><br>Even non-critical fixes pause. Security-sensitive changes always pause regardless.</span></span></label>
        <div class="row mt"><button class="btn" type="submit">Save</button></div></form>
      </div>
    </div>
    <div class="card"><h3>Ingestion keys (${d.keys.length})</h3>
      <div class="row"><button class="btn ghost sm" id="new-key">New key</button></div>
      <div id="keys-tbl">${keysTable(d.keys)}</div>
    </div>`;
  $('#snip-copy').onclick = () => copyText(snippet, 'Snippet copied');
  $('#test-btn').onclick = async e => {
    e.target.disabled = true; e.target.textContent = 'Testing…';
    try {
      const t = await api(`/api/websites/${id}/test`, { method: 'POST' });
      const card = (label, v) => {
        const ok = /working|configured/.test(v);
        return `<div class="kv"><div><dt>${label}</dt><dd>${ok ? '<span class="pill tone-ok">Working</span>' : `<span class="pill tone-bad">Error</span> <span class="mono small">${esc(v)}</span>`}</dd></div></div>`;
      };
      $('#test-out').innerHTML = card('GitHub', t.tests.github) + card('Site', t.tests.site) + card('AI', t.tests.ai);
    } catch (err) { toast(err.message, 'bad'); e.target.disabled = false; e.target.textContent = 'Run tests'; }
  };
  $('#ef').onsubmit = async e => {
    e.preventDefault();
    try {
      await api(`/api/websites/${id}`, { method: 'PATCH', body: JSON.stringify({
        name: $('#ew-name').value, repo_url: $('#ew-repo').value, branch: $('#ew-branch').value,
        root_path: $('#ew-root').value, site_url: $('#ew-site').value, health_url: $('#ew-health').value,
        version_path: $('#ew-ver').value, always_require_approval: $('#ew-always').checked ? 1 : 0 }) });
      toast('Website saved', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  };
  $('#new-key').onclick = () => keyForm(id);
  $('#keys-tbl').querySelectorAll('[data-revoke]').forEach(b => b.onclick = async () => {
    if (!await confirmDialog({ title: 'Revoke this key?', body: 'Sites using it stop reporting immediately. This cannot be undone.', okLabel: 'Revoke key', danger: true })) return;
    try { await api(`/api/websites/${id}/keys/${b.dataset.revoke}`, { method: 'DELETE' }); toast('Key revoked', 'ok'); websiteDetail(id); }
    catch (err) { toast(err.message, 'bad'); }
  });
}
function keysTable(keys) {
  if (!keys.length) return emptyState('Key', 'No keys', 'Create one to start receiving reports.');
  return `<table class="tbl"><tr><th>Label</th><th>Created</th><th>Last used</th><th>Status</th><th></th></tr>
    ${keys.map(k => `<tr><td><b>${esc(k.label)}</b> <span class="muted">#${k.id}</span></td>
      <td>${fmtTime(k.created_at)}</td><td>${k.last_used_at ? fmtTime(k.last_used_at) : '<span class="muted">never</span>'}</td>
      <td>${k.revoked_at ? '<span class="pill tone-mut">Revoked</span>' : '<span class="pill tone-ok">Active</span>'}</td>
      <td>${k.revoked_at ? '' : `<button class="btn ghost sm" data-revoke="${k.id}">Revoke</button>`}</td></tr>`).join('')}</table>`;
}
function keyForm(siteId) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-veil"><div class="modal" role="dialog" aria-modal="true">
    <h3>New ingestion key</h3>
    <form id="kf"><div class="grid-form" style="grid-template-columns:1fr">
      <label class="f">Label<input id="kf-label" value="key" required></label>
      <label class="f">Allowed origins<span class="hint">One per line, e.g. https://site.onrender.com. Empty = accept any origin (report-only key).</span>
      <textarea id="kf-origins" rows="3" placeholder="https://…"></textarea></label>
    </div>
    <div class="row mt"><button class="btn" type="submit">Create key</button><button class="btn ghost" type="button" id="kf-x">Cancel</button></div></form></div></div>`;
  $('#kf-x').onclick = () => { root.innerHTML = ''; };
  $('#kf').onsubmit = async e => {
    e.preventDefault();
    const origins = $('#kf-origins').value.split('\n').map(s => s.trim()).filter(Boolean);
    try {
      const j = await api(`/api/websites/${siteId}/keys`, { method: 'POST', body: JSON.stringify({ label: $('#kf-label').value, allowed_origins: origins }) });
      root.innerHTML = '';
      showKeyModal(j.ingestionKey);
      websiteDetail(siteId);
    } catch (err) { toast(err.message, 'bad'); }
  };
}

/* ---------------- issues ---------------- */
let issueFilter = { status: '', site: '', q: '', cursor: null, done: false, items: [] };
async function issuesView() {
  const [sites] = await Promise.all([api('/api/websites').catch(() => ({ websites: [] }))]);
  issueFilter.items = []; issueFilter.cursor = null; issueFilter.done = false;
  const statuses = Object.keys(STATUS);
  $('#app').innerHTML = `
    <h2>Issues</h2>
    <div class="card"><div class="toolbar">
      <label class="f">Status<select id="f-status"><option value="">All statuses</option>${statuses.map(s => `<option ${issueFilter.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="f">Site<select id="f-site"><option value="">All sites</option>${sites.websites.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select></label>
      <label class="f" style="flex:2">Search<input id="f-q" placeholder="Title or description…" value="${esc(issueFilter.q)}"></label>
    </div>
    <div id="issue-list"></div>
    <div class="center mt"><button class="btn ghost" id="more" hidden>Load more</button></div></div>`;
  const load = async (reset) => {
    if (reset) { issueFilter.cursor = null; issueFilter.done = false; issueFilter.items = []; }
    const p = new URLSearchParams({ limit: '30' });
    if (issueFilter.status) p.set('status', issueFilter.status);
    if (issueFilter.site) p.set('site', issueFilter.site);
    if (issueFilter.q) p.set('q', issueFilter.q);
    if (issueFilter.cursor) p.set('cursor', issueFilter.cursor);
    $('#issue-list').innerHTML = issueFilter.items.length ? issueTable(issueFilter.items) : skeleton(3);
    try {
      const j = await api('/api/issues?' + p);
      issueFilter.items = issueFilter.items.concat(j.issues);
      issueFilter.cursor = j.nextCursor; issueFilter.done = !j.nextCursor;
      $('#issue-list').innerHTML = issueFilter.items.length ? issueTable(issueFilter.items) : emptyState('Inbox', 'No issues match', 'Try clearing the filters.');
      $('#more').hidden = issueFilter.done;
    } catch (e) { $('#issue-list').innerHTML = `<div class="callout bad">${esc(e.message)}</div>`; }
  };
  $('#f-status').onchange = e => { issueFilter.status = e.target.value; load(true); };
  $('#f-site').onchange = e => { issueFilter.site = e.target.value; load(true); };
  let deb = null;
  $('#f-q').oninput = e => { clearTimeout(deb); deb = setTimeout(() => { issueFilter.q = e.target.value; load(true); }, 350); };
  $('#more').onclick = () => load(false);
  await load(true);
}
function issueTable(items) {
  return `<table class="tbl"><tr><th>ID</th><th>Title</th><th>Status</th><th>Site</th><th>Reports</th><th>Updated</th></tr>
    ${items.map(i => `<tr><td class="mono"><a href="#/issues/${i.id}">${shortId(i.id)}</a></td>
      <td>${esc(i.title)}</td><td>${pill(i.status)}</td><td>${i.website_id ?? '—'}</td>
      <td>${i.occurrences > 1 ? `<b>${i.occurrences}×</b>` : '1'}</td><td>${fmtTime(i.updated_at)}</td></tr>`).join('')}</table>`;
}
function parseDiff(diff) {
  const rows = [];
  let o = 0, n = 0;
  for (const line of String(diff || '').split('\n')) {
    if (line.startsWith('---') || line.startsWith('+++')) continue;
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (h) { o = +h[1]; n = +h[2]; rows.push({ t: 'hunk', text: line }); continue; }
    if (line.startsWith('\\')) { rows.push({ t: 'note', text: line }); continue; }
    const c = line[0];
    if (c === '+') { rows.push({ t: 'add', o: '', n: n++, text: line.slice(1) }); }
    else if (c === '-') { rows.push({ t: 'del', o: o++, n: '', text: line.slice(1) }); }
    else { rows.push({ t: 'ctx', o: o++, n: n++, text: line.slice(1) }); }
  }
  return rows;
}
function diffHtml(diff) {
  const rows = parseDiff(diff);
  if (!rows.length) return '<p class="muted">No diff.</p>';
  return `<div class="diff"><table>${rows.map(r => {
    if (r.t === 'hunk') return `<tr class="hunk"><td class="ln">…</td><td class="ln">…</td><td>${esc(r.text)}</td></tr>`;
    if (r.t === 'note') return `<tr><td class="ln"></td><td class="ln"></td><td class="muted">${esc(r.text)}</td></tr>`;
    return `<tr class="${r.t}"><td class="ln">${r.o}</td><td class="ln">${r.n}</td><td>${esc(r.text) || ' '}</td></tr>`;
  }).join('')}</table></div>`;
}
function prettyDetails(d) {
  if (d == null) return '<span class="muted">—</span>';
  let o = d;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return esc(o); } }
  return `<pre class="code">${esc(JSON.stringify(o, null, 2))}</pre>`;
}
async function issueDetail(id) {
  const d = await api('/api/issues/' + id);
  const { issue, steps, patches, validations, approvals, deployments } = d;
  const kase = d.kase || {};
  const p = patches[0];
  const risk = kase.risk || { score: p?.risk_score ?? 0, factors: p ? JSON.parse(p.risk_factors || '[]') : [] };
  const critic = p ? JSON.parse(p.critic || '{}') : {};
  const maxF = Math.max(1, ...(risk.factors || []).map(f => Math.abs(f.points || 0)));
  const live = TERMINAL.has(issue.status);
  $('#app').innerHTML = `
    <p><a href="#/issues">← Issues</a></p>
    <div class="row"><h2 style="margin:0">${esc(issue.title)}</h2>${pill(issue.status)}</div>
    <p class="muted small mono">${shortId(issue.id)} · reported ${fmtTime(issue.created_at)} · updated ${fmtTime(issue.updated_at)}
      ${issue.occurrences > 1 ? ` · <b>${issue.occurrences} duplicate reports merged</b>` : ''}</p>
    ${issue.status_reason ? `<div class="callout ${issue.status === 'AWAITING_APPROVAL' ? 'warn' : ''}">${esc(issue.status_reason)}</div>` : ''}
    ${issue.status === 'AWAITING_APPROVAL' ? '<div class="callout warn"><b>Human decision needed.</b> Review the diff, risk breakdown and evidence below, then approve or reject. The pipeline is paused — nothing will ship without you.</div>' : ''}
    ${!live ? '<div class="callout">Pipeline running — this page refreshes automatically.</div>' : ''}
    <div class="grid2">
      <div class="card"><h3>Report</h3>
        <p>${esc(issue.description) || '<span class="muted">—</span>'}</p>
        ${issue.steps ? `<p><b>Steps to reproduce</b><br>${esc(issue.steps)}</p>` : ''}
        <dl class="kv">
          <div><dt>Page</dt><dd>${issue.page_url ? `<a href="${esc(issue.page_url)}" target="_blank" rel="noopener">${esc(issue.page_url)}</a>` : '—'}</dd></div>
          <div><dt>Site</dt><dd>${issue.website_id ? `<a href="#/websites/${issue.website_id}">#${issue.website_id}</a>` : '—'}</dd></div>
        </dl></div>
      <div class="card"><h3>Timeline</h3><div class="timeline">
        ${steps.length ? steps.map(s => `<div class="step ${stepClass(s.status)}"><span class="sn">${esc(s.name)}</span> — ${esc(s.status)}
          ${s.summary ? `<div class="ss">${esc(s.summary)}</div>` : ''}</div>`).join('') : '<p class="muted">No steps yet.</p>'}
      </div></div>
    </div>
    ${kase.analysis ? `<div class="card"><h3>AI analysis</h3><dl class="kv">
      <div><dt>Verdict</dt><dd>${kase.analysis.is_defect ? '<span class="pill tone-ok">Real defect</span>' : '<span class="pill tone-mut">Not a defect</span>'} <span class="muted">confidence ${esc(Math.round((kase.analysis.confidence ?? 0) * 100))}%</span></dd></div>
      <div><dt>Type</dt><dd class="mono">${esc(kase.analysis.defect_type || '—')}</dd></div>
      <div><dt>Location</dt><dd class="mono">${esc(kase.analysis.file || '—')}${kase.analysis.line_start ? `:${kase.analysis.line_start}–${kase.analysis.line_end}` : ''}</dd></div>
      <div><dt>Impact</dt><dd>${esc(kase.analysis.user_visible_impact || '—')}</dd></div></dl>
      <p>${esc(kase.analysis.explanation || '')}</p></div>` : ''}
    ${p ? `<div class="card"><div class="row"><h3 style="margin:0">Proposed fix</h3><span class="pill tone-${risk.score >= 70 ? 'bad' : risk.score >= 40 ? 'warn' : 'ok'}">risk ${risk.score}</span></div>
      <p>${esc(p.summary)}</p>
      ${diffHtml(p.diff_text)}
      <h3 class="mt">Why this risk score</h3>
      ${(risk.factors || []).length ? risk.factors.map(f => `
        <div class="factor ${f.points < 0 ? 'neg' : ''}"><span>${esc(f.reason)}</span><b>${f.points > 0 ? '+' : ''}${f.points}</b>
        <span class="bar"><i style="width:${Math.min(100, Math.round(Math.abs(f.points) / maxF * 100))}%"></i></span></div>`).join('')
        : '<p class="muted">No factor breakdown recorded.</p>'}
      ${critic.verdict ? `<h3 class="mt">Independent review: <span class="pill tone-${critic.verdict === 'approve' ? 'ok' : critic.verdict === 'concern' ? 'warn' : 'bad'}">${esc(critic.verdict)}</span></h3>
        ${(critic.concerns || []).length ? `<ul>${critic.concerns.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : '<p class="muted">No concerns.</p>'}
        ${(critic.scanHits || []).length ? `<div class="callout warn"><b>Safety scanner hits on added lines:</b> ${critic.scanHits.map(h => esc(h.rule + ' — ' + h.reason)).join('; ')}</div>` : ''}` : ''}
      <h3 class="mt">Validation evidence</h3>
      ${validations.length ? `<table class="tbl"><tr><th>Check</th><th>Result</th><th>Details</th></tr>
        ${validations.map(v => `<tr><td class="mono">${esc(v.validator_id)}</td>
          <td>${v.status === 'passed' ? '<span class="pill tone-ok">Passed</span>' : v.status === 'failed' ? '<span class="pill tone-bad">Failed</span>' : '<span class="pill tone-mut">Not performed</span>'}</td>
          <td>${prettyDetails(v.details)}</td></tr>`).join('')}</table>` : '<p class="muted">No validation runs yet.</p>'}
    </div>` : ''}
    ${deployments.length ? `<div class="card"><h3>Deployments</h3><table class="tbl"><tr><th>Commit</th><th>Branch</th><th>Status</th><th>Verified</th><th>Health</th></tr>
      ${deployments.map(x => `<tr><td>${x.commit_url ? `<a href="${esc(x.commit_url)}" target="_blank" rel="noopener" class="mono">${esc((x.commit_sha || '').slice(0, 7))}</a>` : `<span class="mono">${esc((x.commit_sha || '').slice(0, 7))}</span>`}
        ${x.reverted_by_sha ? `<br><span class="muted small">reverted in ${esc(x.reverted_by_sha.slice(0, 7))}</span>` : ''}</td>
        <td class="mono">${esc(x.branch)}</td><td>${pill(x.status === 'live' ? 'RESOLVED_AND_DEPLOYED' : x.status === 'reverted' ? 'ROLLED_BACK' : x.status === 'timeout' ? 'DEPLOY_TIMEOUT' : 'DEPLOYING')}</td>
        <td>${x.live_verified_at ? fmtTime(x.live_verified_at) : '<span class="muted">—</span>'}</td>
        <td class="mono small">${esc(JSON.stringify(JSON.parse(x.health_result || '{}').health?.codes ?? JSON.parse(x.health_result || '{}').codes ?? '—'))}</td></tr>`).join('')}</table></div>` : ''}
    ${approvals.length ? `<div class="card"><h3>Decisions</h3><table class="tbl"><tr><th>Decision</th><th>Comment</th><th>When</th></tr>
      ${approvals.map(a => `<tr><td>${a.decision === 'approved' ? '<span class="pill tone-ok">Approved</span>' : '<span class="pill tone-bad">Rejected</span>'}</td>
        <td>${esc(a.comment || '—')}</td><td>${fmtTime(a.created_at)}</td></tr>`).join('')}</table></div>` : ''}
    <div class="card"><h3>Actions</h3><div class="row" id="issue-actions">
      ${issue.status === 'AWAITING_APPROVAL' ? `
        <input id="ap-comment" placeholder="Review comment (recommended)" style="flex:2;min-width:200px">
        <button class="btn" id="ap-ok">Approve &amp; deploy</button>
        <button class="btn danger" id="ap-no">Reject</button>` : ''}
      <button class="btn ghost" id="ac-retry">Re-run pipeline</button>
      ${p ? '<button class="btn ghost" id="ac-revert">Revert this fix</button>' : ''}
    </div></div>`;
  const rerender = () => issueDetail(id);
  $('#ap-ok') && ($('#ap-ok').onclick = async () => {
    try { await api(`/api/issues/${id}/approve`, { method: 'POST', body: JSON.stringify({ comment: $('#ap-comment').value }) }); toast('Approved — deploying', 'ok'); rerender(); }
    catch (e) { toast(e.message, 'bad'); }
  });
  $('#ap-no') && ($('#ap-no').onclick = async () => {
    if (!await confirmDialog({ title: 'Reject this fix?', body: 'The pipeline stops and the issue is closed as rejected. The report stays on record.', okLabel: 'Reject fix', danger: true })) return;
    try { await api(`/api/issues/${id}/reject`, { method: 'POST', body: JSON.stringify({ comment: $('#ap-comment').value }) }); toast('Fix rejected', 'ok'); rerender(); }
    catch (e) { toast(e.message, 'bad'); }
  });
  $('#ac-retry').onclick = async () => {
    try { await api(`/api/issues/${id}/retry`, { method: 'POST', body: '{}' }); toast('Pipeline re-queued', 'ok'); rerender(); }
    catch (e) { toast(e.message, 'bad'); }
  };
  const rv = $('#ac-revert');
  rv && (rv.onclick = async () => {
    if (!await confirmDialog({ title: 'Revert this fix?', body: 'A new commit restores the pre-fix code (history is never rewritten). The site redeploys to the buggy state.', okLabel: 'Revert fix', danger: true })) return;
    try { const j = await api(`/api/issues/${id}/revert`, { method: 'POST', body: JSON.stringify({ reason: 'manual revert from dashboard' }) }); toast('Reverted in ' + (j.sha || '').slice(0, 7), 'ok'); rerender(); }
    catch (e) { toast(e.message, 'bad'); }
  });
  if (!TERMINAL.has(issue.status)) {
    const t = setInterval(async () => {
      try {
        // Never wipe what the user is typing (e.g. an approval comment).
        if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
        const cur = await api('/api/issues/' + id);
        if (cur.issue.status !== issue.status || (cur.steps.length !== steps.length)) rerender();
        if (TERMINAL.has(cur.issue.status)) { clearInterval(t); }
      } catch { /* keep polling; WS or next tick recovers */ }
    }, 8000);
    cleanup = () => clearInterval(t);
  }
}

/* ---------------- settings ---------------- */
async function settingsView() {
  const [s, integ, members] = await Promise.all([
    api('/api/settings/policy'),
    api('/api/settings/integrations-status'),
    api('/api/members').catch(() => ({ members: null })),
  ]);
  const pol = s.policy || {};
  const globs = Array.isArray(pol.criticalGlobs) ? pol.criticalGlobs.join('\n') : '';
  $('#app').innerHTML = `
    <h2>Settings</h2>
    <div class="grid2">
      <div class="card"><h3>Deploy policy</h3>
        <form id="pf"><div class="grid-form" style="grid-template-columns:1fr 1fr">
          <label class="f">High-risk threshold<input id="pf-high" type="number" min="1" max="100" value="${pol.highThreshold ?? 70}">
            <span class="hint">Score ≥ this always needs a human.</span></label>
          <label class="f">Max files per fix<input id="pf-files" type="number" min="1" max="10" value="${pol.maxFiles ?? 3}"></label>
          <label class="f">Max edits per file<input id="pf-epf" type="number" min="1" max="20" value="${pol.maxEditsPerFile ?? 5}"></label>
          <label class="f">Max changed lines<input id="pf-lines" type="number" min="5" max="200" value="${pol.maxLines ?? 40}"></label>
        </div>
        <label class="f mt">Always-critical paths<span class="hint">One glob per line — changes here always need a human.</span>
          <textarea id="pf-globs" rows="5" placeholder="**/auth/**&#10;**/payment/**&#10;**/checkout/**">${esc(globs)}</textarea></label>
        <label class="check mt"><input type="checkbox" id="pf-auto" ${pol.autoDeploy ? 'checked' : ''}>
          <span>Auto-deploy non-critical fixes<span class="hint"><br>OFF means every fix pauses for approval. Security-sensitive changes always pause regardless.</span></span></label>
        <div class="row mt"><button class="btn" type="submit">Save policy</button></div></form>
      </div>
      <div class="card"><h3>Integrations</h3><div id="integ"></div></div>
    </div>
    <div class="card"><h3>Team</h3><div id="team"></div></div>`;
  const row = (label, v, ok) => `<div class="kv"><div><dt>${label}</dt><dd>${ok ? '<span class="pill tone-ok">Working</span>' : `<span class="pill tone-bad">Not working</span>`} <span class="mono small">${esc(v || '')}</span></dd></div></div>`;
  const ai = integ?.ai || {};
  $('#integ').innerHTML =
    row('AI' + (ai.model ? ` · ${esc(ai.model)}` : ''), ai.configured ? '' : (ai.reason || 'set AI_API_KEY'), !!ai.configured) +
    row('GitHub', integ?.github?.configured ? '' : (integ?.github?.reason || 'set GITHUB_TOKEN'), !!integ?.github?.configured) +
    `<div class="kv"><div><dt>Render deploy checks</dt><dd>${integ?.render?.configured ? '<span class="pill tone-ok">Working</span>' : '<span class="pill tone-mut">Optional</span> <span class="mono small">live-checks via version.json work without it</span>'}</dd></div></div>`;
  $('#pf').onsubmit = async e => {
    e.preventDefault();
    try {
      await api('/api/settings/policy', { method: 'POST', body: JSON.stringify({
        highThreshold: +$('#pf-high').value, maxFiles: +$('#pf-files').value,
        maxEditsPerFile: +$('#pf-epf').value, maxLines: +$('#pf-lines').value,
        criticalGlobs: $('#pf-globs').value.split('\n').map(x => x.trim()).filter(Boolean),
        autoDeploy: $('#pf-auto').checked }) });
      toast('Policy saved', 'ok');
    } catch (err) { toast(err.message, 'bad'); }
  };
  const team = $('#team');
  if (!members.members) { team.innerHTML = '<p class="muted">Team management needs an owner/admin account.</p>'; return; }
  team.innerHTML = `
    <table class="tbl"><tr><th>Email</th><th>Role</th><th>Joined</th><th>Status</th></tr>
    ${members.members.map(m => `<tr><td>${esc(m.email)}</td><td>${pill(m.role === 'owner' ? 'APPROVED' : m.role === 'admin' ? 'DEPLOYING' : m.role === 'reviewer' ? 'AWAITING_APPROVAL' : 'RECEIVED').replace(/>[^<]*</, `>${esc(m.role)}<`)}</td>
      <td>${fmtTime(m.created_at)}</td><td>${m.disabled ? '<span class="pill tone-mut">Disabled</span>' : '<span class="pill tone-ok">Active</span>'}</td></tr>`).join('')}</table>
    <h3 class="mt">Add member</h3>
    <form id="mf"><div class="grid-form">
      <label class="f">Email<input id="mf-email" type="email" required></label>
      <label class="f">Role<select id="mf-role"><option>viewer</option><option>reviewer</option><option>admin</option><option>owner</option></select></label>
      <label class="f">Password (12+ chars)<input id="mf-pw" type="password" required minlength="12"></label>
    </div><div class="row mt"><button class="btn" type="submit">Add member</button></div>
    <div class="field-err" id="mf-err"></div></form>
    <p class="muted small"> viewer: read-only · reviewer: + approve/reject · admin/owner: + sites, keys, policy, members, rollback.</p>`;
  $('#mf').onsubmit = async e => {
    e.preventDefault(); $('#mf-err').textContent = '';
    try {
      await api('/api/members', { method: 'POST', body: JSON.stringify({ email: $('#mf-email').value, role: $('#mf-role').value, password: $('#mf-pw').value }) });
      toast('Member added', 'ok'); settingsView();
    } catch (err) { $('#mf-err').textContent = err.message; }
  };
}

/* ---------------- audit ---------------- */
async function auditView() {
  const a = await api('/api/audit');
  $('#app').innerHTML = `
    <h2>Audit log</h2>
    <div class="card"><div class="toolbar">
      <label class="f" style="flex:2">Filter<input id="a-q" placeholder="actor, action or target…"></label>
    </div><div id="a-list"></div></div>`;
  const render = q => {
    const rows = a.audit.filter(x => !q || (x.actor + ' ' + x.action + ' ' + x.target).toLowerCase().includes(q.toLowerCase()));
    $('#a-list').innerHTML = rows.length ? `<table class="tbl"><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th></tr>
      ${rows.map(x => `<tr><td>${fmtTime(x.ts)}</td><td>${esc(x.actor)}</td><td class="mono">${esc(x.action)}</td><td class="mono">${esc(x.target)}</td></tr>`).join('')}</table>`
      : emptyState('List', 'No matching entries', 'Try a different filter.');
  };
  $('#a-q').oninput = e => render(e.target.value);
  render('');
}

/* ---------------- eval ---------------- */
async function evalView() {
  let res = null;
  try { const r = await fetch('/benchmark/results.json', { credentials: 'same-origin' }); if (r.ok) res = await r.json(); } catch {}
  if (!res) {
    $('#app').innerHTML = `<h2>Evaluation</h2><div class="card">${emptyState('Chart', 'No benchmark results yet', 'Run npm run eval in the repo — results.json is published here automatically.')}</div>`;
    return;
  }
  const total = res.results.length;
  const loc = res.results.filter(r => r.localized).length;
  const langs = res.byLanguage || {};
  $('#app').innerHTML = `<h2>Evaluation</h2>
    <p class="muted small">Benchmark from ${esc(fmtDT(res.date))} · ${esc(res.mode || '')}</p>
    <div class="stat-cards">
      <div class="stat"><div class="n">${loc}/${total}</div><div class="l">Cases localized</div></div>
      <div class="stat"><div class="n">${res.results.filter(r => String(r.gate || '').includes('✔')).length}</div><div class="l">Safety gates correct</div></div>
      <div class="stat"><div class="n">${Object.keys(langs).length}</div><div class="l">Languages covered</div></div>
    </div>
    <div class="card"><h3>Per-language recall</h3>
      <table class="tbl"><tr><th>Language</th><th>Cases</th><th>Localized</th><th>Rate</th></tr>
      ${Object.entries(langs).map(([l, v]) => `<tr><td class="mono">${esc(l)}</td><td>${v.cases}</td><td>${v.localized}</td>
        <td><b>${Math.round(v.localized / v.cases * 100)}%</b> ${v.localized === v.cases ? '<span class="pill tone-ok">Full</span>' : v.localized === 0 ? '<span class="pill tone-bad">Miss</span>' : '<span class="pill tone-warn">Partial</span>'}</td></tr>`).join('')}
      </table></div>
    <div class="card"><h3>All cases</h3>
      <table class="tbl"><tr><th>Case</th><th>Localized</th><th>Patch</th><th>Validators</th><th>Gate</th></tr>
      ${res.results.map(r => `<tr><td class="mono">${esc(r.id)}</td>
        <td>${r.localized ? '<span class="pill tone-ok">Yes</span>' : '<span class="pill tone-mut">No</span>'}</td>
        <td>${r.patchApplies ? '<span class="pill tone-ok">Applies</span>' : '<span class="pill tone-bad">Fails</span>'}</td>
        <td>${r.validators ? '<span class="pill tone-ok">Pass</span>' : '<span class="pill tone-bad">Fail</span>'}</td>
        <td class="small">${esc(r.gate || '—')}</td></tr>`).join('')}</table></div>`;
}

/* ---------------- websocket ---------------- */
let wsRetry = 0, wsTimer = null, sock = null;
function setLive(state, text) {
  wsState = state;
  const b = $('#live-badge');
  if (!b) return;
  b.className = 'live ' + (state === 'on' ? 'on' : state === 'retry' ? 'retry' : 'off');
  $('#live-text').textContent = text;
}
function connectWs() {
  if (!me) { setLive('off', 'offline'); return; }
  try { if (sock) sock.close(); } catch {}
  let ws;
  try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`); }
  catch { return scheduleRetry(); }
  sock = ws;
  setLive('retry', 'connecting');
  ws.onopen = () => { wsRetry = 0; setLive('on', 'live'); };
  ws.onmessage = e => {
    try {
      const m = JSON.parse(e.data);
      if (m.type === 'APPROVAL_NEEDED') toast(`Approval needed: ${m.issueId}`, 'warn', 8000);
      // Never wipe what the user is typing; badges still update.
      if (document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { refreshBadges(); return; }
      const h = location.hash || '';
      if (h.includes('issues') || h.includes('overview')) route();
      refreshBadges();
    } catch {}
  };
  ws.onclose = () => { setLive('off', 'offline'); scheduleRetry(); };
  ws.onerror = () => { try { ws.close(); } catch {} };
}
function scheduleRetry() {
  clearTimeout(wsTimer);
  wsRetry++;
  setLive('retry', 'retrying');
  wsTimer = setTimeout(() => { if (me) connectWs(); }, Math.min(30000, 2000 * wsRetry));
}

boot();
