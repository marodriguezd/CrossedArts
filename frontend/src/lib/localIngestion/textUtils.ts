/**
 * Normalizes text extracted from a document without gluing words together or
 * losing line boundaries: collapses intra-line spaces, trims each line, and
 * caps consecutive breaks at two.
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
