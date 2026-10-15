// Inbox (F-1): approval cards with reasons, mini-diff, keyboard flow.
import { html, esc, raw } from '../core/html.js';
import { api } from '../core/api.js';
import { relTime } from '../core/format.js';
import { icon, refreshIcons } from '../core/icons.js';
import { stagePill, riskPill, emptyState, callout, tabs, wireTabs } from '../components/primitives.js';
import { toast, confirmDialog } from '../components/overlays.js';
import { navigate } from '../core/router.js';
import { typingNow } from '../core/ws.js';

let tab = 'approval';
let items = [];
let focusIdx = 0;

export async function inboxView(main, params) {
  tab = params.get('tab') || 'approval';
  main.innerHTML = `<div class="page page-enter"><div class="page-head">
    <div class="head-row"><h1>Inbox</h1><span id="inbox-count"></span></div>
    <p class="desc">Fixes waiting on a human. Everything else runs on its own.</p>
    <div id="inbox-tabs"></div></div><div id="inbox-list"></div></div>`;
  main.querySelector('#inbox-tabs').innerHTML = tabs([
    { key: 'approval', label: 'Needs approval', icon: 'hand' },
    { key: 'stuck', label: 'Stuck', icon: 'alert-circle' },
    { key: 'new', label: 'New reports', icon: 'inbox' },
  ], tab);
  wireTabs(main, t => navigate('#/inbox?tab=' + t));
  await load(main);
  refreshIcons(main);
  return () => { document.onkeydown = null; };
}

async function load(main) {
  const list = main.querySelector('#inbox-list');
  list.innerHTML = '<div class="skel"></div><div class="skel"></div>';
  try {
    if (tab === 'approval') {
      const j = await api('/api/issues?status=AWAITING_APPROVAL&limit=50');
      items = j.issues;
    } else if (tab === 'stuck') {
      const all = await api('/api/issues?limit=100');
      items = all.issues.filter(i => ['SOURCE_UNAVAILABLE', 'AI_UNAVAILABLE', 'PATCH_FAILED', 'VALIDATION_FAILED', 'DEPLOY_TIMEOUT', 'FAILED'].includes(i.status));
    } else {
      const all = await api('/api/issues?limit=50');
      items = all.issues.filter(i => ['RECEIVED', 'TRIAGING', 'ANALYZING', 'PATCHING', 'VALIDATING'].includes(i.status));
    }
  } catch (e) {
    list.innerHTML = `<div class="card">${callout('bad', "Couldn't load the inbox", esc(e.message))}</div>`;
    return;
  }
  focusIdx = 0;
  main.querySelector('#inbox-count').innerHTML = items.length ? `<span class="pill warn">${items.length} need you</span>` : '';
  if (!items.length) {
    const empty = tab === 'approval'
      ? { ic: 'shield-check', t: "You're all caught up", s: 'No fixes are waiting for you. BugShield is handling everything else automatically.' }
      : tab === 'stuck' ? { ic: 'check', t: 'Nothing is stuck', s: 'Every report is either moving or closed.' }
      : { ic: 'inbox', t: 'No new reports', s: 'Fresh visitor reports will appear here first.' };
    list.innerHTML = `<div class="card">${emptyState(empty.ic, empty.t, empty.s, `<a class="btn ghost" href="#/issues">Go to Issues</a>`)}</div>`;
    refreshIcons(main);
    return;
  }
  if (tab === 'approval') {
    list.innerHTML = `<div class="stagger">${(await Promise.all(items.map(card))).join('')}</div>`;
    wireCards(main);
  } else if (tab === 'stuck') {
    list.innerHTML = items.map(i => `
      <div class="card"><div class="head-row">${stagePill(i.status)}<b>${esc(i.title)}</b>
      <span style="margin-left:auto" class="dim mono small">${esc(i.id)}</span></div>
      <p class="muted small">${esc(i.status_reason || 'No details recorded.')}</p>
      <div class="row"><a class="btn ghost sm" href="#/issues/${i.id}">Open</a>
      <button class="btn secondary sm" data-retry="${i.id}">${icon('rotate-ccw')} Retry</button></div></div>`).join('');
    list.querySelectorAll('[data-retry]').forEach(b => b.onclick = async () => {
      try { await api(`/api/issues/${b.dataset.retry}/retry`, { method: 'POST', body: '{}' }); toast('Pipeline re-queued', { type: 'ok' }); }
      catch (e) { toast(e.message, { type: 'bad' }); }
    });
  } else {
    list.innerHTML = `<div class="card"><table class="tbl stacked"><thead><tr><th>Report</th><th>Status</th><th>Updated</th></tr></thead><tbody>
      ${items.map(i => `<tr><td><a href="#/issues/${i.id}">${esc(i.title)}</a><br><span class="mono dim">${esc(i.id)}</span></td>
      <td>${stagePill(i.status)}</td><td>${relTime(i.updated_at)}</td></tr>`).join('')}</tbody></table></div>`;
  }
  refreshIcons(main);
}

async function card(i) {
  let detail = {};
  try { detail = await api('/api/issues/' + i.id); } catch { detail = {}; }
  const kase = detail.kase || {};
  const risk = kase.risk || {};
  const p = (detail.patches || [])[0];
  const reasons = [];
  for (const f of risk.factors || []) {
    if (/sensitive|approve|gate|concern|threshold|score \d+ >=/i.test(f.reason)) reasons.push(f.reason);
  }
  if (!reasons.length && (detail.issue?.status_reason || i.status_reason)) reasons.push(detail.issue?.status_reason || i.status_reason);
  const diff = p?.diff_text || '';
  const changed = diff.split('\n').filter(l => (l.startsWith('+') || l.startsWith('-')) && !l.startsWith('+++') && !l.startsWith('---')).slice(0, 12);
  return `<div class="card card-attention appr-card" data-card="${i.id}" tabindex="0">
    <div class="strip">Needs your decision</div>
    <div class="head-row">${stagePill('AWAITING_APPROVAL')}${riskPill(risk.score)}
      <span class="chip">${esc(detail.issue?.website_id ? 'Site #' + detail.issue.website_id : '')}</span>
      <span style="margin-left:auto" class="dim small">${relTime(i.updated_at)}</span></div>
    <h2 style="margin:8px 0 0"><a href="#/issues/${i.id}" style="color:inherit">${esc(i.title)}</a></h2>
    <div class="mono dim small">${esc(i.id)}</div>
    ${reasons.length ? `<div class="callout warn" style="margin-top:8px"><div><div class="ct">Why it needs you</div><div class="why-chips">${reasons.map(r => `<span class="chip on">${esc(r.length > 90 ? r.slice(0, 90) + '…' : r)}</span>`).join('')}</div></div></div>` : ''}
    <div class="grid2" style="grid-template-columns:1fr 1fr">
      <div><div class="section-label">What the AI found</div>
        <p class="small">${esc(kase.analysis?.explanation?.slice(0, 220) || 'Analysis recorded on the issue page.')}
        ${kase.analysis?.file ? `<br><span class="mono">${esc(kase.analysis.file)}${kase.analysis.line_start ? `:${kase.analysis.line_start}` : ''}</span> · confidence ${Math.round((kase.analysis.confidence ?? 0) * 100)}%` : ''}</p></div>
      <div><div class="section-label">Change preview</div>
        <div class="mini-diff">${changed.map(l => `<div class="${l.startsWith('+') ? 'a' : 'd'}">${esc(l.slice(0, 120))}</div>`).join('') || '<span class="dim">No diff yet</span>'}</div>
        <a href="#/issues/${i.id}" class="small">View full diff</a></div>
    </div>
    <div class="row" style="margin-top:12px">
      <input class="input" data-comment placeholder="Add a note for the audit log (optional)" style="flex:2;min-width:200px" aria-label="Review comment">
      <button class="btn ghost" data-reject style="color:var(--bad)">Reject</button>
      <button class="btn approve" data-approve>Approve &amp; deploy <kbd>A</kbd></button>
    </div></div>`;
}

function wireCards(main) {
  const cards = [...main.querySelectorAll('[data-card]')];
  const focus = () => cards.forEach((c, i) => c.style.setProperty('--focus', i === focusIdx ? 1 : 0));
  cards.forEach(card => {
    const id = card.dataset.card;
    const comment = () => card.querySelector('[data-comment]').value;
    card.querySelector('[data-approve]').onclick = async () => {
      try { await api(`/api/issues/${id}/approve`, { method: 'POST', body: JSON.stringify({ comment: comment() }) }); collapse(card, 'Approved — deploying'); }
      catch (e) { toast(e.message, { type: 'bad' }); }
    };
    card.querySelector('[data-reject]').onclick = async () => {
      const { confirmDialog } = await import('../components/overlays.js');
      if (!await confirmDialog({ title: 'Reject this fix?', body: 'The issue will be closed and nothing will be deployed. You can re-run the pipeline later.', okLabel: 'Reject fix', danger: true })) return;
      try { await api(`/api/issues/${id}/reject`, { method: 'POST', body: JSON.stringify({ comment: comment() }) }); collapse(card, 'Fix rejected'); }
      catch (e) { toast(e.message, { type: 'bad' }); }
    };
  });
  document.onkeydown = e => {
    if (typingNow() || !document.getElementById('inbox-list')) return;
    if (e.key === 'j') { focusIdx = Math.min(cards.length - 1, focusIdx + 1); cards[focusIdx]?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'k') { focusIdx = Math.max(0, focusIdx - 1); cards[focusIdx]?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter' && cards[focusIdx]) location.hash = '#/issues/' + cards[focusIdx].dataset.card;
    if ((e.key === 'a' || e.key === 'A') && cards[focusIdx]) cards[focusIdx].querySelector('[data-approve]').click();
    if ((e.key === 'r' || e.key === 'R') && cards[focusIdx]) cards[focusIdx].querySelector('[data-reject]').click();
  };
}

function collapse(card, msg) {
  card.classList.add('leaving');
  setTimeout(() => { card.style.height = card.offsetHeight + 'px'; requestAnimationFrame(() => { card.style.height = '0'; card.style.margin = '0'; card.style.padding = '0'; }); }, 60);
  setTimeout(() => { card.remove(); toast(msg, { type: 'ok', action: { label: 'Watch live', onClick: () => navigate('#/deployments') } }); }, 300);
}
