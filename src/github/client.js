import { config } from '../config.js';

function headers(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'bugshield',
  };
}

export async function ghFetch(path, token, opts = {}) {
  // Tolerate ghFetch(path, {...opts}) — a past bug passed opts in the token
  // slot, sending `Bearer [object Object]` (GitHub answers 404, not 401).
  if (token && typeof token === 'object') { opts = token; token = undefined; }
  const t = token ?? config.githubToken;
  if (!t) { const e = new Error('GitHub token not configured (SOURCE_UNAVAILABLE)'); e.code = 'NO_TOKEN'; throw e; }
  const res = await fetch(`https://api.github.com${path}`, { ...opts, headers: { ...headers(t), ...(opts.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const e = new Error(`GitHub ${opts.method ?? 'GET'} ${path} -> ${res.status}`);
    e.status = res.status; e.body = body.slice(0, 500);
    throw e;
  }
  return res.json();
}

export function parseRepoUrl(url) {
  const m = String(url || '').match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}
