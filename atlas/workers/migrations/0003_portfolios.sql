-- Migration 0003: Portfolios storage for Atlas Analysis
-- User portfolios + grades + holdings (JSON for simplicity)

CREATE TABLE IF NOT EXISTS portfolios (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  holdings TEXT NOT NULL,  -- JSON string of array of {ticker, shares, costBasis}
  grade INTEGER,
  diversification_score INTEGER,
  total_value REAL,
  suggestions TEXT,         -- JSON string of suggestions array
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Index for fast user lookups
CREATE INDEX IF NOT EXISTS idx_portfolios_user ON portfolios(user_id);

-- Optional: separate holdings table for normalized data (future-proof)
-- CREATE TABLE IF NOT EXISTS portfolio_holdings (
--   portfolio_id TEXT REFERENCES portfolios(id),
--   ticker TEXT,
--   shares REAL,
--   cost_basis REAL,
--   PRIMARY KEY (portfolio_id, ticker)
-- );
