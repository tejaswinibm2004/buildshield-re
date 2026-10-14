/* BugShield dashboard SPA (vanilla JS, no build). */
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'bugshield' };
async function api(p, opts = {}) {
  const r = await fetch(p, { credentials: 'same-origin', headers: H, ...opts });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || ('HTTP ' + r.status));
  return j;
}
const app = document.getElementById('app');
const nav = document.getElementById('nav');
const routes = ['overview', 'websites', 'issues', 'settings', 'audit', 'eval'];
let me = null;

function link(name) { return `<a href="#/${name}" class="${location.hash.includes(name) ? 'on' : ''}">${name}</a>`; }
function renderNav() { nav.innerHTML = me ? routes.map(link).join('') + ` <button class="ghost" id="logout">logout</button>` : ''; document.getElementById('logout')?.addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }); location.reload(); }); }

async function boot() {
  try { me = (await api('/auth/me')).user; } catch { return loginView(); }
  document.getElementById('me').textContent = `${me.email} (${me.role})`;
  try { const h = await api('/api/health'); document.getElementById('health').textContent = 'api ok ' + h.time; } catch {}
  renderNav();
  window.addEventListener('hashchange', route);
  connectWs();
  await route();
}
function loginView() {
  app.innerHTML = `<div class="card"><h2>Login</h2><div class="row"><input id="e" placeholder="email"><input id="p" type="password" placeholder="password (12+ chars)"><button id="go">Login</button></div><p class="muted">First run: owner comes from BOOTSTRAP_OWNER_EMAIL/PASSWORD env.</p></div>`;
  document.getElementById('go').onclick = async () => {
    try {
      const r = await fetch('/auth/login', { method: 'POST', headers: H, body: JSON.stringify({ email: document.getElementById('e').value, password: document.getElementById('p').value }) });
      const j = await r.json();
      if (!j.success) return alert(j.error.message);
      location.reload();
    } catch (e) { alert(e.message); }
  };
}
async function route() {
  renderNav();
  const h = location.hash || '#/overview';
  if (h.startsWith('#/issues/')) return issueDetail(h.split('/')[2]);
  if (h.includes('websites')) return websitesView();
  if (h.includes('issues')) return issuesView();
  if (h.includes('settings')) return settingsView();
  if (h.includes('audit')) return auditView();
  if (h.includes('eval')) return evalView();
  return overviewView();
}
async function overviewView() {
  const s = await api('/api/stats/overview');
  app.innerHTML = `<div class="card"><h2>Overview</h2><div class="row">${s.byStatus.map(x => `<span class="pill st-${x.status}">${x.status}: ${x.c}</span>`).join('')}</div>
  <p>Total issues: <b>${s.total}</b></p><h3>Last deployments</h3><pre>${JSON.stringify(s.lastDeploy, null, 2)}</pre>
  <p class="muted">Health: AI ${s.health.ai.configured ? 'configured (' + s.health.ai.model + ')' : 'AI_UNAVAILABLE — set AI_API_KEY'} · GitHub ${s.health.github ? 'token set' : 'NOT configured'}</p></div>`;
}
async function websitesView() {
  const w = await api('/api/websites');
  app.innerHTML = `<div class="card"><h2>Websites</h2>
  <div class="row"><input id="n" placeholder="name"><input id="r" placeholder="https://github.com/owner/repo" size="34"><input id="s" placeholder="https://site-url" size="28"><button id="c">Connect website</button></div>
  <table><tr><th>id</th><th>name</th><th>repo</th><th>site</th><th></th></tr>${w.websites.map(x => `<tr><td>${x.id}</td><td>${x.name}</td><td>${x.repo_owner}/${x.repo_name}@${x.branch}</td><td>${x.site_url}</td><td><button class="ghost" data-v="${x.id}">view</button></td></tr>`).join('')}</table></div>
  <div id="det"></div>`;
  document.getElementById('c').onclick = async () => {
    try {
      const j = await api('/api/websites', { method: 'POST', body: JSON.stringify({ name: document.getElementById('n').value, repo_url: document.getElementById('r').value, site_url: document.getElementById('s').value }) });
      alert('Created. Ingestion key (shown ONCE):\n' + j.ingestionKey);
      websitesView();
    } catch (e) { alert(e.message); }
  };
  app.querySelectorAll('[data-v]').forEach(b => b.onclick = async () => {
    const d = await api('/api/websites/' + b.dataset.v);
    const t = await api('/api/websites/' + b.dataset.v + '/test', { method: 'POST' }).catch(e => ({ tests: { error: e.message } }));
    document.getElementById('det').innerHTML = `<div class="card"><h3>${d.website.name}</h3>
    <p class="muted">Widget snippet (paste into client site):</p>
    <pre>&lt;div id="bugshield-widget"&gt;&lt;/div&gt;\n&lt;script src="${location.origin}/sdk/bugshield.js" data-app-id="${d.website.id}" data-key="bsk_..."&gt;&lt;/script&gt;</pre>
    <p>Keys: ${d.keys.map(k => `${k.label} #${k.id} ${k.revoked_at ? '(revoked)' : ''}`).join(', ')}</p>
    <pre>${JSON.stringify(t.tests, null, 2)}</pre></div>`;
  });
}
async function issuesView() {
  const j = await api('/api/issues?limit=50');
  app.innerHTML = `<div class="card"><h2>Issues (${j.issues.length})</h2><table><tr><th>id</th><th>title</th><th>status</th><th>site</th><th>occ</th></tr>
  ${j.issues.map(i => `<tr><td><a href="#/issues/${i.id}">${i.id}</a></td><td>${escapeHtml(i.title)}</td><td><span class="pill st-${i.status}">${i.status}</span></td><td>${i.website_id}</td><td>${i.occurrences}</td></tr>`).join('')}</table></div>`;
}
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
async function issueDetail(id) {
  const d = await api('/api/issues/' + id);
  const { issue, steps, patches, validations, deployments, approvals } = d;
  const p = patches[0];
  app.innerHTML = `<div class="card"><a href="#/issues">← back</a><h2>${escapeHtml(issue.title)}</h2>
  <span class="pill st-${issue.status}">${issue.status}</span> <span class="muted">${issue.id} · occ ${issue.occurrences} · ${issue.status_reason || ''}</span>
  <p>${escapeHtml(issue.description)}</p><p class="muted">${escapeHtml(issue.page_url)} · steps: ${escapeHtml(issue.steps)}</p></div>
  <div class="card"><h3>Timeline</h3><div class="timeline">${steps.map(s => `<div class="step"><b>${s.name}</b> — ${s.status} <span class="muted">${s.summary || ''}</span></div>`).join('') || '<p class=muted>no steps yet</p>'}</div></div>
  ${p ? `<div class="card"><h3>Patch (risk ${p.risk_score})</h3><p>${escapeHtml(p.summary)}</p><pre>${escapeHtml(p.diff_text).replace(/^\+.*/gm, m => `<span class="diff-add">${escapeHtml(m)}</span>`).replace(/^-.*/gm, m => `<span class="diff-del">${escapeHtml(m)}</span>`)}</pre>
  <h4>Validations</h4><pre>${escapeHtml(JSON.stringify(validations, null, 2))}</pre>
  <h4>Deployments</h4><pre>${escapeHtml(JSON.stringify(deployments, null, 2))}</pre>
  <h4>Approvals</h4><pre>${escapeHtml(JSON.stringify(approvals, null, 2))}</pre></div>` : ''}
  ${issue.status === 'AWAITING_APPROVAL' ? `<div class="card"><h3>Approval required</h3><div class="row"><input id="cm" placeholder="comment"><button id="ap">Approve</button><button id="rj" class="ghost">Reject</button></div></div>` : ''}
  <div class="card row"><button id="rt" class="ghost">Retry pipeline</button><button id="rv" class="ghost">Revert this fix</button></div>`;
  document.getElementById('ap') && (document.getElementById('ap').onclick = async () => { await api(`/api/issues/${id}/approve`, { method: 'POST', body: JSON.stringify({ comment: document.getElementById('cm').value }) }); route(); });
  document.getElementById('rj') && (document.getElementById('rj').onclick = async () => { await api(`/api/issues/${id}/reject`, { method: 'POST', body: JSON.stringify({ comment: document.getElementById('cm').value }) }); route(); });
  document.getElementById('rt').onclick = async () => { await api(`/api/issues/${id}/retry`, { method: 'POST', body: '{}' }); alert('re-queued'); };
  document.getElementById('rv').onclick = async () => { try { const j = await api(`/api/issues/${id}/revert`, { method: 'POST', body: JSON.stringify({ reason: 'manual' }) }); alert('reverted ' + j.sha); } catch (e) { alert(e.message); } };
}
async function settingsView() {
  const s = await api('/api/settings/policy');
  const integ = await api('/api/settings/integrations-status');
  app.innerHTML = `<div class="card"><h2>Policy</h2><pre>${escapeHtml(JSON.stringify(s.policy, null, 2))}</pre>
  <div class="row"><label>autoDeploy <input type="checkbox" id="ad" ${s.policy.autoDeploy ? 'checked' : ''}></label><input id="ht" type="number" value="${s.policy.highThreshold}" style="width:90px"><button id="sv">Save</button></div>
  <p class="muted">autoDeploy=TRUE applies only to non-critical, safety-clean fixes. Security-sensitive changes ALWAYS need a human.</p></div>
  <div class="card"><h2>Integrations</h2><pre>${escapeHtml(JSON.stringify(integ, null, 2))}</pre></div>`;
  document.getElementById('sv').onclick = async () => { await api('/api/settings/policy', { method: 'POST', body: JSON.stringify({ autoDeploy: document.getElementById('ad').checked, highThreshold: +document.getElementById('ht').value }) }); alert('saved'); };
}
async function auditView() {
  const a = await api('/api/audit');
  app.innerHTML = `<div class="card"><h2>Audit (200 recent)</h2><table>${a.audit.map(x => `<tr><td>${x.ts}</td><td>${escapeHtml(x.actor)}</td><td>${x.action}</td><td>${escapeHtml(x.target)}</td></tr>`).join('')}</table></div>`;
}
async function evalView() {
  let res = null;
  try { const r = await fetch('/benchmark/results.json'); res = await r.json(); } catch {}
  app.innerHTML = `<div class="card"><h2>Evaluation</h2><p class="muted">Run <code>npm run eval</code> to generate benchmark/results.json (works offline with fixtures).</p><pre>${escapeHtml(JSON.stringify(res ?? { note: 'no results yet' }, null, 2))}</pre></div>`;
}
function connectWs() {
  try {
    // HttpOnly session cookie is sent automatically on the WS handshake; no token in JS needed.
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (e) => { if ((location.hash || '').includes('issues')) route(); };
  } catch {}
}
boot();
