-- Nearby search for GET /api/v1/stations?lat=&lon=: a bounding box in SQL,
-- exact distance in the Worker. The index walks the latitude band and checks
-- longitude without touching the table, so a 500 m search reads tens of rows,
-- not all of them. Building it writes one row per station.
CREATE INDEX stations_lat_lon ON stations (lat, lon);
