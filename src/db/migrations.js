import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function runMigrations() {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);`);
  const rows = db.prepare('SELECT version FROM _migrations ORDER BY version').all();
  const applied = new Set(rows.map(r => r.version));
  if (!applied.has(1)) {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    db.exec(schema);
    db.prepare('INSERT INTO _migrations (version, applied_at) VALUES (1, ?)').run(new Date().toISOString());
  }
  // future additive migrations go here as version 2,3,...
}
