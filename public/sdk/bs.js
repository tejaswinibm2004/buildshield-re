/* BugShield Widget SDK — served at /sdk/bugshield.js (also copied as bs.js for adblock evasion).
   Usage: <div id="bugshield-widget"></div><script src="https://DASHBOARD/sdk/bugshield.js" data-app-id="1" data-key="bsk_xxx"></script>
   The ingestion key is PUBLIC (browser-visible). Protection = origin allow-list + rate limit + dedup. */
(function () {
  'use strict';
  var cfg = window.BUGSHIELD_CONFIG || {};
  var scripts = document.getElementsByTagName('script');
  var me = scripts[scripts.length - 1];
  var appId = cfg.appId || (me && me.getAttribute('data-app-id')) || '';
  var key = cfg.ingestionKey || (me && me.getAttribute('data-key')) || '';
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
      shadow.innerHTML = '<style>button{position:static;background:#5aa2ff;color:#06122e;border:0;border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer;font-size:14px}.modal{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:2147483647}.box{background:#fff;color:#111;border-radius:12px;padding:16px;width:min(480px,92vw);font:14px system-ui}input,textarea{width:100%;margin:6px 0;padding:8px;border:1px solid #ccc;border-radius:8px}</style><button id="b">🐞 Report a bug</button><div class="modal" id="m" style="display:none"><div class="box"><h3>Report a bug</h3><input id="t" placeholder="Title"><textarea id="d" rows="4" placeholder="What went wrong?"></textarea><textarea id="s" rows="2" placeholder="Steps to reproduce (optional)"></textarea><div><button id="pick">Point at the problem</button> <span id="ps"></span></div><div style="margin-top:8px"><button id="send">Send</button> <button id="x" type="button">Cancel</button></div><div id="msg"></div></div></div>';
      btn = shadow.getElementById('b');
      var modal = shadow.getElementById('m');
      btn.onclick = function () { modal.style.display = 'flex'; };
      shadow.getElementById('x').onclick = function () { modal.style.display = 'none'; };
      shadow.getElementById('pick').onclick = function () { modal.style.display = 'none'; startPick(function (p) { shadow.getElementById('ps').textContent = p.selector; modal.style.display = 'flex'; }); };
      shadow.getElementById('send').onclick = function () { send(shadow.getElementById('t').value, shadow.getElementById('d').value, shadow.getElementById('s').value, shadow.getElementById('msg'), modal); };
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

  function send(title, description, steps, msgEl, modal) {
    msgEl.textContent = 'Sending…';
    fetch(endpoint.replace(/\/$/, '') + '/api/v1/issues', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ingestion_key: key, application_id: appId, title: title, description: description, steps_to_reproduce: steps,
        page_url: location.href, context: { user_agent: navigator.userAgent, viewport: innerWidth + 'x' + innerHeight, language: navigator.language, referrer: document.referrer },
        element: picked || undefined, errors: errBuf, console: consoleBuf.slice(-20), network: netBuf.slice(-20)
      })
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); }).then(function (x) {
      if (x.j.success) { msgEl.textContent = x.j.status === 'DEDUPLICATED' ? 'Thanks — already reported, your vote was counted.' : 'Thanks! Report received.'; if (modal) setTimeout(function () { modal.style.display = 'none'; }, 1200); }
      else if (x.status === 429) msgEl.textContent = 'Too many reports — please retry shortly.';
      else if (x.status === 401 || x.status === 403) { msgEl.textContent = 'Widget misconfigured (bad key/origin).'; console.error('[bugshield] widget misconfigured', x.j); }
      else msgEl.textContent = 'Error: ' + (x.j.error && x.j.error.message || x.status);
    }).catch(function () { msgEl.textContent = 'Network error sending report.'; });
  }

  window.BugShieldSDK = { init: function (o) { cfg = o || {}; appId = o.appId; key = o.ingestionKey; endpoint = o.endpoint; containerId = o.containerId || 'bugshield-widget'; mount(); }, _cssPath: cssPath };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
