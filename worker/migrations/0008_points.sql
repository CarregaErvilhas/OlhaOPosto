-- Gamification points (Docs/plan.md, *Gamificação*). One row per award.
-- A photo can earn several reasons (approved, first_photo, refresh).
CREATE TABLE points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users (id),
  photo_id TEXT REFERENCES photos (id),
  points INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('approved', 'first_photo', 'refresh')),
  month TEXT NOT NULL,   -- YYYY-MM (UTC) of the award
  created_at TEXT NOT NULL
);
CREATE INDEX points_user ON points (user_id, month);
CREATE INDEX points_photo ON points (photo_id);