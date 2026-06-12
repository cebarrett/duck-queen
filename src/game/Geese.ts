import * as THREE from 'three'
import { Goose } from './Goose'
import { Standoff } from './Standoff'
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
import { FOLLOWER_CAP, type Progress } from './Progress'

const GOOSE_COUNT = 3
const AREA_CENTER_Z = -50 // out past the pond (which sits at z = -26)
const AREA_RADIUS = 12

// A wider gaggle keeps the marsh feeling contested after the opening minutes.
// These are ordinary geese (not frontier lieutenants): they steal food, raid
// brooding hens, and can be driven off with the same honk-off as the first three.
const ROAMING_GOOSE_COUNT = 9
const ROAMING_SPREAD = 105
const ROAMING_MIN_DIST = 28 // keep the starting clearing breathable
const ROAMING_MAX_DIST = 112 // within the ground/fogged playable world
const ROAMING_POND_MARGIN = 3
const ROAMING_COLLIDER_MARGIN = 1.5
const ROAMING_GOOSE_MARGIN = 6
const ROAMING_BARON_CLEAR = 18
const ROAMING_TREATY_CLEAR = TREATY_FLATS.radius + 8

// The Marsh Baron holds his own patch of marsh, deeper out than the gaggle.
const BARON_X = 0
const BARON_Z = -72

// --- Honk-off tuning -------------------------------------------------------
const TRIGGER_RANGE = 5 // a honk-off begins when the Queen gets this close to a goose
const DISENGAGE_RANGE = 9 // backing this far away ends it (counts as a loss)
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
const BOSS_MIN_FOLLOWERS = FOLLOWER_CAP // cap and gate are deliberately the same — see Progress.ts
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
// gaggle — steel-blue "officers", a touch bigger — but reclaiming is a plain
// honk-off (the same resolve math as the gaggle), gated only behind Lord
// Boundary having fallen first.
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
 * Each encounter (gaggle, Marsh Baron, Lord Boundary, frontier lieutenant) is a
 * Standoff instance sharing the same Q-press / fill-minus-drain mechanics, with
 * per-encounter drain rates, passive-support formulas, and periodic effects.
 * Mutual exclusion is structural: only one Standoff is active at a time via
 * currentStandoff.
 */
export class Geese {
  private readonly geese: Goose[] = []
  private readonly baron: Goose
  private readonly treatyBoss: Goose

  private readonly gaggleStandoff: Standoff
  private readonly bossStandoff: Standoff
  private readonly treatyStandoff: Standoff
  private readonly frontierStandoff: Standoff
  private currentStandoff: Standoff | null = null

  private bossGateCooldown = 0
  private treatyGateCooldown = 0
  private treatyUnlockAnnounced = false
  private treatyUnlockDelay = 0
  private readonly lieutenants: Lieutenant[] = []
  private activeLieutenant: Lieutenant | null = null
  private frontierUnlockAnnounced = false
  private frontierUnlockDelay = 0

  constructor(
    scene: THREE.Scene,
    private readonly sound: Sound,
    food: Food,
    pond: Pond,
    private readonly nests: Nests,
    input: Input,
    private readonly queen: THREE.Object3D,
    private readonly flock: Flock,
    private readonly setHonkOff: (active: boolean, resolve: number, label?: string, color?: string) => void,
    private readonly onBaronMessage: OnMessage,
    private readonly onQueenLost: OnQueenLost,
    private readonly resolvePenalty: ResolvePenalty,
    private readonly frontier: Frontier,
    private readonly progress: Progress,
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

    this.baron = new Goose(BARON_X, BARON_Z, sound, food, pond, this.nests, colliders, rng, true)
    scene.add(this.baron.group)
    addMarshDressing(scene, BARON_X, BARON_Z, rng)

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

    for (const territory of frontier.list) {
      const circle = territory.pond
      const angle = frontierRng() * Math.PI * 2
      const lx = circle.x + Math.cos(angle) * (circle.radius + 2)
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

    for (let i = 0; i < ROAMING_GOOSE_COUNT; i++) {
      const spot = this.pickRoamingGooseSpot(pond, colliders, rng)
      if (!spot) break
      const goose = new Goose(spot.x, spot.z, sound, food, pond, this.nests, colliders, rng)
      this.geese.push(goose)
      scene.add(goose.group)
    }

    const clearCurrent = () => {
      this.currentStandoff = null
    }
    const gagglePassive = () => {
      const { size, layers } = this.flock.chorus
      return Math.min(FLOCK_FILL * size * CHORUS_MULT[layers], MAX_PASSIVE_SUPPORT)
    }
    const gaggleStart = () =>
      Math.max(0.05, Math.min(0.55, 0.22 + this.flock.chorus.size * 0.05) - this.resolvePenalty())

    this.gaggleStandoff = new Standoff(input, queen, {
      disengageRange: DISENGAGE_RANGE,
      drain: GOOSE_DRAIN,
      startResolve: gaggleStart,
      passiveSupport: gagglePassive,
      onWin: () => {},
      onLose: (goose, qp) => this.onQueenLost(goose.group.position.x, goose.group.position.z, qp.x, qp.z),
      onUpdate: (active, resolve) => this.setHonkOff(active, resolve),
      onFinish: clearCurrent,
    })

    this.bossStandoff = new Standoff(input, queen, {
      disengageRange: BOSS_DISENGAGE_RANGE,
      drain: BOSS_DRAIN,
      startResolve: () => BOSS_START_RESOLVE,
      passiveSupport: () => {
        const { drakes, others } = this.flock.calmCounts()
        return Math.min(BOSS_DRAKE_FILL * drakes + BOSS_OTHER_FILL * others, BOSS_MAX_PASSIVE)
      },
      periodicInterval: BOSS_SPLIT_INTERVAL,
      firstPeriod: BOSS_FIRST_SPLIT,
      onPeriodic: (knockback) => this.doSplit(knockback),
      onStart: () => this.onBaronMessage('👑 THE MARSH BARON squares up!'),
      onWin: () => {
        this.progress.baronDefeated = true
        this.treatyUnlockDelay = 2.6
        this.onBaronMessage('👑 THE MARSH BARON is broken — the marsh is yours!')
      },
      onLose: (goose, qp) => {
        this.onQueenLost(goose.group.position.x, goose.group.position.z, qp.x, qp.z)
        this.bossGateCooldown = 6
      },
      onUpdate: (active, resolve) => this.setHonkOff(active, resolve, '👑 THE MARSH BARON — mash Q!', '#e23b3b'),
      onFinish: clearCurrent,
    })

    this.treatyStandoff = new Standoff(input, queen, {
      disengageRange: TREATY_DISENGAGE_RANGE,
      drain: TREATY_DRAIN,
      startResolve: () => TREATY_START_RESOLVE,
      passiveSupport: () => {
        const { drakes, others } = this.flock.calmCounts()
        const nests = this.treatyNestCount()
        const occupied = this.treatyOccupiedCount()
        return Math.min(
          TREATY_FLOCK_FILL * (drakes + others) + TREATY_NEST_FILL * nests + TREATY_OCCUPIED_FILL * occupied,
          TREATY_MAX_PASSIVE,
        )
      },
      periodicInterval: TREATY_CLAUSE_INTERVAL,
      firstPeriod: TREATY_FIRST_CLAUSE,
      onPeriodic: (knockback) => this.applyTreatyClause(knockback),
      onStart: () => this.onBaronMessage('⚖️ LORD BOUNDARY invokes the old treaty!'),
      onWin: () => {
        this.progress.treatyDefeated = true
        this.frontierUnlockDelay = FRONTIER_UNLOCK_DELAY
        this.onBaronMessage('⚖️ LORD BOUNDARY yields — the Treaty Flats hold!')
      },
      onLose: (goose, qp) => {
        this.onQueenLost(goose.group.position.x, goose.group.position.z, qp.x, qp.z)
        this.treatyGateCooldown = 6
      },
      onUpdate: (active, resolve) => this.setHonkOff(active, resolve, '⚖️ LORD BOUNDARY — hold the line!', '#88d66c'),
      onFinish: clearCurrent,
    })

    this.frontierStandoff = new Standoff(input, queen, {
      disengageRange: DISENGAGE_RANGE,
      drain: GOOSE_DRAIN,
      startResolve: gaggleStart,
      passiveSupport: gagglePassive,
      onWin: () => {
        const lt = this.activeLieutenant!
        lt.claimed = true
        this.frontier.claim(lt.territory)
        if (this.frontier.allClaimed) {
          this.onBaronMessage('👑 The frontier is yours — every far pond flies your banner!')
        } else {
          this.onBaronMessage(`🪶 Pond reclaimed — the frontier holds (${this.frontier.claimedCount}/${this.frontier.total}).`)
        }
      },
      onLose: (goose, qp) => this.onQueenLost(goose.group.position.x, goose.group.position.z, qp.x, qp.z),
      onUpdate: (active, resolve) => this.setHonkOff(active, resolve),
      onFinish: () => {
        clearCurrent()
        this.activeLieutenant = null
      },
    })
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
        defeated: this.progress.baronDefeated,
      },
      {
        x: this.treatyBoss.group.position.x,
        z: this.treatyBoss.group.position.z,
        boss: true,
        defeated: this.progress.treatyDefeated,
      },
      ...this.lieutenants.map((lt) => ({
        x: lt.goose.group.position.x,
        z: lt.goose.group.position.z,
        boss: false,
        defeated: lt.claimed,
      })),
    ]
  }

  /** The nearest gaggle goose to (x, z), or null if there are none. */
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
    if (this.currentStandoff === this.gaggleStandoff) {
      this.gaggleStandoff.update(delta)
      return
    }
    if (this.currentStandoff) return

    const qx = this.queen.position.x
    const qz = this.queen.position.z
    let nearest: Goose | null = null
    let nearestSq = Infinity
    for (const g of this.geese) {
      if (!g.engageable) continue
      const range = g.honkOffTriggerRange(TRIGGER_RANGE)
      const dSq = (g.group.position.x - qx) ** 2 + (g.group.position.z - qz) ** 2
      if (dSq >= range * range) continue
      if (dSq < nearestSq) {
        nearestSq = dSq
        nearest = g
      }
    }
    if (nearest) this.startStandoff(this.gaggleStandoff, nearest)
  }

  private updateBossFight(delta: number): void {
    if (this.progress.baronDefeated) return
    if (this.currentStandoff === this.bossStandoff) {
      this.bossStandoff.update(delta)
      return
    }
    if (this.currentStandoff) return

    const qx = this.queen.position.x
    const qz = this.queen.position.z
    const bp = this.baron.group.position
    if (this.bossGateCooldown > 0) this.bossGateCooldown -= delta
    if (Math.hypot(bp.x - qx, bp.z - qz) > BOSS_TRIGGER_RANGE) return
    if (this.isFlockFormidable()) {
      this.startStandoff(this.bossStandoff, this.baron)
    } else if (this.bossGateCooldown <= 0) {
      this.onBaronMessage(this.gateHint())
      this.bossGateCooldown = 5
    }
  }

  private updateTreatyFight(delta: number): void {
    if (this.progress.treatyDefeated) return
    if (this.currentStandoff === this.treatyStandoff) {
      this.treatyStandoff.update(delta)
      return
    }
    if (this.currentStandoff) return

    const qx = this.queen.position.x
    const qz = this.queen.position.z
    const gp = this.treatyBoss.group.position

    if (!this.progress.baronDefeated) {
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

    if (this.treatyGateCooldown > 0) this.treatyGateCooldown -= delta
    if (Math.hypot(gp.x - qx, gp.z - qz) > TREATY_TRIGGER_RANGE) return
    if (this.hasTreatyFoothold()) {
      this.startStandoff(this.treatyStandoff, this.treatyBoss)
    } else if (this.treatyGateCooldown <= 0) {
      this.onBaronMessage(this.treatyGateHint())
      this.treatyGateCooldown = 5
    }
  }

  private updateFrontierFight(delta: number): void {
    if (!this.progress.treatyDefeated) return

    if (!this.frontierUnlockAnnounced) {
      if (this.frontierUnlockDelay > 0) {
        this.frontierUnlockDelay -= delta
        return
      }
      this.onBaronMessage('🪶 Ganders have crept onto your far ponds — drive each one off to reclaim the frontier.')
      this.frontierUnlockAnnounced = true
    }

    if (this.currentStandoff === this.frontierStandoff) {
      this.frontierStandoff.update(delta)
      return
    }
    if (this.currentStandoff) return

    const qx = this.queen.position.x
    const qz = this.queen.position.z
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
    if (nearest) {
      this.activeLieutenant = nearest
      this.startStandoff(this.frontierStandoff, nearest.goose)
    }
  }

  private startStandoff(standoff: Standoff, goose: Goose): void {
    this.currentStandoff = standoff
    standoff.start(goose)
  }

  private pickRoamingGooseSpot(
    pond: Pond,
    colliders: readonly Collider[],
    rng: Rng,
  ): { x: number; z: number } | null {
    for (let guard = 0; guard < 600; guard++) {
      const x = (rng() * 2 - 1) * ROAMING_SPREAD
      const z = (rng() * 2 - 1) * ROAMING_SPREAD
      const distFromSpawn = Math.hypot(x, z)
      if (distFromSpawn < ROAMING_MIN_DIST || distFromSpawn > ROAMING_MAX_DIST) continue
      if (pond.overlaps(x, z, ROAMING_POND_MARGIN)) continue
      if (Math.hypot(x - BARON_X, z - BARON_Z) < ROAMING_BARON_CLEAR) continue
      if (Math.hypot(x - TREATY_FLATS.x, z - TREATY_FLATS.z) < ROAMING_TREATY_CLEAR) continue
      if (this.tooCloseToCollider(x, z, colliders)) continue
      if (this.tooCloseToGoose(x, z)) continue
      return { x, z }
    }
    return null
  }

  private tooCloseToCollider(x: number, z: number, colliders: readonly Collider[]): boolean {
    for (const c of colliders) {
      if (Math.hypot(x - c.x, z - c.z) < c.radius + ROAMING_COLLIDER_MARGIN) return true
    }
    return false
  }

  private tooCloseToGoose(x: number, z: number): boolean {
    for (const goose of this.geese) {
      const gp = goose.group.position
      if (Math.hypot(x - gp.x, z - gp.z) < ROAMING_GOOSE_MARGIN) return true
    }
    return false
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

  /** His splitting honk: scatter one non-drake voice and knock the meter back. */
  private doSplit(knockback: (amount: number) => void): void {
    const bp = this.baron.group.position
    const scattered = this.flock.splitNonDrakes(bp.x, bp.z)
    if (scattered === 0) return
    knockback(BOSS_SPLIT_KNOCKBACK)
    this.sound.honk(0.5)
    this.onBaronMessage('💥 The Baron scatters your soft voices — hold with the drakes!')
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

  /** Boundary's pressure: every clause tests whether the Flats are truly occupied.
   *  Brooding hens anchor the border; empty claims scatter. */
  private applyTreatyClause(knockback: (amount: number) => void): void {
    const occupied = this.treatyOccupiedCount()
    if (occupied >= TREATY_MIN_OCCUPIED) {
      knockback(TREATY_ANCHORED_KNOCKBACK)
      this.sound.honk(0.72)
      this.onBaronMessage('🪺 Your brooding hens hold the line.')
      return
    }
    knockback(TREATY_CLAUSE_KNOCKBACK)
    this.flock.scatterFrom(TREATY_FLATS.x, TREATY_FLATS.z)
    this.sound.honk(0.7)
    this.onBaronMessage('⚖️ Boundary moves the line — settle the Flats, do not merely claim them!')
  }
}

/** Light dressing for the Baron's turf: a few dark marsh reeds scattered around
 *  his spot. Seeded (it's world dressing), shares one material, no collision. */
function addMarshDressing(scene: THREE.Scene, cx: number, cz: number, rng: Rng): void {
  const mat = new THREE.MeshStandardMaterial({ color: 0x2f4a38 })
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2
    const r = 2.5 + rng() * 5
    const h = 1.2 + rng() * 1.6
    const reed = new THREE.Mesh(new THREE.BoxGeometry(0.12, h, 0.12), mat)
    reed.position.set(cx + Math.cos(a) * r, h / 2, cz + Math.sin(a) * r)
    scene.add(reed)
  }
}
