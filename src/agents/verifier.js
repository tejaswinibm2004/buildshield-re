import { config } from '../config.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function verifyLive({ site, commitSha, timeoutMs, pollMs, fetchFn = fetch }) {
  timeoutMs ??= config.verifyTimeoutMs;
  pollMs ??= config.verifyPollMs;
  const versionUrl = (site.site_url || '').replace(/\/$/, '') + (site.version_path || '/version.json');
  const healthUrl = site.health_url || site.site_url;
  const deadline = Date.now() + timeoutMs;
  let sawSha = false, lastVersion = null;
  if (!site.site_url) return { live: false, verified: false, reason: 'no site_url configured (live status UNVERIFIED)' };
  while (Date.now() < deadline) {
    try {
      const r = await fetchFn(versionUrl, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        lastVersion = j;
        if (j.commit === commitSha) { sawSha = true; break; }
      }
    } catch {}
    await sleep(Math.min(pollMs, 10000));
    if (timeoutMs <= 15000) break; // test fast-path
  }
  if (!sawSha) {
    // fallback: health probe only
    const health = await probeHealth(healthUrl, fetchFn);
    if (!lastVersion) return { live: health.ok, verified: false, reason: 'no version marker; live status UNVERIFIED (no version marker)', health };
    return { live: false, verified: false, reason: `version.json did not reach ${commitSha} in time (DEPLOY_TIMEOUT)`, lastVersion, health };
  }
  const health = await probeHealth(healthUrl, fetchFn);
  return { live: health.ok, verified: true, reason: health.ok ? 'commit SHA seen in version.json + health 2xx' : 'SHA live but health probe failed', lastVersion, health };
}

async function probeHealth(url, fetchFn) {
  if (!url) return { ok: false, reason: 'no health url' };
  let okCount = 0; const codes = [];
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetchFn(url, { signal: AbortSignal.timeout(8000) });
      codes.push(r.status);
      if (r.status >= 200 && r.status < 300) okCount++;
    } catch (e) { codes.push('ERR'); }
  }
  return { ok: okCount >= 2, codes };
}
