import { type DuckModelOptions, MALLARD_DRAKE, MALLARD_HEN, YELLOW_DUCKLING } from './duckModel'
import type { Sound } from './Sound'
import type { Rng } from './rng'

/**
 * The three flavours of flock subject. They behave IDENTICALLY (all share the one
 * DuckSubject state machine) — a kind only decides how a subject looks (model
 * palette + size) and what noise it makes. Add a kind here and it can be spawned
 * with no behaviour changes elsewhere.
 */
export type SubjectKind = 'duckling' | 'drake' | 'hen'

export interface SubjectKindDef {
  /** Colours + size handed straight to buildDuckModel. */
  model: DuckModelOptions
  /** Pitch range; each individual draws one (seeded) so the flock sounds varied. */
  pitch: [number, number]
  /** Make this kind's call at the given pitch. */
  voice: (sound: Sound, pitch: number, distance?: number) => number
}

export const SUBJECT_KINDS: Record<SubjectKind, SubjectKindDef> = {
  // The little ones: yellow, small, peeping.
  duckling: {
    model: { ...YELLOW_DUCKLING, scale: 0.4 },
    pitch: [0.85, 1.25],
    voice: (s, p, distance) => s.peep(p, { distance }),
  },
  // Adult male mallard: green head, bigger than a duckling, a soft reedy call.
  drake: {
    model: { ...MALLARD_DRAKE, scale: 0.75 },
    pitch: [0.8, 1.05],
    voice: (s, p, distance) => s.drakeCall(p, { distance }),
  },
  // Adult female mallard: mottled brown, bigger, a rounded quack.
  hen: {
    model: { ...MALLARD_HEN, scale: 0.72 },
    pitch: [0.95, 1.2],
    voice: (s, p, distance) => s.henQuack(p, { distance }),
  },
}

/**
 * Court names for the roster, one pool per kind: stately titles for the grown
 * drakes and hens, and small cosy names for the ducklings. A subject draws one at
 * birth so the royal flock roster reads like a list of named subjects rather than
 * a tally. Purely cosmetic — names never touch world generation or behaviour.
 */
export const SUBJECT_NAMES: Record<SubjectKind, readonly string[]> = {
  duckling: [
    'Pip', 'Waddles', 'Squeak', 'Nibble', 'Tuft', 'Bram', 'Puff', 'Dot',
    'Sprout', 'Fuzz', 'Bubbles', 'Pebble', 'Wren', 'Quill', 'Tiny', 'Mossy',
    'Sunny', 'Biscuit', 'Sniffle', 'Dewdrop',
  ],
  drake: [
    'Sir Mallard', 'Duke Pondsworth', 'Lord Featherby', 'Baron Quillton',
    'Sir Greencrest', 'Earl Dabbleton', 'Sir Paddington', 'Lord Reedwick',
    'Count Quackmore', 'Sir Bartholo', 'Duke Wetherby', 'Lord Marshall',
    'Sir Drakeworth', 'Baron Tealby', 'Sir Plumington', 'Lord Billsby',
  ],
  hen: [
    'Dame Quackleton', 'Lady Featherton', 'Duchess Pondella', 'Lady Mottlewing',
    'Dame Reedmore', 'Lady Brindle', 'Countess Dabbler', 'Dame Henrietta',
    'Lady Marshmallow', 'Dame Pricilla', 'Lady Wadsworth', 'Duchess Quillford',
    'Dame Esther', 'Lady Plumtree', 'Dame Goslina', 'Lady Tealwing',
  ],
}

/** Draw a court name for a new subject of `kind` from a randomness source. The
 *  seeded world rng keeps the starting flock's names stable per seed; hatched and
 *  matured subjects pass Math.random, since they're born during play. */
export function subjectName(kind: SubjectKind, rand: Rng): string {
  const pool = SUBJECT_NAMES[kind]
  return pool[Math.floor(rand() * pool.length)]
}

/**
 * A duckling's little quirk — the one thing that makes it more than an interchangeable
 * yellow blob. A duckling draws one at birth and keeps it for life, even after it grows
 * up into a drake or hen. Ducks that are born straight into adulthood have none. Each
 * trait gently nudges one behaviour (see DuckSubject) and shows in the royal roster.
 */
export type DucklingTrait = 'fastForager' | 'fastRunner' | 'loudHonker'

/** How each trait is badged in the roster window. Reused by the picker below. */
export const DUCKLING_TRAITS: readonly { id: DucklingTrait; icon: string; label: string }[] = [
  { id: 'fastForager', icon: '🌿', label: 'Fast forager' },
  { id: 'fastRunner', icon: '🏃', label: 'Fast runner' },
  { id: 'loudHonker', icon: '📣', label: 'Loud honker' },
]

/** Draw a trait for a new duckling, the same way names are drawn: the seeded world rng
 *  keeps the starting flock's quirks stable per seed; hatched ducklings pass Math.random. */
export function subjectTrait(rand: Rng): DucklingTrait {
  return DUCKLING_TRAITS[Math.floor(rand() * DUCKLING_TRAITS.length)].id
}
