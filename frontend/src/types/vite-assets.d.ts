/**
 * Minimal typing for Vite query imports (`?url`), used to resolve worker
 * artifacts to a local URL built by the bundler.
 *
 * The full `vite/client` is deliberately NOT referenced: only this rule is
 * needed, so type checking does not depend on the Vite environment.
 */
declare module '*?url' {
  const src: string;
  export default src;
}
