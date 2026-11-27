// Copies the browser libraries the upload page loads from public/vendor/,
// straight out of node_modules: the versions are the ones in package.json
// (Dependabot bumps them), and no third-party file is committed. Runs before
// `wrangler dev` and before every deploy (scripts/deploy.ts), so the folder,
// which is ignored by git, always matches the lockfile.
//
//   libheif-js       LGPL-3.0     HEIC photos (public/heic.js)
//   @mediapipe/...   Apache-2.0   face detection (public/detect.js)
//   leaflet          BSD-2-Clause the station map (public/upload.js)
//
// Each library keeps its licence file next to it. It also runs
// scripts/brand.ts, so both callers get the group's shared files too.
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import './brand.ts';

const ROOT = join(import.meta.dirname, '..');
const OUT = join(ROOT, 'public', 'vendor');

const FILES: [string, string][] = [
  ['libheif-js/libheif-wasm/libheif.js', 'libheif/libheif.js'],
  ['libheif-js/libheif-wasm/libheif.wasm', 'libheif/libheif.wasm'],
  ['libheif-js/libheif-wasm/LICENSE', 'libheif/LICENSE'],
  ['@mediapipe/tasks-vision/vision_bundle.mjs', 'mediapipe/vision_bundle.mjs'],
  ['@mediapipe/tasks-vision/wasm/vision_wasm_internal.js', 'mediapipe/wasm/vision_wasm_internal.js'],
  ['@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm', 'mediapipe/wasm/vision_wasm_internal.wasm'],
  ['leaflet/dist/leaflet.js', 'leaflet/leaflet.js'],
  ['leaflet/dist/leaflet.css', 'leaflet/leaflet.css'],
  ['leaflet/LICENSE', 'leaflet/LICENSE'],
];

rmSync(OUT, { recursive: true, force: true });
for (const [from, to] of FILES) {
  const dest = join(OUT, to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(join(ROOT, 'node_modules', from), dest);
}
// MediaPipe ships no LICENSE file in the package; its package.json says Apache-2.0.
console.log(`vendor: ${FILES.length} files in public/vendor/`);
