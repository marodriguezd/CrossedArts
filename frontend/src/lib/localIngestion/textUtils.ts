/**
 * Normaliza texto extraído de un documento sin fusionar palabras ni perder
 * fronteras de línea: colapsa espacios intra-línea, recorta cada línea y
 * limita los saltos consecutivos a dos.
 */
export function normalizeExtractedText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
