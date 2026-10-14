import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { localize } from '../src/agents/localizer.js';
import { analyze } from '../src/agents/analyzer.js';
import { generatePatch } from '../src/agents/patcher.js';
import { critique } from '../src/agents/critic.js';
import { verifyLive } from '../src/agents/verifier.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function tmpRepo(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bs-'));
  for (const [p, c] of Object.entries(files)) { fs.mkdirSync(path.join(d, path.dirname(p)), { recursive: true }); fs.writeFileSync(path.join(d, p), c); }
  return d;
}

describe('localizer finds typo by grep (no LLM)', () => {
  it('ranks index.html for "Shoping"', async () => {
    const dir = tmpRepo({ 'index.html': '<h1>Shoping cart</h1>', 'other.js': 'hello' });
    const { extractHints } = await import('../src/agents/intake.js');
    const hints = extractHints({ title: 'Typo Shoping', description: 'says Shoping not Shopping', steps: '', element: {}, errors: [], network: [], page_url: 'http://x/' });
    const loc = await localize({ snapshotDir: dir, rootPath: '', hints, pagePath: '/' });
    assert.ok(loc.candidates.some(c => c.path === 'index.html'));
  });
});

describe('analyzer + patcher + critic with stubbed LLM', () => {
  it('full stubbed pass', async () => {
    const fakeAnalyze = async () => ({ is_defect: true, confidence: 0.95, defect_type: 'typo_copy', file: 'index.html', line_start: 1, line_end: 1, explanation: 'typo', reproduction_reasoning: 'r', user_visible_impact: 'typo visible', needs_more_context: false, extra_files_needed: [] });
    const a = await analyze({ report: { title: 't', description: 'd', steps: '', page_url: '', element: {}, errors: [] }, chunks: [], chatJsonFn: async () => ({ data: { is_defect: true, confidence: 0.95, defect_type: 'typo_copy', file: 'index.html', line_start: 1, line_end: 1, explanation: 'typo', reproduction_reasoning: 'r', user_visible_impact: 'v', needs_more_context: false, extra_files_needed: [] } }) });
    assert.equal(a.is_defect, true);
    const dir = tmpRepo({ 'index.html': '<h1>Shoping</h1>' });
    const p = await generatePatch({ analysis: a, candidates: [{ path: 'index.html', reason: 'grep', chunks: [{ startLine: 1, endLine: 1, text: '<h1>Shoping</h1>' }] }], snapshotDir: dir, rootPath: '', limits: {}, chatJsonFn: async () => ({ data: { summary: 'fix typo', files: [{ path: 'index.html', edits: [{ search: 'Shoping', replace: 'Shopping' }] }], rationale: 'r', risks: 'none' } }) });
    assert.equal(p.ok, true);
    const c = await critique({ report: { title: 't', description: 'd' }, snippet: '<h1>Shoping</h1>', diff: p.diff, chatJsonFn: async () => ({ data: { verdict: 'approve', concerns: [] } }) });
    assert.equal(c.verdict, 'approve');
    void fakeAnalyze;
  });
});

describe('verifier', () => {
  it('sees SHA in version.json (mock site)', async () => {
    const site = { site_url: 'http://shop.test', version_path: '/version.json', health_url: 'http://shop.test/' };
    const fetchFn = async (url) => {
      if (url.endsWith('/version.json')) return { ok: true, json: async () => ({ commit: 'abc123' }) };
      return { ok: true, status: 200 };
    };
    const v = await verifyLive({ site, commitSha: 'abc123', timeoutMs: 5000, pollMs: 100, fetchFn });
    assert.equal(v.verified, true);
  });
  it('honest UNVERIFIED without site_url', async () => {
    const v = await verifyLive({ site: {}, commitSha: 'x', timeoutMs: 100, pollMs: 50 });
    assert.equal(v.verified, false);
    assert.match(v.reason, /UNVERIFIED/);
  });
});
