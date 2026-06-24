-- Atriveo — PostgreSQL schema

CREATE TABLE IF NOT EXISTS users (
  email         TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  company     TEXT NOT NULL,
  location    TEXT,
  url         TEXT,
  source      TEXT NOT NULL DEFAULT 'manual',
  score       NUMERIC NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'new',
  description TEXT,
  salary      TEXT,
  remote      BOOLEAN DEFAULT FALSE,
  posted_at   TIMESTAMPTZ,
  scraped_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tags        JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS contacts (
  id          TEXT PRIMARY KEY,
  user_email  TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  company     TEXT,
  email       TEXT NOT NULL,
  title       TEXT,
  confidence  NUMERIC,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS templates (
  id          TEXT PRIMARY KEY,
  user_email  TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tailor_queue (
  id           TEXT PRIMARY KEY,
  job_id       TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'queued',
  pdf_path     TEXT,
  enqueued_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error        TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_score    ON jobs(score DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status   ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_email);
CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_email);
CREATE INDEX IF NOT EXISTS idx_queue_status  ON tailor_queue(status);
