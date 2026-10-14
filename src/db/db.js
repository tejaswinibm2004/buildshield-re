import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

// Dual backend: Supabase/Postgres when DATABASE_URL is set, else local SQLite.
// All helpers are async so call sites work identically on both backends.
// SQL uses `?` placeholders everywhere; they are rewritten to $1,$2.. for pg.

export function backend() { return config.databaseUrl ? 'pg' : 'sqlite'; }

let sqliteDb = null;
let pool = null;

function sqlite() {
  if (!sqliteDb) {
    fs.mkdirSync(config.dataDir, { recursive: true });
    sqliteDb = new DatabaseSync(path.join(config.dataDir, 'bugshield.db'));
    sqliteDb.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  }
  return sqliteDb;
}

async function pgPool() {
  if (!pool) {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      ssl: /supabase\.co|sslmode=require/i.test(config.databaseUrl) ? { rejectUnauthorized: false } : undefined,
    });
    pool.on('error', (e) => console.error('pg pool error:', e.message));
  }
  return pool;
}

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => '$' + (++i));
}

export async function run(sql, ...params) {
  if (backend() === 'pg') {
    const p = await pgPool();
    const r = await p.query(toPg(sql), params);
    return { changes: r.rowCount ?? 0 };
  }
  const r = sqlite().prepare(sql).run(...params);
  return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
}

// INSERT that returns the new row id on both backends.
export async function insertGetId(sql, ...params) {
  if (backend() === 'pg') {
    const p = await pgPool();
    const q = /returning\s+/i.test(sql) ? sql : sql + ' RETURNING id';
    const r = await p.query(toPg(q), params);
    return r.rows[0]?.id;
  }
  return Number(sqlite().prepare(sql).run(...params).lastInsertRowid);
}

export async function get(sql, ...params) {
  if (backend() === 'pg') {
    const p = await pgPool();
    const r = await p.query(toPg(sql), params);
    return r.rows[0] ?? undefined;
  }
  return sqlite().prepare(sql).get(...params);
}

export async function all(sql, ...params) {
  if (backend() === 'pg') {
    const p = await pgPool();
    const r = await p.query(toPg(sql), params);
    return r.rows;
  }
  return sqlite().prepare(sql).all(...params);
}

export async function exec(sql) {
  if (backend() === 'pg') {
    const p = await pgPool();
    for (const st of sql.split(/;\s*(?:\n|$)/).map(s => s.trim()).filter(Boolean)) await p.query(st);
    return;
  }
  sqlite().exec(sql);
}

export async function ping() {
  await get('SELECT 1 AS one');
}

export async function closeDb() {
  if (pool) { try { await pool.end(); } catch {} pool = null; }
  if (sqliteDb) { try { sqliteDb.close(); } catch {} sqliteDb = null; }
}

export function nowIso() { return new Date().toISOString(); }
