-- Full-text search over the public text of each station (code, name,
-- address, town, operator), for the search page and GET /api/v1/stations?q=.
-- A LIKE over the table would read every station on every search (D1 Free
-- counts rows read); FTS5 reads only the index entries that match.
--
-- External content: the text stays in `stations` and this table only holds
-- the index. remove_diacritics lets "acores" find "Açores".
CREATE VIRTUAL TABLE stations_fts USING fts5(
  id, code, name, address, municipality, operator, opc,
  content = 'stations', content_rowid = 'rowid',
  tokenize = 'unicode61 remove_diacritics 2'
);

INSERT INTO stations_fts (stations_fts) VALUES ('rebuild');

-- Kept in step by triggers, so the import needs no change. The update trigger
-- only fires for the indexed columns: status and updated_at changes (a station
-- leaving the NAP) do not rewrite the index.
CREATE TRIGGER stations_fts_insert AFTER INSERT ON stations BEGIN
  INSERT INTO stations_fts (rowid, id, code, name, address, municipality, operator, opc)
  VALUES (new.rowid, new.id, new.code, new.name, new.address, new.municipality, new.operator, new.opc);
END;

CREATE TRIGGER stations_fts_delete AFTER DELETE ON stations BEGIN
  INSERT INTO stations_fts (stations_fts, rowid, id, code, name, address, municipality, operator, opc)
  VALUES ('delete', old.rowid, old.id, old.code, old.name, old.address, old.municipality, old.operator, old.opc);
END;

CREATE TRIGGER stations_fts_update AFTER UPDATE OF id, code, name, address, municipality, operator, opc ON stations BEGIN
  INSERT INTO stations_fts (stations_fts, rowid, id, code, name, address, municipality, operator, opc)
  VALUES ('delete', old.rowid, old.id, old.code, old.name, old.address, old.municipality, old.operator, old.opc);
  INSERT INTO stations_fts (rowid, id, code, name, address, municipality, operator, opc)
  VALUES (new.rowid, new.id, new.code, new.name, new.address, new.municipality, new.operator, new.opc);
END;
