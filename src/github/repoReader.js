import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { ghFetch } from './client.js';

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'vendor', '.var', 'coverage']);
const MAX_FILE = 200 * 1024;

function cacheDir(siteId, sha) {
  return path.join(config.dataDir, 'cache', String(siteId), sha);
}

// Reads repo snapshot via tarball API; caches extracted tree (file list + contents on demand).
export async function getHeadSha(owner, repo, branch) {
  const ref = await ghFetch(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  return ref.object.sha;
}

export async function fetchSnapshot({ siteId, owner, repo, branch, rootPath = '' }) {
  const sha = await getHeadSha(owner, repo, branch);
  const dir = cacheDir(siteId, sha);
  if (fs.existsSync(path.join(dir, '.done'))) return { sha, dir };
  fs.mkdirSync(dir, { recursive: true });
  // Use tarball download
  const token = config.githubToken;
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/tarball/${sha}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'bugshield' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`GitHub tarball fetch failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Write + extract using system tar (available on Render/linux; fallback: store raw)
  const tgz = path.join(dir, 'repo.tgz');
  fs.writeFileSync(tgz, buf);
  try {
    const { execSync } = await import('node:child_process');
    execSync(`tar xzf ${JSON.stringify(tgz)} -C ${JSON.stringify(dir)} --strip-components=1`, { stdio: 'pipe' });
  } catch {
    throw new Error('Failed to extract repo tarball (tar missing?)');
  }
  fs.writeFileSync(path.join(dir, '.done'), sha);
  pruneCache(siteId);
  return { sha, dir };
}

function pruneCache(siteId) {
  try {
    const base = path.join(config.dataDir, 'cache', String(siteId));
    const entries = fs.readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory());
    if (entries.length > 5) {
      const scored = entries.map(e => ({ e, t: fs.statSync(path.join(base, e.name)).mtimeMs })).sort((a, b) => a.t - b.t);
      for (let i = 0; i < scored.length - 5; i++) fs.rmSync(path.join(base, scored[i].e.name), { recursive: true, force: true });
    }
  } catch {}
}

export function listFiles(dir, rootPath = '') {
  const base = rootPath ? path.join(dir, rootPath) : dir;
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (IGNORE_DIRS.has(e.name)) continue;
      const full = path.join(d, e.name);
      const rel = path.relative(base, full).replace(/\\/g, '/');
      if (e.isDirectory()) { walk(full); continue; }
      if (/package-lock\.json$|yarn\.lock$|\.min\.js$|\.map$|\.png$|\.jpg$|\.ico$|\.woff2?$/.test(e.name)) continue;
      try {
        const st = fs.statSync(full);
        if (st.size > MAX_FILE) continue;
        out.push({ path: rel, size: st.size });
      } catch {}
    }
  };
  if (fs.existsSync(base)) walk(base);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function readFileAt(dir, rootPath, rel) {
  const base = rootPath ? path.join(dir, rootPath) : dir;
  const full = path.join(base, rel);
  const resolved = path.resolve(full);
  if (!resolved.startsWith(path.resolve(base))) throw new Error('Path escapes repo root');
  return fs.readFileSync(resolved, 'utf8');
}

export function stackHints() {
  return { ignore: IGNORE_DIRS, maxFile: MAX_FILE };
}
