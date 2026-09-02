CREATE TABLE IF NOT EXISTS private_feedback (
  receptor_id TEXT NOT NULL,
  voter_key TEXT NOT NULL,
  reasons_json TEXT NOT NULL DEFAULT '[]',
  comment TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'private' CHECK (moderation_status IN ('private', 'reviewed', 'approved', 'rejected')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (receptor_id, voter_key)
);

CREATE INDEX IF NOT EXISTS idx_private_feedback_receptor ON private_feedback(receptor_id);
