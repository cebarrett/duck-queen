import * as THREE from 'three'
import { buildDuckModel, setBillOpen } from './duckModel'
import { type SubjectKind, SUBJECT_KINDS } from './subjectKinds'
import { approachAngle, randRange, seekArrive, pointAround, faceHeading, easeFactor } from './mathUtils'
import { type Collider, resolveWalls } from './collision'
import type { Pond } from './Water'
import type { DuckMode } from './DuckController'
import type { Food, FoodItem } from './Food'
import type { Nest } from './Nests'
import type { Sound } from './Sound'
import { type Rng, rngRange } from './rng'

// --- Idle wander tuning ----------------------------------------------------
const WANDER_SPEED = 1.5 // top amble speed (units/sec) — slow and unhurried
const RESPONSIVENESS = 4 // how fast velocity eases toward the target (heavy/ducky)
const WANDER_RADIUS = 5 // how far from "home" it picks its next spot
const ARRIVE_RADIUS = 1.5 // start slowing down once this close to the target
const ARRIVE_STOP = 0.3 // close enough — stop and pause
const PAUSE_MIN = 1.0 // shortest idle pause (seconds)
const PAUSE_MAX = 4.0 // longest idle pause

// --- Following tuning ------------------------------------------------------
const FOLLOW_SPEED = 6.6 // a touch faster than the Queen (6) so stragglers reel back in
const FOLLOW_RESPONSIVENESS = 7 // snappier than wandering so they keep up
const FOLLOW_RING = 2.2 // they settle this far from the Queen (not on top of her)
const FOLLOW_ARRIVE_BAND = 2.0 // slow down within this band above the ring
const SEP_RADIUS = 1.0 // push apart from flockmates closer than this
const SEP_STRENGTH = 4 // how hard the separation shove is

// --- Chaos tuning (the comedy of governing ducks) --------------------------
const DISTRACT_RATE = 0.018 // per second: rare chance a settled follower noses about
const DISTRACT_MIN = 0.8 // shortest distraction (seconds)
const DISTRACT_MAX = 1.8 // longest distraction
const DISTRACT_NEAR = 0.8 // nearest a distraction spot can be
const DISTRACT_FAR = 2.0 // farthest a distraction spot can be
const DISTRACT_MAX_QUEEN_DISTANCE = FOLLOW_RING + 1.2 // only while comfortably grouped
const DISTRACT_LEASH = FOLLOW_RING + FOLLOW_ARRIVE_BAND // never pick a spot far from the Queen
const LOST_DISTANCE = 18 // a subject stranded past this from the Queen gives up
const FLIGHT_HOLD_DISTANCE = 6 // if the Queen flies off, stop chasing and hold home sooner
const SCATTER_NEAR = 3 // shortest panic dash away from trouble
const SCATTER_FAR = 6 // farthest panic dash away from trouble
const SCATTER_MIN = 2.5 // shortest time before a scattered duck regroups
const SCATTER_MAX = 4.0 // longest time before a scattered duck regroups
const SCATTER_SPREAD = 1.1 // radians of random fan-out around "away from trouble"
const SCATTER_SPEED = 4.4 // quick skitter away from conflict, but not a full sprint

// --- Shared waddle ---------------------------------------------------------
const TURN_SPEED = 8 // how fast it rotates to face travel direction
const BOB_HEIGHT = 0.05 // little waddle hop
const ROLL = 0.18 // side-to-side waddle tilt (radians)

// --- Idle fidgets (daft stationary-duck business) --------------------------
const IDLE_SPEED = 0.4 // below this speed it's "standing", and free to fidget
const IDLE_GAP_MIN = 1.5 // shortest gap between fidgets (seconds)
const IDLE_GAP_MAX = 4.5 // longest gap

// --- Swimming (when over the pond) -----------------------------------------
const SWIM_BOB = 0.04 // gentle float bob — no waddle hop
const SWIM_SWAY = 0.05 // very slight side sway (much less than the waddle wiggle)

// --- Foraging --------------------------------------------------------------
const EAT_RADIUS = 1.0 // close enough to a plant to eat it
const FORAGE_RADIUS = 5 // how far a follower will notice a plant and go for it
const FORAGE_RATE = 0.7 // per second: chance to peel off for an in-range plant
const FORAGE_SPEED = 3 // eager amble toward a snack (quicker than idle wander)

// --- Worm tugging ----------------------------------------------------------
const WORM_RATE = 0.0018 // per second: rare enough that a flock only does it now and then
const WORM_DURATION = 4.3 // the whole little distraction, including a proud beat after the pop
const WORM_POP_TIME = 2.9 // when the worm comes free and credits food
const WORM_TUG_SPEED = 12 // quick determined little tugs
const WORM_HEAD_DIP = -0.95 // beak-down angle while pulling

// --- Holding home (when the Queen is away) ---------------------------------
const HOLD_SPEED = 2.2 // purposeful but not chase-the-Queen fast
const HOLD_RADIUS = 4.5 // how wide the local home milling circle is
const HOLD_RETARGET_MIN = 1.5 // shortest time before choosing a fresh home job
const HOLD_RETARGET_MAX = 3.5 // longest time before choosing a fresh home job
const HOLD_FORAGE_RADIUS = 4 // home ducks only work plants close to their post
const HOLD_FORAGE_RATE = 0.35 // per second: quieter than active following forage
const GUARD_OFFSET = 2.2 // adults stand just off the nest instead of on top of it
const HUDDLE_RADIUS = 7 // ducklings look this far for an adult to shelter near
const HUDDLE_OFFSET = 1.2 // ducklings settle close to the adult they trust

// --- Vocalising ------------------------------------------------------------
const VOICE_RATE = 0.1 // per second: chance to make its call ("now and then")
const SCATTER_VOICE_RATE = 0.65 // startled subjects complain much more often
const VOICE_BILL_TIME = { duckling: 0.2, drake: 0.3, hen: 0.42 } as const
const VOICE_BILL_SYLLABLE = 0.16

// --- Honk-off chorus posing -----------------------------------------------
const CHORUS_TURN_SPEED = 10
const CHORUS_FLAP_SPEED = 18
const CHORUS_WING_REST = 0.16
const CHORUS_WING_FLAP = 0.46
const CHORUS_HEAD_LIFT = 0.26
const CHORUS_BOB = 0.05
const CHORUS_ROLL = 0.1
const CHORUS_PUFF = 0.045

// --- Nesting (a hen broods on a nest) --------------------------------------
const SIT_RADIUS = 0.25 // how close to the nest centre counts as "settled on it"
const LAY_MIN = 8 // shortest gap between eggs while sitting (seconds)
const LAY_MAX = 16 // longest gap
const SIT_BOB = 0.02 // gentle breathing bob while settled (no waddle)

// --- Growing up ------------------------------------------------------------
const MATURE_AGE = 80 // seconds a duckling lives before it's ready to grow into an adult

// --- World collision -------------------------------------------------------
// Footprint vs. trees/rocks, tuned for the duckling and then scaled to a
// subject's actual size (a drake is bigger, so it shoulders obstacles wider).
const BASE_SCALE = 0.4 // the duckling scale the two constants below are tuned for
const COLLIDE_RADIUS = 0.3 // footprint at BASE_SCALE — small, it's little
const COLLIDE_HEIGHT = 0.7 // height at BASE_SCALE; canopies float well above (walk under)

// A subject is always in exactly one of these.
type SubjectState = 'pausing' | 'wandering' | 'following' | 'distracted' | 'foraging' | 'scattered' | 'holding' | 'nesting' | 'worming'

/** What a following subject needs to know about the world each frame: where the
 *  Queen is, who its flockmates are, and where the flock's current home is. */
export interface FlockContext {
  queenX: number
  queenZ: number
  queenMode: DuckMode
  homeX: number
  homeZ: number
  nests: readonly Nest[]
  flock: DuckSubject[]
  honkOffTarget: { x: number; z: number } | null
}

/**
 * One flock subject — a yellow duckling, or an adult drake / hen. They all behave
 * the same broad state machine, but kind nudges local jobs: adults can hold a
 * nest, while ducklings huddle near grown ducks. It wanders its home patch until
 * the Queen quacks nearby, then it `follow`s — seeking her with arrival (settling
 * in a ring around her) plus separation from its flockmates so the crowd spreads
 * out. If the Queen leaves it behind, it keeps its subjecthood and holds home
 * instead of becoming an aimless lost duck.
 */
export class DuckSubject {
  readonly group: THREE.Group

  // Not readonly: when a subject gets "lost", we reset its home to wherever it
  // ended up, so it wanders off from there.
  private homeX: number
  private homeZ: number

  private velX = 0
  private velZ = 0
  private heading = 0
  private bobPhase = 0
  private age = 0 // seconds alive — a duckling grows up once it's old enough (and fed)

  // Animatable model pivots (grabbed from the model in the ctor) for idle fidgets.
  private readonly leftWing: THREE.Group
  private readonly rightWing: THREE.Group
  private readonly head: THREE.Group
  private readonly upperBill: THREE.Group
  private readonly lowerBill: THREE.Group
  private readonly worm: THREE.Group
  private readonly wormScale: number
  // Idle fidget state: which daft thing it's doing, how long it's been at it, and
  // the countdown to the next one.
  private idleAction: 'none' | 'flap' | 'look' | 'peck' | 'skyGaze' | 'stretch' | 'preen' = 'none'
  private idleTime = 0
  private idleSide = 1 // −1 = preen left side, +1 = right; set on preen start
  private nextIdle = randRange(IDLE_GAP_MIN, IDLE_GAP_MAX)

  private state: SubjectState = 'pausing'
  private timer: number // counts down the current pause
  private distractTimer = 0 // counts down a distraction
  private targetX = 0
  private targetZ = 0
  private targetFood: FoodItem | null = null // the plant it's foraging toward
  private targetNest: Nest | null = null // the nest a hen is brooding on
  private holdTimer = 0 // counts down to choosing a new local home job
  private layTimer = 0 // counts down to the next egg while she's sitting
  private sitting = false // has she actually settled onto the nest yet?
  private wormTimer = 0
  private wormRewarded = false
  private wormReturnState: 'following' | 'holding' = 'following'

  // Set from its kind (see constructor): overall size, its voice, and a per-
  // individual pitch so the flock sounds like a crowd, not one cloned voice.
  private readonly scale: number
  private readonly voice: (sound: Sound, pitch: number, distance?: number) => number
  private readonly voicePitch: number
  private billTimer = 0
  private billDuration: number = VOICE_BILL_TIME.duckling
  private chorusTimer = 0
  private chorusDuration = 0.5
  private chorusPhase = Math.random() * Math.PI * 2
  // Collision footprint, scaled to this subject's size (bigger birds, wider).
  private readonly collideRadius: number
  private readonly collideHeight: number

  constructor(
    x: number,
    z: number,
    readonly kind: SubjectKind,
    private readonly pond: Pond,
    private readonly food: Food,
    private readonly sound: Sound,
    private readonly listener: THREE.Object3D,
    private readonly colliders: readonly Collider[],
    rng: Rng,
  ) {
    const def = SUBJECT_KINDS[kind]
    const model = buildDuckModel(def.model)
    this.group = model.group
    this.leftWing = model.leftWing
    this.rightWing = model.rightWing
    this.head = model.head
    this.upperBill = model.upperBill
    this.lowerBill = model.lowerBill
    this.worm = makeWorm()
    this.worm.visible = false
    this.group.add(this.worm)
    this.group.position.set(x, 0, z)
    this.homeX = x
    this.homeZ = z

    this.scale = def.model.scale ?? 1
    this.voice = def.voice
    this.billDuration = VOICE_BILL_TIME[kind]
    this.collideRadius = COLLIDE_RADIUS * (this.scale / BASE_SCALE)
    this.collideHeight = COLLIDE_HEIGHT * (this.scale / BASE_SCALE)
    this.wormScale = 1 / this.scale

    // Spawn-time values come from the seeded rng so the initial world is stable.
    this.voicePitch = rngRange(rng, def.pitch[0], def.pitch[1])
    this.heading = rng() * Math.PI * 2
    this.group.rotation.y = this.heading
    this.timer = randRange(0, PAUSE_MAX) // first-move timing — fine to stay unseeded
  }

  /** Is it one of the Queen's — following, off foraging, briefly distracted, or
   *  scattered? (These all still count as subjects; it'll return.) */
  get isSubject(): boolean {
    return this.state === 'following' || this.state === 'distracted' || this.state === 'foraging' || this.state === 'scattered' || this.state === 'holding' || this.state === 'worming'
  }

  /** Holding ducks still belong to the Queendom, but they're tending home rather
   *  than lending their voices to a honk-off at the Queen's side. */
  get isHoldingHome(): boolean {
    return this.state === 'holding'
  }

  /** Can this subject currently add its voice to the Queen's chorus? */
  get supportsChorus(): boolean {
    return this.isSubject && !this.isHoldingHome && !this.isScattered && this.state !== 'worming'
  }

  /** Is she currently brooding on a nest? She's still the Queen's, but off-duty —
   *  she doesn't count toward the rallying flock while she sits. */
  get isNesting(): boolean {
    return this.state === 'nesting'
  }

  /** Is she panic-skittering (e.g. split off by the Baron's honk)? Still hers, but
   *  not calmly lending her voice to a honk-off while she scatters. */
  get isScattered(): boolean {
    return this.state === 'scattered'
  }

  /** Is this a duckling that's lived long enough to grow into an adult? (Whether
   *  she can afford the food to do so is checked by the Flock/Game.) */
  get isReadyToMature(): boolean {
    return this.kind === 'duckling' && this.isSubject && this.age >= MATURE_AGE
  }

  /** Free this subject's GPU resources (geometry + materials) — call when it's
   *  removed from the world, e.g. when a duckling is replaced by its grown-up self. */
  dispose(): void {
    this.group.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const mat = mesh.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else if (mat) mat.dispose()
    })
  }

  /** Called when the Queen quacks a NEW subject in range: fall in behind her.
   *  A brooding hen ignores it — she's busy keeping her eggs warm. */
  recruit(): void {
    if (this.state === 'nesting' || this.state === 'worming') return
    this.state = 'following'
  }

  /** The Queen quacked her existing flock: snap back to following, dropping any
   *  foraging or distraction. A brooding hen keeps her post (only a goose moves her);
   *  a worm-fixated duck is simply too committed to listen. */
  rally(): void {
    if (this.state === 'nesting' || this.state === 'worming') return
    this.targetFood = null
    this.state = 'following'
  }

  /** Startle an existing subject away from a conflict point. Scattered subjects
   *  still belong to the Queen, but they won't forage until they regroup. */
  scatterFrom(x: number, z: number): void {
    if (!this.isSubject) return
    this.scatterTo(x, z)
  }

  /** Is this adult posted close enough to help protect this nest? */
  guardsNest(nest: Nest, radius: number): boolean {
    if (this.kind === 'duckling' || !this.isHoldingHome) return false
    const pos = this.group.position
    return Math.hypot(pos.x - nest.x, pos.z - nest.z) <= radius
  }

  /** Fling this subject into a brief panic-skitter away from (x, z). */
  private scatterTo(x: number, z: number): void {
    const pos = this.group.position
    const dx = pos.x - x
    const dz = pos.z - z
    const base = Math.hypot(dx, dz) > 0.001 ? Math.atan2(dz, dx) : Math.random() * Math.PI * 2
    const angle = base + randRange(-SCATTER_SPREAD, SCATTER_SPREAD)
    const r = randRange(SCATTER_NEAR, SCATTER_FAR)

    this.targetFood = null
    this.targetX = pos.x + Math.cos(angle) * r
    this.targetZ = pos.z + Math.sin(angle) * r
    this.distractTimer = randRange(SCATTER_MIN, SCATTER_MAX)
    this.state = 'scattered'
  }

  /** Send this hen to sit on `nest` and brood: she waddles over, settles, and lays
   *  an egg now and then until something (a goose) startles her off. */
  assignToNest(nest: Nest): void {
    this.targetFood = null
    this.targetNest = nest
    nest.occupy(this)
    this.sitting = false
    this.layTimer = randRange(LAY_MIN, LAY_MAX)
    this.state = 'nesting'
  }

  /** The nest she's brooding on (or walking to), or null. */
  get nest(): Nest | null {
    return this.targetNest
  }

  /** A goose got too close: bolt off the nest (freeing it) and skitter away from
   *  the goose, leaving the eggs behind undefended. */
  spookFromNest(gooseX: number, gooseZ: number): void {
    if (this.targetNest) this.targetNest.vacate()
    this.targetNest = null
    this.sitting = false
    this.scatterTo(gooseX, gooseZ)
  }

  /** The Queen rouses her off the nest: she stands, frees it, and falls back in
   *  behind the flock. Unlike a goose's scare she doesn't bolt — and the eggs are
   *  left in the bowl, so seating a hen here again resumes incubation. */
  leaveNest(): void {
    if (this.targetNest) this.targetNest.vacate()
    this.targetNest = null
    this.sitting = false
    this.state = 'following'
  }

  vocalize(pitchMultiplier = 1): void {
    const pos = this.group.position
    const lp = this.listener.position
    const distance = Math.hypot(pos.x - lp.x, pos.z - lp.z)
    const duration = this.voice(this.sound, this.voicePitch * pitchMultiplier, distance)
    if (duration <= 0) return
    this.billDuration = Math.max(VOICE_BILL_TIME[this.kind], duration)
    this.billTimer = this.billDuration
  }

  cheerHonkOff(vocal = false): void {
    if (!this.supportsChorus) return
    this.chorusDuration = randRange(0.5, 0.85)
    this.chorusTimer = this.chorusDuration
    this.chorusPhase += randRange(0.2, 0.9)
    if (vocal) this.vocalize(randRange(0.92, 1.12))
  }

  update(delta: number, ctx: FlockContext): void {
    this.age += delta

    // A little call now and then (in its own voice); startled subjects complain
    // more often while they scatter. A brooding hen sits quietly (she only clucks
    // when she lays — see brood()).
    const callRate = this.state === 'scattered' ? SCATTER_VOICE_RATE : VOICE_RATE
    if (this.state !== 'nesting' && this.state !== 'worming' && Math.random() < callRate * delta) this.vocalize()

    switch (this.state) {
      case 'following':
        if (this.checkLost(ctx)) break // stranded too far — gives up
        // Very occasionally, snacks are not ON the ground but suspiciously IN it.
        if (this.tryStartWorming(delta, 'following')) break
        // Notice a nearby plant and peel off to go gather it...
        if (Math.random() < FORAGE_RATE * delta && this.tryForage()) break
        // ...or, less usefully, get distracted and wander off for a bit.
        if (Math.random() < DISTRACT_RATE * delta && this.startDistraction(ctx)) break
        else this.followQueen(delta, ctx)
        break
      case 'foraging':
        if (this.checkLost(ctx)) break
        this.forage(delta)
        break
      case 'distracted':
        if (this.checkLost(ctx)) break
        this.beDistracted(delta)
        break
      case 'scattered':
        if (this.checkLost(ctx)) break
        this.beScattered(delta)
        break
      case 'holding':
        if (this.tryStartWorming(delta, 'holding')) break
        this.holdHome(delta, ctx)
        break
      case 'nesting':
        this.brood(delta) // walk to the nest, settle, lay eggs — no checkLost
        break
      case 'worming':
        this.pullWorm(delta)
        break
      case 'wandering':
        this.seekTarget(delta)
        break
      case 'pausing':
        this.ease(0, 0, delta) // glide to a stop while waiting
        this.timer -= delta
        if (this.timer <= 0) this.pickNewTarget()
        break
    }

    // --- Apply movement (shared by all states) -----------------------------
    const pos = this.group.position
    pos.x += this.velX * delta
    pos.z += this.velZ * delta

    // Push out of any tree/rock it walked into. stepUp 0 = it doesn't climb, so
    // every obstacle is a wall to waddle around. (Wrap velX/velZ in an {x, z} so
    // the shared resolver can cancel the into-wall velocity, then read it back.)
    const vel = { x: this.velX, z: this.velZ }
    resolveWalls(pos, vel, this.collideRadius, 0, this.collideHeight, 0, this.colliders)
    this.velX = vel.x
    this.velZ = vel.z

    // Eat any plant we've come within reach of while working near Queen or home.
    if (this.state === 'following' || this.state === 'holding') {
      const plant = this.food.nearestUncollected(pos.x, pos.z, EAT_RADIUS)
      if (plant) this.food.collect(plant)
    }

    // --- Face travel direction + a little waddle ---------------------------
    const speed = Math.hypot(this.velX, this.velZ)
    this.heading = faceHeading(this.heading, this.velX, this.velZ, TURN_SPEED, delta)
    if (this.state === 'worming') {
      this.applyWormPose(delta)
    } else if (this.state === 'nesting' && this.sitting) {
      // Settled on the nest: a calm breathing bob, no waddle hop or sway.
      this.resetFidget()
      this.bobPhase += delta * 1.5
      pos.y = Math.sin(this.bobPhase) * SIT_BOB
      this.group.rotation.z = 0
    } else if (this.pond.isWater(pos.x, pos.z)) {
      // Over the pond: float like the Queen — settle at the (scaled) waterline
      // with a slow, gentle bob and sway, and NO waddle hop / side-wiggle.
      this.resetFidget()
      this.bobPhase += delta * 3
      pos.y = this.pond.floatLine * this.scale + Math.sin(this.bobPhase) * SWIM_BOB
      this.group.rotation.z = Math.sin(this.bobPhase * 0.7) * SWIM_SWAY
    } else if (speed > IDLE_SPEED) {
      // On land, on the move: the little waddle hop + side-to-side tilt, scaled by
      // speed; head and wings stay neutral.
      this.resetFidget()
      const moveFactor = Math.min(speed / WANDER_SPEED, 1)
      this.bobPhase += delta * (6 + speed * 2)
      pos.y = Math.abs(Math.sin(this.bobPhase)) * BOB_HEIGHT * moveFactor
      this.group.rotation.z = Math.sin(this.bobPhase) * ROLL * moveFactor
    } else {
      // On land, standing still: do daft duck things (stretch, flap, peck, gaze...).
      pos.y = 0
      this.group.rotation.z = 0
      this.updateIdle(delta)
    }

    if (ctx.honkOffTarget && this.supportsChorus) {
      this.applyChorusPose(delta, ctx.honkOffTarget.x, ctx.honkOffTarget.z)
    } else {
      this.chorusTimer = Math.max(0, this.chorusTimer - delta)
      this.group.scale.setScalar(this.scale)
    }

    this.group.rotation.y = this.heading
    this.updateBill(delta)
  }

  /** Seek the Queen, settling into a ring around her, while pushing apart from
   *  flockmates so the group spreads into a crowd instead of one stack. */
  private followQueen(delta: number, ctx: FlockContext): void {
    const pos = this.group.position

    // Seek: head for the Queen, but arrive at FOLLOW_RING (not her exact spot),
    // slowing through the arrival band so they don't jostle into her.
    let vx = 0
    let vz = 0
    const dx = ctx.queenX - pos.x
    const dz = ctx.queenZ - pos.z
    const dist = Math.hypot(dx, dz)
    if (dist > FOLLOW_RING) {
      const over = dist - FOLLOW_RING
      const speed = over < FOLLOW_ARRIVE_BAND ? FOLLOW_SPEED * (over / FOLLOW_ARRIVE_BAND) : FOLLOW_SPEED
      vx = (dx / dist) * speed
      vz = (dz / dist) * speed
    }

    // Separation: sum a push away from each too-close flockmate (stronger the
    // closer they are). Classic boids rule — keeps the crowd from overlapping.
    for (const other of ctx.flock) {
      if (other === this) continue
      const ox = pos.x - other.group.position.x
      const oz = pos.z - other.group.position.z
      const d = Math.hypot(ox, oz)
      if (d > 0.0001 && d < SEP_RADIUS) {
        const push = (1 - d / SEP_RADIUS) * SEP_STRENGTH
        vx += (ox / d) * push
        vz += (oz / d) * push
      }
    }

    // Don't let separation overspeed it past its top follow speed.
    const mag = Math.hypot(vx, vz)
    if (mag > FOLLOW_SPEED) {
      vx = (vx / mag) * FOLLOW_SPEED
      vz = (vz / mag) * FOLLOW_SPEED
    }

    this.ease(vx, vz, delta, FOLLOW_RESPONSIVENESS)
  }

  /** If it's drifted too far from the Queen, it gives up and becomes a lost
   *  wanderer again (no longer a subject). Returns true if it just got lost. */
  private checkLost(ctx: FlockContext): boolean {
    const pos = this.group.position
    const distance = Math.hypot(ctx.queenX - pos.x, ctx.queenZ - pos.z)
    const holdDistance = ctx.queenMode === 'fly' ? FLIGHT_HOLD_DISTANCE : LOST_DISTANCE
    if (distance > holdDistance) {
      this.startHolding(ctx)
      return true
    }
    return false
  }

  /** The Queen has gone far enough away that chasing her would turn the flock into
   *  a leash. Keep the subject local: near nests, adults, and familiar water. */
  private startHolding(ctx: FlockContext): void {
    this.targetFood = null
    this.state = 'holding'
    this.holdTimer = 0
    this.pickHoldTarget(ctx)
  }

  /** Hold the remembered home area: adults tend nests, ducklings huddle, and
   *  everyone does short-range useful foraging instead of drifting away. */
  private holdHome(delta: number, ctx: FlockContext): void {
    this.holdTimer -= delta
    if (Math.random() < HOLD_FORAGE_RATE * delta && this.tryForage(HOLD_FORAGE_RADIUS, true)) return
    if (this.holdTimer <= 0) this.pickHoldTarget(ctx)

    const s = seekArrive(this.group.position, this.targetX, this.targetZ, HOLD_SPEED, ARRIVE_RADIUS, ARRIVE_STOP)
    if (s.arrived) this.holdTimer = Math.min(this.holdTimer, 0.5)
    this.ease(s.vx, s.vz, delta)
  }

  /** Choose the next local job target. This stays intentionally simple: adults
   *  orbit nests as guards, ducklings huddle near adults, everyone else mills home. */
  private pickHoldTarget(ctx: FlockContext): void {
    if (this.kind === 'duckling') {
      const adult = this.nearestHoldingAdult(ctx)
      if (adult) {
        const p = pointAround(adult.group.position.x, adult.group.position.z, HUDDLE_OFFSET)
        this.targetX = p.x
        this.targetZ = p.z
        this.holdTimer = randRange(HOLD_RETARGET_MIN, HOLD_RETARGET_MAX)
        return
      }
    }

    const nest = this.nearestNest(ctx)
    if (this.kind !== 'duckling' && nest) {
      const p = pointAround(nest.x, nest.z, GUARD_OFFSET)
      this.targetX = p.x
      this.targetZ = p.z
      this.holdTimer = randRange(HOLD_RETARGET_MIN, HOLD_RETARGET_MAX)
      return
    }

    const p = pointAround(ctx.homeX, ctx.homeZ, HOLD_RADIUS)
    this.targetX = p.x
    this.targetZ = p.z
    this.holdTimer = randRange(HOLD_RETARGET_MIN, HOLD_RETARGET_MAX)
  }

  private nearestHoldingAdult(ctx: FlockContext): DuckSubject | null {
    const pos = this.group.position
    let best: DuckSubject | null = null
    let bestSq = HUDDLE_RADIUS * HUDDLE_RADIUS
    for (const other of ctx.flock) {
      if (other === this || other.kind === 'duckling' || !other.isSubject || other.isNesting) continue
      const dSq = (other.group.position.x - pos.x) ** 2 + (other.group.position.z - pos.z) ** 2
      if (dSq < bestSq) {
        bestSq = dSq
        best = other
      }
    }
    return best
  }

  private nearestNest(ctx: FlockContext): Nest | null {
    const pos = this.group.position
    let best: Nest | null = null
    let bestSq = Infinity
    for (const nest of ctx.nests) {
      const occupiedBias = nest.occupied ? -4 : 0 // occupied nests pull adults first
      const dSq = (nest.x - pos.x) ** 2 + (nest.z - pos.z) ** 2 + occupiedBias
      if (dSq < bestSq) {
        bestSq = dSq
        best = nest
      }
    }
    return best
  }

  /** Pick a nearby spot to be nosy about, and a short timer; then amble there.
   *  Followers only do this when already bunched with the Queen, and the target is
   *  kept inside her follow leash so a cute detour doesn't become a lost duck. */
  private startDistraction(ctx: FlockContext): boolean {
    const pos = this.group.position
    if (Math.hypot(ctx.queenX - pos.x, ctx.queenZ - pos.z) > DISTRACT_MAX_QUEEN_DISTANCE) return false

    const angle = Math.random() * Math.PI * 2
    const r = randRange(DISTRACT_NEAR, DISTRACT_FAR)
    let x = pos.x + Math.cos(angle) * r
    let z = pos.z + Math.sin(angle) * r

    const qdx = x - ctx.queenX
    const qdz = z - ctx.queenZ
    const qDist = Math.hypot(qdx, qdz)
    if (qDist > DISTRACT_LEASH) {
      x = ctx.queenX + (qdx / qDist) * DISTRACT_LEASH
      z = ctx.queenZ + (qdz / qDist) * DISTRACT_LEASH
    }

    this.targetX = x
    this.targetZ = z
    this.distractTimer = randRange(DISTRACT_MIN, DISTRACT_MAX)
    this.state = 'distracted'
    return true
  }

  /** Amble to the distraction spot; once it arrives or the timer runs out,
   *  curiosity is satisfied and it rejoins the Queen. */
  private beDistracted(delta: number): void {
    this.distractTimer -= delta
    const s = seekArrive(this.group.position, this.targetX, this.targetZ, WANDER_SPEED, ARRIVE_RADIUS, ARRIVE_STOP)
    if (this.distractTimer <= 0 || s.arrived) {
      this.state = 'following' // back to its duties
      return
    }
    this.ease(s.vx, s.vz, delta)
  }

  /** Skitter to the scatter target; after the panic timer, return to following. */
  private beScattered(delta: number): void {
    this.distractTimer -= delta
    const s = seekArrive(this.group.position, this.targetX, this.targetZ, SCATTER_SPEED, ARRIVE_RADIUS, ARRIVE_STOP)
    if (this.distractTimer <= 0) {
      this.state = 'following'
      return
    }
    this.ease(s.vx, s.vz, delta, FOLLOW_RESPONSIVENESS)
  }

  /** Walk to the assigned nest, settle onto it, and lay an egg every so often. */
  private brood(delta: number): void {
    const nest = this.targetNest
    if (!nest) {
      this.state = 'following' // nest somehow gone — rejoin the flock
      return
    }
    const s = seekArrive(this.group.position, nest.x, nest.z, FORAGE_SPEED, ARRIVE_RADIUS, SIT_RADIUS)
    if (!s.arrived) {
      this.sitting = false // still waddling over
      this.ease(s.vx, s.vz, delta)
      return
    }
    // Settled: hold still and lay on a timer.
    this.sitting = true
    this.ease(0, 0, delta)
    this.layTimer -= delta
    if (this.layTimer <= 0) {
      nest.layEgg()
      this.vocalize() // a little cluck as the egg appears
      this.layTimer = randRange(LAY_MIN, LAY_MAX)
    }
  }

  /** Look for a plant within FORAGE_RADIUS; if there's one, target it and switch
   *  to foraging. Returns whether it's now off to forage. */
  private tryForage(radius = FORAGE_RADIUS, holdAfter = false): boolean {
    const pos = this.group.position
    const plant = this.food.nearestUncollected(pos.x, pos.z, radius)
    if (!plant) return false
    this.targetFood = plant
    this.state = holdAfter ? 'holding' : 'foraging'
    if (holdAfter) {
      this.targetX = plant.x
      this.targetZ = plant.z
      this.holdTimer = HOLD_RETARGET_MAX
    }
    return true
  }

  /** Head to the targeted plant and eat it, then rejoin the flock. If the plant
   *  vanished (another duck ate it), just go back to following. */
  private forage(delta: number): void {
    const plant = this.targetFood
    if (!plant || plant.collected) {
      this.targetFood = null
      this.state = 'following'
      return
    }
    const s = seekArrive(this.group.position, plant.x, plant.z, FORAGE_SPEED, ARRIVE_RADIUS, EAT_RADIUS)
    if (s.arrived) {
      this.food.collect(plant) // nom
      this.targetFood = null
      this.state = 'following'
      return
    }
    this.ease(s.vx, s.vz, delta)
  }

  /** A rare subject-only distraction: stop dead, tug an earthworm out, and earn
   *  one food. While doing this it ignores the Queen's rally quack. */
  private tryStartWorming(delta: number, returnState: 'following' | 'holding'): boolean {
    const pos = this.group.position
    if (this.pond.isWater(pos.x, pos.z)) return false
    if (Math.random() >= WORM_RATE * delta) return false

    this.targetFood = null
    this.wormTimer = 0
    this.wormRewarded = false
    this.wormReturnState = returnState
    this.worm.visible = true
    this.state = 'worming'
    return true
  }

  private pullWorm(delta: number): void {
    this.ease(0, 0, delta, FOLLOW_RESPONSIVENESS)
    this.wormTimer += delta

    if (!this.wormRewarded && this.wormTimer >= WORM_POP_TIME) {
      this.wormRewarded = true
      this.food.gain()
      this.vocalize(1.08)
    }

    if (this.wormTimer >= WORM_DURATION) {
      this.worm.visible = false
      this.wormTimer = 0
      this.state = this.wormReturnState
      if (this.state === 'holding') this.holdTimer = 0
    }
  }

  private applyWormPose(delta: number): void {
    const progress = Math.min(1, this.wormTimer / WORM_POP_TIME)
    const popped = this.wormRewarded
    const tug = Math.max(0, Math.sin(this.wormTimer * WORM_TUG_SPEED))
    const proud = popped ? Math.min(1, (this.wormTimer - WORM_POP_TIME) / (WORM_DURATION - WORM_POP_TIME)) : 0

    this.idleAction = 'none'
    this.bobPhase += delta * 5
    this.group.position.y = popped ? Math.sin(this.bobPhase) * 0.03 : tug * 0.025
    this.group.rotation.z = popped ? Math.sin(this.bobPhase * 0.7) * 0.05 : Math.sin(this.wormTimer * WORM_TUG_SPEED) * 0.08
    this.head.rotation.set(WORM_HEAD_DIP * (1 - proud) + 0.35 * proud, Math.sin(this.wormTimer * 8) * 0.1 * (1 - proud), 0)
    this.leftWing.rotation.z = -0.18 - tug * 0.1
    this.rightWing.rotation.z = 0.18 + tug * 0.1

    this.worm.visible = true
    this.worm.position.set(0, popped ? 0.34 + proud * 0.12 : 0.03 + progress * 0.22 + tug * 0.06, -1.08)
    this.worm.scale.set(this.wormScale, (popped ? 1 : 0.3 + progress * 0.9) * this.wormScale, this.wormScale)
    this.worm.rotation.set(0, 0, Math.sin(this.wormTimer * (popped ? 10 : 18)) * (popped ? 0.28 : 0.12))
  }

  /** Seek the current wander target, slowing on arrival, then pause. */
  private seekTarget(delta: number): void {
    const s = seekArrive(this.group.position, this.targetX, this.targetZ, WANDER_SPEED, ARRIVE_RADIUS, ARRIVE_STOP)
    if (s.arrived) {
      this.state = 'pausing'
      this.timer = randRange(PAUSE_MIN, PAUSE_MAX)
      return
    }
    this.ease(s.vx, s.vz, delta)
  }

  /** Ease the velocity toward a target (vx, vz) — frame-rate-independent. */
  private ease(vx: number, vz: number, delta: number, rate = RESPONSIVENESS): void {
    const t = easeFactor(rate, delta)
    this.velX += (vx - this.velX) * t
    this.velZ += (vz - this.velZ) * t
  }

  private updateBill(delta: number): void {
    if (this.billTimer > 0) this.billTimer = Math.max(0, this.billTimer - delta)
    const progress = this.billTimer / this.billDuration
    const syllables = Math.max(1, Math.ceil(this.billDuration / VOICE_BILL_SYLLABLE))
    const pulse = Math.abs(Math.sin(progress * syllables * Math.PI))
    setBillOpen(this.upperBill, this.lowerBill, progress > 0 ? pulse : 0)
  }

  private applyChorusPose(delta: number, aimX: number, aimZ: number): void {
    this.chorusTimer = Math.max(0, this.chorusTimer - delta)
    this.chorusPhase += delta * CHORUS_FLAP_SPEED

    const pos = this.group.position
    const dx = aimX - pos.x
    const dz = aimZ - pos.z
    if (Math.hypot(dx, dz) > 0.01) {
      const target = Math.atan2(-dx, -dz) // duck model faces -Z at heading 0
      this.heading = approachAngle(this.heading, target, CHORUS_TURN_SPEED * delta)
    }

    const burst = this.chorusTimer > 0 ? this.chorusTimer / this.chorusDuration : 0
    const intensity = 0.35 + burst * 0.65
    const beat = Math.max(0, Math.sin(this.chorusPhase))
    pos.y += Math.abs(Math.sin(this.chorusPhase)) * CHORUS_BOB * intensity
    this.group.rotation.z += Math.sin(this.chorusPhase * 0.55) * CHORUS_ROLL * intensity
    this.group.scale.setScalar(this.scale * (1 + CHORUS_PUFF * intensity * (0.4 + beat)))

    this.head.rotation.set(
      CHORUS_HEAD_LIFT + beat * 0.08,
      Math.sin(this.chorusPhase * 0.45) * 0.16 * intensity,
      0,
    )

    const wingSpread = CHORUS_WING_REST + CHORUS_WING_FLAP * beat * intensity
    this.leftWing.rotation.z = -wingSpread
    this.rightWing.rotation.z = wingSpread
  }

  private pickNewTarget(): void {
    const p = pointAround(this.homeX, this.homeZ, WANDER_RADIUS)
    this.targetX = p.x
    this.targetZ = p.z
    this.state = 'wandering'
  }

  // --- Idle fidgets ----------------------------------------------------------

  /** Drop any fidget and return the head + wings to neutral (used the moment it
   *  starts moving, swims, or sits on a nest). */
  private resetFidget(): void {
    this.idleAction = 'none'
    this.head.rotation.set(0, 0, 0)
    this.leftWing.rotation.z = 0
    this.rightWing.rotation.z = 0
    this.worm.visible = false
  }

  /** Standing around being a daft duck: now and then pick a fidget — stretch, flap,
   *  peck the ground, gaze at the sky, or look about — play it out, then wait. */
  private updateIdle(delta: number): void {
    if (this.idleAction === 'none') {
      this.head.rotation.set(0, 0, 0) // neutral while waiting
      this.leftWing.rotation.z = 0
      this.rightWing.rotation.z = 0
      this.nextIdle -= delta
      if (this.nextIdle <= 0) {
        const r = Math.random()
        this.idleAction =
          r < 0.25 ? 'peck' : r < 0.44 ? 'look' : r < 0.61 ? 'flap' : r < 0.74 ? 'skyGaze' : r < 0.88 ? 'preen' : 'stretch'
        if (this.idleAction === 'preen') this.idleSide = Math.random() < 0.5 ? -1 : 1
        this.idleTime = 0
        this.nextIdle = randRange(IDLE_GAP_MIN, IDLE_GAP_MAX)
      }
      return
    }

    this.idleTime += delta
    switch (this.idleAction) {
      case 'flap':
        this.animFlap()
        break
      case 'look':
        this.animLook()
        break
      case 'peck':
        this.animPeck()
        break
      case 'skyGaze':
        this.animSkyGaze()
        break
      case 'stretch':
        this.animStretch()
        break
      case 'preen':
        this.animPreen()
        break
    }
  }

  /** A flurry of quick wing flaps that taper off, chin lifted a touch. */
  private animFlap(): void {
    const DUR = 0.9
    if (this.idleTime > DUR) return void (this.idleAction = 'none')
    const taper = Math.min(1, (DUR - this.idleTime) / 0.3)
    const spread = (0.3 + 0.8 * (0.5 + 0.5 * Math.sin(this.idleTime * 24))) * taper
    this.leftWing.rotation.z = -spread
    this.rightWing.rotation.z = spread
    this.head.rotation.set(0.12, 0, 0)
  }

  /** Glance one way then the other — the classic "did I hear something?" look. */
  private animLook(): void {
    const DUR = 2.0
    if (this.idleTime > DUR) return void (this.idleAction = 'none')
    const envelope = Math.sin((this.idleTime / DUR) * Math.PI) // 0 -> 1 -> 0
    this.head.rotation.set(0, Math.sin(this.idleTime * 2.6) * 0.8 * envelope, 0)
  }

  /** Dip the head to the ground a couple of times — poking at nothing in particular. */
  private animPeck(): void {
    const DUR = 1.4
    if (this.idleTime > DUR) return void (this.idleAction = 'none')
    const dip = Math.max(0, Math.sin(this.idleTime * 5)) // 0 -> down -> up, twice
    this.head.rotation.set(-dip * 0.85, 0, 0) // tip the beak toward the ground
  }

  /** Crane the head up to stare at the sky, with a slow idle turn. */
  private animSkyGaze(): void {
    const DUR = 2.4
    if (this.idleTime > DUR) return void (this.idleAction = 'none')
    const envelope = Math.sin((this.idleTime / DUR) * Math.PI)
    this.head.rotation.set(0.75 * envelope, Math.sin(this.idleTime * 1.4) * 0.25 * envelope, 0)
  }

  /** Crane the head back to one side, nibbling at the back feathers, with a slight
   *  wing fluff on that side — the classic duck preening session. */
  private animPreen(): void {
    const DUR = 3.5
    if (this.idleTime > DUR) return void (this.idleAction = 'none')
    const envelope = Math.sin((this.idleTime / DUR) * Math.PI) // ease in and back out
    const turn = this.idleSide * 1.35 * envelope // head cranked around to the body
    const dip = -0.3 * envelope // beak tips down toward the feathers
    const nibble = Math.sin(this.idleTime * 15) * 0.1 * envelope // quick nibbling
    this.head.rotation.set(dip + nibble, turn, 0)
    // Lift the wing on the side being preened a little to give access.
    const fluff = 0.22 * envelope
    this.leftWing.rotation.z = this.idleSide < 0 ? -fluff : 0
    this.rightWing.rotation.z = this.idleSide > 0 ? fluff : 0
  }

  /** A big stretch: neck craned up while both wings spread wide, then settle. */
  private animStretch(): void {
    const DUR = 1.7
    if (this.idleTime > DUR) return void (this.idleAction = 'none')
    const envelope = Math.sin((this.idleTime / DUR) * Math.PI) // ease up and back down
    this.head.rotation.set(0.5 * envelope, 0, 0)
    const spread = 1.1 * envelope
    this.leftWing.rotation.z = -spread
    this.rightWing.rotation.z = spread
  }
}

function makeWorm(): THREE.Group {
  const g = new THREE.Group()
  g.name = 'earthworm-distraction'
  const wormMat = new THREE.MeshStandardMaterial({ color: 0xd46f78 })
  const wormDark = new THREE.MeshStandardMaterial({ color: 0xa94b55 })
  const dirtMat = new THREE.MeshStandardMaterial({ color: 0x7a5230 })

  const dirt = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.07, 0.36), dirtMat)
  dirt.position.set(0, -0.03, 0)
  dirt.castShadow = true
  dirt.receiveShadow = true
  g.add(dirt)

  for (let i = 0; i < 5; i++) {
    const segment = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.18, 0.14), i === 4 ? wormDark : wormMat)
    segment.name = 'earthworm-segment'
    segment.position.set(Math.sin(i * 0.85) * 0.05, 0.07 + i * 0.12, -0.02)
    segment.rotation.z = (i - 1.5) * 0.12
    segment.castShadow = true
    g.add(segment)
  }

  return g
}
