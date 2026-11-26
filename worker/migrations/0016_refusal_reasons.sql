-- Why a photo did not go public (Docs/arquitetura.md, *Moderação*): a code
-- from a fixed list, an optional short note from the moderator, and who
-- refused it. Set when a moderator rejects a photo, when a rejected proposed
-- station takes its waiting photos with it, and when a removal request
-- deletes a photo (no refused_by then: the report lives in Panoramax).
-- The author sees the reason on "os meus envios"; moderators see the
-- decision history.
ALTER TABLE photos ADD COLUMN refusal_reason TEXT
  CHECK (refusal_reason IN ('wrong_station', 'privacy', 'quality', 'duplicate', 'advertising', 'other'));
ALTER TABLE photos ADD COLUMN refusal_note TEXT;
ALTER TABLE photos ADD COLUMN refused_by TEXT REFERENCES users (id);
-- The decisions history reads recent decisions by time.
CREATE INDEX photos_approved_at ON photos (approved_at);
