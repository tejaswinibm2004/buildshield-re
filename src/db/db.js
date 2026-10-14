import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

let db = null;
export function getDb() {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const file = path.join(config.dataDir, 'bugshield.db');
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  return db;
}

export function closeDb() {
  if (db) { try { db.close(); } catch {} db = null; }
}

export function nowIso() { return new Date().toISOString(); }
