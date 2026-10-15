// Overview (F-2): attention strip, stat tiles, funnel, activity, charts, health.
import { html, esc, raw } from '../core/html.js';
import { api } from '../core/api.js';
import { relTime, fmtNum, fmtDur } from '../core/format.js';
import { icon, refreshIcons } from '../core/icons.js';
import { stagePill, callout, emptyState } from '../components/primitives.js';
import { navigate } from '../core/router.js';

const RANGES = [['24h', 1], ['7d', 7], ['30d', 30]];

export async function overviewView(main, params) {
  const range = params.get('range') || '7d';
  const days = RANGES.find(r => r[0] === range)?.[1] ?? 7;
  main.innerHTML = `<div class="page page-enter">
    <div class="page-head"><div class="head-row"><h1>Overview</h1><span class="actions">
      <span role="group" aria-label="Time range" id="ov-range" style="display:inline-flex;gap:4px">
      ${RANGES.map(([k]) => `<button class="btn ghost sm" data-r="${k}" aria-pressed="${k === range}">${k}</button>`).join('')}</span>
    </span></div><p class="desc">What needs you, how healthy the system is, and what the bot did.</p></div>
    <div id="ov-body"><div class="skel"></div><div class="skel"></div></div></div>`;
  main.querySelectorAll('#ov-range [data-r]').forEach(b => b.onclick = () => navigate('#/overview?range=' + b.dataset.r));
  const body = main.querySelector('#ov-body');
  try {
    const [stats, integ] = await Promise.all([api('/api/stats/overview'), api('/api/settings/integrations-status')]);
    const [issues, audit] = await Promise.all([
      api('/api/issues?limit=100').catch(() => ({ issues: [] })),
      api('/api/audit').catch(() => ({ audit: [] })),
    ]);
    body.innerHTML = render(stats, integ, issues.issues, days, (audit.audit || []).slice(0, 12));
  } catch (e) {
    body.innerHTML = `<div class="card">${callout('bad', "Couldn't load overview", esc(e.message))}</div>`;
  }
  refreshIcons(main);
}

function inDays(iso, days) {
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && (Date.now() - t) < days * 86400000;
}

function render(stats, integ, issues, days, feed) {
  const recent = issues.filter(i => inDays(i.created_at, days));
  const awaiting = issues.filter(i => i.status === 'AWAITING_APPROVAL');
  const live = issues.filter(i => i.status === 'RESOLVED_AND_DEPLOYED');
  // funnel over the range
  const f = {
    reports: recent.length,
    defects: recent.filter(i => !['INVALID_REPORT'].includes(i.status)).length,
    patched: 0, validated: 0, deployed: live.length,
  };
  // auto vs human (from approvals presence is unknown here; use status mix)
  const ai = integ.ai || {}, ghOk = !!(integ.github?.configured);
  const attn = awaiting.length
    ? `<div class="callout warn">${icon('hand')}<div><div class="ct">${awaiting.length} fix${awaiting.length > 1 ? 'es' : ''} waiting on a human</div><div class="cb"><a href="#/inbox">Open Inbox</a> to review.</div></div></div>`
    : (!ai.configured || !ghOk)
      ? `<div class="callout warn">${icon('alert-triangle')}<div><div class="ct">Setup incomplete</div><div class="cb">${!ai.configured ? 'AI key missing — reports will wait honestly. ' : ''}${!ghOk ? 'GitHub token missing — fixes cannot ship. ' : ''}<a href="#/settings">Open Settings</a>.</div></div></div>`
      : `<div class="callout ok">${icon('check')}<div><div class="ct">All systems normal</div><div class="cb">${live.length ? `Last fix went live ${relTime(live.map(i => i.updated_at).sort().pop())}.` : 'No fixes shipped in this period yet.'}</div></div></div>`;
  const max = Math.max(1, f.reports, f.defects, f.deployed);
  const fbar = (n, l) => `<div class="fstep"><div class="bar" style="height:${Math.max(6, Math.round(n / max * 90))}px"></div><div class="n">${n}</div><div class="l">${l}</div></div>`;
  // per-day bars
  const per = Array(days).fill(0);
  for (const i of recent) {
    const d = Math.floor((Date.now() - new Date(i.created_at).getTime()) / 86400000);
    if (d >= 0 && d < days) per[days - 1 - d]++;
  }
  const pm = Math.max(1, ...per);
  const deploys = (stats.lastDeploy || []).slice(0, 6);
  const durs = live.map(i => new Date(i.updated_at) - new Date(i.created_at)).filter(x => x > 0).sort((a, b) => a - b);
  const median = durs.length ? fmtDur(durs[Math.floor(durs.length / 2)]) : '—';
  return `
    ${attn}
    <div class="stats stagger">
      <a class="stat card-link card" href="#/inbox"><span class="over">Needs you</span><div class="val">${awaiting.length}</div><div class="foot">approvals waiting</div></a>
      <a class="stat card-link card" href="#/issues"><span class="over">Open issues</span><div class="val">${fmtNum(issues.filter(i => !['RESOLVED_AND_DEPLOYED','INVALID_REPORT','REJECTED_BY_ADMIN','ROLLED_BACK'].includes(i.status)).length)}</div><div class="foot">${fmtNum(recent.length)} reports / ${days}d</div></a>
      <a class="stat card-link card" href="#/deployments"><span class="over">Fixed &amp; live</span><div class="val">${fmtNum(live.length)}</div><div class="foot">in period</div></a>
      <div class="stat card"><span class="over">Median fix time</span><div class="val" style="font-size:26px">${median}</div><div class="foot">report → live, in period</div></div>
    </div>
    <div class="grid2">
      <div class="card"><h2>Fix pipeline · last ${days}d</h2>
        <div class="funnel">${fbar(f.reports, 'Reports')}${fbar(f.defects, 'Real defects')}${fbar(f.deployed, 'Deployed')}</div>
        <div class="autobar" title="Deployed fixes"><i style="flex:${Math.max(1, f.deployed)};background:var(--ok)"></i></div>
        <p class="dim small">Reports → real defects → deployed. Drop-off between bars is invalid reports and stuck items.</p></div>
      <div class="card"><h2>Live activity</h2><div class="feed">
        ${feed.length ? feed.map(a => `<div class="fi">${icon(a.actor === 'system' || a.actor === 'widget' ? 'sparkles' : 'user')}
          <div><b>${esc(a.actor)}</b> ${esc(a.action)} <span class="mono dim">${esc(a.target)}</span></div>
          <span style="margin-left:auto" class="dim small">${relTime(a.ts)}</span></div>`).join('')
        : '<p class="dim">No activity yet.</p>'}
        <p><a href="#/audit" class="small">View all</a></p></div></div>
    </div>
    <div class="grid2">
      <div class="card"><h2>Reports over time</h2>
        <div class="bars">${per.map((v, i) => `<div class="bcol" title="${v} reports"><div class="bar${i === days - 1 ? ' today' : ''}" style="height:${Math.max(3, Math.round(v / pm * 100))}%"></div></div>`).join('')}</div></div>
      <div class="card"><h2>Recent deployments</h2>
        ${deploys.length ? deploys.map(d => `<div class="feed"><div class="fi">${icon('git-commit')}
          <div><a href="#/issues/${d.issue_id}">${esc(d.issue_id)}</a>
          <span class="mono dim">${esc((d.commit_sha || '').slice(0, 7))}</span>
          ${d.status === 'live' ? '<span class="pill ok">Live</span>' : `<span class="pill mut">${esc(d.status)}</span>`}</div>
          <span style="margin-left:auto" class="dim small">${relTime(d.created_at)}</span></div></div>`).join('')
        : emptyState('rocket', 'Nothing deployed yet', 'Fixes appear here once BugShield commits them.')}</div>
    </div>
    <div class="card"><h2>System health</h2>
      <div class="kv">
        <div><dt>AI provider</dt><dd>${ai.configured ? `<span class="pill ok">Working</span> <span class="mono">${esc(ai.model || '')}</span>` : `<span class="pill bad">Not working</span> <span class="dim">${esc(ai.reason || '')}</span>`}</dd></div>
        <div><dt>GitHub access</dt><dd>${ghOk ? '<span class="pill ok">Working</span>' : '<span class="pill bad">Not working</span>'}</dd></div>
        <div><dt>Queue</dt><dd><span class="pill mut">In-process</span></dd></div>
      </div></div>`;
}
