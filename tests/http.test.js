import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildRouter } from '../src/http/router.js';
import { runMigrations } from '../src/db/migrations.js';
import { run, get, insertGetId } from '../src/db/db.js';
import { config } from '../src/config.js';
config.dataDir = './.var/test-data';
import { _reset } from '../src/http/rateLimit.js';

const { default: fs } = await import('node:fs');
fs.rmSync('./.var/test-data', { recursive: true, force: true });

let base, server;
const enqueued = [];

before(async () => {
  await runMigrations();
  const api = buildRouter({ enqueue: (t, p) => enqueued.push([t, p]) });
  const app = express();
  app.use(express.json({ limit: '512kb' }));
  app.use((req, res, next) => { req.cookies = {}; next(); });
  app.use('/api', api);
  server = app.listen(0);
  await new Promise(r => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

async function seedSite() {
  const id = await insertGetId("INSERT INTO websites (name,repo_url,repo_owner,repo_name,branch,site_url,created_at) VALUES ('s','https://github.com/o/r','o','r','main','http://localhost:9',?)", new Date().toISOString());
  const crypto = await import('node:crypto');
  const plain = 'bsk_' + crypto.randomBytes(8).toString('hex');
  const h = crypto.createHash('sha256').update(plain).digest('hex');
  await run('INSERT INTO ingestion_keys (website_id,label,key_hash,allowed_origins,created_at) VALUES (?,?,?,?,?)', id, 't', h, '[]', new Date().toISOString());
  return { id, plain };
}

describe('ingestion guards', () => {
  it('401 on bad key, 413 on huge, dedup works', async () => {
    _reset();
    const { plain } = await seedSite();
    let r = await fetch(base + '/api/v1/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ingestion_key: 'bsk_nope', title: 't', description: 'd' }) });
    assert.equal(r.status, 401);
    r = await fetch(base + '/api/v1/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ingestion_key: plain, title: 'Typo Shoping', description: 'says Shoping', page_url: 'http://x/' }) });
    assert.equal(r.status, 200);
    const j1 = await r.json();
    assert.equal(j1.status, 'RECEIVED');
    r = await fetch(base + '/api/v1/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ingestion_key: plain, title: 'typo  shoping ', description: 'says Shoping', page_url: 'http://x/' }) });
    const j2 = await r.json();
    assert.equal(j2.status, 'DEDUPLICATED');
    assert.equal(j2.issueId, j1.issueId);
    void get;
  });
  it('origin allow-list 403', async () => {
    _reset();
    const { default: crypto } = await import('node:crypto');
    const id = await insertGetId("INSERT INTO websites (name,created_at) VALUES ('o1',?)", new Date().toISOString());
    const plain = 'bsk_' + crypto.randomBytes(8).toString('hex');
    await run('INSERT INTO ingestion_keys (website_id,label,key_hash,allowed_origins,created_at) VALUES (?,?,?,?,?)', id, 't', crypto.createHash('sha256').update(plain).digest('hex'), JSON.stringify(['https://allowed.example']), new Date().toISOString());
    const r = await fetch(base + '/api/v1/issues', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: JSON.stringify({ ingestion_key: plain, title: 't', description: 'd', page_url: 'http://x/' }) });
    assert.equal(r.status, 403);
  });
});

describe('auth + CSRF + roles', () => {
  it('csrf blocks mutation without header', async (t) => {
    t.after(() => server.close());
    const { csrfMiddleware } = await import('../src/http/csrf.js');
    const app2 = express();
    app2.use(express.json());
    app2.use(csrfMiddleware);
    app2.post('/x', (req, res) => res.json({ ok: 1 }));
    const s2 = app2.listen(0); await new Promise(r => s2.on('listening', r));
    const r = await fetch(`http://127.0.0.1:${s2.address().port}/x`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 403);
    s2.close();
  });
});
