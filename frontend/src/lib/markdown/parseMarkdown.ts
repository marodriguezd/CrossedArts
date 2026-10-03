/**
 * CrossedArts — Parser Markdown local, determinista y seguro.
 *
 * Diseñado para renderizar las respuestas del tutor sin introducir un stack
 * pesado ni `dangerouslySetInnerHTML`. El parser NO entiende HTML en bruto:
 * cualquier etiqueta del modelo se conserva como texto literal, por lo que es
 * estructuralmente imposible inyectar `<script>`, `<iframe>`, manejadores de
 * eventos o HTML arbitrario. Un nodo de tipo "html"/"raw" no existe.
 *
 * Subconjunto soportado: negrita, cursiva, código inline, listas (ordenadas y
 * no ordenadas), párrafos con saltos de línea, encabezados, bloques de código
 * cercados y enlaces (con esquema validado).
 */

export type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: InlineToken[] }
  | { type: 'em'; children: InlineToken[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; children: InlineToken[] };

export type MarkdownBlock =
  | { type: 'paragraph'; lines: InlineToken[][] }
  | { type: 'heading'; level: number; children: InlineToken[] }
  | { type: 'list'; ordered: boolean; items: InlineToken[][] }
  | { type: 'code'; language: string; value: string };

/** Esquemas de URL permitidos para enlaces del tutor. Cualquier otro se descarta. */
const ALLOWED_URL_SCHEMES = new Set(['http', 'https', 'mailto']);

/**
 * Valida una URL de enlace. Devuelve `null` cuando el destino no es seguro
 * (p. ej. `javascript:`, `data:`, `vbscript:` o URLs con caracteres de control).
 * En ese caso el renderizador muestra el texto del enlace sin anchor.
 */
export function sanitizeUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const url = raw.trim();
  if (!url) return null;
  // Caracteres de control (incluye saltos de línea/tabuladores): un navegador
  // podría normalizarlos y convertir `java\nscript:` en `javascript:`.
  if (/[\u0000-\u001f\u007f]/.test(url)) return null;
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
  if (schemeMatch) {
    return ALLOWED_URL_SCHEMES.has(schemeMatch[1].toLowerCase()) ? url : null;
  }
  // URLs protocol-relative (`//host`): se descartan por seguridad.
  if (url.startsWith('//')) return null;
  // Rutas relativas y anclas locales.
  return url;
}

// Grupo 1/2: código inline (`...`). 3/4: enlace [texto](url).
// 5/6: negrita (** / __). 7/8: cursiva (* / _).
const INLINE_SOURCE =
  /(`+)([\s\S]*?)\1|\[([^\]]*)\]\(([^)\s]*)\)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([^*\n]+?)\*|_([^_\n]+?)_/g;

/** Convierte una línea de texto en tokens inline seguros. */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  const re = new RegExp(INLINE_SOURCE.source, 'g');
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      tokens.push({ type: 'text', value: text.slice(last, match.index) });
    }

    if (match[2] !== undefined) {
      tokens.push({ type: 'code', value: match[2].replace(/^\n|\n$/g, '') });
    } else if (match[3] !== undefined) {
      const href = sanitizeUrl(match[4]);
      const children = parseInline(match[3]);
      if (href) {
        tokens.push({ type: 'link', href, children });
      } else {
        // Enlace no seguro: se conserva solo su texto, sin anchor.
        tokens.push(...children);
      }
    } else if (match[5] !== undefined) {
      tokens.push({ type: 'strong', children: parseInline(match[5]) });
    } else if (match[6] !== undefined) {
      tokens.push({ type: 'strong', children: parseInline(match[6]) });
    } else if (match[7] !== undefined) {
      tokens.push({ type: 'em', children: parseInline(match[7]) });
    } else if (match[8] !== undefined) {
      tokens.push({ type: 'em', children: parseInline(match[8]) });
    }

    last = re.lastIndex;
    // Salvaguarda contra coincidencias de longitud cero.
    if (re.lastIndex === match.index) re.lastIndex++;
  }

  if (last < text.length) {
    tokens.push({ type: 'text', value: text.slice(last) });
  }
  return tokens;
}

const BLOCK_START = /^\s*(```+|~~~+|#{1,6}\s|[-*+]\s+|\d+[.)]\s+)/;
const FENCE_OPEN = /^\s*(```+|~~~+)\s*([\w.+-]*)\s*$/;
const FENCE_CLOSE = /^\s*(```+|~~~+)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const UL_ITEM = /^\s*[-*+]\s+/;
const OL_ITEM = /^\s*\d+[.)]\s+/;

/** Convierte el texto Markdown del asistente en una lista de bloques tipados. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = String(source ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    const fence = FENCE_OPEN.exec(line);
    if (fence) {
      const marker = fence[1][0];
      const minLength = fence[1].length;
      const language = fence[2] || '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length) {
        const close = FENCE_CLOSE.exec(lines[i]);
        if (close && close[1][0] === marker && close[1].length >= minLength) {
          i++;
          break;
        }
        codeLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: 'code', language, value: codeLines.join('\n') });
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, children: parseInline(heading[2]) });
      i++;
      continue;
    }

    if (UL_ITEM.test(line)) {
      const items: InlineToken[][] = [];
      while (i < lines.length && UL_ITEM.test(lines[i])) {
        items.push(parseInline(lines[i].replace(UL_ITEM, '')));
        i++;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }

    if (OL_ITEM.test(line)) {
      const items: InlineToken[][] = [];
      while (i < lines.length && OL_ITEM.test(lines[i])) {
        items.push(parseInline(lines[i].replace(OL_ITEM, '')));
        i++;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    const paragraphLines: InlineToken[][] = [];
    while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) {
      paragraphLines.push(parseInline(lines[i]));
      i++;
    }
    blocks.push({ type: 'paragraph', lines: paragraphLines });
  }

  return blocks;
}
