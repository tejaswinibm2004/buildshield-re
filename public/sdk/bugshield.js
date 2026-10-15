/* BugShield Widget SDK — served at /sdk/bugshield.js (also copied as bs.js for adblock evasion).
   Usage: <div id="bugshield-widget"></div><script src="https://DASHBOARD/sdk/bugshield.js" data-app-id="1" data-key="bsk_xxx"></script>
   The ingestion key is PUBLIC (browser-visible). Protection = origin allow-list + rate limit + dedup. */
(function () {
  'use strict';
  var cfg = window.BUGSHIELD_CONFIG || {};
  var scripts = document.getElementsByTagName('script');
  // Find OUR OWN script tag by src match — NOT "last script on the page".
  // The SDK loads async, so any later-parsed script (app.js, analytics, …)
  // would otherwise be mistaken for us, pointing the endpoint at the shop.
  var me = null;
  for (var i = 0; i < scripts.length; i++) {
    try { if (/\/sdk\/(bugshield|bs)\.js(\?|#|$)/.test(scripts[i].src)) { me = scripts[i]; break; } } catch (e) { /* ignore */ }
  }
  if (!me) me = scripts[scripts.length - 1]; // fallback: last script tag
  var appId = cfg.appId || (me && me.getAttribute('data-app-id')) || '';
  var key = cfg.ingestionKey || cfg.key || (me && me.getAttribute('data-key')) || '';
  var endpoint = cfg.endpoint || (me && me.getAttribute('data-endpoint')) || (location.origin.replace(/\/$/, '') === '' ? '' : null);
  // endpoint defaults to the script origin
  try { if (!cfg.endpoint && me && me.src) endpoint = new URL(me.src).origin; } catch (e) {}
  endpoint = cfg.endpoint || endpoint || location.origin;
  var containerId = cfg.containerId || (me && me.getAttribute('data-container')) || 'bugshield-widget';

  var consoleBuf = [];
  ['error', 'warn'].forEach(function (m) {
    var orig = console[m];
    console[m] = function () {
      try { consoleBuf.push(m + ': ' + Array.prototype.map.call(arguments, String).join(' ').slice(0, 2000)); if (consoleBuf.length > 50) consoleBuf.shift(); } catch (e) {}
      return orig.apply(console, arguments);
    };
  });
  var errBuf = [];
  window.addEventListener('error', function (e) { errBuf.push({ message: String(e.message || '').slice(0, 500), stack: String(e.error && e.error.stack || '').slice(0, 8000), source: e.filename, line: e.lineno, col: e.colno, ts: Date.now() }); if (errBuf.length > 20) errBuf.shift(); });
  window.addEventListener('unhandledrejection', function (e) { errBuf.push({ message: 'unhandledrejection: ' + String(e.reason && e.reason.message || e.reason).slice(0, 500), stack: String(e.reason && e.reason.stack || '').slice(0, 8000), ts: Date.now() }); if (errBuf.length > 20) errBuf.shift(); });
  var netBuf = [];
  var origFetch = window.fetch;
  if (origFetch) window.fetch = function () {
    return origFetch.apply(this, arguments).then(function (r) {
      try { if (r.status >= 400) netBuf.push({ url: String(typeof arguments[0] === 'string' ? arguments[0] : arguments[0].url).slice(0, 300), status: r.status }); } catch (e) {}
      return r;
    });
  };

  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    var parts = [];
    while (el && el.nodeType === 1 && parts.length < 6) {
      var s = el.tagName.toLowerCase();
      if (el.id) { s += '#' + el.id; parts.unshift(s); break; }
      var cls = (el.className && el.className.baseVal !== undefined ? '' : String(el.className || '')).split(/\s+/).filter(Boolean).slice(0, 2).map(function (c) { return '.' + c; }).join('');
      s += cls;
      var sib = el, n = 1;
      while ((sib = sib.previousElementSibling)) if (sib.tagName === el.tagName) n++;
      s += ':nth-of-type(' + n + ')';
      parts.unshift(s);
      el = el.parentElement;
    }
    return parts.join(' > ');
  }

  var picked = null, picking = false;
  function startPick(cb) {
    picking = true;
    function over(e) { e.preventDefault(); if (e.target && e.target.style) e.target.style.outline = '2px solid #5aa2ff'; }
    function out(e) { if (e.target && e.target.style) e.target.style.outline = ''; }
    function click(e) {
      e.preventDefault(); e.stopPropagation();
      document.removeEventListener('mouseover', over, true);
      document.removeEventListener('mouseout', out, true);
      document.removeEventListener('click', click, true);
      picking = false;
      var el = e.target;
      var cs = getComputedStyle(el);
      picked = {
        selector: cssPath(el), tag: el.tagName.toLowerCase(),
        outer_html: String(el.outerHTML || '').slice(0, 2000),
        text: String(el.innerText || el.textContent || '').slice(0, 500),
        box: (function (r) { return { x: r.x, y: r.y, w: r.width, h: r.height }; })(el.getBoundingClientRect()),
        styles: { display: cs.display, position: cs.position, zIndex: cs.zIndex, margin: cs.margin, padding: cs.padding, color: cs.color, backgroundColor: cs.backgroundColor, fontSize: cs.fontSize, overflow: cs.overflow }
      };
      cb(picked);
    }
    document.addEventListener('mouseover', over, true);
    document.addEventListener('mouseout', out, true);
    document.addEventListener('click', click, true);
  }

  function mount() {
    var host = document.getElementById(containerId);
    var shadow;
    var btn;
    if (host && host.attachShadow) {
      shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<style>:host{--bs-accent:#5aa2ff;--bs-radius:8px;--bs-font:system-ui,sans-serif}button{position:static;background:var(--bs-accent);color:#06122e;border:0;border-radius:var(--bs-radius);padding:8px 12px;font-weight:700;cursor:pointer;font-size:14px;font-family:var(--bs-font)}.modal{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:2147483000;animation:bsIn 180ms ease-out}@keyframes bsIn{from{opacity:0;transform:scale(.96)}}.box{background:#fff;color:#111;border-radius:12px;padding:16px;width:min(480px,92vw);font:14px var(--bs-font);color-scheme:light dark;max-height:80vh;overflow:auto}input,textarea{width:100%;margin:6px 0;padding:8px;border:1px solid #ccc;border-radius:var(--bs-radius);font:inherit}.cnt{font-size:11px;color:#666;text-align:right}.linkbtn{background:none!important;border:0;color:#2f6bff;cursor:pointer;padding:0;font-size:13px}.tech{display:flex;gap:6px;align-items:center;font-size:12px;color:#444;margin:6px 0}</style><button id="b">🐞 Report a bug</button><div class="modal" id="m" style="display:none"><div class="box" role="dialog" aria-modal="true" aria-label="Report a bug"><h3>Report a problem</h3><input id="t" placeholder="What went wrong?" maxlength="300" aria-label="Title"><div class="cnt" id="tc"></div><textarea id="d" rows="4" placeholder="Tell us more" maxlength="4000" aria-label="Description"></textarea><div class="cnt" id="dc"></div><button class="linkbtn" id="st" type="button">+ Steps to reproduce (optional)</button><textarea id="s" rows="2" placeholder="1. … 2. …" maxlength="2000" style="display:none" aria-label="Steps to reproduce"></textarea><div><button id="pick">Point at the problem</button> <span id="ps"></span></div><label class="tech"><input type="checkbox" id="tech" checked> Include technical details <span title="Sends console errors, browser info and page URL. Never passwords or form values.">ⓘ</span></label><div style="margin-top:8px"><button id="send">Send report</button> <button id="x" type="button">Cancel</button></div><div id="msg" role="status"></div></div></div>';
      btn = shadow.getElementById('b');
      var modal = shadow.getElementById('m');
      var titleEl = shadow.getElementById('t'), descEl = shadow.getElementById('d');
      var tc = shadow.getElementById('tc'), dc = shadow.getElementById('dc');
      var upd = function () {
        if (titleEl.value.length >= 250) { tc.textContent = titleEl.value.length + '/300'; } else tc.textContent = '';
        if (descEl.value.length >= 3500) { dc.textContent = descEl.value.length + '/4000'; } else dc.textContent = '';
      };
      titleEl.oninput = upd; descEl.oninput = upd;
      btn.onclick = function () { modal.style.display = 'flex'; setTimeout(function () { titleEl.focus(); }, 30); };
      shadow.getElementById('x').onclick = function () { modal.style.display = 'none'; };
      shadow.getElementById('st').onclick = function () {
        var s = shadow.getElementById('s');
        var open = s.style.display !== 'none';
        s.style.display = open ? 'none' : 'block';
        this.textContent = open ? '+ Steps to reproduce (optional)' : '− Steps to reproduce';
      };
      shadow.getElementById('pick').onclick = function () { modal.style.display = 'none'; startPick(function (p) { shadow.getElementById('ps').textContent = p.selector; modal.style.display = 'flex'; }); };
      shadow.getElementById('send').onclick = function () { send(titleEl.value, descEl.value, shadow.getElementById('s').value, shadow.getElementById('msg'), modal, shadow.getElementById('tech').checked); };
    } else {
      // floating fallback
      btn = document.createElement('button');
      btn.textContent = '🐞 Report a bug';
      btn.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;background:#5aa2ff;color:#06122e;border:0;border-radius:99px;padding:10px 14px;font-weight:700;cursor:pointer';
      btn.onclick = function () {
        var t = prompt('Bug title?'); if (!t) return;
        var d = prompt('Describe what went wrong?') || '';
        send(t, d, '', { set textContent(v) { alert(v); } }, null);
      };
      document.body.appendChild(btn);
    }
    if (!key || !appId) console.warn('[bugshield] widget misconfigured: missing app-id or key');
  }

  function send(title, description, steps, msgEl, modal, techOn) {
    msgEl.textContent = 'Sending…';
    var payload = {
      ingestion_key: key, application_id: appId, title: title, description: description, steps_to_reproduce: steps,
      page_url: location.href, context: { user_agent: navigator.userAgent, viewport: innerWidth + 'x' + innerHeight, language: navigator.language, referrer: document.referrer }
    };
    if (techOn !== false) {
      payload.element = picked || undefined;
      payload.errors = errBuf; payload.console = consoleBuf.slice(-20); payload.network = netBuf.slice(-20);
    }
    fetch(endpoint.replace(/\/$/, '') + '/api/v1/issues', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) {
      var ra = parseInt(r.headers.get('Retry-After') || '0', 10);
      return r.text().then(function (t) {
      var j;
      try { j = JSON.parse(t); }
      catch (e) { j = { success: false, error: { message: 'bad server response (HTTP ' + r.status + ', non-JSON)' } }; }
      return { status: r.status, j: j, ra: ra };
    }); }).then(function (x) {
      if (x.j.success) {
        if (x.j.status === 'DEDUPLICATED') { msgEl.textContent = 'Someone already reported this — we added your vote.'; }
        else { msgEl.textContent = "Thanks — we're on it. Report ref: " + (x.j.issueId || 'received'); }
        if (modal) setTimeout(function () { modal.style.display = 'none'; }, 1600);
      }
      else if (x.status === 429) {
        var wait = x.ra > 0 ? x.ra : 40, left = wait;
        msgEl.textContent = 'You are sending reports quickly — retry in ' + left + 's. Your text is kept.';
        var iv = setInterval(function () {
          left--;
          if (left <= 0) { clearInterval(iv); msgEl.textContent = 'You can send again now.'; }
          else msgEl.textContent = 'You are sending reports quickly — retry in ' + left + 's. Your text is kept.';
        }, 1000);
      }
      else if (x.status === 401 || x.status === 403) { msgEl.textContent = "This feedback button isn't set up correctly."; console.error('[bugshield] widget misconfigured (bad key or origin not allow-listed)', x.j); }
      else msgEl.textContent = 'Error: ' + (x.j.error && x.j.error.message || x.status) + ' — your text is kept, try again.';
    }).catch(function () { msgEl.textContent = 'Network error sending report — your text is kept, try again.'; });
  }

  window.BugShieldSDK = { init: function (o) { cfg = o || {}; appId = o.appId; key = o.ingestionKey; endpoint = o.endpoint; containerId = o.containerId || 'bugshield-widget'; mount(); }, _cssPath: cssPath };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
