// Production deploy: applies pending D1 migrations, then publishes the Worker.
// Workers Builds runs this on every push to main (deploy command
// `npm run deploy`); it also works by hand after `npx wrangler login`.
//
// Migrations go first so new code never meets an old schema. The old code
// does meet the new schema for the seconds in between, so a migration must
// keep working with the version already live: add, never rename or drop in
// the same PR as the code that stops using it (Docs/cloudflare.md).
//
// `migrations apply` skips the ones already in d1_migrations, so a deploy
// with nothing new is a no-op there. Without a TTY wrangler does not ask for
// confirmation.

import { execFileSync } from 'node:child_process';
import { withRemoteConfig, wrangler } from './lib/wrangler.ts';

// The browser libraries the upload page loads (scripts/vendor.ts).
execFileSync(process.execPath, [new URL('./vendor.ts', import.meta.url).pathname], { stdio: 'inherit' });

withRemoteConfig((config) => {
  wrangler(['d1', 'migrations', 'apply', 'DB', '--remote', '-c', config]);
  wrangler(['deploy', '-c', config]);
});
