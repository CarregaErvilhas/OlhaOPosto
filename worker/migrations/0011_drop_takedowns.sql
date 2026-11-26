-- Removal requests now live in Panoramax's own reports (src/takedown.ts):
-- the table 0010 created is no longer read or written. It was empty in
-- production when this ran.
DROP INDEX IF EXISTS takedowns_photo;
DROP INDEX IF EXISTS takedowns_status_created;
DROP TABLE IF EXISTS takedowns;
