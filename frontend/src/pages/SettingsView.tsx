import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Download, Upload, RotateCcw, Database, Check, Cpu, AlertTriangle, RefreshCw, Trash2, Info, Palette, Volume2, VolumeX, Mic } from 'lucide-react';
import { exportSqliteFile, importSqliteFile, exportJsonBackup, importJsonBackup, parseJsonBackupText } from '../db/exportImport.ts';
import { describeImportResult, describeConflicts, validateCoursePackage } from '../services/coursePackage.ts';
import { dbBridge } from '../db/sqliteBridge.ts';
import { aiService, AISettings } from '../ai/aiService.ts';
import { speechService, type SpeechSettings } from '../services/speechService.ts';
import { detectWebGPUCapability, WebGPUCapabilityReport } from '../lib/localLlm/capabilities.ts';
import { localLlmEngine, EngineStatus, ModelLoadingProgress } from '../lib/localLlm/engine.ts';
import { LOCAL_MODELS_REGISTRY, getLocalModelById, DEFAULT_WASM_MODEL_ID } from '../lib/localLlm/registry.ts';
import { localEmbeddingEngine, EmbeddingEngineStatus } from '../lib/localEmbeddings/engine.ts';
import { embeddingCache } from '../lib/localEmbeddings/cache.ts';
import { buildSemanticCorpus } from '../lib/localEmbeddings/corpus.ts';
import { EMBEDDING_MODELS_REGISTRY, getEmbeddingModelById } from '../lib/localEmbeddings/registry.ts';
import { getStoredEmbeddingModelId, setStoredEmbeddingModelId } from '../services/embeddingModelPreference.ts';
import { localAiRuntime, type LocalAiStatus } from '../services/localAiRuntime.ts';
import { dao } from '../db/dao.ts';
import { formatLocalClockTime } from '../services/localDate.ts';
import { assessImportCapacity, formatBytes } from '../services/storageGuards.ts';
import { getTheme, setTheme } from '../services/theme.ts';
import { useLanguage } from '../hooks/useLanguage.ts';
import { Button, Badge, InlineStatus, ProgressBar, SectionHeading, cn } from '../components/ui/index.tsx';
import { WebGpuDiagnosticGuide } from '../components/ai/WebGpuDiagnosticGuide.tsx';
import {
  AppearanceSection,
  VoiceSection,
  DatabaseSection,
  LLMConfigSection,
  SemanticIndexSection,
} from '../components/settings/index.ts';

interface SettingsViewProps {
  onDataReset: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onDataReset }) => {
  const { t, effective, language, setLanguage } = useLanguage();
  const [aiConfig, setAiConfig] = useState<AISettings>(aiService.getSettings());
  const [savedSuccess, setSavedSuccess] = useState(false);

  const [gpuReport, setGpuReport] = useState<WebGPUCapabilityReport>({
    state: 'checking',
    runtimeBackend: 'none',
    hasWasmFallback: typeof WebAssembly !== 'undefined',
  });
  const [engineStatus, setEngineStatus] = useState<EngineStatus>(localLlmEngine.getStatus());
  const [engineProgress, setEngineProgress] = useState<ModelLoadingProgress>(localLlmEngine.getProgress());
  const [loadingError, setLoadingError] = useState<string | null>(null);
  const [runtimeStatus, setRuntimeStatus] = useState<LocalAiStatus>(localAiRuntime.getStatus());

  const [embStatus, setEmbStatus] = useState<EmbeddingEngineStatus>(localEmbeddingEngine.getStatus());
  const [embBackend, setEmbBackend] = useState(localEmbeddingEngine.getBackend());
  const [, setEmbProgress] = useState(localEmbeddingEngine.getProgress());
  const [embCount, setEmbCount] = useState<number>(0);
  const [indexingText, setIndexingText] = useState<string | null>(null);
  const [embError, setEmbError] = useState<string | null>(null);
  const [selectedEmbeddingModelId, setSelectedEmbeddingModelId] = useState<string>(
    localEmbeddingEngine.getLoadedModelId() || getStoredEmbeddingModelId()
  );
  const selectedEmbeddingModelDef = getEmbeddingModelById(selectedEmbeddingModelId);

  const [speechConfig, setSpeechConfig] = useState<SpeechSettings>(speechService.getSettings());
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>(speechService.getAvailableVoices());
  const [isTestingVoice, setIsTestingVoice] = useState(false);

  /**
   * Timers of the transient status lines.
   *
   * They were fire-and-forget: navigating away before they fired set state on an
   * unmounted view. They are tracked and cleared on unmount.
   */
  const messageTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  useEffect(() => {
    const timers = messageTimers.current;
    return () => {
      for (const id of timers) clearTimeout(id);
      timers.clear();
    };
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      messageTimers.current.delete(id);
      fn();
    }, ms);
    messageTimers.current.add(id);
  }, []);

  const refreshEmbeddingCount = async (modelIdToCount?: string) => {
    try {
      const activeModel = modelIdToCount || localEmbeddingEngine.getLoadedModelId() || selectedEmbeddingModelId || EMBEDDING_MODELS_REGISTRY[0].id;
      const entries = await embeddingCache.getAllEntriesForModel(activeModel);
      setEmbCount(entries.length);
    } catch {}
  };

  useEffect(() => {
    detectWebGPUCapability().then((rep) => {
      setGpuReport(rep);
      if (rep.state !== 'supported' && rep.hasWasmFallback) {
        const current = aiService.getSettings();
        const currentModel = getLocalModelById(current.localModelId);
        if (currentModel && currentModel.runtimeBackend === 'webgpu') {
          const updated = { ...current, localModelId: DEFAULT_WASM_MODEL_ID };
          aiService.saveSettings(updated);
          setAiConfig(updated);
        }
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
      setEmbBackend(localEmbeddingEngine.getBackend());
      setEmbError(localEmbeddingEngine.getLastError());
    });

    const unsubscribeRuntime = localAiRuntime.subscribe((status) => {
      setRuntimeStatus(status);
      if (status.modelId && (status.stage === 'ready' || status.stage === 'downloading' || status.stage === 'compiling')) {
        setAiConfig((prev) => {
          if (prev.localModelId !== status.modelId) {
            return { ...prev, localModelId: status.modelId! };
          }
          return prev;
        });
      }
    });

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
      t('settings.speechTestPhrase'),
      () => setIsTestingVoice(false),
      () => setIsTestingVoice(false)
    );
  };

  const handleBuildSemanticIndex = async () => {
    setEmbError(null);
    setIndexingText(t('settings.embedLoading'));
    try {
      if (localEmbeddingEngine.getStatus() !== 'ready' || localEmbeddingEngine.getLoadedModelId() !== selectedEmbeddingModelId) {
        await localEmbeddingEngine.loadModel(selectedEmbeddingModelId);
      }
      setIndexingText(t('settings.embedHashing'));
      const resources = await dao.getAllLearningResources();
      // ONE chunking route: the canonical corpus boundary (KnowledgeDocument),
      // exactly the one automatic indexing uses. A second ad-hoc path here used
      // to produce different fragments for the same material.
      const { chunks } = await buildSemanticCorpus(resources, selectedEmbeddingModelId);

      setIndexingText(t('settings.embedIndexingChunks', { n: chunks.length }));
      await localEmbeddingEngine.indexChunks(chunks, (indexed, total) => {
        setIndexingText(t('settings.embedIndexingProgress', { done: indexed, total }));
      });

      await refreshEmbeddingCount();
      setIndexingText(t('settings.embedIndexDone', { n: chunks.length }));
      later(() => setIndexingText(null), 3500);
    } catch (err: any) {
      if (err?.message?.includes('cancelada')) {
        setIndexingText(t('settings.indexCancelled'));
      } else {
        setEmbError(err?.message || t('settings.indexError'));
      }
      later(() => setIndexingText(null), 3000);
    }
  };

  /**
   * Releases the resident embedding model now (the vectors stay in IndexedDB).
   * Indexing cannot be interrupted this way: the button is hidden while busy.
   */
  const handleReleaseEmbeddingMemory = async () => {
    try {
      await localEmbeddingEngine.unload();
      setEmbStatus(localEmbeddingEngine.getStatus());
      setEmbBackend(localEmbeddingEngine.getBackend());
      setIndexingText(t('settings.embedReleased'));
      later(() => setIndexingText(null), 2500);
    } catch (err: any) {
      setEmbError(err?.message || t('settings.embedReleaseFail'));
    }
  };

  const handleCancelIndexing = () => {
    localEmbeddingEngine.cancelIndexing();
    setIndexingText(t('settings.indexCancelling'));
  };

  const handleClearSemanticCache = async () => {
    await embeddingCache.clearCache();
    await refreshEmbeddingCount();
    setIndexingText(t('settings.vectorCacheCleared'));
    later(() => setIndexingText(null), 2000);
  };

  const handleSelectEmbeddingModel = async (newId: string) => {
    setSelectedEmbeddingModelId(newId);
    setStoredEmbeddingModelId(newId);
    try {
      await localEmbeddingEngine.loadModel(newId);
      await refreshEmbeddingCount(newId);
      localAiRuntime.scheduleIndexing(aiConfig.provider);
    } catch {}
  };

  const handleSaveAi = (e: React.FormEvent) => {
    e.preventDefault();
    // When the user stops using OpenAI, the key is dropped entirely.
    if (aiConfig.provider !== 'openai' && aiConfig.apiKey) {
      aiService.clearApiKey();
      setAiConfig({ ...aiConfig, apiKey: '', persistApiKey: false });
    }
    aiService.saveSettings(aiConfig);
    setSavedSuccess(true);
    later(() => setSavedSuccess(false), 2500);

    // Enabling local AI prepares everything automatically if consent already exists.
    if (aiConfig.provider === 'local' && localAiRuntime.hasConsent()) {
      void localAiRuntime.prepareForTutor('local');
    }
  };

  const handleActivateLocalAi = () => {
    localAiRuntime.grantConsent();
    void localAiRuntime.prepareForTutor('local', aiConfig.localModelId);
  };

  const handleLoadLocalModel = async () => {
    setLoadingError(null);
    try {
      if (!localAiRuntime.hasConsent()) {
        localAiRuntime.grantConsent();
      }
      const status = await localAiRuntime.prepareForTutor('local', aiConfig.localModelId);
      if (status.stage === 'error' || status.stage === 'unsupported') {
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
      if (!localAiRuntime.hasConsent()) {
        localAiRuntime.grantConsent();
      }
      const status = await localAiRuntime.prepareForTutor('local', newModelId);
      if (status.stage === 'error' || status.stage === 'unsupported') {
        setLoadingError(status.message);
      }
    } catch (err: any) {
      setLoadingError(err?.message || 'Error cargando el modelo');
    }
  };

  const [storageReport, setStorageReport] = useState(dbBridge.getStorageReport());
  const [storageEstimate, setStorageEstimate] = useState<{ usage?: number; quota?: number } | null>(null);
  const [persistRequesting, setPersistRequesting] = useState(false);
  const [persistFeedback, setPersistFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
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

  /** Usage/quota is only readable after mount (and only where StorageManager exists). */
  const refreshStorageEstimate = useCallback(async () => {
    const estimate = await dbBridge.getStorageEstimate();
    setStorageEstimate(estimate);
    return estimate;
  }, []);

  useEffect(() => {
    void refreshStorageEstimate();
  }, [refreshStorageEstimate]);

  /**
   * Persistent storage is requested ONLY from this explicit gesture: browsers
   * ignore (or auto-deny) an unprompted `persist()` call, and the app must never
   * claim protection it does not have.
   */
  const handleRequestPersistence = async () => {
    setPersistRequesting(true);
    setPersistFeedback(null);
    try {
      const granted = await dbBridge.requestPersistentStorage();
      setPersistFeedback({
        type: granted ? 'success' : 'error',
        text: granted ? t('settings.storageGranted') : t('settings.storageDenied')
      });
    } catch {
      setPersistFeedback({ type: 'error', text: t('settings.storageDenied') });
    } finally {
      setPersistRequesting(false);
      await refreshStorageEstimate();
    }
  };

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

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Destructive confirmation goes through ConfirmDialog (accessible), not native confirm().
    e.target.value = '';
    if (!file) return;
    setDbFeedback(null);

    // Restoring a backup keeps the file, the snapshot and the exported copy in
    // memory at once. If the quota cannot cover it, say so BEFORE destroying
    // anything instead of failing halfway through the restore.
    const estimate = await refreshStorageEstimate();
    const capacity = assessImportCapacity(file.size, estimate);
    if (!capacity.sufficient) {
      setDbFeedback({
        type: 'error',
        text: t('settings.storageImportBlocked', {
          file: file.name,
          need: formatBytes(capacity.requiredBytes),
          free: formatBytes(capacity.availableBytes)
        })
      });
      return;
    }

    setPendingImport(file);
  };

  /**
   * Imports a course package (teacher -> student).
   *
   * Unlike a backup, this operation is ADDITIVE and idempotent: it never
   * deletes or overwrites, so it needs no destructive confirmation. The whole
   * package is validated BEFORE anything is written.
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
        throw new Error(t('settings.jsonInvalid'));
      }

      const validation = validateCoursePackage(parsed, effective);
      if (!validation.valid || !validation.package) {
        setPackageFeedback({ type: 'error', text: validation.error || t('settings.pkgInvalid') });
        return;
      }

      const { created, skipped, conflicts } = await dao.importCoursePackage(validation.package);
      // A conflict is not an error: the import is additive and keeps the local
      // version. It is reported separately so the user understands the outcome.
      const conflictNote = describeConflicts(conflicts, effective);
      setPackageFeedback({
        type: 'success',
        text: conflictNote ? `${describeImportResult(created, skipped, effective)} ${conflictNote}` : describeImportResult(created, skipped, effective)
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
        // The size ceiling is applied BEFORE parsing: an oversized backup used
        // to freeze the tab with no explanation.
        const parsed = parseJsonBackupText(text, effective);
        await importJsonBackup(parsed as Record<string, any[]>, effective);
        setDbFeedback({ type: 'success', text: `Respaldo JSON restaurado correctamente desde "${file.name}".` });
      } else {
        await importSqliteFile(file, effective);
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
      setDbFeedback({ type: 'success', text: t('settings.demoResetDone') });
      onDataReset();
    } catch (err: any) {
      setDbFeedback({ type: 'error', text: 'Error restableciendo los datos: ' + (err?.message || 'desconocido') });
    }
  };

  const selectedModelDef = getLocalModelById(aiConfig.localModelId);

  const INPUT_CLS = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-body text-ink placeholder:text-faint focus:border-accent/50 focus:outline-none disabled:opacity-50';
  const lastPersistedFormatted = storageReport.lastPersistedTimestamp
    ? formatLocalClockTime(storageReport.lastPersistedTimestamp)
    : 'Al inicio';

  return (
    <div className="mx-auto max-w-4xl animate-fade-in space-y-10">
      <header className="border-b border-line pb-5">
        <h1 className="type-display text-ink">Ajustes</h1>
        <p className="type-secondary mt-1">
          Espacio de configuración local: almacenamiento, respaldos, apariencia, IA e índice semántico.
        </p>
      </header>

      <DatabaseSection
        storageReport={storageReport}
        lastPersistedFormatted={lastPersistedFormatted}
        storageEstimate={storageEstimate}
        persistRequesting={persistRequesting}
        onRequestPersistence={handleRequestPersistence}
        persistFeedback={persistFeedback}
        onExportSqlite={handleExport}
        onExportJson={async () => { await exportJsonBackup(); }}
        onImportBackup={handleFileUpload}
        onImportPackage={handlePackageUpload}
        packageFeedback={packageFeedback}
        lastExported={lastExported}
        dbFeedback={dbFeedback}
        onOpenResetConfirm={() => setIsResetConfirmOpen(true)}
        isResetConfirmOpen={isResetConfirmOpen}
        onCloseResetConfirm={() => setIsResetConfirmOpen(false)}
        onExecuteResetDemo={executeResetDemo}
        pendingImport={pendingImport}
        onClosePendingImport={() => setPendingImport(null)}
        onExecuteImport={executeImport}
      />

      <AppearanceSection
        theme={getTheme()}
        onThemeChange={setTheme}
      />

      <VoiceSection
        speechConfig={speechConfig}
        availableVoices={availableVoices}
        onUpdateSpeech={handleUpdateSpeech}
        onTestVoice={handleTestVoice}
        isTestingVoice={isTestingVoice}
      />

      <form onSubmit={handleSaveAi} className="space-y-6">
        <LLMConfigSection
          aiConfig={aiConfig}
          onAiConfigChange={setAiConfig}
          onProviderChange={(nextProvider) => {
            const updated = { ...aiConfig, provider: nextProvider };
            setAiConfig(updated);
            aiService.saveSettings(updated);
            if (nextProvider === 'local' && localAiRuntime.hasConsent()) {
              void localAiRuntime.prepareForTutor('local');
            }
          }}
          runtimeStatus={runtimeStatus}
          engineStatus={engineStatus}
          onActivateLocalAi={async () => {
            handleActivateLocalAi();
          }}
          gpuReport={gpuReport}
          onGpuReportChange={setGpuReport}
          loadedModel={localLlmEngine.getLoadedModelId()}
          onReleaseMemory={handleUnloadLocalModel}
          onTryLlama={() => {
            void handleSwitchAndLoadModel("Llama-3.2-1B-Instruct-q4f16_1-MLC");
          }}
          onSwitchToWasm={() => {
            void handleSwitchAndLoadModel("onnx-community/Qwen2.5-0.5B-Instruct");
          }}
        />

        <div className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <SemanticIndexSection
            selectedEmbeddingModel={selectedEmbeddingModelId}
            onSelectEmbeddingModel={handleSelectEmbeddingModel}
            selectedEmbeddingModelDef={selectedEmbeddingModelDef}
            embBackend={embBackend}
            embStatus={embStatus}
            embCount={embCount}
            onReleaseMemory={handleReleaseEmbeddingMemory}
            onClearCache={handleClearSemanticCache}
            onCancelIndexing={handleCancelIndexing}
            onBuildIndex={handleBuildSemanticIndex}
            indexingText={indexingText}
            embError={embError}
          />
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
