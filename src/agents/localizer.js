import fs from 'node:fs';
import path from 'node:path';
import { listFiles, readFileAt } from '../github/repoReader.js';

// Cheap grep signals then optional LLM selection (injected llmSelect for testability).
export async function localize({ snapshotDir, rootPath, hints, pagePath, llmSelect = null, topN = 8 }) {
  const files = listFiles(snapshotDir, rootPath);
  const repoMap = files.map(f => `${f.path} (${f.size}b)`).join('\n').slice(0, 12000);
  const needles = new Set([
    ...(hints.quoted ?? []).map(s => s.toLowerCase()),
    ...(hints.identifiers ?? []).map(s => s.toLowerCase()),
    ...(hints.selectors ?? []).map(s => s.replace(/^[.#]/, '').toLowerCase()),
  ]);
  const scored = [];
  for (const f of files.slice(0, 2000)) {
    let score = 0; const reasons = [];
    const lp = f.path.toLowerCase();
    for (const sf of hints.stackFiles ?? []) {
      if (lp.endsWith(String(sf.file).toLowerCase())) { score += 50; reasons.push(`stack trace names ${sf.file}`); }
    }
    // page mapping heuristic
    if (pagePath && pagePath !== '/') {
      const seg = pagePath.split('/').filter(Boolean).pop()?.toLowerCase();
      if (seg && lp.includes(seg.replace(/\.\w+$/, ''))) { score += 12; reasons.push(`matches page path ${pagePath}`); }
    }
    if (['index.html', 'app.js', 'styles.css', 'page.tsx', 'page.jsx'].some(n => lp.endsWith(n))) { score += 2; }
    // grep content (only small files)
    if (f.size < 60000) {
      try {
        const content = readFileAt(snapshotDir, rootPath, f.path).toLowerCase();
        for (const n of needles) {
          if (n.length >= 3 && content.includes(n)) { score += 6; reasons.push(`contains "${n.slice(0, 40)}"`); if (reasons.length > 4) break; }
        }
      } catch {}
    }
    if (score > 0) scored.push({ path: f.path, score, reason: reasons.slice(0, 3).join('; ') || 'heuristic match' });
  }
  scored.sort((a, b) => b.score - a.score);
  let top = scored.slice(0, topN);
  // LLM selection step (optional; keeps only paths that exist)
  if (llmSelect) {
    try {
      const picked = await llmSelect({ repoMap, hints, signals: top });
      const valid = new Set(files.map(f => f.path));
      const llmFiles = (picked?.files ?? []).filter(p => valid.has(p.path)).slice(0, 5);
      if (llmFiles.length) top = llmFiles.map(p => ({ path: p.path, score: 100, reason: p.reason || 'llm selection' }));
    } catch {}
  }
  // Read chunks
  const candidates = [];
  for (const c of top.slice(0, 8)) {
    try {
      const text = readFileAt(snapshotDir, rootPath, c.path);
      const lines = text.split('\n');
      if (lines.length <= 400) {
        candidates.push({ path: c.path, reason: c.reason, chunks: [{ startLine: 1, endLine: lines.length, text: text.slice(0, 30000) }] });
      } else {
        // window around first needle hit
        const low = text.toLowerCase();
        let idx = -1;
        for (const n of needles) { if (n.length >= 4) { const i = low.indexOf(n); if (i !== -1) { idx = i; break; } } }
        const lineNo = idx === -1 ? 1 : text.slice(0, idx).split('\n').length;
        const s = Math.max(1, lineNo - 80), e = Math.min(lines.length, lineNo + 80);
        candidates.push({ path: c.path, reason: c.reason, chunks: [{ startLine: s, endLine: e, text: lines.slice(s - 1, e).join('\n').slice(0, 30000) }] });
      }
    } catch {}
  }
  return { repoMap: repoMap.slice(0, 6000), candidates };
}
