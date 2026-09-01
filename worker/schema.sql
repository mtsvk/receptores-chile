CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  event_type TEXT NOT NULL,

  receptor_id TEXT,
  query_text TEXT,
  corte TEXT,
  comuna TEXT,
  results_count INTEGER,
  contact_type TEXT,

  path TEXT,
  referrer TEXT,
  country TEXT,
  session_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_events_created_at
ON events(created_at);

CREATE INDEX IF NOT EXISTS idx_events_type
ON events(event_type);

CREATE INDEX IF NOT EXISTS idx_events_receptor
ON events(receptor_id);
