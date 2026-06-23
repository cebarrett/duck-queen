import * as THREE from 'three'
import { DuckSubject, type FlockContext, type SubjectActivity } from './DuckSubject'
import type { DuckMode } from './DuckController'
import type { SubjectKind, DucklingTrait } from './subjectKinds'
import type { Input } from './Input'
import type { Sound } from './Sound'
import type { Pond, PondCircle } from './Water'
import type { Food } from './Food'
import type { Nest, Nests } from './Nests'
import type { Collider } from './collision'
import type { Rng } from './rng'
import { FOLLOWER_CAP, type Progress } from './Progress'
import type { SubjectSlice } from './persistence/saveSchema'
import { TREATY_FLATS } from './Biomes'

// The generated flock starts as a handful of adult mallard couples, not a crowd of
// ducklings around the Queen. Each pair spawns together; the pairs themselves are
// scattered through the broader marsh so finding subjects is an exploration beat.
const STARTING_PAIR_COUNT = 5
const STARTING_PAIR_SPREAD = 105
const STARTING_PAIR_MIN_DIST = 24
const STARTING_PAIR_MAX_DIST = 112
const STARTING_PAIR_GAP = 1.55
const STARTING_PAIR_CLEARANCE = 16
const STARTING_PAIR_WATER_MARGIN = 1.2
const STARTING_PAIR_COLLIDER_MARGIN = 1.2
const STARTING_PAIR_TREATY_CLEAR = TREATY_FLATS.radius + 7
const OPENING_GAGGLE_X = 0
const OPENING_GAGGLE_Z = -50
const STARTING_PAIR_GAGGLE_CLEAR = 18
const MARSH_BARON_X = 0
const MARSH_BARON_Z = -72
const STARTING_PAIR_BARON_CLEAR = 15
const QUACK_RANGE = 12 // a quack recruits idle ducks within this distance
const SCATTER_RANGE = 10 // subjects this close to conflict briefly scatter
const GUARD_RADIUS = 4.5 // adults holding this close to a nest slow a raid
const HONKOFF_CHORUS_RANGE = 13 // visible/audio responders near the Queen
const HONKOFF_MAX_VOICES = 6 // keep the chorus cute instead of a wall of samples

interface StartingPairSpot {
  drake: { x: number; z: number }
  hen: { x: number; z: number }
}

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

/** One named subject's line in the royal flock roster window. */
export interface RosterEntry {
  name: string
  kind: SubjectKind
  activity: SubjectActivity
  trait: DucklingTrait | null
}

/**
 * The Flock owns all the duck subjects: spawns them, updates them, and turns the
 * Queen's quack into recruitment. Game just calls flock.update(delta) and reads
 * followerCount for the HUD.
 */
export class Flock {
  private readonly members: DuckSubject[] = []
  // The reclaimed frontier ponds the flock may treat as home water (set by Game).
  private reclaimedPonds: () => readonly PondCircle[] = () => []
  private honkOffTarget: { x: number; z: number } | null = null

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
    private readonly onQueenQuack: (duration: number) => void,
    private readonly progress: Progress,
    rng: Rng,
  ) {
    const spots = this.pickStartingPairSpots(rng)
    for (const spot of spots) {
      const drake = new DuckSubject(spot.drake.x, spot.drake.z, 'drake', pond, food, this.sound, this.queen, colliders, rng)
      const hen = new DuckSubject(spot.hen.x, spot.hen.z, 'hen', pond, food, this.sound, this.queen, colliders, rng)
      this.members.push(drake, hen)
      scene.add(drake.group)
      scene.add(hen.group)
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
   *  the Baron is broken.) A brooding hen is off-duty and doesn't count toward it. */
  get isFull(): boolean {
    return !this.progress.baronDefeated && this.subjectCount >= FOLLOWER_CAP
  }

  /** Tell the flock which outlying ponds the Queen has reclaimed, so a flock left
   *  far from home can hold a nearby reclaimed pond instead of trekking back. */
  setReclaimedPonds(provider: () => readonly PondCircle[]): void {
    this.reclaimedPonds = provider
  }

  setHonkOffTarget(active: boolean, x = 0, z = 0): void {
    this.honkOffTarget = active ? { x, z } : null
  }

  /** Snapshot every subject. `nestIndexOf` maps a brooding hen's nest to its index so
   *  restore can re-seat her. */
  toSave(nestIndexOf: (nest: Nest) => number): { subjects: SubjectSlice[] } {
    return { subjects: this.members.map((m) => m.toSave(nestIndexOf)) }
  }

  /** Replace the seed-spawned roster with the saved one. The live roster diverges from
   *  the seed over play (ducklings mature into adults, eggs hatch into new ducklings)
   *  and a subject's kind is fixed at construction, so we rebuild from scratch rather
   *  than reconcile. `nestForIndex` resolves a saved nestIndex back to the live Nest
   *  (nests are restored before the flock), so a brooding hen re-settles on her nest. */
  restore(slice: { subjects: SubjectSlice[] }, nestForIndex: (i: number | null) => Nest | null): void {
    for (const m of this.members) {
      this.scene.remove(m.group)
      m.dispose()
    }
    this.members.length = 0

    for (const s of slice.subjects) {
      const subject = new DuckSubject(s.x, s.z, s.kind, this.pond, this.food, this.sound, this.queen, this.colliders, Math.random, s.trait ?? null, s.appearanceSeed)
      subject.restore(s)
      this.members.push(subject)
      this.scene.add(subject.group)
      if (s.nesting) {
        const nest = nestForIndex(s.nestIndex)
        if (nest && !nest.occupied) subject.assignToNest(nest)
      }
    }
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

  /** Every named subject for the royal flock roster window — each drake, hen, and
   *  duckling the Queen currently leads (brooding hens included; lost ducks not).
   *  Ordered drakes, then hens, then ducklings so the window groups cleanly. */
  get roster(): RosterEntry[] {
    const order: Record<SubjectKind, number> = { drake: 0, hen: 1, duckling: 2 }
    return this.members
      .filter((m) => m.inRoster)
      .map((m) => ({ name: m.name, kind: m.kind, activity: m.activity, trait: m.trait }))
      .sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name))
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

  /** The hen brooding on (or walking to) `nest`, or null — used to rouse her off it. */
  henOnNest(nest: Nest): DuckSubject | null {
    return nest.brooder
  }

  /** A nest egg hatched: a new duckling pops out at (x, z) and falls in behind the
   *  Queen — hers from birth. Hatching is gameplay, so the newborn draws its voice
   *  and heading from Math.random, NOT the seeded world rng. */
  hatchAt(x: number, z: number): void {
    const duckling = new DuckSubject(x, z, 'duckling', this.pond, this.food, this.sound, this.queen, this.colliders, Math.random)
    duckling.recruit() // it's the Queen's already — start it following her
    this.members.push(duckling)
    this.scene.add(duckling.group)
    duckling.vocalize()
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
    // The grown duck carries the quirk it had as a duckling.
    const adult = new DuckSubject(pos.x, pos.z, kind, this.pond, this.food, this.sound, this.queen, this.colliders, Math.random, duckling.trait)
    adult.recruit()

    const idx = this.members.indexOf(duckling)
    if (idx >= 0) this.members[idx] = adult
    else this.members.push(adult)
    this.scene.remove(duckling.group)
    duckling.dispose()
    this.scene.add(adult.group)

    // A first call in its new grown-up voice.
    adult.vocalize()
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

  /** A lost honk-off breaks the whole active chorus: every calm supporter who was
   *  lending a voice bolts away, not just the ducks standing beside the goose. */
  scatterChorusFrom(x: number, z: number): void {
    for (const d of this.members) {
      if (d.supportsChorus) d.scatterFrom(x, z)
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
      honkOffTarget: this.honkOffTarget,
    }
    for (const subject of this.members) {
      subject.update(delta, ctx)
    }
  }

  /** On a fresh Q press: recall the existing flock (interrupting any foraging /
   *  distraction so they fall back in behind her), AND recruit any new ducks in
   *  range. So a quack is both "come here" to strangers and "to me!" to her own. */
  private handleQuack(): void {
    if (!this.input.justPressedAction('quack')) return
    const duration = this.sound.quack() // the Queen quacks — even if no ducks are in earshot
    this.onQueenQuack(duration)

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
    if (this.honkOffTarget) this.cueHonkOffChorus()
  }

  private cueHonkOffChorus(): void {
    const qx = this.queen.position.x
    const qz = this.queen.position.z
    let voices = 0
    for (const d of this.members) {
      if (!d.supportsChorus) continue
      const pos = d.group.position
      if (Math.hypot(pos.x - qx, pos.z - qz) > HONKOFF_CHORUS_RANGE) continue
      const vocal = voices < HONKOFF_MAX_VOICES && Math.random() < 0.72
      d.cheerHonkOff(vocal)
      if (vocal) voices++
    }
  }

  private homeAnchor(): { x: number; z: number } {
    const anchor = this.flockAnchorPoint()
    const occupied = this.nearestNestTo(anchor.x, anchor.z, true)
    if (occupied) return { x: occupied.x, z: occupied.z }
    const nest = this.nearestNestTo(anchor.x, anchor.z, null)
    if (nest) return { x: nest.x, z: nest.z }
    // No nests to gather around: hold the nearest water the Queendom controls — a
    // reclaimed frontier pond if one is closer to the flock than the home pond.
    return this.nearestHomeWater(anchor.x, anchor.z)
  }

  /** The closest water the flock calls home: the main pond, or a nearer reclaimed
   *  frontier pond if there is one. */
  private nearestHomeWater(x: number, z: number): { x: number; z: number } {
    let bestX = this.pond.centerX
    let bestZ = this.pond.centerZ
    let bestSq = (bestX - x) ** 2 + (bestZ - z) ** 2
    for (const pond of this.reclaimedPonds()) {
      const dSq = (pond.x - x) ** 2 + (pond.z - z) ** 2
      if (dSq < bestSq) {
        bestSq = dSq
        bestX = pond.x
        bestZ = pond.z
      }
    }
    return { x: bestX, z: bestZ }
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

  private pickStartingPairSpots(rng: Rng): StartingPairSpot[] {
    const spots: StartingPairSpot[] = []
    for (let i = 0; i < STARTING_PAIR_COUNT; i++) {
      const spot = this.pickStartingPairSpot(rng, spots)
      if (!spot) break
      spots.push(spot)
    }
    return spots
  }

  private pickStartingPairSpot(rng: Rng, existing: readonly StartingPairSpot[]): StartingPairSpot | null {
    for (let guard = 0; guard < 800; guard++) {
      const x = (rng() * 2 - 1) * STARTING_PAIR_SPREAD
      const z = (rng() * 2 - 1) * STARTING_PAIR_SPREAD
      const distFromSpawn = Math.hypot(x, z)
      if (distFromSpawn < STARTING_PAIR_MIN_DIST || distFromSpawn > STARTING_PAIR_MAX_DIST) continue
      if (Math.hypot(x - OPENING_GAGGLE_X, z - OPENING_GAGGLE_Z) < STARTING_PAIR_GAGGLE_CLEAR) continue
      if (Math.hypot(x - TREATY_FLATS.x, z - TREATY_FLATS.z) < STARTING_PAIR_TREATY_CLEAR) continue
      if (Math.hypot(x - MARSH_BARON_X, z - MARSH_BARON_Z) < STARTING_PAIR_BARON_CLEAR) continue
      if (this.tooCloseToExistingPair(x, z, existing)) continue

      const angle = rng() * Math.PI * 2
      const dx = Math.cos(angle) * STARTING_PAIR_GAP * 0.5
      const dz = Math.sin(angle) * STARTING_PAIR_GAP * 0.5
      const drakeFirst = rng() < 0.5
      const a = { x: x + dx, z: z + dz }
      const b = { x: x - dx, z: z - dz }
      if (!this.isGoodStartingSpot(a.x, a.z) || !this.isGoodStartingSpot(b.x, b.z)) continue
      return drakeFirst ? { drake: a, hen: b } : { drake: b, hen: a }
    }
    return null
  }

  private isGoodStartingSpot(x: number, z: number): boolean {
    if (this.pond.overlaps(x, z, STARTING_PAIR_WATER_MARGIN)) return false
    for (const c of this.colliders) {
      if (Math.hypot(x - c.x, z - c.z) < c.radius + STARTING_PAIR_COLLIDER_MARGIN) return false
    }
    return true
  }

  private tooCloseToExistingPair(x: number, z: number, existing: readonly StartingPairSpot[]): boolean {
    for (const pair of existing) {
      const cx = (pair.drake.x + pair.hen.x) * 0.5
      const cz = (pair.drake.z + pair.hen.z) * 0.5
      if (Math.hypot(x - cx, z - cz) < STARTING_PAIR_CLEARANCE) return true
    }
    return false
  }
}
