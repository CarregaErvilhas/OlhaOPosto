-- Stations and charge points, imported from the NAP dashboard network model
-- (scripts/import-stations.ts). See Docs/plan.md, "Modelo de dados".

CREATE TABLE stations (
  id           TEXT PRIMARY KEY,           -- NAP site id: EZC-AMD-00051
  code         TEXT,                       -- MOBI.E code: AMD-00051
  opc          TEXT,                       -- NAP operatorId: EZC3
  operator     TEXT,                       -- operator's legal name
  name         TEXT,
  address      TEXT,
  municipality TEXT,
  region       TEXT,                       -- CONT, AZO, MAD
  lat          REAL NOT NULL,
  lon          REAL NOT NULL,
  source       TEXT NOT NULL DEFAULT 'nap'
               CHECK (source IN ('nap', 'community')),
  -- Stations are never deleted: static links and photos must keep working.
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'missing_from_nap', 'pending_review', 'rejected')),
  osm_ref      TEXT,                       -- linked OSM element: node/123
  updated_at   TEXT NOT NULL
) STRICT;

-- One charge point (socket) per row, keyed by the point id within its
-- station: MOBI.Data point ids repeat across stations. The NAP EVSE code
-- (evse_id, with the `*`) stays empty until the NAP dashboard feed carries it;
-- without it there is no static link for the socket. Its UNIQUE indexes come
-- with that migration: an index on an all-NULL column only adds a write per
-- row, and D1 Free caps rows written per day.
CREATE TABLE evses (
  station_id   TEXT NOT NULL REFERENCES stations (id),
  point_id     TEXT NOT NULL,              -- AMD-00051-1
  evse_id      TEXT,                       -- PT*EDP*E*LSB*90050*01
  evse_compact TEXT,                       -- PTEDPELSB9005001
  connector    TEXT,                       -- T2, CCS, CHADEMO...
  max_kw       REAL,
  dc           INTEGER NOT NULL CHECK (dc IN (0, 1)),
  status       TEXT NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'missing_from_nap')),
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (station_id, point_id)
) STRICT, WITHOUT ROWID;

-- generatedAt of the last imported feed, so an unchanged feed is skipped.
CREATE TABLE import_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
