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
      // For batch: the rows and the changes, as D1 returns for each statement.
      step() {
        const st = sql.prepare(query);
        if (st.columns().length) return { results: st.all(...(args as never[])), meta: { changes: 0 } };
        const r = st.run(...(args as never[]));
        return { results: [], meta: { changes: Number(r.changes) } };
      },
    };
    return s;
  };
  return {
    sql,
    prepare,
    // One transaction, like D1: a statement that throws undoes the others.
    async batch(stmts: { step(): unknown }[]) {
      sql.exec('BEGIN');
      try {
        const out = stmts.map((s) => s.step());
        sql.exec('COMMIT');
        return out;
      } catch (err) {
        sql.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
