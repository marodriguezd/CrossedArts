import { createElement, type ReactNode } from 'react';
import { parseMarkdown, type InlineToken, type MarkdownBlock } from '../../lib/markdown/parseMarkdown.ts';

/**
 * Renderizador seguro del Markdown del tutor.
 *
 * Se implementa con `createElement` (sin JSX) para poder importarse desde el
 * runner de pruebas de Node con `--experimental-strip-types`. Nunca usa
 * `dangerouslySetInnerHTML`: cada token del parser se convierte en un elemento
 * React con texto escapado, de modo que el HTML en bruto del modelo queda como
 * texto literal. Hereda únicamente los tokens semánticos del sistema de diseño.
 */

const INLINE_CODE_CLASS =
  'rounded border border-line bg-raised px-1 py-0.5 font-mono text-[0.85em] text-accent';
const LINK_CLASS = 'text-accent underline underline-offset-2 break-words hover:opacity-80';
const CODE_BLOCK_CLASS =
  'my-2 max-w-full overflow-x-auto rounded-lg border border-line bg-raised p-2.5';
const CODE_BLOCK_INNER_CLASS = 'block whitespace-pre font-mono text-meta leading-relaxed text-ink';

const HEADING_CLASS: Record<number, string> = {
  1: 'mb-1 mt-2 text-section font-semibold text-ink',
  2: 'mb-1 mt-2 text-item font-semibold text-ink',
  3: 'mb-1 mt-2 text-body font-semibold text-ink',
};

function renderInline(tokens: InlineToken[]): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `i${index}`;
    switch (token.type) {
      case 'strong':
        return createElement('strong', { key, className: 'font-semibold text-ink' }, ...renderInline(token.children));
      case 'em':
        return createElement('em', { key, className: 'italic' }, ...renderInline(token.children));
      case 'code':
        return createElement('code', { key, className: INLINE_CODE_CLASS }, token.value);
      case 'link':
        return createElement(
          'a',
          { key, href: token.href, target: '_blank', rel: 'noopener noreferrer', className: LINK_CLASS },
          ...renderInline(token.children)
        );
      default:
        return token.value;
    }
  });
}

function renderBlock(block: MarkdownBlock, key: string): ReactNode {
  switch (block.type) {
    case 'code':
      return createElement(
        'pre',
        { key, className: CODE_BLOCK_CLASS },
        createElement('code', { className: CODE_BLOCK_INNER_CLASS }, block.value)
      );

    case 'heading': {
      const tag = block.level <= 1 ? 'h4' : block.level === 2 ? 'h5' : 'h6';
      return createElement(tag, { key, className: HEADING_CLASS[Math.min(block.level, 3)] }, ...renderInline(block.children));
    }

    case 'list': {
      const items = block.items.map((item, index) => createElement('li', { key: `li${index}`, className: 'leading-relaxed break-words' }, ...renderInline(item)));
      return createElement(
        block.ordered ? 'ol' : 'ul',
        { key, className: block.ordered ? 'my-2 list-decimal space-y-1 pl-5' : 'my-2 list-disc space-y-1 pl-5' },
        ...items
      );
    }

    default: {
      const children: ReactNode[] = [];
      block.lines.forEach((line, index) => {
        if (index > 0) children.push(createElement('br', { key: `br${index}` }));
        children.push(...renderInline(line));
      });
      return createElement('p', { key, className: 'mb-2 break-words leading-relaxed last:mb-0' }, ...children);
    }
  }
}

interface MarkdownMessageProps {
  content: string;
  className?: string;
}

/** Renderiza el cuerpo Markdown de un mensaje del asistente. Solo assistant. */
export const MarkdownMessage = ({ content, className }: MarkdownMessageProps) =>
  createElement('div', { className }, ...parseMarkdown(content).map((block, index) => renderBlock(block, `b${index}`)));

interface MessageBodyProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Cuerpo del mensaje según su rol: el asistente renderiza Markdown; el usuario
 * conserva texto plano exactamente como lo escribió (sin interpretar nada).
 */
export const MessageBody = ({ role, content }: MessageBodyProps) =>
  role === 'user'
    ? createElement('span', { className: 'whitespace-pre-wrap' }, content)
    : createElement(MarkdownMessage, { content });

/** Título de fuente RAG como texto plano (nunca Markdown), truncado con wrap. */
export const SourceTitle = ({ title }: { title: string }) =>
  createElement('span', { className: 'break-words', title }, title);
