// Issue detail (F-4): hero stepper, pinned approval, tabs, side rail.
import { html, esc, raw } from '../core/html.js';
import { api } from '../core/api.js';
import { relTime, exactTime, shortSha } from '../core/format.js';
import { icon, refreshIcons } from '../core/icons.js';
import { stageOf, stagePill, riskPill, emptyState, callout, tabs, wireTabs, kvList, codeBlock } from '../components/primitives.js';
import { toast, confirmDialog, openDrawer } from '../components/overlays.js';
import { stepper, wireStepper } from '../components/stepper.js';
import { diffViewer } from '../components/diff.js';
import { navigate } from '../core/router.js';
import { onEvent, typingNow } from '../core/ws.js';

const TERMINAL = new Set(['RESOLVED_AND_DEPLOYED', 'INVALID_REPORT', 'REJECTED_BY_ADMIN', 'ROLLED_BACK', 'FAILED', 'PATCH_FAILED', 'VALIDATION_FAILED', 'DEPLOY_TIMEOUT', 'NOT_REPRODUCIBLE_IN_CODE', 'SOURCE_UNAVAILABLE', 'AI_UNAVAILABLE']);
let D = null, activeTab = 'overview';

export async function issueView(main, params, id) {
  activeTab = params.get('tab') || 'overview';
  D = await api('/api/issues/' + id).catch(e => ({ error: e.message }));
  if (D.error || !D.issue) {
    main.innerHTML = `<div class="page"><p><a href="#/issues">← Issues</a></p><div class="card">${callout('bad', "Couldn't load this issue", esc(D.error || 'Not found'))}</div></div>`;
    refreshIcons(main);
    return;
  }
  render(main);
  if (!TERMINAL.has(D.issue.status)) {
    const t = setInterval(async () => {
      if (typingNow()) return;
      try {
        const cur = await api('/api/issues/' + id);
        const sig = JSON.stringify([cur.issue.status, cur.steps.length, (cur.patches || []).length, (cur.deployments || []).length]);
        const old = JSON.stringify([D.issue.status, D.steps.length, (D.patches || []).length, (D.deployments || []).length]);
        if (sig !== old) {
          if (cur.issue.status !== D.issue.status && !['AWAITING_APPROVAL'].includes(D.issue.status)) {
            toast('This issue just changed — review the latest before approving', { type: 'warn' });
          }
          D = cur; render(main);
        }
        if (TERMINAL.has(cur.issue.status)) clearInterval(t);
      } catch { /* next tick */ }
    }, 8000);
    const off = onEvent(m => {
      if (m.issueId !== id || typingNow()) return;
      if (['ISSUE_UPDATED', 'APPROVAL_NEEDED', 'PIPELINE_STEP', 'DEPLOY_STATUS'].includes(m.type)) {
        api('/api/issues/' + id).then(cur => { D = cur; render(main); }).catch(() => {});
      }
    });
    return () => { clearInterval(t); off(); };
  }
}

function render(main) {
  const { issue, steps, patches, validations, approvals, deployments } = D;
  const kase = D.kase || {};
  const p = (patches || [])[0];
  const risk = kase.risk || { score: p?.risk_score ?? 0, factors: safeJson(p?.risk_factors, []) };
  const critic = safeJson(p?.critic, {});
  const nowLine = liveLine(issue, steps);
  const awaiting = issue.status === 'AWAITING_APPROVAL';
  main.innerHTML = `<div class="page page-enter">
    <p style="margin:0 0 4px"><a href="#/issues">← Issues</a> <span class="dim">/</span> <span class="mono">${esc(issue.id)}</span></p>
    <div class="page-head"><div class="head-row"><h1 style="max-width:72ch">${esc(issue.title)}</h1>${stagePill(issue.status)}
      <span class="actions" id="head-actions"></span></div>
      <p class="desc mono">Reported ${relTime(issue.created_at)} · updated ${relTime(issue.updated_at)}
      ${issue.occurrences > 1 ? ` · <b>${issue.occurrences} duplicate reports merged</b>` : ''}</p></div>
    <div class="hero-band" id="hero"><div class="card" style="margin-bottom:12px">
      ${stepper(steps, issue.status, { onNode: true, nowLine })}</div></div>
    <div id="appr-slot"></div>
    ${issue.status_reason ? callout(issue.status === 'AWAITING_APPROVAL' ? 'warn' : 'info', 'Status note', esc(issue.status_reason)) : ''}
    <div id="detail-tabs"></div>
    <div class="grid2" style="grid-template-columns:minmax(0,8fr) minmax(0,4fr)" id="detail-grid"><div id="tab-body"></div><div id="rail"></div></div>
    <div class="sticky-actions${awaiting ? ' show' : ''}" id="sticky-bar"></div>
  </div>`;
  main.querySelector('#detail-tabs').innerHTML = tabs([
    { key: 'overview', label: 'Overview', icon: 'file-text' },
    { key: 'fix', label: 'Fix', icon: 'file-diff', count: p ? undefined : null },
    { key: 'validation', label: 'Validation', icon: 'check' },
    { key: 'deployment', label: 'Deployment', icon: 'rocket' },
    { key: 'activity', label: 'Activity', icon: 'clock' },
  ].filter(t => t.key !== 'fix' || p), activeTab);
  wireTabs(main, t => {
    activeTab = t;
    history.replaceState(null, '', '#/issues/' + issue.id + (t === 'overview' ? '' : '?tab=' + t));
    renderTab(main);
  });
  wireStepper(main, node => {
    const map = { received: 'overview', locate: 'overview', analyze: 'overview', risk: 'fix', fix: 'fix', validate: 'validation', approve: 'overview', deploy: 'deployment', live: 'deployment' };
    if ((map[node] || 'overview') !== activeTab) {
      activeTab = map[node] || 'overview';
      history.replaceState(null, '', '#/issues/' + issue.id + (activeTab === 'overview' ? '' : '?tab=' + activeTab));
      render(main);
    }
    document.getElementById('tab-body')?.scrollIntoView({ block: 'nearest' });
  });
  renderApproval(main);
  renderTab(main);
  renderRail(main);
  renderHeadActions(main);
  const hero = main.querySelector('#hero');
  const onScroll = () => hero.classList.toggle('compact', document.getElementById('main').scrollTop > 320);
  document.getElementById('main').addEventListener('scroll', onScroll);
  refreshIcons(main);
}

function liveLine(issue, steps) {
  const last = steps[steps.length - 1];
  if (issue.status === 'AWAITING_APPROVAL') return 'Paused — waiting for a human decision.';
  if (TERMINAL.has(issue.status)) return '';
  if (!last) return 'Report received — starting analysis…';
  const where = { analyzer: 'the report against your code', patcher: 'a minimal fix', validator: 'the fix with real checks', deployer: 'the commit' };
  return `Working: ${last.name} — ${where[last.name] || last.summary || 'in progress…'}`;
}

function renderApproval(main) {
  const { issue } = D;
  const slot = main.querySelector('#appr-slot');
  const bar = main.querySelector('#sticky-bar');
  if (issue.status !== 'AWAITING_APPROVAL') { slot.innerHTML = ''; bar.innerHTML = ''; return; }
  const p = (D.patches || [])[0];
  const risk = D.kase?.risk || {};
  const reasons = [...new Set([...(risk.factors || []).filter(f => /sensitive|approv|gate|concern|threshold/i.test(f.reason)).map(f => f.reason), issue.status_reason].filter(Boolean))].slice(0, 5);
  const body = `
    <div class="card card-attention"><div class="strip">Approval needed — the pipeline is paused</div>
      <div class="head-row">${stagePill(issue.status)}${riskPill(risk.score)}<span class="dim small">Nothing ships without you</span></div>
      ${reasons.length ? `<div class="why-chips" style="margin-top:8px">${reasons.map(r => `<span class="chip on">${esc(r.length > 80 ? r.slice(0, 80) + '…' : r)}</span>`).join('')}</div>` : ''}
      <div class="row" style="margin-top:12px">
        <input class="input" id="ap-c" placeholder="Add a note for the audit log (recommended)" style="flex:2;min-width:200px" aria-label="Review comment">
        <button class="btn ghost" id="ap-no" style="color:var(--bad)">Reject</button>
        <button class="btn approve" id="ap-ok">Approve &amp; deploy <kbd>A</kbd></button>
      </div></div>`;
  slot.innerHTML = body;
  bar.innerHTML = `<button class="btn ghost" data-b="no" style="color:var(--bad)">Reject</button><button class="btn approve" data-b="ok">Approve &amp; deploy</button>`;
  const comment = () => main.querySelector('#ap-c')?.value || '';
  const approve = async () => {
    try { await api(`/api/issues/${issue.id}/approve`, { method: 'POST', body: JSON.stringify({ comment: comment() }) }); toast('Approved — deploying', { type: 'ok', action: { label: 'Watch live', onClick: () => {} } }); }
    catch (e) { toast(e.message, { type: 'bad' }); }
  };
  const reject = async () => {
    if (!await confirmDialog({ title: 'Reject this fix?', body: 'The issue will be closed and nothing will be deployed. You can re-run the pipeline later.', okLabel: 'Reject fix', danger: true })) return;
    try { await api(`/api/issues/${issue.id}/reject`, { method: 'POST', body: JSON.stringify({ comment: comment() }) }); toast('Fix rejected', { type: 'ok' }); }
    catch (e) { toast(e.message, { type: 'bad' }); }
  };
  main.querySelector('#ap-ok').onclick = approve;
  main.querySelector('#ap-no').onclick = reject;
  bar.querySelector('[data-b="ok"]').onclick = approve;
  bar.querySelector('[data-b="no"]').onclick = reject;
}

function renderTab(main) {
  const { issue, steps, patches, validations, approvals, deployments } = D;
  const kase = D.kase || {};
  const p = (patches || [])[0];
  const el = main.querySelector('#tab-body');
  if (activeTab === 'fix' && !p) activeTab = 'overview';
  if (activeTab === 'overview') {
    const a = kase.analysis;
    el.innerHTML = `
      <div class="card"><h2>Report</h2>
        <blockquote style="border-left:3px solid var(--line-3);margin:0 0 12px;padding-left:12px">${esc(issue.description || '—')}</blockquote>
        ${issue.steps ? `<div class="section-label">Steps to reproduce</div><p>${esc(issue.steps)}</p>` : ''}
        ${issue.page_url ? `<p><a href="${esc(issue.page_url)}" target="_blank" rel="noopener">${icon('external-link')} ${esc(issue.page_url)}</a></p>` : ''}</div>
      ${a ? `<div class="card"><div class="strip" style="display:flex;gap:8px;align-items:center">${icon('sparkles')} AI analysis</div>
        <div class="head-row" style="margin-top:12px">${a.is_defect ? '<span class="pill ok">Real defect</span>' : '<span class="pill mut">Not a defect</span>'}
          <span class="dim small">confidence ${Math.round((a.confidence ?? 0) * 100)}%</span>
          <span class="chip mono">${esc(a.defect_type || 'other')}</span></div>
        <div class="mt"><div class="section-label">Confidence</div>
          <div class="progress ${a.confidence >= 0.7 ? 'ok' : ''}"><i style="width:${Math.round((a.confidence ?? 0) * 100)}%"></i></div></div>
        ${a.file ? `<p class="mt mono">Location: ${esc(a.file)}${a.line_start ? `:${a.line_start}–${a.line_end}` : ''}</p>` : ''}
        ${a.user_visible_impact ? `<div class="section-label">What the user sees</div><p>${esc(a.user_visible_impact)}</p>` : ''}
        ${a.explanation ? `<div class="section-label">Why the AI thinks so</div><p>${esc(a.explanation)}</p>` : ''}
      </div>` : ''}
      <div class="card"><h2>Captured context</h2>${contextBlock()}</div>
      <div class="card"><h2>Step log</h2>${steps.length ? steps.map(s => `
        <details style="margin-bottom:8px"><summary><b class="mono">${esc(s.name)}</b> — ${esc(s.status)}
          <span class="dim small">${s.started_at ? relTime(s.started_at) : ''}</span></summary>
          ${s.summary ? `<p class="small">${esc(s.summary)}</p>` : ''}${evidenceBlock(s.evidence)}</details>`).join('')
        : '<p class="dim">No steps yet.</p>'}</div>`;
  } else if (activeTab === 'fix' && p) {
    const risk = kase.risk || { score: p.risk_score ?? 0, factors: safeJson(p.risk_factors, []) };
    const critic = safeJson(p.critic, {});
    const maxF = Math.max(1, ...(risk.factors || []).map(f => Math.abs(f.points || 0)));
    el.innerHTML = `
      <div class="card"><div class="head-row"><h2 style="margin:0">Proposed fix</h2>${riskPill(risk.score)}</div>
        <p>${esc(p.summary)}</p>${diffViewer(p.diff_text || '')}</div>
      <div class="card"><h2>Why this risk score</h2>
        <div class="gauge"><svg width="120" height="66" viewBox="0 0 120 66" role="img" aria-label="Risk ${risk.score} of 100">
          ${gaugeArc(risk.score)}</svg><span class="gv">${risk.score}</span></div>
        ${(risk.factors || []).map(f => `<div class="factor${f.points < 0 ? ' neg' : ''}"><span>${esc(f.reason)}</span><b>${f.points > 0 ? '+' : ''}${f.points}</b>
          <span class="bar"><i style="width:${Math.min(100, Math.round(Math.abs(f.points) / maxF * 100))}%"></i></span></div>`).join('') || '<p class="dim">No factor breakdown recorded.</p>'}
        <p class="dim small">Thresholds: low &lt; 40 · medium 40–69 · high ≥ 70. Security-sensitive changes always need a human.</p></div>
      <div class="card"><div class="head-row"><h2 style="margin:0">Independent review</h2>
        ${critic.verdict ? `<span class="pill ${critic.verdict === 'approve' ? 'ok' : critic.verdict === 'concern' ? 'warn' : 'bad'}">${esc(critic.verdict)}</span>` : '<span class="dim">No review recorded.</span>'}</div>
        ${(critic.concerns || []).length ? `<ul>${critic.concerns.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
        <div class="section-label">Safety scanner</div>
        ${(critic.scanHits || []).length
          ? `<div class="callout warn"><div><div class="ct">${critic.scanHits.length} hit(s) on added lines</div><div class="cb">${critic.scanHits.map(h => esc(h.rule + ' — ' + h.reason)).join('; ')}</div></div></div>`
          : `<ul class="checklist">
            ${['No new URLs or domains', 'No script tags or inline handlers', 'No eval or obfuscation', 'No dependency or config changes'].map(t => `<li>${icon('check')}<span>${t}</span></li>`).join('')}</ul>`}
      </div>`;
  } else if (activeTab === 'validation') {
    el.innerHTML = `<div class="card"><h2>Validation evidence</h2>
      ${validations.length ? `<table class="tbl stacked"><thead><tr><th>Check</th><th>Result</th><th>Details</th></tr></thead><tbody>
        ${validations.map(v => `<tr><td class="mono">${esc(v.validator_id)}</td>
          <td>${v.status === 'passed' ? '<span class="pill ok">Passed</span>' : v.status === 'failed' ? '<span class="pill bad">Failed</span>' : '<span class="pill mut">Not performed</span>'}</td>
          <td>${prettyDetails(v.details)}</td></tr>`).join('')}</tbody></table>
        <p class="dim small">A check that could not run is never counted as passed — it is shown as "Not performed" with its reason.</p>`
      : '<p class="dim">No validation runs yet.</p>'}</div>`;
  } else if (activeTab === 'deployment') {
    el.innerHTML = `<div class="card"><h2>Deployment</h2>
      ${deployments.length ? deployments.map(x => `
        <div class="head-row"><span class="pill ${x.status === 'live' ? 'ok' : x.status === 'reverted' ? 'warn' : x.status === 'timeout' ? 'bad' : 'info'}">${esc(x.status)}</span>
        <span class="mono">${esc((x.commit_sha || '').slice(0, 7))}</span>
        ${x.commit_url ? `<a href="${esc(x.commit_url)}" target="_blank" rel="noopener">${icon('external-link')} GitHub</a>` : ''}
        <span class="dim small">branch ${esc(x.branch)}</span></div>
        ${x.commit_sha ? '' : ''}
        <ol class="checklist">
          ${liveChecklist(x).map(([ok, t, ts]) => `<li>${icon(ok === true ? 'check' : ok === false ? 'x' : 'minus')}<span>${t}${ts ? ` <span class="dim">· ${relTime(ts)}</span>` : ''}</span></li>`).join('')}
        </ol>
        ${x.reverted_by_sha ? `<p class="dim small">Reverted in ${esc(x.reverted_by_sha.slice(0, 7))}</p>` : ''}`).join('')
      : '<p class="dim">Nothing deployed for this issue yet.</p>'}
      ${deployments.some(x => x.status === 'live' || x.status === 'pushed') ? `<div class="row"><button class="btn ghost" id="dp-revert" style="color:var(--bad)">${icon('undo-2')} Revert this fix</button></div>` : ''}</div>`;
    const rv = el.querySelector('#dp-revert');
    if (rv) rv.onclick = async () => {
      const { confirmDialog } = await import('../components/overlays.js');
      if (!await confirmDialog({ title: 'Revert this fix?', body: 'BugShield will push a new commit that undoes it. Your site will redeploy in a few minutes.', okLabel: 'Revert fix', danger: true })) return;
      try { const j = await api(`/api/issues/${issue.id}/revert`, { method: 'POST', body: JSON.stringify({ reason: 'manual revert from dashboard' }) }); toast('Reverted in ' + (j.sha || '').slice(0, 7), { type: 'ok' }); }
      catch (e) { toast(e.message, { type: 'bad' }); }
    };
  } else if (activeTab === 'activity') {
    const acts = [
      ...steps.map(s => ({ t: s.started_at, who: 'AI', what: `Step ${s.name}: ${s.status}`, target: '' })),
      ...(approvals.map(a => ({ t: a.created_at, who: 'human', what: a.decision === 'approved' ? 'Approved the fix' : 'Rejected the fix', target: a.comment || '' }))),
    ].sort((a, b) => new Date(a.t) - new Date(b.t));
    el.innerHTML = `<div class="card"><h2>Activity</h2>
      ${acts.length ? acts.map(a => `<div class="feed"><div class="fi">${icon(a.who === 'AI' ? 'sparkles' : 'user')}
        <div><b>${a.who === 'AI' ? 'BugShield AI' : 'Reviewer'}</b> ${esc(a.what)}${a.target ? ` <span class="dim">— ${esc(a.target)}</span>` : ''}</div>
        <span style="margin-left:auto" class="dim small">${relTime(a.t)}</span></div></div>`).join('')
      : '<p class="dim">No activity yet.</p>'}</div>`;
  }
  refreshIcons(el);
}

function liveChecklist(x) {
  let h = {};
  try { h = JSON.parse(x.health_result || '{}'); } catch {}
  const verified = !!x.live_verified_at;
  return [
    [true, 'Fix committed to GitHub', x.created_at],
    [x.status === 'live' || verified ? true : x.status === 'timeout' ? false : null, 'Host rebuilt the site', verified ? x.live_verified_at : null],
    [verified ? true : x.status === 'timeout' ? false : null, verified ? 'version.json reports the new commit' : (h.reason || 'Waiting for the commit to go live'), verified ? x.live_verified_at : null],
    [h.health?.ok === true ? true : h.health?.ok === false ? false : null, 'Health probes ' + (h.health ? `(${(h.health.codes || []).join(', ')})` : 'pending'), verified ? x.live_verified_at : null],
  ];
}

function renderRail(main) {
  const { issue } = D;
  const kase = D.kase || {};
  main.querySelector('#rail').innerHTML = `
    <div class="card"><h3>Details</h3>${kvList([
      ['Site', issue.website_id ? `<a href="#/websites/${issue.website_id}">#${issue.website_id}</a>` : '—'],
      ['Branch', esc(issue.branch || D.site?.branch || 'main'), true],
      ['Risk', String(kase.risk?.score ?? '—'), true],
      ['Confidence', kase.analysis ? Math.round((kase.analysis.confidence ?? 0) * 100) + '%' : '—', true],
      ['First seen', relTime(issue.created_at)],
      ['Last seen', relTime(issue.updated_at)],
      ['Reports', String(issue.occurrences ?? 1), true],
    ])}</div>
    <div class="card"><h3>Raw status</h3><p class="mono small">${esc(issue.status)}</p>
    <p class="dim small">User-facing stage: ${(stageOf(issue.status) || 'unknown')}</p></div>`;
}

function renderHeadActions(main) {
  const { issue } = D;
  const box = main.querySelector('#head-actions');
  if (TERMINAL.has(issue.status) && !['RESOLVED_AND_DEPLOYED'].includes(issue.status)) {
    box.innerHTML = `<button class="btn secondary sm" id="ha-retry">${icon('rotate-ccw')} Retry</button>`;
    box.querySelector('#ha-retry').onclick = async () => {
      try { await api(`/api/issues/${issue.id}/retry`, { method: 'POST', body: '{}' }); toast('Pipeline re-queued', { type: 'ok' }); }
      catch (e) { toast(e.message, { type: 'bad' }); }
    };
  } else if (issue.status === 'RESOLVED_AND_DEPLOYED') {
    box.innerHTML = `<button class="btn ghost sm" id="ha-revert" style="color:var(--bad)">${icon('undo-2')} Revert fix</button>`;
    box.querySelector('#ha-revert').onclick = () => main.querySelector('#dp-revert')?.click() || toast('Open the Deployment tab to revert', { type: 'info' });
  }
  refreshIcons(box);
}

function contextBlock() {
  const { issue } = D;
  let ctx = {}, el = {}, errs = [], net = [];
  try { ctx = JSON.parse(issue.context || '{}'); } catch {}
  try { el = JSON.parse(issue.element || '{}'); } catch {}
  try { errs = JSON.parse(issue.errors || '[]'); } catch {}
  try { net = JSON.parse(issue.network || '[]'); } catch {}
  const rows = [
    ['Page', issue.page_url ? `<a href="${esc(issue.page_url)}" target="_blank" rel="noopener">${esc(issue.page_url)}</a>` : '—'],
    ['Browser', esc(ctx.user_agent || '—')],
    ['Viewport', esc(ctx.viewport || '—')],
    ['Console errors kept', String((Array.isArray(issue.console) ? issue.console : JSON.parse(issue.console || '[]')).length)],
    ['Failed requests', net.length ? net.map(n => `${esc(n.url)} (${n.status})`).join('<br>') : 'none'],
  ];
  return kvList(rows) +
    (el.selector ? `<div class="section-label mt">Picked element</div>
      <p class="mono small">${esc(el.selector)}</p>${el.outer_html ? codeBlock(String(el.outer_html).slice(0, 2000), { lang: 'html' }) : ''}
      ${el.styles ? `<table class="tbl stacked mt"><tbody>${Object.entries(el.styles).map(([k, v]) => `<tr><td class="mono">${esc(k)}</td><td class="mono">${esc(v)}</td></tr>`).join('')}</tbody></table>` : ''}` : '') +
    (errs.length ? `<div class="section-label mt">JS errors</div>${errs.map(e => codeBlock(String(e.stack || e.message || '').slice(0, 1500), { lang: 'js' })).join('')}` : '');
}

function evidenceBlock(evJson) {
  let ev = {};
  try { ev = JSON.parse(evJson || '{}'); } catch {}
  const keys = Object.keys(ev).filter(k => !['hints', 'candidates'].includes(k));
  if (!keys.length) return '';
  const slim = {};
  for (const k of keys.slice(0, 6)) {
    const v = ev[k];
    slim[k] = typeof v === 'string' && v.length > 600 ? v.slice(0, 600) + '…' : v;
  }
  return codeBlock(JSON.stringify(slim, null, 2).slice(0, 2000), { lang: 'json' });
}

function prettyDetails(d) {
  if (d == null) return '<span class="dim">—</span>';
  let o = d;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return esc(o); } }
  return codeBlock(JSON.stringify(o, null, 2).slice(0, 1500), { lang: 'json', copy: false });
}

function safeJson(s, fb) { try { const v = JSON.parse(s || ''); return v ?? fb; } catch { return fb; } }

function gaugeArc(score) {
  const s = Math.max(0, Math.min(100, Number(score || 0)));
  const a0 = Math.PI, a1 = Math.PI + Math.PI * (s / 100);
  const r = 50, cx = 60, cy = 58;
  const pt = a => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = pt(a0), [x1, y1] = pt(a1);
  const col = s >= 70 ? 'var(--bad)' : s >= 40 ? 'var(--warn)' : 'var(--ok)';
  return `<path d="M 10 58 A 50 50 0 0 1 110 58" fill="none" stroke="var(--bg-4)" stroke-width="10" stroke-linecap="round"/>
    <path d="M ${x0} ${y0} A 50 50 0 ${s > 50 ? 1 : 0} 1 ${x1} ${y1}" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round"/>
    <line x1="35" y1="58" x2="35" y2="50" stroke="var(--text-3)" stroke-width="2"/><line x1="85" y1="58" x2="85" y2="50" stroke="var(--text-3)" stroke-width="2"/>`;
}
