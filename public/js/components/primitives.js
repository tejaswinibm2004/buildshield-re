// Pills, 7-stage mapping (A-5), tables, tabs, callouts, empty states.
import { html, esc, raw } from '../core/html.js';
import { icon } from '../core/icons.js';
import { toast } from './overlays.js';

export const STAGES = {
  received: { label: 'Received', tone: 'mut', icon: 'inbox', statuses: ['RECEIVED', 'DEDUPLICATED'] },
  investigating: { label: 'Investigating', tone: 'info', active: true, icon: 'search', statuses: ['TRIAGING', 'ANALYZING'] },
  fixing: { label: 'Fixing', tone: 'acc', active: true, icon: 'wrench', statuses: ['PATCHING', 'VALIDATING'] },
  needsyou: { label: 'Needs you', tone: 'warn', attention: true, icon: 'hand', statuses: ['AWAITING_APPROVAL'] },
  shipping: { label: 'Shipping', tone: 'info', active: true, icon: 'rocket', statuses: ['APPROVED', 'PUSHING', 'DEPLOYING'] },
  live: { label: 'Fixed & live', tone: 'ok', icon: 'check', statuses: ['RESOLVED_AND_DEPLOYED'] },
  closed: { label: 'Closed', tone: 'mut', icon: 'archive', statuses: ['INVALID_REPORT', 'NOT_REPRODUCIBLE_IN_CODE', 'REJECTED_BY_ADMIN', 'ROLLED_BACK'] },
  stuck: { label: 'Stuck', tone: 'bad', icon: 'alert-circle', statuses: ['SOURCE_UNAVAILABLE', 'AI_UNAVAILABLE', 'PATCH_FAILED', 'VALIDATION_FAILED', 'DEPLOY_TIMEOUT', 'FAILED'] },
};
const byStatus = {};
for (const [k, v] of Object.entries(STAGES)) for (const s of v.statuses) byStatus[s] = k;
export function stageOf(status) { return byStatus[status] || null; }
export function stagePill(status) {
  const k = stageOf(status);
  if (!k) return `<span class="pill mut" title="Unknown backend status">${esc(status)}</span>`;
  const st = STAGES[k];
  const glyph = st.active ? `<span class="spin" style="display:inline-flex">${icon('loader')}</span>`
    : st.attention ? `<span class="pdot pulse-dot"></span>` : `<span class="pdot"></span>`;
  return `<span class="pill ${st.tone}" title="${esc(status)}">${glyph}${esc(st.label)}</span>`;
}
export function pill(text, tone = 'mut') { return `<span class="pill ${tone}">${esc(text)}</span>`; }
export function riskPill(score) {
  const s = Number(score ?? 0);
  const tone = s >= 70 ? 'bad' : s >= 40 ? 'warn' : 'ok';
  return `<span class="pill ${tone}">risk ${s}</span>`;
}
export function callout(tone, title, body) {
  const ic = { info: 'info', ok: 'check', warn: 'alert-triangle', bad: 'alert-circle', ai: 'sparkles' }[tone] || 'info';
  return html`<div class="callout ${tone}">${raw(icon(ic))}<div><div class="ct">${title}</div><div class="cb">${body}</div></div></div>`;
}
export function emptyState(ic, title, sub, action = '') {
  return html`<div class="empty"><span class="eic">${raw(icon(ic, 28))}</span><h3>${title}</h3><p>${sub}</p>${action ? raw(action) : ''}</div>`;
}
export function table(headers, rows, { stacked = true, empty = '' } = {}) {
  if (!rows.length) return empty;
  return `<div class="tbl-wrap"><table class="tbl${stacked ? ' stacked' : ''}"><thead><tr>${headers.map(h => `<th${h.num ? ' class="num"' : ''} scope="col">${h.label || h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
export function tabs(list, active, onPick) {
  return `<div class="tabs" role="tablist">${list.map(t => `
    <button class="tab" role="tab" aria-selected="${t.key === active}" data-tab="${t.key}">${t.icon ? icon(t.icon) : ''}${esc(t.label)}${t.count != null ? ` <span class="pill mut">${t.count}</span>` : ''}</button>`).join('')}</div>`;
}
export function wireTabs(root, onPick) {
  const btns = [...root.querySelectorAll('[data-tab]')];
  btns.forEach((b, i) => b.onclick = () => onPick(b.dataset.tab));
  root.addEventListener('keydown', e => {
    const i = btns.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
  });
}
export function kvList(pairs) {
  return `<dl class="kv">${pairs.map(([k, v, mono]) => `<div><dt>${esc(k)}</dt><dd class="${mono ? 'mono' : ''}">${v}</dd></div>`).join('')}</dl>`;
}
export function codeBlock(code, { lang = '', copy = true } = {}) {
  const id = 'cb' + Math.random().toString(36).slice(2);
  setTimeout(() => {
    const b = document.getElementById(id);
    if (b) b.onclick = () => {
      navigator.clipboard?.writeText(code).then(() => {
        b.innerHTML = `${icon('check')} Copied`;
        setTimeout(() => { b.innerHTML = `${icon('copy')} Copy`; }, 1600);
      }).catch(() => toast('Copy failed', { type: 'bad' }));
    };
  }, 0);
  return `<div><div class="code-head"><span>${esc(lang)}</span><span class="spacer"></span>${copy ? `<button class="icon-btn" id="${id}" aria-label="Copy code">${icon('copy')} Copy</button>` : ''}</div><pre class="code">${esc(code)}</pre></div>`;
}
