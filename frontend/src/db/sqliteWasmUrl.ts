/**
 * Resolución determinista de la URL del binario WebAssembly de SQLite.
 *
 * Contexto del fallo real de producción:
 *   Vite resuelve `sql.js` con la condición `browser` de su package.json, que
 *   apunta a `dist/sql-wasm-browser.js`. Esa build de Emscripten pide
 *   `sql-wasm-browser.wasm`, un fichero que NO desplegamos: en `public/` (y por
 *   tanto en `dist/` y en GitHub Pages) vive `sql-wasm.wasm`. El resultado era un
 *   404 del WASM y el error "No se pudo cargar el motor SQLite en WebAssembly".
 *
 *   Además, el `locateFile` anterior devolvía `./sql-wasm.wasm`, una ruta relativa
 *   cuyo ancla depende de dónde corre el bundle y no del documento desplegado.
 *   Resolver contra `document.baseURI` fija el ancla al directorio real de la
 *   aplicación (`/CrossedArts/`) sin codificar el nombre del repositorio, de modo
 *   que sigue siendo portable a cualquier base de hosting estático.
 */

/** Nombre canónico del binario que realmente desplegamos en `public/`. */
export const SQLITE_WASM_FILENAME = 'sql-wasm.wasm';

/**
 * Traduce el nombre de WASM que pide Emscripten/sql.js al fichero desplegado.
 * Las builds `sql-wasm.js` y `sql-wasm-browser.js` de sql.js comparten
 * exactamente el mismo binario, así que apuntar a `sql-wasm.wasm` es correcto
 * tanto si la build pide `sql-wasm.wasm` (estándar) como `sql-wasm-browser.wasm`
 * (build `browser` que Vite resuelve en el cliente).
 */
export function deployedSqliteWasmFilename(requested: string): string {
  return /\.wasm$/i.test(requested) ? SQLITE_WASM_FILENAME : requested;
}

/**
 * Resuelve la URL absoluta del WASM contra la base real del documento desplegado.
 * Es una función pura (no toca el DOM), por lo que se puede probar sin navegador.
 *
 * @param fileName Nombre del fichero WASM (p. ej. `sql-wasm.wasm`).
 * @param baseUrl  Base del documento desplegado (`document.baseURI`).
 */
export function resolveSqliteWasmUrl(fileName: string, baseUrl: string): string {
  return new URL(fileName, baseUrl).href;
}
