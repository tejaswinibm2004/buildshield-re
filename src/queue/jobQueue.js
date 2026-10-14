// In-process FIFO queue with per-site mutex + concurrency cap + resume-on-boot.
// NOTE: on the free tier there is ONE instance, so in-process is correct.
// DB access is async (Supabase Postgres or local SQLite — see src/db/db.js).
import { get, all, run, nowIso } from '../db/db.js';
import { config } from '../config.js';

const running = new Set(); // siteIds currently deploying
const active = new Set();
let handler = null;
let pumping = false;

export function setJobHandler(fn) { handler = fn; }

// Never rejects: a failed enqueue is logged, never crashes the request path.
export async function enqueue(type, payload, runAt = null) {
  try {
    await run('INSERT INTO jobs (type,payload,status,attempts,run_at,last_error) VALUES (?,?,?,?,?,?)',
      type, JSON.stringify(payload), 'pending', 0, runAt ?? nowIso(), '');
  } catch (e) {
    console.error('enqueue failed:', e.message);
    return;
  }
  pump();
}
export async function pendingCount() {
  const r = await get("SELECT COUNT(*) AS c FROM jobs WHERE status='pending'");
  return Number(r?.c ?? 0);
}

export async function pump() {
  if (!handler || pumping) return;
  pumping = true;
  try {
    while (active.size < config.queueConcurrency) {
      const job = await get("SELECT * FROM jobs WHERE status='pending' ORDER BY id LIMIT 1");
      if (!job) return;
      const payload = JSON.parse(job.payload || '{}');
      const siteKey = String(payload.website_id ?? payload.siteId ?? 'global');
      if (payload._needsSiteMutex && running.has(siteKey)) return; // wait for per-site deploy mutex
      await run("UPDATE jobs SET status='running', attempts=attempts+1 WHERE id=?", job.id);
      active.add(job.id);
      if (payload._needsSiteMutex) running.add(siteKey);
      (async () => {
        try {
          await handler(job.type, payload, job);
          await run('UPDATE jobs SET status=? WHERE id=?', 'done', job.id);
        } catch (e) {
          const status = Number(job.attempts) + 1 >= 5 ? 'failed' : 'pending';
          try { await run('UPDATE jobs SET status=?, last_error=? WHERE id=?', status, String(e?.message ?? e).slice(0, 500), job.id); } catch {}
        } finally {
          active.delete(job.id);
          if (payload._needsSiteMutex) running.delete(siteKey);
          setImmediate(pump);
        }
      })();
    }
  } finally {
    pumping = false;
  }
}

// On boot: reset stuck running jobs to pending so pipeline resumes.
export async function resumeStuckJobs() {
  await run("UPDATE jobs SET status='pending' WHERE status='running'");
  // re-queue issues stuck in non-terminal states
  const terminal = ['INVALID_REPORT','NOT_REPRODUCIBLE_IN_CODE','SOURCE_UNAVAILABLE','AI_UNAVAILABLE','PATCH_FAILED','VALIDATION_FAILED','REJECTED_BY_ADMIN','RESOLVED_AND_DEPLOYED','DEPLOY_TIMEOUT','ROLLED_BACK','FAILED'];
  const stuck = await all(`SELECT id, website_id FROM issues WHERE status NOT IN (${terminal.map(()=>'?').join(',')})`, ...terminal);
  for (const s of stuck) await enqueue('processIssue', { issueId: s.id, website_id: s.website_id });
  return stuck.length;
}
