-- The pseudonym (Docs/arquitetura.md, *Crédito*): the name a person chooses
-- to be credited with instead of their OSM name. users.pseudonym exists
-- since 0004; this adds what the account page needs to change it safely.
--
-- *_key: the name folded for comparison (no accents, no case, only letters
-- and digits, src/types.ts nameKey), so nobody takes a name that reads like
-- someone else's. osm_key is refreshed at each sign-in; rows from before
-- this migration get it the first time someone checks a pseudonym.
ALTER TABLE users ADD COLUMN pseudonym_key TEXT;
ALTER TABLE users ADD COLUMN osm_key TEXT;
-- One change a day: the time of the last one.
ALTER TABLE users ADD COLUMN pseudonym_changed_at TEXT;
CREATE UNIQUE INDEX users_pseudonym_key ON users (pseudonym_key) WHERE pseudonym_key IS NOT NULL;
CREATE INDEX users_osm_key ON users (osm_key);

-- A change of credit is done in small steps (src/credit.ts), retried by the
-- cron until nothing is left. These two columns are the "still to do" marks.
--
-- photos.author_tag_old: the OlhaOPosto|author value still on Panoramax,
-- to be swapped for photos.credit. NULL: Panoramax is up to date.
ALTER TABLE photos ADD COLUMN author_tag_old TEXT;
CREATE INDEX photos_author_tag_old ON photos (created_at) WHERE author_tag_old IS NOT NULL;
-- selections.credit_pending: the three copies in `pictures` still carry the
-- old credit in their XMP.
ALTER TABLE selections ADD COLUMN credit_pending INTEGER NOT NULL DEFAULT 0;
CREATE INDEX selections_credit_pending ON selections (chosen_at) WHERE credit_pending = 1;
