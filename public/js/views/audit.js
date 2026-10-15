// Audit log (F-11): filters + expandable detail.
import { html, esc } from '../core/html.js';
import { api } from '../core/api.js';
import { relTime, exactTime } from '../core/format.js';
import { icon, refreshIcons } from '../core/icons.js';
import { emptyState, callout, codeBlock } from '../components/primitives.js';

export async function auditView(main, params) {
  main.innerHTML = `<div class="page page-enter">
    <div class="page-head"><div class="head-row"><h1>Audit log</h1>
    <span class="actions"><button class="btn ghost sm" id="ax-exp">${icon('download')} Export CSV</button></span></div>
    <p class="desc">Every security-relevant action, newest first. Read-only.</p></div>
    <div class="card"><div class="toolbar" style="margin:0 0 8px">
      <div class="field" style="flex:2;min-width:200px"><span class="input-wrap"><span class="lead">${icon('search')}</span>
        <input class="input" id="a-q" placeholder="Search actor, action, target…" value="${esc(params.get('q') || '')}" aria-label="Filter audit log"></span></div>
      <div class="field"><label class="dim small">Actor</label><select class="input" id="a-actor"><option value="">Anyone</option></select></div>
      <div class="field"><label class="dim small">Action</label><select class="input" id="a-act"><option value="">Anything</option></select></div>
    </div><div id="a-list"></div></div></div>`;
  let rows = [];
  try {
    rows = (await api('/api/audit')).audit || [];
  } catch (e) {
    main.querySelector('#a-list').innerHTML = callout('bad', "Couldn't load the audit log", esc(e.message));
    return;
  }
  const actors = [...new Set(rows.map(r => r.actor))].sort();
  const acts = [...new Set(rows.map(r => r.action))].sort();
  main.querySelector('#a-actor').innerHTML += actors.map(a => `<option>${esc(a)}</option>`).join('');
  main.querySelector('#a-act').innerHTML += acts.map(a => `<option>${esc(a)}</option>`).join('');
  const draw = () => {
    const q = main.querySelector('#a-q').value.toLowerCase();
    const fa = main.querySelector('#a-actor').value;
    const fc = main.querySelector('#a-act').value;
    const out = rows.filter(r =>
      (!q || (r.actor + ' ' + r.action + ' ' + r.target + ' ' + (r.detail || '')).toLowerCase().includes(q)) &&
      (!fa || r.actor === fa) && (!fc || r.action === fc));
    main.querySelector('#a-list').innerHTML = out.length ? `<table class="tbl stacked"><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th></th></tr></thead><tbody>
      ${out.map((r, i) => `<tr><td title="${exactTime(r.ts)}">${relTime(r.ts)}</td>
        <td>${r.actor === 'system' || r.actor === 'widget' ? `${icon('sparkles')}` : ''} ${esc(r.actor)}</td>
        <td><span class="chip mono">${esc(r.action)}</span></td>
        <td class="mono">${esc(r.target || '—')}</td>
        <td class="rowact"><button class="icon-btn" data-det="${i}" aria-label="Show details">${icon('chevron-down')}</button></td></tr>
        <tr data-detrow="${i}" hidden><td colspan="5">${r.detail ? codeBlock(JSON.stringify(safeJson(r.detail), null, 2).slice(0, 2000), { lang: 'json', copy: false }) : '<span class="dim">No detail recorded.</span>'}</td></tr>`).join('')}</tbody></table>`
      : emptyState('scroll-text', 'No matching entries', 'Try widening the filters.');
    main.querySelectorAll('[data-det]').forEach(b => b.onclick = () => {
      const row = main.querySelector(`[data-detrow="${b.dataset.det}"]`);
      row.hidden = !row.hidden;
    });
    refreshIcons(main);
  };
  let deb = null;
  main.querySelector('#a-q').oninput = () => { clearTimeout(deb); deb = setTimeout(draw, 250); };
  main.querySelector('#a-actor').onchange = draw;
  main.querySelector('#a-act').onchange = draw;
  main.querySelector('#ax-exp').onclick = () => {
    const csv = [['when', 'actor', 'action', 'target']].concat(rows.map(r => [r.ts, r.actor, r.action, r.target || '']));
    const blob = new Blob([csv.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'bugshield-audit.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  draw();
  refreshIcons(main);
}
function safeJson(s) { try { return JSON.parse(s || '{}'); } catch { return { raw: String(s).slice(0, 500) }; } }
