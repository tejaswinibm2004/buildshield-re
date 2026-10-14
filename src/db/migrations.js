import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { backend, exec, all, run, ping } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations() {
  await ping(); // fail fast with a clear error if the DB is unreachable
  await exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);');
  const rows = await all('SELECT version FROM _migrations ORDER BY version');
  const applied = new Set(rows.map(r => Number(r.version)));
  if (!applied.has(1)) {
    const file = backend() === 'pg' ? 'schema.pg.sql' : 'schema.sql';
    const schema = fs.readFileSync(path.join(__dirname, file), 'utf8');
    await exec(schema);
    await run('INSERT INTO _migrations (version, applied_at) VALUES (1, ?)', new Date().toISOString());
  }
  // future additive migrations go here as version 2,3,...
}
