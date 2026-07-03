/**
 * The world's BIOMES — named regions that give the marsh country varied scenery:
 * the home meadow around spawn, plus wilder regions (birch groves, golden
 * prairie, stony tors, the old fen, an autumn amberwood) laid out around it.
 *
 * The layout is WORLD GENERATION, so it's deterministic: `BiomeMap` is built
 * once from the seeded 'biomes' stream (see rng.ts) — the same seed always
 * draws the same regions. It works like a smoothed Voronoi diagram: a handful
 * of region SITES are scattered in a ring around the home clearing, each
 * assigned a biome kind; the nearest site claims each point, blending softly
 * across borders (and easing into the home meadow near spawn) so the ground
 * tint and terrain relief never step abruptly.
 *
 * Consumers:
 *   - terrain.ts multiplies its hills by `reliefAt` (tors rise, the fen lies low)
 *   - World.ts tints the ground and picks tree/rock styles per `kindAt`
 *   - Flora.ts picks undergrowth styles per `kindAt`
 *   - Game.ts toasts the region name when the Queen crosses a border, and
 *     washes the minimap with each region's colour
 *
 * This module stays pure data + math (no THREE), so it's unit-testable; the
 * blocky models each biome uses live with their systems (World, Flora).
 */
import { rngRange, type Rng } from './rng'

/** The Treaty Flats — the mid-game boss arena, a named campaign region distinct
 *  from the scattered scenery biomes below. */
export const TREATY_FLATS = {
  name: 'Treaty Flats',
  x: 68,
  z: -66,
  radius: 22,
  pondRadius: 11,
} as const

export type BiomeKind = 'meadow' | 'birchwood' | 'prairie' | 'tors' | 'fen' | 'amberwood'

export interface BiomeDef {
  kind: BiomeKind
  /** Display name for the border toast, e.g. "the Birchwood". */
  title: string
  emoji: string
  /** Translucent wash for the minimap. */
  mapColor: string
  /** Ground vertex-tint palette. */
  ground: readonly number[]
  /** Terrain amplitude multiplier — how dramatic the hills are here. */
  relief: number
  /** Chance a scattered scenery spot actually grows something here. */
  sceneryDensity: number
  /** Of the scenery that grows, how much is trees (the rest is rocks). */
  treeChance: number
  /** Chance a scattered flora spot actually sprouts here. */
  floraDensity: number
}

export const BIOME_DEFS: Record<BiomeKind, BiomeDef> = {
  meadow: {
    kind: 'meadow',
    title: "the Queen's Meadow",
    emoji: '🌼',
    mapColor: 'rgba(126, 186, 84, 0.30)',
    ground: [0x7fae4c, 0x8ec25a, 0x9bbf65],
    relief: 1,
    sceneryDensity: 0.55,
    treeChance: 0.7,
    floraDensity: 0.6,
  },
  birchwood: {
    kind: 'birchwood',
    title: 'the Birchwood',
    emoji: '🌳',
    mapColor: 'rgba(170, 216, 122, 0.38)',
    ground: [0x88b45c, 0x9cc172, 0x93bd68],
    relief: 1,
    sceneryDensity: 0.95,
    treeChance: 0.85,
    floraDensity: 0.55,
  },
  prairie: {
    kind: 'prairie',
    title: 'the Golden Prairie',
    emoji: '🌾',
    mapColor: 'rgba(214, 190, 92, 0.40)',
    ground: [0xc0b054, 0xcdbb5e, 0xb2a851],
    relief: 0.6,
    sceneryDensity: 0.3,
    treeChance: 0.4,
    floraDensity: 0.95,
  },
  tors: {
    kind: 'tors',
    title: 'the Stony Tors',
    emoji: '🪨',
    mapColor: 'rgba(152, 164, 140, 0.42)',
    ground: [0x84996b, 0x93a37b, 0x76905f],
    relief: 1.5,
    sceneryDensity: 0.8,
    treeChance: 0.42,
    floraDensity: 0.5,
  },
  fen: {
    kind: 'fen',
    title: 'the Old Fen',
    emoji: '🍄',
    mapColor: 'rgba(96, 116, 70, 0.46)',
    ground: [0x5e7041, 0x697a46, 0x54663c],
    relief: 0.35,
    sceneryDensity: 0.55,
    treeChance: 0.6,
    floraDensity: 0.8,
  },
  amberwood: {
    kind: 'amberwood',
    title: 'the Amberwood',
    emoji: '🍂',
    mapColor: 'rgba(209, 141, 66, 0.38)',
    ground: [0xa38b4b, 0xb08e49, 0x968a4d],
    relief: 1.05,
    sceneryDensity: 0.9,
    treeChance: 0.8,
    floraDensity: 0.6,
  },
}

/** The wild kinds dealt out to sites (the meadow is the home region, not dealt). */
const WILD_KINDS: readonly BiomeKind[] = ['birchwood', 'prairie', 'tors', 'fen', 'amberwood']

// The home meadow: solid out to HOME_RADIUS, easing into the wild regions over
// the next HOME_BLEND units. It comfortably covers the spawn clearing and the
// main pond so the starting area always reads as the familiar green meadow.
const HOME_RADIUS = 34
const HOME_BLEND = 16

// Region sites: scattered in a ring outside the home meadow, kept apart so each
// region has real breadth, inside the scenery spread (the ground is 300 wide).
const SITE_COUNT = 12
const SITE_MIN_GAP = 42
const SITE_RING_MIN = 55
const SITE_RING_MAX = 145

// How wide the soft border between two adjacent regions is.
const EDGE_BLEND = 18

export interface BiomeSite {
  x: number
  z: number
  kind: BiomeKind
}

export class BiomeMap {
  readonly sites: readonly BiomeSite[]

  constructor(rng: Rng) {
    // Deal the wild kinds in a seeded-shuffled cycle so every kind appears and
    // most appear at a couple of sites.
    const deck = [...WILD_KINDS]
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[deck[i], deck[j]] = [deck[j], deck[i]]
    }

    const sites: BiomeSite[] = []
    for (let guard = 0; sites.length < SITE_COUNT && guard < 600; guard++) {
      const angle = rng() * Math.PI * 2
      const dist = rngRange(rng, SITE_RING_MIN, SITE_RING_MAX)
      const x = Math.cos(angle) * dist
      const z = Math.sin(angle) * dist
      if (sites.some((s) => Math.hypot(s.x - x, s.z - z) < SITE_MIN_GAP)) continue
      sites.push({ x, z, kind: deck[sites.length % deck.length] })
    }
    this.sites = sites
  }

  /**
   * Visit every biome with nonzero influence at (x, z). Weights are positive and
   * sum to 1: the nearest site claims the point, blending across EDGE_BLEND near
   * a border, and the home meadow overrides everything near spawn. A visitor
   * (instead of returning a Map) keeps this allocation-free — it runs inside
   * terrain.heightAt, which every creature samples every frame.
   */
  eachWeight(x: number, z: number, visit: (kind: BiomeKind, weight: number) => void): void {
    const dHome = Math.hypot(x, z)
    const home = smoothWeight(1 - (dHome - HOME_RADIUS) / HOME_BLEND)
    if (home >= 1 || this.sites.length === 0) {
      visit('meadow', 1)
      return
    }

    // Wild-site weights: full for the nearest site, fading over EDGE_BLEND for
    // any site nearly as close, then normalized.
    let best = Infinity
    for (const s of this.sites) {
      const d = Math.hypot(x - s.x, z - s.z)
      if (d < best) best = d
    }
    let total = 0
    for (const s of this.sites) {
      total += smoothWeight(1 - (Math.hypot(x - s.x, z - s.z) - best) / EDGE_BLEND)
    }

    const wild = 1 - home
    if (home > 0) visit('meadow', home)
    for (const s of this.sites) {
      const w = smoothWeight(1 - (Math.hypot(x - s.x, z - s.z) - best) / EDGE_BLEND)
      if (w > 0) visit(s.kind, (w / total) * wild)
    }
  }

  /** The single biome that dominates at (x, z) — for hard picks like "which tree
   *  style grows here" or "which region is the Queen standing in". */
  kindAt(x: number, z: number): BiomeKind {
    let bestKind: BiomeKind = 'meadow'
    let bestWeight = -1
    // Same kind at several sites accumulates; track the running per-kind max by
    // summing into a tiny fixed record via the visitor.
    const sums: Partial<Record<BiomeKind, number>> = {}
    this.eachWeight(x, z, (kind, w) => {
      const sum = (sums[kind] ?? 0) + w
      sums[kind] = sum
      if (sum > bestWeight) {
        bestWeight = sum
        bestKind = kind
      }
    })
    return bestKind
  }

  /** The blended terrain-amplitude multiplier at (x, z) — the tors' hills swell,
   *  the fen lies low and boggy, borders ramp smoothly between. */
  reliefAt(x: number, z: number): number {
    let relief = 0
    this.eachWeight(x, z, (kind, w) => {
      relief += BIOME_DEFS[kind].relief * w
    })
    return relief
  }
}

/** Clamp-and-smoothstep a raw 0..1 ramp value (≤0 → 0, ≥1 → 1, eased between). */
function smoothWeight(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return t * t * (3 - 2 * t)
}
