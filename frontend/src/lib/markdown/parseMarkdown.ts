/**
 * CrossedArts — Local, deterministic, safe Markdown parser.
 *
 * Built to render tutor answers without a heavy stack or
 * `dangerouslySetInnerHTML`. The parser does NOT understand raw HTML: any tag
 * in the model output is kept as literal text, so injecting `<script>`,
 * `<iframe>`, event handlers, or arbitrary HTML is structurally impossible.
 * No "html"/"raw" node type exists.
 *
 * Supported subset: bold, italics, inline code, lists (ordered and unordered),
 * paragraphs with line breaks, headings, fenced code blocks, and links (with a
 * validated scheme).
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

/** URL schemes allowed for tutor links. Anything else is dropped. */
const ALLOWED_URL_SCHEMES = new Set(['http', 'https', 'mailto']);

/**
 * Validates a link URL. Returns `null` when the target is unsafe (e.g.
 * `javascript:`, `data:`, `vbscript:`, or URLs with control characters). In
 * that case the renderer shows the link text with no anchor.
 */
export function sanitizeUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const url = raw.trim();
  if (!url) return null;
  // Control characters (including newlines/tabs): a browser could normalize
  // them and turn `java\nscript:` into `javascript:`.
  if (/[\u0000-\u001f\u007f]/.test(url)) return null;
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
  if (schemeMatch) {
    return ALLOWED_URL_SCHEMES.has(schemeMatch[1].toLowerCase()) ? url : null;
  }
  // Protocol-relative URLs (`//host`): dropped for safety.
  if (url.startsWith('//')) return null;
  // Relative paths and local anchors.
  return url;
}

// Groups 1/2: inline code (`...`). 3/4: link [text](url).
// 5/6: bold (** / __). 7/8: italics (* / _).
const INLINE_SOURCE =
  /(`+)([\s\S]*?)\1|\[([^\]]*)\]\(([^)\s]*)\)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|\*([^*\n]+?)\*|_([^_\n]+?)_/g;

/** Converts one line of text into safe inline tokens. */
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
        // Unsafe link: only its text is kept, with no anchor.
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
    // Guard against zero-length matches.
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

/** Converts the assistant's Markdown text into a list of typed blocks. */
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
