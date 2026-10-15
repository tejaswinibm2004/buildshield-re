// Command palette (Ctrl/Cmd+K, E-24).
import { api } from '../core/api.js';
import { icon } from '../core/icons.js';
import { navigate } from '../core/router.js';

let open = false;
export function togglePalette() { open ? closePalette() : openPalette(); }
export function closePalette() { document.getElementById('palette-root').innerHTML = ''; open = false; }

export async function openPalette() {
  open = true;
  const root = document.getElementById('palette-root');
  root.innerHTML = `<div class="modal-veil"><div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
    <input id="pal-in" placeholder="Jump to an issue, site, page, or action…" autocomplete="off" aria-label="Command palette">
    <div class="groups" id="pal-groups"></div></div></div>`;
  const input = root.querySelector('#pal-in');
  const groups = root.querySelector('#pal-groups');
  const veil = root.querySelector('.modal-veil');
  veil.addEventListener('mousedown', e => { if (e.target === veil) closePalette(); });
  let items = [];
  let hot = 0;
  const render = () => {
    groups.innerHTML = items.length ? items.map((g, gi) => `
      <div class="glabel">${g.label}</div>${g.items.map((it, ii) => {
        const idx = items.slice(0, gi).reduce((a, x) => a + x.items.length, 0) + ii;
        return `<div class="item${idx === hot ? ' hot' : ''}" data-idx="${idx}">${icon(it.icon)}<span>${it.label}</span>${it.hint ? `<kbd>${it.hint}</kbd>` : ''}</div>`;
      }).join('')}`).join('') : '<div class="glabel">No matches</div>';
    groups.querySelectorAll('.item').forEach(el => {
      el.onclick = () => pick(+el.dataset.idx);
      el.onmouseenter = () => { hot = +el.dataset.idx; render(); };
    });
  };
  const flat = () => items.flatMap(g => g.items);
  const pick = i => { const it = flat()[i]; closePalette(); it?.run(); };
  input.addEventListener('keydown', e => {
    const n = flat().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); hot = (hot + 1) % n; render(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); hot = (hot - 1 + n) % n; render(); }
    if (e.key === 'Enter') pick(hot);
    if (e.key === 'Escape') closePalette();
  });
  const base = [
    { label: 'Pages', items: [
      { label: 'Go to Inbox', icon: 'inbox', run: () => navigate('#/inbox') },
      { label: 'Go to Issues', icon: 'bug', run: () => navigate('#/issues') },
      { label: 'Go to Overview', icon: 'activity', run: () => navigate('#/overview') },
      { label: 'Go to Websites', icon: 'globe', run: () => navigate('#/websites') },
      { label: 'Go to Settings', icon: 'settings', run: () => navigate('#/settings') },
    ]},
    { label: 'Actions', items: [
      { label: 'Toggle theme', icon: 'moon', hint: 'T', run: () => document.getElementById('theme-cycle')?.click() },
      { label: 'Approve oldest pending issue', icon: 'check', run: async () => {
        const { toast } = await import('./overlays.js');
        const j = await api('/api/issues?status=AWAITING_APPROVAL&limit=1');
        if (j.issues[0]) navigate('#/issues/' + j.issues[0].id); else toast('Nothing is waiting for approval', { type: 'ok' });
      }},
    ]},
  ];
  let all = { issues: [], sites: [] };
  try {
    const [a, b] = await Promise.all([api('/api/issues?limit=30'), api('/api/websites')]);
    all = { issues: a.issues, sites: b.websites };
  } catch {}
  const build = q => {
    q = q.toLowerCase();
    const match = t => !q || String(t).toLowerCase().includes(q);
    items = [
      ...base.map(g => ({ label: g.label, items: g.items.filter(i => match(i.label)) })).filter(g => g.items.length),
      { label: 'Issues', items: all.issues.filter(i => match(i.title + ' ' + i.id)).slice(0, 6).map(i => ({ label: `${i.id} — ${i.title}`, icon: 'bug', run: () => navigate('#/issues/' + i.id) })) },
      { label: 'Websites', items: all.sites.filter(w => match(w.name)).map(w => ({ label: w.name, icon: 'globe', run: () => navigate('#/websites/' + w.id) })) },
    ].filter(g => g.items.length);
    hot = 0; render();
  };
  input.addEventListener('input', () => build(input.value));
  build('');
  setTimeout(() => input.focus(), 30);
}
