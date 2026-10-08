import React, { useState, useEffect } from 'react';
import { Download, Upload, RotateCcw, Database, Check, Cpu, AlertTriangle, RefreshCw, Trash2, Info, Palette, Volume2, VolumeX, Mic } from 'lucide-react';
import { exportSqliteFile, importSqliteFile, exportJsonBackup, importJsonBackup } from '../db/exportImport.ts';
import { describeImportResult, describeConflicts, validateCoursePackage } from '../services/coursePackage.ts';
import { dbBridge } from '../db/sqliteBridge.ts';
import { aiService, AISettings } from '../ai/aiService.ts';
import { speechService, type SpeechSettings } from '../services/speechService.ts';
import { detectWebGPUCapability, WebGPUCapabilityReport } from '../lib/localLlm/capabilities.ts';
import { localLlmEngine, EngineStatus, ModelLoadingProgress } from '../lib/localLlm/engine.ts';
import { LOCAL_MODELS_REGISTRY, getLocalModelById, DEFAULT_WASM_MODEL_ID } from '../lib/localLlm/registry.ts';
import { localEmbeddingEngine, EmbeddingEngineStatus } from '../lib/localEmbeddings/engine.ts';
import { embeddingCache } from '../lib/localEmbeddings/cache.ts';
import { createSemanticChunksFromResourcesAsync } from '../lib/localEmbeddings/chunking.ts';
import { EMBEDDING_MODELS_REGISTRY } from '../lib/localEmbeddings/registry.ts';
import { localAiRuntime, type LocalAiStatus } from '../services/localAiRuntime.ts';
import { dao } from '../db/dao.ts';
import { ConfirmDialog } from '../components/common/ConfirmDialog.tsx';
import { ThemeToggle } from '../components/common/ThemeToggle.tsx';
import { Button, Badge, InlineStatus, ProgressBar, SectionHeading, cn } from '../components/ui/index.tsx';

interface SettingsViewProps {
  onDataReset: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onDataReset }) => {
  const [aiConfig, setAiConfig] = useState<AISettings>(aiService.getSettings());
  const [savedSuccess, setSavedSuccess] = useState(false);

  // WebGPU & Local LLM state
  const [gpuReport, setGpuReport] = useState<WebGPUCapabilityReport>({
    state: 'checking',
    runtimeBackend: 'none',
    hasWasmFallback: typeof WebAssembly !== 'undefined',
  });
  const [engineStatus, setEngineStatus] = useState<EngineStatus>(localLlmEngine.getStatus());
  const [engineProgress, setEngineProgress] = useState<ModelLoadingProgress>(localLlmEngine.getProgress());
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<LocalAiStatus>(localAiRuntime.getStatus());

  // Semantic Embedding & Indexing state
  const [embStatus, setEmbStatus] = useState<EmbeddingEngineStatus>(localEmbeddingEngine.getStatus());
  const [, setEmbProgress] = useState(localEmbeddingEngine.getProgress());
  const [embCount, setEmbCount] = useState<number>(0);
  const [indexingText, setIndexingText] = useState<string | null>(null);
  const [embError, setEmbError] = useState<string | null>(null);

  // Speech & Voice state
  const [speechConfig, setSpeechConfig] = useState<SpeechSettings>(speechService.getSettings());
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>(speechService.getAvailableVoices());
  const [isTestingVoice, setIsTestingVoice] = useState(false);

  const refreshEmbeddingCount = async () => {
    try {
      const activeModel = localEmbeddingEngine.getLoadedModelId() || EMBEDDING_MODELS_REGISTRY[0].id;
      const entries = await embeddingCache.getAllEntriesForModel(activeModel);
      setEmbCount(entries.length);
    } catch {}
  };

  useEffect(() => {
    detectWebGPUCapability().then((rep) => {
      setGpuReport(rep);
      if (rep.state !== 'supported' && rep.hasWasmFallback) {
        setAiConfig((prev) => {
          const currentModel = getLocalModelById(prev.localModelId);
          if (currentModel && currentModel.runtimeBackend === 'webgpu') {
            const updated = { ...prev, localModelId: DEFAULT_WASM_MODEL_ID };
            aiService.saveSettings(updated);
            return updated;
          }
          return prev;
        });
      }
    });
    refreshEmbeddingCount();

    const unsubscribeLlm = localLlmEngine.subscribe((status, progress) => {
      setEngineStatus(status);
      setEngineProgress(progress);
      setLoadingError(localLlmEngine.getLastError());
    });

    const unsubscribeEmb = localEmbeddingEngine.subscribe((status, progress) => {
      setEmbStatus(status);
      setEmbProgress(progress);
      setEmbError(localEmbeddingEngine.getLastError());
    });

    const unsubscribeRuntime = localAiRuntime.subscribe(setRuntimeStatus);

    const unsubscribeSpeech = speechService.subscribe(() => {
      setSpeechConfig(speechService.getSettings());
      setAvailableVoices(speechService.getAvailableVoices());
    });

    return () => {
      unsubscribeLlm();
      unsubscribeEmb();
      unsubscribeRuntime();
      unsubscribeSpeech();
    };
  }, []);

  const handleUpdateSpeech = (updates: Partial<SpeechSettings>) => {
    const updated = speechService.updateSettings(updates);
    setSpeechConfig(updated);
  };

  const handleTestVoice = () => {
    setIsTestingVoice(true);
    speechService.speak(
      'Probando la síntesis de voz en CrossedArts. Aprendizaje offline en el navegador.',
      () => setIsTestingVoice(false),
      () => setIsTestingVoice(false)
    );
  };

  const handleBuildSemanticIndex = async () => {
    setEmbError(null);
    setIndexingText('Cargando motor de embeddings...');
    try {
      if (localEmbeddingEngine.getStatus() !== 'ready') {
        await localEmbeddingEngine.loadModel();
      }
      setIndexingText('Extrayendo contenidos y generando hashes SHA-256...');
      const resources = await dao.getAllLearningResources();
      const chunks = await createSemanticChunksFromResourcesAsync(resources);

      setIndexingText(`Indexando ${chunks.length} fragmentos...`);
      await localEmbeddingEngine.indexChunks(chunks, (indexed, total) => {
        setIndexingText(`Indexando fragmento ${indexed} de ${total}...`);
      });

      await refreshEmbeddingCount();
      setIndexingText(`✅ Indexación completa: ${chunks.length} fragmentos indexados.`);
      setTimeout(() => setIndexingText(null), 3500);
    } catch (err: any) {
      if (err?.message?.includes('cancelada')) {
        setIndexingText('Indexación cancelada por el usuario.');
      } else {
        setEmbError(err?.message || 'Error durante la indexación semántica.');
      }
      setTimeout(() => setIndexingText(null), 3000);
    }
  };

  const handleCancelIndexing = () => {
    localEmbeddingEngine.cancelIndexing();
    setIndexingText('Cancelando indexación...');
  };

  const handleClearSemanticCache = async () => {
    await embeddingCache.clearCache();
    await refreshEmbeddingCount();
    setIndexingText('Caché de vectores vaciado.');
    setTimeout(() => setIndexingText(null), 2000);
  };

  const handleSaveAi = (e: React.FormEvent) => {
    e.preventDefault();
    // Si el usuario deja de usar OpenAI, la clave se descarta por completo.
    if (aiConfig.provider !== 'openai' && aiConfig.apiKey) {
      aiService.clearApiKey();
      setAiConfig({ ...aiConfig, apiKey: '', persistApiKey: false });
    }
    aiService.saveSettings(aiConfig);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);

    // Enabling local AI prepares everything automatically if consent already exists.
    if (aiConfig.provider === 'local' && localAiRuntime.hasConsent()) {
      void localAiRuntime.prepareForTutor('local');
    }
  };

  const handleActivateLocalAi = () => {
    localAiRuntime.grantConsent();
    void localAiRuntime.prepareForTutor('local');
  };

  const handleLoadLocalModel = async () => {
    setLoadingError(null);
    try {
      // Advanced control: force preparation through the same coordinator.
      const status = await localAiRuntime.prepareForTutor('local', aiConfig.localModelId);
      if (status.stage !== 'ready' && status.stage !== 'preparing' && status.stage !== 'downloading' && status.stage !== 'compiling') {
        setLoadingError(status.message);
      }
    } catch (err: any) {
      setLoadingError(err?.message || 'Error cargando el modelo local');
    }
  };

  const handleUnloadLocalModel = async () => {
    await localLlmEngine.unload();
  };

  const handleSwitchAndLoadModel = async (newModelId: string) => {
    const updated = { ...aiConfig, localModelId: newModelId };
    setAiConfig(updated);
    aiService.saveSettings(updated);
    setLoadingError(null);
    try {
      const status = await localAiRuntime.prepareForTutor('local', newModelId);
      if (status.stage !== 'ready' && status.stage !== 'preparing' && status.stage !== 'downloading' && status.stage !== 'compiling') {
        setLoadingError(status.message);
      }
    } catch (err: any) {
      setLoadingError(err?.message || 'Error cargando el modelo');
    }
  };

  const [storageReport, setStorageReport] = useState(dbBridge.getStorageReport());
  const [lastExported, setLastExported] = useState<string | null>(null);
  const [dbFeedback, setDbFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pendingImport, setPendingImport] = useState<File | null>(null);
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);
  const [packageFeedback, setPackageFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const unsubStorage = dbBridge.subscribeStorage((rep) => {
      setStorageReport(rep);
    });
    return () => unsubStorage();
  }, []);

  const handleExport = async () => {
    setDbFeedback(null);
    try {
      const filename = await exportSqliteFile();
      setLastExported(filename);
      setDbFeedback({ type: 'success', text: `Respaldo .sqlite descargado: ${filename}` });
    } catch (err: any) {
      setDbFeedback({ type: 'error', text: 'Error exportando base de datos: ' + (err?.message || 'desconocido') });
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // La confirmación destructiva se gestiona con ConfirmDialog (accesible), no con confirm() nativo.
    e.target.value = '';
    if (!file) return;
    setDbFeedback(null);
    setPendingImport(file);
  };

  /**
   * Importa un paquete de curso (profesor → alumno).
   *
   * A diferencia del respaldo, esta operación es ADITIVA e idempotente: nunca
   * borra ni sobrescribe, así que no requiere confirmación destructiva. Se valida
   * el paquete completo ANTES de escribir nada.
   */
  const handlePackageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setPackageFeedback(null);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('El archivo no contiene un JSON sintácticamente válido.');
      }

      const validation = validateCoursePackage(parsed);
      if (!validation.valid || !validation.package) {
        setPackageFeedback({ type: 'error', text: validation.error || 'El paquete no es válido.' });
        return;
      }

      const { created, skipped, conflicts } = await dao.importCoursePackage(validation.package);
      // El conflicto no es un error: la importación es aditiva y conserva la
      // versión local. Se informa aparte para que el usuario entienda el resultado.
      const conflictNote = describeConflicts(conflicts);
      setPackageFeedback({
        type: 'success',
        text: conflictNote ? `${describeImportResult(created, skipped)} ${conflictNote}` : describeImportResult(created, skipped)
      });
      onDataReset();
    } catch (err: any) {
      setPackageFeedback({ type: 'error', text: 'Error importando el paquete: ' + (err?.message || 'desconocido') });
    }
  };

  const executeImport = async () => {
    const file = pendingImport;
    setPendingImport(null);
    if (!file) return;
    try {
      const isJson = file.name.toLowerCase().endsWith('.json') || file.type === 'application/json';
      if (isJson) {
        const text = await file.text();
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          throw new Error('El archivo no contiene un JSON sintácticamente válido.');
        }
        await importJsonBackup(parsed as Record<string, any[]>);
        setDbFeedback({ type: 'success', text: `Respaldo JSON restaurado correctamente desde "${file.name}".` });
      } else {
        await importSqliteFile(file);
        setDbFeedback({ type: 'success', text: `Base de datos restaurada desde "${file.name}".` });
      }
      onDataReset();
    } catch (err: any) {
      setDbFeedback({ type: 'error', text: 'Error importando respaldo: ' + (err?.message || 'desconocido') });
    }
  };

  const executeResetDemo = async () => {
    setIsResetConfirmOpen(false);
    setDbFeedback(null);
    try {
      await dbBridge.resetDemo();
      setDbFeedback({ type: 'success', text: 'Datos restablecidos al dataset de demostración.' });
      onDataReset();
    } catch (err: any) {
      setDbFeedback({ type: 'error', text: 'Error restableciendo los datos: ' + (err?.message || 'desconocido') });
    }
  };

  const selectedModelDef = getLocalModelById(aiConfig.localModelId);

  const INPUT_CLS = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-body text-ink placeholder:text-faint focus:border-accent/50 focus:outline-none disabled:opacity-50';
  const LABEL_CLS = 'mb-1 block text-meta font-medium text-muted';

  return (
    <div className="mx-auto max-w-4xl animate-fade-in space-y-10">
      {/* Cabecera */}
      <header className="border-b border-line pb-5">
        <h1 className="type-display text-ink">Ajustes</h1>
        <p className="type-secondary mt-1">
          Espacio de configuración local: almacenamiento, respaldos, apariencia, IA e índice semántico.
        </p>
      </header>

      {/* ---------------------------------------------------------------
          Almacenamiento local y respaldos
      --------------------------------------------------------------- */}
      <section aria-labelledby="settings-storage" className="space-y-4">
        <SectionHeading
          title="Almacenamiento y respaldos"
          description="SQLite WASM e IndexedDB: tus datos nunca salen de este navegador."
        />

        <div className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-item text-ink">
              <Database size={17} className="text-accent" aria-hidden="true" />
              Base de datos local
            </span>
            <Badge
              tone={
                storageReport.state === 'ready' || storageReport.state === 'persisted'
                  ? 'success'
                  : storageReport.state === 'persisting'
                    ? 'info'
                    : 'error'
              }
            >
              Estado: {storageReport.state.toUpperCase()}
            </Badge>
          </div>

          {/* Métricas reales de almacenamiento */}
          <dl className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-canvas p-3 text-meta sm:grid-cols-3">
            <div>
              <dt className="text-faint">Tamaño BD SQLite</dt>
              <dd className="font-mono text-ink">
                {storageReport.databaseSizeBytes ? `${(storageReport.databaseSizeBytes / 1024).toFixed(1)} KB` : 'Desconocido'}
              </dd>
            </div>
            <div>
              <dt className="text-faint">IndexedDB</dt>
              <dd className="font-mono text-ink">
                {storageReport.hasIndexedDB ? 'Disponible (navegador)' : 'No soportado (memoria)'}
              </dd>
            </div>
            <div>
              <dt className="text-faint">Última persistencia</dt>
              <dd className="font-mono text-ink">
                {storageReport.lastPersistedTimestamp ? new Date(storageReport.lastPersistedTimestamp).toLocaleTimeString() : 'Al inicio'}
              </dd>
            </div>
          </dl>

          {/* Acciones de respaldo y restauración */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button variant="outline" onClick={handleExport}>
              <Download size={15} aria-hidden="true" /> Exportar (.sqlite)
            </Button>
            <Button variant="outline" onClick={() => exportJsonBackup()}>
              <Download size={15} aria-hidden="true" /> Exportar JSON
            </Button>
            <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-secondary font-medium text-ink transition-colors hover:bg-accent-soft/60">
              <Upload size={15} aria-hidden="true" /> Importar respaldo
              <input type="file" accept=".sqlite,.db,.json" onChange={handleFileUpload} className="hidden" />
            </label>
          </div>

          {/* Paquetes de curso (profesor → alumno): importación aditiva. */}
          <div className="rounded-lg border border-line bg-canvas p-3">
            <p className="type-micro mb-2">Paquete de curso</p>
            <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-secondary font-medium text-ink transition-colors hover:bg-accent-soft/60">
              <Upload size={15} aria-hidden="true" /> Importar paquete (.json)
              <input type="file" accept=".json" onChange={handlePackageUpload} className="hidden" />
            </label>
            <p className="type-meta mt-2 text-muted">
              Importar un paquete de curso AÑADE el material (recurso, módulos, lecciones y trabajo
              práctico) sin borrar ni sobrescribir nada de lo que ya tienes. Exporta un paquete desde
              el detalle de cualquier recurso.
            </p>
            {packageFeedback && (
              <InlineStatus tone={packageFeedback.type === 'success' ? 'success' : 'error'}>
                {packageFeedback.type === 'success'
                  ? <Check size={14} className="shrink-0" aria-hidden="true" />
                  : <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />}
                <span>{packageFeedback.text}</span>
              </InlineStatus>
            )}
          </div>

          {lastExported && (
            <p className="flex items-center gap-1 text-meta text-success">
              <Check size={13} aria-hidden="true" /> Último respaldo descargado:{' '}
              <span className="font-mono text-muted">{lastExported}</span>
            </p>
          )}

          {dbFeedback && (
            <InlineStatus tone={dbFeedback.type === 'success' ? 'success' : 'error'}>
              {dbFeedback.type === 'success' ? <Check size={14} className="shrink-0" aria-hidden="true" /> : <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />}
              <span>{dbFeedback.text}</span>
            </InlineStatus>
          )}

          {/* Nota informativa de dominios de almacenamiento */}
          <div className="flex items-start gap-2 rounded-lg border border-line bg-canvas p-3 text-meta text-muted">
            <Info size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            <span>
              <strong className="text-ink">Límites del respaldo:</strong> El archivo{' '}
              <code className="font-mono text-accent">.sqlite</code> contiene íntegramente tus notas,
              estado de lectura y tarjetas. Los vídeos/audios locales permanecen en tu disco duro y no
              se duplican en la base de datos; tras restaurar en otro dispositivo, simplemente vuelve a
              seleccionar tu carpeta de medios.
            </span>
          </div>

          <div className="border-t border-line pt-3">
            <button
              onClick={() => setIsResetConfirmOpen(true)}
              className="flex items-center gap-2 text-meta font-medium text-error hover:opacity-80"
            >
              <RotateCcw size={13} aria-hidden="true" /> Reiniciar datos al dataset de demostración
            </button>
          </div>
        </div>
      </section>

      {/* Confirmación accesible de acciones destructivas de datos (reemplaza confirm() nativo) */}
      <ConfirmDialog
        isOpen={!!pendingImport}
        title="Restaurar base de datos"
        consequence={`Esta acción reemplazará por completo tus datos locales actuales con el contenido de "${pendingImport?.name || ''}". Asegúrate de haber realizado un respaldo previo si deseas conservarlos.`}
        confirmLabel="Restaurar"
        onCancel={() => setPendingImport(null)}
        onConfirm={executeImport}
      />

      <ConfirmDialog
        isOpen={isResetConfirmOpen}
        title="Reiniciar datos de demostración"
        consequence="Se eliminarán tus datos actuales y se restaurará el dataset de demostración inicial. Esta acción no se puede deshacer."
        confirmLabel="Reiniciar"
        onCancel={() => setIsResetConfirmOpen(false)}
        onConfirm={executeResetDemo}
      />

      {/* ---------------------------------------------------------------
          Apariencia
      --------------------------------------------------------------- */}
      <section aria-labelledby="settings-theme" className="space-y-4">
        <SectionHeading
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

      {/* ---------------------------------------------------------------
          Audio y Accesibilidad por Voz (Web Speech API)
      --------------------------------------------------------------- */}
      <section aria-labelledby="settings-speech" className="space-y-4">
        <SectionHeading
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
                    onClick={() => handleUpdateSpeech({ rate: r })}
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
                onChange={(e) => handleUpdateSpeech({ voiceUri: e.target.value })}
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
                onChange={(e) => handleUpdateSpeech({ autoReadFlashcards: e.target.checked })}
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
              onClick={handleTestVoice}
              disabled={isTestingVoice}
            >
              {isTestingVoice ? <VolumeX size={14} className="text-accent animate-pulse" /> : <Volume2 size={14} />}
              <span>{isTestingVoice ? 'Reproduciendo…' : 'Probar voz'}</span>
            </Button>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------
          IA local y proveedores
      --------------------------------------------------------------- */}
      <form onSubmit={handleSaveAi} className="space-y-4" aria-labelledby="settings-ai">
        <SectionHeading
          title="Tutor IA y proveedores"
          description="Elige el motor de inferencia. La privacidad depende del proveedor seleccionado."
        />

        <div className="space-y-4 rounded-xl border border-line bg-surface p-5 shadow-card">
          <div>
            <label className={LABEL_CLS} htmlFor="ai-provider">Proveedor de inferencia activo</label>
            <select
              id="ai-provider"
              value={aiConfig.provider}
              onChange={e => {
                const nextProvider = e.target.value as any;
                const updated = { ...aiConfig, provider: nextProvider };
                setAiConfig(updated);
                aiService.saveSettings(updated);
                if (nextProvider === 'local' && localAiRuntime.hasConsent()) {
                  void localAiRuntime.prepareForTutor('local');
                }
              }}
              className={INPUT_CLS}
            >
              <option value="demo">Modo demostración / heurístico (sin conexión)</option>
              <option value="local">IA local en navegador (WebGPU / CPU WASM, 100% en el dispositivo)</option>
              <option value="ollama">Ollama local (http://localhost:11434)</option>
              <option value="openai">OpenAI API (GPT-4o / GPT-4o-mini)</option>
            </select>
            {/* Límite honesto de privacidad por proveedor */}
            <p className="type-meta mt-1.5">
              {aiConfig.provider === 'demo' && '✓ Sin conexión: respuestas heurísticas generadas localmente.'}
              {aiConfig.provider === 'local' && '✓ 100% en tu dispositivo. La primera descarga del modelo sí requiere red.'}
              {aiConfig.provider === 'ollama' && '● Servidor local en tu máquina; permite el origen de esta app en OLLAMA_ORIGINS (p. ej. http://localhost:5173) en lugar de "*".'}
              {aiConfig.provider === 'openai' && '⚠️ Proveedor REMOTO: tu consulta viaja a los servidores de OpenAI.'}
            </p>
          </div>

          {/* Sección específica de IA Local WebLLM */}
          {aiConfig.provider === 'local' && (
            <div className="space-y-3 rounded-lg border border-accent/30 bg-accent-soft/40 p-4">
              {/* Estado de producto: la preparación es automática. */}
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
                      ? 'Lista'
                      : runtimeStatus.stage === 'unsupported'
                        ? 'No disponible'
                        : runtimeStatus.stage === 'consent-required'
                          ? 'Pendiente de activación'
                          : runtimeStatus.stage === 'error'
                            ? 'Requiere atención'
                            : runtimeStatus.stage === 'idle'
                              ? 'En reposo'
                              : 'Preparando…'}
                  </Badge>
                </div>
                <p className="mt-1 text-secondary text-muted">{runtimeStatus.message}</p>
                {runtimeStatus.stage !== 'ready' && runtimeStatus.stage !== 'unsupported' && (
                  <div className="mt-2">
                    <Button size="sm" variant="solid" disabled={engineStatus === 'loading'} onClick={handleActivateLocalAi}>
                      {runtimeStatus.stage === 'consent-required' ? 'Activar IA local' : 'Preparar IA local'}
                    </Button>
                  </div>
                )}
                {runtimeStatus.errorAction && (
                  <p className="mt-1 text-micro text-muted">{runtimeStatus.errorAction}</p>
                )}
              </div>

              <p className="border-t border-line pt-3 text-micro font-semibold uppercase tracking-wide text-faint">
                Opciones avanzadas
              </p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-meta font-semibold text-ink">
                  <Cpu size={14} aria-hidden="true" /> Motor de aceleración:
                </span>
                {gpuReport.state === 'supported' ? (
                  <Badge tone="success">WebGPU Activo ({gpuReport.adapterInfo || 'GPU'})</Badge>
                ) : gpuReport.hasWasmFallback ? (
                  <Badge tone="neutral">Modo CPU / WASM activo (Sin WebGPU)</Badge>
                ) : gpuReport.state === 'checking' ? (
                  <Badge tone="neutral">Comprobando soporte…</Badge>
                ) : (
                  <Badge tone="error"><AlertTriangle size={10} aria-hidden="true" /> Sin soporte local</Badge>
                )}
              </div>

              {gpuReport.state === 'unsupported' && !gpuReport.hasWasmFallback && (
                <InlineStatus tone="error">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    <strong>Inferencia local no disponible en este dispositivo.</strong>
                    <span className="mt-0.5 block">
                      {gpuReport.reason || 'El navegador no soporta ni WebGPU ni WebAssembly para ejecución local.'}
                    </span>
                  </span>
                </InlineStatus>
              )}

              {gpuReport.state === 'unsupported' && gpuReport.hasWasmFallback && (
                <InlineStatus tone="info">
                  <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    <strong>WebGPU no detectada: se utilizará la CPU y memoria RAM (WASM).</strong>
                    <span className="mt-0.5 block">
                      Los modelos optimizados para CPU se ejecutarán de forma completamente local y privada sin requerir GPU dedicada.
                    </span>
                  </span>
                </InlineStatus>
              )}

              <div>
                <label className={LABEL_CLS} htmlFor="local-model">Modelo local seleccionado</label>
                <select
                  id="local-model"
                  value={aiConfig.localModelId}
                  onChange={e => setAiConfig({ ...aiConfig, localModelId: e.target.value })}
                  disabled={gpuReport.state !== 'supported' && !gpuReport.hasWasmFallback}
                  className={INPUT_CLS}
                >
                  {LOCAL_MODELS_REGISTRY.map(m => {
                    const isGpuOnly = m.runtimeBackend === 'webgpu';
                    const isDisabled = isGpuOnly && gpuReport.state !== 'supported';
                    return (
                      <option key={m.id} value={m.id} disabled={isDisabled}>
                        {m.name} - {m.downloadSizeApprox} ({m.runtimeBackend === 'wasm' ? 'CPU / RAM' : `${m.vramRequiredMB} MB VRAM`})
                        {isDisabled ? ' [Requiere WebGPU]' : ''}
                        {m.recommended ? ' ★ Recomendado' : ''}
                      </option>
                    );
                  })}
                </select>
                {selectedModelDef && (
                  <p className="type-meta mt-1">{selectedModelDef.description}</p>
                )}
              </div>

              {/* Aviso honesto de descarga */}
              <div className="flex items-start gap-2 rounded-lg border border-line bg-canvas p-3 text-meta text-muted">
                <Info size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                <span>
                  <strong className="text-ink">Descarga y persistencia en caché:</strong> La primera
                  carga de un modelo local requiere conexión a internet para descargar sus pesos (
                  {selectedModelDef?.downloadSizeApprox || '~1 GB'}). Una vez descargado, queda en la
                  caché de IndexedDB y funcionará 100% offline.
                </span>
              </div>

              {/* Controles de carga / descarga de modelo */}
              <div className="flex flex-col gap-3 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-meta">
                  <span className="text-faint">Estado del motor: </span>
                  <span className={cn('font-semibold',
                    engineStatus === 'ready' ? 'text-success' :
                    engineStatus === 'loading' || engineStatus === 'generating' ? 'text-accent' :
                    engineStatus === 'error' ? 'text-error' : 'text-muted'
                  )}>
                    {engineStatus === 'ready' ? 'Listo para inferencia' :
                     engineStatus === 'loading' ? `Cargando (${engineProgress.progress}%)` :
                     engineStatus === 'generating' ? 'Generando respuesta…' :
                     engineStatus === 'error' ? 'Error al inicializar' : 'Descargado / Inactivo'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {engineStatus === 'ready' && (
                    <Button size="sm" variant="outline" onClick={handleUnloadLocalModel}>
                      <Trash2 size={13} aria-hidden="true" /> Liberar memoria
                    </Button>
                  )}

                  {engineStatus !== 'ready' && (
                    <Button
                      size="sm"
                      variant="solid"
                      disabled={
                        (gpuReport.state !== 'supported' && !gpuReport.hasWasmFallback) ||
                        engineStatus === 'loading'
                      }
                      onClick={handleLoadLocalModel}
                    >
                      {engineStatus === 'loading' ? <RefreshCw size={13} className="animate-spin" aria-hidden="true" /> : <Cpu size={13} aria-hidden="true" />}
                      {engineStatus === 'loading' ? 'Cargando modelo…' : 'Cargar modelo (avanzado)'}
                    </Button>
                  )}
                </div>
              </div>

              {engineStatus === 'loading' && (
                <div>
                  <div className="mb-1 flex items-center justify-between text-micro">
                    <span className="max-w-[280px] truncate">{engineProgress.text || 'Descargando y compilando shaders…'}</span>
                    <span className="font-bold text-accent">{engineProgress.progress}%</span>
                  </div>
                  <ProgressBar value={engineProgress.progress} label="Progreso de carga del modelo" />
                </div>
              )}

              {loadingError && (
                <div className="space-y-2 rounded-lg border border-error/30 bg-error-soft/30 p-3 text-meta text-ink">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-error" aria-hidden="true" />
                    <div>
                      <p className="font-semibold text-error">Fallo al inicializar el modelo local</p>
                      <p className="mt-0.5 text-muted">{loadingError}</p>
                    </div>
                  </div>
                  {/shader|index_kernel|comput|incompatibilidad/i.test(loadingError) && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="solid"
                        onClick={() => void handleSwitchAndLoadModel('Llama-3.2-1B-Instruct-q4f16_1-MLC')}
                      >
                        Probar con Llama 3.2 1B (WebGPU)
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleSwitchAndLoadModel('onnx-community/Qwen2.5-0.5B-Instruct')}
                      >
                        Cambiar a CPU / WASM
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {aiConfig.provider === 'ollama' && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className={LABEL_CLS} htmlFor="ollama-url">URL de Ollama</label>
                <input
                  id="ollama-url"
                  type="text"
                  value={aiConfig.ollamaUrl}
                  onChange={e => setAiConfig({ ...aiConfig, ollamaUrl: e.target.value })}
                  placeholder="http://localhost:11434"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="ollama-model">Modelo de Ollama</label>
                <input
                  id="ollama-model"
                  type="text"
                  value={aiConfig.ollamaModel}
                  onChange={e => setAiConfig({ ...aiConfig, ollamaModel: e.target.value })}
                  placeholder="llama3:8b"
                  className={INPUT_CLS}
                />
              </div>
            </div>
          )}

          {aiConfig.provider === 'openai' && (
            <div className="space-y-3">
              <div>
                <label className={LABEL_CLS} htmlFor="openai-key">Clave de API de OpenAI</label>
                <input
                  id="openai-key"
                  type="password"
                  value={aiConfig.apiKey}
                  onChange={e => setAiConfig({ ...aiConfig, apiKey: e.target.value })}
                  placeholder="sk-..."
                  autoComplete="off"
                  spellCheck={false}
                  className={INPUT_CLS}
                />
                <p className="type-micro text-meta mt-1.5">
                  {aiConfig.apiKey
                    ? 'Clave introducida. Al guardar se conserva solo en la memoria de esta pestaña.'
                    : 'La clave se mantiene únicamente en memoria y se pierde al recargar la página.'}
                </p>
              </div>

              <label className="flex items-start gap-2 rounded-lg border border-line bg-canvas px-3 py-2.5 text-meta text-muted">
                <input
                  type="checkbox"
                  checked={aiConfig.persistApiKey === true}
                  onChange={e => setAiConfig({ ...aiConfig, persistApiKey: e.target.checked })}
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

          {/* Sección de Índice Semántico Local (embeddings on-device) */}
          <div className="space-y-3 border-t border-line pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="flex items-center gap-1.5 text-item text-ink">
                  <Database size={14} className="text-accent" aria-hidden="true" />
                  Índice semántico local (embeddings en navegador)
                </h4>
                <p className="type-meta mt-0.5 max-w-xl">
                  La búsqueda semántica se prepara e indexa automáticamente al usarla o al importar
                  contenido. Este panel es una acción avanzada de mantenimiento o recuperación.
                </p>
              </div>
              <Badge tone={embCount > 0 ? 'success' : 'neutral'}>
                <span className="font-mono">{embCount}</span> fragmentos en caché
              </Badge>
            </div>

            <div className="space-y-2 rounded-lg border border-line bg-canvas p-3 text-meta text-muted">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <strong className="text-ink">Aislamiento de vectores:</strong> Los embeddings se
                  persisten en una base de datos IndexedDB dedicada (
                  <span className="font-mono text-accent">CrossedArts_Embeddings</span>). Tu SQLite
                  canónico permanece ligero y libre de matrices binarias.
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {embCount > 0 && (
                    <Button size="sm" variant="quiet" onClick={handleClearSemanticCache}>
                      <Trash2 size={12} aria-hidden="true" /> Vaciar caché
                    </Button>
                  )}
                  {embStatus === 'embedding' ? (
                    <Button size="sm" variant="danger" onClick={handleCancelIndexing}>
                      <RotateCcw size={12} aria-hidden="true" /> Cancelar
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="solid"
                      disabled={embStatus === 'loading'}
                      onClick={handleBuildSemanticIndex}
                    >
                      {embStatus === 'loading' ? (
                        <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
                      ) : (
                        <Database size={12} aria-hidden="true" />
                      )}
                      {embStatus === 'loading' ? 'Preparando…' : 'Reindexar contenido (avanzado)'}
                    </Button>
                  )}
                </div>
              </div>

              {indexingText && (
                <div className="flex items-center gap-1.5 pt-1 text-accent">
                  <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
                  <span>{indexingText}</span>
                </div>
              )}

              {embError && (
                <div className="pt-1 text-error">⚠️ {embError}</div>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          {savedSuccess && (
            <span className="flex items-center gap-1 text-meta text-success" role="status" aria-live="polite">
              <Check size={14} aria-hidden="true" /> Preferencias guardadas correctamente
            </span>
          )}
          <Button variant="solid" type="submit">
            Guardar configuración
          </Button>
        </div>
      </form>
    </div>
  );
};
