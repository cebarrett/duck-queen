import * as THREE from 'three'
import { buildGoose } from './gooseModel'
import { approachAngle, randRange } from './mathUtils'
import type { Sound } from './Sound'
import type { Food, FoodItem } from './Food'

// --- Wander tuning (geese amble a bit faster/heavier than ducklings) -------
const SPEED = 2.2
const RESPONSIVENESS = 4
const WANDER_RADIUS = 8 // how far from home it picks its next spot
const ARRIVE_RADIUS = 1.5
const ARRIVE_STOP = 0.4
const PAUSE_MIN = 1.5
const PAUSE_MAX = 5.0
const TURN_SPEED = 6
const BOB_HEIGHT = 0.07
const ROLL = 0.12

const HONK_RATE = 0.07 // per second: chance to let out a honk now and then

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

  private homeX: number
  private homeZ: number
  private velX = 0
  private velZ = 0
  private heading = 0
  private bobPhase = 0

  private state: GooseState = 'pausing'
  private timer: number
  private targetX = 0
  private targetZ = 0
  private targetFood: FoodItem | null = null // the plant it's stealing toward

  // Its own honk pitch, so a gaggle sounds like distinct birds.
  private readonly honkPitch = randRange(0.9, 1.15)

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
  ) {
    this.group = buildGoose()
    this.group.position.set(x, 0, z)
    this.homeX = x
    this.homeZ = z
    this.heading = Math.random() * Math.PI * 2
    this.group.rotation.y = this.heading
    this.timer = randRange(0, PAUSE_MAX)
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

  /** Start a honk-off: square up and puff, dropping whatever it was doing. */
  startPosturing(): void {
    this.posturing = true
    this.targetFood = null
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

    // Face travel direction + a heavier waddle.
    const speed = Math.hypot(this.velX, this.velZ)
    if (speed > 0.05) {
      const targetHeading = Math.atan2(-this.velX, -this.velZ) // faces -Z at 0
      this.heading = approachAngle(this.heading, targetHeading, TURN_SPEED * delta)
    }
    const moveFactor = Math.min(speed / SPEED, 1)
    this.bobPhase += delta * (5 + speed)
    pos.y = Math.abs(Math.sin(this.bobPhase)) * BOB_HEIGHT * moveFactor
    this.group.rotation.y = this.heading
    this.group.rotation.z = Math.sin(this.bobPhase) * ROLL * moveFactor
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
