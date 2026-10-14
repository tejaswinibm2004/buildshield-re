import express from 'express';
import crypto from 'node:crypto';
import { get, all, run, insertGetId, nowIso } from '../db/db.js';
import { getUserByToken, createSession, destroySession, hashPassword, verifyPassword, loginAllowed, loginFailed, loginSucceeded, canApprove, canManage, ROLES } from './auth.js';
import { rateLimit } from './rateLimit.js';
import { redact, hashIp, redactJson } from './redact.js';
import { normalizeReport, fingerprint, extractHints } from '../agents/intake.js';
import { parseRepoUrl } from '../github/client.js';
import { aiStatus } from '../ai/provider.js';
import { config } from '../config.js';

export function err(res, code, message, status = 400) {
  return res.status(status).json({ success: false, error: { code, message } });
}

// Fire-and-forget safe (never rejects).
async function audit(actor, action, target, detail, ip) {
  try {
    await run('INSERT INTO audit_log (ts,actor,action,target,detail,ip_hash) VALUES (?,?,?,?,?,?)',
      nowIso(), actor, action, target, JSON.stringify(detail ?? {}).slice(0, 4000), hashIp(ip));
  } catch {}
}

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies?.bs_session ?? req.get('X-Session-Token') ?? '';
    const user = await getUserByToken(token);
    if (!user) return err(res, 'AUTH', 'login required', 401);
    req.user = user; req.sessionToken = token;
    next();
  } catch {
    return err(res, 'AUTH', 'login required', 401);
  }
}

export function buildRouter({ enqueue }) {
  const r = express.Router();

  r.get('/health', (req, res) => res.json({ ok: true, time: nowIso() }));

  // ---- auth ----
  r.post('/auth/login', async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) return err(res, 'VALIDATION', 'email+password required');
    const gate = loginAllowed(email);
    if (!gate.ok) return res.status(429).json({ success: false, error: { code: 'LOCKED', message: `locked, retry in ${gate.retryAfter}s` } });
    const rl = rateLimit({ key: 'login:' + req.ip, max: 20, windowMs: 60000 });
    if (!rl.ok) return res.status(429).json({ success: false, error: { code: 'RATE', message: 'too many attempts' } });
    const u = await get('SELECT * FROM users WHERE email=?', String(email).toLowerCase());
    if (!u || !verifyPassword(password, u.salt, u.password_hash)) {
      loginFailed(email);
      audit(email, 'login_failed', '', {}, req.ip);
      return err(res, 'AUTH', 'invalid credentials', 401);
    }
    loginSucceeded(email);
    const token = await createSession(u.id);
    audit(u.email, 'login', '', {}, req.ip);
    res.cookie('bs_session', token, { httpOnly: true, sameSite: 'Strict', secure: config.isProd, maxAge: 12 * 3600 * 1000, path: '/' });
    res.json({ success: true, user: { id: u.id, email: u.email, name: u.name, role: u.role } });
  });
  r.post('/auth/logout', requireAuth, async (req, res) => {
    await destroySession(req.sessionToken);
    res.clearCookie('bs_session', { path: '/' });
    res.json({ success: true });
  });
  r.get('/auth/me', requireAuth, (req, res) => res.json({ success: true, user: req.user }));

  // ---- ingestion (public, CORS-open) ----
  r.post('/v1/issues', async (req, res) => {
    const rawLen = Number(req.get('content-length') ?? 0);
    if (rawLen > 256 * 1024) return err(res, 'TOO_LARGE', 'payload exceeds 256KB', 413);
    const b = req.body ?? {};
    const keyPlain = String(b.ingestion_key ?? '');
    if (!keyPlain.startsWith('bsk_')) return err(res, 'AUTH', 'bad key', 401);
    const keyHash = crypto.createHash('sha256').update(keyPlain).digest('hex');
    const key = await get('SELECT k.*, w.name AS site_name FROM ingestion_keys k JOIN websites w ON w.id=k.website_id WHERE k.key_hash=?', keyHash);
    if (!key || key.revoked_at) { audit('widget', 'ingest_401', '', { reason: 'bad key' }, req.ip); return err(res, 'AUTH', 'bad key', 401); }
    // origin allow-list
    const origins = JSON.parse(key.allowed_origins || '[]');
    const origin = req.get('Origin') ?? '';
    if (origins.length && origin) {
      const ok = origins.some(o => { try { return new URL(origin).host === new URL(o).host || new URL(origin).host.endsWith(new URL(o).host); } catch { return origin === o; } });
      if (!ok) { audit('widget', 'ingest_403_origin', String(key.website_id), { origin }, req.ip); return err(res, 'FORBIDDEN', 'origin not allowed', 403); }
    }
    const rl1 = rateLimit({ key: 'ingest:key:' + keyHash, max: 30, windowMs: 60000 });
    const rl2 = rateLimit({ key: 'ingest:ip:' + req.ip, max: 60, windowMs: 60000 });
    if (!rl1.ok || !rl2.ok) {
      res.set('Retry-After', String(Math.max(rl1.retryAfter ?? 0, rl2.retryAfter ?? 0)));
      return err(res, 'RATE', 'rate limited', 429);
    }
    const title = String(b.title ?? '').slice(0, 300);
    const description = String(b.description ?? '').slice(0, 4000);
    if (!title || !description) return err(res, 'VALIDATION', 'title+description required');
    const norm = normalizeReport({ title, description, steps: String(b.steps_to_reproduce ?? '') });
    const errors = Array.isArray(b.errors) ? b.errors.slice(0, 20) : [];
    const pageUrl = String(b.page_url ?? '').slice(0, 1000);
    let pagePath = '/';
    try { pagePath = new URL(pageUrl).pathname || '/'; } catch { pagePath = pageUrl.slice(0, 200) || '/'; }
    const fp = fingerprint({ keyHash, title: norm.title, pagePath, firstError: errors[0]?.message ?? '' });
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const dupe = await get('SELECT * FROM issues WHERE fingerprint=? AND created_at>? ORDER BY created_at DESC LIMIT 1', fp, tenMinAgo);
    if (dupe) {
      await run('UPDATE issues SET occurrences=occurrences+1, updated_at=? WHERE id=?', nowIso(), dupe.id);
      await run("UPDATE issues SET status='DEDUPLICATED' WHERE id=? AND status='RECEIVED'", dupe.id);
      audit('widget', 'ingest_dedup', dupe.id, {}, req.ip);
      return res.json({ success: true, issueId: dupe.id, status: 'DEDUPLICATED' });
    }
    const id = 'ISSUE-' + crypto.randomBytes(4).toString('hex');
    await run(`INSERT INTO issues (id,website_id,title,description,steps,page_url,release,context,element,errors,console,network,fingerprint,occurrences,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?)`, id, key.website_id, norm.title, norm.description, norm.steps, pageUrl,
      String(b.release ?? '').slice(0, 100), JSON.stringify(b.context ?? {}).slice(0, 8000), JSON.stringify(b.element ?? {}).slice(0, 8000),
      JSON.stringify(errors).slice(0, 20000), JSON.stringify((b.console ?? []).slice(0, 50)).slice(0, 20000),
      JSON.stringify((b.network ?? []).slice(0, 20)).slice(0, 8000), fp, 1, 'RECEIVED', nowIso(), nowIso());
    await run('UPDATE ingestion_keys SET last_used_at=? WHERE id=?', nowIso(), key.id);
    audit('widget', 'ingest_received', id, { site: key.website_id }, req.ip);
    res.json({ success: true, issueId: id, status: 'RECEIVED' });
    setImmediate(() => enqueue('processIssue', { issueId: id, website_id: key.website_id }));
  });

  // ---- websites ----
  r.get('/websites', requireAuth, async (req, res) => {
    const rows = await all('SELECT * FROM websites ORDER BY id DESC');
    res.json({ success: true, websites: rows.map(s => ({ ...s, allowed_origins: undefined })) });
  });
  r.post('/websites', requireAuth, async (req, res) => {
    if (!canManage(req.user.role)) return err(res, 'FORBIDDEN', 'owner/admin only', 403);
    const { name, repo_url, branch, site_url, health_url, version_path, root_path } = req.body ?? {};
    if (!name) return err(res, 'VALIDATION', 'name required');
    const parsed = repo_url ? parseRepoUrl(repo_url) : null;
    const id = await insertGetId('INSERT INTO websites (name,repo_url,repo_owner,repo_name,branch,root_path,site_url,health_url,version_path,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      name, repo_url ?? '', parsed?.owner ?? '', parsed?.repo ?? '', branch || 'main', root_path || '', site_url || '', health_url || '', version_path || '/version.json', nowIso());
    // auto-create ingestion key
    const plain = 'bsk_' + crypto.randomBytes(16).toString('hex');
    const h = crypto.createHash('sha256').update(plain).digest('hex');
    let allowed = [];
    try { if (site_url) allowed = [new URL(site_url).origin]; } catch {}
    await run('INSERT INTO ingestion_keys (website_id,label,key_hash,allowed_origins,created_at) VALUES (?,?,?,?,?)',
      id, 'default', h, JSON.stringify(allowed), nowIso());
    audit(req.user.email, 'website_create', String(id), { name }, req.ip);
    res.json({ success: true, id, ingestionKey: plain, note: 'key shown ONCE — store it now' });
  });
  r.get('/websites/:id', requireAuth, async (req, res) => {
    const w = await get('SELECT * FROM websites WHERE id=?', req.params.id);
    if (!w) return err(res, 'NOTFOUND', 'no such site', 404);
    const keys = await all('SELECT id,label,allowed_origins,created_at,revoked_at,last_used_at FROM ingestion_keys WHERE website_id=?', w.id);
    res.json({ success: true, website: w, keys });
  });
  r.patch('/websites/:id', requireAuth, async (req, res) => {
    if (!canManage(req.user.role)) return err(res, 'FORBIDDEN', 'owner/admin only', 403);
    const w = await get('SELECT * FROM websites WHERE id=?', req.params.id);
    if (!w) return err(res, 'NOTFOUND', 'no such site', 404);
    const fields = ['name', 'repo_url', 'branch', 'root_path', 'site_url', 'health_url', 'version_path', 'always_require_approval'];
    const patch = {};
    for (const f of fields) if (req.body[f] !== undefined) patch[f] = req.body[f];
    if (patch.repo_url) { const p = parseRepoUrl(patch.repo_url); if (p) { patch.repo_owner = p.owner; patch.repo_name = p.repo; } }
    const sets = Object.keys(patch).map(k => `${k}=?`).join(',');
    if (sets) await run(`UPDATE websites SET ${sets} WHERE id=?`, ...Object.values(patch), req.params.id);
    audit(req.user.email, 'website_update', req.params.id, redactJson(patch), req.ip);
    res.json({ success: true });
  });
  r.post('/websites/:id/keys', requireAuth, async (req, res) => {
    if (!canManage(req.user.role)) return err(res, 'FORBIDDEN', 'owner/admin only', 403);
    const plain = 'bsk_' + crypto.randomBytes(16).toString('hex');
    const h = crypto.createHash('sha256').update(plain).digest('hex');
    await run('INSERT INTO ingestion_keys (website_id,label,key_hash,allowed_origins,created_at) VALUES (?,?,?,?,?)',
      req.params.id, req.body?.label || 'key', h, JSON.stringify(req.body?.allowed_origins ?? []), nowIso());
    audit(req.user.email, 'key_create', req.params.id, {}, req.ip);
    res.json({ success: true, ingestionKey: plain, note: 'shown ONCE' });
  });
  r.delete('/websites/:id/keys/:keyId', requireAuth, async (req, res) => {
    if (!canManage(req.user.role)) return err(res, 'FORBIDDEN', 'owner/admin only', 403);
    await run('UPDATE ingestion_keys SET revoked_at=? WHERE id=? AND website_id=?', nowIso(), req.params.keyId, req.params.id);
    audit(req.user.email, 'key_revoke', req.params.keyId, {}, req.ip);
    res.json({ success: true });
  });
  r.post('/websites/:id/test', requireAuth, async (req, res) => {
    const w = await get('SELECT * FROM websites WHERE id=?', req.params.id);
    if (!w) return err(res, 'NOTFOUND', 'no such site', 404);
    const out = { github: 'not configured', site: 'not configured', ai: aiStatus().configured ? 'configured' : 'AI_UNAVAILABLE: no key' };
    if (w.repo_owner && w.repo_name) {
      try {
        const { ghFetch } = await import('../github/client.js');
        await ghFetch(`/repos/${w.repo_owner}/${w.repo_name}`, undefined);
        out.github = 'working';
      } catch (e) { out.github = 'error: ' + redact(e.message).slice(0, 200); }
    }
    if (w.site_url) {
      try {
        const r2 = await fetch(w.site_url, { signal: AbortSignal.timeout(8000) });
        out.site = r2.ok ? 'working' : `HTTP ${r2.status}`;
      } catch (e) { out.site = 'error: ' + String(e.message).slice(0, 200); }
    }
    res.json({ success: true, tests: out });
  });

  // ---- issues ----
  r.get('/issues', requireAuth, async (req, res) => {
    const { status, site, q, limit, cursor } = req.query;
    const lim = Math.min(100, Math.max(1, parseInt(limit ?? '20', 10) || 20));
    const conds = [], params = [];
    if (status) { conds.push('status=?'); params.push(status); }
    if (site) { conds.push('website_id=?'); params.push(site); }
    if (q) { conds.push('(title LIKE ? OR description LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    if (cursor) { conds.push('id<?'); params.push(cursor); }
    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
    const rows = await all(`SELECT * FROM issues ${where} ORDER BY created_at DESC, id DESC LIMIT ${lim + 1}`, ...params);
    const next = rows.length > lim ? rows[lim].id : null;
    res.json({ success: true, issues: rows.slice(0, lim), nextCursor: next });
  });
  r.get('/issues/:id', requireAuth, async (req, res) => {
    const issue = await get('SELECT * FROM issues WHERE id=?', req.params.id);
    if (!issue) return err(res, 'NOTFOUND', 'no such issue', 404);
    const steps = await all('SELECT * FROM pipeline_steps WHERE issue_id=? ORDER BY id', issue.id);
    const patches = await all('SELECT * FROM patches WHERE issue_id=? ORDER BY id DESC', issue.id);
    const validations = await all('SELECT * FROM validation_runs WHERE issue_id=? ORDER BY id', issue.id);
    const approvals = await all('SELECT * FROM approvals WHERE issue_id=? ORDER BY id', issue.id);
    const deployments = await all('SELECT * FROM deployments WHERE issue_id=? ORDER BY id', issue.id);
    const kase = await get('SELECT * FROM issue_cases WHERE issue_id=?', issue.id);
    res.json({ success: true, issue, steps, patches, validations, approvals, deployments, kase: kase ? JSON.parse(kase.case_json) : {} });
  });
  async function decide(req, res, decision) {
    if (!canApprove(req.user.role)) return err(res, 'FORBIDDEN', 'reviewer+ required', 403);
    const issue = await get('SELECT * FROM issues WHERE id=?', req.params.id);
    if (!issue) return err(res, 'NOTFOUND', 'no such issue', 404);
    if (issue.status !== 'AWAITING_APPROVAL') return err(res, 'STATE', `issue is ${issue.status}, not awaiting approval`, 409);
    const patch = await get('SELECT * FROM patches WHERE issue_id=? ORDER BY id DESC LIMIT 1', issue.id);
    const comment = String(req.body?.comment ?? '').slice(0, 1000);
    await run('INSERT INTO approvals (issue_id,patch_id,decision,user_id,comment,created_at) VALUES (?,?,?,?,?,?)',
      issue.id, patch?.id ?? null, decision, req.user.id, comment, nowIso());
    audit(req.user.email, decision === 'approved' ? 'approve' : 'reject', issue.id, { comment }, req.ip);
    if (decision === 'rejected') {
      await run('UPDATE issues SET status=?, updated_at=? WHERE id=?', 'REJECTED_BY_ADMIN', nowIso(), issue.id);
      return res.json({ success: true, status: 'REJECTED_BY_ADMIN' });
    }
    await run('UPDATE issues SET status=?, updated_at=? WHERE id=?', 'APPROVED', nowIso(), issue.id);
    // deploy async
    const site = await get('SELECT * FROM websites WHERE id=?', issue.website_id);
    const kase = await get('SELECT * FROM issue_cases WHERE issue_id=?', issue.id);
    const cj = kase ? JSON.parse(kase.case_json) : {};
    setImmediate(async () => {
      const { deployAndVerify } = await import('../agents/orchestrator.js');
      await deployAndVerify({ issueId: issue.id, site, patch: { applied: cj.applied ?? [], riskScore: patch?.risk_score ?? 0 }, patchId: patch?.id, headSha: cj.headSha, approver: req.user.email });
    });
    res.json({ success: true, status: 'APPROVED' });
  }
  r.post('/issues/:id/approve', requireAuth, async (req, res) => decide(req, res, 'approved'));
  r.post('/issues/:id/reject', requireAuth, async (req, res) => decide(req, res, 'rejected'));
  r.post('/issues/:id/retry', requireAuth, async (req, res) => {
    if (!canManage(req.user.role)) return err(res, 'FORBIDDEN', 'owner/admin only', 403);
    enqueue('processIssue', { issueId: req.params.id });
    res.json({ success: true });
  });
  r.post('/issues/:id/revert', requireAuth, async (req, res) => {
    if (!canManage(req.user.role)) return err(res, 'FORBIDDEN', 'owner/admin only', 403);
    const issue = await get('SELECT * FROM issues WHERE id=?', req.params.id);
    if (!issue) return err(res, 'NOTFOUND', 'no such issue', 404);
    const kase = await get('SELECT * FROM issue_cases WHERE issue_id=?', issue.id);
    if (!kase) return err(res, 'STATE', 'no case data to revert', 409);
    const cj = JSON.parse(kase.case_json);
    if (!cj.applied) return err(res, 'STATE', 'no applied patch to revert', 409);
    const site = await get('SELECT * FROM websites WHERE id=?', issue.website_id);
    try {
      const { revertFix } = await import('../agents/deployer.js');
      const rr = await revertFix({ site, branch: site.branch || 'main', appliedBefore: cj.applied, issueId: issue.id, reason: String(req.body?.reason ?? 'manual revert') });
      await run('UPDATE issues SET status=?, updated_at=? WHERE id=?', 'ROLLED_BACK', nowIso(), issue.id);
      await run("UPDATE deployments SET status='reverted', reverted_by_sha=? WHERE issue_id=?", rr.sha, issue.id);
      audit(req.user.email, 'revert', issue.id, { sha: rr.sha }, req.ip);
      res.json({ success: true, sha: rr.sha, url: rr.url });
    } catch (e) { return err(res, 'DEPLOY', redact(e.message).slice(0, 300), 500); }
  });

  // ---- settings / audit / stats / eval ----
  r.get('/settings/policy', requireAuth, async (req, res) => {
    const rows = await all('SELECT key,value FROM settings');
    const o = {}; for (const x of rows) { try { o[x.key] = JSON.parse(x.value); } catch { o[x.key] = x.value; } }
    res.json({ success: true, policy: { highThreshold: config.riskHigh, autoDeploy: config.autoDeployDefault, ...o } });
  });
  r.post('/settings/policy', requireAuth, async (req, res) => {
    if (!canManage(req.user.role)) return err(res, 'FORBIDDEN', 'owner/admin only', 403);
    const allowed = ['highThreshold', 'autoDeploy', 'criticalGlobs', 'maxFiles', 'maxEditsPerFile', 'maxLines', 'alwaysRequireApproval'];
    for (const k of allowed) if (req.body[k] !== undefined) await run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, JSON.stringify(req.body[k]));
    audit(req.user.email, 'settings_update', 'policy', redactJson(req.body), req.ip);
    res.json({ success: true });
  });
  r.get('/settings/integrations-status', requireAuth, (req, res) => {
    res.json({ success: true, ai: aiStatus(), github: config.githubToken ? { configured: true } : { configured: false, reason: 'GITHUB_TOKEN missing' }, render: config.renderApiKey ? { configured: true } : { configured: false, reason: 'RENDER_API_KEY missing' } });
  });
  r.get('/audit', requireAuth, async (req, res) => {
    const rows = await all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200');
    res.json({ success: true, audit: rows });
  });
  r.get('/stats/overview', requireAuth, async (req, res) => {
    const byStatus = await all('SELECT status, COUNT(*) AS c FROM issues GROUP BY status');
    const t = await get('SELECT COUNT(*) AS c FROM issues');
    const total = Number(t?.c ?? 0);
    const lastDeploy = await all('SELECT * FROM deployments ORDER BY id DESC LIMIT 5');
    res.json({ success: true, total, byStatus, lastDeploy, queue: undefined, health: { ai: aiStatus(), github: !!config.githubToken } });
  });
  r.get('/members', requireAuth, async (req, res) => {
    if (!canManage(req.user.role)) return err(res, 'FORBIDDEN', 'owner/admin only', 403);
    const rows = await all('SELECT id,email,name,role,created_at,disabled FROM users ORDER BY id');
    res.json({ success: true, members: rows });
  });
  r.post('/members', requireAuth, async (req, res) => {
    if (!canManage(req.user.role)) return err(res, 'FORBIDDEN', 'owner/admin only', 403);
    const { email, role, password } = req.body ?? {};
    if (!email || !password) return err(res, 'VALIDATION', 'email+password required');
    if (!ROLES.includes(role)) return err(res, 'VALIDATION', 'bad role');
    if (String(password).length < 12) return err(res, 'VALIDATION', 'password >= 12 chars');
    const { salt, hash } = hashPassword(password);
    try {
      const id = await insertGetId('INSERT INTO users (email,name,role,password_hash,salt,created_at) VALUES (?,?,?,?,?,?)',
        String(email).toLowerCase(), '', role, hash, salt, nowIso());
      audit(req.user.email, 'member_add', String(id), { email, role }, req.ip);
      res.json({ success: true, id });
    } catch { return err(res, 'EXISTS', 'email exists', 409); }
  });

  return r;
}
