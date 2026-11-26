-- Stations under construction (Docs/postos-em-construcao.md): sites that
-- OpenStreetMap says are being built and the NAP does not list yet. They come
-- from the `planned` array of the NAP dashboard feed, with the OSM element as
-- id (OSM-w1551836005), and merge into the NAP station when it shows up.
--
-- `source` and `status` are CHECKs on a STRICT table, so changing their
-- values means rebuilding `stations`:
--   source  nap | osm                                  (community left with the proposals)
--   status  active | missing_from_nap | missing_from_osm | merged
--           (pending_review and rejected left with the proposals; no rows had them)
--   codes   the MOBI.E codes of a station under construction, space separated
--           (ALM-00114 ALM-00155), for the search and the merge. NULL for NAP rows.
--
-- evses, photos, selections, station_aliases and review_queue point at
-- stations (id): the foreign keys are checked at the end of the migration,
-- not while the old table is gone. rowid is kept: the search index uses it.
PRAGMA defer_foreign_keys = true;

-- A plain copy first: the rows go back with INSERT into the new `stations`,
-- which is what clears the deferred foreign key checks the DROP raised (a
-- RENAME of a new table would not, and the commit would fail).
CREATE TABLE stations_copy AS SELECT rowid AS old_rowid, id, code, opc, operator, name, address, municipality, region, lat, lon, source, status, osm_ref, updated_at FROM stations;
DROP TABLE stations;

CREATE TABLE stations (
  id           TEXT PRIMARY KEY,           -- NAP site id (EZC-AMD-00051) or OSM element (OSM-w123)
  code         TEXT,                       -- MOBI.E code: AMD-00051
  opc          TEXT,                       -- NAP operatorId: EZC3
  operator     TEXT,
  name         TEXT,
  address      TEXT,
  municipality TEXT,
  region       TEXT,                       -- CONT, AZO, MAD
  lat          REAL NOT NULL,
  lon          REAL NOT NULL,
  source       TEXT NOT NULL DEFAULT 'nap'
               CHECK (source IN ('nap', 'osm')),
  -- Stations are never deleted: links and photos must keep working.
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'missing_from_nap', 'missing_from_osm', 'merged')),
  osm_ref      TEXT,                       -- OSM element: node/123, way/123
  codes        TEXT,
  updated_at   TEXT NOT NULL
) STRICT;

INSERT INTO stations (rowid, id, code, opc, operator, name, address, municipality, region, lat, lon, source, status, osm_ref, updated_at, codes)
  SELECT old_rowid, id, code, opc, operator, name, address, municipality, region, lat, lon, source, status, osm_ref, updated_at, NULL FROM stations_copy;
DROP TABLE stations_copy;

CREATE INDEX stations_lat_lon ON stations (lat, lon);
-- The merge looks up stations under construction by their OSM element.
CREATE INDEX stations_osm_ref ON stations (osm_ref) WHERE source = 'osm';

-- The search index gains the codes, so ALM-00155 finds the station that only
-- has it in its OSM name. Same shape as 0003 otherwise.
DROP TABLE stations_fts;
CREATE VIRTUAL TABLE stations_fts USING fts5(
  id, code, name, address, municipality, operator, opc, codes,
  content = 'stations', content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);
INSERT INTO stations_fts (stations_fts) VALUES ('rebuild');

CREATE TRIGGER stations_fts_insert AFTER INSERT ON stations BEGIN
  INSERT INTO stations_fts (rowid, id, code, name, address, municipality, operator, opc, codes)
  VALUES (new.rowid, new.id, new.code, new.name, new.address, new.municipality, new.operator, new.opc, new.codes);
END;

CREATE TRIGGER stations_fts_delete AFTER DELETE ON stations BEGIN
  INSERT INTO stations_fts (stations_fts, rowid, id, code, name, address, municipality, operator, opc, codes)
  VALUES ('delete', old.rowid, old.id, old.code, old.name, old.address, old.municipality, old.operator, old.opc, old.codes);
END;

CREATE TRIGGER stations_fts_update AFTER UPDATE OF id, code, name, address, municipality, operator, opc, codes ON stations BEGIN
  INSERT INTO stations_fts (stations_fts, rowid, id, code, name, address, municipality, operator, opc, codes)
  VALUES ('delete', old.rowid, old.id, old.code, old.name, old.address, old.municipality, old.operator, old.opc, old.codes);
  INSERT INTO stations_fts (rowid, id, code, name, address, municipality, operator, opc, codes)
  VALUES (new.rowid, new.id, new.code, new.name, new.address, new.municipality, new.operator, new.opc, new.codes);
END;

-- photos.site_tag_old: the OlhaOPosto|site value still on Panoramax after a
-- merge moved the photo to the NAP station. The cron swaps the tag and clears
-- it, like author_tag_old for the credit.
ALTER TABLE photos ADD COLUMN site_tag_old TEXT;
CREATE INDEX photos_site_tag_old ON photos (created_at) WHERE site_tag_old IS NOT NULL;
