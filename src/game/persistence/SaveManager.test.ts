import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SaveManager } from './SaveManager'
import type { StorageBackend } from './StorageBackend'
import { SAVE_VERSION, type SaveData } from './saveSchema'

// A trivial in-memory backend so we can drive SaveManager without touching
// localStorage or the DOM. Lets each test seed/inspect the stored string directly.
class FakeBackend implements StorageBackend {
  store = new Map<string, string>()
  async load(key: string): Promise<string | null> {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  async save(key: string, value: string): Promise<void> {
    this.store.set(key, value)
  }
  async clear(key: string): Promise<void> {
    this.store.delete(key)
  }
}

const KEY = 'test/save'

function validSave(): SaveData {
  return {
    version: SAVE_VERSION,
    seed: 123,
    savedAt: 0,
    queen: { x: 1, z: 2, heading: 0.5 },
    food: { total: 3, items: [] },
    reeds: { total: 1, items: [] },
    flock: { subjects: [] },
    nests: { nests: [] },
    frontier: { statuses: [] },
    progress: {
      metSwan: true,
      foragedFood: true,
      gatheredReeds: false,
      builtNest: false,
      ralliedFlock: false,
      baronDefeated: false,
      treatyDefeated: false,
      questGivenBaron: false,
      questGivenTreaty: false,
      questGivenFrontier: false,
    },
    rewardedQuests: ['Forage'],
  }
}

describe('SaveManager.load', () => {
  it('returns null when nothing is stored', async () => {
    const mgr = new SaveManager(new FakeBackend(), KEY)
    expect(await mgr.load()).toBeNull()
  })

  it('returns null on corrupt JSON instead of throwing', async () => {
    const backend = new FakeBackend()
    backend.store.set(KEY, '{not valid json')
    const mgr = new SaveManager(backend, KEY)
    expect(await mgr.load()).toBeNull()
  })

  it('discards a save from an incompatible version', async () => {
    const backend = new FakeBackend()
    backend.store.set(KEY, JSON.stringify({ ...validSave(), version: SAVE_VERSION + 1 }))
    const mgr = new SaveManager(backend, KEY)
    expect(await mgr.load()).toBeNull()
  })

  it('round-trips a valid save', async () => {
    const backend = new FakeBackend()
    backend.store.set(KEY, JSON.stringify(validSave()))
    const mgr = new SaveManager(backend, KEY)
    const loaded = await mgr.load()
    expect(loaded).not.toBeNull()
    expect(loaded!.seed).toBe(123)
    expect(loaded!.progress.foragedFood).toBe(true)
    expect(loaded!.rewardedQuests).toEqual(['Forage'])
  })
})

describe('SaveManager.clear', () => {
  it('removes a stored save', async () => {
    const backend = new FakeBackend()
    backend.store.set(KEY, JSON.stringify(validSave()))
    const mgr = new SaveManager(backend, KEY)
    await mgr.clear()
    expect(await mgr.load()).toBeNull()
  })
})

describe('SaveManager.stop', () => {
  // begin()/stop() attach and detach unload listeners on document/window, which the
  // default (node) test environment doesn't provide. Stub them with no-op event APIs
  // so we can drive the real autosave-arming code paths.
  const noopEvents = { addEventListener() {}, removeEventListener() {} }
  beforeEach(() => {
    ;(globalThis as { document?: unknown }).document = noopEvents
    ;(globalThis as { window?: unknown }).window = noopEvents
  })
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document
    delete (globalThis as { window?: unknown }).window
  })

  it('disarms autosave so tick and flush can no longer write', async () => {
    const backend = new FakeBackend()
    const mgr = new SaveManager(backend, KEY)
    mgr.begin(() => validSave())
    mgr.stop()

    // Neither a timer-triggered flush nor a direct flush should re-create the save.
    mgr.tick(9999)
    await mgr.flush()
    expect(await mgr.load()).toBeNull()
  })

  it('keeps a cleared save cleared even if a flush is attempted afterward', async () => {
    const backend = new FakeBackend()
    backend.store.set(KEY, JSON.stringify(validSave()))
    const mgr = new SaveManager(backend, KEY)
    mgr.begin(() => validSave())

    // The reset sequence: stop autosave, then clear. A later flush (as a page-unload
    // handler would attempt) must not bring the save back.
    mgr.stop()
    await mgr.clear()
    await mgr.flush()
    expect(await mgr.load()).toBeNull()
  })
})
