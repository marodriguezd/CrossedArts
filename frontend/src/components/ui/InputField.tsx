import React from 'react';
import { cn } from './primitives.ts';

export const INPUT_CLS =
  'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-body text-ink placeholder:text-faint focus:border-accent/50 focus:outline-none disabled:opacity-50 transition-colors duration-fast';

export interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const InputField = React.forwardRef<HTMLInputElement, InputFieldProps>(
  ({ label, error, helperText, className, id, ...props }, ref) => {
    return (
      <div className="w-full space-y-1">
        {label && (
          <label htmlFor={id} className="block text-meta font-medium text-ink">
            {label}
          </label>
        )}
        <input
          id={id}
          ref={ref}
          className={cn(INPUT_CLS, error && 'border-error focus:border-error', className)}
          {...props}
        />
        {error && <p className="text-micro text-error">{error}</p>}
        {helperText && !error && <p className="text-micro text-muted">{helperText}</p>}
      </div>
    );
  }
);
InputField.displayName = 'InputField';

export interface TextareaFieldProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const TextareaField = React.forwardRef<HTMLTextAreaElement, TextareaFieldProps>(
  ({ label, error, helperText, className, id, ...props }, ref) => {
    return (
      <div className="w-full space-y-1">
        {label && (
          <label htmlFor={id} className="block text-meta font-medium text-ink">
            {label}
          </label>
        )}
        <textarea
          id={id}
          ref={ref}
          className={cn(INPUT_CLS, error && 'border-error focus:border-error', className)}
          {...props}
        />
        {error && <p className="text-micro text-error">{error}</p>}
        {helperText && !error && <p className="text-micro text-muted">{helperText}</p>}
      </div>
    );
  }
);
TextareaField.displayName = 'TextareaField';

export interface SelectFieldProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const SelectField = React.forwardRef<HTMLSelectElement, SelectFieldProps>(
  ({ label, error, helperText, className, id, children, ...props }, ref) => {
    return (
      <div className="w-full space-y-1">
        {label && (
          <label htmlFor={id} className="block text-meta font-medium text-ink">
            {label}
          </label>
        )}
        <select
          id={id}
          ref={ref}
          className={cn(INPUT_CLS, error && 'border-error focus:border-error', className)}
          {...props}
        >
          {children}
        </select>
        {error && <p className="text-micro text-error">{error}</p>}
        {helperText && !error && <p className="text-micro text-muted">{helperText}</p>}
      </div>
    );
  }
);
SelectField.displayName = 'SelectField';
