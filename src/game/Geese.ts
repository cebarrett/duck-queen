import * as THREE from 'three'
import { Goose } from './Goose'
import type { Sound } from './Sound'
import type { Food } from './Food'
import type { Input } from './Input'
import type { Flock } from './Flock'
import type { Pond } from './Water'
import type { Nests } from './Nests'
import type { Collider } from './collision'
import type { Rng } from './rng'

const GOOSE_COUNT = 3
const AREA_CENTER_Z = -50 // out past the pond (which sits at z = -26)
const AREA_RADIUS = 12

// --- Honk-off tuning -------------------------------------------------------
const TRIGGER_RANGE = 5 // a honk-off begins when the Queen gets this close to a goose
const DISENGAGE_RANGE = 9 // backing this far away ends it (counts as a loss)
const QUACK_GAIN = 0.022 // resolve per Q press — small, so frantic mashing alone can't win a fight
const FLOCK_FILL = 0.11 // resolve/sec per following duck — ~3 followers already out-honk the goose passively
const GOOSE_DRAIN = 0.31 // resolve/sec the goose pushes back — outpaces a lone Queen no matter how she mashes
const MAX_PASSIVE_SUPPORT = 0.55 // cap the crowd's help (well above the drain) so a big flock wins with light mashing
// The Chorus: a flock's support is scaled by how many of the three duck voices
// (duckling / drake / hen) it has. A full 3-voice chorus is full strength; a
// one-note flock is much weaker — "unity must be maintained". Indexed by voices.
const CHORUS_MULT = [0.6, 0.6, 0.8, 1.0]

/** Game wires this to the HUD (active? + how full the resolve meter is, 0..1). */
type OnHonkOff = (active: boolean, resolve: number) => void
type OnQueenLost = (gooseX: number, gooseZ: number, queenX: number, queenZ: number) => void
type ResolvePenalty = () => number

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
    pond: Pond,
    nests: Nests,
    private readonly input: Input,
    private readonly queen: THREE.Object3D,
    private readonly flock: Flock,
    private readonly onHonkOff: OnHonkOff,
    private readonly onQueenLost: OnQueenLost,
    private readonly resolvePenalty: ResolvePenalty,
    colliders: readonly Collider[],
    rng: Rng,
  ) {
    for (let i = 0; i < GOOSE_COUNT; i++) {
      const angle = rng() * Math.PI * 2
      const radius = rng() * AREA_RADIUS
      const goose = new Goose(Math.cos(angle) * radius, AREA_CENTER_Z + Math.sin(angle) * radius, sound, food, pond, nests, colliders, rng)
      this.geese.push(goose)
      scene.add(goose.group)
    }
  }

  update(delta: number): void {
    this.updateHonkOff(delta)
    for (const goose of this.geese) goose.update(delta)
  }

  /** The nearest goose to (x, z) with its position + distance, or null if there
   *  are none. Used to tell whether a goose is menacing a nesting hen. */
  nearestGoose(x: number, z: number): { x: number; z: number; dist: number } | null {
    let best: THREE.Vector3 | null = null
    let bestSq = Infinity
    for (const goose of this.geese) {
      const gp = goose.group.position
      const dSq = (gp.x - x) ** 2 + (gp.z - z) ** 2
      if (dSq < bestSq) {
        bestSq = dSq
        best = gp
      }
    }
    return best ? { x: best.x, z: best.z, dist: Math.sqrt(bestSq) } : null
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

      // Flock backs her up — a good crowd can out-honk the goose almost on its own;
      // quacking just hurries it along. Alone, the goose drains her faster than she
      // can ever quack. A diverse flock (full chorus) supports at full strength; a
      // one-note flock is weaker, so keeping all three duck voices matters.
      const chorus = this.flock.chorus
      const passiveSupport = Math.min(FLOCK_FILL * chorus.size * CHORUS_MULT[chorus.layers], MAX_PASSIVE_SUPPORT)
      this.resolve += (passiveSupport - GOOSE_DRAIN) * delta
      this.resolve = Math.max(0, Math.min(1, this.resolve))
      this.onHonkOff(true, this.resolve)

      if (this.resolve >= 1) this.end(true) // out-honked it!
      else if (this.resolve <= 0) this.end(false) // it out-honked her
      return
    }

    // No honk-off running — start one if she's squared up to an engageable goose.
    let nearest: Goose | null = null
    let nearestSq = Infinity
    for (const g of this.geese) {
      if (!g.engageable) continue
      const range = this.engageRange(g)
      const dSq = (g.group.position.x - qx) ** 2 + (g.group.position.z - qz) ** 2
      if (dSq >= range * range) continue
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
    // Head start from the flock — a crowd at your back is intimidating; alone she
    // starts low and the goose quickly drains her.
    const baseResolve = Math.min(0.55, 0.22 + this.flock.subjectCount * 0.05)
    this.resolve = Math.max(0.05, baseResolve - this.resolvePenalty())
    this.wasQuackDown = this.input.isDown('KeyQ') // don't count an already-held Q
    this.onHonkOff(true, this.resolve)
  }

  private end(won: boolean): void {
    if (this.active) {
      const goose = this.active
      const gp = goose.group.position
      const qp = this.queen.position
      goose.stopPosturing(won)
      if (!won) this.onQueenLost(gp.x, gp.z, qp.x, qp.z)
    }
    this.active = null
    this.resolve = 0
    this.onHonkOff(false, 0)
  }

  private engageRange(goose: Goose): number {
    return goose.honkOffTriggerRange(TRIGGER_RANGE)
  }
}
