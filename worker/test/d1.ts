// A D1 stand-in on node:sqlite with every migration applied, so the tests
// run the real SQL. Only the calls the Worker uses.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DIR = join(import.meta.dirname, '..', 'migrations');

export function d1() {
  const sql = new DatabaseSync(':memory:');
  for (const f of readdirSync(DIR).filter((n) => n.endsWith('.sql')).sort()) {
    sql.exec(readFileSync(join(DIR, f), 'utf8'));
  }
  const prepare = (query: string) => {
    let args: unknown[] = [];
    const s = {
      bind(...a: unknown[]) { args = a; return s; },
      async first<T>() { return (sql.prepare(query).get(...(args as never[])) ?? null) as T | null; },
      async all<T>() { return { results: sql.prepare(query).all(...(args as never[])) as T[] }; },
      async run() { const r = sql.prepare(query).run(...(args as never[])); return { meta: { changes: Number(r.changes) } }; },
    };
    return s;
  };
  return {
    sql,
    prepare,
    async batch(stmts: { all(): Promise<unknown> }[]) { return Promise.all(stmts.map((s) => s.all())); },
  };
}
