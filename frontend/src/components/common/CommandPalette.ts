import {
  Fragment,
  createElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ClipboardList,
  CornerDownLeft,
  FileDown,
  FileText,
  GraduationCap,
  Lightbulb,
  Search,
  SearchX,
  StickyNote,
  Target,
  X,
  Zap,
} from 'lucide-react';
import { Kbd, cn } from '../ui/primitives.ts';
import { useLanguage } from '../../hooks/useLanguage.ts';
import {
  groupPaletteItems,
  matchPaletteItems,
  movePaletteSelection,
  segmentForHighlight,
  type HighlightSegment,
  type PaletteGroup,
  type PaletteItem,
  type PaletteMatch,
} from '../../services/commandPalette.ts';

/**
 * Global command palette (Ctrl+K / Cmd+K), in `.ts` with `createElement`. It
 * stays out of `.tsx` on purpose: `node --test --experimental-strip-types`
 * strips types but not JSX, so a `.tsx` file **cannot be imported from the
 * suite**. JSX-free code lets `tests/command_palette_render.test.ts` render it
 * with `renderToStaticMarkup` and assert on real HTML instead of auditing
 * source strings. Same treatment as `MarkdownMessage.ts`. `cn` and `Kbd` live
 * in `components/ui/primitives.ts` for the same reason: importing them from
 * `ui/index.tsx` (a `.tsx`) would break the runner. `h` aliases `createElement`
 * only to keep six-level nesting readable. No new abstraction: every element
 * keeps the same classes and ARIA attributes as its JSX version.
 *
 * Accessibility:
 * - `role="dialog"` + `aria-modal` with `useId`-linked title.
 * - The field is a `combobox` with `aria-expanded`, `aria-controls`,
 *   `aria-autocomplete`, and `aria-activedescendant`; the list is a `listbox`
 *   with one `option` per row. First combobox semantics in the project,
 *   following the `ui/index.tsx` rule: state is never color-only.
 * - Escape closes and focus returns to the palette opener.
 * - Focus stays trapped inside the dialog on Tab.
 * - An `aria-live` region announces the result count.
 */

const h = createElement;

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  /** Full catalog already built by the parent (actions + entities). */
  items: PaletteItem[];
  /** Runs the chosen item. The parent decides what each id does. */
  onExecute: (item: PaletteItem) => void;
  /** Handoff to full Library search with the current query. */
  onSearchAll?: (query: string) => void;
  /**
   * Initial query, seeded on every palette open. Exists for testability:
   * without it `<mark>` highlighting is unreachable from a static render
   * because `useState('')` always starts empty. Standard React way to open a
   * component with initial state; it also enables opening with a typed query.
   */
  initialQuery?: string;
}

const GROUP_ICONS: Record<PaletteGroup, ComponentType<{ size?: number }>> = {
  accion: Zap,
  meta: Target,
  curso: GraduationCap,
  libro: BookOpen,
  recurso: FileDown,
  practica: ClipboardList,
  leccion: FileText,
  nota: StickyNote,
  concepto: Lightbulb,
};

export function CommandPalette({
  isOpen,
  onClose,
  items,
  onExecute,
  onSearchAll,
  initialQuery,
}: CommandPaletteProps) {
  const titleId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  // State already starts seeded, not only via the effect: in static renders
  // (`renderToStaticMarkup`) effects NEVER run, so seeding only in `useEffect`
  // would hide `initialQuery` outside the browser. The open effect covers real
  // reopen cases.
  const { effective } = useLanguage();
  const [query, setQuery] = useState(initialQuery ?? '');
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(() => matchPaletteItems(items, query), [items, query]);
  const results = useMemo(() => matches.map(match => match.item), [matches]);
  const groups = useMemo(() => groupPaletteItems(matches, effective), [matches, effective]);

  // The active index is clamped to the real range: the list changes length on
  // every keystroke and the active row must never fall outside.
  const safeIndex = results.length === 0 ? -1 : Math.min(Math.max(activeIndex, 0), results.length - 1);
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    results.forEach((item, index) => map.set(item.id, index));
    return map;
  }, [results]);

  // Resets query and selection on every open: reopening never shows the prior
  // search state, unless the parent explicitly requests otherwise via
  // `initialQuery`.
  useEffect(() => {
    if (!isOpen) return;
    setQuery(initialQuery ?? '');
    setActiveIndex(0);
    previouslyFocused.current =
      (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const focusTimer = setTimeout(() => inputRef.current?.focus(), 20);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearTimeout(focusTimer);
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen, onClose, initialQuery]);

  /**
   * Paints text by wrapping matches in `<mark>`. Segments render as React
   * children, which escape them: a note may hold `<script>` or Markdown and
   * must SHOW as text, never execute. Hence no `dangerouslySetInnerHTML` here.
   */
  const highlighted = (text: string, ranges: PaletteMatch['titleRanges']): ReactNode => {
    if (!text) return null;
    const segments: HighlightSegment[] = segmentForHighlight(text, ranges);
    return segments.map((segment, index) =>
      segment.match
        ? h(
            'mark',
            { key: index, className: 'rounded bg-accent-soft px-0.5 font-semibold text-ink' },
            segment.text
          )
        : h(Fragment, { key: index }, segment.text)
    );
  };

  if (!isOpen) return null;

  const execute = (item: PaletteItem | undefined) => {
    if (!item) return;
    onExecute(item);
    onClose();
  };

  const handleInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex(movePaletteSelection(safeIndex, 1, results.length));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex(movePaletteSelection(safeIndex, -1, results.length));
        return;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        return;
      case 'End':
        event.preventDefault();
        setActiveIndex(Math.max(results.length - 1, 0));
        return;
      case 'Enter':
        event.preventDefault();
        execute(results[safeIndex]);
        return;
      case 'Tab': {
        // Focus containment inside the dialog: without it, Tab would escape to
        // controls behind the overlay.
        const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
          'input, button:not([disabled]), a[href], select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      default:
    }
  };

  const renderOption = (match: PaletteMatch) => {
    const item = match.item;
    const optionIndex = indexById.get(item.id) ?? 0;
    const isActive = optionIndex === safeIndex;
    const Icon = GROUP_ICONS[item.group];

    return h(
      'div',
      {
        key: item.id,
        id: `palette-option-${optionIndex}`,
        role: 'option',
        'aria-selected': isActive,
        onMouseEnter: () => setActiveIndex(optionIndex),
        onClick: () => execute(item),
        className: cn(
          'relative mx-1.5 flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors duration-fast',
          isActive ? 'bg-accent-soft' : 'hover:bg-accent-soft/50'
        ),
      },
      // Active indicator: shape and position, not color alone.
      h('span', {
        key: 'marca',
        'aria-hidden': 'true',
        className: cn(
          'absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full transition-opacity',
          isActive ? 'bg-accent opacity-100' : 'opacity-0'
        ),
      }),
      h(
        'span',
        {
          key: 'icono',
          'aria-hidden': 'true',
          className: cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border',
            isActive ? 'border-accent/30 bg-accent/10 text-accent' : 'border-line bg-surface text-muted'
          ),
        },
        h(Icon, { size: 14 })
      ),
      h(
        'span',
        { key: 'texto', className: 'min-w-0 flex-1' },
        h(
          'span',
          { key: 'titulo', className: 'block truncate text-secondary font-medium text-ink' },
          highlighted(match.title, match.titleRanges)
        ),
        match.subtitle &&
          h(
            'span',
            { key: 'subtitulo', className: 'block truncate text-micro text-faint' },
            highlighted(match.subtitle, match.subtitleRanges)
          )
      ),
      isActive &&
        h(CornerDownLeft, {
          key: 'entrar',
          size: 13,
          'aria-hidden': 'true',
          className: 'shrink-0 text-faint',
        })
    );
  };

  const renderGroup = (group: { group: PaletteGroup; label: string; items: PaletteMatch[] }) =>
    h(
      'div',
      { key: group.group, role: 'group', 'aria-label': group.label },
      // The visible caption hides from screen readers: the group already announces via aria-label.
      h(
        'p',
        {
          key: 'rotulo',
          'aria-hidden': 'true',
          className: 'px-3 pb-1 pt-2.5 text-micro font-semibold uppercase tracking-wide text-faint',
        },
        group.label
      ),
      group.items.map(renderOption)
    );

  return h(
    'div',
    {
      className: 'fixed inset-0 z-[70] flex animate-fade-in items-start justify-center bg-ink/40 p-4 pt-[10vh] backdrop-blur-sm',
      onClick: onClose,
    },
    h(
      'div',
      {
        ref: panelRef,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': titleId,
        onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
        className:
          'flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-raised shadow-pop',
      },
      h('h2', { key: 'titulo', id: titleId, className: 'sr-only' }, 'Paleta de comandos'),

      // Query field: combobox with the full ARIA pattern.
      h(
        'div',
        { key: 'campo', className: 'flex items-center gap-2 border-b border-line px-3' },
        h(Search, { key: 'lupa', size: 16, 'aria-hidden': 'true', className: 'shrink-0 text-faint' }),
        h('input', {
          key: 'entrada',
          ref: inputRef,
          type: 'text',
          role: 'combobox',
          'aria-expanded': 'true',
          'aria-controls': listId,
          'aria-autocomplete': 'list',
          'aria-activedescendant': safeIndex >= 0 ? `palette-option-${safeIndex}` : undefined,
          'aria-label': 'Buscar y saltar a',
          value: query,
          placeholder: 'Busca cursos, lecciones, notas o acciones…',
          onChange: (event: { target: { value: string } }) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          },
          onKeyDown: handleInputKeyDown,
          className:
            'h-12 w-full bg-transparent text-secondary text-ink placeholder:text-faint focus:outline-none focus-visible:outline-none',
        }),
        h(
          'button',
          {
            key: 'cerrar',
            type: 'button',
            onClick: onClose,
            'aria-label': 'Cerrar paleta de comandos',
            className:
              'shrink-0 rounded-md p-1 text-faint transition-colors hover:bg-accent-soft hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
          },
          h(X, { size: 15, 'aria-hidden': 'true' })
        )
      ),

      // Grouped results. The `listbox` ALWAYS mounts, even empty: the field's
      // `aria-controls` must point at a real id; previously the id only existed
      // with results, leaving a dangling reference exactly in the "no results"
      // case when screen-reader state matters most. The empty message sits
      // OUTSIDE the listbox because its content is not options.
      h(
        'div',
        { key: 'resultados', className: 'min-h-0 flex-1 overflow-y-auto' },
        h(
          'div',
          { key: 'listbox', id: listId, role: 'listbox', 'aria-label': 'Resultados de la paleta' },
          groups.map(renderGroup)
        ),

        results.length === 0 &&
          h(
            'div',
            { key: 'vacio', className: 'flex flex-col items-center gap-2 px-4 py-10 text-center' },
            h(SearchX, { size: 20, 'aria-hidden': 'true', className: 'text-faint' }),
            h('p', { key: 't', className: 'text-secondary font-medium text-ink' }, 'Sin resultados'),
            h(
              'p',
              { key: 'd', className: 'type-meta max-w-xs text-faint' },
              `No hay cursos, lecciones, notas ni acciones que coincidan con «${query.trim()}».`
            )
          ),

        // Handoff to full search, for users who find nothing here.
        query.trim() &&
          onSearchAll &&
          h(
            'div',
            { key: 'handoff', className: 'border-t border-line p-2' },
            h(
              'button',
              {
                type: 'button',
                onClick: () => {
                  onSearchAll(query);
                  onClose();
                },
                className:
                  'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition-colors duration-fast hover:bg-accent-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
              },
              h(
                'span',
                { className: 'min-w-0 truncate text-meta text-muted' },
                'Ver todos los resultados en la Biblioteca'
              ),
              h(CornerDownLeft, { size: 13, 'aria-hidden': 'true', className: 'shrink-0 text-faint' })
            )
          )
      ),

      // Footer: keyboard legend and result counter.
      h(
        'div',
        { key: 'pie', className: 'flex items-center justify-between gap-3 border-t border-line px-3 py-2' },
        h(
          'span',
          { className: 'flex items-center gap-2 text-micro text-faint' },
          h(
            'span',
            { key: 'nav', className: 'flex items-center gap-1' },
            h(
              Kbd,
              { key: 'kbd' },
              h(ArrowUp, { size: 10, 'aria-hidden': 'true' }),
              h(ArrowDown, { size: 10, 'aria-hidden': 'true' })
            ),
            'navegar'
          ),
          h('span', { key: 'abrir', className: 'flex items-center gap-1' }, h(Kbd, { key: 'kbd' }, 'Enter'), 'abrir'),
          h('span', { key: 'cerrar', className: 'flex items-center gap-1' }, h(Kbd, { key: 'kbd' }, 'Esc'), 'cerrar')
        ),
        h(
          'span',
          { key: 'conteo', 'aria-live': 'polite', className: 'shrink-0 text-micro text-faint' },
          results.length === 1 ? '1 resultado' : `${results.length} resultados`
        )
      )
    )
  );
}