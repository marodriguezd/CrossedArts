import React, { useState } from 'react';
import { Copy, Check, Clock } from 'lucide-react';
import { parseInlineMarkdownTokens } from '../../services/domainLogic.ts';
import { cn } from '../ui/index.tsx';

interface MarkdownViewerProps {
  content: string;
  className?: string;
  onSeekTimestamp?: (seconds: number) => void;
}

interface CodeBlockProps {
  code: string;
  language?: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ code, language }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignorar fallo de portapapeles
    }
  };

  return (
    <div className="group relative my-3 overflow-hidden rounded-xl border border-line bg-canvas">
      <div className="flex items-center justify-between border-b border-line bg-surface/70 px-3 py-1.5 text-micro text-muted">
        <span className="font-mono">{language || 'código'}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? 'Código copiado al portapapeles' : 'Copiar fragmento de código'}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-micro hover:bg-accent-soft hover:text-ink transition-colors"
        >
          {copied ? (
            <>
              <Check size={12} className="text-success" aria-hidden="true" />
              <span className="text-success">Copiado</span>
            </>
          ) : (
            <>
              <Copy size={12} aria-hidden="true" />
              <span>Copiar</span>
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3.5 font-mono text-secondary text-ink leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
};

/**
 * Renderiza texto enriquecido en línea (negrita, cursiva, código en línea y marcas de tiempo).
 * Construido con nodos puros de React (sin innerHTML ni dependencias externas).
 */
export function renderInlineMarkdown(
  text: string,
  onSeekTimestamp?: (seconds: number) => void
): React.ReactNode[] {
  const tokens = parseInlineMarkdownTokens(text);
  return tokens.map((tok, idx) => {
    switch (tok.type) {
      case 'timestamp':
        return (
          <button
            key={`ts-${idx}`}
            type="button"
            onClick={() => onSeekTimestamp?.(tok.seconds!)}
            className="mx-0.5 inline-flex items-center gap-1 rounded border border-accent/40 bg-accent-soft px-1.5 py-0.5 font-mono text-micro font-semibold text-accent transition-colors hover:border-accent hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus"
            title={`Saltar a ${tok.content} en el reproductor`}
          >
            <Clock size={11} aria-hidden="true" />
            {tok.content}
          </button>
        );
      case 'code':
        return (
          <code
            key={`code-${idx}`}
            className="rounded border border-line bg-canvas px-1.5 py-0.5 font-mono text-micro font-medium text-accent"
          >
            {tok.content}
          </code>
        );
      case 'bold':
        return <strong key={`bold-${idx}`} className="font-bold text-ink">{tok.content}</strong>;
      case 'italic':
        return <em key={`italic-${idx}`} className="italic text-ink">{tok.content}</em>;
      case 'text':
      default:
        return tok.content;
    }
  });
}

/**
 * Visor de Markdown seguro, local y ligero.
 * Soporta títulos (#..###), negrita, cursiva, listas, bloques de código con botón de copia,
 * citas y marcas de tiempo interactivas sin dependencias de red.
 */
export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({
  content,
  className,
  onSeekTimestamp
}) => {
  if (!content || !content.trim()) {
    return null;
  }

  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 1. Bloque de código con valla triple ```
    if (line.trim().startsWith('```')) {
      const language = line.trim().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <CodeBlock
          key={`code-${i}`}
          code={codeLines.join('\n')}
          language={language || undefined}
        />
      );
      i++;
      continue;
    }

    // 2. Títulos
    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={`h1-${i}`} className="mt-4 mb-2 font-serif text-2xl font-bold text-ink border-b border-line pb-1">
          {renderInlineMarkdown(line.slice(2), onSeekTimestamp)}
        </h1>
      );
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={`h2-${i}`} className="mt-3.5 mb-1.5 font-serif text-xl font-bold text-ink border-b border-line/60 pb-1">
          {renderInlineMarkdown(line.slice(3), onSeekTimestamp)}
        </h2>
      );
      i++;
      continue;
    }
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={`h3-${i}`} className="mt-3 mb-1 font-serif text-lg font-semibold text-ink">
          {renderInlineMarkdown(line.slice(4), onSeekTimestamp)}
        </h3>
      );
      i++;
      continue;
    }

    // 3. Regla horizontal
    if (/^(\-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      elements.push(<hr key={`hr-${i}`} className="my-4 border-line" />);
      i++;
      continue;
    }

    // 4. Citas / Blockquotes
    if (line.startsWith('>')) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''));
        i++;
      }
      elements.push(
        <blockquote key={`bq-${i}`} className="my-2.5 rounded-r-lg border-l-4 border-accent/50 bg-accent-soft/30 py-2 pl-3.5 italic text-muted">
          {quoteLines.map((ql, qIdx) => (
            <p key={qIdx} className="leading-relaxed">
              {renderInlineMarkdown(ql, onSeekTimestamp)}
            </p>
          ))}
        </blockquote>
      );
      continue;
    }

    // 5. Listas no ordenadas (- o *)
    if (/^[\-\*]\s/.test(line.trim())) {
      const listItems: string[] = [];
      while (i < lines.length && /^[\-\*]\s/.test(lines[i].trim())) {
        listItems.push(lines[i].trim().slice(2));
        i++;
      }
      elements.push(
        <ul key={`ul-${i}`} className="my-2 space-y-1 pl-5 list-disc text-secondary text-ink leading-relaxed">
          {listItems.map((item, lIdx) => (
            <li key={lIdx}>{renderInlineMarkdown(item, onSeekTimestamp)}</li>
          ))}
        </ul>
      );
      continue;
    }

    // 6. Listas numeradas (1. 2. etc.)
    if (/^\d+\.\s/.test(line.trim())) {
      const listItems: string[] = [];
      while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
        listItems.push(lines[i].trim().replace(/^\d+\.\s/, ''));
        i++;
      }
      elements.push(
        <ol key={`ol-${i}`} className="my-2 space-y-1 pl-5 list-decimal text-secondary text-ink leading-relaxed">
          {listItems.map((item, lIdx) => (
            <li key={lIdx}>{renderInlineMarkdown(item, onSeekTimestamp)}</li>
          ))}
        </ol>
      );
      continue;
    }

    // 7. Línea vacía
    if (!line.trim()) {
      elements.push(<div key={`sp-${i}`} className="h-2" />);
      i++;
      continue;
    }

    // 8. Párrafo común
    elements.push(
      <p key={`p-${i}`} className="leading-relaxed text-ink">
        {renderInlineMarkdown(line, onSeekTimestamp)}
      </p>
    );
    i++;
  }

  return (
    <div className={cn('type-prose space-y-1 break-words leading-relaxed', className)}>
      {elements}
    </div>
  );
};
