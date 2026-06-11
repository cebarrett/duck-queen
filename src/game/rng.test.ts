import { describe, it, expect } from 'vitest'
import { mulberry32, deriveRng, rngRange } from './rng'

// The whole "same seed = same world" promise rests on this file. These tests
// pin down that promise so a future refactor can't quietly break it.

describe('mulberry32', () => {
  it('is deterministic: same seed -> same stream', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const streamA = [a(), a(), a(), a()]
    const streamB = [b(), b(), b(), b()]
    expect(streamA).toEqual(streamB)
  })

  it('produces different streams for different seeds', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    expect(a()).not.toEqual(b())
  })

  it('stays within [0, 1)', () => {
    const r = mulberry32(12345)
    for (let i = 0; i < 1000; i++) {
      const v = r()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })
})

describe('deriveRng', () => {
  it('gives a stable stream for a given (seed, key)', () => {
    const a = deriveRng(7, 'scenery')
    const b = deriveRng(7, 'scenery')
    expect([a(), a(), a()]).toEqual([b(), b(), b()])
  })

  it('gives INDEPENDENT streams for different keys under the same seed', () => {
    // This is the load-bearing property: adding/removing one subsystem must not
    // shift any other subsystem's layout.
    const scenery = deriveRng(7, 'scenery')
    const food = deriveRng(7, 'food')
    expect(scenery()).not.toEqual(food())
  })

  it('changes the stream when the world seed changes', () => {
    const a = deriveRng(7, 'scenery')
    const b = deriveRng(8, 'scenery')
    expect(a()).not.toEqual(b())
  })
})

describe('rngRange', () => {
  it('maps a generator into [min, max)', () => {
    const r = mulberry32(99)
    for (let i = 0; i < 500; i++) {
      const v = rngRange(r, 10, 20)
      expect(v).toBeGreaterThanOrEqual(10)
      expect(v).toBeLessThan(20)
    }
  })

  it('returns exactly min when the generator yields 0', () => {
    const zero = () => 0
    expect(rngRange(zero, 5, 9)).toBe(5)
  })
})
