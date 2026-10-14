// Central secret redactor. Never log tokens/keys.
const PATTERNS = [
  /bsk_[A-Za-z0-9]+/g,
  /ghp_[A-Za-z0-9_]+/g,
  /github_pat_[A-Za-z0-9_]+/g,
  /sk-[A-Za-z0-9\-_]+/g,
  /Bearer\s+[A-Za-z0-9\-_.~+/=]+/gi,
  /("?(?:api[_-]?key|token|password|secret)"?\s*[:=]\s*"?)[^",\s}]+/gi,
];

export function redact(s) {
  if (s === undefined || s === null) return s;
  let out = String(s);
  for (const p of PATTERNS) {
    out = out.replace(p, (m) => {
      // keep key name for api_key= style
      const kv = m.match(/^(.*[:=]\s*"?).+$/s);
      if (m.includes('=') || m.includes(':')) {
        const prefix = m.replace(/^(.*[:=]\s*"?).+$/s, '$1');
        if (prefix !== m) return prefix + '[REDACTED]';
      }
      return '[REDACTED]';
    });
  }
  return out;
}

export function redactJson(obj) {
  try {
    return JSON.parse(redact(JSON.stringify(obj)));
  } catch { return { redacted: true }; }
}

export function sha256Hex(s) {
  const { createHash } = processSync();
  return createHash('sha256').update(String(s)).digest('hex');
}
import { createHash as _ch } from 'node:crypto';
function processSync() { return { createHash: _ch }; }

export function hashIp(ip) {
  if (!ip) return '';
  return _ch('sha256').update('ip:' + ip).digest('hex').slice(0, 16);
}
