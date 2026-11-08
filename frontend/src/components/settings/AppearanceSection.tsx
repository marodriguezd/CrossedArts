import React from 'react';
import { Palette, Sun, Moon } from 'lucide-react';
import { SectionHeading } from '../ui/index.tsx';
import { useLanguage } from '../../hooks/useLanguage.ts';
import { AUTO_LANGUAGE, SUPPORTED_LANGUAGES } from '../../i18n/languages.ts';
import { getTheme, setTheme, type ThemeMode } from '../../services/theme.ts';

export interface AppearanceSectionProps {
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}

export const ThemeToggle: React.FC = () => {
  const [currentTheme, setCurrentTheme] = React.useState<ThemeMode>(getTheme());

  const handleSelect = (mode: ThemeMode) => {
    setTheme(mode);
    setCurrentTheme(mode);
  };

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className="inline-flex rounded-lg border border-line bg-canvas p-1"
    >
      <button
        type="button"
        role="radio"
        aria-checked={currentTheme === 'light'}
        onClick={() => handleSelect('light')}
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-meta font-medium transition-colors ${
          currentTheme === 'light'
            ? 'bg-surface text-ink shadow-sm'
            : 'text-muted hover:text-ink'
        }`}
      >
        <Sun size={14} aria-hidden="true" />
        <span>Claro</span>
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={currentTheme === 'dark'}
        onClick={() => handleSelect('dark')}
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-meta font-medium transition-colors ${
          currentTheme === 'dark'
            ? 'bg-surface text-ink shadow-sm'
            : 'text-muted hover:text-ink'
        }`}
      >
        <Moon size={14} aria-hidden="true" />
        <span>Oscuro</span>
      </button>
    </div>
  );
};

export const AppearanceSection: React.FC<AppearanceSectionProps> = () => {
  const { t, language, setLanguage } = useLanguage();

  return (
    <div className="space-y-6">
      <section aria-labelledby="settings-theme" className="space-y-4">
        <SectionHeading
          id="settings-theme"
          title="Apariencia"
          description="El tema se guarda localmente y se aplica antes de la primera carga."
        />
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface p-5 shadow-card">
          <div className="flex items-start gap-3">
            <Palette size={17} className="mt-0.5 text-accent" aria-hidden="true" />
            <div>
              <p className="text-item text-ink">Tema de la aplicación</p>
              <p className="type-meta mt-0.5 max-w-md">
                <strong className="text-muted">Claro (crema)</strong> es el tema por defecto:{' '}
                superficies cálidas, tinta carbón y acento ciruela contenido.{' '}
                <strong className="text-muted">Oscuro (carbón)</strong> es bajo en saturación y brillo,
                sin negros puros ni morados neón.
              </p>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </section>

      <section aria-labelledby="settings-language" className="space-y-4">
        <SectionHeading
          id="settings-language"
          title={t('settings.language.title')}
          description={t('settings.language.desc')}
        />
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-line bg-surface p-5 shadow-card">
          <label className="text-item text-ink" htmlFor="app-language">
            {t('settings.language.title')}
          </label>
          <select
            id="app-language"
            value={language}
            onChange={(e) => setLanguage(e.target.value as typeof language)}
            className="rounded-lg border border-line bg-canvas px-3 py-2 text-secondary text-ink"
          >
            <option value={AUTO_LANGUAGE}>{t('settings.language.auto')}</option>
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.nativeName}
              </option>
            ))}
          </select>
        </div>
      </section>
    </div>
  );
};
