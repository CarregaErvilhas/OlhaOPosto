-- Removal requests (Docs/plan.md, *RGPD e moderação*): the public form at
-- /takedown, no sign-in. The photo is hidden as soon as the request arrives;
-- a moderator then removes it for good or restores it.
CREATE TABLE takedowns (
  id TEXT PRIMARY KEY,                -- random UUID
  -- What the person typed (a code, a link). Kept as typed, for the moderator.
  asked TEXT NOT NULL,
  -- The photo it resolved to; null when nothing published matched, so the
  -- moderator can still read the request and close it.
  photo_id TEXT REFERENCES photos (id),
  reason TEXT NOT NULL CHECK (reason IN ('face', 'plate', 'property', 'other')),
  details TEXT,
  -- Optional, only to answer. Cleared when the request is decided.
  contact TEXT,
  status TEXT NOT NULL CHECK (status IN ('open', 'removed', 'restored', 'closed')),
  -- Static link targets cleared when the photo was hidden (JSON array).
  cleared TEXT,
  -- Hiding steps that failed (JSON array of 'pictures', 'panoramax',
  -- 'purge'): shown to moderators, with a retry.
  hide_failed TEXT,
  created_at TEXT NOT NULL,
  decided_by TEXT REFERENCES users (id),
  decided_at TEXT
);
-- The admin panel: open requests, oldest first.
CREATE INDEX takedowns_status_created ON takedowns (status, created_at);
-- One decision closes every open request for the same photo.
CREATE INDEX takedowns_photo ON takedowns (photo_id, status);
