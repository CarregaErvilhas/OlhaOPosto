// Copies the group's shared files from the brand/ submodule
// (CarregaErvilhas/Brand) into public/: the group page's mascots and
// install.js. The copies are ignored by git. src/grupo.ts imports
// brand/group.json, so a build needs the submodule too. Runs from
// scripts/vendor.ts (before `wrangler dev` and every deploy) and before
// `npm test`.
//
// An absent submodule is fetched here, so a clone without it (a fresh one,
// or a build service that does not check out submodules) still builds. One
// that is already there is left as it is.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(import.meta.dirname, '..', '..');
const BRAND = join(REPO, 'brand');
const PUBLIC = join(REPO, 'worker', 'public');

if (!existsSync(join(BRAND, 'group.json'))) {
  console.log('brand: submodule missing, fetching it');
  execFileSync('git', ['-C', REPO, 'submodule', 'update', '--init', '--depth', '1', 'brand'], { stdio: 'inherit' });
}

const mascots = readdirSync(join(BRAND, 'grupo')).filter((f) => f.endsWith('.svg'));
rmSync(join(PUBLIC, 'grupo'), { recursive: true, force: true });
mkdirSync(join(PUBLIC, 'grupo'), { recursive: true });
for (const f of mascots) copyFileSync(join(BRAND, 'grupo', f), join(PUBLIC, 'grupo', f));
copyFileSync(join(BRAND, 'install.js'), join(PUBLIC, 'install.js'));
console.log(`brand: ${mascots.length} mascots and install.js in public/`);
