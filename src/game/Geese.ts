import * as THREE from 'three'
import { Goose } from './Goose'
import type { Sound } from './Sound'
import type { Food } from './Food'
import type { Input } from './Input'
import type { Flock } from './Flock'
import type { Collider } from './collision'
import type { Rng } from './rng'

const GOOSE_COUNT = 3
const AREA_CENTER_Z = -50 // out past the pond (which sits at z = -26)
const AREA_RADIUS = 12

// --- Honk-off tuning -------------------------------------------------------
const TRIGGER_RANGE = 5 // a honk-off begins when the Queen gets this close to a goose
const DISENGAGE_RANGE = 9 // backing this far away ends it (counts as a loss)
const QUACK_GAIN = 0.14 // resolve added per Q press
const FLOCK_FILL = 0.06 // resolve/sec per following duck (the flock bonus)
const GOOSE_DRAIN = 0.18 // resolve/sec the goose pushes back

/** Game wires this to the HUD (active? + how full the resolve meter is, 0..1). */
type OnHonkOff = (active: boolean, resolve: number) => void

/**
 * Geese owns the rival geese and runs the honk-off — the non-violent standoff.
 * When the Queen gets close to a goose, both square up; the player mashes Q to
 * fill a "resolve" meter, with a head start + steady fill scaled by flock size
 * (the hybrid rule), while the goose drains it. Fill it to win; let it empty or
 * walk away to lose. (Resolution — flee vs strut — comes in Phase 4.)
 */
export class Geese {
  private readonly geese: Goose[] = []

  // Honk-off state.
  private active: Goose | null = null
  private resolve = 0
  private wasQuackDown = false

  constructor(
    scene: THREE.Scene,
    sound: Sound,
    food: Food,
    private readonly input: Input,
    private readonly queen: THREE.Object3D,
    private readonly flock: Flock,
    private readonly onHonkOff: OnHonkOff,
    colliders: readonly Collider[],
    rng: Rng,
  ) {
    for (let i = 0; i < GOOSE_COUNT; i++) {
      const angle = rng() * Math.PI * 2
      const radius = rng() * AREA_RADIUS
      const goose = new Goose(Math.cos(angle) * radius, AREA_CENTER_Z + Math.sin(angle) * radius, sound, food, colliders, rng)
      this.geese.push(goose)
      scene.add(goose.group)
    }
  }

  update(delta: number): void {
    this.updateHonkOff(delta)
    for (const goose of this.geese) goose.update(delta)
  }

  private updateHonkOff(delta: number): void {
    const qx = this.queen.position.x
    const qz = this.queen.position.z

    if (this.active) {
      // Keep the goose squared up to the Queen.
      this.active.aimAt(qx, qz)

      // Backed off too far? She forfeits.
      const gp = this.active.group.position
      if (Math.hypot(gp.x - qx, gp.z - qz) > DISENGAGE_RANGE) {
        this.end(false)
        return
      }

      // Each fresh Q press is a quack in the goose's face.
      const qDown = this.input.isDown('KeyQ')
      if (qDown && !this.wasQuackDown) this.resolve += QUACK_GAIN
      this.wasQuackDown = qDown

      // Flock backs her up (passive fill); the goose pushes back (passive drain).
      this.resolve += (FLOCK_FILL * this.flock.subjectCount - GOOSE_DRAIN) * delta
      this.resolve = Math.max(0, Math.min(1, this.resolve))
      this.onHonkOff(true, this.resolve)

      if (this.resolve >= 1) this.end(true) // out-honked it!
      else if (this.resolve <= 0) this.end(false) // it out-honked her
      return
    }

    // No honk-off running — start one if she's squared up to an engageable goose.
    let nearest: Goose | null = null
    let nearestSq = TRIGGER_RANGE * TRIGGER_RANGE
    for (const g of this.geese) {
      if (!g.engageable) continue
      const dSq = (g.group.position.x - qx) ** 2 + (g.group.position.z - qz) ** 2
      if (dSq < nearestSq) {
        nearestSq = dSq
        nearest = g
      }
    }
    if (nearest) this.start(nearest)
  }

  private start(goose: Goose): void {
    this.active = goose
    goose.startPosturing()
    // Head start from the flock — a crowd at your back is intimidating.
    this.resolve = Math.min(0.6, 0.1 + this.flock.subjectCount * 0.08)
    this.wasQuackDown = this.input.isDown('KeyQ') // don't count an already-held Q
    this.onHonkOff(true, this.resolve)
  }

  private end(won: boolean): void {
    if (this.active) this.active.stopPosturing(won)
    this.active = null
    this.resolve = 0
    this.onHonkOff(false, 0)
  }
}
