// Evaluation (F-12): benchmark results with honesty badge.
import { html, esc } from '../core/html.js';
import { icon, refreshIcons } from '../core/icons.js';
import { emptyState, callout, codeBlock } from '../components/primitives.js';

export async function evalView(main) {
  main.innerHTML = `<div class="page page-enter">
    <div class="page-head"><h1>Evaluation</h1>
    <p class="desc">How well BugShield finds and fixes bugs in test projects.</p></div>
    <div id="ev-body"><div class="skel"></div><div class="skel"></div></div></div>`;
  const body = main.querySelector('#ev-body');
  let res = null;
  try {
    const r = await fetch('/benchmark/results.json', { credentials: 'same-origin' });
    if (r.ok) res = await r.json();
  } catch {}
  if (!res) {
    body.innerHTML = `<div class="card">${emptyState('flask-conical', 'No benchmark results yet', 'Run the evaluation corpus in the repo:', codeBlock('npm run eval', { lang: 'bash' }))}</div>`;
    refreshIcons(main);
    return;
  }
  const total = res.results.length;
  const loc = res.results.filter(r => r.localized).length;
  const verdicts = res.results.filter(r => r.verdict).length;
  const gates = res.results.filter(r => String(r.gate || '').includes('✔')).length;
  const langs = res.byLanguage || {};
  const fixture = /fixture|recorded|no AI key|offline/i.test(res.mode || '');
  body.innerHTML = `
    <p><span class="pill ${fixture ? 'mut' : 'acc'}">${fixture ? 'Recorded fixtures (no live model)' : 'Live model'}</span>
    <span class="dim small">Benchmark from ${esc(res.date || '')} · ${esc(res.mode || '')}</span></p>
    <div class="stats stagger">
      <div class="stat card"><span class="over">Localization accuracy</span><div class="val">${loc}/${total}</div><div class="foot">${Math.round(loc / Math.max(1, total) * 100)}% found the right file</div></div>
      <div class="stat card"><span class="over">Correct verdicts</span><div class="val">${verdicts}/${total}</div></div>
      <div class="stat card"><span class="over">Safety gates correct</span><div class="val">${gates}</div></div>
      <div class="stat card"><span class="over">Languages covered</span><div class="val">${Object.keys(langs).length}</div></div>
    </div>
    <div class="card"><h2>Per-language results</h2>
      <table class="tbl stacked"><thead><tr><th>Language</th><th>Cases</th><th>Right file</th><th>Recall</th></tr></thead><tbody>
      ${Object.entries(langs).map(([l, v]) => {
        const pct = Math.round(v.localized / v.cases * 100);
        return `<tr><td><span class="chip mono">${esc(l)}</span></td><td class="num">${v.cases}</td><td class="num">${v.localized}</td>
        <td><div class="row"><div class="progress" style="flex:1;min-width:80px;${v.localized === v.cases ? '' : v.localized === 0 ? 'bad' : ''}"><i style="width:${pct}%"></i></div>
        <b>${pct}%</b> ${v.localized === v.cases ? '<span class="pill ok">Full</span>' : v.localized === 0 ? '<span class="pill bad">Miss</span>' : '<span class="pill warn">Partial</span>'}</div></td></tr>`;
      }).join('')}</tbody></table></div>
    <div class="card"><h2>All cases</h2>
      <table class="tbl stacked"><thead><tr><th>Case</th><th>Localized</th><th>Patch</th><th>Validators</th><th>Gate</th></tr></thead><tbody>
      ${res.results.map(r => `<tr><td class="mono">${esc(r.id)}</td>
        <td>${r.localized ? '<span class="pill ok">Yes</span>' : '<span class="pill mut">No</span>'}</td>
        <td>${r.patchApplies ? '<span class="pill ok">Applies</span>' : '<span class="pill bad">Fails</span>'}</td>
        <td>${r.validators ? '<span class="pill ok">Pass</span>' : '<span class="pill bad">Fail</span>'}</td>
        <td class="small">${esc(r.gate || '—')}</td></tr>`).join('')}</tbody></table></div>`;
  refreshIcons(main);
}
