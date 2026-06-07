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

// The Marsh Baron holds his own patch of marsh, deeper out than the gaggle.
const BARON_X = 0
const BARON_Z = -72

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

// --- The Marsh Baron boss fight --------------------------------------------
const BOSS_TRIGGER_RANGE = 6 // the Queen must come this close to face the Baron
const BOSS_DISENGAGE_RANGE = 11 // backing this far off forfeits the boss fight
const BOSS_DRAIN = 0.6 // he pushes back far harder than a regular goose
const BOSS_DRAKE_FILL = 0.06 // per CALM drake — drakes are what actually sustain the meter against him
const BOSS_OTHER_FILL = 0.005 // ducklings/hens barely move it — only the deep drake rasp answers him
const BOSS_MAX_PASSIVE = 0.55 // cap the support so even a drake host must out-last a couple of his splits
const BOSS_START_RESOLVE = 0.15 // only a small head start — he's a boss
const BOSS_MIN_FOLLOWERS = 10 // "formidable": at least this many subjects...
const BOSS_MIN_DRAKES = 8 // ...including this many drakes. The gate sits right at the win threshold:
// fewer than 8 drakes and he just sneers (no fight, no penalty); at 8 it's a desperate nail-biter,
// 9+ a cleaner win. So the only way to LOSE is to engage with a real host and then give up / get driven off.
const BOSS_SPLIT_INTERVAL = 6 // seconds between his splitting honks
const BOSS_FIRST_SPLIT = 4 // the first split lands a few seconds in
const BOSS_SPLIT_KNOCKBACK = 0.2 // each splitting honk knocks the resolve meter back this much

/** Game wires this to the HUD (active? + how full the resolve meter is, 0..1). */
type OnHonkOff = (active: boolean, resolve: number) => void
type OnQueenLost = (gooseX: number, gooseZ: number, queenX: number, queenZ: number) => void
type ResolvePenalty = () => number
type OnMessage = (text: string) => void

/**
 * Geese owns the rival geese and runs the honk-off — the non-violent standoff.
 * When the Queen gets close to a goose, both square up; the player mashes Q to
 * fill a "resolve" meter, with a head start + steady fill scaled by flock size
 * (the hybrid rule), while the goose drains it. Fill it to win; let it empty or
 * walk away to lose. (Resolution — flee vs strut — comes in Phase 4.)
 */
export class Geese {
  private readonly geese: Goose[] = []
  // The Marsh Baron — kept apart from the gaggle so the everyday honk-off / raid
  // logic never touches him; his boss fight is run separately (later phases).
  private readonly baron: Goose

  // Honk-off state.
  private active: Goose | null = null
  private resolve = 0
  private wasQuackDown = false

  // Boss-fight state (the Marsh Baron — run separately from the gaggle's honk-off).
  private bossActive = false
  private bossResolve = 0
  private bossWasQuackDown = false
  private bossDefeated = false
  private bossGateCooldown = 0 // throttles the "you're not ready" sneer
  private bossSplitTimer = 0 // counts down to his next splitting honk

  constructor(
    scene: THREE.Scene,
    private readonly sound: Sound,
    food: Food,
    pond: Pond,
    nests: Nests,
    private readonly input: Input,
    private readonly queen: THREE.Object3D,
    private readonly flock: Flock,
    private readonly onHonkOff: OnHonkOff,
    private readonly onBossFight: OnHonkOff,
    private readonly onBaronMessage: OnMessage,
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

    // The Marsh Baron — a boss goose rooted in his marsh, deep past the pond.
    this.baron = new Goose(BARON_X, BARON_Z, sound, food, pond, nests, colliders, rng, true)
    scene.add(this.baron.group)
    addMarshDressing(scene, BARON_X, BARON_Z, rng)
  }

  update(delta: number): void {
    this.updateHonkOff(delta)
    this.updateBossFight(delta)
    for (const goose of this.geese) goose.update(delta)
    this.baron.update(delta)
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
    if (this.bossActive) return // the boss fight takes over the standoff
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

  // --- The Marsh Baron boss fight --------------------------------------------

  private updateBossFight(delta: number): void {
    if (this.bossDefeated) return // beaten for good — he's broken and gone

    const qx = this.queen.position.x
    const qz = this.queen.position.z
    const bp = this.baron.group.position

    if (this.bossActive) {
      this.baron.aimAt(qx, qz)
      if (Math.hypot(bp.x - qx, bp.z - qz) > BOSS_DISENGAGE_RANGE) {
        this.endBossFight(false) // she fled the standoff
        return
      }
      // His splitting honk: every so often he scatters one of your non-drake
      // voices, dropping it from the chorus until it regroups. Drakes never break.
      this.bossSplitTimer -= delta
      if (this.bossSplitTimer <= 0) {
        this.bossSplitTimer = BOSS_SPLIT_INTERVAL
        this.doSplit()
      }

      const qDown = this.input.isDown('KeyQ')
      if (qDown && !this.bossWasQuackDown) this.bossResolve += QUACK_GAIN
      this.bossWasQuackDown = qDown

      // Drake-weighted support: drakes anchor (immune to his splits); ducklings and
      // hens add to it while they're calm, but he keeps scattering those.
      const { drakes, others } = this.flock.calmCounts()
      const passive = Math.min(BOSS_DRAKE_FILL * drakes + BOSS_OTHER_FILL * others, BOSS_MAX_PASSIVE)
      this.bossResolve += (passive - BOSS_DRAIN) * delta
      this.bossResolve = Math.max(0, Math.min(1, this.bossResolve))
      this.onBossFight(true, this.bossResolve)

      if (this.bossResolve >= 1) this.endBossFight(true)
      else if (this.bossResolve <= 0) this.endBossFight(false)
      return
    }

    // Not fighting — start one if the Queen squares up to him with a real host at
    // her back; otherwise he sneers her off with a hint about what she's missing.
    if (this.bossGateCooldown > 0) this.bossGateCooldown -= delta
    if (Math.hypot(bp.x - qx, bp.z - qz) > BOSS_TRIGGER_RANGE) return
    if (this.isFlockFormidable()) {
      this.startBossFight()
    } else if (this.bossGateCooldown <= 0) {
      this.onBaronMessage(this.gateHint())
      this.bossGateCooldown = 5
    }
  }

  private isFlockFormidable(): boolean {
    return this.flock.subjectCount >= BOSS_MIN_FOLLOWERS && this.flock.subjectBreakdown.males >= BOSS_MIN_DRAKES
  }

  private gateHint(): string {
    const drakes = this.flock.subjectBreakdown.males
    if (drakes < BOSS_MIN_DRAKES) return `🪿 The Baron sneers — bring more drakes (${drakes}/${BOSS_MIN_DRAKES})`
    return `🪿 The Baron sneers — bring a bigger flock (${this.flock.subjectCount}/${BOSS_MIN_FOLLOWERS})`
  }

  private startBossFight(): void {
    this.bossActive = true
    this.baron.startPosturing()
    this.bossResolve = BOSS_START_RESOLVE
    this.bossSplitTimer = BOSS_FIRST_SPLIT
    this.bossWasQuackDown = this.input.isDown('KeyQ')
    this.onBaronMessage('👑 THE MARSH BARON squares up!')
    this.onBossFight(true, this.bossResolve)
  }

  /** His splitting honk: scatter one of the player's non-drake voices, knocking it
   *  out of the supporting chorus for a few seconds. He can't split a drake wall. */
  private doSplit(): void {
    const bp = this.baron.group.position
    const scattered = this.flock.splitNonDrakes(bp.x, bp.z)
    if (scattered === 0) return // only drakes are calm — he can't break a drake wall
    this.bossResolve = Math.max(0, this.bossResolve - BOSS_SPLIT_KNOCKBACK) // the wave knocks you back
    this.sound.honk(0.5) // a deep, splitting honk
    this.onBaronMessage('💥 The Baron scatters your soft voices — hold with the drakes!')
  }

  private endBossFight(won: boolean): void {
    const bp = this.baron.group.position
    const qp = this.queen.position
    this.baron.stopPosturing(won) // won → he breaks and flees; lost → he struts
    if (won) {
      this.bossDefeated = true
      this.onBaronMessage('👑 THE MARSH BARON is broken — the marsh is yours!')
    } else {
      this.onQueenLost(bp.x, bp.z, qp.x, qp.z) // routed: panic flee + flock scatter
      this.bossGateCooldown = 6 // a breather before she can challenge again
    }
    this.bossActive = false
    this.bossResolve = 0
    this.onBossFight(false, 0)
  }
}

/** Light dressing for the Baron's turf: a few dark marsh reeds scattered around
 *  his spot. Seeded (it's world dressing), shares one material, no collision. */
function addMarshDressing(scene: THREE.Scene, cx: number, cz: number, rng: Rng): void {
  const mat = new THREE.MeshStandardMaterial({ color: 0x2f4a38 }) // dark marsh reed
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2
    const r = 2.5 + rng() * 5
    const h = 1.2 + rng() * 1.6
    const reed = new THREE.Mesh(new THREE.BoxGeometry(0.12, h, 0.12), mat)
    reed.position.set(cx + Math.cos(a) * r, h / 2, cz + Math.sin(a) * r)
    scene.add(reed)
  }
}
