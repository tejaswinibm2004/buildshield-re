import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config, validateConfigOrThrow, configSummaryMasked } from './src/config.js';
import { runMigrations } from './src/db/migrations.js';
import { backend } from './src/db/db.js';
import { ensureBootstrapOwner } from './src/http/auth.js';
import { csrfMiddleware } from './src/http/csrf.js';
import { buildRouter } from './src/http/router.js';
import { setJobHandler, enqueue, resumeStuckJobs, pump } from './src/queue/jobQueue.js';
import { setBroadcaster, processIssue } from './src/agents/orchestrator.js';
import { WebSocketServer } from 'ws';
import { getUserByToken } from './src/http/auth.js';
import { redact } from './src/http/redact.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  validateConfigOrThrow();
  if (backend() === 'sqlite') {
    // Local/dev only: production refuses to boot without DATABASE_URL (see config).
    fs.mkdirSync(config.dataDir, { recursive: true });
    try { fs.writeFileSync(path.join(config.dataDir, '.writetest'), 'ok'); fs.unlinkSync(path.join(config.dataDir, '.writetest')); }
    catch (e) { console.error('FATAL: data dir not writable:', config.dataDir, e.message); process.exit(1); }
  }

  try {
    await runMigrations();
  } catch (e) {
    console.error('FATAL: database unreachable:', redact(e.message));
    console.error('(Supabase free projects pause after inactivity — unpause it in the Supabase dashboard, then restart.)');
    process.exit(1);
  }
  const boot = await ensureBootstrapOwner(config.bootstrapOwnerEmail, config.bootstrapOwnerPassword);
  if (boot.created) {
    if (boot.generated) console.log(`BOOTSTRAP owner created: ${config.bootstrapOwnerEmail} password=<printed once>: ${boot.password}`);
    else console.log(`BOOTSTRAP owner created: ${config.bootstrapOwnerEmail}`);
  }

  const app = express();
  app.disable('x-powered-by');
  // security headers (helmet-style minimal)
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('X-Frame-Options', 'DENY');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });
  // CORS: only ingestion open
  app.use((req, res, next) => {
    if (req.path === '/api/v1/issues' || req.path.startsWith('/sdk/')) {
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });
  app.use(express.json({ limit: '512kb' }));
  // cookie parse (tiny)
  app.use((req, res, next) => {
    req.cookies = {};
    const h = req.get('Cookie');
    if (h) for (const part of h.split(';')) { const i = part.indexOf('='); if (i > 0) req.cookies[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); }
    next();
  });
  app.use(csrfMiddleware);

  setJobHandler(async (type, payload) => {
    if (type === 'processIssue') await processIssue(payload.issueId);
  });

  const api = buildRouter({ enqueue });
  app.use('/api', api);
  app.use('/auth', api); // /auth/* mounted via router paths? router has /auth/* so also mount at /
  app.use('/', api);

  // static dashboard + sdk
  app.use('/sdk', express.static(path.join(__dirname, 'public', 'sdk')));
  app.use(express.static(path.join(__dirname, 'public')));
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) return next();
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  const server = app.listen(config.port, '0.0.0.0', async () => {
    console.log('BugShield listening on :' + config.port, JSON.stringify(configSummaryMasked()));
    try {
      const n = await resumeStuckJobs();
      if (n) console.log(`resumed ${n} stuck issues`);
    } catch (e) { console.error('resume failed:', redact(e.message)); }
    pump();
  });

  if (backend() === 'sqlite') {
    // nightly file backup (local backend only; Supabase handles backups server-side)
    setInterval(() => {
      try {
        const src = path.join(config.dataDir, 'bugshield.db');
        if (!fs.existsSync(src)) return;
        const dir = path.join(config.dataDir, 'backups');
        fs.mkdirSync(dir, { recursive: true });
        const dst = path.join(dir, `bugshield-${new Date().toISOString().slice(0, 10)}.db`);
        fs.copyFileSync(src, dst);
        const files = fs.readdirSync(dir).sort();
        while (files.length > 7) fs.unlinkSync(path.join(dir, files.shift()));
      } catch (e) { console.error('backup failed', redact(e.message)); }
    }, 24 * 3600 * 1000).unref();
  }

  // WebSocket live updates
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Set();
  wss.on('connection', (ws, req) => {
    (async () => {
      try {
        const u = new URL(req.url, 'http://x');
        let token = u.searchParams.get('token') ?? '';
        if (!token) {
          // Browsers send HttpOnly cookies on the WS handshake — use them (no JS-readable token needed).
          const cookie = req.headers.cookie ?? '';
          const m = cookie.match(/bs_session=([^;]+)/);
          if (m) token = decodeURIComponent(m[1]);
        }
        const user = await getUserByToken(token);
        if (!user) { ws.close(4401, 'auth'); return; }
        clients.add(ws);
        ws.on('close', () => clients.delete(ws));
      } catch { ws.close(4400, 'bad'); }
    })();
  });
  setBroadcaster((issueId, payload) => {
    const msg = JSON.stringify({ issueId, ...payload });
    for (const ws of clients) { try { if (ws.readyState === 1) ws.send(msg); } catch {} }
  });
}

main().catch(e => { console.error('FATAL boot:', e.message); process.exit(1); });

export default null;
