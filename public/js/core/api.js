// Single API base (A-6 resolved: backend exposes /api/* and /auth/*).
export const API_BASE = '';
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'bugshield' };
export let onSessionExpired = () => {};
export function setSessionHandler(fn) { onSessionExpired = fn; }
export async function api(path, opts = {}) {
  const r = await fetch(API_BASE + path, { credentials: 'same-origin', headers: H, ...opts });
  if (r.status === 401 && !location.hash.startsWith('#/login')) {
    onSessionExpired();
    throw new Error('Session expired');
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || ('Request failed (HTTP ' + r.status + ')'));
  return j;
}
