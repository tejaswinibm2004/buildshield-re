export const SECURITY_MARKERS = ['auth', 'login', 'session', 'token', 'password', 'crypto', 'payment', 'billing', 'checkout', 'secret', 'permission', 'money', 'price', 'cart', 'order', 'credential'];
export const DEFAULT_CRITICAL_GLOBS = ['**/auth/**', '**/payment/**', '**/checkout/**', '**/login/**', '**/.env*', '**/secrets/**'];

export function matchGlob(p, glob) {
  // tiny glob: **, *, ?
  const rx = '^' + String(glob).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*').replace(/\?/g, '[^/]') + '$';
  return new RegExp(rx, 'i').test(p);
}

const TYPE_WEIGHTS = { security: 25, logic: 8, data_validation: 8, config: 10, type_error: 6, null_reference: 6, async_error: 4, off_by_one: 4, broken_link_asset: 2, accessibility: 0, layout_css: 0, typo_copy: -5, performance: 4, other: 2 };

export function scoreRisk({ diffFiles, diffText, defectType = 'other', confidence = 1, settings = {} }) {
  const high = settings.highThreshold ?? 70;
  const globs = settings.criticalGlobs ?? DEFAULT_CRITICAL_GLOBS;
  let score = 25;
  const factors = [{ points: 25, reason: 'base risk' }];
  // path sensitivity
  let sensitive = 0;
  for (const f of diffFiles) {
    const lp = f.path.toLowerCase();
    const globHit = globs.some(g => matchGlob(f.path, g) || matchGlob(lp, g.toLowerCase()));
    const markerHit = SECURITY_MARKERS.some(m => lp.includes(m));
    const diffHit = SECURITY_MARKERS.some(m => String(f.after ?? '').toLowerCase().includes(m) || String(f.before ?? '').toLowerCase().includes(m));
    if (globHit || markerHit || diffHit) {
      sensitive++;
      const pts = sensitive === 1 ? 15 : 8;
      factors.push({ points: pts, reason: `sensitive path/content: ${f.path}` });
      score += pts;
    }
  }
  if (sensitive > 0) score = Math.min(score, 25 + 35 + (score - 25 - Math.min(15 + (sensitive - 1) * 8, 35))); // cap path part at +35
  const tw = TYPE_WEIGHTS[defectType] ?? 2;
  score += tw; factors.push({ points: tw, reason: `defect type ${defectType}` });
  const moneyRx = /(price|total|checkout|payment|money|billing|cart)/i;
  if (moneyRx.test(diffText ?? '')) {
    score += 20; factors.push({ points: 20, reason: 'money/checkout identifiers in diff' });
    if (!sensitive) { sensitive++; factors.push({ points: 0, reason: 'money identifiers => treated as security-sensitive (human required)' }); }
  }
  const lines = (diffText ?? '').split('\n').filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
  const sizePts = lines <= 3 ? 0 : lines <= 10 ? 4 : lines <= 25 ? 8 : 12;
  score += sizePts; factors.push({ points: sizePts, reason: `change size ${lines} added lines` });
  if (diffFiles.length > 1) { score += 4; factors.push({ points: 4, reason: `${diffFiles.length} files touched` }); }
  if (confidence < 0.7) { score += 6; factors.push({ points: 6, reason: `low analyzer confidence ${confidence}` }); }
  score = Math.max(5, Math.min(100, Math.round(score)));
  const level = score >= high ? 'CRITICAL' : score >= 40 ? 'MEDIUM' : 'LOW';
  const securitySensitive = sensitive > 0;
  return { score, level, factors, securitySensitive };
}

export function requiresApproval({ risk, settings = {}, safetyHit = false, criticVerdict = 'approve', validationClean = true }) {
  const reasons = [];
  if (risk.securitySensitive) reasons.push('security-sensitive path/content (no override)');
  if (risk.score >= (settings.highThreshold ?? 70)) reasons.push(`score ${risk.score} >= high threshold`);
  if (settings.alwaysRequireApproval) reasons.push('per-site always_require_approval');
  if (settings.autoDeploy === false) reasons.push('autoDeploy disabled by policy');
  if (safetyHit) reasons.push('safety gate hit');
  if (criticVerdict === 'concern') reasons.push('critic concern');
  if (!validationClean) reasons.push('validation not fully clean');
  return { required: reasons.length > 0, reasons };
}
