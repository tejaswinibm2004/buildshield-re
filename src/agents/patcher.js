import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chatJson } from '../ai/provider.js';
import { readFileAt } from '../github/repoReader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SYSTEM = fs.readFileSync(path.join(__dirname, '../ai/prompts/patcher.md'), 'utf8');

export const FORBIDDEN = [/package-lock\.json$/, /yarn\.lock$/, /^\.github\//, /Dockerfile$/, /render\.ya?ml$/, /(^|\/)\.env/, /package\.json$/, /dist\//, /build\//, /vendor\//];

export function isForbidden(p) { return FORBIDDEN.some(r => r.test(p)); }

export function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let i = 0, n = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { n++; i += needle.length; if (n > 1) break; }
  return n;
}

export function applyEdits(original, edits) {
  let text = original;
  for (const e of edits) {
    const n = countOccurrences(text, e.search);
    if (n !== 1) return { ok: false, error: `search block matches ${n} locations (need exactly 1)` };
    text = text.replace(e.search, e.replace);
  }
  return { ok: true, text };
}

export function toUnifiedDiff(rel, before, after) {
  const b = before.split('\n'), a = after.split('\n');
  // naive LCS-free diff: show full hunk when small, else prefix/suffix context
  let s = 0; while (s < b.length && s < a.length && b[s] === a[s]) s++;
  let eb = b.length - 1, ea = a.length - 1;
  while (eb >= s && ea >= s && b[eb] === a[ea]) { eb--; ea--; }
  const ctx = 3;
  const cs = Math.max(0, s - ctx), ceB = Math.min(b.length, eb + 1 + ctx), ceA = Math.min(a.length, ea + 1 + ctx);
  const out = [`--- a/${rel}`, `+++ b/${rel}`, `@@ -${cs + 1},${ceB - cs} +${cs + 1},${ceA - cs} @@`];
  // simple line walk over the hunk region
  const bb = b.slice(cs, ceB), aa = a.slice(cs, ceA);
  // mark common prefix/suffix as context
  let pre = 0; while (pre < bb.length && pre < aa.length && bb[pre] === aa[pre]) pre++;
  let suf = 0; while (suf < (bb.length - pre) && suf < (aa.length - pre) && bb[bb.length - 1 - suf] === aa[aa.length - 1 - suf]) suf++;
  for (let i = 0; i < pre; i++) out.push(' ' + bb[i]);
  for (let i = pre; i < bb.length - suf; i++) out.push('-' + bb[i]);
  for (let i = pre; i < aa.length - suf; i++) out.push('+' + aa[i]);
  for (let i = bb.length - suf; i < bb.length; i++) out.push(' ' + bb[i]);
  return out.join('\n');
}

export async function generatePatch({ analysis, candidates, snapshotDir, rootPath, limits, chatJsonFn = chatJson }) {
  const ctx = candidates.map(c => `--- FILE: ${c.path}\n` + c.chunks.map(ch => `lines ${ch.startLine}-${ch.endLine}:\n${numbered(ch.text, ch.startLine)}`).join('\n')).join('\n\n').slice(0, 24000);
  const user = `Defect: ${analysis.explanation}\nType: ${analysis.defect_type} @ ${analysis.file}:${analysis.line_start}-${analysis.line_end}\n\n<<<FILES>>>\n${ctx}\n<<<END_FILES>>>\nReturn STRICT JSON edits only.`;
  const r = await chatJsonFn({ system: SYSTEM, user, maxTokens: 2000 });
  const d = r.data;
  const files = Array.isArray(d.files) ? d.files : [];
  // enforce rules in code
  if (files.length > (limits?.maxFiles ?? 3)) return { ok: false, error: `too many files (${files.length})` };
  let totalLines = 0;
  const applied = [];
  let diffAll = [];
  for (const f of files.slice(0, limits?.maxFiles ?? 3)) {
    const p = String(f.path ?? '');
    if (!candidates.some(c => c.path === p)) return { ok: false, error: `path not in localized files: ${p}` };
    if (isForbidden(p)) return { ok: false, error: `forbidden path: ${p}` };
    const edits = (f.edits ?? []).slice(0, limits?.maxEditsPerFile ?? 5);
    const original = readFileAt(snapshotDir, rootPath, p);
    const res = applyEdits(original, edits);
    if (!res.ok) return { ok: false, error: `${p}: ${res.error}`, retryHint: true };
    if (res.text === original) return { ok: false, error: `${p}: patch is empty` };
    const changed = Math.abs(res.text.split('\n').length - original.split('\n').length) + edits.length * 2;
    totalLines += changed;
    applied.push({ path: p, before: original, after: res.text, edits });
    diffAll.push(toUnifiedDiff(p, original, res.text));
  }
  if (!applied.length) return { ok: false, error: 'model returned no files' };
  if (totalLines > (limits?.maxLines ?? 40)) return { ok: false, error: `diff too large (${totalLines} lines)`, tooLarge: true, applied, diff: diffAll.join('\n') };
  return { ok: true, summary: String(d.summary ?? 'fix'), rationale: String(d.rationale ?? ''), risks: String(d.risks ?? ''), applied, diff: diffAll.join('\n'), _raw: (r.raw ?? '').slice(0, 4000) };
}

function numbered(text, start) {
  return String(text).split('\n').map((l, i) => `${start + i}: ${l}`).join('\n');
}
