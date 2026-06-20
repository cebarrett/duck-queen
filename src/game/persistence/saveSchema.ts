/**
 * The on-disk shape of a saved game, plus the version constant that gates it.
 *
 * Everything here is plain, JSON-serializable data — no THREE objects, no class
 * instances. Each gameplay system owns a `toSave()` that produces its slice and a
 * `restore(slice)` that applies one; Game assembles the slices into a SaveData and
 * distributes a loaded one back out. Keeping the schema in one file (separate from
 * the live game types it mirrors) means the save format can evolve on its own.
 */

/** Bump whenever the SaveData shape changes incompatibly. SaveManager.migrate()
 *  discards (or, later, upgrades) any save whose version doesn't match. */
export const SAVE_VERSION = 1

/** Storage key. The version lives in the key too, so a future format can move to a
 *  fresh key and leave old saves untouched for a clean cutover. */
export const SAVE_KEY = 'duck-queen/save/v1'

/** A resource patch (Food / Reeds). Items are scattered in a deterministic, seeded
 *  order, so we restore per-item state BY INDEX into that order — and store only the
 *  items that diverge from a freshly-generated patch (gathered or mid-regrow). */
export interface PatchSlice {
  total: number
  items: { i: number; collected: boolean; regrowTimer: number | null }[]
}

/** One flock subject. `kind` is fixed at construction (a matured duckling is a new
 *  drake/hen), so restoring rebuilds each subject with its saved kind. Transient
 *  behaviour (velocity, timers, current target) is not saved — it re-derives. */
export interface SubjectSlice {
  kind: 'duckling' | 'drake' | 'hen'
  /** This subject's quirk, kept from ducklinghood into adulthood. Optional so saves from
   *  before traits existed still load (a duckling slice without one re-draws on restore). */
  trait?: 'fastForager' | 'fastRunner' | 'loudHonker' | null
  /** Seed for this subject's individual look (size + feather shades). Optional so saves
   *  from before per-duck variation still load (a slice without one re-rolls on restore). */
  appearanceSeed?: number
  x: number
  z: number
  heading: number
  age: number
  homeX: number
  homeZ: number
  /** Was she brooding at save time? If so, nestIndex points at her nest. */
  nesting: boolean
  nestIndex: number | null
}

/** One built nest, including its eggs and how far the current egg has incubated. */
export interface NestSlice {
  x: number
  z: number
  eggs: number
  broodTime: number
  rotationY: number
}

export interface NestsSlice {
  nests: NestSlice[]
}

/** Frontier territory ownership, indexed in Frontier.list order (same order Geese
 *  spawns its lieutenants, so an index pairs a territory with its lieutenant). */
export interface FrontierSlice {
  statuses: ('enemy' | 'claimed')[]
}

/** The campaign flags. Structurally the Progress interface, but kept distinct so the
 *  save format is free to diverge from gameplay later. */
export interface ProgressSlice {
  metSwan: boolean
  foragedFood: boolean
  gatheredReeds: boolean
  builtNest: boolean
  ralliedFlock: boolean
  baronDefeated: boolean
  treatyDefeated: boolean
  questGivenBaron: boolean
  questGivenTreaty: boolean
  questGivenFrontier: boolean
}

/** A complete saved game. */
export interface SaveData {
  version: number
  /** The world seed this save was generated against — restored layout only makes
   *  sense against the same seed (see Game's seed-precedence rule). */
  seed: number
  savedAt: number
  queen: { x: number; z: number; heading: number }
  food: PatchSlice
  reeds: PatchSlice
  flock: { subjects: SubjectSlice[] }
  nests: NestsSlice
  /** Frontier territory ownership, indexed in Frontier.list order. */
  frontier: FrontierSlice
  progress: ProgressSlice
  /** Titles of quests whose one-time reward has already been paid out. */
  rewardedQuests: string[]
}
