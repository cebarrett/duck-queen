import * as THREE from 'three'
import { buildGoose } from './gooseModel'
import { approachAngle, randRange } from './mathUtils'
import { type Collider, resolveWalls } from './collision'
import type { Sound } from './Sound'
import type { Food, FoodItem } from './Food'
import { type Rng, rngRange } from './rng'

// --- Wander tuning (geese amble a bit faster/heavier than ducklings) -------
const SPEED = 2.2
const RESPONSIVENESS = 4
const WANDER_RADIUS = 8 // how far from home it picks its next spot
const ARRIVE_RADIUS = 1.5
const ARRIVE_STOP = 0.4
const PAUSE_MIN = 1.5
const PAUSE_MAX = 5.0
const TURN_SPEED = 6

// --- Walk + idle animation -------------------------------------------------
const MOVING = 0.3 // speed above which it's "walking" (vs idling)
const WALK_FREQ = 3.5 // base stride cadence — slow & deliberate (a duck waddles faster)
const WALK_SPEED_FREQ = 0.8 // extra cadence per unit of speed
const WALK_BOB = 0.05 // gentle up/down body bob per stride
const WALK_ROLL = 0.05 // a little side sway (much less than a duck's waddle)
const WALK_HEAD_BOB = 0.14 // the neck dips in rhythm as it strides
const IDLE_GAP_MIN = 2.5 // shortest gap between idle fidgets (seconds)
const IDLE_GAP_MAX = 6.0 // longest gap

const HONK_RATE = 0.07 // per second: chance to let out a honk now and then

// --- World collision -------------------------------------------------------
const COLLIDE_RADIUS = 0.6 // its footprint vs. trees/rocks (bigger than a duckling)
const COLLIDE_HEIGHT = 1.2 // collision height; canopies float above this (walk under)

// --- Foraging (the rivalry: geese eat YOUR plants) -------------------------
const FORAGE_RADIUS = 7 // how far a goose will notice a plant and go for it
const FORAGE_RATE = 0.5 // per second: chance to spot + go for an in-range plant
const EAT_RADIUS = 1.1 // close enough to snatch a plant

// --- Posturing (during a honk-off) -----------------------------------------
const PUFF_SCALE = 1.22 // how big it swells while squaring up
const POSTURE_TURN = 10 // how fast it spins to face the Queen
const POSTURE_HONK_RATE = 1.4 // it honks a LOT during a face-off
const PUFF_EASE = 8 // how fast it puffs up / deflates
const HONKOFF_COOLDOWN = 5 // after losing a honk-off (it won), brief no-re-fight gap

// --- Defeat (the Queen won the honk-off) -----------------------------------
const FLEE_SPEED = 5 // it bolts away fast
const FLEE_DISTANCE = 25 // how far it runs
const COWED_TIME = 12 // after being beaten: won't forage or be re-engaged for this long

type GooseState = 'pausing' | 'wandering' | 'foraging' | 'fleeing'

/**
 * A rival goose. For now it just wanders its patch and honks occasionally — the
 * same "seek a target, ease toward it, pause" shape as the duckling, since that
 * pattern has served us well. Later phases add foraging, posturing, and fleeing.
 */
export class Goose {
  readonly group: THREE.Group
  // The animatable parts (pivots) of the model.
  private readonly leftWing: THREE.Group
  private readonly rightWing: THREE.Group
  private readonly neck: THREE.Group

  private homeX: number
  private homeZ: number
  private velX = 0
  private velZ = 0
  private heading = 0
  private walkPhase = 0

  // Idle fidgets while standing around.
  private idleAction: 'none' | 'flap' | 'look' | 'peck' = 'none'
  private idleTime = 0 // elapsed in the current fidget
  private nextIdle = randRange(IDLE_GAP_MIN, IDLE_GAP_MAX) // countdown to the next one

  private state: GooseState = 'pausing'
  private timer: number
  private targetX = 0
  private targetZ = 0
  private targetFood: FoodItem | null = null // the plant it's stealing toward

  // Its own honk pitch, so a gaggle sounds like distinct birds. Seeded (ctor).
  private readonly honkPitch: number

  // Honk-off state: while posturing it ignores its normal behaviour, squares up
  // to face the Queen (aimX/aimZ), and "puffs up" (a swelling scale).
  private posturing = false
  private aimX = 0
  private aimZ = 0
  private puff = 1
  private cooldown = 0 // seconds until it can be drawn into another honk-off
  private cowed = 0 // seconds it stays rattled after a defeat (won't forage)

  constructor(
    x: number,
    z: number,
    private readonly sound: Sound,
    private readonly food: Food,
    private readonly colliders: readonly Collider[],
    rng: Rng,
  ) {
    const model = buildGoose()
    this.group = model.group
    this.leftWing = model.leftWing
    this.rightWing = model.rightWing
    this.neck = model.neck
    this.group.position.set(x, 0, z)
    this.homeX = x
    this.homeZ = z

    // Spawn-time values from the seeded rng so the initial world is stable.
    this.honkPitch = rngRange(rng, 0.9, 1.15)
    this.heading = rng() * Math.PI * 2
    this.group.rotation.y = this.heading
    this.timer = randRange(0, PAUSE_MAX) // first-move timing — fine to stay unseeded
  }

  /** Is this goose currently locked in a honk-off? */
  get isPosturing(): boolean {
    return this.posturing
  }

  /** Can the Queen start a honk-off with it right now? (Not already posturing,
   *  and not in the brief cooldown after the last one.) */
  get engageable(): boolean {
    return !this.posturing && this.cooldown <= 0
  }

  /** Start a honk-off: square up and puff, dropping whatever it was doing
   *  (including any idle fidget — reset the wings/neck to neutral). */
  startPosturing(): void {
    this.posturing = true
    this.targetFood = null
    this.idleAction = 'none'
    this.neck.rotation.set(0, 0, 0)
    this.leftWing.rotation.z = 0
    this.rightWing.rotation.z = 0
  }

  /** End the honk-off. `won` = the QUEEN won. */
  stopPosturing(won: boolean): void {
    this.posturing = false

    if (won) {
      // Beaten! Let out a low, defeated honk, then bolt directly away from her
      // and stay cowed (no foraging / re-fighting) for a while.
      this.sound.honk(this.honkPitch * 0.8)
      const pos = this.group.position
      let dx = pos.x - this.aimX // aim = the Queen's last position
      let dz = pos.z - this.aimZ
      const d = Math.hypot(dx, dz) || 1
      this.targetX = pos.x + (dx / d) * FLEE_DISTANCE
      this.targetZ = pos.z + (dz / d) * FLEE_DISTANCE
      this.state = 'fleeing'
      this.cooldown = COWED_TIME
      this.cowed = COWED_TIME
    } else {
      // It held its ground: a smug honk, then straight back to its business.
      this.sound.honk(this.honkPitch * 1.1)
      this.state = 'pausing'
      this.timer = randRange(PAUSE_MIN, PAUSE_MAX)
      this.cooldown = HONKOFF_COOLDOWN
    }
  }

  /** Tell it where the Queen is, so it can face her while posturing. */
  aimAt(x: number, z: number): void {
    this.aimX = x
    this.aimZ = z
  }

  update(delta: number): void {
    // While posturing, the honk-off takes over completely.
    if (this.posturing) {
      this.updatePosture(delta)
      return
    }
    // Deflate back to normal size after a honk-off.
    if (this.puff !== 1) {
      this.puff += (1 - this.puff) * (1 - Math.exp(-PUFF_EASE * delta))
      if (Math.abs(this.puff - 1) < 0.005) this.puff = 1
      this.group.scale.setScalar(this.puff)
    }
    if (this.cooldown > 0) this.cooldown -= delta
    if (this.cowed > 0) this.cowed -= delta

    // An occasional honk.
    if (Math.random() < HONK_RATE * delta) this.sound.honk(this.honkPitch)

    // Only while calmly milling about does it eye your plants (not mid-flee).
    if ((this.state === 'wandering' || this.state === 'pausing') && Math.random() < FORAGE_RATE * delta) {
      this.tryForage()
    }

    switch (this.state) {
      case 'foraging':
        this.forage(delta)
        break
      case 'fleeing':
        this.flee(delta)
        break
      case 'wandering':
        this.seekTarget(delta)
        break
      case 'pausing':
        this.ease(0, 0, delta)
        this.timer -= delta
        if (this.timer <= 0) this.pickNewTarget()
        break
    }

    // Apply movement.
    const pos = this.group.position
    pos.x += this.velX * delta
    pos.z += this.velZ * delta

    // Push out of any tree/rock it walked into (stepUp 0 = it doesn't climb).
    const vel = { x: this.velX, z: this.velZ }
    resolveWalls(pos, vel, COLLIDE_RADIUS, 0, COLLIDE_HEIGHT, 0, this.colliders)
    this.velX = vel.x
    this.velZ = vel.z

    // Face travel direction.
    const speed = Math.hypot(this.velX, this.velZ)
    if (speed > 0.05) {
      const targetHeading = Math.atan2(-this.velX, -this.velZ) // faces -Z at 0
      this.heading = approachAngle(this.heading, targetHeading, TURN_SPEED * delta)
    }
    this.group.rotation.y = this.heading
    this.applyPose(delta, speed)
  }

  /** Either the deliberate walk bob, or — when standing — an idle fidget. */
  private applyPose(delta: number, speed: number): void {
    const pos = this.group.position

    if (speed > MOVING) {
      // Deliberate stride: gentle body bob + slight sway, and the neck head-bobs
      // in rhythm. Wings stay folded.
      this.idleAction = 'none'
      this.walkPhase += delta * (WALK_FREQ + speed * WALK_SPEED_FREQ)
      pos.y = Math.abs(Math.sin(this.walkPhase)) * WALK_BOB
      this.group.rotation.z = Math.sin(this.walkPhase) * WALK_ROLL
      this.neck.rotation.set(WALK_HEAD_BOB * (0.5 + 0.5 * Math.sin(this.walkPhase)), 0, 0)
      this.leftWing.rotation.z = 0
      this.rightWing.rotation.z = 0
    } else {
      pos.y = 0
      this.group.rotation.z = 0
      this.updateIdle(delta)
    }
  }

  /** Stand around, occasionally flapping, looking about, or pecking the ground. */
  private updateIdle(delta: number): void {
    if (this.idleAction === 'none') {
      // Neutral, settled pose.
      this.neck.rotation.set(0, 0, 0)
      this.leftWing.rotation.z = 0
      this.rightWing.rotation.z = 0
      this.nextIdle -= delta
      if (this.nextIdle <= 0) {
        const r = Math.random()
        this.idleAction = r < 0.4 ? 'look' : r < 0.75 ? 'peck' : 'flap'
        this.idleTime = 0
        this.nextIdle = randRange(IDLE_GAP_MIN, IDLE_GAP_MAX)
      }
      return
    }

    this.idleTime += delta
    if (this.idleAction === 'flap') this.animFlap()
    else if (this.idleAction === 'look') this.animLook()
    else this.animPeck()
  }

  /** A few quick wing flaps that taper off. */
  private animFlap(): void {
    const DUR = 0.9
    if (this.idleTime > DUR) {
      this.idleAction = 'none'
      return
    }
    const taper = Math.min(1, (DUR - this.idleTime) / 0.3) // fade out at the end
    const spread = (0.25 + 0.85 * (0.5 + 0.5 * Math.sin(this.idleTime * 22))) * taper
    this.leftWing.rotation.z = -spread
    this.rightWing.rotation.z = spread
    this.neck.rotation.set(-0.1, 0, 0) // head up a touch while flapping
  }

  /** Turn the head one way then the other, settling back to centre. */
  private animLook(): void {
    const DUR = 2.2
    if (this.idleTime > DUR) {
      this.idleAction = 'none'
      return
    }
    const envelope = Math.sin((this.idleTime / DUR) * Math.PI) // 0 -> 1 -> 0
    this.neck.rotation.set(0, Math.sin(this.idleTime * 2.4) * 0.7 * envelope, 0)
  }

  /** Dip the head to the ground a couple of times. */
  private animPeck(): void {
    const DUR = 1.4
    if (this.idleTime > DUR) {
      this.idleAction = 'none'
      return
    }
    const dip = Math.max(0, Math.sin(this.idleTime * 5)) // 0 -> down -> up, twice
    this.neck.rotation.set(dip, 0, 0)
  }

  /** Square up to the Queen, hold ground, puff up, and honk a lot. */
  private updatePosture(delta: number): void {
    const pos = this.group.position
    const dx = this.aimX - pos.x
    const dz = this.aimZ - pos.z
    if (Math.hypot(dx, dz) > 0.01) {
      const target = Math.atan2(-dx, -dz) // faces -Z at heading 0
      this.heading = approachAngle(this.heading, target, POSTURE_TURN * delta)
    }
    // Stand its ground (glide any leftover velocity to zero).
    this.ease(0, 0, delta)
    pos.x += this.velX * delta
    pos.z += this.velZ * delta

    // Puff up + face her, no waddle.
    this.puff += (PUFF_SCALE - this.puff) * (1 - Math.exp(-PUFF_EASE * delta))
    this.group.scale.setScalar(this.puff)
    pos.y = 0
    this.group.rotation.y = this.heading
    this.group.rotation.z = 0

    if (Math.random() < POSTURE_HONK_RATE * delta) this.sound.honk(this.honkPitch)
  }

  /** Run away from the Queen; once it reaches its escape point, calm down. */
  private flee(delta: number): void {
    const pos = this.group.position
    const dx = this.targetX - pos.x
    const dz = this.targetZ - pos.z
    const dist = Math.hypot(dx, dz)
    if (dist < ARRIVE_STOP) {
      this.state = 'pausing'
      this.timer = randRange(PAUSE_MIN, PAUSE_MAX)
      return
    }
    this.ease((dx / dist) * FLEE_SPEED, (dz / dist) * FLEE_SPEED, delta)
  }

  /** Spot the nearest plant in range and head for it (unless it's still cowed). */
  private tryForage(): boolean {
    if (this.cowed > 0) return false // too rattled to steal right now
    const pos = this.group.position
    const plant = this.food.nearestUncollected(pos.x, pos.z, FORAGE_RADIUS)
    if (!plant) return false
    this.targetFood = plant
    this.state = 'foraging'
    return true
  }

  /** Go to the targeted plant and STEAL it (denies the player), then pause to
   *  gloat before wandering on. If another goose got it first, just move on. */
  private forage(delta: number): void {
    const plant = this.targetFood
    if (!plant || plant.collected) {
      this.targetFood = null
      this.state = 'pausing'
      this.timer = randRange(PAUSE_MIN, PAUSE_MAX)
      return
    }
    const pos = this.group.position
    const dx = plant.x - pos.x
    const dz = plant.z - pos.z
    const dist = Math.hypot(dx, dz)
    if (dist < EAT_RADIUS) {
      this.food.steal(plant) // NOT collect() — this denies the Queen the food
      this.sound.honk(this.honkPitch) // a smug honk
      this.targetFood = null
      this.state = 'pausing'
      this.timer = randRange(PAUSE_MIN, PAUSE_MAX)
      return
    }
    const speed = dist < ARRIVE_RADIUS ? SPEED * (dist / ARRIVE_RADIUS) : SPEED
    this.ease((dx / dist) * speed, (dz / dist) * speed, delta)
  }

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
    const speed = dist < ARRIVE_RADIUS ? SPEED * (dist / ARRIVE_RADIUS) : SPEED
    this.ease((dx / dist) * speed, (dz / dist) * speed, delta)
  }

  private ease(vx: number, vz: number, delta: number): void {
    const t = 1 - Math.exp(-RESPONSIVENESS * delta)
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
