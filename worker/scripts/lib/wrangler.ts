// Runs wrangler against the local or the remote D1.
//
// The repo never holds the D1 database id (wrangler.json has the placeholder
// "local-only", which only works for --local). For remote commands we look the
// id up by name with the caller's credentials (`wrangler login`, or
// CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in CI), write a throwaway copy
// of the config next to wrangler.json, and delete it afterwards.

import { execFileSync, type ExecFileSyncOptions } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(WORKER_DIR, 'node_modules', '.bin', 'wrangler');
const CONFIG = join(WORKER_DIR, 'wrangler.json');
// Ignored by git (.gitignore). Same folder as wrangler.json so `main` and
// `migrations_dir` resolve the same way.
const REMOTE_CONFIG = join(WORKER_DIR, '.wrangler.remote.json');
export const DB_NAME = 'pictures';

const opts = (extra: ExecFileSyncOptions = {}): ExecFileSyncOptions => ({
  cwd: WORKER_DIR,
  maxBuffer: 256 * 1024 * 1024,
  ...extra,
});

export function wrangler(args: string[], capture = false): string {
  const out = execFileSync(BIN, args, opts({ stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' }));
  return capture ? String(out) : '';
}

function remoteDatabaseId(): string {
  const list = JSON.parse(wrangler(['d1', 'list', '--json'], true)) as { name: string; uuid: string }[];
  const db = list.find((d) => d.name === DB_NAME);
  if (!db) throw new Error(`D1 database "${DB_NAME}" not found in this account (Docs/cloudflare.md)`);
  return db.uuid;
}

// Calls fn with the path of a config that points at the real D1, then removes it.
export function withRemoteConfig<T>(fn: (config: string) => T): T {
  const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const id = remoteDatabaseId();
  for (const db of config.d1_databases) if (db.database_name === DB_NAME) db.database_id = id;
  writeFileSync(REMOTE_CONFIG, JSON.stringify(config, null, 2));
  try {
    return fn(REMOTE_CONFIG);
  } finally {
    rmSync(REMOTE_CONFIG, { force: true });
  }
}

export type Target = 'local' | 'remote';

// One D1 session: query() for reads, executeFile() for the write batch.
export function d1<T>(target: Target, fn: (db: {
  query: <R>(sql: string) => R[];
  executeFile: (path: string) => number | null;
}) => T): T {
  const run = (config: string | null) => {
    const base = ['d1', 'execute', 'DB', `--${target}`, ...(config ? ['-c', config] : [])];
    return fn({
      query: <R>(sql: string) => {
        const out = JSON.parse(wrangler([...base, '--json', '--command', sql], true));
        return (out[0]?.results ?? []) as R[];
      },
      // Rows written, summed over the statements (D1's meta).
      // The write already happened once wrangler exits 0, so an output shape
      // we do not know (the remote import API differs from local) is not an
      // error: rows_written is then just unknown. The local D1 never reports it.
      executeFile: (path: string) => {
        const raw = wrangler([...base, '--json', '--yes', '--file', path], true);
        let out: unknown;
        try {
          out = JSON.parse(raw);
        } catch {
          return null;
        }
        const results = (Array.isArray(out) ? out : [out]) as { meta?: { rows_written?: number } }[];
        if (!results.some((r) => typeof r?.meta?.rows_written === 'number')) return null;
        return results.reduce((n, r) => n + (r?.meta?.rows_written ?? 0), 0);
      },
    });
  };
  return target === 'remote' ? withRemoteConfig(run) : run(null);
}
