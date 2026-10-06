import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Library,
  BrainCircuit,
  Network,
  FileText,
  Settings,
  Download,
  Bot,
  type LucideIcon,
  Landmark,
  Menu,
  Search,
  X,
  CalendarCheck,
  BarChart3,
  Target,
} from 'lucide-react';
import { exportSqliteFile } from '../../db/exportImport.ts';
import { ThemeToggle } from '../common/ThemeToggle.tsx';
import { PomodoroTimer } from '../common/PomodoroTimer.tsx';
import { Kbd, cn } from '../ui/index.tsx';

interface ShellProps {
  currentTab: string;
  onNavigate: (tab: string) => void;
  onOpenAI: () => void;
  /** Abre la paleta de comandos global (Ctrl+K / Cmd+K). */
  onOpenCommandPalette: () => void;
  /**
   * Estado de la paleta. El Shell no la monta, pero lo necesita: al abrirla hay
   * que cerrar el cajón de navegación móvil, porque los dos overlays se solaparían
   * y dos manejadores de Escape actuarían a la vez.
   */
  paletteOpen: boolean;
  children: React.ReactNode;
}

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'focus', label: 'Hoy', icon: CalendarCheck },
  { id: 'library', label: 'Biblioteca', icon: Library },
  { id: 'review', label: 'Repaso SM-2', icon: BrainCircuit },
  { id: 'goals', label: 'Metas', icon: Target },
  { id: 'analytics', label: 'Análisis', icon: BarChart3 },
  { id: 'graph', label: 'Grafo', icon: Network },
  { id: 'notes', label: 'Notas', icon: FileText },
  { id: 'settings', label: 'Ajustes', icon: Settings },
];

/**
 * Lenguaje visual compartido de la aplicación:
 * identidad, navegación primaria, disparador de la paleta de comandos, respaldo,
 * IA y cambio de tema, con jerarquía persistente. Sin router: la navegación sigue
 * siendo controlada por estado (`currentTab` / `onNavigate`).
 */
export const Shell: React.FC<ShellProps> = ({
  currentTab,
  onNavigate,
  onOpenAI,
  onOpenCommandPalette,
  paletteOpen,
  children,
}) => {
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  /** Rótulo del atajo acorde a la plataforma: ⌘K en Apple, Ctrl+K en el resto. */
  const isAppleLike =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent || '');

  // Abrir la paleta cierra el cajón móvil, venga el atajo o el clic. Antes solo lo
  // cerraba el clic, y con Ctrl+K en un móvil se quedaban los dos overlays vivos.
  useEffect(() => {
    if (paletteOpen) setIsMobileNavOpen(false);
  }, [paletteOpen]);

  // Escape cierra el navegador móvil.
  useEffect(() => {
    if (!isMobileNavOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMobileNavOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMobileNavOpen]);

  const isActive = (id: string) =>
    currentTab === id ||
    (id === 'library' && (currentTab === 'course_detail' || currentTab === 'resource_detail')) ||
    (id === 'notes' && currentTab === 'note_detail');

  const navList = (idPrefix: string) => (
    <nav aria-label="Navegación principal" className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon;
        const active = isActive(item.id);
        return (
          <button
            key={`${idPrefix}-${item.id}`}
            onClick={() => {
              onNavigate(item.id);
              setIsMobileNavOpen(false);
            }}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex items-center gap-3 rounded-lg px-3 py-2 text-secondary transition-colors duration-fast',
              active
                ? 'bg-accent-soft text-ink font-semibold'
                : 'text-muted hover:text-ink hover:bg-accent-soft/50'
            )}
          >
            {/* Indicador de activo: forma + posición, no solo color. */}
            <span
              aria-hidden="true"
              className={cn(
                'absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full transition-opacity',
                active ? 'bg-accent opacity-100' : 'opacity-0'
              )}
            />
            <Icon size={17} aria-hidden="true" />
            {item.label}
          </button>
        );
      })}
    </nav>
  );

  const brandButton = (
    <button
      onClick={() => onNavigate('dashboard')}
      className="flex items-center gap-2.5 text-left"
      aria-label="CrossedArts — ir al Dashboard"
    >
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-on-accent shadow-card">
        <Landmark size={18} aria-hidden="true" />
      </span>
      <span className="leading-tight">
        <span className="block font-serif text-item font-bold text-ink">CrossedArts</span>
        <span className="block text-micro text-faint">Sistema de aprendizaje</span>
      </span>
    </button>
  );

  const backupButton = (
    <button
      onClick={() => exportSqliteFile()}
      title="Exportar base de datos SQLite (.sqlite)"
      aria-label="Exportar base de datos SQLite (.sqlite)"
      className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line text-muted hover:text-ink hover:bg-accent-soft/60 transition-colors duration-fast"
    >
      <Download size={16} aria-hidden="true" />
    </button>
  );

  const aiButton = (
    <button
      onClick={onOpenAI}
      className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-3 text-on-accent text-secondary font-medium shadow-card hover:opacity-90 transition-opacity duration-fast"
    >
      <Bot size={16} aria-hidden="true" />
      <span className="hidden sm:inline">Tutor IA</span>
    </button>
  );

  /**
   * Disparador de la paleta de comandos.
   *
   * Sustituye a la antigua caja de búsqueda de la barra superior: el atajo es la
   * vía principal y el rótulo del atajo se muestra en la propia pastilla para que
   * la función sea descubrible sin documentación. En Apple se rotula ⌘K y en el
   * resto Ctrl+K, que es lo que el usuario puede pulsar de verdad.
   */
  const paletteTrigger = (
    <button
      type="button"
      onClick={() => {
        onOpenCommandPalette();
        setIsMobileNavOpen(false);
      }}
      aria-keyshortcuts={isAppleLike ? 'Meta+K' : 'Control+K'}
      // SIN aria-label a propósito (WCAG 2.5.3 "Label in Name"): el nombre
      // accesible debe contener el texto visible. Un `aria-label` como "Abrir la
      // paleta de comandos" lo reemplazaría y rompería el control por voz de
      // quien dijera "clic en Buscar o ir a". El atajo ya se anuncia con
      // `aria-keyshortcuts`.
      className="flex h-9 w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 text-meta text-faint transition-colors duration-fast hover:border-accent/50 hover:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
    >
      <Search size={15} aria-hidden="true" className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">Buscar o ir a…</span>
      <Kbd className="shrink-0">{isAppleLike ? '⌘K' : 'Ctrl K'}</Kbd>
    </button>
  );

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* --- Barra lateral fija (escritorio) --- */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-line bg-surface lg:flex">
        <div className="px-4 py-5">{brandButton}</div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">{navList('side')}</div>
        <div className="border-t border-line px-4 py-4">
          <p className="type-micro">Local · Sin conexión</p>
          <p className="type-meta mt-1 leading-relaxed">
            Tus datos viven en tu navegador (SQLite + IndexedDB).
          </p>
        </div>
      </aside>

      {/* --- Cajón de navegación (móvil / tableta) --- */}
      {isMobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink/40"
            onClick={() => setIsMobileNavOpen(false)}
            aria-hidden="true"
          />
          <div
            id="mobile-nav"
            className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-line bg-surface shadow-pop"
            role="dialog"
            aria-modal="true"
            aria-label="Navegación"
          >
            <div className="flex items-center justify-between px-4 py-4">
              {brandButton}
              <button
                autoFocus
                onClick={() => setIsMobileNavOpen(false)}
                aria-label="Cerrar navegación"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:text-ink"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 pb-4">{navList('drawer')}</div>
            <div className="border-t border-line p-3">{backupButton}</div>
          </div>
        </div>
      )}

      {/* --- Columna de contenido --- */}
      <div className="flex min-h-screen flex-col lg:pl-60">
        <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur-sm">
          <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
            <button
              onClick={() => setIsMobileNavOpen(true)}
              aria-label="Abrir navegación"
              aria-expanded={isMobileNavOpen}
              aria-controls="mobile-nav"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line text-muted hover:text-ink lg:hidden"
            >
              <Menu size={18} aria-hidden="true" />
            </button>

            <div className="hidden shrink-0 lg:block">{null}</div>

            <div className="min-w-0 flex-1">{paletteTrigger}</div>

            <div className="flex shrink-0 items-center gap-2">
              <PomodoroTimer />
              <span className="hidden sm:block">{backupButton}</span>
              {aiButton}
              <ThemeToggle compact />
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
};
