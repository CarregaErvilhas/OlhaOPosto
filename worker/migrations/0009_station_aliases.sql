-- Station aliases: NAP re-keys (Docs/plan.md, *Mudanças de código (re-key)*).
-- A station that left the NAP (status = 'missing_from_nap') can be mapped to
-- its replacement; the old id then responds 301 to the new station page.
CREATE TABLE station_aliases (
  old_id TEXT PRIMARY KEY REFERENCES stations (id),
  new_id TEXT NOT NULL REFERENCES stations (id),
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL
);
CREATE INDEX station_aliases_new ON station_aliases (new_id);
