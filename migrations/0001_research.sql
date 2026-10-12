CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  started_at TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  viewport TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  received_at TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (session_id, seq)
);
CREATE TABLE IF NOT EXISTS settings (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL
);
