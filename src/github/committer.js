import { ghFetch } from './client.js';

// Atomic multi-file commit via Git Data API. Returns {sha, url}.
export async function atomicCommit({ owner, repo, branch, files, message, authorName = 'BugShield Bot', authorEmail = 'bot@bugshield.local' }) {
  // files: [{path, content}]
  const ref = await ghFetch(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  const parentSha = ref.object.sha;
  const parentCommit = await ghFetch(`/repos/${owner}/${repo}/git/commits/${parentSha}`);
  const baseTree = parentCommit.tree.sha;
  const blobs = [];
  for (const f of files) {
    const b = await ghFetch(`/repos/${owner}/${repo}/git/blobs`, undefined, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: f.content, encoding: 'utf-8' }),
    });
    blobs.push({ path: f.path, sha: b.sha, mode: '100644', type: 'blob' });
  }
  const tree = await ghFetch(`/repos/${owner}/${repo}/git/trees`, undefined, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_tree: baseTree, tree: blobs }),
  });
  const commit = await ghFetch(`/repos/${owner}/${repo}/git/commits`, undefined, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha], author: { name: authorName, email: authorEmail } }),
  });
  try {
    await ghFetch(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, undefined, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sha: commit.sha, force: false }),
    });
  } catch (e) {
    e.parentSha = parentSha; e.code = 'NON_FAST_FORWARD';
    throw e;
  }
  return { sha: commit.sha, url: `https://github.com/${owner}/${repo}/commit/${commit.sha}`, parentSha };
}

export function commitMessage(summary, issueId, riskScore, validatorsPassed, approver) {
  return `fix(bugshield): ${summary} [${issueId}]\n\nrisk: ${riskScore}\nvalidators: ${validatorsPassed}\napprover: ${approver}\n`;
}
