import React from 'react';
import { Search, X } from 'lucide-react';
import { cn } from './primitives.ts';

/**
 * `cn` y `Kbd` viven en `primitives.ts` (no aquí) porque un `.tsx` no puede
 * importarse desde el runner de pruebas. Se reexportan para no romper a los
 * consumidores que ya los importaban desde este módulo. Ver `primitives.ts`.
 */
export { cn, Kbd, ProgressBar, resolveProgress } from './primitives.ts';
export type { KbdProps, ProgressBarProps, ResolvedProgress } from './primitives.ts';

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

type ButtonVariant = 'solid' | 'outline' | 'quiet' | 'danger';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // El texto usa el token `text-on-accent`: en el tema oscuro el relleno de
  // acento es un púrpura claro y la tinta legible sobre él es oscura. El token
  // resuelve ambos temas y mantiene ≥4.5:1 en los dos.
  solid: 'bg-accent text-on-accent font-medium border border-transparent hover:opacity-90 shadow-card',
  outline: 'bg-surface text-ink border border-line-strong hover:bg-accent-soft/60',
  quiet: 'bg-transparent text-muted border border-transparent hover:bg-accent-soft/60 hover:text-ink',
  danger: 'bg-transparent text-error border border-error/40 hover:bg-error-soft',
};

/**
 * Estado deshabilitado por variante.
 *
 * Antes el botón deshabilitado se resolvía con `opacity-50` sobre TODO el
 * elemento: al atenuar también el texto, un botón sólido en tema oscuro quedaba
 * con texto oscuro sobre un púrpura translúcido (prácticamente ilegible).
 *
 * Ahora el estado deshabilitado usa una superficie y una tinta semánticas: la
 * acción deja de parecer primaria (sigue siendo inequívocamente "deshabilitada")
 * pero el texto conserva contraste real (≥4.5:1 en ambos temas, con los tokens
 * `line`/`muted`/`faint`). No se introducen colores literales y el estado
 * habilitado no cambia.
 */
const BUTTON_DISABLED: Record<ButtonVariant, string> = {
  solid: 'disabled:bg-line disabled:text-muted disabled:border-line disabled:shadow-none',
  outline: 'disabled:bg-surface disabled:text-muted disabled:border-line',
  quiet: 'disabled:bg-transparent disabled:text-faint',
  danger: 'disabled:bg-transparent disabled:text-muted disabled:border-line',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-meta rounded-md gap-1.5',
  md: 'h-9 px-4 text-secondary rounded-lg gap-2',
};

export const Button: React.FC<ButtonProps> = ({
  variant = 'outline',
  size = 'md',
  className,
  type = 'button',
  ...props
}) => (
  <button
    type={type}
    className={cn(
      'inline-flex items-center justify-center font-medium transition-all duration-fast active:scale-[0.98] select-none',
      // Sin atenuar el elemento completo: el estado deshabilitado se resuelve
      // por variante para no degradar el texto (ver BUTTON_DISABLED).
      'disabled:pointer-events-none disabled:active:scale-100',
      BUTTON_VARIANTS[variant],
      BUTTON_DISABLED[variant],
      BUTTON_SIZES[size],
      className
    )}
    {...props}
  />
);

/* -------------------------------------------------------------------------- */
/* Badge / Chip                                                                */
/* -------------------------------------------------------------------------- */

type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'info' | 'error';

interface BadgeProps {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
}

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'border-line bg-canvas text-muted',
  accent: 'border-accent/25 bg-accent-soft text-accent',
  success: 'border-success/25 bg-success-soft text-success',
  warning: 'border-warning/25 bg-warning-soft text-warning',
  info: 'border-info/25 bg-info-soft text-info',
  error: 'border-error/25 bg-error-soft text-error',
};

/** Píldora de estado: siempre acompaña al texto, nunca sustituye al color. */
export const Badge: React.FC<BadgeProps> = ({ tone = 'neutral', children, className }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-meta font-medium',
      BADGE_TONES[tone],
      className
    )}
  >
    {children}
  </span>
);

interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  children: React.ReactNode;
}

/**
 * Filtro o píldora seleccionable. El estado activo NO depende solo del color:
 * combina relleno, borde y peso tipográfico, y queda expuesto con aria-pressed.
 */
export const Chip: React.FC<ChipProps> = ({ active = false, className, children, type = 'button', ...props }) => (
  <button
    type={type}
    aria-pressed={active}
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-meta font-medium transition-all duration-fast active:scale-[0.97] select-none',
      active
        ? 'bg-ink text-canvas border-ink shadow-card'
        : 'bg-surface text-muted border-line hover:text-ink hover:border-line-strong',
      className
    )}
    {...props}
  >
    {children}
  </button>
);

/* -------------------------------------------------------------------------- */
/* SearchInput                                                                 */
/* -------------------------------------------------------------------------- */

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label: string;
  className?: string;
  /** Permite enviar con Enter para navegación global. */
  onSubmit?: () => void;
  autoFocus?: boolean;
}

/** Campo de búsqueda con etiqueta accesible y botón de borrado explícito. */
export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  placeholder = 'Buscar…',
  label,
  className,
  onSubmit,
  autoFocus,
}) => (
  <div className={cn('relative flex items-center', className)}>
    <label htmlFor={`search-${label.replace(/\s+/g, '-').toLowerCase()}`} className="sr-only">
      {label}
    </label>
    <Search
      size={15}
      aria-hidden="true"
      className="pointer-events-none absolute left-3 text-faint"
    />
    <input
      id={`search-${label.replace(/\s+/g, '-').toLowerCase()}`}
      type="search"
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && onSubmit) onSubmit();
      }}
      placeholder={placeholder}
      className={cn(
        'h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-8 text-secondary text-ink',
        'placeholder:text-faint focus:border-accent/50 focus:outline-none focus-visible:outline-none',
        'transition-colors duration-fast',
        className
      )}
    />
    {value && (
      <button
        type="button"
        aria-label="Borrar búsqueda"
        onClick={() => onChange('')}
        className="absolute right-2 text-faint hover:text-ink transition-colors"
      >
        <X size={14} aria-hidden="true" />
      </button>
    )}
  </div>
);

/* ProgressBar vive en ./primitives.ts (escrita con createElement) para que sus
 * valores ARIA y visuales puedan verificarse sobre el HTML renderizado desde el
 * runner de pruebas, que no puede importar `.tsx`. Se reexporta arriba. */

/* -------------------------------------------------------------------------- */
/* EmptyState                                                                  */
/* -------------------------------------------------------------------------- */

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  className?: string;
}

/** Estado vacío sobrio: contenido centrado sin tarjetas innecesarias. */
export const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, hint, action, className }) => (
  <div className={cn('flex flex-col items-center justify-center gap-2 py-14 text-center', className)}>
    {icon && <div className="mb-1 text-faint">{icon}</div>}
    <p className="type-section text-ink">{title}</p>
    {hint && <p className="type-secondary max-w-sm">{hint}</p>}
    {action && <div className="mt-3">{action}</div>}
  </div>
);

/* -------------------------------------------------------------------------- */
/* InlineStatus                                                                */
/* -------------------------------------------------------------------------- */

type StatusTone = 'success' | 'error' | 'info' | 'warning';

interface InlineStatusProps {
  tone?: StatusTone;
  children: React.ReactNode;
  className?: string;
}

const STATUS_TONES: Record<StatusTone, string> = {
  success: 'bg-success-soft border-success/30 text-success',
  error: 'bg-error-soft border-error/30 text-error',
  info: 'bg-info-soft border-info/30 text-info',
  warning: 'bg-warning-soft border-warning/30 text-warning',
};

/** Mensaje inline anunciado a lectores de pantalla (role=status). */
export const InlineStatus: React.FC<InlineStatusProps> = ({ tone = 'info', children, className }) => (
  <div
    role="status"
    aria-live="polite"
    className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-meta', STATUS_TONES[tone], className)}
  >
    {children}
  </div>
);

/* -------------------------------------------------------------------------- */
/* Panel / SectionHeading                                                      */
/* -------------------------------------------------------------------------- */

interface PanelProps {
  children: React.ReactNode;
  className?: string;
  as?: 'div' | 'section' | 'article';
}

/**
 * Superficie contenida. Úsese SOLO cuando un bloque necesita borde propio;
 * el resto de la interfaz vive sobre el lienzo con separadores sutiles.
 */
export const Panel: React.FC<PanelProps> = ({ children, className, as: Tag = 'div' }) => (
  <Tag className={cn('rounded-xl border border-line bg-surface shadow-card', className)}>{children}</Tag>
);

interface SectionHeadingProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export const SectionHeading: React.FC<SectionHeadingProps> = ({ title, description, action, className }) => (
  <div className={cn('mb-4 flex items-end justify-between gap-4', className)}>
    <div>
      <h2 className="type-section text-ink">{title}</h2>
      {description && <p className="type-meta mt-0.5">{description}</p>}
    </div>
    {action}
  </div>
);
