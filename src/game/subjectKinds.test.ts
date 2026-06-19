import { describe, it, expect } from 'vitest'
import { deriveRng } from './rng'
import { DUCKLING_TRAITS, subjectName, subjectTrait } from './subjectKinds'

// Traits, like names, are drawn from the seeded world rng so a given seed always
// yields the same individualized flock. These tests pin that promise down.

describe('subjectTrait', () => {
  it('only ever returns one of the defined trait ids', () => {
    const ids = DUCKLING_TRAITS.map((t) => t.id)
    const rng = deriveRng(7, 'flock')
    for (let i = 0; i < 500; i++) {
      expect(ids).toContain(subjectTrait(rng))
    }
  })

  it('is deterministic: same seeded stream -> same sequence of traits', () => {
    const a = deriveRng(42, 'flock')
    const b = deriveRng(42, 'flock')
    const seqA = [subjectTrait(a), subjectTrait(a), subjectTrait(a), subjectTrait(a)]
    const seqB = [subjectTrait(b), subjectTrait(b), subjectTrait(b), subjectTrait(b)]
    expect(seqA).toEqual(seqB)
  })

  it('draws each trait at least once across many seeds (the pool is reachable)', () => {
    const seen = new Set<string>()
    for (let seed = 0; seen.size < DUCKLING_TRAITS.length && seed < 200; seed++) {
      seen.add(subjectTrait(deriveRng(seed, 'flock')))
    }
    expect(seen.size).toBe(DUCKLING_TRAITS.length)
  })
})

describe('subjectName', () => {
  it('is deterministic for a given seeded stream', () => {
    const a = deriveRng(3, 'flock')
    const b = deriveRng(3, 'flock')
    expect(subjectName('duckling', a)).toEqual(subjectName('duckling', b))
  })
})
