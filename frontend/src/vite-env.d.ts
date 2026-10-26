/// <reference types="vite/client" />
declare module '*.css';

// Superficie mínima de los dos builtins que usa el puente SQLite en Node.
// `@types/node` no está instalado a propósito (el bundle es de navegador), así
// que la firma se declara aquí con los tipos reales, sin `any`.
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string): Uint8Array;
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
}
