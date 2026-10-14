import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { scoreRisk, requiresApproval } from '../src/agents/risk.js';
import { scanAddedLines } from '../src/agents/safety.js';
import { applyEdits, isForbidden, toUnifiedDiff } from '../src/agents/patcher.js';
import { extractJson } from '../src/ai/json.js';
import { fingerprint, extractHints } from '../src/agents/intake.js';
import { redact } from '../src/http/redact.js';
import { runValidatorsForPatch } from '../src/validators/index.js';

describe('risk scoring', () => {
  it('typo in css is low, no approval', () => {
    const r = scoreRisk({ diffFiles: [{ path: 'styles.css' }], diffText: '+.a{color:red}\n', defectType: 'typo_copy', confidence: 0.9, settings: {} });
    assert.ok(r.score < 70);
    const g = requiresApproval({ risk: r, settings: { autoDeploy: true }, safetyHit: false, criticVerdict: 'approve', validationClean: true });
    assert.equal(g.required, false);
  });
  it('money diff forces approval', () => {
    const r = scoreRisk({ diffFiles: [{ path: 'app.js' }], diffText: '+total = price + cart\n', defectType: 'logic', confidence: 0.9, settings: {} });
    assert.ok(r.securitySensitive);
    const g = requiresApproval({ risk: r, settings: { autoDeploy: true }, safetyHit: false, criticVerdict: 'approve', validationClean: true });
    assert.equal(g.required, true);
  });
  it('security path always critical', () => {
    const r = scoreRisk({ diffFiles: [{ path: 'auth/login.js' }], diffText: '+x\n', defectType: 'layout_css', confidence: 1, settings: {} });
    assert.equal(r.securitySensitive, true);
  });
});

describe('safety scanner', () => {
  it('flags script + fetch', () => {
    const hits = scanAddedLines('+++ b/x\n+<script src="http://evil.js">\n+fetch("http://evil")\n');
    assert.ok(hits.length >= 2);
  });
  it('clean typo has no hits', () => {
    assert.equal(scanAddedLines('+++ b/x\n-Shoping\n+Shopping\n').length, 0);
  });
});

describe('patcher rules', () => {
  it('uniqueness enforced', () => {
    const r = applyEdits('a\nfoo\nb\nfoo\nc', [{ search: 'foo', replace: 'bar' }]);
    assert.equal(r.ok, false);
  });
  it('unique edit applies + diff generated', () => {
    const r = applyEdits('Shoping cart', [{ search: 'Shoping', replace: 'Shopping' }]);
    assert.equal(r.ok, true);
    const d = toUnifiedDiff('index.html', 'Shoping cart', r.text);
    assert.match(d, /Shopping/);
  });
  it('forbidden paths blocked', () => {
    assert.equal(isForbidden('package.json'), true);
    assert.equal(isForbidden('.github/workflows/x.yml'), true);
    assert.equal(isForbidden('index.html'), false);
  });
});

describe('json + intake + redact', () => {
  it('extractJson tolerates fences', () => {
    assert.deepEqual(extractJson('```json\n{"a":1,}\n```'), { a: 1 });
  });
  it('fingerprint stable', () => {
    assert.equal(fingerprint({ keyHash: 'k', title: 'Hi', pagePath: '/', firstError: '' }), fingerprint({ keyHash: 'k', title: 'hi ', pagePath: '/', firstError: '' }));
  });
  it('hints pick stack files', () => {
    const h = extractHints({ title: 'crash', description: 'at app.js:12', steps: '', element: {}, errors: [{ message: 'x', stack: 'at app.js:12:3' }], network: [], page_url: 'http://s/cart' });
    assert.ok(h.stackFiles.length >= 1);
  });
  it('redactor masks keys', () => {
    assert.match(redact('key=bsk_abc123 and ghp_xyz'), /REDACTED/);
    assert.doesNotMatch(redact('hello world'), /REDACTED/);
  });
});

describe('validators', () => {
  it('json fails on bad syntax', async () => {
    const { passed, results } = await runValidatorsForPatch([{ path: 'a.json', before: '{}', after: '{bad' }]);
    assert.equal(passed, false);
    assert.ok(results.some(r => r.validator_id === 'json' && r.status === 'failed'));
  });
  it('css fails on unbalanced braces', async () => {
    const { passed } = await runValidatorsForPatch([{ path: 's.css', before: 'a{}', after: 'a{' }]);
    assert.equal(passed, false);
  });
  it('js typo passes node --check', async () => {
    const { passed } = await runValidatorsForPatch([{ path: 'a.js', before: 'const a=1', after: 'const a=2' }]);
    assert.equal(passed, true);
  });
  it('python missing runtime -> NOT_PERFORMED or pass (never silent wrong)', async () => {
    const { results } = await runValidatorsForPatch([{ path: 'a.py', before: 'x=1', after: 'x=2' }]);
    const py = results.find(r => r.validator_id === 'python');
    assert.ok(['passed', 'not_performed'].includes(py.status));
  });
});
