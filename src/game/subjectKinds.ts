import { type DuckModelOptions, MALLARD_DRAKE, MALLARD_HEN } from './duckModel'
import type { Sound } from './Sound'

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
  voice: (sound: Sound, pitch: number) => void
}

const DUCKLING_YELLOW = 0xffe680 // small + yellow so the babies read as "hers"

export const SUBJECT_KINDS: Record<SubjectKind, SubjectKindDef> = {
  // The little ones: yellow, small, peeping.
  duckling: {
    model: { featherColor: DUCKLING_YELLOW, scale: 0.4 },
    pitch: [0.85, 1.25],
    voice: (s, p) => s.peep(p),
  },
  // Adult male mallard: green head, bigger than a duckling, a soft reedy call.
  drake: {
    model: { ...MALLARD_DRAKE, scale: 0.75 },
    pitch: [0.8, 1.05],
    voice: (s, p) => s.drakeCall(p),
  },
  // Adult female mallard: mottled brown, bigger, a rounded quack.
  hen: {
    model: { ...MALLARD_HEN, scale: 0.72 },
    pitch: [0.95, 1.2],
    voice: (s, p) => s.henQuack(p),
  },
}
