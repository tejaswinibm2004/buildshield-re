// Login: split brand panel + form (D-6). No bootstrap-env text (operator concern).
import { esc } from '../core/html.js';
import { icon, refreshIcons } from '../core/icons.js';
import { store } from '../core/store.js';
import { api } from '../core/api.js';
import { connectWs } from '../core/ws.js';

export async function loginView(main) {
  document.getElementById('app-shell').hidden = true;
  const root = document.getElementById('login-root');
  root.innerHTML = `
    <div class="login-page">
      <div class="login-brand"><div>
        <div class="row"><svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="var(--accent)" stroke-width="1.75"><path d="M16 3l9 3.4V14c0 5.6-3.8 9.9-9 12.6C10.8 23.9 7 19.6 7 14V6.4z"/><path d="M13.2 14.6l-2.3-2.3 1.4-1.4 1 1 4-4 1.4 1.4z" fill="var(--accent)" stroke="none"/></svg></div>
        <h1>Bugs fixed before your users notice.</h1>
        <div class="feat">${icon('sparkles')}<span>AI validates every report against your real code.</span></div>
        <div class="feat">${icon('git-commit')}<span>Fixes ship as normal Git commits.</span></div>
        <div class="feat">${icon('shield-check')}<span>Humans approve only what is risky.</span></div>
        <div class="mini-pipe" aria-hidden="true">
          <span class="mp-n"></span><span class="mp-l"></span><span class="mp-n"></span><span class="mp-l"></span><span class="mp-n"></span><span class="mp-l"></span><span class="mp-n"></span>
          <span class="mp-dot"></span>
        </div>
      </div></div>
      <div class="login-form-col"><form class="login-form" id="lf">
        <h1>Welcome back</h1>
        <p class="muted">Log in to your dashboard.</p>
        <div class="field"><label for="le">Email</label><input class="input" id="le" type="email" autocomplete="username" required></div>
        <div class="field mt"><label for="lp">Password</label>
          <span class="input-wrap"><input class="input" id="lp" type="password" autocomplete="current-password" required>
          <button type="button" class="icon-btn trail" id="pw-show" aria-label="Show password">${icon('eye')}</button></span>
        </div>
        <div class="err field-err" id="le-err" role="alert" style="min-height:20px"></div>
        <button class="btn lg" type="submit" style="width:100%" id="login-go">Log in</button>
      </form></div>
    </div>`;
  refreshIcons(root);
  root.querySelector('#pw-show').onclick = e => {
    const p = root.querySelector('#lp');
    p.type = p.type === 'password' ? 'text' : 'password';
    e.currentTarget.innerHTML = icon(p.type === 'password' ? 'eye' : 'eye-off');
    refreshIcons(root);
  };
  root.querySelector('#lf').onsubmit = async e => {
    e.preventDefault();
    const err = root.querySelector('#le-err');
    err.textContent = '';
    const btn = root.querySelector('#login-go');
    btn.disabled = true;
    btn.innerHTML = `<span class="spin" style="display:inline-flex">${icon('loader')}</span> Logging in…`;
    try {
      const r = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'bugshield' }, credentials: 'same-origin', body: JSON.stringify({ email: root.querySelector('#le').value, password: root.querySelector('#lp').value }) });
      const j = await r.json();
      if (!j.success) throw new Error(j.error?.message || 'Login failed');
      store.me = j.user;
      root.innerHTML = '';
      document.getElementById('app-shell').hidden = false;
      connectWs();
      const ret = sessionStorage.getItem('bs-return');
      sessionStorage.removeItem('bs-return');
      location.hash = ret && ret.startsWith('#/') ? ret : '#/overview';
    } catch (ex) {
      err.innerHTML = `${icon('alert-circle')} ${esc(ex.message)}`;
      refreshIcons(root);
      btn.disabled = false;
      btn.textContent = 'Log in';
    }
  };
}
export function logoutView() {
  document.getElementById('app-shell').hidden = true;
}
