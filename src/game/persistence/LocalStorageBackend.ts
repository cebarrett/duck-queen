import type { StorageBackend } from './StorageBackend'

/**
 * A StorageBackend backed by the browser's localStorage.
 *
 * Every access is wrapped: localStorage throws in private-browsing mode, when storage
 * is disabled, or when the quota is exceeded. A failure degrades gracefully — load
 * returns null (the game just starts fresh and unpersisted), save/clear quietly no-op —
 * so persistence trouble can never break the game loop.
 *
 * The methods are async to satisfy StorageBackend even though localStorage is
 * synchronous; the cloud backend that replaces this will genuinely need it.
 */
export class LocalStorageBackend implements StorageBackend {
  async load(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  }

  async save(key: string, value: string): Promise<void> {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* quota exceeded / private mode — drop the write silently */
    }
  }

  async clear(key: string): Promise<void> {
    try {
      localStorage.removeItem(key)
    } catch {
      /* ignore */
    }
  }
}
