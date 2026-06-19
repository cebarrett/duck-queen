import type { StorageBackend } from './StorageBackend'
import { SAVE_KEY, SAVE_VERSION, type SaveData } from './saveSchema'

const AUTOSAVE_INTERVAL = 15 // seconds of play between periodic autosaves

/**
 * SaveManager is the persistence brain that sits between the game and a StorageBackend.
 * It owns everything storage-shaped that ISN'T where-the-bytes-go: JSON (de)serialization,
 * schema versioning/migration, and the autosave lifecycle (a periodic tick plus a flush
 * when the tab is hidden or the page is closing). Swap the backend to move from
 * localStorage to the cloud; none of this logic changes.
 *
 * Game hands us a `snapshot()` provider via begin(); we never reach into the game.
 */
export class SaveManager {
  private timer = 0
  private snapshot: (() => SaveData) | null = null
  private readonly flushBound = (): void => {
    void this.flush()
  }

  constructor(
    private readonly backend: StorageBackend,
    private readonly key: string = SAVE_KEY,
  ) {}

  /**
   * Read and validate the saved game. Returns null when there's nothing stored, the
   * stored JSON is corrupt, or its version isn't one we can load — in every case the
   * caller simply starts a fresh game. Never throws.
   */
  async load(): Promise<SaveData | null> {
    const raw = await this.backend.load(this.key)
    if (raw === null) return null
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return null // corrupt JSON — treat as no save
    }
    return this.migrate(parsed)
  }

  /**
   * Register the snapshot provider and arm autosave: a flush whenever the tab is
   * hidden (visibilitychange) or the page is going away (pagehide). Those two cover
   * tab-close, navigation, and mobile backgrounding more reliably than 'beforeunload'.
   */
  begin(snapshot: () => SaveData): void {
    this.snapshot = snapshot
    document.addEventListener('visibilitychange', this.flushBound)
    window.addEventListener('pagehide', this.flushBound)
  }

  /** Advance the autosave clock (called once per frame from Game.update). */
  tick(delta: number): void {
    if (!this.snapshot) return
    this.timer += delta
    if (this.timer >= AUTOSAVE_INTERVAL) {
      this.timer = 0
      void this.flush()
    }
  }

  /** Write the current snapshot now. Idempotent and best-effort — a failed write is
   *  swallowed so it can't disrupt the frame loop or a page-exit handler. */
  async flush(): Promise<void> {
    if (!this.snapshot) return
    try {
      await this.backend.save(this.key, JSON.stringify(this.snapshot()))
    } catch {
      /* ignore */
    }
  }

  /** Wipe the save (Settings → Reset game progress). */
  async clear(): Promise<void> {
    await this.backend.clear(this.key)
  }

  /**
   * Validate a parsed blob and bring it to the current schema, or return null to
   * discard it (start fresh). For v1 we accept only an exact version match; this is
   * the single place to add real upgrade steps (v1→v2, …) as the format grows.
   */
  private migrate(data: unknown): SaveData | null {
    if (typeof data !== 'object' || data === null) return null
    const d = data as Partial<SaveData>
    if (d.version !== SAVE_VERSION) return null // unknown/old version — discard
    if (typeof d.seed !== 'number') return null
    return d as SaveData
  }
}
