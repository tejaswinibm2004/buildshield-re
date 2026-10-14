import { get, run, nowIso } from '../db/db.js';

export async function recordStep(issueId, name, status, summary = '', evidence = {}) {
  await run('INSERT INTO pipeline_steps (issue_id,name,status,started_at,finished_at,summary,evidence) VALUES (?,?,?,?,?,?,?)',
    issueId, name, status, nowIso(), nowIso(), summary, JSON.stringify(evidence).slice(0, 20000));
}

export async function setIssueStatus(issueId, status, reason = '') {
  await run('UPDATE issues SET status=?, status_reason=?, updated_at=? WHERE id=?', status, reason, nowIso(), issueId);
}

export async function saveCase(issueId, patch) {
  const prev = await get('SELECT case_json FROM issue_cases WHERE issue_id=?', issueId);
  const merged = { ...(prev ? JSON.parse(prev.case_json) : {}), ...patch };
  await run('INSERT INTO issue_cases (issue_id,case_json,updated_at) VALUES (?,?,?) ON CONFLICT(issue_id) DO UPDATE SET case_json=excluded.case_json, updated_at=excluded.updated_at',
    issueId, JSON.stringify(merged).slice(0, 100000), nowIso());
  return merged;
}

// Fire-and-forget safe: never rejects, so call sites don't need await/catch.
export async function audit(actor, action, target = '', detail = {}, ipHash = '') {
  try {
    await run('INSERT INTO audit_log (ts,actor,action,target,detail,ip_hash) VALUES (?,?,?,?,?,?)',
      nowIso(), actor, action, target, JSON.stringify(detail).slice(0, 4000), ipHash);
  } catch {}
}
