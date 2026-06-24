-- Atriveo — base schema (D1 / SQLite compatible)

CREATE TABLE IF NOT EXISTS users (
  email         TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  company     TEXT NOT NULL,
  location    TEXT,
  url         TEXT,
  source      TEXT NOT NULL DEFAULT 'manual',
  score       REAL NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'new',
  description TEXT,
  salary      TEXT,
  remote      INTEGER DEFAULT 0,
  posted_at   TEXT,
  scraped_at  TEXT NOT NULL,
  tags        TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS contacts (
  id          TEXT PRIMARY KEY,
  user_email  TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  company     TEXT,
  email       TEXT NOT NULL,
  title       TEXT,
  confidence  REAL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id          TEXT PRIMARY KEY,
  user_email  TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tailor_queue (
  id           TEXT PRIMARY KEY,
  job_id       TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'queued',
  pdf_path     TEXT,
  enqueued_at  TEXT NOT NULL,
  completed_at TEXT,
  error        TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_score    ON jobs(score DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status   ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_source   ON jobs(source);
CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_email);
CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_email);
CREATE INDEX IF NOT EXISTS idx_queue_status  ON tailor_queue(status);
