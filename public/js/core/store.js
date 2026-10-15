// Tiny store: persisted UI prefs + in-memory cache. Views subscribe to WS via bus.
const listeners = new Set();
export const store = {
  me: null,
  scopedSite: JSON.parse(localStorage.getItem('bs-site') || 'null'),
  density: localStorage.getItem('bs-density') || 'comfortable',
  counts: { approvals: 0, open: 0 },
  setScopedSite(id) { this.scopedSite = id; localStorage.setItem('bs-site', JSON.stringify(id)); emit(); },
  setDensity(d) { this.density = d; localStorage.setItem('bs-density', d); document.body.dataset.density = d; emit(); },
  setCounts(c) { this.counts = c; emit(); },
};
document.body.dataset.density = store.density;
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) { try { fn(); } catch {} } }
export function getTheme() { return document.documentElement.dataset.theme || 'dark'; }
export function setTheme(t) {
  if (t === 'system') {
    const sys = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.dataset.theme = sys;
  } else document.documentElement.dataset.theme = t;
  localStorage.setItem('bs-theme', t);
  const m = document.getElementById('meta-theme');
  if (m) m.content = document.documentElement.dataset.theme === 'dark' ? '#0B0C0F' : '#F6F7F9';
}
