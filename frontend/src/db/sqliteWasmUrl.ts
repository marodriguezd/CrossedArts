/**
 * Deterministic URL resolution for the SQLite WebAssembly binary.
 *
 * Context of the real production failure:
 *   Vite resolves `sql.js` with the `browser` condition from its package.json,
 *   which points at `dist/sql-wasm-browser.js`. That Emscripten build requests
 *   `sql-wasm-browser.wasm`, a file we do NOT deploy: `public/` (and therefore
 *   `dist/` and GitHub Pages) holds `sql-wasm.wasm`. The result was a WASM 404
 *   that surfaced as the user-facing "could not load the SQLite engine in
 *   WebAssembly" error.
 *
 *   On top of that, the previous `locateFile` returned `./sql-wasm.wasm`, a
 *   relative path anchored to wherever the bundle runs rather than to the
 *   deployed document. Resolving against `document.baseURI` pins the anchor to
 *   the app's real directory (`/CrossedArts/`) without hardcoding the repository
 *   name, so it stays portable across any static hosting base.
 */

/** Canonical name of the binary we actually deploy in `public/`. */
export const SQLITE_WASM_FILENAME = 'sql-wasm.wasm';

/**
 * Maps the WASM filename Emscripten/sql.js requests to the deployed file.
 * The `sql-wasm.js` and `sql-wasm-browser.js` builds of sql.js share exactly
 * the same binary, so pointing at `sql-wasm.wasm` is correct whether the build
 * requests `sql-wasm.wasm` (standard) or `sql-wasm-browser.wasm` (the `browser`
 * build Vite resolves on the client).
 */
export function deployedSqliteWasmFilename(requested: string): string {
  return /\.wasm$/i.test(requested) ? SQLITE_WASM_FILENAME : requested;
}

/**
 * Resolves the WASM absolute URL against the deployed document's real base.
 * Pure function (no DOM access), so it can be tested without a browser.
 *
 * @param fileName WASM filename (e.g. `sql-wasm.wasm`).
 * @param baseUrl  Deployed document's base (`document.baseURI`).
 */
export function resolveSqliteWasmUrl(fileName: string, baseUrl: string): string {
  return new URL(fileName, baseUrl).href;
}
