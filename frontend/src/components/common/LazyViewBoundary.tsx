import React from 'react';
import { AlertTriangle, RefreshCw, RotateCcw } from 'lucide-react';
import { Button } from '../ui/index.tsx';
import { useLanguage } from '../../hooks/useLanguage.ts';
import { clearShellCaches, isChunkLoadError } from '../../services/serviceWorker.ts';

interface LazyViewBoundaryProps {
  children: React.ReactNode;
  /**
   * Changing it clears a previous failure: navigating to another view gives the
   * dynamic import a fresh chance instead of keeping the whole tab broken.
   */
  resetKey?: string;
  onReload?: () => void;
}

interface LazyViewBoundaryState {
  error: Error | null;
}

interface LazyViewErrorFallbackProps {
  error: Error;
  onRetry: () => void;
  onReload: () => void;
}

const LazyViewErrorFallback: React.FC<LazyViewErrorFallbackProps> = ({ error, onRetry, onReload }) => {
  const { t } = useLanguage();
  const chunkFailure = isChunkLoadError(error);

  return (
    <div
      role="alert"
      className="mx-auto flex w-full max-w-lg flex-col items-center gap-4 rounded-xl border border-error/30 bg-surface p-6 text-center shadow-card"
    >
      <AlertTriangle size={28} className="text-error" aria-hidden="true" />
      <div className="space-y-2">
        <h2 className="type-display text-ink">{t('app.viewErrorTitle')}</h2>
        <p className="text-body leading-relaxed text-muted">{t('app.viewErrorBody')}</p>
        <p className="text-meta break-words text-faint">{error.message}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {chunkFailure ? (
          <Button variant="solid" onClick={onReload}>
            <RefreshCw size={15} aria-hidden="true" />
            {t('app.viewErrorReload')}
          </Button>
        ) : (
          <Button variant="solid" onClick={onRetry}>
            <RotateCcw size={15} aria-hidden="true" />
            {t('app.viewErrorRetry')}
          </Button>
        )}
        {chunkFailure && (
          <Button variant="outline" onClick={onRetry}>
            {t('app.viewErrorRetry')}
          </Button>
        )}
      </div>
    </div>
  );
};

/**
 * Error boundary for the lazily loaded views.
 *
 * A failed dynamic `import()` used to unmount the whole app and leave a blank
 * page. When the failure is a missing chunk (the open tab outlived its deploy),
 * the shell cache is cleared first so the reload really fetches the current
 * deployment instead of replaying the stale one.
 */
export class LazyViewBoundary extends React.Component<LazyViewBoundaryProps, LazyViewBoundaryState> {
  state: LazyViewBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): LazyViewBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('Fallo al renderizar una vista perezosa:', error, info.componentStack);
  }

  componentDidUpdate(prevProps: LazyViewBoundaryProps): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
  };

  private handleReload = (): void => {
    const reload = this.props.onReload ?? (() => {
      if (typeof window !== 'undefined') window.location.reload();
    });
    // Clearing first turns "reload keeps replaying the stale shell" into a real
    // fetch of the current deployment.
    void clearShellCaches().finally(reload);
  };

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <LazyViewErrorFallback
        error={this.state.error}
        onRetry={this.handleRetry}
        onReload={this.handleReload}
      />
    );
  }
}
