-- Photos sent through the upload page. The image lives in Panoramax (the
-- 2048 px master) and, until a moderator decides, in the private bucket
-- pictures-staging (1024 and 400 px). This row is the metadata and the
-- moderation state. The EXIF GPS and date are for moderators only: the API
-- never publishes them, and Panoramax gets the station's coordinates.
CREATE TABLE photos (
  id TEXT PRIMARY KEY,                -- random UUID, ours
  origin TEXT NOT NULL DEFAULT 'pictures'
    CHECK (origin IN ('pictures', 'osm_panoramax', 'commons', 'mapillary')),
  station_id TEXT NOT NULL REFERENCES stations (id),
  evse_compact TEXT,                  -- null: a photo of the station in general
  uploader_id TEXT REFERENCES users (id),
  panoramax_set TEXT,                 -- upload set: approval makes it public
  panoramax_id TEXT,                  -- the picture inside it
  taken_at TEXT,
  exif_lat REAL,
  exif_lon REAL,
  distance_m INTEGER,                 -- from the EXIF GPS to the station
  license TEXT NOT NULL DEFAULT 'CC-BY-SA-4.0',
  credit TEXT,                        -- OSM name or pseudonym when sent
  -- uploading: row written, files on their way; failed: they never all
  -- arrived (nothing is left in R2 or Panoramax). The rest is moderation.
  status TEXT NOT NULL
    CHECK (status IN ('uploading', 'failed', 'pending', 'published', 'hidden', 'removed')),
  approved_by TEXT REFERENCES users (id),
  approved_at TEXT,
  created_at TEXT NOT NULL
);
-- The daily upload limit counts by person and day.
CREATE INDEX photos_uploader_created ON photos (uploader_id, created_at);
CREATE INDEX photos_station ON photos (station_id, status);
-- The moderation queue, oldest first.
CREATE INDEX photos_status_created ON photos (status, created_at);
