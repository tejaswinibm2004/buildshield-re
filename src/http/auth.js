import crypto from 'node:crypto';
import { get, run, nowIso } from '../db/db.js';

export const ROLES = ['owner', 'admin', 'reviewer', 'viewer'];
const N = 16384, KEYLEN = 64;
const SESSION_TTL_MS = 12 * 3600 * 1000;

export function hashPassword(password, saltHex) {
  const salt = saltHex ?? crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, Buffer.from(salt, 'hex'), KEYLEN, { N, r: 8, p: 1 });
  return { salt, hash: hash.toString('hex') };
}

export function verifyPassword(password, saltHex, hashHex) {
  const h = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), KEYLEN, { N, r: 8, p: 1 });
  const a = Buffer.from(h.toString('hex'), 'hex');
  const b = Buffer.from(hashHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function ensureBootstrapOwner(email, passwordOrEmpty) {
  const row = await get('SELECT COUNT(*) AS c FROM users');
  if (Number(row.c) > 0) return { created: false };
  let password = passwordOrEmpty;
  let generated = false;
  if (!password) { password = crypto.randomBytes(12).toString('base64url'); generated = true; }
  if (password.length < 12) throw new Error('BOOTSTRAP_OWNER_PASSWORD must be >= 12 chars');
  const { salt, hash } = hashPassword(password);
  await run('INSERT INTO users (email,name,role,password_hash,salt,created_at,disabled) VALUES (?,?,?,?,?,?,0)',
    email.toLowerCase(), 'Owner', 'owner', hash, salt, nowIso());
  return { created: true, generated, password: generated ? password : undefined };
}

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = Date.now();
  await run('INSERT INTO sessions (user_id,token_hash,created_at,expires_at,last_seen) VALUES (?,?,?,?,?)',
    userId, tokenHash, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString(), new Date(now).toISOString());
  return token;
}

export async function getUserByToken(token) {
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const s = await get('SELECT * FROM sessions WHERE token_hash=?', tokenHash);
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) {
    await run('DELETE FROM sessions WHERE token_hash=?', tokenHash);
    return null;
  }
  const u = await get('SELECT * FROM users WHERE id=? AND disabled=0', s.user_id);
  if (!u) return null;
  await run('UPDATE sessions SET last_seen=? WHERE token_hash=?', nowIso(), tokenHash);
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

export async function destroySession(token) {
  if (!token) return;
  const h = crypto.createHash('sha256').update(token).digest('hex');
  await run('DELETE FROM sessions WHERE token_hash=?', h);
}

// login rate limit + lockout (in-memory)
const attempts = new Map(); // email -> {fails, lockedUntil}
export function loginAllowed(email) {
  const e = attempts.get(email.toLowerCase());
  if (!e) return { ok: true };
  if (e.lockedUntil && e.lockedUntil > Date.now()) return { ok: false, retryAfter: Math.ceil((e.lockedUntil - Date.now()) / 1000) };
  return { ok: true };
}
export function loginFailed(email) {
  const k = email.toLowerCase();
  const e = attempts.get(k) ?? { fails: 0, lockedUntil: 0 };
  e.fails += 1;
  if (e.fails >= 10) e.lockedUntil = Date.now() + 5 * 60 * 1000;
  else if (e.fails >= 5) e.lockedUntil = Date.now() + 60 * 1000;
  attempts.set(k, e);
}
export function loginSucceeded(email) { attempts.delete(email.toLowerCase()); }

export function canApprove(role) { return ['owner', 'admin', 'reviewer'].includes(role); }
export function canManage(role) { return ['owner', 'admin'].includes(role); }
