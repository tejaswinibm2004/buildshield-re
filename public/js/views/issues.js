// Issues list (F-3): shareable filters, stages, drawer, bulk actions, CSV.
import { html, esc } from '../core/html.js';
import { api } from '../core/api.js';
import { relTime } from '../core/format.js';
import { icon, refreshIcons } from '../core/icons.js';
import { STAGES, stageOf, stagePill, riskPill, emptyState, callout } from '../components/primitives.js';
import { toast } from '../components/overlays.js';
import { openDrawer } from '../components/overlays.js';
import { navigate, link } from '../core/router.js';
import { onEvent, typingNow } from '../core/ws.js';
import { store } from '../core/store.js';

const SAVED = [['all', 'All'], ['needsme', 'Needs me'], ['auto', 'Auto-fixed'], ['failed', 'Failed']];
let S = {};

export async function issuesView(main, params) {
  S = {
    q: params.get('q') || '', stage: params.get('stage') || '', site: params.get('site') || '',
    risk: params.get('risk') || '', mine: params.get('mine') || '', saved: params.get('saved') || 'all',
    items: [], cursor: null, selected: new Set(), sites: [],
  };
  // Site switcher scope applies unless the URL already pins a site.
  if (!S.site && store.scopedSite) S.site = String(store.scopedSite);
  try { S.sites = (await api('/api/websites')).websites; } catch {}
  main.innerHTML = `<div class="page page-enter">
    <div class="page-head"><div class="head-row"><h1>Issues</h1><span class="actions">
      <button class="btn ghost sm" id="csv-btn">${icon('download')} Export CSV</button>
      <button class="btn ghost sm" id="density-btn" aria-label="Toggle density">${icon('rows')}</button>
    </span></div></div>
    <div class="card"><div class="toolbar" style="margin:0 0 8px">
      <div class="field" style="flex:2;min-width:200px"><span class="input-wrap"><span class="lead">${icon('search')}</span>
        <input class="input" id="f-q" placeholder="Search title, id, description…" value="${esc(S.q)}" aria-label="Search issues"></span></div>
      <div class="field"><label class="dim small" for="f-stage">Stage</label><select class="input" id="f-stage">
        <option value="">All stages</option>${Object.entries(STAGES).map(([k, v]) => `<option value="${k}"${S.stage === k ? ' selected' : ''}>${v.label}</option>`).join('')}</select></div>
      <div class="field"><label class="dim small" for="f-site">Site</label><select class="input" id="f-site">
        <option value="">All sites</option>${S.sites.map(w => `<option value="${w.id}"${String(S.site) === String(w.id) ? ' selected' : ''}>${esc(w.name)}</option>`).join('')}</select></div>
      <div class="field"><label class="dim small" for="f-risk">Risk</label><select class="input" id="f-risk">
        <option value="">Any</option>${['low', 'medium', 'high'].map(r => `<option${S.risk === r ? ' selected' : ''}>${r}</option>`).join('')}</select></div>
      <label class="chip${S.mine ? ' on' : ''}" style="align-self:end"><input type="checkbox" id="f-mine" ${S.mine ? 'checked' : ''} style="accent-color:var(--accent)"> Needs approval only</label>
    </div>
    <div class="row" id="chips" style="margin-bottom:8px"></div>
    <div class="row" id="saved" style="margin-bottom:8px">${SAVED.map(([k, l]) => `<button class="chip${S.saved === k ? ' on' : ''}" data-saved="${k}">${l}</button>`).join('')}</div>
    <div id="bulk" class="row" hidden style="margin-bottom:8px"></div>
    <div id="issue-list"></div>
    <div class="center mt"><button class="btn ghost" id="more" hidden>Load more</button></div></div></div>`;
  const syncUrl = () => {
    const p = {};
    if (S.q) p.q = S.q; if (S.stage) p.stage = S.stage; if (S.site) p.site = S.site;
    if (S.risk) p.risk = S.risk; if (S.mine) p.mine = '1'; if (S.saved !== 'all') p.saved = S.saved;
    history.replaceState(null, '', link('/issues', p));
  };
  const load = async (reset) => {
    if (reset) { S.items = []; S.cursor = null; S.selected.clear(); }
    const qp = { limit: '50' };
    if (S.mine || S.saved === 'needsme') qp.status = 'AWAITING_APPROVAL';
    else if (S.saved === 'auto') qp.status = 'RESOLVED_AND_DEPLOYED';
    if (S.site) qp.site = S.site;
    if (S.q) qp.q = S.q;
    if (S.cursor) qp.cursor = S.cursor;
    // stage filter: map 7 stages -> backend statuses (client-side when mixed)
    const list = main.querySelector('#issue-list');
    if (!S.items.length) list.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
    try {
      const j = await api('/api/issues?' + new URLSearchParams(qp));
      let got = j.issues;
      if (S.stage) got = got.filter(i => (stageOf(i.status) || '') === S.stage);
      S.items = S.items.concat(got);
      // Risk band needs each issue's patch score (list API has none): fetch
      // details lazily, only when the filter is active, and cache per issue.
      if (S.risk) await applyRiskFilter();
      // crude: if backend paginates, keep cursor; stage/risk filters apply per page
      S.cursor = j.nextCursor;
      renderList(main); paintChips(main);
      main.querySelector('#more').hidden = !j.nextCursor;
      const more = main.querySelector('#more');
      more.onclick = async () => { more.disabled = true; await load(false); more.disabled = false; };
    } catch (e) { list.innerHTML = callout('bad', "Couldn't load issues", esc(e.message)); }
    syncUrl();
  };
  let deb = null;
  main.querySelector('#f-q').oninput = e => { clearTimeout(deb); deb = setTimeout(() => { S.q = e.target.value; load(true); }, 300); };
  main.querySelector('#f-stage').onchange = e => { S.stage = e.target.value; load(true); };
  main.querySelector('#f-site').onchange = e => { S.site = e.target.value; store.setScopedSite(e.target.value || null); load(true); };
  main.querySelector('#f-risk').onchange = e => { S.risk = e.target.value; load(true); };
  main.querySelector('#f-mine').onchange = e => { S.mine = e.target.checked ? '1' : ''; load(true); };
  main.querySelectorAll('[data-saved]').forEach(b => b.onclick = () => {
    S.saved = b.dataset.saved;
    if (S.saved === 'needsme') { S.mine = '1'; } else S.mine = '';
    if (S.saved === 'failed') S.stage = 'stuck'; else if (S.saved !== 'all') S.stage = '';
    main.querySelector('#f-mine').checked = !!S.mine;
    main.querySelector('#f-stage').value = S.stage;
    main.querySelectorAll('[data-saved]').forEach(x => x.classList.toggle('on', x === b));
    load(true);
  });
  main.querySelector('#csv-btn').onclick = () => {
    const rows = [['id', 'title', 'status', 'site', 'occurrences', 'updated']].concat(S.items.map(i => [i.id, `"${String(i.title).replace(/"/g, '""')}"`, i.status, i.website_id, i.occurrences, i.updated_at]));
    const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'bugshield-issues.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  main.querySelector('#density-btn').onclick = () => {
    import('../core/store.js').then(({ store }) => {
      store.setDensity(store.density === 'compact' ? 'comfortable' : 'compact');
      document.querySelectorAll('table.tbl').forEach(t => t.classList.toggle('compact', store.density === 'compact'));
    });
  };
  const off = onEvent(m => {
    if (typingNow()) return;
    if (['ISSUE_UPDATED', 'APPROVAL_NEEDED', 'PIPELINE_STEP'].includes(m.type)) load(true);
  });
  await load(true);
  refreshIcons(main);
  return () => { off(); };
}

const riskCache = new Map();
async function applyRiskFilter() {
  await Promise.all(S.items.map(async i => {
    if (riskCache.has(i.id)) return;
    try {
      const d = await api('/api/issues/' + i.id);
      const p = (d.patches || [])[0];
      const s = Number(p?.risk_score ?? (d.kase?.risk?.score ?? 0));
      riskCache.set(i.id, s >= 70 ? 'high' : s >= 40 ? 'medium' : 'low');
    } catch { riskCache.set(i.id, 'low'); }
  }));
  S.items = S.items.filter(i => riskCache.get(i.id) === S.risk);
}

function renderList(main) {
  const list = main.querySelector('#issue-list');
  list.innerHTML = `<table class="tbl stacked"><thead><tr><th scope="col"><input type="checkbox" id="sel-all" aria-label="Select all"></th><th scope="col">Issue</th><th scope="col">Stage</th><th scope="col">Site</th><th scope="col" class="num">Reports</th><th scope="col">Updated</th><th></th></tr></thead><tbody>
    ${S.items.map(i => `<tr data-row="${i.id}">
      <td><input type="checkbox" data-sel="${i.id}" ${S.selected.has(i.id) ? 'checked' : ''} aria-label="Select ${i.id}"></td>
      <td><a href="#/issues/${i.id}">${esc(i.title)}</a><br><span class="mono dim">${esc(i.id)}</span></td>
      <td>${stagePill(i.status)}</td><td>${i.website_id ?? '—'}</td>
      <td class="num">${i.occurrences > 1 ? `<b>${i.occurrences}×</b>` : '1'}</td>
      <td>${relTime(i.updated_at)}</td>
      <td class="rowact"><button class="icon-btn" data-eye="${i.id}" aria-label="Quick view">${icon('eye')}</button></td></tr>`).join('')}</tbody></table>`;
  if (!S.items.length) {
    list.innerHTML = `<div class="card">${emptyState('bug', 'No reports yet', 'When a visitor reports a bug with your widget, it will show up here.', `<a class="btn ghost" href="#/websites">Open widget setup</a>`)}</div>`;
    main.querySelector('#bulk').hidden = true;
    refreshIcons(main);
    return;
  }
  list.querySelector('#sel-all').onchange = e => {
    S.items.forEach(i => e.target.checked ? S.selected.add(i.id) : S.selected.delete(i.id));
    renderList(main);
  };
  list.querySelectorAll('[data-sel]').forEach(c => c.onchange = () => {
    c.checked ? S.selected.add(c.dataset.sel) : S.selected.delete(c.dataset.sel);
    paintBulk(main);
  });
  list.querySelectorAll('[data-eye]').forEach(b => b.onclick = () => quickView(b.dataset.eye));
  list.querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('dblclick', () => navigate('#/issues/' + tr.dataset.row)));
  paintBulk(main);
  refreshIcons(main);
}

function paintChips(main) {
  const box = main.querySelector('#chips');
  const chips = [];
  if (S.q) chips.push(['q', `Search: ${S.q}`]);
  if (S.stage) chips.push(['stage', `Stage: ${S.stage}`]);
  if (S.site) chips.push(['site', `Site #${S.site}`]);
  if (S.risk) chips.push(['risk', `Risk: ${S.risk}`]);
  box.innerHTML = chips.map(([k, l]) => `<span class="chip on">${esc(l)}<button data-rm="${k}" aria-label="Remove filter">${icon('x')}</button></span>`).join('') +
    (chips.length ? `<button class="btn ghost sm" id="clr">Clear filters</button>` : '');
  box.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => {
    const k = b.dataset.rm;
    if (k === 'q') { S.q = ''; main.querySelector('#f-q').value = ''; }
    if (k === 'stage') { S.stage = ''; main.querySelector('#f-stage').value = ''; }
    if (k === 'site') { S.site = ''; main.querySelector('#f-site').value = ''; }
    if (k === 'risk') { S.risk = ''; main.querySelector('#f-risk').value = ''; }
    issuesViewRefresh(main);
  });
  const clr = box.querySelector('#clr');
  if (clr) clr.onclick = () => {
    S.q = S.stage = S.site = S.risk = S.mine = ''; S.saved = 'all';
    main.querySelector('#f-q').value = '';
    main.querySelector('#f-stage').value = '';
    main.querySelector('#f-site').value = '';
    main.querySelector('#f-risk').value = '';
    issuesViewRefresh(main);
  };
  refreshIcons(box);
}
async function issuesViewRefresh(main) {
  // re-run current file's loader by re-navigating to same query
  const p = {};
  if (S.q) p.q = S.q; if (S.stage) p.stage = S.stage; if (S.site) p.site = S.site;
  if (S.risk) p.risk = S.risk; if (S.mine) p.mine = '1';
  navigate('#/issues?' + new URLSearchParams(p).toString());
}

function paintBulk(main) {
  const bar = main.querySelector('#bulk');
  if (!S.selected.size) { bar.hidden = true; return; }
  bar.hidden = false;
  bar.innerHTML = `<b>${S.selected.size} selected</b>
    <button class="btn ghost sm" id="bk-retry">${icon('rotate-ccw')} Re-run</button>
    <button class="btn ghost sm" id="bk-exp">${icon('download')} Export</button>`;
  bar.querySelector('#bk-retry').onclick = async () => {
    for (const id of S.selected) {
      try { await api(`/api/issues/${id}/retry`, { method: 'POST', body: '{}' }); } catch (e) { toast(e.message, { type: 'bad' }); break; }
    }
    toast('Re-queued ' + S.selected.size + ' issue(s)', { type: 'ok' });
  };
  bar.querySelector('#bk-exp').onclick = () => main.querySelector('#csv-btn').click();
  refreshIcons(bar);
}

async function quickView(id) {
  const { openDrawer } = await import('../components/overlays.js');
  const d = await api('/api/issues/' + id).catch(() => null);
  if (!d) { toast('Could not load issue', { type: 'bad' }); return; }
  const node = document.createElement('div');
  const p = (d.patches || [])[0];
  node.innerHTML = `<div class="head-row">${stagePill(d.issue.status)}${riskPill(p?.risk_score)}</div>
    <h2 style="margin:8px 0">${esc(d.issue.title)}</h2>
    <p class="muted small mono">${esc(d.issue.id)} · ${relTime(d.issue.updated_at)}</p>
    <p>${esc(d.issue.description || '')}</p>
    <div class="section-label">Latest steps</div>
    ${(d.steps || []).slice(-5).map(s => `<div class="small">• <b>${esc(s.name)}</b> — ${esc(s.status)}</div>`).join('')}
    <div class="row mt"><a class="btn" href="#/issues/${d.issue.id}">Open full page</a></div>`;
  openDrawer(d.issue.id, node);
}
