/**
 * Ambient types for tesseract.js's browser-native ESM bundle.
 *
 * tesseract.js v7's package `main` points at a CommonJS entry that requires
 * the Node worker (`src/worker/node/defaultOptions.js`), which references the
 * Node-only `__dirname` global and crashes Vite's browser bundle. The package
 * ships `dist/tesseract.esm.min.js` — a browser-safe UMD-in-ESM bundle with
 * the identical public API — so we import that instead.
 *
 * The bundle has no bundled types, so this module re-exposes the package's
 * own `src/index.d.ts` surface (`createWorker`, `PSM`, `Worker`, ...).
 */
declare module "tesseract.js/dist/tesseract.esm.min.js" {
  const tesseract: typeof import("tesseract.js");
  export default tesseract;
}
