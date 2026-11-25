import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rekey, aliasesHtml, aliasPath } from '../src/aliases.ts';
import type { AuthEnv } from '../src/auth.ts';

function env(actorRole: string | null, oldStatus = 'missing_from_nap', newStatus = 'active', existingAlias = false) {
  const writes: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first() {
              if (sql.includes('FROM users u') || sql.includes('FROM users WHERE') || sql.includes('users WHERE id')) {
                // currentUser lookup not used; aliases uses currentUser from auth. We bypass by mocking? 
                return null;
              }
              if (sql.includes('FROM stations WHERE id = ?') && sql.includes('status')) {
                // first call old, second new depending on args
                const id = args[0];
                if (id === 'OLD') return oldStatus ? { status: oldStatus } : null;
                if (id === 'NEW') return newStatus ? { status: newStatus } : null;
                return null;
              }
              if (sql.includes('FROM station_aliases WHERE old_id')) {
                return existingAlias ? { new_id: 'X' } : null;
              }
              return null;
            },
            async run() {
              writes.push(args);
              return { meta: { changes: 1 } };
            },
            async all() {
              return { results: [] };
            },
          };
        },
      };
    },
  };
  return { env: { DB: db } as unknown as AuthEnv, writes };
}

// currentUser in auth reads users table; our fake doesn't. Instead test rekey's moderator gate by injecting user? 
// rekey calls currentUser which will throw/fail. This test only checks bad body path? 
test('aliasPath returns paths', () => {
  assert.equal(aliasPath('pt'), '/admin/postos-fora-do-nap');
  assert.equal(aliasPath('en'), '/en/admin/stations-missing');
});
