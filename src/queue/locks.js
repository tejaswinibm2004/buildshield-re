// Per-site deploy mutex helpers (backed by jobQueue running set + a DB-free in-memory lock).
const locks = new Map();
export async function withSiteLock(siteId, fn) {
  const k = String(siteId);
  while (locks.get(k)) await new Promise(r => setTimeout(r, 200));
  locks.set(k, true);
  try { return await fn(); } finally { locks.delete(k); }
}
