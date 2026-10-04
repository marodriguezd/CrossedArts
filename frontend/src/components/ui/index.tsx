import React from 'react';
import clsx, { type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Search, X } from 'lucide-react';

/** Combina clases condicionales sin perder los overrides de tailwind-merge. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/* -------------------------------------------------------------------------- */
/* Button / IconButton                                                         */
/* -------------------------------------------------------------------------- */

type ButtonVariant = 'solid' | 'outline' | 'quiet' | 'danger';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  solid: 'bg-accent text-on-accent border border-transparent hover:opacity-90 shadow-card',
  outline: 'bg-surface text-ink border border-line-strong hover:bg-accent-soft/60',
  quiet: 'bg-transparent text-muted border border-transparent hover:bg-accent-soft/60 hover:text-ink',
  danger: 'bg-transparent text-error border border-error/40 hover:bg-error-soft',
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
      'inline-flex items-center justify-center font-medium transition-colors duration-fast',
      'disabled:opacity-50 disabled:pointer-events-none',
      BUTTON_VARIANTS[variant],
      BUTTON_SIZES[size],
      className
    )}
    {...props}
  />
);

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Nombre accesible obligatorio: los iconos solos nunca quedan sin etiqueta. */
  label: string;
}

export const IconButton: React.FC<IconButtonProps> = ({ label, className, type = 'button', ...props }) => (
  <button
    type={type}
    aria-label={label}
    title={label}
    className={cn(
      'inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line',
      'text-muted hover:text-ink hover:bg-accent-soft/60 transition-colors duration-fast',
      'disabled:opacity-50',
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
      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-meta font-medium transition-colors duration-fast',
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

/* -------------------------------------------------------------------------- */
/* ProgressBar                                                                 */
/* -------------------------------------------------------------------------- */

interface ProgressBarProps {
  value: number;
  max?: number;
  label: string;
  className?: string;
  tone?: 'accent' | 'success';
}

/** Progreso con estado accesible completo (valor, rango y etiqueta). */
export const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max = 100,
  label,
  className,
  tone = 'accent',
}) => {
  const safeMax = max > 0 ? max : 100;
  const pct = Math.min(100, Math.max(0, Math.round((value / safeMax) * 100)));
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-label={label}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-line', className)}
    >
      <div
        className={cn('h-full rounded-full transition-[width] duration-base', tone === 'success' ? 'bg-success' : 'bg-accent')}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
};

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
/* Panel / SectionHeading / MetadataRow                                        */
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

interface MetadataRowProps {
  label: string;
  children: React.ReactNode;
  className?: string;
}

/** Fila de metadatos discreta: etiqueta apagada + valor con más presencia. */
export const MetadataRow: React.FC<MetadataRowProps> = ({ label, children, className }) => (
  <div className={cn('flex items-baseline justify-between gap-3 py-1.5 text-meta', className)}>
    <dt className="text-faint">{label}</dt>
    <dd className="text-right text-muted font-medium">{children}</dd>
  </div>
);

/* -------------------------------------------------------------------------- */
/* Kbd (Atajo de teclado visual)                                              */
/* -------------------------------------------------------------------------- */

interface KbdProps {
  children: React.ReactNode;
  className?: string;
}

export const Kbd: React.FC<KbdProps> = ({ children, className }) => (
  <kbd
    className={cn(
      'inline-flex items-center justify-center rounded border border-line-strong bg-canvas px-1.5 py-0.5 font-mono text-micro font-semibold text-muted shadow-sm',
      className
    )}
  >
    {children}
  </kbd>
);

