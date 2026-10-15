// html`` escapes interpolated values by default; raw() allows markup.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ESC[c]); }
export function raw(s) { return { __raw: String(s ?? '') }; }
export function html(strings, ...vals) {
  let out = '';
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < vals.length) {
      const v = vals[i];
      out += (v && typeof v === 'object' && '__raw' in v) ? v.__raw : esc(v);
    }
  }
  return out;
}
