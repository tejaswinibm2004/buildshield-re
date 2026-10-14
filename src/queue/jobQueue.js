// In-process FIFO queue with per-site mutex + concurrency cap + resume-on-boot.
import { getDb, nowIso } from '../db/db.js';
import { config } from '../config.js';

const running = new Set(); // siteIds currently deploying
const active = new Set();
let handler = null;

export function setJobHandler(fn) { handler = fn; }
export function enqueue(type, payload, runAt = null) {
  const db = getDb();
  db.prepare('INSERT INTO jobs (type,payload,status,attempts,run_at,last_error) VALUES (?,?,?,?,?,?)')
    .run(type, JSON.stringify(payload), 'pending', 0, runAt ?? nowIso(), '');
  pump();
}
export function pendingCount() {
  return getDb().prepare("SELECT COUNT(*) c FROM jobs WHERE status='pending'").get().c;
}

export async function pump() {
  if (!handler) return;
  const db = getDb();
  while (active.size < config.queueConcurrency) {
    const job = db.prepare("SELECT * FROM jobs WHERE status='pending' ORDER BY id LIMIT 1").get();
    if (!job) return;
    const payload = JSON.parse(job.payload || '{}');
    const siteKey = String(payload.website_id ?? payload.siteId ?? 'global');
    if (payload._needsSiteMutex && running.has(siteKey)) return; // wait for per-site deploy mutex
    db.prepare("UPDATE jobs SET status='running', attempts=attempts+1 WHERE id=?").run(job.id);
    active.add(job.id);
    if (payload._needsSiteMutex) running.add(siteKey);
    (async () => {
      try {
        await handler(job.type, payload, job);
        getDb().prepare("UPDATE jobs SET status='done' WHERE id=?").run(job.id);
      } catch (e) {
        getDb().prepare("UPDATE jobs SET status=?, last_error=? WHERE id=?")
          .run(job.attempts + 1 >= 5 ? 'failed' : 'pending', String(e?.message ?? e).slice(0, 500), job.id);
      } finally {
        active.delete(job.id);
        if (payload._needsSiteMutex) running.delete(siteKey);
        setImmediate(pump);
      }
    })();
  }
}

// On boot: reset stuck running jobs to pending so pipeline resumes.
export function resumeStuckJobs() {
  const db = getDb();
  db.prepare("UPDATE jobs SET status='pending' WHERE status='running'").run();
  // re-queue issues stuck in non-terminal states
  const terminal = ['INVALID_REPORT','NOT_REPRODUCIBLE_IN_CODE','SOURCE_UNAVAILABLE','AI_UNAVAILABLE','PATCH_FAILED','VALIDATION_FAILED','REJECTED_BY_ADMIN','RESOLVED_AND_DEPLOYED','DEPLOY_TIMEOUT','ROLLED_BACK','FAILED'];
  const stuck = db.prepare(`SELECT id, website_id FROM issues WHERE status NOT IN (${terminal.map(()=>'?').join(',')})`).all(...terminal);
  for (const s of stuck) enqueue('processIssue', { issueId: s.id, website_id: s.website_id });
  return stuck.length;
}
