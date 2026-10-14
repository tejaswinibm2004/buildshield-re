// CSRF: mutations need X-Requested-With: bugshield + Origin/Host match.
// Ingestion POST /api/v1/issues and GET /api/health are exempt.
export function csrfMiddleware(req, res, next) {
  const p = req.path;
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (p === '/api/v1/issues') return next();
  if (p === '/auth/login') return next(); // login uses rate limit instead; no session yet
  const xr = req.get('X-Requested-With');
  if (xr !== 'bugshield') return res.status(403).json({ success: false, error: { code: 'CSRF', message: 'Missing X-Requested-With header' } });
  const origin = req.get('Origin');
  const host = req.get('Host');
  if (origin) {
    try {
      const u = new URL(origin);
      if (u.host !== host) return res.status(403).json({ success: false, error: { code: 'CSRF', message: 'Origin mismatch' } });
    } catch { return res.status(403).json({ success: false, error: { code: 'CSRF', message: 'Bad Origin' } }); }
  }
  next();
}
