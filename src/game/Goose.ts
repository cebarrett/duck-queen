import * as THREE from 'three'
import { buildGoose } from './gooseModel'
import { approachAngle, randRange } from './mathUtils'
import type { Sound } from './Sound'

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

// Phase 1 has just the idle states; foraging / posturing / fleeing arrive later.
type GooseState = 'pausing' | 'wandering'

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

  // Its own honk pitch, so a gaggle sounds like distinct birds.
  private readonly honkPitch = randRange(0.9, 1.15)

  constructor(
    x: number,
    z: number,
    private readonly sound: Sound,
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

    if (this.state === 'wandering') {
      this.seekTarget(delta)
    } else {
      this.ease(0, 0, delta)
      this.timer -= delta
      if (this.timer <= 0) this.pickNewTarget()
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
