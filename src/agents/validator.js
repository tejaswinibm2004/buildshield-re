import { getDb, nowIso } from '../db/db.js';

export function recordStep(issueId, name, status, summary = '', evidence = {}) {
  const db = getDb();
  db.prepare('INSERT INTO pipeline_steps (issue_id,name,status,started_at,finished_at,summary,evidence) VALUES (?,?,?,?,?,?,?)')
    .run(issueId, name, status, nowIso(), nowIso(), summary, JSON.stringify(evidence).slice(0, 20000));
}

export function setIssueStatus(issueId, status, reason = '') {
  getDb().prepare('UPDATE issues SET status=?, status_reason=?, updated_at=? WHERE id=?').run(status, reason, nowIso(), issueId);
}

export function saveCase(issueId, patch) {
  const db = getDb();
  const prev = db.prepare('SELECT case_json FROM issue_cases WHERE issue_id=?').get(issueId);
  const merged = { ...(prev ? JSON.parse(prev.case_json) : {}), ...patch };
  db.prepare('INSERT INTO issue_cases (issue_id,case_json,updated_at) VALUES (?,?,?) ON CONFLICT(issue_id) DO UPDATE SET case_json=excluded.case_json, updated_at=excluded.updated_at')
    .run(issueId, JSON.stringify(merged).slice(0, 100000), nowIso());
  return merged;
}

export function audit(actor, action, target = '', detail = {}, ipHash = '') {
  try {
    getDb().prepare('INSERT INTO audit_log (ts,actor,action,target,detail,ip_hash) VALUES (?,?,?,?,?,?)')
      .run(nowIso(), actor, action, target, JSON.stringify(detail).slice(0, 4000), ipHash);
  } catch {}
}
