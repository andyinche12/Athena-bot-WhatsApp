import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';
import { config } from '../config/env.js';

// Asegurar que existe ./data/
mkdirSync(dirname(config.memoryDbPath), { recursive: true });

export const db = new Database(config.memoryDbPath);

// Optimizaciones para SQLite local
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ---------- Esquema ----------
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id     TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content     TEXT NOT NULL,
    provider    TEXT,
    model       TEXT,
    timestamp   INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_messages_chat_time
    ON messages (chat_id, timestamp DESC);

  CREATE TABLE IF NOT EXISTS facts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id     TEXT NOT NULL,
    fact        TEXT NOT NULL,
    category    TEXT DEFAULT 'general',
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_facts_chat
    ON facts (chat_id);

  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id     TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT,
    course      TEXT,
    due_date    TEXT,
    status      TEXT NOT NULL DEFAULT 'pending',
    created_at  INTEGER NOT NULL,
    completed_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_chat_status
    ON tasks (chat_id, status);

  CREATE TABLE IF NOT EXISTS reminders (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id     TEXT NOT NULL,
    text        TEXT NOT NULL,
    remind_at   TEXT NOT NULL,
    sent        INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_reminders_pending
    ON reminders (sent, remind_at);
`);

console.log('🗄️  SQLite listo:', config.memoryDbPath);