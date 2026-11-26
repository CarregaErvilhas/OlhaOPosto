// Face detection on the upload page: suggests the areas to blur, which the
// person then confirms, moves, adds to or turns off. Runs on the device with
// the MediaPipe Face Detector (Apache-2.0; the library is copied to /vendor/
// at deploy by scripts/vendor.ts, the BlazeFace model is in /models/). The
// photo never leaves the device for this.
//
// The short-range model looks at a 128 px square, so a face a few metres
// away in a 2048 px photo is too small for it. The photo is read whole and
// then in a 3 × 3 grid of overlapping tiles, and the boxes are merged.
// Number plates have no detector yet: no model with a licence that lets us
// ship it in the browser (Docs/plan.md).

const MODEL = '/models/blaze_face_short_range.tflite';
const WASM = '/vendor/mediapipe/wasm';
const MIN_SCORE = 0.5;
// Each box grows by this much on every side: hair, ears, a turned head.
const PAD = 0.25;
const GRID = 3;
const OVERLAP = 0.25;

let detector = null;

async function load() {
  if (!detector) {
    detector = (async () => {
      const { FaceDetector, FilesetResolver } = await import('/vendor/mediapipe/vision_bundle.mjs');
      const files = await FilesetResolver.forVisionTasks(WASM);
      return FaceDetector.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        minDetectionConfidence: MIN_SCORE,
      });
    })();
    detector.catch(() => { detector = null; });
  }
  return detector;
}

// Intersection over the smaller box: a face found whole and in a tile is one face.
function overlap(a, b) {
  const x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return (x * y) / Math.min(a.w * a.h, b.w * b.h);
}

export function mergeBoxes(boxes) {
  const out = [];
  for (const b of [...boxes].sort((p, q) => q.w * q.h - p.w * p.h)) {
    const same = out.find((o) => overlap(o, b) > 0.4);
    if (same) {
      const x = Math.min(same.x, b.x);
      const y = Math.min(same.y, b.y);
      same.w = Math.max(same.x + same.w, b.x + b.w) - x;
      same.h = Math.max(same.y + same.h, b.y + b.h) - y;
      same.x = x;
      same.y = y;
    } else {
      out.push({ ...b });
    }
  }
  return out;
}

export function pad(b) {
  const x = Math.max(0, b.x - b.w * PAD);
  const y = Math.max(0, b.y - b.h * PAD);
  return { x, y, w: Math.min(1, b.x + b.w * (1 + PAD)) - x, h: Math.min(1, b.y + b.h * (1 + PAD)) - y };
}

// The tiles to read, as pixel rectangles of the source.
export function tiles(width, height) {
  const out = [{ sx: 0, sy: 0, sw: width, sh: height }];
  const tw = width / (GRID - (GRID - 1) * OVERLAP);
  const th = height / (GRID - (GRID - 1) * OVERLAP);
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      out.push({ sx: Math.round(i * tw * (1 - OVERLAP)), sy: Math.round(j * th * (1 - OVERLAP)), sw: Math.round(tw), sh: Math.round(th) });
    }
  }
  return out;
}

// Faces in the canvas, as fractions of it: [{ x, y, w, h }], padded.
export async function detectFaces(source) {
  const fd = await load();
  const { width, height } = source;
  const tile = document.createElement('canvas');
  const found = [];
  for (const t of tiles(width, height)) {
    tile.width = t.sw;
    tile.height = t.sh;
    tile.getContext('2d').drawImage(source, t.sx, t.sy, t.sw, t.sh, 0, 0, t.sw, t.sh);
    for (const d of fd.detect(tile).detections ?? []) {
      const bb = d.boundingBox;
      if (!bb || (d.categories?.[0]?.score ?? 1) < MIN_SCORE) continue;
      found.push({
        x: (t.sx + bb.originX) / width,
        y: (t.sy + bb.originY) / height,
        w: bb.width / width,
        h: bb.height / height,
      });
    }
  }
  return mergeBoxes(found).map(pad);
}
