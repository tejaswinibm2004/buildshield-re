-- BugShield schema (additive migrations track applied versions in _migrations)
CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'viewer',
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS websites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  repo_url TEXT DEFAULT '',
  repo_owner TEXT DEFAULT '',
  repo_name TEXT DEFAULT '',
  branch TEXT NOT NULL DEFAULT 'main',
  root_path TEXT DEFAULT '',
  site_url TEXT DEFAULT '',
  health_url TEXT DEFAULT '',
  version_path TEXT NOT NULL DEFAULT '/version.json',
  always_require_approval INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS ingestion_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  website_id INTEGER NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'default',
  key_hash TEXT UNIQUE NOT NULL,
  allowed_origins TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  last_used_at TEXT
);
CREATE TABLE IF NOT EXISTS issues (
  id TEXT PRIMARY KEY,
  website_id INTEGER REFERENCES websites(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  steps TEXT DEFAULT '',
  page_url TEXT DEFAULT '',
  release TEXT DEFAULT '',
  context TEXT DEFAULT '{}',
  element TEXT DEFAULT '{}',
  errors TEXT DEFAULT '[]',
  console TEXT DEFAULT '[]',
  network TEXT DEFAULT '[]',
  fingerprint TEXT NOT NULL DEFAULT '',
  occurrences INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  status_reason TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS issue_cases (
  issue_id TEXT PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
  case_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pipeline_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  summary TEXT DEFAULT '',
  evidence TEXT DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_steps_issue ON pipeline_steps(issue_id);
CREATE TABLE IF NOT EXISTS patches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  summary TEXT DEFAULT '',
  files TEXT NOT NULL DEFAULT '[]',
  diff_text TEXT DEFAULT '',
  risk_score INTEGER DEFAULT 0,
  risk_factors TEXT DEFAULT '[]',
  critic TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS validation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  patch_id INTEGER REFERENCES patches(id) ON DELETE CASCADE,
  validator_id TEXT NOT NULL,
  status TEXT NOT NULL,
  details TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  patch_id INTEGER REFERENCES patches(id) ON DELETE SET NULL,
  decision TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  comment TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS deployments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id TEXT NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  patch_id INTEGER REFERENCES patches(id) ON DELETE SET NULL,
  commit_sha TEXT DEFAULT '',
  commit_url TEXT DEFAULT '',
  branch TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  live_verified_at TEXT,
  health_result TEXT DEFAULT '{}',
  reverted_by_sha TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target TEXT DEFAULT '',
  detail TEXT DEFAULT '{}',
  ip_hash TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  run_at TEXT NOT NULL,
  last_error TEXT DEFAULT ''
);
