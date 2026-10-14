import 'dotenv/config';

function req(name, fallback = undefined) {
  const v = process.env[name] ?? fallback;
  return v;
}
function reqInt(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Env ${name} must be an integer, got: ${v}`);
  return n;
}
function reqBool(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

export const config = {
  port: reqInt('PORT', 3000),
  nodeEnv: req('NODE_ENV', 'development'),
  get isProd() { return this.nodeEnv === 'production'; },
  dataDir: req('BUGSHIELD_DATA_DIR', './.var/data'),
  publicBaseUrl: req('PUBLIC_BASE_URL', ''),
  bootstrapOwnerEmail: req('BOOTSTRAP_OWNER_EMAIL', 'owner@bugshield.local'),
  bootstrapOwnerPassword: req('BOOTSTRAP_OWNER_PASSWORD', ''),
  aiProvider: req('AI_PROVIDER', 'openai-compatible'),
  aiBaseUrl: req('AI_BASE_URL', ''),
  aiModel: req('AI_MODEL', ''),
  aiApiKey: req('AI_API_KEY', ''),
  githubToken: req('GITHUB_TOKEN', ''),
  renderApiKey: req('RENDER_API_KEY', ''),
  renderServiceId: req('RENDER_SERVICE_ID', ''),
  appSecret: req('APP_SECRET_KEY', 'dev-secret-change-me-32bytes-minimum!!'),
  queueConcurrency: reqInt('QUEUE_CONCURRENCY', 2),
  riskHigh: reqInt('RISK_HIGH_THRESHOLD', 70),
  riskMedium: reqInt('RISK_MEDIUM_THRESHOLD', 40),
  // policy defaults (overridable in settings table)
  autoDeployDefault: !['0', 'false', 'no', 'off'].includes(String(req('AUTODEPLOY', 'true')).toLowerCase()),
  maxFiles: reqInt('PATCH_MAX_FILES', 3),
  maxEditsPerFile: reqInt('PATCH_MAX_EDITS_PER_FILE', 5),
  maxLines: reqInt('PATCH_MAX_LINES', 40),
  verifyTimeoutMs: reqInt('VERIFY_TIMEOUT_MS', 10 * 60 * 1000),
  verifyPollMs: reqInt('VERIFY_POLL_MS', 10 * 1000),
};

export function configSummaryMasked() {
  return {
    port: config.port,
    nodeEnv: config.nodeEnv,
    dataDir: config.dataDir,
    publicBaseUrl: config.publicBaseUrl ? '(set)' : '(empty)',
    aiBaseUrl: config.aiBaseUrl ? '(set)' : '(empty)',
    aiModel: config.aiModel || '(empty)',
    aiApiKey: config.aiApiKey ? '(set, masked)' : '(missing — AI_UNAVAILABLE)',
    githubToken: config.githubToken ? '(set, masked)' : '(missing)',
    renderApiKey: config.renderApiKey ? '(set, masked)' : '(missing)',
    autoDeployDefault: config.autoDeployDefault,
    riskHigh: config.riskHigh,
  };
}

export function validateConfigOrThrow() {
  if (!config.dataDir) throw new Error('BUGSHIELD_DATA_DIR is required');
  if (config.appSecret.length < 16) throw new Error('APP_SECRET_KEY must be >= 16 chars');
}
