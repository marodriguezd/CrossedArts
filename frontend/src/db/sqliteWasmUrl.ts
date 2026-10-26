/**
 * Deterministic URL resolution for the SQLite WebAssembly binary.
 *
 * Vite resolves `sql.js` through its `browser` condition, whose build requests
 * `sql-wasm-browser.wasm` — a file we do not deploy (`public/` ships
 * `sql-wasm.wasm`), which surfaced as a 404 in production. Resolving against
 * `document.baseURI` pins the anchor to the deployed directory (`/CrossedArts/`)
 * without hardcoding the repository name.
 */

/** Canonical name of the binary we actually deploy in `public/`. */
export const SQLITE_WASM_FILENAME = 'sql-wasm.wasm';

/**
 * Maps the WASM filename sql.js requests to the deployed one: the standard and
 * `browser` builds share exactly the same binary.
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
