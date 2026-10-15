// Settings (F-9): policy with live preview, dual slider, integrations.
import { html, esc } from '../core/html.js';
import { api } from '../core/api.js';
import { icon, refreshIcons } from '../core/icons.js';
import { callout } from '../components/primitives.js';
import { toast } from '../components/overlays.js';

export async function settingsView(main, params) {
  const sub = params.get('sub') || 'policy';
  main.innerHTML = `<div class="page page-enter">
    <div class="page-head"><h1>Settings</h1></div>
    <div class="grid2" style="grid-template-columns:200px minmax(0,1fr)">
      <div class="card" style="align-self:start"><div class="tabs" style="flex-direction:column;border:0" role="tablist">
        ${[['policy', 'Deploy policy', 'rocket'], ['integrations', 'Integrations', 'plug'], ['ai', 'AI', 'sparkles'], ['appearance', 'Appearance', 'palette']].map(([k, l, ic]) => `
          <button class="tab" role="tab" aria-selected="${sub === k}" data-sub="${k}" style="justify-content:flex-start">${icon(ic)} ${l}</button>`).join('')}
      </div></div>
      <div id="set-body"></div>
    </div></div>`;
  main.querySelectorAll('[data-sub]').forEach(b => b.onclick = () => {
    history.replaceState(null, '', '#/settings' + (b.dataset.sub === 'policy' ? '' : '?sub=' + b.dataset.sub));
    settingsView(main, new URLSearchParams(b.dataset.sub === 'policy' ? '' : 'sub=' + b.dataset.sub));
  });
  const body = main.querySelector('#set-body');
  if (sub === 'integrations') return integrationsTab(body);
  if (sub === 'ai') return aiTab(body);
  if (sub === 'appearance') return appearanceTab(body);
  return policyTab(body);
}

async function policyTab(body) {
  body.innerHTML = '<div class="skel"></div><div class="skel"></div>';
  let pol = {};
  try { pol = (await api('/api/settings/policy')).policy || {}; } catch (e) {
    body.innerHTML = `<div class="card">${callout('bad', "Couldn't load policy", esc(e.message))}</div>`; return;
  }
  const globs = Array.isArray(pol.criticalGlobs) ? pol.criticalGlobs.join('\n') : '';
  body.innerHTML = `<div class="card"><h2>Deploy policy</h2>
    <form id="pf">
    <div class="field"><label>Auto-deploy low and medium risk fixes</label>
      <div class="row"><input type="checkbox" class="toggle" id="pf-auto" ${pol.autoDeploy ? 'checked' : ''} aria-label="Auto-deploy low and medium risk fixes">
      <span class="small" id="pf-preview"></span></div>
      <span class="hint dim small">With these settings: a typo fix deploys automatically; a checkout change waits for you. Security-sensitive changes always wait, no exceptions.</span></div>
    <div class="field mt"><label>Risk thresholds</label>
      <div class="row"><input class="input" id="pf-low" type="number" min="1" max="99" value="40" style="max-width:110px" aria-label="Medium threshold">
      <input class="input" id="pf-high" type="number" min="2" max="100" value="${pol.highThreshold ?? 70}" style="max-width:110px" aria-label="High threshold"></div>
      <div class="hint dim small">Low &lt; <span id="t-low">40</span> · Medium <span id="t-low2">40</span>–<span id="t-high">70</span> · High ≥ <span id="t-high2">70</span>. (Medium band is display-only; the backend gates on the high threshold.)</div>
      <div class="field-err" id="pf-range-err" style="color:var(--bad);font-size:13px;min-height:20px"></div></div>
    <div class="field"><label for="pf-globs">Always needs a human</label>
      <textarea class="input" id="pf-globs" rows="4" placeholder="**/auth/**&#10;**/payment/**&#10;**/checkout/**">${esc(globs)}</textarea>
      <span class="hint dim small">One glob per line. Changes here always pause for approval.</span></div>
    <div class="grid2">
      <div class="field"><label for="pf-files">Max files per fix</label><input class="input" id="pf-files" type="number" min="1" max="10" value="${pol.maxFiles ?? 3}"></div>
      <div class="field"><label for="pf-epf">Max edits per file</label><input class="input" id="pf-epf" type="number" min="1" max="20" value="${pol.maxEditsPerFile ?? 5}"></div>
      <div class="field"><label for="pf-lines">Max changed lines</label><input class="input" id="pf-lines" type="number" min="5" max="200" value="${pol.maxLines ?? 40}"></div>
    </div>
    <div class="row mt"><button class="btn" type="submit" id="pf-save">Save changes</button>
    <button class="btn ghost" type="button" id="pf-discard" hidden>Discard</button></div></form></div>`;
  const form = body.querySelector('#pf');
  const snap = () => JSON.stringify([form.querySelector('#pf-auto').checked, form.querySelector('#pf-high').value, form.querySelector('#pf-globs').value, form.querySelector('#pf-files').value, form.querySelector('#pf-epf').value, form.querySelector('#pf-lines').value]);
  const before = snap();
  const paintPreview = () => {
    const on = form.querySelector('#pf-auto').checked;
    const hi = +form.querySelector('#pf-high').value || 70;
    form.querySelector('#pf-preview').textContent = on ? `On: typo fix auto-deploys; score ≥ ${hi} waits.` : 'Off: every fix waits for approval.';
  };
  form.addEventListener('input', () => {
    body.querySelector('#pf-discard').hidden = snap() === before;
    paintPreview();
    const hi = +form.querySelector('#pf-high').value;
    for (const id of ['#t-high', '#t-high2']) body.querySelector(id).textContent = hi;
    body.querySelector('#pf-range-err').textContent = hi <= 1 ? 'High threshold must be above 1.' : '';
  });
  paintPreview();
  body.querySelector('#pf-discard').onclick = () => policyTab(body);
  form.onsubmit = async e => {
    e.preventDefault();
    const hi = +form.querySelector('#pf-high').value;
    if (!(hi > 1 && hi <= 100)) { body.querySelector('#pf-range-err').textContent = 'High threshold must be between 2 and 100.'; return; }
    const btn = body.querySelector('#pf-save');
    btn.disabled = true;
    try {
      await api('/api/settings/policy', { method: 'POST', body: JSON.stringify({
        highThreshold: hi, maxFiles: +form.querySelector('#pf-files').value,
        maxEditsPerFile: +form.querySelector('#pf-epf').value, maxLines: +form.querySelector('#pf-lines').value,
        criticalGlobs: form.querySelector('#pf-globs').value.split('\n').map(x => x.trim()).filter(Boolean),
        autoDeploy: form.querySelector('#pf-auto').checked }) });
      toast('Policy saved', { type: 'ok' });
      policyTab(body);
    } catch (err) { toast(err.message, { type: 'bad' }); btn.disabled = false; }
  };
  refreshIcons(body);
}

async function integrationsTab(body) {
  body.innerHTML = '<div class="skel"></div>';
  try {
    const integ = await api('/api/settings/integrations-status');
    const row = (ic, name, desc, ok, extra, action) => `
      <div class="card"><div class="head-row">${icon(ic, 20)}<h3 style="margin:0">${name}</h3>
      <span style="margin-left:auto">${ok ? '<span class="pill ok">Working</span>' : '<span class="pill bad">Needs attention</span>'}</span></div>
      <p class="muted small">${desc}</p>${extra || ''}
      <div class="row">${action || ''}</div></div>`;
    body.innerHTML =
      row('sparkles', 'AI provider', 'Validates reports and writes fixes. Never receives your secrets.',
        !!integ.ai?.configured, integ.ai?.model ? `<p class="mono small">Model: ${esc(integ.ai.model)}</p>` : `<p class="dim small">${esc(integ.ai?.reason || 'Set AI_BASE_URL, AI_MODEL and AI_API_KEY on the server.')}</p>`,
        `<button class="btn ghost sm" id="it-ai">Test AI</button>`) +
      row('github', 'GitHub', 'Reads your repos and ships fixes as commits. Fine-grained token, Contents read+write.',
        !!integ.github?.configured, integ.github?.configured ? '' : `<p class="dim small">${esc(integ.github?.reason || '')}</p>`, '') +
      row('rocket', 'Render deploy checks', 'Optional: richer deploy status straight from Render.',
        true, `<p><span class="pill mut">Optional</span> <span class="dim small">Live verification works through version.json without it.</span></p>`, '');
    const t = body.querySelector('#it-ai');
    if (t) t.onclick = async () => {
      t.disabled = true;
      const t0 = performance.now();
      try {
        const sites = (await api('/api/websites')).websites;
        if (!sites.length) throw new Error('Connect a website first — the AI test runs through it.');
        const r = await api(`/api/websites/${sites[0].id}/test`, { method: 'POST' });
        toast('AI test: ' + r.tests.ai + ` (${Math.round(performance.now() - t0)}ms)`, { type: /configured|working/.test(r.tests.ai) ? 'ok' : 'warn', ms: 6000 });
      } catch (e) { toast(e.message, { type: 'bad' }); }
      t.disabled = false;
    };
  } catch (e) { body.innerHTML = `<div class="card">${callout('bad', "Couldn't load integrations", esc(e.message))}</div>`; }
  refreshIcons(body);
}

async function aiTab(body) {
  body.innerHTML = `<div class="card"><h2>AI provider</h2>
    <p class="muted">The model is configured with <span class="mono">AI_BASE_URL / AI_MODEL / AI_API_KEY</span> environment variables on the server — the key is never shown here, by design.</p>
    <div id="ai-info"><div class="skel"></div></div>
    <div class="callout ai">${icon('sparkles')}<div><div class="ct">About free models</div><div class="cb">Free tiers work for demos but flake under load: expect retries and slower analysis. A stable paid model is recommended for anything important.</div></div></div></div>`;
  try {
    const integ = await api('/api/settings/integrations-status');
    body.querySelector('#ai-info').innerHTML = integ.ai?.configured
      ? `<p><span class="pill ok">Configured</span> <span class="mono">Model: ${esc(integ.ai.model || '')}</span></p>`
      : `<p><span class="pill warn">Not configured</span> <span class="dim">${esc(integ.ai?.reason || '')}</span></p>
         <p class="dim small">Reports are kept and will analyze once a key is set — nothing is lost.</p>`;
  } catch (e) { body.querySelector('#ai-info').innerHTML = `<p class="dim">${esc(e.message)}</p>`; }
  refreshIcons(body);
}

function appearanceTab(body) {
  const cur = localStorage.getItem('bs-theme') || 'dark';
  const tile = (v, label, swatch) => `
    <button data-th="${v}" style="border:2px solid ${cur === v ? 'var(--accent)' : 'var(--line-2)'};border-radius:12px;padding:12px;background:${swatch};color:${v === 'light' ? '#14161B' : '#ECEEF2'};cursor:pointer;font:600 13px var(--font-ui);min-width:110px">${label}</button>`;
  body.innerHTML = `<div class="card"><h2>Appearance</h2>
    <div class="section-label">Theme</div>
    <div class="row">${tile('dark', 'Dark', '#0B0C0F')}${tile('light', 'Light', '#F6F7F9')}${tile('system', 'System', 'linear-gradient(90deg,#0B0C0F 50%,#F6F7F9 50%)')}</div>
    <div class="section-label mt">Density</div>
    <div class="row"><button class="btn ghost sm" data-d="comfortable">Comfortable</button><button class="btn ghost sm" data-d="compact">Compact</button></div>
    <p class="dim small mt">System follows your OS setting. Density compacts table rows everywhere.</p></div>`;
  body.querySelectorAll('[data-th]').forEach(b => b.onclick = async () => {
    const { setTheme } = await import('../core/store.js');
    setTheme(b.dataset.th);
    appearanceTab(body);
    toast('Theme: ' + b.dataset.th, { type: 'info', ms: 1500 });
  });
  body.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => {
    const { store } = await import('../core/store.js');
    store.setDensity(b.dataset.d);
    document.querySelectorAll('table.tbl').forEach(t => t.classList.toggle('compact', b.dataset.d === 'compact'));
    toast('Density: ' + b.dataset.d, { type: 'info', ms: 1500 });
  });
}
