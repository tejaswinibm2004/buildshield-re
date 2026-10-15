// Formatting: relative time, dates, numbers, durations.
export function timeAgo(iso) {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const s = Math.floor((Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) { const m = Math.floor(s / 60); return m + 'm ago'; }
  if (s < 86400) { const h = Math.floor(s / 3600); return h + 'h ago'; }
  const d = new Date(t);
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString())
    return 'yesterday ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) +
    (d.getFullYear() === new Date().getFullYear() ? '' : ' ' + d.getFullYear());
}
export function exactTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d)) return '—';
  return d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) +
    ' (' + Intl.DateTimeFormat().resolvedOptions().timeZone + ')';
}
export function relTime(iso) {
  return `<time datetime="${String(iso ?? '')}" title="${exactTime(iso)}">${timeAgo(iso)}</time>`;
}
export function fmtNum(n) { return new Intl.NumberFormat().format(Number(n ?? 0)); }
export function fmtDur(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm ' + (s % 60) + 's';
  return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
}
export function shortSha(sha) { return String(sha || '').slice(0, 7); }
