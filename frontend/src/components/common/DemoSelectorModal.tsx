import React, { useState } from 'react';
import {
  Sparkles,
  Brain,
  BookOpen,
  Trash2,
  X,
  CheckCircle2,
  AlertTriangle,
  Loader2
} from 'lucide-react';
import { ModalShell } from '../ui/ModalShell.tsx';
import { Button, Badge, InlineStatus } from '../ui/index.tsx';
import { ConfirmDialog } from './ConfirmDialog.tsx';
import { useLanguage } from '../../hooks/useLanguage.ts';
import { DEMO_PRESETS_META, type DemoPresetId } from '../../db/demoPresets.ts';

export interface DemoSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectPreset: (presetId: DemoPresetId) => Promise<void>;
  onResetClean: () => Promise<void>;
  hasExistingData?: boolean;
}

const PRESET_ICONS: Record<DemoPresetId, React.ReactNode> = {
  full: <Sparkles size={18} className="text-accent" aria-hidden="true" />,
  ai_data: <Brain size={18} className="text-accent" aria-hidden="true" />,
  reading: <BookOpen size={18} className="text-accent" aria-hidden="true" />,
};

export const DemoSelectorModal: React.FC<DemoSelectorModalProps> = ({
  isOpen,
  onClose,
  onSelectPreset,
  onResetClean,
  hasExistingData = false,
}) => {
  const { t } = useLanguage();
  const [selectedPresetToLoad, setSelectedPresetToLoad] = useState<DemoPresetId | null>(null);
  const [isCleanConfirmOpen, setIsCleanConfirmOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handlePresetClick = async (presetId: DemoPresetId) => {
    if (hasExistingData) {
      setSelectedPresetToLoad(presetId);
    } else {
      await executeLoadPreset(presetId);
    }
  };

  const executeLoadPreset = async (presetId: DemoPresetId) => {
    try {
      setIsLoading(true);
      setFeedback(null);
      await onSelectPreset(presetId);
      setSelectedPresetToLoad(null);
      onClose();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Error' });
    } finally {
      setIsLoading(false);
    }
  };

  const executeClean = async () => {
    try {
      setIsLoading(true);
      setFeedback(null);
      await onResetClean();
      setIsCleanConfirmOpen(false);
      onClose();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Error' });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <ModalShell
        isOpen={isOpen}
        onClose={onClose}
        maxWidth="2xl"
        titleId="demo-selector-title"
        descriptionId="demo-selector-desc"
      >
        <div className="flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="demo-selector-title" className="type-title text-ink">
                {t('presets.modalTitle')}
              </h2>
              <p id="demo-selector-desc" className="type-secondary mt-1">
                {t('presets.modalDesc')}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-muted hover:bg-canvas hover:text-ink transition-colors"
              aria-label={t('shell.closeNav')}
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          {feedback && (
            <InlineStatus tone={feedback.type === 'success' ? 'success' : 'error'}>
              {feedback.type === 'success' ? (
                <CheckCircle2 size={15} className="shrink-0" aria-hidden="true" />
              ) : (
                <AlertTriangle size={15} className="shrink-0" aria-hidden="true" />
              )}
              <span>{feedback.text}</span>
            </InlineStatus>
          )}

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            {DEMO_PRESETS_META.map((meta) => (
              <div
                key={meta.id}
                className="flex flex-col justify-between rounded-xl border border-line bg-canvas p-4 text-left transition-all hover:border-accent/40 shadow-sm"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface">
                      {PRESET_ICONS[meta.id]}
                    </span>
                    <Badge tone="accent">{t(meta.badgeKey as any)}</Badge>
                  </div>
                  <h3 className="type-section mt-3 text-ink">{t(meta.titleKey as any)}</h3>
                  <p className="type-secondary mt-1.5 line-clamp-3 text-xs leading-relaxed">
                    {t(meta.descKey as any)}
                  </p>
                </div>

                <div className="mt-4 border-t border-line/60 pt-3">
                  <div className="flex flex-wrap gap-x-2 gap-y-1 text-meta text-muted text-[11px] mb-3">
                    {meta.courseCount > 0 && <span>{t('presets.coursesCount', { n: meta.courseCount })}</span>}
                    {meta.bookCount > 0 && <span>{t('presets.booksCount', { n: meta.bookCount })}</span>}
                    {meta.flashcardCount > 0 && <span>{t('presets.flashcardsCount', { n: meta.flashcardCount })}</span>}
                  </div>
                  <Button
                    variant="solid"
                    size="sm"
                    className="w-full justify-center"
                    disabled={isLoading}
                    onClick={() => void handlePresetClick(meta.id)}
                  >
                    {isLoading ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : null}
                    {t('presets.loadAction')}
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-line/80 bg-surface p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-canvas text-muted">
                <Trash2 size={16} aria-hidden="true" />
              </span>
              <div>
                <h4 className="type-section text-sm text-ink">{t('presets.cleanTitle')}</h4>
                <p className="type-secondary text-xs">{t('presets.cleanDesc')}</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 text-error border-error/40 hover:bg-error/10"
              disabled={isLoading}
              onClick={() => setIsCleanConfirmOpen(true)}
            >
              {t('presets.cleanAction')}
            </Button>
          </div>
        </div>
      </ModalShell>

      <ConfirmDialog
        isOpen={selectedPresetToLoad !== null}
        title={t('presets.loadConfirmTitle')}
        consequence={t('presets.loadConfirmConsequence')}
        confirmLabel={t('presets.loadAction')}
        onCancel={() => setSelectedPresetToLoad(null)}
        onConfirm={() => {
          if (selectedPresetToLoad) {
            void executeLoadPreset(selectedPresetToLoad);
          }
        }}
      />

      <ConfirmDialog
        isOpen={isCleanConfirmOpen}
        title={t('presets.cleanConfirmTitle')}
        consequence={t('presets.cleanConfirmConsequence')}
        confirmLabel={t('presets.cleanAction')}
        onCancel={() => setIsCleanConfirmOpen(false)}
        onConfirm={() => void executeClean()}
      />
    </>
  );
};
