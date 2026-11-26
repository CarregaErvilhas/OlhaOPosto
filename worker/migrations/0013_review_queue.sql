-- The queue for what needs a person to decide that has no table of its own
-- (Docs/arquitetura.md, *Moderação*). Today: proposed stations. A proposal
-- is also a row in `stations` (source 'community', status 'pending_review',
-- never public), so photos can point at it while it waits; this row keeps
-- who proposed it, what they wrote and the decision. Photos keep their own
-- state in `photos.status`, and removal requests live in Panoramax.
CREATE TABLE review_queue (
  id TEXT PRIMARY KEY,                -- random UUID, ours
  kind TEXT NOT NULL CHECK (kind IN ('new_station')),
  station_id TEXT REFERENCES stations (id),
  payload TEXT NOT NULL,              -- JSON, what was proposed
  submitted_by TEXT REFERENCES users (id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_by TEXT REFERENCES users (id),
  decided_at TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX review_queue_status ON review_queue (status, created_at);
CREATE INDEX review_queue_submitted ON review_queue (submitted_by, created_at);
