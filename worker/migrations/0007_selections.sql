-- Which photo each static link serves (Docs/plan.md, *Modelo de dados*).
-- target is a station id (EZC-AMD-00051) or a compact EVSE code
-- (PTEZCEAMD000511); the R2 keys in `pictures` are <target>.jpg,
-- <target>.thumb.jpg and <target>.full.jpg. The first approved photo of a
-- target becomes its main photo; the PRIMARY KEY makes that a race-free
-- INSERT OR IGNORE. published_at stays NULL until the three copies are in R2.
CREATE TABLE selections (
  target TEXT PRIMARY KEY,
  station_id TEXT NOT NULL REFERENCES stations (id),
  photo_id TEXT NOT NULL REFERENCES photos (id),
  chosen_by TEXT REFERENCES users (id),
  chosen_at TEXT NOT NULL,
  published_at TEXT
);
-- The station page reads every selection of one station.
CREATE INDEX selections_station ON selections (station_id);
