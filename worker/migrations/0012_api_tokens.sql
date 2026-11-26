-- Personal access tokens for scripts and agents (Docs/arquitetura.md, *Tokens
-- de API*). Only the SHA-256 of the token, like the sessions: a copy of this
-- table opens nothing. The prefix is the start of the token, shown on the
-- account page so a person can tell their tokens apart. A revoked token keeps
-- its row (revoked_at) until it would have expired.
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,                -- random UUID, ours
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  prefix TEXT NOT NULL,
  name TEXT NOT NULL,
  scopes TEXT NOT NULL,               -- space separated: photos:write selections:write
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX api_tokens_user ON api_tokens (user_id, created_at);
