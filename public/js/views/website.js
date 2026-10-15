// Website detail (F-8): tabs Overview / Widget & keys / Settings.
import { html, esc } from '../core/html.js';
import { api } from '../core/api.js';
import { relTime } from '../core/format.js';
import { icon, refreshIcons } from '../core/icons.js';
import { emptyState, callout, tabs, wireTabs, codeBlock, kvList } from '../components/primitives.js';
import { toast, confirmDialog } from '../components/overlays.js';

export async function websiteView(main, params, id) {
  const d = await api('/api/websites/' + id).catch(e => ({ error: e.message }));
  if (d.error || !d.website) {
    main.innerHTML = `<div class="page"><p><a href="#/websites">← Websites</a></p><div class="card">${callout('bad', "Couldn't load this website", esc(d.error || 'Not found'))}</div></div>`;
    refreshIcons(main);
    return;
  }
  const w = d.website;
  const tab = params.get('tab') || 'overview';
  main.innerHTML = `<div class="page page-enter">
    <p style="margin:0 0 4px"><a href="#/websites">← Websites</a></p>
    <div class="page-head"><div class="head-row">
      <span class="site-ic">${esc((w.name || '?')[0].toUpperCase())}</span><h1>${esc(w.name)}</h1>
      ${w.repo_owner && w.site_url ? '<span class="pill ok">Healthy</span>' : '<span class="pill warn">Needs setup</span>'}
      <span class="actions">${w.site_url ? `<a class="btn ghost sm" href="${esc(w.site_url)}" target="_blank" rel="noopener">${icon('external-link')} Open site</a>` : ''}
      <button class="btn secondary sm" id="run-checks">Run checks</button></span></div>
      <p class="desc mono">${esc(w.repo_owner)}/${esc(w.repo_name)}@${esc(w.branch)}${w.root_path ? ` · subfolder ${esc(w.root_path)}` : ''}</p>
      <div id="w-tabs"></div></div>
    <div id="w-body"></div></div>`;
  main.querySelector('#w-tabs').innerHTML = tabs([
    { key: 'overview', label: 'Overview', icon: 'activity' },
    { key: 'keys', label: 'Widget & keys', icon: 'key-round' },
    { key: 'settings', label: 'Settings', icon: 'settings' },
  ], tab);
  wireTabs(main, t => {
    history.replaceState(null, '', '#/websites/' + id + (t === 'overview' ? '' : '?tab=' + t));
    websiteView(main, new URLSearchParams(t === 'overview' ? '' : 'tab=' + t), id);
  });
  main.querySelector('#run-checks').onclick = () => runChecks(main, id);
  const body = main.querySelector('#w-body');
  if (tab === 'keys') return keysTab(main, body, w, d.keys);
  if (tab === 'settings') return settingsTab(main, body, w);
  return overviewTab(main, body, w, id);
}

async function overviewTab(main, body, w, id) {
  body.innerHTML = '<div class="skel"></div><div class="skel"></div>';
  try {
    const [iss, t] = await Promise.all([
      api('/api/issues?limit=100'),
      api(`/api/websites/${id}/test`, { method: 'POST' }).catch(() => null),
    ]);
    const mine = iss.issues.filter(i => String(i.website_id) === String(w.id));
    const open = mine.filter(i => !['RESOLVED_AND_DEPLOYED', 'INVALID_REPORT', 'REJECTED_BY_ADMIN', 'ROLLED_BACK'].includes(i.status)).length;
    body.innerHTML = `
      <div class="stats">
        <div class="stat card"><span class="over">Open issues</span><div class="val">${open}</div></div>
        <div class="stat card"><span class="over">Total reports</span><div class="val">${mine.length}</div></div>
        <div class="stat card"><span class="over">Fixed &amp; live</span><div class="val">${mine.filter(i => i.status === 'RESOLVED_AND_DEPLOYED').length}</div></div>
      </div>
      <div class="grid2">
      <div class="card"><h2>Connection checks</h2><div id="checks">${t ? checksHtml(t.tests) : '<button class="btn ghost sm" id="c-run">Run checks</button>'}</div></div>
      <div class="card"><h2>Recent issues</h2>
        ${mine.slice(0, 5).map(i => `<div class="row"><a href="#/issues/${i.id}">${esc(i.title)}</a><span class="dim small" style="margin-left:auto">${relTime(i.updated_at)}</span></div>`).join('') || '<p class="dim">No reports yet.</p>'}
        ${mine.length > 5 ? `<p><a href="#/issues?site=${w.id}" class="small">View all</a></p>` : ''}</div>
      </div>`;
    const rb = body.querySelector('#c-run');
    if (rb) rb.onclick = () => runChecks(main, id);
  } catch (e) { body.innerHTML = `<div class="card">${callout('bad', "Couldn't load website data", esc(e.message))}</div>`; }
  refreshIcons(main);
}

export function checksHtml(tests) {
  const row = (label, v) => {
    const ok = /working|configured/.test(v);
    return `<div class="row" style="margin-bottom:8px">${ok ? '<span class="pill ok">OK</span>' : '<span class="pill bad">Error</span>'}<b>${label}</b>
      ${ok ? '' : `<span class="mono small dim">${esc(v)}</span>`}</div>`;
  };
  return row('GitHub', tests.github) + row('Site reachable', tests.site) + row('AI', tests.ai);
}

async function runChecks(main, id) {
  toast('Running checks…', { type: 'info', ms: 2000 });
  try {
    const t = await api(`/api/websites/${id}/test`, { method: 'POST' });
    const host = main.querySelector('#w-body');
    if (host) {
      const box = document.createElement('div');
      box.className = 'card';
      box.innerHTML = '<h2>Check results</h2>' + checksHtml(t.tests);
      host.prepend(box);
      refreshIcons(host);
      box.scrollIntoView({ block: 'nearest' });
    } else toast('Checks finished', { type: 'ok' });
  } catch (e) { toast(e.message, { type: 'bad' }); }
}

async function keysTab(main, body, w, keys) {
  const snippet = `<div id="bugshield-widget"></div>\n<script src="${location.origin}/sdk/bugshield.js"\n  data-app-id="${w.id}" data-key="bsk_YOUR_KEY_HERE"><\/script>`;
  body.innerHTML = `
    <div class="card"><h2>Widget snippet</h2>
      <p class="muted">The ingestion key is <b>public by design</b> — it ships in the client site. Abuse is stopped by the origin allow-list on each key plus rate limits, not by secrecy.</p>
      ${codeBlock(snippet, { lang: 'html' })}</div>
    <div class="card"><div class="card-head"><h2 style="margin:0">Ingestion keys (${keys.length})</h2><span class="spacer"></span>
      <button class="btn ghost sm" id="key-new">${icon('plus')} Create key</button></div>
      <div id="keys-tbl"></div></div>`;
  const paint = ks => {
    body.querySelector('#keys-tbl').innerHTML = ks.length ? `<table class="tbl stacked"><thead><tr><th>Label</th><th>Key id</th><th>Allowed origins</th><th>Created</th><th>Last used</th><th>Status</th><th></th></tr></thead><tbody>
      ${ks.map(k => {
        let origins = [];
        try { origins = JSON.parse(k.allowed_origins || '[]'); } catch {}
        return `<tr><td><b>${esc(k.label)}</b></td><td class="mono">#${k.id}</td>
        <td>${origins.length ? origins.map(o => `<span class="chip mono">${esc(o)}</span>`).join(' ') : '<span class="dim">any origin</span>'}</td>
        <td>${relTime(k.created_at)}</td><td>${k.last_used_at ? relTime(k.last_used_at) : '<span class="dim">never</span>'}</td>
        <td>${k.revoked_at ? '<span class="pill mut">Revoked</span>' : '<span class="pill ok">Active</span>'}</td>
        <td class="rowact">${k.revoked_at ? '' : `<button class="btn ghost sm" data-rev="${k.id}" style="color:var(--bad)">Revoke</button>`}</td></tr>`;
      }).join('')}</tbody></table>`
      : emptyState('key-round', 'No keys yet', 'Create one to start receiving reports.');
    body.querySelectorAll('[data-rev]').forEach(b => b.onclick = async () => {
      if (!await confirmDialog({ title: 'Revoke this key?', body: 'The widget using it will stop sending reports immediately. This cannot be undone.', okLabel: 'Revoke key', danger: true })) return;
      try { await api(`/api/websites/${w.id}/keys/${b.dataset.rev}`, { method: 'DELETE' }); toast('Key revoked', { type: 'ok' }); websiteView(main, new URLSearchParams('tab=keys'), w.id); }
      catch (e) { toast(e.message, { type: 'bad' }); }
    });
    refreshIcons(body);
  };
  paint(keys);
  body.querySelector('#key-new').onclick = async () => {
    const { openModal } = await import('../components/overlays.js');
    const m = openModal({ title: 'Create ingestion key', size: 'sm', actions: [] });
    m.body.innerHTML = `
      <div class="field"><label for="nk-l">Label</label><input class="input" id="nk-l" value="key"></div>
      <div class="field mt"><label for="nk-o">Allowed origins <span class="dim">(one per line; empty = any)</span></label>
      <textarea class="input" id="nk-o" rows="3" placeholder="https://site.onrender.com"></textarea></div>
      <div class="row mt" style="justify-content:flex-end"><button class="btn" id="nk-go">Create key</button></div>`;
    m.body.querySelector('#nk-go').onclick = async () => {
      const origins = m.body.querySelector('#nk-o').value.split('\n').map(s => s.trim()).filter(Boolean);
      for (const o of origins) {
        try { const u = new URL(o); if (!['http:', 'https:'].includes(u.protocol)) throw 0; }
        catch { toast('Origin must be a full http(s) URL: ' + o, { type: 'bad' }); return; }
      }
      try {
        const j = await api(`/api/websites/${w.id}/keys`, { method: 'POST', body: JSON.stringify({ label: m.body.querySelector('#nk-l').value || 'key', allowed_origins: origins }) });
        m.close();
        const m2 = openModal({ title: 'Key created — shown once', size: 'sm', actions: [{ label: 'Done' }] });
        m2.body.innerHTML = `<p class="muted small">Copy it now. It will never be shown again.</p>` + codeBlock(j.ingestionKey, { lang: 'bsk_…' });
        websiteView(main, new URLSearchParams('tab=keys'), w.id);
      } catch (e) { toast(e.message, { type: 'bad' }); }
    };
  };
  refreshIcons(main);
}

async function settingsTab(main, body, w) {
  body.innerHTML = `
    <div class="card"><h2>Site settings</h2>
    <form id="wf"><div class="grid2">
      <div class="field"><label for="wf-name">Name</label><input class="input" id="wf-name" value="${esc(w.name)}"></div>
      <div class="field"><label for="wf-repo">Repo URL</label><input class="input mono" id="wf-repo" value="${esc(w.repo_url || '')}"></div>
      <div class="field"><label for="wf-branch">Branch</label><input class="input mono" id="wf-branch" value="${esc(w.branch)}"></div>
      <div class="field"><label for="wf-root">Subfolder</label><input class="input mono" id="wf-root" value="${esc(w.root_path || '')}"></div>
      <div class="field"><label for="wf-site">Site URL</label><input class="input" id="wf-site" value="${esc(w.site_url || '')}"></div>
      <div class="field"><label for="wf-health">Health URL</label><input class="input" id="wf-health" value="${esc(w.health_url || '')}"></div>
      <div class="field"><label for="wf-ver">Version path</label><input class="input mono" id="wf-ver" value="${esc(w.version_path || '/version.json')}"></div>
    </div>
    <label class="check mt"><input type="checkbox" id="wf-always" ${w.always_require_approval ? 'checked' : ''}>
      <span>Always require human approval for this site<br><span class="dim small">Even non-critical fixes pause. Security-sensitive changes always pause regardless.</span></span></label>
    <div class="row mt"><button class="btn" type="submit" id="wf-save">Save changes</button>
    <button class="btn ghost" type="button" id="wf-discard" hidden>Discard</button></div></form></div>`;
  const form = body.querySelector('#wf');
  const snap = () => JSON.stringify([...form.querySelectorAll('input')].map(i => i.type === 'checkbox' ? i.checked : i.value));
  const before = snap();
  form.addEventListener('input', () => { body.querySelector('#wf-discard').hidden = snap() === before; });
  body.querySelector('#wf-discard').onclick = () => settingsTab(main, body, w);
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = body.querySelector('#wf-save');
    btn.disabled = true;
    try {
      const repo = body.querySelector('#wf-repo').value;
      await api(`/api/websites/${w.id}`, { method: 'PATCH', body: JSON.stringify({
        name: body.querySelector('#wf-name').value, repo_url: repo, branch: body.querySelector('#wf-branch').value,
        root_path: body.querySelector('#wf-root').value, site_url: body.querySelector('#wf-site').value,
        health_url: body.querySelector('#wf-health').value, version_path: body.querySelector('#wf-ver').value,
        always_require_approval: body.querySelector('#wf-always').checked ? 1 : 0 }) });
      toast('Site saved', { type: 'ok' });
      websiteView(main, new URLSearchParams('tab=settings'), w.id);
    } catch (err) { toast(err.message, { type: 'bad' }); btn.disabled = false; }
  };
  refreshIcons(main);
}
