/**
 * A swappable persistence target. localStorage today (LocalStorageBackend); a cloud
 * key-value or REST store later — just pass a different implementation to SaveManager
 * and nothing else in the game changes.
 *
 * The backend is a dumb string store: it never knows the SaveData shape. JSON
 * serialization, schema versioning, and autosave timing all live in SaveManager, so a
 * cloud backend re-implements none of that.
 *
 * Every method is async (Promise-based) on purpose: localStorage is synchronous, but a
 * cloud backend will do real I/O, and main.ts already awaits load() at boot.
 */
export interface StorageBackend {
  /** The raw saved string for `key`, or null if nothing is stored (or it can't be read). */
  load(key: string): Promise<string | null>
  /** Persist `value` under `key`, overwriting any previous value. */
  save(key: string, value: string): Promise<void>
  /** Delete whatever is stored under `key` (a no-op if nothing is there). */
  clear(key: string): Promise<void>
}
