// Websites list + 3-step connect wizard (F-7).
import { html, esc } from '../core/html.js';
import { api } from '../core/api.js';
import { relTime } from '../core/format.js';
import { icon, refreshIcons } from '../core/icons.js';
import { emptyState, callout, codeBlock } from '../components/primitives.js';
import { toast, openModal } from '../components/overlays.js';
import { navigate } from '../core/router.js';

export async function websitesView(main, params) {
  main.innerHTML = `<div class="page page-enter">
    <div class="page-head"><div class="head-row"><h1>Websites</h1>
      <span class="actions"><button class="btn" id="new-site">${icon('plus')} Connect website</button></span></div>
      <p class="desc">Sites that report bugs through the widget.</p></div>
    <div id="site-grid"><div class="skel"></div><div class="skel"></div></div></div>`;
  main.querySelector('#new-site').onclick = () => wizard(main);
  if (params.get('new') === '1') wizard(main);
  try {
    const [w, iss] = await Promise.all([api('/api/websites'), api('/api/issues?limit=100').catch(() => ({ issues: [] }))]);
    const grid = main.querySelector('#site-grid');
    if (!w.websites.length) {
      grid.innerHTML = `<div class="card">${emptyState('globe', 'Connect your first website', 'Add your repo and site URL, paste the widget snippet, and reports start flowing.', '')}</div>`;
    } else {
      grid.innerHTML = `<div class="sites-grid stagger">${w.websites.map(s => {
        const mine = iss.issues.filter(i => String(i.website_id) === String(s.id));
        const open = mine.filter(i => !['RESOLVED_AND_DEPLOYED', 'INVALID_REPORT', 'REJECTED_BY_ADMIN', 'ROLLED_BACK'].includes(i.status)).length;
        const last = mine.map(i => i.created_at).sort().pop();
        const ok = s.repo_owner && s.site_url;
        return `<div class="card site-card"><div class="top">
          <span class="site-ic">${esc((s.name || '?')[0].toUpperCase())}</span>
          <div><h2 style="margin:0">${esc(s.name)}</h2><div class="mono dim">${esc(s.repo_owner)}/${esc(s.repo_name)}@${esc(s.branch)}</div></div>
          <span style="margin-left:auto">${ok ? '<span class="pill ok">Healthy</span>' : '<span class="pill warn">Needs setup</span>'}</span></div>
          ${s.site_url ? `<p><a href="${esc(s.site_url)}" target="_blank" rel="noopener">${icon('external-link')} ${esc(s.site_url)}</a></p>` : '<p class="dim">No site URL set.</p>'}
          <div class="row small"><span>${open} open</span><span class="dim">·</span><span>${mine.length} reports total</span><span class="dim">·</span><span>${last ? 'last report ' + relTime(last) : 'no reports yet'}</span></div>
          <div class="row mt"><a class="btn ghost sm" href="#/websites/${s.id}">Manage</a>
          <span class="dim small">${last ? 'Widget active' : 'Waiting for first report'}</span></div></div>`;
      }).join('')}</div>`;
    }
  } catch (e) {
    main.querySelector('#site-grid').innerHTML = `<div class="card">${callout('bad', "Couldn't load websites", esc(e.message))}</div>`;
  }
  refreshIcons(main);
}

function wizard(main) {
  let step = 1;
  const data = { repo_url: '', branch: 'main', root_path: '', site_url: '', health_url: '', version_path: '/version.json', name: '' };
  const { root, close, body } = openModal({ title: 'Connect a website', size: 'lg', actions: [] });
  const draw = () => {
    body.innerHTML = `
      <div class="wiz-dots"><i class="${step >= 1 ? 'on' : ''}"></i><i class="${step >= 2 ? 'on' : ''}"></i><i class="${step >= 3 ? 'on' : ''}"></i></div>
      ${step === 1 ? `
        <h3>Step 1 of 3 — Repository</h3>
        <div class="field"><label for="wz-name">Site name</label><input class="input" id="wz-name" value="${esc(data.name)}" placeholder="My shop"></div>
        <div class="field mt"><label for="wz-repo">GitHub repo URL</label><input class="input mono" id="wz-repo" value="${esc(data.repo_url)}" placeholder="https://github.com/owner/repo"></div>
        <div class="grid2 mt"><div class="field"><label for="wz-branch">Branch</label><input class="input mono" id="wz-branch" value="${esc(data.branch)}"></div>
        <div class="field"><label for="wz-root">Subfolder <span class="dim">(optional)</span></label><input class="input mono" id="wz-root" value="${esc(data.root_path)}" placeholder="packages/web"></div></div>
        <div class="field-err" id="wz-err" style="color:var(--bad);font-size:13px;min-height:20px"></div>
        <div class="row" style="justify-content:flex-end"><button class="btn ghost" id="wz-x">Cancel</button><button class="btn" id="wz-next">Next: site details</button></div>`
      : step === 2 ? `
        <h3>Step 2 of 3 — Site</h3>
        <div class="field"><label for="wz-site">Site URL</label><input class="input" id="wz-site" value="${esc(data.site_url)}" placeholder="https://site.onrender.com"></div>
        <div class="field mt"><label for="wz-health">Health URL <span class="dim">(optional probe target)</span></label><input class="input" id="wz-health" value="${esc(data.health_url)}"></div>
        <div class="field mt"><label for="wz-ver">Version path</label><input class="input mono" id="wz-ver" value="${esc(data.version_path)}"><span class="hint dim small">Your build must write {"commit": "&lt;sha&gt;"} here so BugShield can prove a fix is live.</span></div>
        <div class="row mt" style="justify-content:flex-end"><button class="btn ghost" id="wz-back">Back</button><button class="btn" id="wz-create">Create site &amp; key</button></div>`
      : `
        <h3>Step 3 of 3 — Add the widget</h3>
        <p class="muted">Paste this into your site. The key is <b>shown once</b> — copy it now.</p>
        <div id="wz-key"></div>
        <div id="wz-wait"><p class="dim">Waiting for the first report… file one from the widget to finish setup.</p></div>
        <div class="row mt" style="justify-content:flex-end"><button class="btn" id="wz-done">Done</button></div>`}
    `;
    const q = s => body.querySelector(s);
    const cancel = q('#wz-x'); if (cancel) cancel.onclick = close;
    const back = q('#wz-back'); if (back) back.onclick = () => { harvest(); step = 1; draw(); };
    const next = q('#wz-next');
    if (next) next.onclick = () => {
      harvest();
      if (!data.name) return err('Give the site a name.');
      if (data.repo_url && !/github\.com\/.+\/.+/.test(data.repo_url)) return err('That repo URL does not look like github.com/owner/repo.');
      step = 2; draw();
    };
    const create = q('#wz-create');
    if (create) create.onclick = async () => {
      harvest();
      create.disabled = true;
      try {
        const j = await api('/api/websites', { method: 'POST', body: JSON.stringify({ ...data, name: data.name || data.site_url || 'Site' }) });
        step = 3;
        draw();
        body.querySelector('#wz-key').innerHTML = codeBlock(j.ingestionKey, { lang: 'ingestion key — shown once' });
        pollFirst(j.id);
        websitesView(main, new URLSearchParams());
        toast('Website connected', { type: 'ok' });
      } catch (e) {
        create.disabled = false;
        toast(e.message, { type: 'bad' });
      }
    };
    const done = q('#wz-done'); if (done) done.onclick = close;
    refreshIcons(body);
    function harvest() {
      const g = id => body.querySelector(id)?.value ?? '';
      data.name = g('#wz-name') || data.name; data.repo_url = g('#wz-repo') || data.repo_url;
      data.branch = g('#wz-branch') || data.branch; data.root_path = g('#wz-root') || data.root_path;
      data.site_url = g('#wz-site') || data.site_url; data.health_url = g('#wz-health') || data.health_url;
      data.version_path = g('#wz-ver') || data.version_path;
    }
    function err(m) { body.querySelector('#wz-err').textContent = m; }
    async function pollFirst(siteId) {
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 10000));
        try {
          const k = await api('/api/websites/' + siteId);
          const used = (k.keys || []).some(x => x.last_used_at);
          if (used) {
            const w = body.querySelector('#wz-wait');
            if (w) w.innerHTML = `<div class="callout ok"><div><div class="ct">Received your test report!</div><div class="cb">Setup is complete.</div></div></div>`;
            refreshIcons(body);
            return;
          }
        } catch { return; }
      }
    }
  };
  draw();
}
