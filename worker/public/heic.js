// HEIC/HEIF photos on the upload page: decodeHeic turns the primary image
// into a canvas with libheif (LGPL-3.0, WebAssembly, copied to /vendor/ at
// deploy by scripts/vendor.ts), loaded only when a HEIC file is picked. The
// metadata comes from public/heif.js. Everything stays on the device, like
// the rest of the page.
export { isHeic, readHeicExif } from './heif.js';

let libheif = null;

function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => fail(new Error('heic'));
    document.head.append(s);
  });
}

async function lib() {
  if (!libheif) {
    libheif = (async () => {
      const [, wasm] = await Promise.all([
        loadScript('/vendor/libheif/libheif.js'),
        fetch('/vendor/libheif/libheif.wasm').then((r) => {
          if (!r.ok) throw new Error('heic');
          return r.arrayBuffer();
        }),
      ]);
      // The glue script defines a global factory. With the wasm bytes handed
      // over, it may be ready before the factory returns, or just after.
      return new Promise((ok) => {
        let mod = null;
        let ready = false;
        mod = globalThis.libheif({ wasmBinary: wasm, onRuntimeInitialized: () => { ready = true; if (mod) ok(mod); } });
        if (ready) ok(mod);
      });
    })();
    libheif.catch(() => { libheif = null; });
  }
  return libheif;
}

// The primary image as a canvas, at full size. HEIF stores the rotation as
// a transform that libheif applies, so the result is upright.
export async function decodeHeic(bytes) {
  const heif = await lib();
  const decoder = new heif.HeifDecoder();
  const images = decoder.decode(bytes);
  if (!images?.length) throw new Error('heic');
  const img = images.find((i) => i.is_primary()) ?? images[0];
  const width = img.get_width();
  const height = img.get_height();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const data = ctx.createImageData(width, height);
  await new Promise((ok, fail) => {
    img.display(data, (out) => (out ? ok() : fail(new Error('heic'))));
  });
  ctx.putImageData(data, 0, 0);
  for (const i of images) i.free?.();
  return canvas;
}
