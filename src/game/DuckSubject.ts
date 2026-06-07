import * as THREE from 'three'
import { buildDuckModel } from './duckModel'
import { type SubjectKind, SUBJECT_KINDS } from './subjectKinds'
import { randRange, seekArrive, pointAround, faceHeading, easeFactor } from './mathUtils'
import { type Collider, resolveWalls } from './collision'
import type { Pond } from './Water'
import type { Food, FoodItem } from './Food'
import type { Nest } from './Nests'
import type { Sound } from './Sound'
import { type Rng, rngRange } from './rng'

// --- Idle wander tuning ----------------------------------------------------
const WANDER_SPEED = 1.5 // top amble speed (units/sec) — slow and unhurried
const RESPONSIVENESS = 4 // how fast velocity eases toward the target (heavy/ducky)
const WANDER_RADIUS = 5 // how far from "home" it picks its next spot
const ARRIVE_RADIUS = 1.5 // start slowing down once this close to the target
const ARRIVE_STOP = 0.3 // close enough — stop and pause
const PAUSE_MIN = 1.0 // shortest idle pause (seconds)
const PAUSE_MAX = 4.0 // longest idle pause

// --- Following tuning ------------------------------------------------------
const FOLLOW_SPEED = 5.5 // a touch slower than the Queen (6) so they trail her
const FOLLOW_RESPONSIVENESS = 7 // snappier than wandering so they keep up
const FOLLOW_RING = 2.2 // they settle this far from the Queen (not on top of her)
const FOLLOW_ARRIVE_BAND = 2.0 // slow down within this band above the ring
const SEP_RADIUS = 1.0 // push apart from flockmates closer than this
const SEP_STRENGTH = 4 // how hard the separation shove is

// --- Chaos tuning (the comedy of governing ducks) --------------------------
const DISTRACT_RATE = 0.12 // per second: chance a follower wanders off briefly
const DISTRACT_MIN = 1.5 // shortest distraction (seconds)
const DISTRACT_MAX = 3.5 // longest distraction
const DISTRACT_NEAR = 2 // nearest a distraction spot can be
const DISTRACT_FAR = 4 // farthest a distraction spot can be
const LOST_DISTANCE = 18 // a subject stranded past this from the Queen gives up
const SCATTER_NEAR = 3 // closest a startled subject's target can be to trouble
const SCATTER_FAR = 6 // farthest a startled subject's target can be to trouble
const SCATTER_MIN = 2.5 // shortest time before a scattered duck regroups
const SCATTER_MAX = 4.0 // longest time before a scattered duck regroups
const SCATTER_SPREAD = 1.1 // radians of random fan-out around "away from trouble"
const SCATTER_SPEED = 4.4 // quick skitter away from conflict, but not a full sprint

// --- Shared waddle ---------------------------------------------------------
const TURN_SPEED = 8 // how fast it rotates to face travel direction
const BOB_HEIGHT = 0.05 // little waddle hop
const ROLL = 0.18 // side-to-side waddle tilt (radians)

// --- Swimming (when over the pond) -----------------------------------------
const SWIM_BOB = 0.04 // gentle float bob — no waddle hop
const SWIM_SWAY = 0.05 // very slight side sway (much less than the waddle wiggle)

// --- Foraging --------------------------------------------------------------
const EAT_RADIUS = 1.0 // close enough to a plant to eat it
const FORAGE_RADIUS = 5 // how far a follower will notice a plant and go for it
const FORAGE_RATE = 0.7 // per second: chance to peel off for an in-range plant
const FORAGE_SPEED = 3 // eager amble toward a snack (quicker than idle wander)

// --- Vocalising ------------------------------------------------------------
const VOICE_RATE = 0.1 // per second: chance to make its call ("now and then")
const SCATTER_VOICE_RATE = 0.65 // startled subjects complain much more often

// --- Nesting (a hen broods on a nest) --------------------------------------
const SIT_RADIUS = 0.25 // how close to the nest centre counts as "settled on it"
const LAY_MIN = 8 // shortest gap between eggs while sitting (seconds)
const LAY_MAX = 16 // longest gap
const SIT_BOB = 0.02 // gentle breathing bob while settled (no waddle)

// --- World collision -------------------------------------------------------
// Footprint vs. trees/rocks, tuned for the duckling and then scaled to a
// subject's actual size (a drake is bigger, so it shoulders obstacles wider).
const BASE_SCALE = 0.4 // the duckling scale the two constants below are tuned for
const COLLIDE_RADIUS = 0.3 // footprint at BASE_SCALE — small, it's little
const COLLIDE_HEIGHT = 0.7 // height at BASE_SCALE; canopies float well above (walk under)

// A subject is always in exactly one of these.
type SubjectState = 'pausing' | 'wandering' | 'following' | 'distracted' | 'foraging' | 'scattered' | 'nesting'

/** What a following subject needs to know about the world each frame: where the
 *  Queen is, and who its flockmates are (so it can avoid bunching up). */
export interface FlockContext {
  queenX: number
  queenZ: number
  flock: DuckSubject[]
}

/**
 * One flock subject — a yellow duckling, or an adult drake / hen. They all behave
 * IDENTICALLY (this whole state machine is shared); the `kind` only swaps the model
 * (palette + size) and the voice. It wanders its home patch until the Queen quacks
 * nearby, then it `follow`s — seeking her with arrival (settling in a ring around
 * her) plus separation from its flockmates so the crowd spreads out.
 */
export class DuckSubject {
  readonly group: THREE.Group

  // Not readonly: when a subject gets "lost", we reset its home to wherever it
  // ended up, so it wanders off from there.
  private homeX: number
  private homeZ: number

  private velX = 0
  private velZ = 0
  private heading = 0
  private bobPhase = 0

  private state: SubjectState = 'pausing'
  private timer: number // counts down the current pause
  private distractTimer = 0 // counts down a distraction
  private targetX = 0
  private targetZ = 0
  private targetFood: FoodItem | null = null // the plant it's foraging toward
  private targetNest: Nest | null = null // the nest a hen is brooding on
  private layTimer = 0 // counts down to the next egg while she's sitting
  private sitting = false // has she actually settled onto the nest yet?

  // Set from its kind (see constructor): overall size, its voice, and a per-
  // individual pitch so the flock sounds like a crowd, not one cloned voice.
  private readonly scale: number
  private readonly voice: (sound: Sound, pitch: number) => void
  private readonly voicePitch: number
  // Collision footprint, scaled to this subject's size (bigger birds, wider).
  private readonly collideRadius: number
  private readonly collideHeight: number

  constructor(
    x: number,
    z: number,
    readonly kind: SubjectKind,
    private readonly pond: Pond,
    private readonly food: Food,
    private readonly sound: Sound,
    private readonly colliders: readonly Collider[],
    rng: Rng,
  ) {
    const def = SUBJECT_KINDS[kind]
    const model = buildDuckModel(def.model)
    this.group = model.group
    this.group.position.set(x, 0, z)
    this.homeX = x
    this.homeZ = z

    this.scale = def.model.scale ?? 1
    this.voice = def.voice
    this.collideRadius = COLLIDE_RADIUS * (this.scale / BASE_SCALE)
    this.collideHeight = COLLIDE_HEIGHT * (this.scale / BASE_SCALE)

    // Spawn-time values come from the seeded rng so the initial world is stable.
    this.voicePitch = rngRange(rng, def.pitch[0], def.pitch[1])
    this.heading = rng() * Math.PI * 2
    this.group.rotation.y = this.heading
    this.timer = randRange(0, PAUSE_MAX) // first-move timing — fine to stay unseeded
  }

  /** Is it one of the Queen's — following, off foraging, briefly distracted, or
   *  scattered? (These all still count as subjects; it'll return.) */
  get isSubject(): boolean {
    return this.state === 'following' || this.state === 'distracted' || this.state === 'foraging' || this.state === 'scattered'
  }

  /** Is she currently brooding on a nest? She's still the Queen's, but off-duty —
   *  she doesn't count toward the rallying flock while she sits. */
  get isNesting(): boolean {
    return this.state === 'nesting'
  }

  /** Called when the Queen quacks a NEW subject in range: fall in behind her.
   *  A brooding hen ignores it — she's busy keeping her eggs warm. */
  recruit(): void {
    if (this.state === 'nesting') return
    this.state = 'following'
  }

  /** The Queen quacked her existing flock: snap back to following, dropping any
   *  foraging or distraction. A brooding hen keeps her post (only a goose moves her). */
  rally(): void {
    if (this.state === 'nesting') return
    this.targetFood = null
    this.state = 'following'
  }

  /** Startle an existing subject away from a conflict point. Scattered subjects
   *  still belong to the Queen, but they won't forage until they regroup. */
  scatterFrom(x: number, z: number): void {
    if (!this.isSubject) return

    const pos = this.group.position
    const dx = pos.x - x
    const dz = pos.z - z
    const base = Math.hypot(dx, dz) > 0.001 ? Math.atan2(dz, dx) : Math.random() * Math.PI * 2
    const angle = base + randRange(-SCATTER_SPREAD, SCATTER_SPREAD)
    const r = randRange(SCATTER_NEAR, SCATTER_FAR)

    this.targetFood = null
    this.targetX = x + Math.cos(angle) * r
    this.targetZ = z + Math.sin(angle) * r
    this.distractTimer = randRange(SCATTER_MIN, SCATTER_MAX)
    this.state = 'scattered'
  }

  /** Send this hen to sit on `nest` and brood: she waddles over, settles, and lays
   *  an egg now and then until something (a goose) startles her off. */
  assignToNest(nest: Nest): void {
    this.targetFood = null
    this.targetNest = nest
    nest.occupied = true
    this.sitting = false
    this.layTimer = randRange(LAY_MIN, LAY_MAX)
    this.state = 'nesting'
  }

  /** Leave the nest (freeing it to be re-seated) and fall back into the flock. */
  leaveNest(): void {
    if (this.targetNest) this.targetNest.occupied = false
    this.targetNest = null
    this.sitting = false
    this.state = 'following'
  }

  update(delta: number, ctx: FlockContext): void {
    // A little call now and then (in its own voice); startled subjects complain
    // more often while they scatter. A brooding hen sits quietly (she only clucks
    // when she lays — see brood()).
    const callRate = this.state === 'scattered' ? SCATTER_VOICE_RATE : VOICE_RATE
    if (this.state !== 'nesting' && Math.random() < callRate * delta) this.voice(this.sound, this.voicePitch)

    switch (this.state) {
      case 'following':
        if (this.checkLost(ctx)) break // stranded too far — gives up
        // Notice a nearby plant and peel off to go gather it...
        if (Math.random() < FORAGE_RATE * delta && this.tryForage()) break
        // ...or, less usefully, get distracted and wander off for a bit.
        if (Math.random() < DISTRACT_RATE * delta) this.startDistraction()
        else this.followQueen(delta, ctx)
        break
      case 'foraging':
        if (this.checkLost(ctx)) break
        this.forage(delta)
        break
      case 'distracted':
        if (this.checkLost(ctx)) break
        this.beDistracted(delta)
        break
      case 'scattered':
        if (this.checkLost(ctx)) break
        this.beScattered(delta)
        break
      case 'nesting':
        this.brood(delta) // walk to the nest, settle, lay eggs — no checkLost
        break
      case 'wandering':
        this.seekTarget(delta)
        break
      case 'pausing':
        this.ease(0, 0, delta) // glide to a stop while waiting
        this.timer -= delta
        if (this.timer <= 0) this.pickNewTarget()
        break
    }

    // --- Apply movement (shared by all states) -----------------------------
    const pos = this.group.position
    pos.x += this.velX * delta
    pos.z += this.velZ * delta

    // Push out of any tree/rock it walked into. stepUp 0 = it doesn't climb, so
    // every obstacle is a wall to waddle around. (Wrap velX/velZ in an {x, z} so
    // the shared resolver can cancel the into-wall velocity, then read it back.)
    const vel = { x: this.velX, z: this.velZ }
    resolveWalls(pos, vel, this.collideRadius, 0, this.collideHeight, 0, this.colliders)
    this.velX = vel.x
    this.velZ = vel.z

    // Eat any plant we've come within reach of — followers only, for now.
    if (this.state === 'following') {
      const plant = this.food.nearestUncollected(pos.x, pos.z, EAT_RADIUS)
      if (plant) this.food.collect(plant)
    }

    // --- Face travel direction + a little waddle ---------------------------
    const speed = Math.hypot(this.velX, this.velZ)
    this.heading = faceHeading(this.heading, this.velX, this.velZ, TURN_SPEED, delta)
    if (this.state === 'nesting' && this.sitting) {
      // Settled on the nest: a calm breathing bob, no waddle hop or sway.
      this.bobPhase += delta * 1.5
      pos.y = Math.sin(this.bobPhase) * SIT_BOB
      this.group.rotation.z = 0
    } else if (this.pond.isWater(pos.x, pos.z)) {
      // Over the pond: float like the Queen — settle at the (scaled) waterline
      // with a slow, gentle bob and sway, and NO waddle hop / side-wiggle.
      this.bobPhase += delta * 3
      pos.y = this.pond.floatLine * this.scale + Math.sin(this.bobPhase) * SWIM_BOB
      this.group.rotation.z = Math.sin(this.bobPhase * 0.7) * SWIM_SWAY
    } else {
      // On land: the little waddle hop + side-to-side tilt, scaled by speed.
      const moveFactor = Math.min(speed / WANDER_SPEED, 1)
      this.bobPhase += delta * (6 + speed * 2)
      pos.y = Math.abs(Math.sin(this.bobPhase)) * BOB_HEIGHT * moveFactor
      this.group.rotation.z = Math.sin(this.bobPhase) * ROLL * moveFactor
    }
    this.group.rotation.y = this.heading
  }

  /** Seek the Queen, settling into a ring around her, while pushing apart from
   *  flockmates so the group spreads into a crowd instead of one stack. */
  private followQueen(delta: number, ctx: FlockContext): void {
    const pos = this.group.position

    // Seek: head for the Queen, but arrive at FOLLOW_RING (not her exact spot),
    // slowing through the arrival band so they don't jostle into her.
    let vx = 0
    let vz = 0
    const dx = ctx.queenX - pos.x
    const dz = ctx.queenZ - pos.z
    const dist = Math.hypot(dx, dz)
    if (dist > FOLLOW_RING) {
      const over = dist - FOLLOW_RING
      const speed = over < FOLLOW_ARRIVE_BAND ? FOLLOW_SPEED * (over / FOLLOW_ARRIVE_BAND) : FOLLOW_SPEED
      vx = (dx / dist) * speed
      vz = (dz / dist) * speed
    }

    // Separation: sum a push away from each too-close flockmate (stronger the
    // closer they are). Classic boids rule — keeps the crowd from overlapping.
    for (const other of ctx.flock) {
      if (other === this) continue
      const ox = pos.x - other.group.position.x
      const oz = pos.z - other.group.position.z
      const d = Math.hypot(ox, oz)
      if (d > 0.0001 && d < SEP_RADIUS) {
        const push = (1 - d / SEP_RADIUS) * SEP_STRENGTH
        vx += (ox / d) * push
        vz += (oz / d) * push
      }
    }

    // Don't let separation overspeed it past its top follow speed.
    const mag = Math.hypot(vx, vz)
    if (mag > FOLLOW_SPEED) {
      vx = (vx / mag) * FOLLOW_SPEED
      vz = (vz / mag) * FOLLOW_SPEED
    }

    this.ease(vx, vz, delta, FOLLOW_RESPONSIVENESS)
  }

  /** If it's drifted too far from the Queen, it gives up and becomes a lost
   *  wanderer again (no longer a subject). Returns true if it just got lost. */
  private checkLost(ctx: FlockContext): boolean {
    const pos = this.group.position
    if (Math.hypot(ctx.queenX - pos.x, ctx.queenZ - pos.z) > LOST_DISTANCE) {
      this.homeX = pos.x // wander off from wherever it ended up
      this.homeZ = pos.z
      this.state = 'pausing'
      this.timer = randRange(PAUSE_MIN, PAUSE_MAX)
      return true
    }
    return false
  }

  /** Pick a nearby spot to be nosy about, and a short timer; then amble there. */
  private startDistraction(): void {
    const pos = this.group.position
    const angle = Math.random() * Math.PI * 2
    const r = randRange(DISTRACT_NEAR, DISTRACT_FAR)
    this.targetX = pos.x + Math.cos(angle) * r
    this.targetZ = pos.z + Math.sin(angle) * r
    this.distractTimer = randRange(DISTRACT_MIN, DISTRACT_MAX)
    this.state = 'distracted'
  }

  /** Amble to the distraction spot; once it arrives or the timer runs out,
   *  curiosity is satisfied and it rejoins the Queen. */
  private beDistracted(delta: number): void {
    this.distractTimer -= delta
    const s = seekArrive(this.group.position, this.targetX, this.targetZ, WANDER_SPEED, ARRIVE_RADIUS, ARRIVE_STOP)
    if (this.distractTimer <= 0 || s.arrived) {
      this.state = 'following' // back to its duties
      return
    }
    this.ease(s.vx, s.vz, delta)
  }

  /** Skitter to the scatter target; after the panic timer, return to following. */
  private beScattered(delta: number): void {
    this.distractTimer -= delta
    const s = seekArrive(this.group.position, this.targetX, this.targetZ, SCATTER_SPEED, ARRIVE_RADIUS, ARRIVE_STOP)
    if (this.distractTimer <= 0) {
      this.state = 'following'
      return
    }
    this.ease(s.vx, s.vz, delta, FOLLOW_RESPONSIVENESS)
  }

  /** Walk to the assigned nest, settle onto it, and lay an egg every so often. */
  private brood(delta: number): void {
    const nest = this.targetNest
    if (!nest) {
      this.state = 'following' // nest somehow gone — rejoin the flock
      return
    }
    const s = seekArrive(this.group.position, nest.x, nest.z, FORAGE_SPEED, ARRIVE_RADIUS, SIT_RADIUS)
    if (!s.arrived) {
      this.sitting = false // still waddling over
      this.ease(s.vx, s.vz, delta)
      return
    }
    // Settled: hold still and lay on a timer.
    this.sitting = true
    this.ease(0, 0, delta)
    this.layTimer -= delta
    if (this.layTimer <= 0) {
      nest.layEgg()
      this.voice(this.sound, this.voicePitch) // a little cluck as the egg appears
      this.layTimer = randRange(LAY_MIN, LAY_MAX)
    }
  }

  /** Look for a plant within FORAGE_RADIUS; if there's one, target it and switch
   *  to foraging. Returns whether it's now off to forage. */
  private tryForage(): boolean {
    const pos = this.group.position
    const plant = this.food.nearestUncollected(pos.x, pos.z, FORAGE_RADIUS)
    if (!plant) return false
    this.targetFood = plant
    this.state = 'foraging'
    return true
  }

  /** Head to the targeted plant and eat it, then rejoin the flock. If the plant
   *  vanished (another duck ate it), just go back to following. */
  private forage(delta: number): void {
    const plant = this.targetFood
    if (!plant || plant.collected) {
      this.targetFood = null
      this.state = 'following'
      return
    }
    const s = seekArrive(this.group.position, plant.x, plant.z, FORAGE_SPEED, ARRIVE_RADIUS, EAT_RADIUS)
    if (s.arrived) {
      this.food.collect(plant) // nom
      this.targetFood = null
      this.state = 'following'
      return
    }
    this.ease(s.vx, s.vz, delta)
  }

  /** Seek the current wander target, slowing on arrival, then pause. */
  private seekTarget(delta: number): void {
    const s = seekArrive(this.group.position, this.targetX, this.targetZ, WANDER_SPEED, ARRIVE_RADIUS, ARRIVE_STOP)
    if (s.arrived) {
      this.state = 'pausing'
      this.timer = randRange(PAUSE_MIN, PAUSE_MAX)
      return
    }
    this.ease(s.vx, s.vz, delta)
  }

  /** Ease the velocity toward a target (vx, vz) — frame-rate-independent. */
  private ease(vx: number, vz: number, delta: number, rate = RESPONSIVENESS): void {
    const t = easeFactor(rate, delta)
    this.velX += (vx - this.velX) * t
    this.velZ += (vz - this.velZ) * t
  }

  private pickNewTarget(): void {
    const p = pointAround(this.homeX, this.homeZ, WANDER_RADIUS)
    this.targetX = p.x
    this.targetZ = p.z
    this.state = 'wandering'
  }
}
