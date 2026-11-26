-- A main photo that leaves (a removal request, a moderator) keeps its
-- selection row, marked lost_at, instead of losing it: the row then tells
-- "this target lost its main photo" apart from "it never had one", and the
-- admin pages list the lost ones for a moderator to choose the next main
-- photo by hand (src/mains.ts). published_at goes back to NULL with it, so
-- nothing reads the row as a live link. The next main photo, chosen or
-- approved, takes the row over and clears lost_at.
ALTER TABLE selections ADD COLUMN lost_at TEXT;
-- The lost list reads only those rows.
CREATE INDEX selections_lost ON selections (lost_at) WHERE lost_at IS NOT NULL;
