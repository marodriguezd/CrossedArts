import { DEFAULT_EMBEDDING_MODEL_ID, getEmbeddingModelById } from '../lib/localEmbeddings/registry.ts';

/**
 * Selected embedding model, persisted in `localStorage`.
 *
 * Automatic indexing used to always load the DEFAULT model, so a person who
 * picked another one saw its vectors pruned and the library re-indexed with a
 * model they had not chosen. The selection is not secret, so plain
 * `localStorage` is the right place (no IndexedDB schema change).
 */
export const EMBEDDING_MODEL_STORAGE_KEY = 'crossedarts_embedding_model';

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): PreferenceStorage | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

/**
 * Stored model id, falling back to the default when the value is missing,
 * unreadable, or names a model that is no longer in the registry.
 */
export function getStoredEmbeddingModelId(storage: PreferenceStorage | null = defaultStorage()): string {
  if (!storage) return DEFAULT_EMBEDDING_MODEL_ID;
  try {
    const stored = storage.getItem(EMBEDDING_MODEL_STORAGE_KEY);
    if (!stored) return DEFAULT_EMBEDDING_MODEL_ID;
    return getEmbeddingModelById(stored) ? stored : DEFAULT_EMBEDDING_MODEL_ID;
  } catch {
    return DEFAULT_EMBEDDING_MODEL_ID;
  }
}

/** Persists a KNOWN model id; unknown ids are ignored instead of poisoning the key. */
export function setStoredEmbeddingModelId(
  modelId: string,
  storage: PreferenceStorage | null = defaultStorage()
): boolean {
  if (!storage || !getEmbeddingModelById(modelId)) return false;
  try {
    storage.setItem(EMBEDDING_MODEL_STORAGE_KEY, modelId);
    return true;
  } catch {
    return false;
  }
}
