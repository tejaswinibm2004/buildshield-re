// Hash router with query-string filters (shareable URLs) + scroll restore.
const routes = new Map();
let cleanup = null;
export function register(path, fn) { routes.set(path, fn); }
function matchRoute(path) {
  if (routes.has(path)) return { fn: routes.get(path), params: {} };
  for (const [pattern, fn] of routes) {
    if (!pattern.includes(':')) continue;
    const rx = new RegExp('^' + pattern.split('/').map(s => s.startsWith(':') ? '([^/]+)' : s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('/') + '$');
    const m = path.match(rx);
    if (m) {
      const names = pattern.split('/').filter(s => s.startsWith(':')).map(s => s.slice(1));
      const params = {};
      names.forEach((n, i) => (params[n] = m[i + 1]));
      return { fn, params };
    }
  }
  return null;
}
export function navigate(hash) { location.hash = hash; }
export function current() {
  const h = location.hash.replace(/^#/, '') || '/overview';
  const [path, qs] = h.split('?');
  return { path, params: new URLSearchParams(qs || '') };
}
export function link(path, params) {
  if (!params) return '#' + path;
  const qs = new URLSearchParams(params).toString();
  return '#' + path + (qs ? '?' + qs : '');
}
export async function route() {
  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
  const { path, params } = current();
  const main = document.getElementById('main');
  const saved = sessionStorage.getItem('scroll:' + path);
  main.innerHTML = '<div class="page"><div class="skel" style="height:32px;width:40%"></div><div class="skel"></div><div class="skel"></div><div class="skel" style="width:70%"></div></div>';
  try {
    const hit = matchRoute(path);
    if (!hit) throw new Error('Unknown page: ' + path);
    const done = await hit.fn(main, params, hit.params);
    if (typeof done === 'function') cleanup = done;
    if (saved) main.scrollTop = +saved;
    else main.scrollTop = 0;
  } catch (e) {
    main.innerHTML = `<div class="page"><div class="card"><div class="empty">
      <span class="eic"><i data-lucide="alert-triangle"></i></span>
      <h3>Couldn't load this page</h3><p>${e.message}</p>
      <div class="row" style="justify-content:center"><button class="btn" data-retry>Try again</button></div>
    </div></div></div>`;
    main.querySelector('[data-retry]').onclick = () => route();
  }
  const { refreshIcons } = await import('./icons.js');
  refreshIcons();
}
export function rememberScroll() {
  const { path } = current();
  sessionStorage.setItem('scroll:' + path, document.getElementById('main').scrollTop);
}
export function setCleanup(fn) { cleanup = fn; }
