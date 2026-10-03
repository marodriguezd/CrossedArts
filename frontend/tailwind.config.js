/** @type {import('tailwindcss').Config} */

/**
 * CrossedArts — Configuración de diseño.
 *
 * Los colores semánticos se resuelven desde variables CSS definidas en
 * `src/index.css` (tema claro/crema por defecto + tema oscuro/carbón bajo
 * `[data-theme="dark"]`). De esta forma los modificadores de opacidad
 * (`bg-accent/10`) funcionan y ningún componente necesita colores literales.
 */
const semantic = (token) => `rgb(var(${token}) / <alpha-value>)`;

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: semantic('--c-canvas'),
        surface: semantic('--c-surface'),
        raised: semantic('--c-raised'),
        line: semantic('--c-line'),
        'line-strong': semantic('--c-line-strong'),
        ink: semantic('--c-ink'),
        muted: semantic('--c-muted'),
        faint: semantic('--c-faint'),
        accent: semantic('--c-accent'),
        'accent-soft': semantic('--c-accent-soft'),
        'on-accent': semantic('--c-on-accent'),
        success: semantic('--c-success'),
        'success-soft': semantic('--c-success-soft'),
        warning: semantic('--c-warning'),
        'warning-soft': semantic('--c-warning-soft'),
        error: semantic('--c-error'),
        'error-soft': semantic('--c-error-soft'),
        info: semantic('--c-info'),
        'info-soft': semantic('--c-info-soft'),
        focus: semantic('--c-focus'),
        // Identidad heredada: se conserva solo como referencia puntual del
        // producto, nunca como paleta dominante.
        brand: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
        },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', "'Segoe UI'", 'Roboto', "'Helvetica Neue'", 'Arial', 'sans-serif'],
        serif: ["'Iowan Old Style'", "'Palatino Linotype'", 'Palatino', 'Georgia', 'Cambria', "'Times New Roman'", 'serif'],
      },
      fontSize: {
        // Escala tipográfica semántica: display, título de página, sección,
        // título de recurso, cuerpo, secundario, metadato y micro-etiqueta.
        display: ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.02em' }],
        title: ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.015em' }],
        section: ['1.0625rem', { lineHeight: '1.5rem' }],
        item: ['0.9375rem', { lineHeight: '1.375rem' }],
        body: ['0.9375rem', { lineHeight: '1.65' }],
        secondary: ['0.8125rem', { lineHeight: '1.4' }],
        meta: ['0.75rem', { lineHeight: '1.125rem' }],
        micro: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.08em' }],
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
        header: 'var(--shadow-header)',
      },
      transitionDuration: {
        fast: '140ms',
        base: '220ms',
      },
    },
  },
  plugins: [],
}
