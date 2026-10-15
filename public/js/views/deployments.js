// Deployments list (F-6).
import { html, esc } from '../core/html.js';
import { api } from '../core/api.js';
import { relTime, shortSha } from '../core/format.js';
import { icon, refreshIcons } from '../core/icons.js';
import { stagePill, emptyState, callout } from '../components/primitives.js';
import { toast, confirmDialog } from '../components/overlays.js';
import { store } from '../core/store.js';

export async function deploymentsView(main, params) {
  let site = params.get('site') || '';
  if (!site && store.scopedSite) site = String(store.scopedSite);
  const stage = params.get('stage') || '';
  let sites = [];
  try { sites = (await api('/api/websites')).websites; } catch {}
  main.innerHTML = `<div class="page page-enter">
    <div class="page-head"><div class="head-row"><h1>Deployments</h1></div>
    <p class="desc">Every fix BugShield committed, and proof it went live.</p></div>
    <div class="card"><div class="toolbar" style="margin:0 0 8px">
      <div class="field"><label class="dim small">Site</label><select class="input" id="d-site"><option value="">All sites</option>
        ${sites.map(w => `<option value="${w.id}"${String(site) === String(w.id) ? ' selected' : ''}>${esc(w.name)}</option>`).join('')}</select></div>
      <div class="field"><label class="dim small">Stage</label><select class="input" id="d-stage"><option value="">All</option>
        ${['live', 'pushed', 'timeout', 'reverted'].map(s => `<option${stage === s ? ' selected' : ''}>${s}</option>`).join('')}</select></div>
    </div><div id="dep-list"></div></div></div>`;
  const draw = async () => {
    const list = main.querySelector('#dep-list');
    list.innerHTML = '<div class="skel"></div><div class="skel"></div>';
    try {
      const [ov, ws] = await Promise.all([api('/api/stats/overview'), api('/api/websites').catch(() => ({ websites: [] }))]);
      let rows = ov.lastDeploy || [];
      const siteOf = {};
      if (site) {
        // map deployments -> site via their issues (one extra call per row is wasteful; filter if known)
        const iss = await api('/api/issues?limit=100').catch(() => ({ issues: [] }));
        for (const i of iss.issues) siteOf[i.id] = i.website_id;
        rows = rows.filter(d => String(siteOf[d.issue_id]) === String(site));
      }
      if (stage) rows = rows.filter(d => d.status === stage);
      if (!rows.length) {
        list.innerHTML = emptyState('rocket', 'Nothing deployed yet', 'Fixes appear here once BugShield commits them.');
      } else {
        list.innerHTML = `<table class="tbl stacked"><thead><tr><th>Commit</th><th>Issue</th><th>Branch</th><th>Status</th><th>Verified live</th><th></th></tr></thead><tbody>
          ${rows.map(d => `<tr>
            <td>${d.commit_url ? `<a href="${esc(d.commit_url)}" target="_blank" rel="noopener" class="mono">${icon('git-commit')} ${esc(shortSha(d.commit_sha))}</a>` : `<span class="mono">${esc(shortSha(d.commit_sha))}</span>`}</td>
            <td><a href="#/issues/${d.issue_id}">${esc(d.issue_id)}</a></td>
            <td class="mono">${esc(d.branch)}</td>
            <td>${d.status === 'live' ? '<span class="pill ok">Live</span>' : d.status === 'reverted' ? '<span class="pill warn">Reverted</span>' : d.status === 'timeout' ? '<span class="pill bad">Timed out</span>' : `<span class="pill info">${esc(d.status)}</span>`}</td>
            <td>${d.live_verified_at ? `<span class="pill ok">check</span> ${relTime(d.live_verified_at)}` : '<span class="dim">Unverified — no version marker proof</span>'}</td>
            <td class="rowact">${d.status !== 'reverted' ? `<button class="icon-btn" data-rev="${d.issue_id}" aria-label="Revert fix">${icon('undo-2')}</button>` : ''}</td>
          </tr>`).join('')}</tbody></table>`;
        list.querySelectorAll('[data-rev]').forEach(b => b.onclick = async () => {
          if (!await confirmDialog({ title: 'Revert this fix?', body: 'BugShield will push a new commit that undoes it. Your site will redeploy in a few minutes.', okLabel: 'Revert fix', danger: true })) return;
          try { await api(`/api/issues/${b.dataset.rev}/revert`, { method: 'POST', body: JSON.stringify({ reason: 'manual revert from deployments' }) }); toast('Revert committed', { type: 'ok' }); draw(); }
          catch (e) { toast(e.message, { type: 'bad' }); }
        });
      }
    } catch (e) { list.innerHTML = callout('bad', "Couldn't load deployments", esc(e.message)); }
    refreshIcons(main);
  };
  main.querySelector('#d-site').onchange = e => {
    const p = new URLSearchParams(); if (e.target.value) p.set('site', e.target.value); if (stage) p.set('stage', stage);
    location.hash = '#/deployments' + (String(p) ? '?' + String(p) : '');
  };
  main.querySelector('#d-stage').onchange = e => {
    const p = new URLSearchParams(); if (site) p.set('site', site); if (e.target.value) p.set('stage', e.target.value);
    location.hash = '#/deployments' + (String(p) ? '?' + String(p) : '');
  };
  await draw();
  refreshIcons(main);
}
