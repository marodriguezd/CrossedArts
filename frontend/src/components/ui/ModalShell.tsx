import React from 'react';
import { cn } from './primitives.ts';

export interface ModalShellProps {
  isOpen: boolean;
  onClose?: () => void;
  titleId?: string;
  descriptionId?: string;
  className?: string;
  backdropClassName?: string;
  children: React.ReactNode;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl';
  zIndex?: 'z-50' | 'z-[60]' | 'z-[70]';
  'aria-label'?: string;
}

const MAX_WIDTHS = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
};

/**
 * Standard accessible modal dialog wrapper.
 * Encapsulates the backdrop blur, standard z-index, accessibility roles and modal container styles.
 */
export const ModalShell: React.FC<ModalShellProps> = ({
  isOpen,
  onClose,
  titleId,
  descriptionId,
  className,
  backdropClassName,
  children,
  maxWidth = 'lg',
  zIndex = 'z-50',
  'aria-label': ariaLabel,
}) => {
  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) {
          onClose();
        }
      }}
      className={cn(
        'fixed inset-0 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm',
        zIndex,
        backdropClassName
      )}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-label={ariaLabel}
        className={cn(
          'w-full rounded-2xl border border-line bg-surface p-6 shadow-pop',
          MAX_WIDTHS[maxWidth],
          className
        )}
      >
        {children}
      </div>
    </div>
  );
};
