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

// Posturing / fleeing arrive in later phases.
type GooseState = 'pausing' | 'wandering' | 'foraging'

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

  update(delta: number): void {
    // An occasional honk.
    if (Math.random() < HONK_RATE * delta) this.sound.honk(this.honkPitch)

    // While just milling about, it might spot one of your plants and go for it.
    if (this.state !== 'foraging' && Math.random() < FORAGE_RATE * delta) this.tryForage()

    switch (this.state) {
      case 'foraging':
        this.forage(delta)
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

  /** Spot the nearest plant in range and head for it. */
  private tryForage(): boolean {
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
