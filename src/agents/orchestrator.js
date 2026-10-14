import { get, all, run, insertGetId, nowIso } from '../db/db.js';
import { normalizeReport, extractHints } from './intake.js';
import { localize } from './localizer.js';
import { analyze } from './analyzer.js';
import { scoreRisk, requiresApproval } from './risk.js';
import { generatePatch } from './patcher.js';
import { critique } from './critic.js';
import { scanAddedLines, instructionEchoCheck } from './safety.js';
import { runValidatorsForPatch } from '../validators/index.js';
import { recordStep, setIssueStatus, saveCase, audit } from './validator.js';
import { aiStatus } from '../ai/provider.js';
import { config } from '../config.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
function loadPrompt(n) { try { return fs.readFileSync(path.join(__dirname, '../ai/prompts', n), 'utf8'); } catch { return ''; } }

let broadcast = () => {};
export function setBroadcaster(fn) { broadcast = fn; }
function emit(issueId, payload) { try { broadcast(issueId, payload); } catch {} }

async function getIssue(id) { return get('SELECT * FROM issues WHERE id=?', id); }
async function getSite(id) { return get('SELECT * FROM websites WHERE id=?', id); }
async function getSettings() {
  const rows = await all('SELECT key,value FROM settings');
  const s = {};
  for (const r of rows) { try { s[r.key] = JSON.parse(r.value); } catch { s[r.key] = r.value; } }
  return {
    highThreshold: s.highThreshold ?? config.riskHigh,
    autoDeploy: s.autoDeploy ?? config.autoDeployDefault,
    criticalGlobs: s.criticalGlobs ?? ['**/auth/**', '**/payment/**', '**/checkout/**', '**/login/**', '**/.env*', '**/secrets/**'],
    maxFiles: s.maxFiles ?? config.maxFiles,
    maxEditsPerFile: s.maxEditsPerFile ?? config.maxEditsPerFile,
    maxLines: s.maxLines ?? config.maxLines,
  };
}

export async function processIssue(issueId, deps = {}) {
  const issue = await getIssue(issueId);
  if (!issue) return;
  if (['RESOLVED_AND_DEPLOYED', 'INVALID_REPORT', 'REJECTED_BY_ADMIN', 'ROLLED_BACK'].includes(issue.status)) return;
  const site = issue.website_id ? await getSite(issue.website_id) : null;
  const settings = await getSettings();

  // INTAKE
  await setIssueStatus(issueId, 'TRIAGING');
  const norm = normalizeReport({ title: issue.title, description: issue.description, steps: issue.steps });
  const hints = extractHints({ ...norm, element: JSON.parse(issue.element || '{}'), errors: JSON.parse(issue.errors || '[]'), network: JSON.parse(issue.network || '[]'), page_url: issue.page_url });
  await saveCase(issueId, { report: norm, hints });
  await recordStep(issueId, 'intake', 'ok', `${hints.quoted.length} quoted strings, ${hints.stackFiles.length} stack files`, { hints });
  emit(issueId, { type: 'ISSUE_UPDATED', issueId, status: 'TRIAGING' });

  // repo snapshot
  let snapshot = null, headSha = null;
  if (site?.repo_owner && site?.repo_name) {
    if (!deps.repoReader) { try { deps.repoReader = await import('../github/repoReader.js'); } catch {} }
    try {
      await setIssueStatus(issueId, 'TRIAGING');
      const { fetchSnapshot } = deps.repoReader ?? await import('../github/repoReader.js');
      snapshot = await fetchSnapshot({ siteId: site.id, owner: site.repo_owner, repo: site.repo_name, branch: site.branch || 'main', rootPath: site.root_path || '' });
      headSha = snapshot.sha;
      await saveCase(issueId, { headSha });
      await recordStep(issueId, 'repo_snapshot', 'ok', `head ${headSha.slice(0, 7)}`, { sha: headSha });
    } catch (e) {
      const msg = String(e.message ?? e);
      if (/token|401|403|404/i.test(msg)) {
        await setIssueStatus(issueId, 'SOURCE_UNAVAILABLE', msg.slice(0, 300));
        await recordStep(issueId, 'repo_snapshot', 'failed', msg.slice(0, 300), {});
        return;
      }
      await setIssueStatus(issueId, 'FAILED', msg.slice(0, 300));
      await recordStep(issueId, 'repo_snapshot', 'failed', msg.slice(0, 300), {});
      return;
    }
  } else {
    await setIssueStatus(issueId, 'SOURCE_UNAVAILABLE', 'website has no GitHub repo connected');
    await recordStep(issueId, 'repo_snapshot', 'failed', 'no repo connected', {});
    return;
  }

  // LOCALIZER
  const chatJsonFn = deps.chatJsonFn ?? (await import('../ai/provider.js')).chatJson;
  const st = aiStatus();
  // cheap-signals-only path when AI unavailable: still try grep; analyzer will report AI_UNAVAILABLE
  let loc;
  try {
    let llmSelect = null;
    if (st.configured) {
      const sysLocal = loadPrompt('localizer.md');
      llmSelect = async ({ repoMap, hints, signals }) => {
        const user = `LOCALIZE\nREPO MAP:\n${repoMap.slice(0, 8000)}\nSIGNALS: ${JSON.stringify(signals).slice(0, 2000)}\nREPORT: ${norm.title} / ${norm.description.slice(0, 800)}`;
        const r = await chatJsonFn({ system: sysLocal, user, maxTokens: 800 });
        return r.data;
      };
    }
    loc = await localize({ snapshotDir: snapshot.dir, rootPath: site.root_path || '', hints, pagePath: hints.pagePath, llmSelect });
  } catch (e) {
    await setIssueStatus(issueId, 'FAILED', String(e.message).slice(0, 300));
    return;
  }
  if (!loc.candidates.length) {
    await setIssueStatus(issueId, 'NOT_REPRODUCIBLE_IN_CODE', 'localizer found no plausible files');
    await recordStep(issueId, 'localizer', 'empty', 'no candidates', { repoMap: loc.repoMap?.slice(0, 2000) });
    return;
  }
  await recordStep(issueId, 'localizer', 'ok', loc.candidates.map(c => c.path).join(', '), { candidates: loc.candidates.map(c => ({ path: c.path, reason: c.reason })) });
  await saveCase(issueId, { candidates: loc.candidates });

  // ANALYZER
  if (!st.configured) {
    await setIssueStatus(issueId, 'AI_UNAVAILABLE', st.reason);
    await recordStep(issueId, 'analyzer', 'skipped', st.reason, {});
    emit(issueId, { type: 'ISSUE_UPDATED', issueId, status: 'AI_UNAVAILABLE' });
    return;
  }
  await setIssueStatus(issueId, 'ANALYZING');
  let analysis;
  try {
    analysis = await (deps.analyzeFn ?? analyze)({ report: { ...norm, page_url: issue.page_url, element: JSON.parse(issue.element || '{}'), errors: JSON.parse(issue.errors || '[]') }, chunks: loc.candidates, chatJsonFn });
  } catch (e) {
    if (e.code === 'AI_UNAVAILABLE') { await setIssueStatus(issueId, 'AI_UNAVAILABLE', e.message); return; }
    await setIssueStatus(issueId, 'FAILED', String(e.message).slice(0, 300));
    return;
  }
  await saveCase(issueId, { analysis });
  await recordStep(issueId, 'analyzer', analysis.is_defect ? 'ok' : 'invalid', analysis.explanation.slice(0, 500), { analysis });
  if (!analysis.is_defect || analysis.confidence < 0.5) {
    await setIssueStatus(issueId, 'INVALID_REPORT', analysis.explanation.slice(0, 500));
    emit(issueId, { type: 'ISSUE_UPDATED', issueId, status: 'INVALID_REPORT' });
    return;
  }

  // PATCHER
  await setIssueStatus(issueId, 'PATCHING');
  let patch;
  try {
    const gen = deps.generatePatchFn ?? generatePatch;
    patch = await gen({ analysis, candidates: loc.candidates, snapshotDir: snapshot.dir, rootPath: site.root_path || '', limits: settings, chatJsonFn });
    if (!patch.ok) {
      // one strict retry if uniqueness failed
      if (patch.retryHint) {
        patch = await gen({ analysis, candidates: loc.candidates, snapshotDir: snapshot.dir, rootPath: site.root_path || '', limits: settings, chatJsonFn });
      }
      if (!patch.ok) {
        await setIssueStatus(issueId, 'PATCH_FAILED', patch.error);
        await recordStep(issueId, 'patcher', 'failed', patch.error, { diff: patch.diff ?? '' });
        return;
      }
    }
  } catch (e) {
    await setIssueStatus(issueId, 'PATCH_FAILED', String(e.message).slice(0, 300));
    return;
  }
  // persist patch row
  const risk0 = scoreRisk({ diffFiles: patch.applied, diffText: patch.diff, defectType: analysis.defect_type, confidence: analysis.confidence, settings });
  const patchId = await insertGetId('INSERT INTO patches (issue_id,summary,files,diff_text,risk_score,risk_factors,critic,created_at) VALUES (?,?,?,?,?,?,?,?)',
    issueId, patch.summary, JSON.stringify(patch.applied.map(a => ({ path: a.path, edits: a.edits }))), patch.diff, risk0.score, JSON.stringify(risk0.factors), '{}', nowIso());
  await recordStep(issueId, 'patcher', 'ok', patch.summary, { diff: patch.diff.slice(0, 12000), patchId });
  await saveCase(issueId, { patchId, diff: patch.diff, applied: patch.applied.map(a => ({ path: a.path, before: a.before, after: a.after })) });

  // CRITIC + safety scan
  const critic = await (deps.critiqueFn ?? critique)({ report: norm, snippet: patch.applied[0]?.before?.slice(0, 4000) ?? '', diff: patch.diff, chatJsonFn }).catch(() => ({ verdict: 'concern', concerns: ['critic call failed — forcing human review'] }));
  const scanHits = scanAddedLines(patch.diff);
  const echoHits = instructionEchoCheck(patch.diff, norm.title + ' ' + norm.description);
  const safetyHit = scanHits.length > 0 || echoHits.length > 2;
  await run('UPDATE patches SET critic=? WHERE id=?', JSON.stringify({ ...critic, scanHits, echoHits }).slice(0, 8000), patchId);
  await recordStep(issueId, 'critic', critic.verdict, (critic.concerns ?? []).join('; ').slice(0, 500) || 'clean', { critic, scanHits, echoHits });
  if (critic.verdict === 'reject') {
    await setIssueStatus(issueId, 'PATCH_FAILED', 'critic rejected: ' + (critic.concerns ?? []).join('; ').slice(0, 300));
    return;
  }

  // RISK
  const risk = scoreRisk({ diffFiles: patch.applied, diffText: patch.diff, defectType: analysis.defect_type, confidence: analysis.confidence, settings: { ...settings, alwaysRequireApproval: !!site.always_require_approval } });
  await run('UPDATE patches SET risk_score=?, risk_factors=? WHERE id=?', risk.score, JSON.stringify(risk.factors), patchId);
  await recordStep(issueId, 'risk', risk.level, `score ${risk.score} (${risk.level})`, { risk });
  await saveCase(issueId, { risk });

  // VALIDATOR
  await setIssueStatus(issueId, 'VALIDATING');
  const { results, passed } = await (deps.validateFn ?? runValidatorsForPatch)(patch.applied);
  for (const r of results) {
    await run('INSERT INTO validation_runs (issue_id,patch_id,validator_id,status,details,created_at) VALUES (?,?,?,?,?,?)',
      issueId, patchId, r.validator_id, r.status, JSON.stringify(r.details).slice(0, 4000), nowIso());
  }
  await recordStep(issueId, 'validator', passed ? 'ok' : 'failed', results.map(r => `${r.validator_id}:${r.status}`).join(', '), { results });
  if (!passed) {
    await setIssueStatus(issueId, 'VALIDATION_FAILED', 'a validator failed; not deployed');
    emit(issueId, { type: 'ISSUE_UPDATED', issueId, status: 'VALIDATION_FAILED' });
    return;
  }

  // APPROVAL GATE
  const gate = requiresApproval({ risk, settings: { ...settings, alwaysRequireApproval: !!site.always_require_approval }, safetyHit, criticVerdict: critic.verdict, validationClean: passed });
  const tooLarge = patch.tooLarge;
  if (tooLarge) gate.required = true, gate.reasons.push('diff above size limits');
  if (gate.required) {
    await setIssueStatus(issueId, 'AWAITING_APPROVAL', gate.reasons.join('; '));
    await recordStep(issueId, 'approval_gate', 'paused', gate.reasons.join('; '), { risk, reasons: gate.reasons });
    audit('system', 'approval_needed', issueId, { risk: risk.score, reasons: gate.reasons });
    emit(issueId, { type: 'APPROVAL_NEEDED', issueId, risk });
    return;
  }

  // DEPLOY
  await deployAndVerify({ issueId, site, patch, patchId, headSha, approver: 'auto', settings });
}

export async function deployAndVerify({ issueId, site, patch, patchId, headSha, approver, deps = {} }) {
  // drift check
  try {
    const { getHeadSha } = await import('../github/repoReader.js');
    const now = await getHeadSha(site.repo_owner, site.repo_name, site.branch || 'main');
    if (headSha && now !== headSha) {
      await recordStep(issueId, 'drift', 'moved', `head moved ${headSha.slice(0, 7)} -> ${now.slice(0, 7)}; re-validate required`, {});
      // simplest honest path: require re-run
      await setIssueStatus(issueId, 'TRIAGING', 'repo head moved; re-run pipeline');
      const { enqueue } = await import('../queue/jobQueue.js');
      enqueue('processIssue', { issueId, website_id: site.id });
      return;
    }
  } catch (e) {
    await setIssueStatus(issueId, 'FAILED', 'drift check failed: ' + String(e.message).slice(0, 200));
    return;
  }
  await setIssueStatus(issueId, 'PUSHING');
  await recordStep(issueId, 'deployer', 'pushing', 'committing via Git Data API', {});
  try {
    const { deploy } = await import('./deployer.js');
    const applied = patch.applied ?? patch;
    const files = Array.isArray(applied) ? applied : [];
    const d = await (deps.deployFn ?? deploy)({ site, applied: files, issueId, riskScore: patch.riskScore ?? 0, validatorsPassed: 'see validation_runs', approver, branch: site.branch || 'main' });
    const depId = await insertGetId('INSERT INTO deployments (issue_id,patch_id,commit_sha,commit_url,branch,status,created_at) VALUES (?,?,?,?,?,?,?)',
      issueId, patchId, d.sha, d.url, site.branch || 'main', 'pushed', nowIso());
    await setIssueStatus(issueId, 'DEPLOYING');
    await recordStep(issueId, 'deployer', 'ok', `commit ${d.sha.slice(0, 7)} ${d.url}`, { sha: d.sha, url: d.url, depId });
    emit(issueId, { type: 'DEPLOY_STATUS', issueId, status: 'DEPLOYING', sha: d.sha });
    // VERIFY
    const { verifyLive } = await import('./verifier.js');
    const v = await (deps.verifyFn ?? verifyLive)({ site, commitSha: d.sha });
    await run('UPDATE deployments SET status=?, live_verified_at=?, health_result=? WHERE id=?',
      v.verified ? 'live' : (v.live ? 'unverified' : 'timeout'), v.verified ? nowIso() : null, JSON.stringify(v).slice(0, 4000), depId);
    if (v.verified && v.live) {
      await setIssueStatus(issueId, 'RESOLVED_AND_DEPLOYED', `live at ${d.sha.slice(0, 7)}`);
      await recordStep(issueId, 'verifier', 'ok', v.reason, v);
    } else if (!v.verified && v.reason?.includes('UNVERIFIED')) {
      await setIssueStatus(issueId, 'RESOLVED_AND_DEPLOYED', v.reason);
      await recordStep(issueId, 'verifier', 'unverified', v.reason, v);
    } else if (!v.live && v.health && v.health.ok === false && v.verified) {
      // auto-revert on failed post-deploy health
      await recordStep(issueId, 'verifier', 'health_failed', JSON.stringify(v.health), v);
      await autoRevert({ issueId, site, patchId, applied: files, reason: 'post-deploy health failed' });
    } else {
      await setIssueStatus(issueId, 'DEPLOY_TIMEOUT', v.reason);
      await recordStep(issueId, 'verifier', 'timeout', v.reason, v);
    }
    const cur = await get('SELECT status FROM issues WHERE id=?', issueId);
    emit(issueId, { type: 'ISSUE_UPDATED', issueId, status: cur.status });
  } catch (e) {
    const msg = String(e.message ?? e);
    if (e.code === 'NON_FAST_FORWARD' || /409|422|fast-forward/i.test(msg)) {
      await setIssueStatus(issueId, 'TRIAGING', 'push conflict; will rebase and retry once');
      await recordStep(issueId, 'deployer', 'conflict', msg.slice(0, 300), {});
      const { enqueue } = await import('../queue/jobQueue.js');
      enqueue('processIssue', { issueId, website_id: site.id });
      return;
    }
    await setIssueStatus(issueId, 'FAILED', msg.slice(0, 300));
    await recordStep(issueId, 'deployer', 'failed', msg.slice(0, 300), {});
  }
}

async function autoRevert({ issueId, site, patchId, applied, reason }) {
  const { revertFix } = await import('./deployer.js');
  const r = await revertFix({ site, branch: site.branch || 'main', appliedBefore: applied, issueId, reason });
  await run("UPDATE deployments SET status='reverted', reverted_by_sha=? WHERE issue_id=?", r.sha, issueId);
  await setIssueStatus(issueId, 'ROLLED_BACK', reason + ` reverted in ${r.sha.slice(0, 7)}`);
  await recordStep(issueId, 'revert', 'ok', `reverted in ${r.sha} ${r.url}`, { sha: r.sha });
}
