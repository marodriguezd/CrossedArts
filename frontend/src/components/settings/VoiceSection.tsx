import React from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import type { SpeechSettings } from '../../services/speechService.ts';
import { Button, SectionHeading, cn, INPUT_CLS } from '../ui/index.tsx';

const LABEL_CLS = 'block text-meta font-medium text-ink mb-1';

export interface VoiceSectionProps {
  speechConfig: SpeechSettings;
  availableVoices: SpeechSynthesisVoice[];
  onUpdateSpeech: (patch: Partial<SpeechSettings>) => void;
  onTestVoice: () => void;
  isTestingVoice: boolean;
}

export const VoiceSection: React.FC<VoiceSectionProps> = ({
  speechConfig,
  availableVoices,
  onUpdateSpeech,
  onTestVoice,
  isTestingVoice,
}) => {
  return (
    <section aria-labelledby="settings-speech" className="space-y-4">
      <SectionHeading
        id="settings-speech"
        title="Audio y Accesibilidad por Voz"
        description="Lectura en voz alta de tarjetas/notas y dictado continuo 100% en tu navegador (Web Speech API)."
      />

      <div className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={LABEL_CLS} htmlFor="speech-rate">
              Velocidad de habla ({speechConfig.rate}x)
            </label>
            <div className="flex items-center gap-2">
              {[0.8, 1.0, 1.25, 1.5].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => onUpdateSpeech({ rate: r })}
                  className={cn(
                    'px-3 py-1.5 rounded-lg border text-meta transition-colors cursor-pointer',
                    speechConfig.rate === r
                      ? 'border-accent bg-accent-soft font-semibold text-accent'
                      : 'border-line bg-canvas text-muted hover:text-ink'
                  )}
                >
                  {r}x
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className={LABEL_CLS} htmlFor="speech-voice">
              Voz del sistema operativo
            </label>
            <select
              id="speech-voice"
              value={speechConfig.voiceUri || ''}
              onChange={(e) => onUpdateSpeech({ voiceUri: e.target.value })}
              className={INPUT_CLS}
            >
              <option value="">Automática / Predeterminada</option>
              {availableVoices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={speechConfig.autoReadFlashcards}
              onChange={(e) => onUpdateSpeech({ autoReadFlashcards: e.target.checked })}
              className="w-4 h-4 rounded border-line accent-accent"
            />
            <span className="text-secondary text-ink">
              Auto-reproducir audio de tarjetas en el Centro de Repaso
            </span>
          </label>

          <Button
            size="sm"
            variant="outline"
            type="button"
            onClick={onTestVoice}
            disabled={isTestingVoice}
          >
            {isTestingVoice ? (
              <VolumeX size={14} className="text-accent animate-pulse" />
            ) : (
              <Volume2 size={14} />
            )}
            <span>{isTestingVoice ? 'Reproduciendo…' : 'Probar voz'}</span>
          </Button>
        </div>
      </div>
    </section>
  );
};
