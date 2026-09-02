ALTER TABLE private_feedback
  ADD COLUMN publication_status TEXT NOT NULL DEFAULT 'not_requested'
  CHECK (publication_status IN ('not_requested', 'pending', 'approved', 'rejected'));

ALTER TABLE private_feedback
  ADD COLUMN publication_consent_at TEXT;

ALTER TABLE private_feedback
  ADD COLUMN published_at TEXT;

CREATE INDEX IF NOT EXISTS idx_private_feedback_publication
  ON private_feedback(receptor_id, publication_status);
