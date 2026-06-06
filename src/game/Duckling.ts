import * as THREE from 'three'
import { buildDuckModel } from './duckModel'
import { approachAngle, randRange } from './mathUtils'
import { type Collider, resolveWalls } from './collision'
import type { Pond } from './Water'
import type { Food, FoodItem } from './Food'
import type { Sound } from './Sound'
import { type Rng, rngRange } from './rng'

// Subjects are smaller than the Queen and duckling-yellow so they read as "hers"
// at a glance (vs. her white).
const DUCKLING_COLOR = 0xffe680
const DUCKLING_SCALE = 0.4

// --- Idle wander tuning ----------------------------------------------------
const WANDER_SPEED = 1.5 // top amble speed (units/sec) — slow and unhurried
const RESPONSIVENESS = 4 // how fast velocity eases toward the target (heavy/ducky)
const WANDER_RADIUS = 5 // how far from "home" she picks her next spot
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

// --- Shared waddle ---------------------------------------------------------
const TURN_SPEED = 8 // how fast she rotates to face travel direction
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

// --- Peeping ---------------------------------------------------------------
const PEEP_RATE = 0.1 // per second: chance to let out a little peep ("now and then")

// --- World collision -------------------------------------------------------
const COLLIDE_RADIUS = 0.3 // her footprint vs. trees/rocks — small, she's little
const COLLIDE_HEIGHT = 0.7 // her height; canopies float well above this (walk under)

// A duckling is always in exactly one of these.
type DucklingState = 'pausing' | 'wandering' | 'following' | 'distracted' | 'foraging'

/** What a following duckling needs to know about the world each frame: where the
 *  Queen is, and who its flockmates are (so it can avoid bunching up). */
export interface FlockContext {
  queenX: number
  queenZ: number
  flock: Duckling[]
}

/**
 * One duck subject. It wanders its home patch until the Queen quacks nearby, then
 * it `follow`s — seeking her with arrival (settling in a ring around her) plus
 * separation from its flockmates so the crowd spreads out instead of stacking.
 */
export class Duckling {
  readonly group: THREE.Group

  // Not readonly: when a duck gets "lost", we reset its home to wherever it
  // ended up, so it wanders off from there.
  private homeX: number
  private homeZ: number

  private velX = 0
  private velZ = 0
  private heading = 0
  private bobPhase = 0

  private state: DucklingState = 'pausing'
  private timer: number // counts down the current pause
  private distractTimer = 0 // counts down a distraction
  private targetX = 0
  private targetZ = 0
  private targetFood: FoodItem | null = null // the plant she's foraging toward

  // Each duckling gets its own peep pitch, so the flock sounds like a crowd of
  // little individuals rather than one cloned voice. Seeded (see constructor).
  private readonly peepPitch: number

  constructor(
    x: number,
    z: number,
    private readonly pond: Pond,
    private readonly food: Food,
    private readonly sound: Sound,
    private readonly colliders: readonly Collider[],
    rng: Rng,
  ) {
    const model = buildDuckModel({
      featherColor: DUCKLING_COLOR,
      crown: false,
      scale: DUCKLING_SCALE,
    })
    this.group = model.group
    this.group.position.set(x, 0, z)
    this.homeX = x
    this.homeZ = z

    // Spawn-time values come from the seeded rng so the initial world is stable.
    this.peepPitch = rngRange(rng, 0.85, 1.25)
    this.heading = rng() * Math.PI * 2
    this.group.rotation.y = this.heading
    this.timer = randRange(0, PAUSE_MAX) // first-move timing — fine to stay unseeded
  }

  /** Is she one of the Queen's — following, off foraging, or briefly distracted?
   *  (All three still count as subjects; she'll return.) */
  get isSubject(): boolean {
    return this.state === 'following' || this.state === 'distracted' || this.state === 'foraging'
  }

  /** Called when the Queen quacks a NEW duck in range: fall in behind her. */
  recruit(): void {
    this.state = 'following'
  }

  /** The Queen quacked her existing flock: snap back to following, dropping any
   *  foraging or distraction. This is the "to me!" recall. */
  rally(): void {
    this.targetFood = null
    this.state = 'following'
  }

  update(delta: number, ctx: FlockContext): void {
    // A cute little peep now and then (in her own voice).
    if (Math.random() < PEEP_RATE * delta) this.sound.peep(this.peepPitch)

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

    // Push out of any tree/rock she walked into. stepUp 0 = she doesn't climb, so
    // every obstacle is a wall to waddle around. (Wrap velX/velZ in an {x, z} so
    // the shared resolver can cancel the into-wall velocity, then read it back.)
    const vel = { x: this.velX, z: this.velZ }
    resolveWalls(pos, vel, COLLIDE_RADIUS, 0, COLLIDE_HEIGHT, 0, this.colliders)
    this.velX = vel.x
    this.velZ = vel.z

    // Eat any plant we've come within reach of — followers only, for now.
    // (Step 3 will make them actively seek food out instead of just bumping it.)
    if (this.state === 'following') {
      const plant = this.food.nearestUncollected(pos.x, pos.z, EAT_RADIUS)
      if (plant) this.food.collect(plant)
    }

    // --- Face travel direction + a little waddle ---------------------------
    const speed = Math.hypot(this.velX, this.velZ)
    if (speed > 0.05) {
      const targetHeading = Math.atan2(-this.velX, -this.velZ) // she faces -Z at 0
      this.heading = approachAngle(this.heading, targetHeading, TURN_SPEED * delta)
    }
    if (this.pond.isWater(pos.x, pos.z)) {
      // Over the pond: float like the Queen — settle at the (scaled) waterline
      // with a slow, gentle bob and sway, and NO waddle hop / side-wiggle.
      this.bobPhase += delta * 3
      pos.y = this.pond.floatLine * DUCKLING_SCALE + Math.sin(this.bobPhase) * SWIM_BOB
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

    // Don't let separation overspeed her past her top follow speed.
    const mag = Math.hypot(vx, vz)
    if (mag > FOLLOW_SPEED) {
      vx = (vx / mag) * FOLLOW_SPEED
      vz = (vz / mag) * FOLLOW_SPEED
    }

    this.ease(vx, vz, delta, FOLLOW_RESPONSIVENESS)
  }

  /** If she's drifted too far from the Queen, she gives up and becomes a lost
   *  wanderer again (no longer a subject). Returns true if she just got lost. */
  private checkLost(ctx: FlockContext): boolean {
    const pos = this.group.position
    if (Math.hypot(ctx.queenX - pos.x, ctx.queenZ - pos.z) > LOST_DISTANCE) {
      this.homeX = pos.x // wander off from wherever she ended up
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

  /** Amble to the distraction spot; once she arrives or the timer runs out,
   *  curiosity is satisfied and she rejoins the Queen. */
  private beDistracted(delta: number): void {
    this.distractTimer -= delta
    const pos = this.group.position
    const dx = this.targetX - pos.x
    const dz = this.targetZ - pos.z
    const dist = Math.hypot(dx, dz)

    if (this.distractTimer <= 0 || dist < ARRIVE_STOP) {
      this.state = 'following' // back to her duties
      return
    }
    const speed = dist < ARRIVE_RADIUS ? WANDER_SPEED * (dist / ARRIVE_RADIUS) : WANDER_SPEED
    this.ease((dx / dist) * speed, (dz / dist) * speed, delta)
  }

  /** Look for a plant within FORAGE_RADIUS; if there's one, target it and switch
   *  to foraging. Returns whether she's now off to forage. */
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
    const pos = this.group.position
    const dx = plant.x - pos.x
    const dz = plant.z - pos.z
    const dist = Math.hypot(dx, dz)
    if (dist < EAT_RADIUS) {
      this.food.collect(plant) // nom
      this.targetFood = null
      this.state = 'following'
      return
    }
    const speed = dist < ARRIVE_RADIUS ? FORAGE_SPEED * (dist / ARRIVE_RADIUS) : FORAGE_SPEED
    this.ease((dx / dist) * speed, (dz / dist) * speed, delta)
  }

  /** Seek the current wander target, slowing on arrival, then pause. */
  private seekTarget(delta: number): void {
    const pos = this.group.position
    const dx = this.targetX - pos.x
    const dz = this.targetZ - pos.z
    const dist = Math.hypot(dx, dz)

    if (dist < ARRIVE_STOP) {
      this.state = 'pausing'
      this.timer = randRange(PAUSE_MIN, PAUSE_MAX)
      return
    }
    const speed = dist < ARRIVE_RADIUS ? WANDER_SPEED * (dist / ARRIVE_RADIUS) : WANDER_SPEED
    this.ease((dx / dist) * speed, (dz / dist) * speed, delta)
  }

  /** Ease the velocity toward a target (vx, vz) — frame-rate-independent. */
  private ease(vx: number, vz: number, delta: number, rate = RESPONSIVENESS): void {
    const t = 1 - Math.exp(-rate * delta)
    this.velX += (vx - this.velX) * t
    this.velZ += (vz - this.velZ) * t
  }

  private pickNewTarget(): void {
    const angle = Math.random() * Math.PI * 2
    const radius = Math.random() * WANDER_RADIUS
    this.targetX = this.homeX + Math.cos(angle) * radius
    this.targetZ = this.homeZ + Math.sin(angle) * radius
    this.state = 'wandering'
  }
}
