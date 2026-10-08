/**
 * Tipado mínimo para los imports con query de Vite (`?url`), usados para
 * resolver artefactos de worker a una URL local construida por el bundler.
 *
 * No se referencia `vite/client` completo a propósito: sólo se necesita esta
 * regla y así el chequeo de tipos no depende del entorno de Vite.
 */
declare module '*?url' {
  const src: string;
  export default src;
}
