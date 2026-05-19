-- 0003_portfolios.sql
-- Migration: Portfolios storage for Atlas Analysis
-- Stores user holdings + Atlas Score results (JSON for simplicity)

CREATE TABLE IF NOT EXISTS portfolios (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  holdings              TEXT NOT NULL,           -- JSON array of {ticker, shares, avgCost}
  
  atlas_score           INTEGER,                 -- Overall Atlas Score (0-100)
  diversification_score INTEGER,                 -- Diversification component
  stability_score       INTEGER,                 -- ETF / low-vol stability component
  
  grade                 TEXT,                    -- 'A', 'A-', 'B+', 'B', etc.
  total_value           REAL DEFAULT 0,          -- Estimated current value in user's currency
  suggestions           TEXT,                    -- JSON array of strings
  
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Fast lookup by user (most common query)
CREATE INDEX IF NOT EXISTS idx_portfolios_user 
  ON portfolios(user_id, updated_at DESC);
