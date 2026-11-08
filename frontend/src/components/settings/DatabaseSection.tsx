import React from 'react';
import {
  AlertTriangle,
  Check,
  Database,
  Download,
  Info,
  RotateCcw,
  Upload,
} from 'lucide-react';
import type { StorageReport } from '../../db/sqliteBridge.ts';
import { Badge, Button, InlineStatus, SectionHeading } from '../ui/index.tsx';
import { ConfirmDialog } from '../common/ConfirmDialog.tsx';
import { useLanguage } from '../../hooks/useLanguage.ts';

export interface DatabaseSectionProps {
  storageReport: StorageReport;
  lastPersistedFormatted: string;
  storageEstimate: { usage?: number; quota?: number } | null;
  persistRequesting: boolean;
  onRequestPersistence: () => Promise<void>;
  persistFeedback: { type: 'success' | 'error'; text: string } | null;
  onExportSqlite: () => void;
  onExportJson: () => Promise<void>;
  onImportBackup: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onImportPackage: (e: React.ChangeEvent<HTMLInputElement>) => void;
  packageFeedback: { type: 'success' | 'error'; text: string } | null;
  lastExported: string | null;
  dbFeedback: { type: 'success' | 'error'; text: string } | null;
  onOpenResetConfirm: () => void;
  isResetConfirmOpen: boolean;
  onCloseResetConfirm: () => void;
  onExecuteResetDemo: () => Promise<void>;
  pendingImport: File | null;
  onClosePendingImport: () => void;
  onExecuteImport: () => Promise<void>;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const DatabaseSection: React.FC<DatabaseSectionProps> = ({
  storageReport,
  lastPersistedFormatted,
  storageEstimate,
  persistRequesting,
  onRequestPersistence,
  persistFeedback,
  onExportSqlite,
  onExportJson,
  onImportBackup,
  onImportPackage,
  packageFeedback,
  lastExported,
  dbFeedback,
  onOpenResetConfirm,
  isResetConfirmOpen,
  onCloseResetConfirm,
  onExecuteResetDemo,
  pendingImport,
  onClosePendingImport,
  onExecuteImport,
}) => {
  const { t } = useLanguage();

  return (
    <>
      <section aria-labelledby="settings-storage" className="space-y-4">
        <SectionHeading
          id="settings-storage"
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

          {/* Real storage metrics */}
          <dl className="grid grid-cols-1 gap-3 rounded-lg border border-line bg-canvas p-3 text-meta sm:grid-cols-3">
            <div>
              <dt className="text-faint">Tamaño BD SQLite</dt>
              <dd className="font-mono text-ink">
                {storageReport.databaseSizeBytes
                  ? `${(storageReport.databaseSizeBytes / 1024).toFixed(1)} KB`
                  : 'Desconocido'}
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
              <dd className="font-mono text-ink">{lastPersistedFormatted}</dd>
            </div>
          </dl>

          {/* Protección del almacenamiento */}
          <div className="space-y-2 rounded-lg border border-line bg-canvas p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="type-micro">{t('settings.storageTitle')}</span>
              <Badge tone={storageReport.isPersistentGranted ? 'success' : 'warning'}>
                {storageReport.isPersistentGranted
                  ? t('settings.storageProtected')
                  : t('settings.storageNotProtected')}
              </Badge>
            </div>
            <p className="text-meta text-muted">{t('settings.storageBody')}</p>
            <p className="text-meta font-mono text-ink">
              {storageEstimate && (storageEstimate.quota ?? 0) > 0
                ? t('settings.storageUsage', {
                    used: formatBytes(storageEstimate.usage ?? 0),
                    quota: formatBytes(storageEstimate.quota),
                  })
                : t('settings.storageUsageUnknown')}
            </p>
            {!storageReport.isPersistentGranted && (
              <Button
                variant="outline"
                onClick={() => void onRequestPersistence()}
                disabled={persistRequesting}
              >
                <Database size={15} aria-hidden="true" />
                {persistRequesting ? t('settings.storageRequesting') : t('settings.storageProtect')}
              </Button>
            )}
            {persistFeedback && (
              <InlineStatus tone={persistFeedback.type === 'success' ? 'success' : 'error'}>
                {persistFeedback.type === 'success' ? (
                  <Check size={14} className="shrink-0" aria-hidden="true" />
                ) : (
                  <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
                )}
                <span>{persistFeedback.text}</span>
              </InlineStatus>
            )}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button variant="outline" onClick={onExportSqlite}>
              <Download size={15} aria-hidden="true" /> Exportar (.sqlite)
            </Button>
            <Button variant="outline" onClick={() => void onExportJson()}>
              <Download size={15} aria-hidden="true" /> Exportar JSON
            </Button>
            <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-secondary font-medium text-ink transition-colors hover:bg-accent-soft/60">
              <Upload size={15} aria-hidden="true" /> Importar respaldo
              <input
                type="file"
                accept=".sqlite,.db,.json"
                onChange={onImportBackup}
                className="hidden"
              />
            </label>
          </div>

          {/* Course packages */}
          <div className="rounded-lg border border-line bg-canvas p-3">
            <p className="type-micro mb-2">Paquete de curso</p>
            <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface px-4 text-secondary font-medium text-ink transition-colors hover:bg-accent-soft/60">
              <Upload size={15} aria-hidden="true" /> Importar paquete (.json)
              <input
                type="file"
                accept=".json"
                onChange={onImportPackage}
                className="hidden"
              />
            </label>
            <p className="type-meta mt-2 text-muted">
              Importar un paquete de curso AÑADE el material (recurso, módulos, lecciones y trabajo
              práctico) sin borrar ni sobrescribir nada de lo que ya tienes. Exporta un paquete desde
              el detalle de cualquier recurso.
            </p>
            {packageFeedback && (
              <InlineStatus tone={packageFeedback.type === 'success' ? 'success' : 'error'}>
                {packageFeedback.type === 'success' ? (
                  <Check size={14} className="shrink-0" aria-hidden="true" />
                ) : (
                  <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
                )}
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
              {dbFeedback.type === 'success' ? (
                <Check size={14} className="shrink-0" aria-hidden="true" />
              ) : (
                <AlertTriangle size={14} className="shrink-0" aria-hidden="true" />
              )}
              <span>{dbFeedback.text}</span>
            </InlineStatus>
          )}

          {/* Informational note */}
          <div className="flex items-start gap-2 rounded-lg border border-line bg-canvas p-3 text-meta text-muted">
            <Info size={15} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            <span>
              <strong className="text-ink">{t('settings.backupLimitsTitle')}</strong>{' '}
              {t('settings.backupLimitsBody')}
            </span>
          </div>

          <div className="border-t border-line pt-3">
            <button
              onClick={onOpenResetConfirm}
              className="flex items-center gap-2 text-meta font-medium text-error hover:opacity-80"
            >
              <RotateCcw size={13} aria-hidden="true" /> Reiniciar datos al dataset de demostración
            </button>
          </div>
        </div>
      </section>

      {/* Confirmation dialogs */}
      <ConfirmDialog
        isOpen={!!pendingImport}
        title="Restaurar base de datos"
        consequence={`Esta acción reemplazará por completo tus datos locales actuales con el contenido de "${pendingImport?.name || ''}". Asegúrate de haber realizado un respaldo previo si deseas conservarlos.`}
        confirmLabel="Restaurar"
        onCancel={onClosePendingImport}
        onConfirm={onExecuteImport}
      />

      <ConfirmDialog
        isOpen={isResetConfirmOpen}
        title={t('settings.demoResetTitle')}
        consequence={t('settings.demoResetConsequence')}
        confirmLabel="Reiniciar"
        onCancel={onCloseResetConfirm}
        onConfirm={onExecuteResetDemo}
      />
    </>
  );
};
