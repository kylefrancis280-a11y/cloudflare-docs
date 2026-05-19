-- Atlas D1 Database Schema (0001_init.sql)
-- Replaces all previous Firebase Realtime DB tables
-- All timestamps are ISO-8601 UTC strings
PRAGMA foreign_keys = ON;

-- Users
CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  password_hash       TEXT NOT NULL,
  password_salt       TEXT NOT NULL,
  password_iters      INTEGER NOT NULL DEFAULT 210000,
  role                TEXT NOT NULL DEFAULT 'subscriber' CHECK (role IN ('admin', 'analyst', 'subscriber')),
  tier                TEXT NOT NULL DEFAULT 'core' CHECK (tier IN ('core', 'pro', 'institutional', 'none')),
  subscription_status TEXT NOT NULL DEFAULT 'pending' CHECK (subscription_status IN ('pending', 'active', 'past_due', 'cancelled', 'inactive')),
  stripe_customer_id  TEXT,
  email_verified_at   TEXT,
  reset_token_hash    TEXT,
  reset_token_expires TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email  ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_stripe ON users(stripe_customer_id);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  user_agent   TEXT,
  ip           TEXT,
  expires_at   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- Stock Universe
CREATE TABLE IF NOT EXISTS universe (
  ticker      TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  exchange    TEXT NOT NULL,
  industry    TEXT,
  sector      TEXT NOT NULL,
  pe          REAL,
  market_cap  REAL,
  active      INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_universe_sector ON universe(sector, active);

-- Portfolios (new table for the Portfolio Manager)
CREATE TABLE IF NOT EXISTS portfolios (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  holdings              TEXT NOT NULL,           -- JSON string
  atlas_score           INTEGER,
  diversification_score INTEGER,
  stability_score       INTEGER,
  grade                 TEXT,
  suggestions           TEXT,                     -- JSON string
  total_value           REAL DEFAULT 0,
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_portfolios_user ON portfolios(user_id, updated_at DESC);

-- Daily AI Analysis
CREATE TABLE IF NOT EXISTS analysis (
  date         TEXT NOT NULL,
  ticker       TEXT NOT NULL,
  sector       TEXT NOT NULL,
  strength     INTEGER NOT NULL,
  sentiment    TEXT NOT NULL,
  summary      TEXT,
  bulls_json   TEXT,
  bears_json   TEXT,
  insight      TEXT,
  description  TEXT,
  model        TEXT NOT NULL,
  input_hash   TEXT NOT NULL,
  source_data  TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (date, ticker)
);

CREATE INDEX IF NOT EXISTS idx_analysis_input_hash ON analysis(input_hash);
CREATE INDEX IF NOT EXISTS idx_analysis_date_strength ON analysis(date, strength DESC);

-- Daily Rankings per Sector
CREATE TABLE IF NOT EXISTS rankings (
  date         TEXT NOT NULL,
  sector       TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  scanned      INTEGER NOT NULL,
  analyzed     INTEGER NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (date, sector)
);

-- Backtest Returns
CREATE TABLE IF NOT EXISTS backtest_returns (
  date        TEXT NOT NULL,
  ticker      TEXT NOT NULL,
  ret_1d      REAL,
  ret_5d      REAL,
  ret_30d     REAL,
  hit_target  INTEGER,
  computed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (date, ticker)
);

CREATE INDEX IF NOT EXISTS idx_backtest_date ON backtest_returns(date);

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT,
  action      TEXT NOT NULL,
  details     TEXT,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at);

-- Rate Limiting
CREATE TABLE IF NOT EXISTS rate_limit (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL,
  window_start TEXT NOT NULL,
  expires_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_expires ON rate_limit(expires_at);

-- Signup Notifications
CREATE TABLE IF NOT EXISTS signup_notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  email      TEXT NOT NULL,
  name       TEXT NOT NULL,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
