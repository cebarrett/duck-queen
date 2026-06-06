/**
 * Seeded randomness for WORLD GENERATION.
 *
 * Everything that decides the world's layout — where the trees, rocks, pond
 * plants, reeds, ducklings, and geese spawn — must draw from one of these, NOT
 * from Math.random(). That's what makes a given seed always produce the exact
 * same world. (Behaviour during play — a duck wandering, a goose honking — stays
 * on Math.random(); that's gameplay, not generation.)
 */

/** A deterministic source of floats in [0, 1). */
export type Rng = () => number

/**
 * mulberry32 — a tiny, well-known seeded generator. Same seed in → same stream of
 * 0..1 numbers out, every time. (You don't need to follow the bit-twiddling.)
 */
export function mulberry32(seed: number): Rng {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Make an INDEPENDENT generator for a named subsystem ("scenery", "food", …) from
 * the one world seed. Each subsystem gets its own stable stream, so adding/removing
 * one (or changing how many numbers it draws) can't shift any of the others.
 */
export function deriveRng(worldSeed: number, key: string): Rng {
  // FNV-1a-style hash of the key, mixed with the world seed.
  let h = (worldSeed ^ 0x811c9dc5) >>> 0
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return mulberry32(h)
}

/** A float in [min, max) from a seeded generator. */
export function rngRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min)
}
