CREATE TABLE IF NOT EXISTS votes (
  receptor_id TEXT NOT NULL,
  voter_key TEXT NOT NULL,
  vote INTEGER NOT NULL CHECK (vote IN (-1, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (receptor_id, voter_key)
);

CREATE TABLE IF NOT EXISTS vote_details (
  receptor_id TEXT NOT NULL,
  voter_key TEXT NOT NULL,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  comment TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'private' CHECK (moderation_status IN ('private', 'reviewed', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (receptor_id, voter_key),
  FOREIGN KEY (receptor_id, voter_key) REFERENCES votes(receptor_id, voter_key) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS vote_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  period TEXT NOT NULL CHECK (period IN ('hour', 'day')),
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_votes_receptor ON votes(receptor_id);
CREATE INDEX IF NOT EXISTS idx_vote_details_receptor ON vote_details(receptor_id);
