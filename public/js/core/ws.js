// One WS connection with capped backoff; live badge + event bus.
import { store } from './store.js';
let sock = null, retries = 0, timer = null;
const subs = new Set();
export function onEvent(fn) { subs.add(fn); return () => subs.delete(fn); }
export function wsState() { return sock && sock.readyState === 1 ? 'on' : (timer ? 'retry' : 'off'); }
export function connectWs() {
  try { if (sock) sock.close(); } catch {}
  clearTimeout(timer); timer = null;
  let ws;
  try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`); }
  catch { return schedule(); }
  sock = ws;
  document.dispatchEvent(new CustomEvent('ws-state'));
  ws.onopen = () => { retries = 0; document.dispatchEvent(new CustomEvent('ws-state')); };
  ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    for (const fn of subs) { try { fn(m); } catch {} }
  };
  ws.onclose = () => { schedule(); };
  ws.onerror = () => { try { ws.close(); } catch {} };
}
function schedule() {
  clearTimeout(timer);
  retries++;
  document.dispatchEvent(new CustomEvent('ws-state'));
  timer = setTimeout(connectWs, Math.min(30000, 2000 * retries));
}
export function disconnectWs() {
  clearTimeout(timer); timer = null;
  try { if (sock) sock.close(); } catch {}
  sock = null;
}
export function reconnectNow() { retries = 0; connectWs(); }
export function typingNow() {
  const a = document.activeElement;
  return !!a && /INPUT|TEXTAREA|SELECT/.test(a.tagName);
}
