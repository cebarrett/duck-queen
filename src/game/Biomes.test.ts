import { describe, it, expect } from 'vitest'
import { BiomeMap, BIOME_DEFS, type BiomeKind } from './Biomes'
import { mulberry32 } from './rng'

const KINDS = Object.keys(BIOME_DEFS) as BiomeKind[]
const RELIEFS = KINDS.map((k) => BIOME_DEFS[k].relief)
const MIN_RELIEF = Math.min(...RELIEFS)
const MAX_RELIEF = Math.max(...RELIEFS)

describe('BiomeMap', () => {
  it('is deterministic: the same seed lays out the same regions', () => {
    const a = new BiomeMap(mulberry32(123))
    const b = new BiomeMap(mulberry32(123))
    for (let x = -140; x <= 140; x += 20) {
      for (let z = -140; z <= 140; z += 20) {
        expect(a.kindAt(x, z)).toBe(b.kindAt(x, z))
        expect(a.reliefAt(x, z)).toBeCloseTo(b.reliefAt(x, z))
      }
    }
  })

  it('a different seed lays out different regions', () => {
    const a = new BiomeMap(mulberry32(1))
    const b = new BiomeMap(mulberry32(2))
    let differs = false
    for (let x = -140; x <= 140 && !differs; x += 15) {
      for (let z = -140; z <= 140 && !differs; z += 15) {
        if (a.kindAt(x, z) !== b.kindAt(x, z)) differs = true
      }
    }
    expect(differs).toBe(true)
  })

  it('the home ground is always the meadow', () => {
    const map = new BiomeMap(mulberry32(9))
    // Spawn, the main pond, and the near clearing all sit in the home meadow.
    expect(map.kindAt(0, 0)).toBe('meadow')
    expect(map.kindAt(0, -26)).toBe('meadow')
    expect(map.kindAt(8, 12)).toBe('meadow')
    // And the meadow's relief is exactly 1 there — the classic rolling hills.
    expect(map.reliefAt(0, 0)).toBeCloseTo(1)
  })

  it('every wild biome kind appears somewhere in the world', () => {
    const map = new BiomeMap(mulberry32(42))
    const seen = new Set<BiomeKind>()
    for (let x = -145; x <= 145; x += 5) {
      for (let z = -145; z <= 145; z += 5) {
        seen.add(map.kindAt(x, z))
      }
    }
    for (const kind of KINDS) expect(seen.has(kind), `missing ${kind}`).toBe(true)
  })

  it('blend weights are positive and sum to 1 everywhere', () => {
    const map = new BiomeMap(mulberry32(7))
    for (const [x, z] of [[0, 0], [40, 0], [-44, 39], [90, -90], [130, 130], [-149, 2]]) {
      let total = 0
      map.eachWeight(x, z, (_kind, w) => {
        expect(w).toBeGreaterThan(0)
        total += w
      })
      expect(total).toBeCloseTo(1)
    }
  })

  it('relief stays within the defined biome range and is smooth across borders', () => {
    const map = new BiomeMap(mulberry32(5))
    let prev: number | null = null
    for (let x = -145; x <= 145; x += 0.5) {
      const r = map.reliefAt(x, 20)
      expect(r).toBeGreaterThanOrEqual(MIN_RELIEF - 1e-9)
      expect(r).toBeLessThanOrEqual(MAX_RELIEF + 1e-9)
      // Walking half a unit never jumps the multiplier — borders ramp smoothly.
      if (prev !== null) expect(Math.abs(r - prev)).toBeLessThan(0.12)
      prev = r
    }
  })
})
