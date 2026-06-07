import * as THREE from 'three'
import { buildSwan } from './swanModel'
import { seekArrive, faceHeading, easeFactor, randRange, pointAround } from './mathUtils'
import type { Pond } from './Water'
import type { Rng } from './rng'

// A lone swan keeps to itself: it just glides slowly between points on the pond,
// pauses, and drifts on. Deliberately serene — slow cruise, lazy turns, long pauses.
const SPEED = 1.0 // a slow, gliding cruise (a goose ambles at 2.2)
const RESPONSIVENESS = 2.2 // eases into motion gently — no darting
const ARRIVE_RADIUS = 2.5 // starts slowing this far from its target
const ARRIVE_STOP = 0.6 // close enough — call it arrived
const PAUSE_MIN = 2.5 // it drifts and rests between glides
const PAUSE_MAX = 7.0
const TURN_SPEED = 1.6 // turns slowly and smoothly (rad/sec)
const SHORE_INSET = 2.2 // keep its targets this far inside the shoreline

// --- Floating on the pond --------------------------------------------------
// Its model origin is at its feet; sink it until the waterline rides up the body.
const FLOAT_Y = -0.5 // body settles to this y while afloat (waterline rides up the body)
const BOB = 0.04 // gentle vertical bob on the water
const SWAY = 0.05 // slight side-to-side roll
const NECK_SWAY = 0.18 // slow, graceful neck turn

type SwanState = 'gliding' | 'pausing'

/**
 * A single stately swan that swims the pond and nothing more. It has no awareness
 * of the Queen, the flock, the geese, or food — it never honks, forages, or reacts
 * to a quack. Pure ambient wildlife: pick a spot on the water, glide there, pause,
 * repeat. It never leaves the pond, so it needs no land collision.
 */
export class Swan {
  readonly group: THREE.Group
  private readonly neck: THREE.Group

  private velX = 0
  private velZ = 0
  private heading = 0
  private bobPhase = 0
  private neckPhase = 0

  private state: SwanState = 'pausing'
  private timer: number
  private targetX = 0
  private targetZ = 0

  constructor(
    private readonly pond: Pond,
    rng: Rng,
  ) {
    const model = buildSwan()
    this.group = model.group
    this.neck = model.neck

    // Its spawn spot places an object in the world, so it comes from the SEEDED
    // rng (same seed → same starting swan). Its wandering afterwards is gameplay
    // and uses Math.random.
    const start = this.pondPoint(rng)
    this.group.position.set(start.x, FLOAT_Y, start.z)
    this.heading = rng() * Math.PI * 2
    this.group.rotation.y = this.heading
    this.timer = randRange(0, PAUSE_MAX)
  }

  /** A random point on the pond, kept inset from the shore so it never grounds. */
  private pondPoint(rand: () => number): { x: number; z: number } {
    return pointAround(this.pond.centerX, this.pond.centerZ, Math.max(0, this.pond.radius - SHORE_INSET), rand)
  }

  update(delta: number): void {
    // Glide → pause → glide. No context argument: it watches nothing and no one.
    if (this.state === 'pausing') {
      this.ease(0, 0, delta)
      this.timer -= delta
      if (this.timer <= 0) {
        const p = this.pondPoint(Math.random)
        this.targetX = p.x
        this.targetZ = p.z
        this.state = 'gliding'
      }
    } else {
      const s = seekArrive(this.group.position, this.targetX, this.targetZ, SPEED, ARRIVE_RADIUS, ARRIVE_STOP)
      if (s.arrived) {
        this.state = 'pausing'
        this.timer = randRange(PAUSE_MIN, PAUSE_MAX)
      } else {
        this.ease(s.vx, s.vz, delta)
      }
    }

    // Apply movement. (No resolveWalls — it stays on the water, away from scenery.)
    const pos = this.group.position
    pos.x += this.velX * delta
    pos.z += this.velZ * delta

    // Face travel direction, turning slowly.
    this.heading = faceHeading(this.heading, this.velX, this.velZ, TURN_SPEED, delta)
    this.group.rotation.y = this.heading

    this.floatPose(delta)
  }

  /** Ride the waterline with a slow bob + roll and a lazy, graceful neck sway. */
  private floatPose(delta: number): void {
    this.bobPhase += delta * 1.5
    this.neckPhase += delta * 0.5
    const pos = this.group.position
    pos.y = FLOAT_Y + Math.sin(this.bobPhase) * BOB
    this.group.rotation.z = Math.sin(this.bobPhase * 0.7) * SWAY
    this.neck.rotation.set(Math.sin(this.neckPhase * 0.6) * 0.05, Math.sin(this.neckPhase) * NECK_SWAY, 0)
  }

  private ease(vx: number, vz: number, delta: number): void {
    const t = easeFactor(RESPONSIVENESS, delta)
    this.velX += (vx - this.velX) * t
    this.velZ += (vz - this.velZ) * t
  }
}
