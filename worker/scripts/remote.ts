// Runs any wrangler command against the real D1 without the id living in the
// repo:
//
//   npm run remote -- d1 migrations apply DB --remote
//   npm run remote -- deploy
//
// Never run a plain `wrangler deploy`: with the "local-only" placeholder it
// fails, and without a database_id wrangler would provision a new, empty D1
// and write its id back into wrangler.json.

import { withRemoteConfig, wrangler } from './lib/wrangler.ts';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('usage: npm run remote -- <wrangler args>');
  process.exit(2);
}
withRemoteConfig((config) => wrangler([...args, '-c', config]));
