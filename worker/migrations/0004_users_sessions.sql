-- Accounts come only from OpenStreetMap (OAuth2, read_prefs): the OSM user id
-- and display name, nothing else. No email, and the OSM token is never kept.
-- Every new account is a contributor; promotion is by hand (Docs/plan.md).
CREATE TABLE users (
  id TEXT PRIMARY KEY,                -- random UUID, ours
  osm_uid INTEGER NOT NULL UNIQUE,
  osm_name TEXT NOT NULL,             -- refreshed on every login: OSM names can change
  pseudonym TEXT,
  role TEXT NOT NULL DEFAULT 'contributor'
    CHECK (role IN ('contributor', 'trusted', 'moderator', 'admin')),
  ranking_opt_out INTEGER NOT NULL DEFAULT 0,
  promoted_by TEXT REFERENCES users (id),
  promoted_at TEXT,
  license_accepted_at TEXT,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);

-- Only the SHA-256 of the session token: a copy of this table opens no
-- sessions. Expired rows are removed at the next login.
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX sessions_expires_at ON sessions (expires_at);
