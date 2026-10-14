// Simple in-memory sliding-window rate limiter.
const buckets = new Map(); // key -> [timestamps]
export function rateLimit({ key, max, windowMs }) {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter(t => now - t < windowMs);
  if (arr.length >= max) {
    const retryAfter = Math.ceil((arr[0] + windowMs - now) / 1000);
    return { ok: false, retryAfter };
  }
  arr.push(now);
  buckets.set(key, arr);
  return { ok: true };
}
export function _reset() { buckets.clear(); }
