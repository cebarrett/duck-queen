import { describe, it, expect } from 'vitest'
import { Terrain } from './terrain'
import { mulberry32 } from './rng'

describe('Terrain', () => {
  it('is deterministic: the same seed raises the same hills', () => {
    const a = new Terrain(mulberry32(123))
    const b = new Terrain(mulberry32(123))
    for (const [x, z] of [[0, 0], [12, -7], [40, 33], [-55, 80]]) {
      expect(a.heightAt(x, z)).toBeCloseTo(b.heightAt(x, z))
    }
  })

  it('a different seed produces a different shape', () => {
    const a = new Terrain(mulberry32(1))
    const b = new Terrain(mulberry32(2))
    // Some sampled point should differ — they're not the same world.
    const differs = [[10, 10], [30, -20], [-40, 5], [60, 60]].some(
      ([x, z]) => Math.abs(a.heightAt(x, z) - b.heightAt(x, z)) > 0.05,
    )
    expect(differs).toBe(true)
  })

  it('actually has relief (it is not flat everywhere)', () => {
    const t = new Terrain(mulberry32(7))
    let max = 0
    for (let x = -100; x <= 100; x += 5) {
      for (let z = -100; z <= 100; z += 5) {
        max = Math.max(max, Math.abs(t.heightAt(x, z)))
      }
    }
    expect(max).toBeGreaterThan(0.5)
  })

  it('flattens to exactly 0 inside a registered flat zone', () => {
    const t = new Terrain(mulberry32(7))
    t.flatten(0, 0, 10, 12)
    expect(t.heightAt(0, 0)).toBeCloseTo(0)
    expect(t.heightAt(6, 0)).toBeCloseTo(0) // still inside the flat radius
  })

  it('eases back to full hills past a flat zone falloff', () => {
    const t = new Terrain(mulberry32(7))
    t.flatten(60, 60, 4, 8)
    expect(t.heightAt(60, 60)).toBeCloseTo(0) // centre forced flat
    // Out past radius + falloff the height is untouched again.
    const far = 60 + 4 + 8 + 5
    expect(t.heightAt(far, 60)).toBeCloseTo(new Terrain(mulberry32(7)).heightAt(far, 60))
  })

  it('is continuous across a flat-zone edge (no sudden step)', () => {
    const t = new Terrain(mulberry32(7))
    t.flatten(0, 0, 10, 12)
    // Just inside the falloff band the height is still tiny — no cliff at the rim.
    expect(Math.abs(t.heightAt(10.01, 0))).toBeLessThan(0.05)
  })
})
