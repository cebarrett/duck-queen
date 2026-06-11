import * as THREE from 'three'
import { Goose } from './Goose'
import type { Sound } from './Sound'
import type { Food } from './Food'
import type { Input } from './Input'
import type { Flock } from './Flock'
import type { Pond } from './Water'
import type { Nests } from './Nests'
import type { Frontier, Territory } from './Frontier'
import type { Collider } from './collision'
import type { Rng } from './rng'
import { TREATY_FLATS } from './Biomes'

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
const BOSS_DRAIN = 0.42 // he pushes back hard, but 6+ calm drakes should be a winnable stand
const BOSS_DRAKE_FILL = 0.06 // per CALM drake — drakes are what actually sustain the meter against him
const BOSS_OTHER_FILL = 0.005 // ducklings/hens barely move it — only the deep drake rasp answers him
const BOSS_MAX_PASSIVE = 0.55 // cap the support so even a drake host must out-last a couple of his splits
const BOSS_START_RESOLVE = 0.15 // only a small head start — he's a boss
const BOSS_MIN_FOLLOWERS = 10 // "formidable": at least this many subjects...
const BOSS_MIN_DRAKES = 5 // ...including this many drakes. Fewer than 5 and he just sneers;
// at 5 it's a nail-biter, 6+ a cleaner win. So the only way to LOSE is to engage with a real
// host and then give up / get driven off.
const BOSS_SPLIT_INTERVAL = 6 // seconds between his splitting honks
const BOSS_FIRST_SPLIT = 4 // the first split lands a few seconds in
const BOSS_SPLIT_KNOCKBACK = 0.2 // each splitting honk knocks the resolve meter back this much

// --- Lord Boundary, Treaty Flats boss ---------------------------------------
const TREATY_TRIGGER_RANGE = 7 // close enough to the treaty stone to be challenged
const TREATY_DISENGAGE_RANGE = 13 // leave the Flats mid-fight and the line moves back
const TREATY_START_RESOLVE = 0.18
const TREATY_DRAIN = 0.48 // he wins by slow pressure, not by one huge honk
const TREATY_FLOCK_FILL = 0.018 // every calm active subject helps hold the line
const TREATY_NEST_FILL = 0.04 // built nests prove the Flats are not empty claims
const TREATY_OCCUPIED_FILL = 0.1 // brooding hens anchor the border hardest
const TREATY_MAX_PASSIVE = 0.64
const TREATY_MIN_NESTS = 3
const TREATY_MIN_OCCUPIED = 2
const TREATY_CLAUSE_INTERVAL = 5.5
const TREATY_FIRST_CLAUSE = 3.5
const TREATY_CLAUSE_KNOCKBACK = 0.22
const TREATY_ANCHORED_KNOCKBACK = 0.06

// --- The frontier ganders (Act III: reclaim the outlying ponds) -------------
// One lieutenant goose holds each outlying pond. They're a step up from the
// gaggle — steel-blue "officers", a touch bigger — but reclaiming is, for now, a
// plain honk-off (the same resolve math as the gaggle), gated only behind Lord
// Boundary having fallen first. (Difficulty knobs + a settlement gate come later.)
const LIEUTENANT_COLOR = 0x6d7f96 // steel blue-grey — distinct from gaggle, Baron, Boundary
const LIEUTENANT_SCALE = 1.16 // a little bigger than a gaggle goose, smaller than a boss
const LIEUTENANT_PITCH: readonly [number, number] = [0.72, 0.84] // mid voice
const LIEUTENANT_HONK_RATE = 0.09
const FRONTIER_UNLOCK_DELAY = 3 // beat after Lord Boundary before the frontier call lands

/** A lieutenant goose paired with the territory (pond) it holds. */
interface Lieutenant {
  readonly goose: Goose
  readonly territory: Territory
  claimed: boolean
}

/** Game wires this to the HUD (active? + how full the resolve meter is, 0..1). */
type OnHonkOff = (active: boolean, resolve: number) => void
type OnQueenLost = (gooseX: number, gooseZ: number, queenX: number, queenZ: number) => void
type ResolvePenalty = () => number
type OnMessage = (text: string) => void

export interface EnemyMarker {
  x: number
  z: number
  boss: boolean
  defeated: boolean
}

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
  // Lord Boundary waits in the Treaty Flats. He is visible early, but his fight
  // is locked until the Baron is broken and the Queen has settled the Flats.
  private readonly treatyBoss: Goose

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

  // Treaty Flats fight state.
  private treatyActive = false
  private treatyResolve = 0
  private treatyWasQuackDown = false
  private treatyDefeated = false
  private treatyGateCooldown = 0
  private treatyClauseTimer = 0
  private treatyUnlockAnnounced = false
  private treatyUnlockDelay = 0

  // The frontier: one lieutenant goose per outlying pond, and the reclaim fight.
  private readonly lieutenants: Lieutenant[] = []
  private frontierActive = false
  private frontierResolve = 0
  private frontierWasQuackDown = false
  private activeLieutenant: Lieutenant | null = null
  private frontierUnlockAnnounced = false
  private frontierUnlockDelay = 0

  constructor(
    scene: THREE.Scene,
    private readonly sound: Sound,
    food: Food,
    pond: Pond,
    private readonly nests: Nests,
    private readonly input: Input,
    private readonly queen: THREE.Object3D,
    private readonly flock: Flock,
    private readonly onHonkOff: OnHonkOff,
    private readonly onBossFight: OnHonkOff,
    private readonly onTreatyFight: OnHonkOff,
    private readonly onBaronMessage: OnMessage,
    private readonly onQueenLost: OnQueenLost,
    private readonly resolvePenalty: ResolvePenalty,
    private readonly frontier: Frontier,
    colliders: readonly Collider[],
    rng: Rng,
    frontierRng: Rng,
  ) {
    for (let i = 0; i < GOOSE_COUNT; i++) {
      const angle = rng() * Math.PI * 2
      const radius = rng() * AREA_RADIUS
      const goose = new Goose(Math.cos(angle) * radius, AREA_CENTER_Z + Math.sin(angle) * radius, sound, food, pond, this.nests, colliders, rng)
      this.geese.push(goose)
      scene.add(goose.group)
    }

    // The Marsh Baron — a boss goose rooted in his marsh, deep past the pond.
    this.baron = new Goose(BARON_X, BARON_Z, sound, food, pond, this.nests, colliders, rng, true)
    scene.add(this.baron.group)
    addMarshDressing(scene, BARON_X, BARON_Z, rng)

    // Lord Boundary — pale, formal, and planted beside the old Treaty Stone. He
    // does not begin his challenge until the Marsh Baron has fallen.
    this.treatyBoss = new Goose(
      TREATY_FLATS.x - 3,
      TREATY_FLATS.z - 5,
      sound,
      food,
      pond,
      this.nests,
      colliders,
      rng,
      true,
      { bodyColor: 0x9fa8a3, scale: 1.28, crest: false, honkPitch: [0.66, 0.76], honkRate: 0.1 },
    )
    scene.add(this.treatyBoss.group)

    // One lieutenant gander stands sentinel at each outlying pond. They're visible
    // from the start (like the bosses), but their reclaim fight only opens once Lord
    // Boundary has yielded. Drawn from a SEPARATE rng stream so adding them doesn't
    // shift the gaggle/boss spawns for an existing seed.
    for (const territory of frontier.list) {
      const circle = territory.pond
      const angle = frontierRng() * Math.PI * 2
      const lx = circle.x + Math.cos(angle) * (circle.radius + 2) // post just off the shore
      const lz = circle.z + Math.sin(angle) * (circle.radius + 2)
      const goose = new Goose(lx, lz, sound, food, pond, this.nests, colliders, frontierRng, true, {
        bodyColor: LIEUTENANT_COLOR,
        scale: LIEUTENANT_SCALE,
        crest: false,
        honkPitch: LIEUTENANT_PITCH,
        honkRate: LIEUTENANT_HONK_RATE,
      })
      scene.add(goose.group)
      this.lieutenants.push({ goose, territory, claimed: false })
    }
  }

  update(delta: number): void {
    this.updateHonkOff(delta)
    this.updateBossFight(delta)
    this.updateTreatyFight(delta)
    this.updateFrontierFight(delta)
    for (const goose of this.geese) goose.update(delta)
    this.baron.update(delta)
    this.treatyBoss.update(delta)
    for (const lt of this.lieutenants) lt.goose.update(delta)
  }

  /** Whether the frontier phase has opened (Lord Boundary has yielded). Drives the
   *  HUD's frontier objective readout. */
  get frontierUnlocked(): boolean {
    return this.treatyDefeated
  }

  /** Every outlying pond reclaimed — the swan reacts to this turning point. */
  get frontierWon(): boolean {
    return this.frontier.allClaimed
  }

  /** Whether the Marsh Baron has been broken for good. Lets others (the swan)
   *  react to the turning point in the war. */
  get baronDefeated(): boolean {
    return this.bossDefeated
  }

  /** Compact enemy positions for HUD/minimap rendering. Bosses stay visible so
   *  the player can understand the territory even before engaging them. */
  get minimapEnemies(): EnemyMarker[] {
    return [
      ...this.geese.map((goose) => ({
        x: goose.group.position.x,
        z: goose.group.position.z,
        boss: false,
        defeated: false,
      })),
      {
        x: this.baron.group.position.x,
        z: this.baron.group.position.z,
        boss: true,
        defeated: this.bossDefeated,
      },
      {
        x: this.treatyBoss.group.position.x,
        z: this.treatyBoss.group.position.z,
        boss: true,
        defeated: this.treatyDefeated,
      },
      ...this.lieutenants.map((lt) => ({
        x: lt.goose.group.position.x,
        z: lt.goose.group.position.z,
        boss: false, // a lieutenant, not a boss — drawn as an orange (not red) mark
        defeated: lt.claimed,
      })),
    ]
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
    if (this.bossActive || this.treatyActive || this.frontierActive) return // boss/frontier fights take over the standoff
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
    const baseResolve = Math.min(0.55, 0.22 + this.flock.chorus.size * 0.05)
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
    if (this.frontierActive) return // a frontier reclaim is underway — don't double up

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
    const { drakes, others } = this.flock.calmCounts()
    return drakes + others >= BOSS_MIN_FOLLOWERS && drakes >= BOSS_MIN_DRAKES
  }

  private gateHint(): string {
    const { drakes, others } = this.flock.calmCounts()
    if (drakes < BOSS_MIN_DRAKES) return `🪿 The Baron sneers — bring more drakes (${drakes}/${BOSS_MIN_DRAKES})`
    return `🪿 The Baron sneers — bring a bigger flock (${drakes + others}/${BOSS_MIN_FOLLOWERS})`
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
      this.treatyUnlockDelay = 2.6
      this.flock.liftFollowerCap() // her leadership is proven — gather without limit now
      this.onBaronMessage('👑 THE MARSH BARON is broken — the marsh is yours!')
    } else {
      this.onQueenLost(bp.x, bp.z, qp.x, qp.z) // routed: panic flee + flock scatter
      this.bossGateCooldown = 6 // a breather before she can challenge again
    }
    this.bossActive = false
    this.bossResolve = 0
    this.onBossFight(false, 0)
  }

  // --- Lord Boundary, Treaty Flats boss --------------------------------------

  private updateTreatyFight(delta: number): void {
    if (this.treatyDefeated || this.bossActive || this.frontierActive) return

    const qx = this.queen.position.x
    const qz = this.queen.position.z
    const gp = this.treatyBoss.group.position

    if (!this.bossDefeated) {
      this.updateLockedTreatyHint(delta, qx, qz, gp)
      return
    }

    if (!this.treatyUnlockAnnounced) {
      if (this.treatyUnlockDelay > 0) {
        this.treatyUnlockDelay -= delta
        return
      }
      this.onBaronMessage('⚖️ The Treaty Flats are open — settle them before the next gander moves the line.')
      this.treatyUnlockAnnounced = true
    }

    if (this.treatyActive) {
      this.treatyBoss.aimAt(qx, qz)
      if (Math.hypot(gp.x - qx, gp.z - qz) > TREATY_DISENGAGE_RANGE) {
        this.endTreatyFight(false)
        return
      }

      this.treatyClauseTimer -= delta
      if (this.treatyClauseTimer <= 0) {
        this.treatyClauseTimer = TREATY_CLAUSE_INTERVAL
        this.applyTreatyClause()
      }

      const qDown = this.input.isDown('KeyQ')
      if (qDown && !this.treatyWasQuackDown) this.treatyResolve += QUACK_GAIN
      this.treatyWasQuackDown = qDown

      const { drakes, others } = this.flock.calmCounts()
      const calmSubjects = drakes + others
      const nests = this.treatyNestCount()
      const occupied = this.treatyOccupiedCount()
      const passive = Math.min(
        TREATY_FLOCK_FILL * calmSubjects + TREATY_NEST_FILL * nests + TREATY_OCCUPIED_FILL * occupied,
        TREATY_MAX_PASSIVE,
      )
      this.treatyResolve += (passive - TREATY_DRAIN) * delta
      this.treatyResolve = Math.max(0, Math.min(1, this.treatyResolve))
      this.onTreatyFight(true, this.treatyResolve)

      if (this.treatyResolve >= 1) this.endTreatyFight(true)
      else if (this.treatyResolve <= 0) this.endTreatyFight(false)
      return
    }

    if (this.treatyGateCooldown > 0) this.treatyGateCooldown -= delta
    if (Math.hypot(gp.x - qx, gp.z - qz) > TREATY_TRIGGER_RANGE) return
    if (this.hasTreatyFoothold()) {
      this.startTreatyFight()
    } else if (this.treatyGateCooldown <= 0) {
      this.onBaronMessage(this.treatyGateHint())
      this.treatyGateCooldown = 5
    }
  }

  private updateLockedTreatyHint(delta: number, qx: number, qz: number, gp: THREE.Vector3): void {
    if (this.treatyGateCooldown > 0) this.treatyGateCooldown -= delta
    if (this.treatyGateCooldown > 0) return
    if (Math.hypot(gp.x - qx, gp.z - qz) > TREATY_TRIGGER_RANGE) return
    this.onBaronMessage('⚖️ The treaty stones wait. Break the Marsh Baron first.')
    this.treatyGateCooldown = 5
  }

  private hasTreatyFoothold(): boolean {
    return this.treatyNestCount() >= TREATY_MIN_NESTS && this.treatyOccupiedCount() >= TREATY_MIN_OCCUPIED
  }

  private treatyNestCount(): number {
    return this.nests.countWithin(TREATY_FLATS.x, TREATY_FLATS.z, TREATY_FLATS.radius)
  }

  private treatyOccupiedCount(): number {
    return this.nests.occupiedWithin(TREATY_FLATS.x, TREATY_FLATS.z, TREATY_FLATS.radius)
  }

  private treatyGateHint(): string {
    const nests = this.treatyNestCount()
    const occupied = this.treatyOccupiedCount()
    if (nests < TREATY_MIN_NESTS) return `⚖️ Lord Boundary taps the stone — build nests in the Flats (${nests}/${TREATY_MIN_NESTS})`
    return `⚖️ Lord Boundary smiles thinly — seat hens to hold the Flats (${occupied}/${TREATY_MIN_OCCUPIED})`
  }

  private startTreatyFight(): void {
    this.treatyActive = true
    this.treatyBoss.startPosturing()
    this.treatyResolve = TREATY_START_RESOLVE
    this.treatyClauseTimer = TREATY_FIRST_CLAUSE
    this.treatyWasQuackDown = this.input.isDown('KeyQ')
    this.onBaronMessage('⚖️ LORD BOUNDARY invokes the old treaty!')
    this.onTreatyFight(true, this.treatyResolve)
  }

  /** Boundary's pressure is bureaucratic and territorial: every "clause" tests
   *  whether the Flats are occupied by actual duck care. Empty claims scatter;
   *  brooding hens make the border hold. */
  private applyTreatyClause(): void {
    const occupied = this.treatyOccupiedCount()
    if (occupied >= TREATY_MIN_OCCUPIED) {
      this.treatyResolve = Math.max(0, this.treatyResolve - TREATY_ANCHORED_KNOCKBACK)
      this.sound.honk(0.72)
      this.onBaronMessage('🪺 Your brooding hens hold the line.')
      return
    }

    this.treatyResolve = Math.max(0, this.treatyResolve - TREATY_CLAUSE_KNOCKBACK)
    this.flock.scatterFrom(TREATY_FLATS.x, TREATY_FLATS.z)
    this.sound.honk(0.7)
    this.onBaronMessage('⚖️ Boundary moves the line — settle the Flats, do not merely claim them!')
  }

  private endTreatyFight(won: boolean): void {
    const gp = this.treatyBoss.group.position
    const qp = this.queen.position
    this.treatyBoss.stopPosturing(won)
    if (won) {
      this.treatyDefeated = true
      this.frontierUnlockDelay = FRONTIER_UNLOCK_DELAY // a beat, then the frontier call lands
      this.onBaronMessage('⚖️ LORD BOUNDARY yields — the Treaty Flats hold!')
    } else {
      this.onQueenLost(gp.x, gp.z, qp.x, qp.z)
      this.treatyGateCooldown = 6
    }
    this.treatyActive = false
    this.treatyResolve = 0
    this.onTreatyFight(false, 0)
  }

  // --- The frontier ganders (reclaim the outlying ponds) ---------------------

  private updateFrontierFight(delta: number): void {
    if (!this.treatyDefeated) return // the frontier opens only after Lord Boundary yields

    // Once Boundary has fallen (and a short beat has passed), the swan's "furthest,
    // sleepiest edge" stirs: the call to reclaim the far ponds lands once.
    if (!this.frontierUnlockAnnounced) {
      if (this.frontierUnlockDelay > 0) {
        this.frontierUnlockDelay -= delta
        return
      }
      this.onBaronMessage('🪶 Ganders have crept onto your far ponds — drive each one off to reclaim the frontier.')
      this.frontierUnlockAnnounced = true
    }

    const qx = this.queen.position.x
    const qz = this.queen.position.z

    if (this.frontierActive && this.activeLieutenant) {
      const lt = this.activeLieutenant
      const gp = lt.goose.group.position
      lt.goose.aimAt(qx, qz)
      if (Math.hypot(gp.x - qx, gp.z - qz) > DISENGAGE_RANGE) {
        this.endFrontierFight(false) // she backed off — the gander holds
        return
      }

      const qDown = this.input.isDown('KeyQ')
      if (qDown && !this.frontierWasQuackDown) this.frontierResolve += QUACK_GAIN
      this.frontierWasQuackDown = qDown

      // Plain honk-off math (same as the gaggle): a decent chorus out-honks him.
      const chorus = this.flock.chorus
      const passiveSupport = Math.min(FLOCK_FILL * chorus.size * CHORUS_MULT[chorus.layers], MAX_PASSIVE_SUPPORT)
      this.frontierResolve += (passiveSupport - GOOSE_DRAIN) * delta
      this.frontierResolve = Math.max(0, Math.min(1, this.frontierResolve))
      this.onHonkOff(true, this.frontierResolve)

      if (this.frontierResolve >= 1) this.endFrontierFight(true)
      else if (this.frontierResolve <= 0) this.endFrontierFight(false)
      return
    }

    // Not fighting — and don't poach a turn from any other standoff.
    if (this.active || this.bossActive || this.treatyActive) return

    // Square up to the nearest un-claimed lieutenant within range.
    let nearest: Lieutenant | null = null
    let nearestSq = Infinity
    for (const lt of this.lieutenants) {
      if (lt.claimed || !lt.goose.engageable) continue
      const gp = lt.goose.group.position
      const range = lt.goose.honkOffTriggerRange(TRIGGER_RANGE)
      const dSq = (gp.x - qx) ** 2 + (gp.z - qz) ** 2
      if (dSq >= range * range) continue
      if (dSq < nearestSq) {
        nearestSq = dSq
        nearest = lt
      }
    }
    if (nearest) this.startFrontierFight(nearest)
  }

  private startFrontierFight(lt: Lieutenant): void {
    this.frontierActive = true
    this.activeLieutenant = lt
    lt.goose.startPosturing()
    const baseResolve = Math.min(0.55, 0.22 + this.flock.chorus.size * 0.05)
    this.frontierResolve = Math.max(0.05, baseResolve - this.resolvePenalty())
    this.frontierWasQuackDown = this.input.isDown('KeyQ')
    this.onHonkOff(true, this.frontierResolve)
  }

  private endFrontierFight(won: boolean): void {
    const lt = this.activeLieutenant
    if (lt) {
      const gp = lt.goose.group.position
      const qp = this.queen.position
      lt.goose.stopPosturing(won) // won → he breaks and flees off the pond; lost → he struts
      if (won) {
        lt.claimed = true
        this.frontier.claim(lt.territory) // flips the pond to the Queen + clears its water
        if (this.frontier.allClaimed) {
          this.onBaronMessage('👑 The frontier is yours — every far pond flies your banner!')
        } else {
          this.onBaronMessage(`🪶 Pond reclaimed — the frontier holds (${this.frontier.claimedCount}/${this.frontier.total}).`)
        }
      } else {
        this.onQueenLost(gp.x, gp.z, qp.x, qp.z) // routed: panic flee + flock scatter
      }
    }
    this.frontierActive = false
    this.activeLieutenant = null
    this.frontierResolve = 0
    this.onHonkOff(false, 0)
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
