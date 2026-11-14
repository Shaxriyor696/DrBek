// SQLite storage (node:sqlite, built into Node >= 22.13). One file, WAL mode.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATIONS = [
  // 1 — core schema
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    roles TEXT NOT NULL DEFAULT '["student"]',
    email_verified_at TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    university TEXT,
    course INTEGER,
    direction TEXT,
    study_lang TEXT NOT NULL DEFAULT 'uz',
    daily_goal_min INTEGER NOT NULL DEFAULT 30,
    timezone TEXT NOT NULL DEFAULT 'Asia/Tashkent',
    reader_font INTEGER NOT NULL DEFAULT 18,
    reader_line REAL NOT NULL DEFAULT 1.7,
    onboarded_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE auth_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('verify','reset')),
    expires_at TEXT NOT NULL,
    used_at TEXT
  );
  CREATE TABLE rate_limits (
    key TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    count INTEGER NOT NULL
  );
  CREATE TABLE lesson_progress (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id TEXT NOT NULL,
    completed_at TEXT,
    read_version TEXT,
    last_block TEXT,
    last_tab TEXT,
    review_flag INTEGER NOT NULL DEFAULT 0,
    first_opened_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, lesson_id)
  );
  CREATE TABLE activity_intervals (
    event_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id TEXT,
    session_id TEXT,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX idx_activity_user ON activity_intervals(user_id, start_ms);
  CREATE TABLE telemetry (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    type TEXT NOT NULL,
    target TEXT,
    at TEXT NOT NULL
  );
  CREATE TABLE collections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE bookmarks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('topic','lesson','book','figure','selection','ai_answer')),
    target_id TEXT NOT NULL,
    title TEXT,
    snippet TEXT,
    meta TEXT,
    collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
    deleted_at TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (user_id, target_type, target_id)
  );
  CREATE TABLE notes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id TEXT,
    topic_id TEXT,
    anchor_block TEXT,
    selection_text TEXT,
    figure_id TEXT,
    chat_message_id TEXT,
    content_version TEXT,
    body TEXT NOT NULL DEFAULT '',
    collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_notes_user ON notes(user_id, updated_at);
  CREATE TABLE questions (
    id TEXT NOT NULL,
    version INTEGER NOT NULL,
    topic_id TEXT NOT NULL,
    lesson_id TEXT,
    stem TEXT NOT NULL,
    options TEXT NOT NULL,
    answer_option_id TEXT NOT NULL,
    explanation TEXT NOT NULL,
    difficulty TEXT,
    source_ref TEXT NOT NULL,
    status TEXT NOT NULL,
    origin TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    PRIMARY KEY (id, version)
  );
  CREATE TABLE quiz_attempts (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('lesson','topic','mistakes')),
    scope_id TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('practice','exam')),
    status TEXT NOT NULL CHECK (status IN ('in_progress','submitted')),
    snapshot TEXT NOT NULL,
    parent_attempt_id TEXT,
    client_key TEXT,
    correct INTEGER,
    total INTEGER,
    unanswered INTEGER,
    started_at TEXT NOT NULL,
    submitted_at TEXT,
    UNIQUE (user_id, client_key)
  );
  CREATE TABLE quiz_answers (
    attempt_id TEXT NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL,
    option_id TEXT,
    flagged INTEGER NOT NULL DEFAULT 0,
    checked_at TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (attempt_id, question_id)
  );
  CREATE TABLE chat_threads (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic_id TEXT,
    lesson_id TEXT,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content TEXT NOT NULL,
    context TEXT,
    citations TEXT,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE content_state (
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    status TEXT NOT NULL,
    content_version TEXT,
    updated_by TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (target_type, target_id)
  );
  CREATE TABLE content_reviews (
    id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    content_version TEXT,
    decision TEXT NOT NULL,
    reason TEXT,
    reviewer_id TEXT NOT NULL,
    at TEXT NOT NULL
  );
  CREATE TABLE audit_events (
    id TEXT PRIMARY KEY,
    actor_id TEXT,
    action TEXT NOT NULL,
    target TEXT,
    detail TEXT,
    at TEXT NOT NULL
  );
  CREATE TABLE import_jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    source_checksum TEXT,
    detail TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
  );
  CREATE VIRTUAL TABLE search_chunks USING fts5(
    chunk_id UNINDEXED, kind UNINDEXED, topic_id UNINDEXED, lesson_id UNINDEXED,
    block_id UNINDEXED, lang UNINDEXED, locator UNINDEXED, raw UNINDEXED, title, body,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
  `,
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (v INTEGER NOT NULL)');
  const row = db.prepare('SELECT v FROM schema_version').get();
  let v = row ? row.v : 0;
  if (!row) db.prepare('INSERT INTO schema_version (v) VALUES (0)').run();
  for (; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.prepare('UPDATE schema_version SET v = ?').run(v + 1);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
