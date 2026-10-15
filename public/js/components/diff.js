// Diff viewer (E-18): gutters, intra-line highlight, unified/split, wrap toggle.
import { esc } from '../core/html.js';
import { icon } from '../core/icons.js';

function parse(diff) {
  const rows = [];
  let o = 0, n = 0;
  for (const line of String(diff || '').split('\n')) {
    if (line.startsWith('---') || line.startsWith('+++')) continue;
    const h = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
    if (h) { o = +h[1]; n = +h[2]; rows.push({ t: 'hunk', text: h[3].trim() || '@@' }); continue; }
    if (line.startsWith('\\')) { rows.push({ t: 'note', text: line }); continue; }
    const c = line[0];
    if (c === '+') rows.push({ t: 'add', o: '', n: n++, text: line.slice(1) });
    else if (c === '-') rows.push({ t: 'del', o: o++, n: '', text: line.slice(1) });
    else rows.push({ t: 'ctx', o: o++, n: n++, text: line.slice(1) });
  }
  return rows;
}
// cheap intra-line highlight: longest common prefix/suffix trim on paired del/add
function pair(rows) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const nx = rows[i + 1];
    if (r.t === 'del' && nx && nx.t === 'add') {
      let a = 0; while (a < r.text.length && a < nx.text.length && r.text[a] === nx.text[a]) a++;
      let b = 0; while (b < r.text.length - a && b < nx.text.length - a && r.text[r.text.length - 1 - b] === nx.text[nx.text.length - 1 - b]) b++;
      const hl = t => esc(t.slice(0, a)) + `<span class="iw">${esc(t.slice(a, t.length - b))}</span>` + esc(t.slice(t.length - b));
      out.push({ ...r, html: hl(r.text) }, { ...nx, html: hl(nx.text) });
      i++;
    } else out.push(r);
  }
  return out;
}

export function diffViewer(diffText, { splitDefault = false } = {}) {
  const rows = pair(parse(diffText));
  const adds = rows.filter(r => r.t === 'add').length;
  const dels = rows.filter(r => r.t === 'del').length;
  const id = 'dv' + Math.random().toString(36).slice(2);
  const wide = window.innerWidth >= 1100;
  let split = splitDefault && wide;
  let wrap = true;
  const render = () => {
    const host = document.getElementById(id);
    if (!host) return;
    let body = '';
    if (split) {
      // split: del on left, add on right (context spans both)
      let left = '', right = '';
      for (const r of rows) {
        if (r.t === 'hunk') {
          const h = `<tr class="hunk"><td class="ln">…</td><td>${esc(r.text)}</td></tr>`;
          left += h; right += h;
        } else if (r.t === 'note') continue;
        else if (r.t === 'del') left += `<tr class="del"><td class="ln">${r.o}</td><td>-${r.html || esc(r.text)}</td></tr>`;
        else if (r.t === 'add') right += `<tr class="add"><td class="ln">${r.n}</td><td>+${r.html || esc(r.text)}</td></tr>`;
        else {
          const c = `<tr class="ctx"><td class="ln">${r.o}</td><td> ${esc(r.text)}</td></tr>`;
          left += c.replace(`<td class="ln">${r.o}</td>`, `<td class="ln">${r.o}</td>`);
          right += `<tr class="ctx"><td class="ln">${r.n}</td><td> ${esc(r.text)}</td></tr>`;
        }
      }
      body = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0"><div class="diff"><table>${left}</table></div><div class="diff"><table>${right}</table></div></div>`;
    } else {
      body = `<div class="diff${wrap ? '' : ' nowrap'}"><table>${rows.map(r => {
        if (r.t === 'hunk') return `<tr class="hunk"><td class="ln">…</td><td class="ln">…</td><td>${esc(r.text)}</td></tr>`;
        if (r.t === 'note') return `<tr><td class="ln"></td><td class="ln"></td><td class="dim">${esc(r.text)}</td></tr>`;
        const mark = r.t === 'add' ? '+' : r.t === 'del' ? '-' : ' ';
        return `<tr class="${r.t}"><td class="ln">${r.o}</td><td class="ln">${r.n}</td><td>${mark}${r.html || esc(r.text) || ' '}</td></tr>`;
      }).join('')}</table></div>`;
    }
    host.innerHTML = `
      <div class="diff-tools">
        <span class="mono">+${adds} −${dels}</span>
        <button class="btn ghost sm" data-a="mode">${icon('columns')} ${split ? 'Unified' : 'Split'}</button>
        <button class="btn ghost sm" data-a="wrap">${icon('wrap')} Wrap ${wrap ? 'on' : 'off'}</button>
        <button class="btn ghost sm" data-a="copy">${icon('copy')} Copy patch</button>
      </div><div class="dbody">${body}</div>`;
    host.querySelector('[data-a="mode"]').onclick = () => { split = !split; render(); };
    host.querySelector('[data-a="wrap"]').onclick = () => { wrap = !wrap; render(); };
    host.querySelector('[data-a="copy"]').onclick = e => {
      navigator.clipboard?.writeText(diffText).then(() => {
        e.currentTarget.innerHTML = `${icon('check')} Copied`;
        setTimeout(render, 1600);
      });
    };
  };
  setTimeout(render, 0);
  return `<div class="diff-file" id="${id}"></div>`;
}
