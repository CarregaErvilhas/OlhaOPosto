-- Photos that live somewhere else (Docs/arquitetura.md, *Fotos externas*): a
-- Panoramax picture or a Commons file that someone linked from OSM, which the
-- daily import reads from the NAP dashboard feed. Only a reference is kept:
-- the thumbnail the NAP dashboard publishes, the author, the licence and the
-- link to the source page. Origin is osm_panoramax or commons, never
-- olhaoposto; no copies in R2, no uploader, no moderation, no points, and
-- they are never a main photo (every query that picks or counts our own
-- photos filters on origin = 'olhaoposto').
ALTER TABLE photos ADD COLUMN external_ref TEXT;   -- Panoramax UUID or Commons file title
ALTER TABLE photos ADD COLUMN external_src TEXT;   -- thumbnail URL (nap.ocarroeletrico.com/photos/)
ALTER TABLE photos ADD COLUMN source_url TEXT;     -- the page of the photo at its origin
-- One row per source photo and station: the import upserts on this.
CREATE UNIQUE INDEX photos_external_ref ON photos (station_id, origin, external_ref)
  WHERE external_ref IS NOT NULL;
-- The station page and API read a station's external photos.
CREATE INDEX photos_external_station ON photos (station_id) WHERE origin <> 'olhaoposto';
