/// <reference types="vite/client" />
declare module '*.css';

declare module 'node:fs' {
  export function existsSync(path: any): boolean;
  export function readFileSync(path: any): any;
}

declare module 'node:path' {
  export function resolve(...paths: string[]): string;
}
