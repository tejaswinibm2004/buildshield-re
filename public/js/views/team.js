// Team (F-10): members table + invite + permission matrix. No dead buttons:
// the backend has no member delete/disable endpoint, so none is shown.
import { html, esc } from '../core/html.js';
import { api } from '../core/api.js';
import { relTime } from '../core/format.js';
import { icon, refreshIcons } from '../core/icons.js';
import { emptyState, callout } from '../components/primitives.js';
import { toast, openModal } from '../components/overlays.js';

const ROLE_TONE = { owner: 'acc', admin: 'info', reviewer: 'warn', viewer: 'mut' };
const ROLE_DESC = {
  owner: 'Full control, including team and policy.',
  admin: 'Everything except deleting owners.',
  reviewer: 'View issues and approve or reject fixes.',
  viewer: 'Read-only access to issues and sites.',
};
const MATRIX = [
  ['View issues & sites', 1, 1, 1, 1],
  ['Approve / reject fixes', 1, 1, 1, 0],
  ['Manage sites, keys, policy', 1, 1, 0, 0],
  ['Manage team', 1, 0, 0, 0],
  ['Revert fixes', 1, 1, 0, 0],
];

export async function teamView(main) {
  main.innerHTML = `<div class="page page-enter">
    <div class="page-head"><div class="head-row"><h1>Team</h1>
    <span class="actions"><button class="btn" id="invite-btn">${icon('plus')} Invite member</button></span></div>
    <p class="desc">Who can approve fixes, change policy, and ship rollbacks.</p></div>
    <div id="team-body"><div class="skel"></div><div class="skel"></div></div>
    <div class="card"><h2>What each role can do</h2>
      <table class="tbl stacked"><thead><tr><th>Capability</th><th>Owner</th><th>Admin</th><th>Reviewer</th><th>Viewer</th></tr></thead><tbody>
      ${MATRIX.map(([cap, o, a, r, v]) => `<tr><td>${cap}</td>${[o, a, r, v].map(x => `<td>${x ? icon('check') : '<span class="dim">—</span>'}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div></div>`;
  main.querySelector('#invite-btn').onclick = inviteModal;
  const body = main.querySelector('#team-body');
  try {
    const m = await api('/api/members');
    body.innerHTML = `<div class="card card-flush"><table class="tbl stacked"><thead><tr><th>Member</th><th>Role</th><th>Status</th><th>Last seen</th></tr></thead><tbody>
      ${m.members.map(u => `<tr>
        <td><div class="row"><span class="avatar" style="background:var(--accent-soft);color:var(--accent-text)">${esc((u.name || u.email).slice(0, 2).toUpperCase())}</span>
        <div><b>${esc(u.name || u.email.split('@')[0])}</b><br><span class="dim small">${esc(u.email)}</span></div></div></td>
        <td><span class="pill ${ROLE_TONE[u.role] || 'mut'}">${esc(u.role)}</span></td>
        <td>${u.disabled ? '<span class="pill mut">Disabled</span>' : '<span class="pill ok">Active</span>'}</td>
        <td>${u.last_seen ? relTime(u.last_seen) : '<span class="dim">—</span>'}</td></tr>`).join('')}
      </tbody></table></div>`;
  } catch (e) {
    body.innerHTML = `<div class="card">${callout('bad', e.message.includes('FORBIDDEN') || e.message.includes('403') ? 'Your role cannot manage the team.' : "Couldn't load the team", esc(e.message))}</div>`;
  }
  refreshIcons(main);
}

function inviteModal() {
  const m = openModal({ title: 'Invite member', size: 'sm', actions: [] });
  m.body.innerHTML = `
    <div class="field"><label for="im-e">Email</label><input class="input" id="im-e" type="email" required></div>
    <div class="field mt"><label for="im-n">Display name</label><input class="input" id="im-n"></div>
    <div class="field mt"><label for="im-r">Role</label><select class="input" id="im-r">
      ${Object.entries(ROLE_DESC).map(([r, d]) => `<option value="${r}">${r} — ${d}</option>`).join('')}</select></div>
    <div class="field mt"><label for="im-p">Temporary password <span class="dim">(12+ chars, they change it later)</span></label>
      <input class="input" id="im-p" type="password" required minlength="12"></div>
    <div class="field-err" id="im-err" style="color:var(--bad);font-size:13px;min-height:20px"></div>
    <div class="row mt" style="justify-content:flex-end"><button class="btn" id="im-go">Send invite</button></div>`;
  m.body.querySelector('#im-go').onclick = async () => {
    const err = m.body.querySelector('#im-err');
    err.textContent = '';
    try {
      await api('/api/members', { method: 'POST', body: JSON.stringify({
        email: m.body.querySelector('#im-e').value,
        name: m.body.querySelector('#im-n').value,
        role: m.body.querySelector('#im-r').value,
        password: m.body.querySelector('#im-p').value }) });
      m.close();
      toast('Member added', { type: 'ok' });
      const { teamView } = await import('./team.js');
      teamView(document.getElementById('main'));
    } catch (e) { err.textContent = e.message; }
  };
}
