import * as THREE from 'three'
import { buildSwan } from './swanModel'
import { seekArrive, faceHeading, easeFactor, randRange, pointAround, approachAngle } from './mathUtils'
import { BEFORE_BARON, AFTER_BARON, type Discourse } from './swanDialogue'
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

/** One page of a conversation handed back to the HUD: the line, plus whether it's
 *  the last one (so the prompt can say "leave" instead of "continue"). */
export interface DialoguePage {
  text: string
  last: boolean
}

/**
 * A single stately swan, Aldermere, who glides the pond — and, when the Queen
 * comes near and speaks to him, talks. He is otherwise pure ambient wildlife: no
 * honk-offs, no foraging, no reacting to a quack. Left alone he just picks a spot
 * on the water, glides there, pauses, repeats; he never leaves the pond, so he
 * needs no land collision. While a conversation is open he holds still and turns
 * to face her; his actual words live in swanDialogue.ts.
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

  // Dialogue. `talking` freezes the glide and turns him to face the Queen; `active`
  // is the discourse (list of pages) currently being read out, `page` the spot in
  // it. The two indices remember which discourse to deliver next in each phase, so
  // repeat visits rotate through his musings rather than replaying one block.
  private talking = false
  private active: Discourse | null = null
  private page = 0
  private beforeIndex = 0
  private afterIndex = 0
  private afterBaron = false

  constructor(
    private readonly pond: Pond,
    private readonly queen: THREE.Object3D,
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
    // While he's talking he attends to the Queen: glide to a halt (no new wander
    // target), and below he'll turn to face her instead of his travel direction.
    if (this.talking) {
      this.ease(0, 0, delta)
    } else if (this.state === 'pausing') {
      // Glide → pause → glide. He watches no one and nothing the rest of the time.
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

    // Face the Queen while talking, otherwise face the way he's gliding.
    if (this.talking) this.faceQueen(delta)
    else this.heading = faceHeading(this.heading, this.velX, this.velZ, TURN_SPEED, delta)
    this.group.rotation.y = this.heading

    this.floatPose(delta)
  }

  // --- Dialogue --------------------------------------------------------------

  /** True while a conversation is open (the Queen is reading him page by page). */
  get isTalking(): boolean {
    return this.talking
  }

  /** Begin a conversation, choosing the script by whether the Marsh Baron has
   *  fallen. Returns the opening page. */
  beginDialogue(baronDefeated: boolean): DialoguePage {
    this.afterBaron = baronDefeated
    const pool = baronDefeated ? AFTER_BARON : BEFORE_BARON
    const index = baronDefeated ? this.afterIndex : this.beforeIndex
    this.active = pool[index % pool.length]
    this.page = 0
    this.talking = true
    return this.pageAt(0)
  }

  /** Advance to the next page. Returns it, or null when the conversation is over
   *  (which also closes it and rotates this phase to its next discourse). */
  advanceDialogue(): DialoguePage | null {
    if (!this.active) return null
    if (this.page >= this.active.length - 1) {
      if (this.afterBaron) this.afterIndex++
      else this.beforeIndex++
      this.endDialogue()
      return null
    }
    this.page++
    return this.pageAt(this.page)
  }

  /** Close the conversation without finishing it (e.g. the Queen swam off). */
  endDialogue(): void {
    this.talking = false
    this.active = null
    this.page = 0
  }

  private pageAt(i: number): DialoguePage {
    const lines = this.active!
    return { text: lines[i], last: i >= lines.length - 1 }
  }

  /** Turn slowly to face the Queen — the same heading convention the goose uses
   *  when it squares up (the model faces −Z at heading 0). */
  private faceQueen(delta: number): void {
    const pos = this.group.position
    const dx = this.queen.position.x - pos.x
    const dz = this.queen.position.z - pos.z
    if (Math.hypot(dx, dz) > 0.01) {
      const target = Math.atan2(-dx, -dz)
      this.heading = approachAngle(this.heading, target, TURN_SPEED * delta)
    }
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
