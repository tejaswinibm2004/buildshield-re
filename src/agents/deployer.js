import { atomicCommit, commitMessage } from '../github/committer.js';
import { getHeadSha } from '../github/repoReader.js';

export async function deploy({ site, applied, issueId, riskScore, validatorsPassed, approver, branch }) {
  const files = applied.map(a => ({ path: (site.root_path ? site.root_path.replace(/\/$/, '') + '/' : '') + a.path, content: a.after }));
  const message = commitMessage('auto fix', issueId, riskScore, validatorsPassed, approver);
  // drift check
  const head = await getHeadSha(site.repo_owner, site.repo_name, branch);
  return { ...(await atomicCommit({ owner: site.repo_owner, repo: site.repo_name, branch, files, message })), headBefore: head };
}

export async function revertFix({ site, branch, appliedBefore, issueId, reason }) {
  const files = appliedBefore.map(a => ({ path: (site.root_path ? site.root_path.replace(/\/$/, '') + '/' : '') + a.path, content: a.before }));
  const message = `revert(bugshield): undo fix [${issueId}] reason: ${reason}`;
  const { atomicCommit: ac } = await import('../github/committer.js');
  return ac({ owner: site.repo_owner, repo: site.repo_name, branch, files, message });
}
