/**
 * Storage-capacity guards for destructive/bulky local operations.
 *
 * The browser fairly evicts origin data under pressure unless the origin holds
 * persistent storage, and a restore can easily double the stored bytes
 * (snapshot + imported file in memory). These helpers keep the judgement pure so
 * the UI only decides what to show.
 */

export interface StorageEstimateLike {
  usage?: number;
  quota?: number;
}

export interface ImportCapacityAssessment {
  /** `false` only when the estimate proves there is not enough room. */
  sufficient: boolean;
  /** Bytes the estimate reports as free (0 when unknown). */
  availableBytes: number;
  /** Bytes the import is expected to need (0 when the size is unknown). */
  requiredBytes: number;
  /** The estimate was missing or incomplete, so nothing could be proven. */
  unknown: boolean;
}

/**
 * Headroom multiplier applied to the incoming file.
 *
 * A restore keeps the imported bytes, the SQLite snapshot and the exported copy
 * alive at the same time, so requiring exactly `file.size` would under-report.
 */
export const IMPORT_HEADROOM_FACTOR = 1.5;

/**
 * Decides whether an import of `fileSize` bytes fits in the reported quota.
 *
 * Unknown quotas are treated as "cannot prove it does not fit": the caller
 * proceeds and lets the storage layer surface a real failure instead of
 * blocking a valid import on missing data.
 */
export function assessImportCapacity(
  fileSize: number,
  estimate: StorageEstimateLike | null | undefined,
  headroomFactor: number = IMPORT_HEADROOM_FACTOR
): ImportCapacityAssessment {
  const quota = typeof estimate?.quota === 'number' && Number.isFinite(estimate.quota) ? estimate.quota : undefined;
  const usage = typeof estimate?.usage === 'number' && Number.isFinite(estimate.usage) ? estimate.usage : 0;

  if (quota === undefined) {
    return { sufficient: true, availableBytes: 0, requiredBytes: 0, unknown: true };
  }
  if (!Number.isFinite(fileSize) || fileSize <= 0) {
    return { sufficient: true, availableBytes: Math.max(0, quota - usage), requiredBytes: 0, unknown: false };
  }

  const requiredBytes = Math.ceil(fileSize * headroomFactor);
  const availableBytes = Math.max(0, quota - usage);
  return { sufficient: requiredBytes <= availableBytes, availableBytes, requiredBytes, unknown: false };
}

/** Human-readable bytes for the UI ("1,4 GB"), Spanish decimal separator. */
export function formatBytes(bytes: number | undefined | null): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const decimals = value >= 100 || unit === 0 ? 0 : 1;
  return `${value.toFixed(decimals).replace('.', ',')} ${units[unit]}`;
}
