import * as THREE from 'three'
import { DuckSubject, type FlockContext } from './DuckSubject'
import type { DuckMode } from './DuckController'
import type { SubjectKind } from './subjectKinds'
import type { Input } from './Input'
import type { Sound } from './Sound'
import type { Pond } from './Water'
import type { Food } from './Food'
import type { Nest, Nests } from './Nests'
import type { Collider } from './collision'
import type { Rng } from './rng'

// The flock roster: which kinds make up the subjects. A guaranteed mix (so you
// always see some grown mallards), shuffled into random spawn slots by the seed.
const COMPOSITION: SubjectKind[] = [
  'duckling', 'duckling', 'duckling', 'duckling',
  'drake', 'drake',
  'hen', 'hen',
]
const QUACK_RANGE = 12 // a quack recruits idle ducks within this distance
const SCATTER_RANGE = 10 // subjects this close to conflict briefly scatter
const GUARD_RADIUS = 4.5 // adults holding this close to a nest slow a raid
// How many subjects the Queen may lead at once — for now, until she bests the
// Marsh Baron and proves her leadership, which lifts the cap (see liftFollowerCap).
// It sits right at the boss gate (BOSS_MIN_FOLLOWERS), so a full flock is exactly
// enough to challenge him: recruiting and hatching stop here until he's broken.
const FOLLOWER_CAP = 10

/** Game wires this to the HUD so the flock can explain why a duck won't join. */
type OnMessage = (text: string) => void

export interface AllyMarker {
  x: number
  z: number
  kind: SubjectKind
  subject: boolean
  nesting: boolean
  holding: boolean
}

/**
 * The Flock owns all the duck subjects: spawns them, updates them, and turns the
 * Queen's quack into recruitment. Game just calls flock.update(delta) and reads
 * followerCount for the HUD.
 */
export class Flock {
  private readonly members: DuckSubject[] = []
  private wasQuackDown = false // edge-detect the Q key (one quack per press)
  private capLifted = false // set once the Marsh Baron is broken — then no follower cap

  constructor(
    private readonly scene: THREE.Scene,
    private readonly input: Input,
    private readonly queen: THREE.Object3D,
    private readonly sound: Sound,
    private readonly pond: Pond,
    private readonly food: Food,
    private readonly nests: Nests,
    private readonly colliders: readonly Collider[],
    private readonly onMessage: OnMessage,
    rng: Rng,
  ) {
    // Shuffle the roster into random spawn slots, deterministically from the seed
    // (Fisher–Yates). So a given seed always yields the same mix in the same spots.
    const kinds = [...COMPOSITION]
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[kinds[i], kinds[j]] = [kinds[j], kinds[i]]
    }

    for (const kind of kinds) {
      const angle = rng() * Math.PI * 2
      const radius = 6 + rng() * 8
      const subject = new DuckSubject(Math.cos(angle) * radius, Math.sin(angle) * radius, kind, pond, food, this.sound, colliders, rng)
      this.members.push(subject)
      scene.add(subject.group)
    }
  }

  /** How many ducks are currently the Queen's subjects (following or briefly
   *  distracted — a lost duck no longer counts). */
  get subjectCount(): number {
    let n = 0
    for (const d of this.members) if (d.isSubject) n++
    return n
  }

  /** Has the flock hit its leadership cap? (Recruiting + hatching pause here until
   *  the cap is lifted.) A brooding hen is off-duty and doesn't count toward it. */
  get isFull(): boolean {
    return !this.capLifted && this.subjectCount >= FOLLOWER_CAP
  }

  /** The Queen has bested the Marsh Baron: her proven leadership lifts the cap, so
   *  she may gather a flock without limit from here on. */
  liftFollowerCap(): void {
    this.capLifted = true
  }

  /** Current subjects split by kind, for the HUD. Ducklings have no sex (yet);
   *  drakes are the males, hens the females. Brooding hens are tallied separately
   *  (they're off-duty, not in the rallying flock) so they don't look "lost". */
  get subjectBreakdown(): { ducklings: number; males: number; females: number; nesting: number } {
    let ducklings = 0
    let males = 0
    let females = 0
    let nesting = 0
    for (const d of this.members) {
      if (d.isNesting) {
        nesting++
        continue
      }
      if (!d.isSubject) continue
      if (d.kind === 'duckling') ducklings++
      else if (d.kind === 'drake') males++
      else females++
    }
    return { ducklings, males, females, nesting }
  }

  /** The flock's "chorus" for honk-offs: how many active subjects it has, and how
   *  many of the three voices (duckling / drake / hen) are represented. A full
   *  3-voice chorus out-honks a same-size flock of a single kind. */
  get chorus(): { size: number; layers: number } {
    let ducklings = 0
    let males = 0
    let females = 0
    for (const d of this.members) {
      if (!d.supportsChorus) continue
      if (d.kind === 'duckling') ducklings++
      else if (d.kind === 'drake') males++
      else females++
    }
    const size = ducklings + males + females
    const layers = (ducklings > 0 ? 1 : 0) + (males > 0 ? 1 : 0) + (females > 0 ? 1 : 0)
    return { size, layers }
  }

  /** Every hen currently brooding on a nest (so Game can check geese near them). */
  get nestingHens(): DuckSubject[] {
    return this.members.filter((m) => m.isNesting)
  }

  /** Compact positions for HUD/minimap rendering. */
  get minimapAllies(): AllyMarker[] {
    return this.members.map((m) => ({
      x: m.group.position.x,
      z: m.group.position.z,
      kind: m.kind,
      subject: m.isSubject,
      nesting: m.isNesting,
      holding: m.isHoldingHome,
    }))
  }

  /** Calm (non-scattered) supporters split into drakes vs. the rest — for the boss
   *  fight, where drakes anchor and the Baron splits the others off. */
  calmCounts(): { drakes: number; others: number } {
    let drakes = 0
    let others = 0
    for (const m of this.members) {
      if (!m.supportsChorus || m.isNesting) continue
      if (m.kind === 'drake') drakes++
      else others++
    }
    return { drakes, others }
  }

  /** The Baron's splitting honk: scatter every calm NON-drake subject (ducklings
   *  and hens) away from (x, z), leaving only the drake wall to hold the chorus.
   *  Returns how many it scattered (0 = a pure drake host he can't break). */
  splitNonDrakes(x: number, z: number): number {
    let n = 0
    for (const m of this.members) {
      if (m.kind !== 'drake' && m.supportsChorus && !m.isNesting) {
        m.scatterFrom(x, z)
        n++
      }
    }
    return n
  }

  /** The nearest following hen — one available to send off to a nest — or null.
   *  (A lost or already-nesting hen doesn't count.) */
  nearestFollowingHen(x: number, z: number): DuckSubject | null {
    let best: DuckSubject | null = null
    let bestSq = Infinity
    for (const m of this.members) {
      if (m.kind !== 'hen' || !m.isSubject) continue
      const dSq = (m.group.position.x - x) ** 2 + (m.group.position.z - z) ** 2
      if (dSq < bestSq) {
        bestSq = dSq
        best = m
      }
    }
    return best
  }

  /** A nest egg hatched: a new duckling pops out at (x, z) and falls in behind the
   *  Queen — hers from birth. Hatching is gameplay, so the newborn draws its voice
   *  and heading from Math.random, NOT the seeded world rng. */
  hatchAt(x: number, z: number): void {
    const duckling = new DuckSubject(x, z, 'duckling', this.pond, this.food, this.sound, this.colliders, Math.random)
    duckling.recruit() // it's the Queen's already — start it following her
    this.members.push(duckling)
    this.scene.add(duckling.group)
  }

  /** The ducklings old enough to grow up right now (Game checks they can be fed). */
  maturableDucklings(): DuckSubject[] {
    return this.members.filter((m) => m.isReadyToMature)
  }

  /** Grow a ready duckling up: replace it in place with a fresh adult — a random
   *  drake or hen, hers and following, at the same spot — and free the old model. */
  matureToAdult(duckling: DuckSubject): void {
    const kind: SubjectKind = Math.random() < 0.5 ? 'drake' : 'hen'
    const pos = duckling.group.position
    const adult = new DuckSubject(pos.x, pos.z, kind, this.pond, this.food, this.sound, this.colliders, Math.random)
    adult.recruit()

    const idx = this.members.indexOf(duckling)
    if (idx >= 0) this.members[idx] = adult
    else this.members.push(adult)
    this.scene.remove(duckling.group)
    duckling.dispose()
    this.scene.add(adult.group)

    // A first call in its new grown-up voice.
    if (kind === 'drake') this.sound.drakeCall()
    else this.sound.henQuack()
  }

  /** Scatter current subjects near a conflict point. They still count as hers,
   *  just briefly panic-skitter before following again. */
  scatterFrom(x: number, z: number): void {
    for (const d of this.members) {
      if (!d.isSubject) continue
      const pos = d.group.position
      if (Math.hypot(pos.x - x, pos.z - z) <= SCATTER_RANGE) d.scatterFrom(x, z)
    }
  }

  /** Ratio of current subjects within `radius` of the Queen. With no subjects,
   *  treat the flock as fully regrouped so callers don't divide by zero. */
  regroupedRatio(radius: number): number {
    const qx = this.queen.position.x
    const qz = this.queen.position.z
    let subjects = 0
    let nearby = 0

    for (const d of this.members) {
      if (!d.isSubject) continue
      subjects++
      const pos = d.group.position
      if (Math.hypot(pos.x - qx, pos.z - qz) <= radius) nearby++
    }

    return subjects === 0 ? 1 : nearby / subjects
  }

  /** Adults posted near a nest buy the brooding hen more time before a goose can
   *  scare her off. This is a first-pass guard job: presence and alarm, not combat. */
  guardCoverage(nest: Nest): number {
    let n = 0
    for (const d of this.members) if (d.guardsNest(nest, GUARD_RADIUS)) n++
    return n
  }

  update(delta: number, queenMode: DuckMode): void {
    this.handleQuack()

    // The shared context each follower needs: where the Queen is + who the
    // flockmates are (for separation), plus the home/nest memory used when the
    // Queen leaves them to hold the pond.
    const home = this.homeAnchor()
    const ctx: FlockContext = {
      queenX: this.queen.position.x,
      queenZ: this.queen.position.z,
      queenMode,
      homeX: home.x,
      homeZ: home.z,
      nests: this.nests.all,
      flock: this.members,
    }
    for (const subject of this.members) {
      subject.update(delta, ctx)
    }
  }

  /** On a fresh Q press: recall the existing flock (interrupting any foraging /
   *  distraction so they fall back in behind her), AND recruit any new ducks in
   *  range. So a quack is both "come here" to strangers and "to me!" to her own. */
  private handleQuack(): void {
    const down = this.input.isDown('KeyQ')
    if (down && !this.wasQuackDown) {
      this.sound.quack() // the Queen quacks — even if no ducks are in earshot

      const qx = this.queen.position.x
      const qz = this.queen.position.z
      let turnedAway = false // a duck in range she couldn't take (flock full)
      for (const d of this.members) {
        if (d.isSubject) {
          d.rally() // already hers — snap her back to following
        } else {
          const dist = Math.hypot(d.group.position.x - qx, d.group.position.z - qz)
          if (dist > QUACK_RANGE) continue
          if (this.isFull) turnedAway = true // no room — but keep checking the rest
          else d.recruit()
        }
      }
      if (turnedAway) {
        this.onMessage(`🦆 Your flock is full (${FOLLOWER_CAP}) — break the Marsh Baron to lead more`)
      }
    }
    this.wasQuackDown = down
  }

  private homeAnchor(): { x: number; z: number } {
    const anchor = this.flockAnchorPoint()
    const occupied = this.nearestNestTo(anchor.x, anchor.z, true)
    if (occupied) return { x: occupied.x, z: occupied.z }
    const nest = this.nearestNestTo(anchor.x, anchor.z, null)
    if (nest) return { x: nest.x, z: nest.z }
    return { x: this.pond.centerX, z: this.pond.centerZ }
  }

  private flockAnchorPoint(): { x: number; z: number } {
    let x = 0
    let z = 0
    let n = 0
    for (const d of this.members) {
      if (!d.isSubject) continue
      x += d.group.position.x
      z += d.group.position.z
      n++
    }
    if (n === 0) return { x: this.queen.position.x, z: this.queen.position.z }
    return { x: x / n, z: z / n }
  }

  private nearestNestTo(x: number, z: number, occupied: boolean | null): Nest | null {
    let best: Nest | null = null
    let bestSq = Infinity
    for (const nest of this.nests.all) {
      if (occupied !== null && nest.occupied !== occupied) continue
      const dSq = (nest.x - x) ** 2 + (nest.z - z) ** 2
      if (dSq < bestSq) {
        bestSq = dSq
        best = nest
      }
    }
    return best
  }
}
