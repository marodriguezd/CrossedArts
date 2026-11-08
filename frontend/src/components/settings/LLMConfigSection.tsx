import React from 'react';
import {
  AlertTriangle,
  Cpu,
  Info,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { AISettings } from '../../ai/aiService.ts';
import type { LocalAiStatus } from '../../services/localAiRuntime.ts';
import type { WebGPUCapabilityReport } from '../../lib/localLlm/capabilities.ts';
import { WebGpuDiagnosticGuide } from '../ai/WebGpuDiagnosticGuide.tsx';
import { Badge, Button, SectionHeading, INPUT_CLS } from '../ui/index.tsx';
import { useLanguage } from '../../hooks/useLanguage.ts';

import type { EngineStatus } from '../../lib/localLlm/engine.ts';

const LABEL_CLS = 'block text-meta font-medium text-ink mb-1';

export interface LLMConfigSectionProps {
  aiConfig: AISettings;
  onAiConfigChange: (config: AISettings) => void;
  onProviderChange: (provider: any) => void;
  runtimeStatus: LocalAiStatus;
  engineStatus: EngineStatus;
  onActivateLocalAi: () => Promise<void>;
  gpuReport: WebGPUCapabilityReport;
  onGpuReportChange: (report: WebGPUCapabilityReport) => void;
  loadedModel: string | null;
  onReleaseMemory: () => Promise<void>;
  onTryLlama: () => void;
  onSwitchToWasm: () => void;
}

export const LLMConfigSection: React.FC<LLMConfigSectionProps> = ({
  aiConfig,
  onAiConfigChange,
  onProviderChange,
  runtimeStatus,
  engineStatus,
  onActivateLocalAi,
  gpuReport,
  onGpuReportChange,
  loadedModel,
  onReleaseMemory,
  onTryLlama,
  onSwitchToWasm,
}) => {
  const { t } = useLanguage();

  return (
    <div className="space-y-4" aria-labelledby="settings-ai">
      <SectionHeading
        id="settings-ai"
        title="Tutor IA y proveedores"
        description="Elige el motor de inferencia. La privacidad depende del proveedor seleccionado."
      />

      <div className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
        <div>
          <label className={LABEL_CLS} htmlFor="ai-provider">
            Proveedor de inferencia activo
          </label>
          <select
            id="ai-provider"
            value={aiConfig.provider}
            onChange={(e) => onProviderChange(e.target.value)}
            className={INPUT_CLS}
          >
            <option value="demo">Modo demostración / heurístico (sin conexión)</option>
            <option value="local">
              IA local en navegador (WebGPU / CPU WASM, 100% en el dispositivo)
            </option>
            <option value="ollama">Ollama local (http://localhost:11434)</option>
            <option value="openai">OpenAI API (GPT-4o / GPT-4o-mini)</option>
          </select>
          <p className="type-meta mt-1.5">
            {aiConfig.provider === 'demo' && t('settings.providerDemoNote')}
            {aiConfig.provider === 'local' && t('settings.providerLocalNote')}
            {aiConfig.provider === 'ollama' && t('settings.providerOllamaNote')}
            {aiConfig.provider === 'openai' && t('settings.providerOpenaiNote')}
          </p>
        </div>

        {aiConfig.provider === 'local' && (
          <div className="space-y-3 rounded-lg border border-accent/30 bg-accent-soft/40 p-4">
            <div className="rounded-lg border border-line bg-surface p-3" role="status" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-meta font-semibold text-ink">IA local</span>
                <Badge
                  tone={
                    runtimeStatus.stage === 'ready'
                      ? 'success'
                      : runtimeStatus.stage === 'unsupported' || runtimeStatus.stage === 'error'
                        ? 'error'
                        : 'info'
                  }
                >
                  {runtimeStatus.stage === 'ready'
                    ? t('settings.runtimeReady')
                    : runtimeStatus.stage === 'unsupported'
                      ? t('settings.runtimeUnsupported')
                      : runtimeStatus.stage === 'consent-required'
                        ? t('settings.runtimeConsent')
                        : runtimeStatus.stage === 'error'
                          ? t('settings.runtimeError')
                          : runtimeStatus.stage === 'idle'
                            ? t('settings.runtimeIdle')
                            : t('settings.runtimePreparing')}
                </Badge>
              </div>
              <p className="mt-1 text-secondary text-muted">{runtimeStatus.message}</p>
              {runtimeStatus.stage !== 'ready' && runtimeStatus.stage !== 'unsupported' && (
                <div className="mt-2">
                  <Button
                    size="sm"
                    variant="solid"
                    disabled={engineStatus === 'loading'}
                    onClick={() => void onActivateLocalAi()}
                  >
                    {runtimeStatus.stage === 'consent-required'
                      ? 'Activar IA local'
                      : 'Preparar IA local'}
                  </Button>
                </div>
              )}
              {runtimeStatus.errorAction && (
                <p className="mt-1 text-micro text-muted">{runtimeStatus.errorAction}</p>
              )}
            </div>

            <WebGpuDiagnosticGuide
              initialReport={gpuReport}
              onCapabilityChange={onGpuReportChange}
              className="mt-2"
            />

            <div className="space-y-2">
              <label className={LABEL_CLS} htmlFor="local-model">
                Modelo de lenguaje seleccionado
              </label>
              <select
                id="local-model"
                value={aiConfig.localModelId}
                onChange={(e) =>
                  onAiConfigChange({ ...aiConfig, localModelId: e.target.value })
                }
                disabled={gpuReport.state !== 'supported' && !gpuReport.hasWasmFallback}
                className={INPUT_CLS}
              >
                <optgroup label={t('settings.multilingualGroup')}>
                  <option value="Llama-3.2-1B-Instruct-q4f16_1-MLC">
                    Llama 3.2 1B Instruct (Recomendado ES/Multilingüe · ~880 MB)
                  </option>
                  <option value="Llama-3.2-3B-Instruct-q4f16_1-MLC">
                    Llama 3.2 3B Instruct (Alta precisión ES · ~2.1 GB)
                  </option>
                  <option value="Qwen2.5-1.5B-Instruct-q4f16_1-MLC">
                    Qwen 2.5 1.5B Instruct (Razonamiento / Código · ~1.1 GB)
                  </option>
                </optgroup>
                <optgroup label="Modelos compactos (EN / baja memoria)">
                  <option value="SmolLM2-360M-Instruct-q4f16_1-MLC">
                    SmolLM2 360M (Ultrasónico · ~380 MB)
                  </option>
                </optgroup>
              </select>

              <div className="flex items-start gap-2 rounded-lg border border-line bg-canvas p-2.5 text-meta text-muted">
                <Info size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                <div className="space-y-1">
                  <p>
                    {t('settings.modelDisclaimer', {
                      model: aiConfig.localModelId || 'Llama 3.2 1B'
                    })}
                  </p>
                  <p className="text-micro text-muted">
                    <strong className="text-ink">Descarga y persistencia en caché:</strong> Una vez descargados los pesos del modelo, el navegador los guarda en su caché HTTP (Cache Storage) para operar 100% sin conexión. Los vectores semánticos residen de forma separada en IndexedDB.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 pt-2 text-meta">
              <span className="text-muted">
                Estado del motor:{' '}
                <strong className="text-ink">
                  {engineStatus === 'ready'
                    ? `Cargado (${loadedModel || 'desconocido'})`
                    : engineStatus === 'loading'
                      ? 'Cargando pesos en memoria…'
                      : engineStatus === 'error'
                        ? 'Error al inicializar el modelo local'
                        : 'No cargado en memoria RAM'}
                </strong>
              </span>
              {engineStatus === 'ready' && (
                <Button size="sm" variant="quiet" onClick={() => void onReleaseMemory()}>
                  <Trash2 size={13} aria-hidden="true" /> Liberar memoria
                </Button>
              )}
            </div>

            {engineStatus === 'error' && (
              <div className="space-y-2 rounded-lg border border-error/30 bg-error-soft p-3 text-meta text-error">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0 text-error" aria-hidden="true" />
                  <div>
                    <strong className="block text-ink">Fallo al inicializar el modelo local</strong>
                    <p className="mt-0.5 text-muted">
                      El navegador no pudo compilar los shaders de WebGPU o el modelo seleccionado
                      excede la memoria disponible.
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button size="sm" variant="outline" onClick={onTryLlama}>
                    Probar con Llama 3.2 1B (WebGPU)
                  </Button>
                  <Button size="sm" variant="outline" onClick={onSwitchToWasm}>
                    <Cpu size={13} aria-hidden="true" /> Cambiar a CPU / WASM
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {aiConfig.provider === 'ollama' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className={LABEL_CLS} htmlFor="ollama-url">
                URL de Ollama
              </label>
              <input
                id="ollama-url"
                type="text"
                value={aiConfig.ollamaUrl}
                onChange={(e) =>
                  onAiConfigChange({ ...aiConfig, ollamaUrl: e.target.value })
                }
                placeholder="http://localhost:11434"
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS} htmlFor="ollama-model">
                Modelo de Ollama
              </label>
              <input
                id="ollama-model"
                type="text"
                value={aiConfig.ollamaModel}
                onChange={(e) =>
                  onAiConfigChange({ ...aiConfig, ollamaModel: e.target.value })
                }
                placeholder="llama3:8b"
                className={INPUT_CLS}
              />
            </div>
          </div>
        )}

        {aiConfig.provider === 'openai' && (
          <div className="space-y-3">
            <div>
              <label className={LABEL_CLS} htmlFor="openai-key">
                Clave de API de OpenAI
              </label>
              <input
                id="openai-key"
                type="password"
                value={aiConfig.apiKey}
                onChange={(e) =>
                  onAiConfigChange({ ...aiConfig, apiKey: e.target.value })
                }
                placeholder="sk-..."
                autoComplete="off"
                spellCheck={false}
                className={INPUT_CLS}
              />
              <p className="type-micro text-meta mt-1.5">
                {aiConfig.apiKey ? t('settings.apiKeySet') : t('settings.apiKeyMemory')}
              </p>
            </div>

            <label className="flex items-start gap-2 rounded-lg border border-line bg-canvas px-3 py-2.5 text-meta text-muted">
              <input
                type="checkbox"
                checked={aiConfig.persistApiKey === true}
                onChange={(e) =>
                  onAiConfigChange({ ...aiConfig, persistApiKey: e.target.checked })
                }
                className="mt-0.5"
              />
              <span>
                Recordar la clave en este navegador.
                <span className="block text-micro text-warning">
                  El almacenamiento del navegador no es seguro para secretos: cualquier
                  extensión o script que se ejecute en el origen puede leerla. Actívalo
                  solo si aceptas ese riesgo.
                </span>
              </span>
            </label>
          </div>
        )}
      </div>
    </div>
  );
};
