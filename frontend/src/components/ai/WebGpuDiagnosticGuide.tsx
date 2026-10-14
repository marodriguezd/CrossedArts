import React, { useState, useEffect } from 'react';
import {
  Cpu,
  CheckCircle2,
  Copy,
  Check,
  RotateCw,
  ExternalLink,
  HelpCircle,
  Laptop,
  Terminal,
  Layers,
  Sparkles
} from 'lucide-react';
import { Badge, Button } from '../ui/index.tsx';
import {
  detectWebGPUCapability,
  type WebGPUCapabilityReport
} from '../../lib/localLlm/capabilities.ts';

import {
  detectBrowserFamily,
  detectOsPlatform,
  type BrowserFamily,
  type OsPlatform
} from '../../lib/localLlm/browserDetection.ts';

export type { BrowserFamily, OsPlatform };
export { detectBrowserFamily, detectOsPlatform };

interface WebGpuDiagnosticGuideProps {
  initialReport?: WebGPUCapabilityReport;
  onCapabilityChange?: (report: WebGPUCapabilityReport) => void;
  className?: string;
}

export const WebGpuDiagnosticGuide: React.FC<WebGpuDiagnosticGuideProps> = ({
  initialReport,
  onCapabilityChange,
  className = ''
}) => {
  const [report, setReport] = useState<WebGPUCapabilityReport>(
    initialReport || {
      state: 'checking',
      runtimeBackend: 'none',
      hasWasmFallback: true
    }
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const detectedBrowser = detectBrowserFamily();
  const detectedOs = detectOsPlatform();

  // Default active tab based on the detected browser
  const defaultTab = detectedBrowser === 'firefox'
    ? 'firefox'
    : detectedBrowser === 'safari'
      ? 'safari'
      : 'chromium';

  const [activeTab, setActiveTab] = useState<'chromium' | 'firefox' | 'safari' | 'cpu_wasm'>(defaultTab);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const rep = await detectWebGPUCapability();
      setReport(rep);
      onCapabilityChange?.(rep);
    } catch {
      // Ignore detection failure
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (!initialReport) {
      void handleRefresh();
    } else {
      setReport(initialReport);
    }
  }, [initialReport]);

  const copyToClipboard = async (text: string, key: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 2200);
      }
    } catch {
      // Ignore clipboard failure: `navigator.clipboard` is unavailable in insecure contexts
    }
  };

  const isSupported = report.state === 'supported';
  const isChecking = report.state === 'checking';

  const browserName =
    detectedBrowser === 'brave'
      ? 'Brave'
      : detectedBrowser === 'edge'
        ? 'Microsoft Edge'
        : detectedBrowser === 'firefox'
          ? 'Mozilla Firefox'
          : detectedBrowser === 'safari'
            ? 'Apple Safari'
            : detectedBrowser === 'chrome'
              ? 'Google Chrome / Chromium'
              : 'Navegador detectado';

  const osName =
    detectedOs === 'linux'
      ? 'Linux'
      : detectedOs === 'windows'
        ? 'Windows'
        : detectedOs === 'macos'
          ? 'macOS'
          : 'Sistema operativo';

  const flagsUrl = detectedBrowser === 'brave'
    ? 'brave://flags/#enable-unsafe-webgpu'
    : 'chrome://flags/#enable-unsafe-webgpu';

  const settingsSystemUrl = detectedBrowser === 'brave'
    ? 'brave://settings/system'
    : 'chrome://settings/system';

  return (
    <div
      className={`rounded-2xl border border-line bg-surface p-4 shadow-sm md:p-5 ${className}`}
      data-testid="webgpu-diagnostic-guide"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-canvas text-accent">
            <Cpu size={18} aria-hidden="true" />
          </div>
          <div>
            <h3 className="type-meta font-semibold text-ink">Diagnóstico y Guía WebGPU</h3>
            <p className="text-micro text-muted">
              {browserName} en {osName} · Inferencia local acelerada en tu dispositivo
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isChecking ? (
            <Badge tone="neutral">Comprobando soporte…</Badge>
          ) : isSupported ? (
            <Badge tone="success">
              <CheckCircle2 size={12} className="inline mr-1" aria-hidden="true" />
              WebGPU Activo ({report.adapterInfo || 'Acelerado por GPU'})
            </Badge>
          ) : report.hasWasmFallback ? (
            <Badge tone="info">Modo CPU / WASM listo (WebGPU no detectada)</Badge>
          ) : (
            <Badge tone="error">Sin aceleración local disponible</Badge>
          )}

          <Button
            size="sm"
            variant="quiet"
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Volver a comprobar compatibilidad gráfica"
            aria-label="Volver a comprobar compatibilidad gráfica"
          >
            <RotateCw
              size={13}
              className={isRefreshing ? 'animate-spin text-accent' : 'text-muted'}
              aria-hidden="true"
            />
            <span className="hidden sm:inline">Comprobar</span>
          </Button>
        </div>
      </div>

      {/* Live capability status banner */}
      {isSupported ? (
        <div className="mt-4 rounded-xl border border-success/30 bg-success-soft p-3.5 text-meta text-success">
          <div className="flex items-start gap-2">
            <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-semibold">¡WebGPU está activado y listo para inferencia local!</p>
              <p className="mt-0.5 text-micro opacity-90">
                Tu navegador permite ejecutar modelos multilingües (Qwen 2.5, Llama 3.2) con
                aceleración gráfica nativa a máxima velocidad, 100% privado y sin enviar datos fuera.
              </p>
              {report.adapterInfo && (
                <div className="mt-2 flex items-center gap-1.5 text-micro opacity-80">
                  <Laptop size={12} aria-hidden="true" />
                  <span>Adaptador: <strong>{report.adapterInfo}</strong></span>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-line bg-canvas p-3.5 text-meta text-muted">
          <div className="flex items-start gap-2.5">
            <HelpCircle size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-semibold text-ink">
                WebGPU no está disponible de forma nativa en este momento.
              </p>
              <p className="mt-0.5 text-micro">
                Para desbloquear la máxima velocidad de inferencia de IA en tu equipo, activa
                WebGPU siguiendo los pasos según tu navegador, o utiliza el modo CPU/WASM sin tocar nada.
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="mt-5 border-t border-line pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-micro font-semibold uppercase tracking-wide text-faint">
            Instrucciones de activación por navegador
          </span>
          <div className="flex flex-wrap items-center gap-1 rounded-lg border border-line bg-canvas p-0.5" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'chromium'}
              onClick={() => setActiveTab('chromium')}
              className={`rounded-md px-2.5 py-1 text-micro font-medium transition-all ${
                activeTab === 'chromium'
                  ? 'bg-surface text-ink font-semibold shadow-xs'
                  : 'text-muted hover:text-ink'
              }`}
            >
              Brave / Chrome / Edge
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'firefox'}
              onClick={() => setActiveTab('firefox')}
              className={`rounded-md px-2.5 py-1 text-micro font-medium transition-all ${
                activeTab === 'firefox'
                  ? 'bg-surface text-ink font-semibold shadow-xs'
                  : 'text-muted hover:text-ink'
              }`}
            >
              Firefox
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'safari'}
              onClick={() => setActiveTab('safari')}
              className={`rounded-md px-2.5 py-1 text-micro font-medium transition-all ${
                activeTab === 'safari'
                  ? 'bg-surface text-ink font-semibold shadow-xs'
                  : 'text-muted hover:text-ink'
              }`}
            >
              Safari
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'cpu_wasm'}
              onClick={() => setActiveTab('cpu_wasm')}
              className={`rounded-md px-2.5 py-1 text-micro font-medium transition-all ${
                activeTab === 'cpu_wasm'
                  ? 'bg-surface text-ink font-semibold shadow-xs'
                  : 'text-muted hover:text-ink'
              }`}
            >
              Modo CPU (WASM)
            </button>
          </div>
        </div>

        {/* Panel Brave / Chrome / Edge */}
        {activeTab === 'chromium' && (
          <div className="mt-3.5 space-y-3 rounded-xl border border-line bg-canvas p-4 text-meta" role="tabpanel">
            <div className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-micro font-bold text-accent">
                1
              </span>
              <div className="flex-1">
                <p className="font-semibold text-ink">Verifica la aceleración por hardware del navegador</p>
                <p className="mt-0.5 text-micro text-muted">
                  Abre la configuración del sistema de tu navegador y comprueba que esté activada:
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <code className="rounded border border-line bg-surface px-2 py-0.5 text-micro font-mono text-ink">
                    {settingsSystemUrl}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(settingsSystemUrl, 'settings-url')}
                    className="h-6 px-2 text-micro"
                  >
                    {copiedKey === 'settings-url' ? (
                      <>
                        <Check size={11} className="text-success" aria-hidden="true" />
                        <span>Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy size={11} aria-hidden="true" />
                        <span>Copiar ruta</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-micro font-bold text-accent">
                2
              </span>
              <div className="flex-1">
                <p className="font-semibold text-ink">Habilita el flag WebGPU</p>
                <p className="mt-0.5 text-micro text-muted">
                  Pega esta dirección en una pestaña nueva y cambia la opción a <strong>Enabled</strong>:
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <code className="rounded border border-line bg-surface px-2 py-0.5 text-micro font-mono text-ink">
                    {flagsUrl}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard(flagsUrl, 'flags-url')}
                    className="h-6 px-2 text-micro"
                  >
                    {copiedKey === 'flags-url' ? (
                      <>
                        <Check size={11} className="text-success" aria-hidden="true" />
                        <span>Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy size={11} aria-hidden="true" />
                        <span>Copiar flag</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            {detectedOs === 'linux' && (
              <div className="rounded-lg border border-accent/20 bg-accent-soft/40 p-2.5 text-micro text-muted">
                <div className="flex items-center gap-1.5 font-semibold text-accent">
                  <Terminal size={12} aria-hidden="true" />
                  <span>Optimización adicional para Linux:</span>
                </div>
                <p className="mt-1">
                  En sistemas Linux con Wayland o X11, activa también Vulkan en{' '}
                  <code className="rounded bg-surface px-1 py-0.2 font-mono text-ink">
                    chrome://flags/#enable-vulkan
                  </code>{' '}
                  o inicia el navegador con{' '}
                  <code className="rounded bg-surface px-1 py-0.2 font-mono text-ink">
                    --enable-features=Vulkan
                  </code>.
                </p>
              </div>
            )}

            <div className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-micro font-bold text-accent">
                3
              </span>
              <div className="flex-1">
                <p className="font-semibold text-ink">Reinicia el navegador</p>
                <p className="mt-0.5 text-micro text-muted">
                  Pulsa el botón <strong>Relaunch / Reiniciar</strong> que aparece abajo en la página de flags y vuelve a esta pantalla.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Panel Firefox */}
        {activeTab === 'firefox' && (
          <div className="mt-3.5 space-y-3 rounded-xl border border-line bg-canvas p-4 text-meta" role="tabpanel">
            <div className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-micro font-bold text-accent">
                1
              </span>
              <div className="flex-1">
                <p className="font-semibold text-ink">Abre la configuración avanzada</p>
                <p className="mt-0.5 text-micro text-muted">
                  Escribe en la barra de direcciones de Firefox:
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <code className="rounded border border-line bg-surface px-2 py-0.5 text-micro font-mono text-ink">
                    about:config
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard('about:config', 'ff-config')}
                    className="h-6 px-2 text-micro"
                  >
                    {copiedKey === 'ff-config' ? (
                      <>
                        <Check size={11} className="text-success" aria-hidden="true" />
                        <span>Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy size={11} aria-hidden="true" />
                        <span>Copiar</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-micro font-bold text-accent">
                2
              </span>
              <div className="flex-1">
                <p className="font-semibold text-ink">Activa dom.webgpu.enabled</p>
                <p className="mt-0.5 text-micro text-muted">
                  Busca la clave y haz doble clic para ponerla en <strong>true</strong>:
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <code className="rounded border border-line bg-surface px-2 py-0.5 text-micro font-mono text-ink">
                    dom.webgpu.enabled
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => copyToClipboard('dom.webgpu.enabled', 'ff-pref')}
                    className="h-6 px-2 text-micro"
                  >
                    {copiedKey === 'ff-pref' ? (
                      <>
                        <Check size={11} className="text-success" aria-hidden="true" />
                        <span>Copiado</span>
                      </>
                    ) : (
                      <>
                        <Copy size={11} aria-hidden="true" />
                        <span>Copiar clave</span>
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-micro font-bold text-accent">
                3
              </span>
              <div className="flex-1">
                <p className="font-semibold text-ink">Reinicia Firefox</p>
                <p className="mt-0.5 text-micro text-muted">
                  Cierra y vuelve a abrir Firefox para que la API WebGPU quede vinculada al motor gráfico.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Panel Safari */}
        {activeTab === 'safari' && (
          <div className="mt-3.5 space-y-3 rounded-xl border border-line bg-canvas p-4 text-meta" role="tabpanel">
            <div className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-micro font-bold text-accent">
                1
              </span>
              <div className="flex-1">
                <p className="font-semibold text-ink">Habilita el menú de desarrollo</p>
                <p className="mt-0.5 text-micro text-muted">
                  En Safari, ve a <strong>Ajustes › Avanzado</strong> y marca la casilla{' '}
                  <em>«Mostrar funciones para desarrolladores web»</em>.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft text-micro font-bold text-accent">
                2
              </span>
              <div className="flex-1">
                <p className="font-semibold text-ink">Activa WebGPU en funciones experimentales</p>
                <p className="mt-0.5 text-micro text-muted">
                  En la barra superior de Safari, abre el menú <strong>Desarrollador › Funciones experimentales</strong> y activa{' '}
                  <strong>WebGPU</strong>.
                </p>
                <p className="mt-1 text-micro text-faint">
                  * Requiere macOS 14 Sonoma o posterior (o iOS 17+).
                </p>
              </div>
            </div>
          </div>
        )}

        {/* CPU (WASM) mode panel */}
        {activeTab === 'cpu_wasm' && (
          <div className="mt-3.5 space-y-3 rounded-xl border border-line bg-canvas p-4 text-meta" role="tabpanel">
            <div className="flex items-start gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Layers size={15} aria-hidden="true" />
              </div>
              <div className="flex-1">
                <h4 className="font-semibold text-ink">Inferencia 100% en CPU y Memoria RAM</h4>
                <p className="mt-1 text-micro leading-relaxed text-muted">
                  No necesitas activar ningún flag ni disponer de una tarjeta gráfica dedicada.
                  CrossedArts incluye un motor WebAssembly/ONNX optimizado que ejecuta modelos
                  multilingües como <strong>Qwen 2.5 0.5B (CPU)</strong> y <strong>SmolLM2 360M</strong> directamente
                  sobre el procesador de tu equipo.
                </p>
                <div className="mt-3 rounded-lg border border-line bg-surface p-2.5 text-micro">
                  <div className="flex items-center gap-1.5 font-semibold text-ink">
                    <Sparkles size={12} className="text-accent" aria-hidden="true" />
                    <span>Ventajas del modo CPU/WASM:</span>
                  </div>
                  <ul className="mt-1.5 list-disc list-inside space-y-0.5 text-muted">
                    <li>Funciona en cualquier navegador moderno sin tocar configuración.</li>
                    <li>Descargas ultraligeras de 200 MB a 350 MB.</li>
                    <li>100% privado y sin enviar datos a servidores externos.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
