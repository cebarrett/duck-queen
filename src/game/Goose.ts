import * as THREE from 'three'
import { buildGoose, setGooseBillOpen } from './gooseModel'
import { approachAngle, randRange, seekArrive, pointAround, faceHeading, easeFactor } from './mathUtils'
import { type Collider, resolveWalls } from './collision'
import type { Pond } from './Water'
import type { Sound } from './Sound'
import type { Food, FoodItem } from './Food'
import type { Nest, Nests } from './Nests'
import { type Rng, rngRange } from './rng'

// --- Wander tuning (geese amble a bit faster/heavier than ducklings) -------
const SPEED = 2.2
const RESPONSIVENESS = 4
const WANDER_RADIUS = 8 // how far from home it picks its next spot
const ARRIVE_RADIUS = 1.5
const ARRIVE_STOP = 0.4
const PAUSE_MIN = 1.5
const PAUSE_MAX = 5.0
const TURN_SPEED = 6

// --- Walk + idle animation -------------------------------------------------
const MOVING = 0.3 // speed above which it's "walking" (vs idling)
const WALK_FREQ = 3.5 // base stride cadence — slow & deliberate (a duck waddles faster)
const WALK_SPEED_FREQ = 0.8 // extra cadence per unit of speed
const WALK_BOB = 0.05 // gentle up/down body bob per stride
const WALK_ROLL = 0.05 // a little side sway (much less than a duck's waddle)
const WALK_HEAD_BOB = 0.14 // the neck dips in rhythm as it strides
const BOLD_WALK_BOB = 0.08 // extra showy bob while strutting after a win
const BOLD_WALK_ROLL = 0.12 // broad, smug sway while strutting
const BOLD_HEAD_LIFT = -0.22 // proud neck lift after winning a honk-off
const IDLE_GAP_MIN = 2.5 // shortest gap between idle fidgets (seconds)
const IDLE_GAP_MAX = 6.0 // longest gap

// --- Swimming (when over the pond) -----------------------------------------
// The goose's model origin is at its feet with ~0.5-tall legs under the body,
// so it must sink further than a duck to float convincingly: drop it until the
// legs are under the surface and the waterline rides up its body.
const SWIM_FLOAT_Y = -0.6 // body settles to this y while afloat (legs submerged)
const SWIM_BOB = 0.05 // gentle vertical bob on the water (no walk stride)
const SWIM_SWAY = 0.06 // slight side-to-side sway

const HONK_RATE = 0.012 // per second: rare idle chatter; real samples get loud fast

// --- World collision -------------------------------------------------------
const COLLIDE_RADIUS = 0.6 // its footprint vs. trees/rocks (bigger than a duckling)
const COLLIDE_HEIGHT = 1.2 // collision height; canopies float above this (walk under)

// --- Foraging (the rivalry: geese eat YOUR plants) -------------------------
const FORAGE_RADIUS = 7 // how far a goose will notice a plant and go for it
const FORAGE_RATE = 0.5 // per second: chance to spot + go for an in-range plant
const BOLD_FORAGE_RADIUS = 10 // bold geese scan farther for plants
const BOLD_FORAGE_RATE = 1.0 // bold geese try to steal more often
const EAT_RADIUS = 1.1 // close enough to snatch a plant

// --- Raiding nests (geese actively hunt brooding hens) ---------------------
const RAID_RADIUS = 24 // how far a goose will spot a brooding hen and stalk over to it
const BOLD_RAID_RADIUS = 34 // a bold goose ranges even farther to harass nests

// --- Posturing (during a honk-off) -----------------------------------------
const PUFF_SCALE = 1.22 // how big it swells while squaring up
const POSTURE_TURN = 10 // how fast it spins to face the Queen
const POSTURE_HONK_RATE = 0.65 // face-off honks, without overlapping real samples
const PUFF_EASE = 8 // how fast it puffs up / deflates
const POSTURE_FLAP_SPEED = 11 // rhythmic face-off wingbeats
const POSTURE_BOB = 0.09 // little affronted bounce while squaring up
const POSTURE_SWAY = 0.13 // side-to-side "you dare?" wobble
const POSTURE_WING_REST = 0.35 // wings held partly out during a challenge
const POSTURE_WING_FLAP = 0.38 // extra wing pump on each beat
const POSTURE_HEAD_LIFT = -0.28 // proud, long-necked challenge lift
const POSTURE_HEAD_BOB = 0.16 // neck jab layered onto the lifted posture
const GOOSE_BILL_TIME = 0.46 // how long the bill gapes after a honk
const GOOSE_BILL_SYLLABLE = 0.2
const HONKOFF_COOLDOWN = 5 // after losing a honk-off (it won), brief no-re-fight gap
const BOLD_TIME = 12 // after winning a honk-off, it struts and steals harder
const BOLD_TRIGGER_SCALE = 1.25 // Geese can use this to slightly widen trigger range

// --- Defeat / routing (the Queen won the honk-off) -------------------------
const FLEE_SPEED = 8 // it bolts away fast
const FLEE_DISTANCE = 32 // how far it flees
const FLEE_ALTITUDE = 7 // peak height of the panic flight arc
const FLEE_FLAP_SPEED = 18 // frantic wingbeats while routed
const FLEE_WING_REST = 0.75 // baseline wing spread in flight
const FLEE_WING_FLAP = 0.45 // extra up/down flap amplitude
const FLEE_BANK = 0.16 // anxious side roll while airborne
const FLEE_NECK_LIFT = -0.2 // head up and away from the Queen
const COWED_TIME = 12 // after being beaten: won't forage or raid for this long
const ROUT_RECHALLENGE = 2 // ...but she can re-challenge it this soon — press the rout to herd it farther
const ROUT_NEST_RANGE = RAID_RADIUS // if a nest is within this when it's beaten, it flees away from the NEST too

// --- The Marsh Baron (boss goose) ------------------------------------------
const BARON_COLOR = 0x3c3f45 // charcoal — far darker than the pale gaggle
const BARON_SCALE = 1.4 // a head taller and broader than a regular goose
const BARON_HONK_RATE = 0.04 // deep menace, not a constant foghorn

type GooseState = 'pausing' | 'wandering' | 'foraging' | 'fleeing' | 'raiding'

interface BossGooseOptions {
  bodyColor?: number
  scale?: number
  crest?: boolean
  honkPitch?: readonly [number, number]
  honkRate?: number
}

/**
 * A rival goose. For now it just wanders its patch and honks occasionally — the
 * same "seek a target, ease toward it, pause" shape as the duckling, since that
 * pattern has served us well. Later phases add foraging, posturing, and fleeing.
 */
export class Goose {
  readonly group: THREE.Group
  // The animatable parts (pivots) of the model.
  private readonly leftWing: THREE.Group
  private readonly rightWing: THREE.Group
  private readonly neck: THREE.Group
  private readonly upperBill: THREE.Group
  private readonly lowerBill: THREE.Group

  private homeX: number
  private homeZ: number
  private velX = 0
  private velZ = 0
  private heading = 0
  private walkPhase = 0

  // Idle fidgets while standing around.
  private idleAction: 'none' | 'flap' | 'look' | 'peck' = 'none'
  private idleTime = 0 // elapsed in the current fidget
  private nextIdle = randRange(IDLE_GAP_MIN, IDLE_GAP_MAX) // countdown to the next one

  private state: GooseState = 'pausing'
  private timer: number
  private targetX = 0
  private targetZ = 0
  private targetFood: FoodItem | null = null // the plant it's stealing toward
  private targetNest: Nest | null = null // the brooding hen's nest it's stalking
  private fleeStartX = 0
  private fleeStartZ = 0
  private fleeDistance = 1

  // Its own honk pitch, so a gaggle sounds like distinct birds. Seeded (ctor).
  private readonly honkPitch: number
  // Collision footprint — bigger for the (larger) Baron.
  private readonly collideRadius: number
  private readonly collideHeight: number
  // Base size (1, or the Baron's bigger scale); puff multiplies this so posturing
  // swells him from his real size rather than snapping him back to 1.
  private readonly baseScale: number
  private readonly bossHonkRate: number
  private billTimer = 0
  private billDuration = GOOSE_BILL_TIME

  // Honk-off state: while posturing it ignores its normal behaviour, squares up
  // to face the Queen (aimX/aimZ), and "puffs up" (a swelling scale).
  private posturing = false
  private aimX = 0
  private aimZ = 0
  private puff = 1
  private cooldown = 0 // seconds until it can be drawn into another honk-off
  private cowed = 0 // seconds it stays rattled after a defeat (won't forage)
  private bold = 0 // seconds of smug confidence after it wins a honk-off

  constructor(
    x: number,
    z: number,
    private readonly sound: Sound,
    private readonly listener: THREE.Object3D,
    private readonly food: Food,
    private readonly pond: Pond,
    private readonly nests: Nests,
    private readonly colliders: readonly Collider[],
    rng: Rng,
    // The Marsh Baron is a boss goose: bigger, darker, crested, deep-voiced, and
    // rooted to his spot (he doesn't wander, forage, or raid).
    private readonly boss = false,
    bossOptions: BossGooseOptions = {},
  ) {
    const bossScale = bossOptions.scale ?? BARON_SCALE
    const model = boss
      ? buildGoose({
          bodyColor: bossOptions.bodyColor ?? BARON_COLOR,
          scale: bossScale,
          crest: bossOptions.crest ?? true,
        })
      : buildGoose()
    this.group = model.group
    this.leftWing = model.leftWing
    this.rightWing = model.rightWing
    this.neck = model.neck
    this.upperBill = model.upperBill
    this.lowerBill = model.lowerBill
    this.group.position.set(x, 0, z)
    this.homeX = x
    this.homeZ = z

    this.collideRadius = boss ? COLLIDE_RADIUS * bossScale : COLLIDE_RADIUS
    this.collideHeight = boss ? COLLIDE_HEIGHT * bossScale : COLLIDE_HEIGHT
    this.baseScale = boss ? bossScale : 1
    this.bossHonkRate = bossOptions.honkRate ?? BARON_HONK_RATE

    // Spawn-time values from the seeded rng so the initial world is stable. The
    // Baron's voice sits much lower — a deep, ominous honk.
    const bossPitch = bossOptions.honkPitch ?? [0.5, 0.62]
    this.honkPitch = boss ? rngRange(rng, bossPitch[0], bossPitch[1]) : rngRange(rng, 0.9, 1.15)
    this.heading = rng() * Math.PI * 2
    this.group.rotation.y = this.heading
    this.timer = randRange(0, PAUSE_MAX) // first-move timing — fine to stay unseeded
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

  /** A bold goose has just won a honk-off and is acting like it owns the pond. */
  get isBold(): boolean {
    return this.bold > 0
  }

  /** Helper for honk-off owners that want bold geese to start from farther away. */
  honkOffTriggerRange(baseRange: number): number {
    return this.isBold ? baseRange * BOLD_TRIGGER_SCALE : baseRange
  }

  /** Start a honk-off: square up and puff, dropping whatever it was doing
   *  (including any idle fidget — reset the wings/neck to neutral). */
  startPosturing(): void {
    this.posturing = true
    this.targetFood = null
    this.targetNest = null
    this.idleAction = 'none'
    this.neck.rotation.set(0, 0, 0)
    this.leftWing.rotation.z = 0
    this.rightWing.rotation.z = 0
  }

  /** End the honk-off. `won` = the QUEEN won. */
  stopPosturing(won: boolean): void {
    this.posturing = false

    if (won) {
      // Routed! A low, defeated honk, then it bolts. It flees away from the Queen
      // and — if it was menacing one of her nests — away from that nest too, so a
      // win clears it OFF the nest instead of just nudging it sideways. Crucially it
      // RE-HOMES where it lands (its patch moves outward), so it won't drift back to
      // the nest; it stays cowed (no foraging / raiding) but can be re-challenged
      // after only a short beat, so she can chase it down and herd it even farther.
      this.honk(this.honkPitch * 0.8)
      const pos = this.group.position
      let dx = pos.x - this.aimX // away from the Queen's last position
      let dz = pos.z - this.aimZ
      const d = Math.hypot(dx, dz) || 1
      dx /= d
      dz /= d
      const nest = this.nests.nearestNest(pos.x, pos.z, ROUT_NEST_RANGE)
      if (nest) {
        // Blend in an "away from the nest" push so it leaves no matter which side
        // she drove it from, then re-normalise to a clean unit heading.
        const nx = pos.x - nest.x
        const nz = pos.z - nest.z
        const nd = Math.hypot(nx, nz) || 1
        dx += nx / nd
        dz += nz / nd
        const bd = Math.hypot(dx, dz) || 1
        dx /= bd
        dz /= bd
      }
      this.fleeStartX = pos.x
      this.fleeStartZ = pos.z
      this.targetX = pos.x + dx * FLEE_DISTANCE
      this.targetZ = pos.z + dz * FLEE_DISTANCE
      this.fleeDistance = Math.max(1, Math.hypot(this.targetX - this.fleeStartX, this.targetZ - this.fleeStartZ))
      this.homeX = this.targetX // claim new ground out here — don't drift back to the nest
      this.homeZ = this.targetZ
      this.state = 'fleeing'
      this.cooldown = ROUT_RECHALLENGE // she can press the rout again soon
      this.cowed = COWED_TIME // but it's too rattled to forage / raid for a while
      this.bold = 0
    } else {
      // It held its ground: a smug honk, then straight back to its business.
      this.honk(this.honkPitch * 1.1)
      this.state = 'pausing'
      this.timer = randRange(PAUSE_MIN, PAUSE_MAX)
      this.cooldown = HONKOFF_COOLDOWN
      this.bold = BOLD_TIME
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
      this.puff += (1 - this.puff) * easeFactor(PUFF_EASE, delta)
      if (Math.abs(this.puff - 1) < 0.005) this.puff = 1
      this.group.scale.setScalar(this.baseScale * this.puff)
    }
    if (this.cooldown > 0) this.cooldown -= delta
    if (this.cowed > 0) this.cowed -= delta
    if (this.bold > 0) this.bold -= delta

    // An occasional honk (the Baron's deep menace, more often).
    const honkRate = this.boss ? this.bossHonkRate : HONK_RATE
    if (Math.random() < honkRate * delta) this.honk(this.honkPitch, 'ambient')

    // While calmly milling about, pick a target: a brooding hen takes priority —
    // if one's nest is in range the goose stalks straight over (this is what makes
    // geese actively menace your nests) — otherwise it eyes your plants. The Baron
    // does none of this: he holds his ground and waits.
    if (!this.boss && (this.state === 'wandering' || this.state === 'pausing')) {
      if (!this.tryRaid()) {
        const forageRate = this.isBold ? BOLD_FORAGE_RATE : FORAGE_RATE
        if (Math.random() < forageRate * delta) this.tryForage()
      }
    }

    switch (this.state) {
      case 'raiding':
        this.raid(delta)
        break
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
        if (!this.boss && this.timer <= 0) this.pickNewTarget() // the Baron never wanders off
        break
    }

    // Apply movement.
    const pos = this.group.position
    pos.x += this.velX * delta
    pos.z += this.velZ * delta

    // Push out of any tree/rock it walked into (stepUp 0 = it doesn't climb).
    // Routed geese are airborne, so they clear obstacles instead of shuffling
    // around them on the ground.
    if (this.state !== 'fleeing') {
      const vel = { x: this.velX, z: this.velZ }
      resolveWalls(pos, vel, this.collideRadius, 0, this.collideHeight, 0, this.colliders)
      this.velX = vel.x
      this.velZ = vel.z
    }

    // Face travel direction.
    const speed = Math.hypot(this.velX, this.velZ)
    this.heading = faceHeading(this.heading, this.velX, this.velZ, TURN_SPEED, delta)
    this.group.rotation.y = this.heading
    this.applyPose(delta, speed)
    this.updateBill(delta)
  }

  /** Float on the pond, stride deliberately on land, or — when standing — fidget. */
  private applyPose(delta: number, speed: number): void {
    const pos = this.group.position

    if (this.state === 'fleeing') {
      this.flyPose(delta)
      return
    }

    // Over the pond it swims: it floats at the waterline instead of walking on it.
    if (this.pond.isWater(pos.x, pos.z)) {
      this.swimPose(delta)
      return
    }

    if (this.isBold) {
      this.applyBoldPose(delta, speed)
      return
    }

    if (speed > MOVING) {
      // Deliberate stride: gentle body bob + slight sway, and the neck head-bobs
      // in rhythm. Wings stay folded.
      this.idleAction = 'none'
      this.walkPhase += delta * (WALK_FREQ + speed * WALK_SPEED_FREQ)
      pos.y = Math.abs(Math.sin(this.walkPhase)) * WALK_BOB
      this.group.rotation.z = Math.sin(this.walkPhase) * WALK_ROLL
      this.neck.rotation.set(WALK_HEAD_BOB * (0.5 + 0.5 * Math.sin(this.walkPhase)), 0, 0)
      this.leftWing.rotation.z = 0
      this.rightWing.rotation.z = 0
    } else {
      pos.y = 0
      this.group.rotation.z = 0
      this.updateIdle(delta)
    }
  }

  /** A bold goose reads as smug: high neck, showy stride, and cocked wings. */
  private applyBoldPose(delta: number, speed: number): void {
    this.idleAction = 'none'
    this.walkPhase += delta * (WALK_FREQ + Math.max(speed, 1) * 1.25)

    const strut = 0.5 + 0.5 * Math.sin(this.walkPhase)
    this.group.position.y = Math.abs(Math.sin(this.walkPhase)) * BOLD_WALK_BOB
    this.group.rotation.z = Math.sin(this.walkPhase) * BOLD_WALK_ROLL
    this.neck.rotation.set(BOLD_HEAD_LIFT + WALK_HEAD_BOB * strut * 0.4, Math.sin(this.walkPhase * 0.5) * 0.18, 0)
    this.leftWing.rotation.z = -0.18 - strut * 0.08
    this.rightWing.rotation.z = 0.18 + strut * 0.08
  }

  /** Float on the water: sink to the waterline with a slow bob + sway, wings
   *  folded and neck neutral — no walk stride, no ground fidgets (it's swimming). */
  private swimPose(delta: number): void {
    this.idleAction = 'none'
    this.walkPhase += delta * 2.5
    this.group.position.y = SWIM_FLOAT_Y + Math.sin(this.walkPhase) * SWIM_BOB
    this.group.rotation.z = Math.sin(this.walkPhase * 0.7) * SWIM_SWAY
    this.neck.rotation.set(0, 0, 0)
    this.leftWing.rotation.z = 0
    this.rightWing.rotation.z = 0
  }

  /** Routed geese panic into the air: a fast shallow arc away from the Queen,
   *  with frantic wingbeats and a little unstable banking. */
  private flyPose(delta: number): void {
    const pos = this.group.position
    this.idleAction = 'none'
    this.walkPhase += delta * FLEE_FLAP_SPEED

    const traveled = Math.hypot(pos.x - this.fleeStartX, pos.z - this.fleeStartZ)
    const progress = Math.min(1, traveled / this.fleeDistance)
    pos.y = Math.sin(progress * Math.PI) * FLEE_ALTITUDE
    this.group.rotation.z = Math.sin(this.walkPhase * 0.45) * FLEE_BANK
    this.neck.rotation.set(FLEE_NECK_LIFT, 0, 0)

    const flap = FLEE_WING_REST + Math.sin(this.walkPhase) * FLEE_WING_FLAP
    this.leftWing.rotation.z = -flap
    this.rightWing.rotation.z = flap
  }

  /** Stand around, occasionally flapping, looking about, or pecking the ground. */
  private updateIdle(delta: number): void {
    if (this.idleAction === 'none') {
      // Neutral, settled pose.
      this.neck.rotation.set(0, 0, 0)
      this.leftWing.rotation.z = 0
      this.rightWing.rotation.z = 0
      this.nextIdle -= delta
      if (this.nextIdle <= 0) {
        const r = Math.random()
        this.idleAction = r < 0.4 ? 'look' : r < 0.75 ? 'peck' : 'flap'
        this.idleTime = 0
        this.nextIdle = randRange(IDLE_GAP_MIN, IDLE_GAP_MAX)
      }
      return
    }

    this.idleTime += delta
    if (this.idleAction === 'flap') this.animFlap()
    else if (this.idleAction === 'look') this.animLook()
    else this.animPeck()
  }

  /** A few quick wing flaps that taper off. */
  private animFlap(): void {
    const DUR = 0.9
    if (this.idleTime > DUR) {
      this.idleAction = 'none'
      return
    }
    const taper = Math.min(1, (DUR - this.idleTime) / 0.3) // fade out at the end
    const spread = (0.25 + 0.85 * (0.5 + 0.5 * Math.sin(this.idleTime * 22))) * taper
    this.leftWing.rotation.z = -spread
    this.rightWing.rotation.z = spread
    this.neck.rotation.set(-0.1, 0, 0) // head up a touch while flapping
  }

  /** Turn the head one way then the other, settling back to centre. */
  private animLook(): void {
    const DUR = 2.2
    if (this.idleTime > DUR) {
      this.idleAction = 'none'
      return
    }
    const envelope = Math.sin((this.idleTime / DUR) * Math.PI) // 0 -> 1 -> 0
    this.neck.rotation.set(0, Math.sin(this.idleTime * 2.4) * 0.7 * envelope, 0)
  }

  /** Dip the head to the ground a couple of times. */
  private animPeck(): void {
    const DUR = 1.4
    if (this.idleTime > DUR) {
      this.idleAction = 'none'
      return
    }
    const dip = Math.max(0, Math.sin(this.idleTime * 5)) // 0 -> down -> up, twice
    this.neck.rotation.set(dip, 0, 0)
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

    if (Math.random() < POSTURE_HONK_RATE * delta) this.honk(this.honkPitch, 'urgent')
    this.updateBill(delta)

    // Puff up + face her. Hold at the waterline if it's squaring up while afloat,
    // then layer in a silly wing-pumping challenge dance.
    this.puff += (PUFF_SCALE - this.puff) * easeFactor(PUFF_EASE, delta)
    this.group.scale.setScalar(this.baseScale * this.puff)
    this.walkPhase += delta * POSTURE_FLAP_SPEED
    const beat = Math.max(0, Math.sin(this.walkPhase))
    const honkBoost = this.billTimer > 0 ? this.billTimer / this.billDuration : 0
    const bob = Math.abs(Math.sin(this.walkPhase)) * POSTURE_BOB + honkBoost * 0.04
    pos.y = this.pond.isWater(pos.x, pos.z) ? SWIM_FLOAT_Y + bob * 0.45 : bob
    this.group.rotation.y = this.heading
    this.group.rotation.z = Math.sin(this.walkPhase * 0.55) * POSTURE_SWAY
    this.neck.rotation.set(
      POSTURE_HEAD_LIFT + POSTURE_HEAD_BOB * beat - honkBoost * 0.12,
      Math.sin(this.walkPhase * 0.75) * 0.18,
      0,
    )

    const wingSpread = POSTURE_WING_REST + POSTURE_WING_FLAP * beat + honkBoost * 0.16
    this.leftWing.rotation.z = -wingSpread
    this.rightWing.rotation.z = wingSpread
  }

  /** Run away from the Queen; once it reaches its escape point, calm down. */
  private flee(delta: number): void {
    // arriveRadius 0 = a flat-out bolt, no easing down as it nears the escape point.
    const s = seekArrive(this.group.position, this.targetX, this.targetZ, FLEE_SPEED, 0, ARRIVE_STOP)
    if (s.arrived) {
      this.velX = 0
      this.velZ = 0
      this.group.position.y = this.pond.isWater(this.group.position.x, this.group.position.z) ? SWIM_FLOAT_Y : 0
      this.group.rotation.z = 0
      this.state = 'pausing'
      this.timer = randRange(PAUSE_MIN, PAUSE_MAX)
      return
    }
    this.ease(s.vx, s.vz, delta)
  }

  /** Spot the nearest plant in range and head for it (unless it's still cowed). */
  private tryForage(): boolean {
    if (this.cowed > 0) return false // too rattled to steal right now
    const pos = this.group.position
    const radius = this.isBold ? BOLD_FORAGE_RADIUS : FORAGE_RADIUS
    const plant = this.food.nearestUncollected(pos.x, pos.z, radius)
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
    const s = seekArrive(this.group.position, plant.x, plant.z, SPEED, ARRIVE_RADIUS, EAT_RADIUS)
    if (s.arrived) {
      this.food.steal(plant) // NOT collect() — this denies the Queen the food
      this.honk(this.honkPitch) // a smug honk
      this.targetFood = null
      this.state = 'pausing'
      this.timer = randRange(PAUSE_MIN, PAUSE_MAX)
      return
    }
    this.ease(s.vx, s.vz, delta)
  }

  /** Spot the nearest occupied nest (a brooding hen) in range and set out to raid
   *  it — unless it's still cowed from a lost honk-off. Returns whether it's now
   *  raiding. */
  private tryRaid(): boolean {
    if (this.cowed > 0) return false // too rattled to hunt right now
    const pos = this.group.position
    const radius = this.isBold ? BOLD_RAID_RADIUS : RAID_RADIUS
    const nest = this.nests.nearestOccupied(pos.x, pos.z, radius)
    if (!nest) return false
    this.targetNest = nest
    this.state = 'raiding'
    this.honk(this.honkPitch) // a menacing honk as it sets off
    return true
  }

  /** Stalk toward the brooding hen's nest. The hen panics and bolts when the goose
   *  closes in (Game handles that, freeing the nest); then the goose gloats and
   *  wanders off. If the hen's already gone, give up the chase. */
  private raid(delta: number): void {
    const nest = this.targetNest
    if (!nest || !nest.occupied) {
      this.targetNest = null // hen fled (we scared her, or someone did) — done here
      this.state = 'pausing'
      this.timer = randRange(PAUSE_MIN, PAUSE_MAX)
      return
    }
    const s = seekArrive(this.group.position, nest.x, nest.z, SPEED, ARRIVE_RADIUS, ARRIVE_STOP)
    this.ease(s.vx, s.vz, delta)
  }

  private seekTarget(delta: number): void {
    const s = seekArrive(this.group.position, this.targetX, this.targetZ, SPEED, ARRIVE_RADIUS, ARRIVE_STOP)
    if (s.arrived) {
      this.state = 'pausing'
      this.timer = randRange(PAUSE_MIN, PAUSE_MAX)
      return
    }
    this.ease(s.vx, s.vz, delta)
  }

  private ease(vx: number, vz: number, delta: number): void {
    const t = easeFactor(RESPONSIVENESS, delta)
    this.velX += (vx - this.velX) * t
    this.velZ += (vz - this.velZ) * t
  }

  private pickNewTarget(): void {
    const p = pointAround(this.homeX, this.homeZ, WANDER_RADIUS)
    this.targetX = p.x
    this.targetZ = p.z
    this.state = 'wandering'
  }

  private honk(pitch = this.honkPitch, priority: 'ambient' | 'normal' | 'urgent' = 'normal'): void {
    const pos = this.group.position
    const lp = this.listener.position
    const distance = Math.hypot(pos.x - lp.x, pos.z - lp.z)
    if (!this.sound.honk(pitch, { priority, distance })) return
    this.billDuration = GOOSE_BILL_TIME * Math.min(1.35, 1 / Math.max(0.75, pitch))
    this.billTimer = this.billDuration
  }

  private updateBill(delta: number): void {
    if (this.billTimer > 0) this.billTimer = Math.max(0, this.billTimer - delta)
    const progress = this.billTimer / this.billDuration
    const elapsed = 1 - progress
    const syllables = Math.max(1, Math.ceil(this.billDuration / GOOSE_BILL_SYLLABLE))
    const open = progress > 0 ? Math.abs(Math.sin(elapsed * syllables * Math.PI)) : 0
    setGooseBillOpen(this.upperBill, this.lowerBill, open)
  }
}
