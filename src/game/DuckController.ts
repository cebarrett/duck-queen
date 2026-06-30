import * as THREE from 'three'
import type { Input } from './Input'
import type { CameraController } from './ThirdPersonCamera'
import type { Duck } from './Duck'
import { type Collider, resolveWalls, floorHeightAt } from './collision'
import type { Pond } from './Water'
import type { Terrain } from './terrain'
import type { Reeds } from './Reeds'
import type { Food } from './Food'
import { faceHeading } from './mathUtils'

// The ways the Queen gets around. Exported so the HUD can label it.
export type DuckMode = 'waddle' | 'fly' | 'swim'

// --- Waddle (ground) tuning ------------------------------------------------
const MAX_SPEED = 6 // top waddle speed (units/second)
const RESPONSIVENESS = 6 // how fast velocity chases the target; lower = heavier
const WADDLE_BOB = 0.08 // how high she hops while waddling (units)
const WADDLE_ROLL = 0.15 // how far she tilts side-to-side (radians)
const LAND_SPEED = 10 // how quickly she settles onto her floor on the ground — brisk
//                      enough to hug rolling terrain as she walks up and down it,
//                      while still smoothing the small pop of stepping onto a rock

// --- Fly tuning: heavier (more glide/inertia) but still settles ------------
const FLY_SPEED = 8.2 // top horizontal fly speed
const FLY_RISE_SPEED = 5 // upward speed while holding Space
const FLY_FALL_SPEED = 3 // gentle downward drift when Space is released
const FLY_RESPONSIVENESS = 3 // lower than waddle => more inertia, less floaty-twitchy
const FLY_LEAN = 0.25 // how far she pitches nose-down while cruising (radians)
const MAX_ALTITUDE = 60 // ceiling so she can't fly off into the fog forever

// --- Swim tuning: slow and buoyant -----------------------------------------
const SWIM_SPEED = 3.5 // top paddling speed (slower than waddling)
const SWIM_RESPONSIVENESS = 2.5 // very glidey — she drifts on the water
const SWIM_BOB = 0.05 // gentle vertical bob, always going (water never holds still)
const SWIM_ROLL = 0.06 // slight side-to-side sway

// --- Water splash (takeoff / landing) --------------------------------------
const TAKEOFF_POP = 4 // upward kick when launching off the water (a crisp exit)
const SPLASH_MIN_SPEED = 0.8 // ignore gentle settling; only splash on a real impact
const TAKEOFF_SPLASH = 2 // splash strength when launching off the water

// --- Wing flap (fly only) --------------------------------------------------
const FLAP_SPEED = 18 // how fast the phase advances (radians/sec)
const FLAP_AMPLITUDE = 0.5 // half the up/down swing (radians)
const FLAP_REST = 0.9 // wings sit spread out this far while flying (radians)
const FLAP_EASE = 10 // how fast flapping ramps up/down as Space is held/released
const WING_SETTLE = 8 // how fast wings fold back to vertical on the ground

// --- Honk-off / command flourish ------------------------------------------
const QUACK_FLOURISH_MIN = 0.34 // even a short quack gets a readable wing flick
const CHALLENGE_FLAP_SPEED = 20
const CHALLENGE_WING_REST = 0.28
const CHALLENGE_WING_FLAP = 0.42
const CHALLENGE_BOB = 0.055
const CHALLENGE_ROLL = 0.08
const CHALLENGE_PITCH = 0.1

// --- Panic flee -------------------------------------------------------------
const PANIC_DURATION = 2.6 // seconds the Queen keeps fleeing after being startled
const PANIC_SPEED = 8.5 // base flee speed
const PANIC_STEER_INFLUENCE = 0.35 // how much WASD can bend the flee direction
const PANIC_RESPONSIVENESS = 9 // how sharply she chases the panic target velocity
const PANIC_WADDLE_BOB = 0.11 // bigger, faster embarrassed scramble
const PANIC_WADDLE_ROLL = 0.22
const PANIC_FLUTTER_SPEED = 24
const PANIC_FLUTTER_REST = 0.35
const PANIC_FLUTTER_AMPLITUDE = 0.35
const PANIC_CROWN_EASE = 8

// --- Shared ----------------------------------------------------------------
const TURN_SPEED = 10 // how fast she rotates to face travel direction
const DUCK_RADIUS = 0.5 // her footprint for collision (a circle on the ground)
const DUCK_HEIGHT = 1.7 // how tall she is, for "can I fly over this?" checks
const STEP_UP = 0.6 // surfaces within this height of her feet are floors she can
//                     stand on / step up onto; taller ones act as solid walls
const GROUND_EPS = 0.05 // how far above her floor counts as "in the air"
const REED_REACH = 1.3 // how close the Queen must be to gather a reed
const FOOD_REACH = 1.0 // how close the Queen must be to gather food

/**
 * DuckController moves the Queen in one of three modes, chosen by her situation:
 *   - waddle: on the ground; hops + tilts as she walks.
 *   - fly:    above her floor or pressing Space; free in 3D, leans into the glide.
 *   - swim:   over the pond at rest; floats at the waterline, paddles slowly.
 *
 * All three share the same "ease toward a target velocity" core (see Step 4):
 * a slow ease gives heavy, weighty motion instead of instant stop/start.
 */
export class DuckController {
  // Velocity in world units/second. In waddle we only use x/z; in fly, y too.
  private readonly velocity = new THREE.Vector3()
  private heading = 0 // facing angle (radians) = group.rotation.y
  private waddlePhase = 0 // ever-increasing; drives the bob/roll sine waves

  // Altitude is kept SEPARATE from the waddle bob so toggling modes mid-air
  // makes her float down smoothly instead of teleporting to the ground.
  private altitude = 0
  // The height of the surface directly under her right now (0 = ground, or the
  // top of a rock/tree she's standing on). Recomputed every frame after she
  // moves. This is her "floor".
  private groundHeight = 0
  private overWater = false // is she currently over the pond?
  private flapPhase = 0 // drives the wing flap sine wave while flying
  private flapIntensity = 0 // 0 = gliding (still wings), 1 = flapping hard
  private quackFlourishTimer = 0
  private quackFlourishDuration = QUACK_FLOURISH_MIN
  private honkOffActive = false

  private mode: DuckMode = 'waddle'
  private prevMode: DuckMode = 'waddle' // last frame's mode, for spotting transitions
  private pendingSplash = 0 // >0 = she just landed in water this hard; fire a splash
  private panicTimer = 0
  private panicFromX = 0
  private panicFromZ = 0

  constructor(
    private readonly duck: Duck,
    private readonly input: Input,
    private readonly camera: CameraController,
    private readonly colliders: Collider[],
    private readonly pond: Pond,
    // The rolling terrain — her floor when she's not on a rock or the water.
    private readonly terrain: Terrain,
    // Reeds only the Queen can gather (the ducklings never touch these).
    private readonly reeds: Reeds,
    // Food can be gathered by either the Queen or her subjects.
    private readonly food: Food,
    // Called when she breaks the water surface (x, z, strength) so Game can play
    // the splash sound + ripple. The controller decides WHEN; Game decides WHAT.
    private readonly onSplash: (x: number, z: number, strength: number) => void,
  ) {}

  getMode(): DuckMode {
    return this.mode
  }

  startPanicFlee(fromX: number, fromZ: number): void {
    this.panicTimer = PANIC_DURATION
    this.panicFromX = fromX
    this.panicFromZ = fromZ
  }

  quackFlourish(duration: number): void {
    this.quackFlourishDuration = Math.max(QUACK_FLOURISH_MIN, duration)
    this.quackFlourishTimer = this.quackFlourishDuration
  }

  setHonkOffActive(active: boolean): void {
    this.honkOffActive = active
  }

  isPanicking(): boolean {
    return this.panicTimer > 0
  }

  update(delta: number): void {
    this.updateMode()

    // She "takes off" the instant she leaves the water for flight (was swimming
    // over water last frame, flying now). Captured here before velocities change.
    const tookOff = this.overWater && this.prevMode === 'swim' && this.mode === 'fly'

    // --- Camera-relative ground directions (same as Step 4) ----------------
    const yaw = this.camera.getYaw()
    const forwardX = -Math.sin(yaw)
    const forwardZ = -Math.cos(yaw)
    const rightX = Math.cos(yaw)
    const rightZ = -Math.sin(yaw)

    // --- Movement intent -> a horizontal direction, normalized so diagonals aren't fast -
    const move = this.input.getMovement()
    let dirX = forwardX * move.forward + rightX * move.right
    let dirZ = forwardZ * move.forward + rightZ * move.right
    const len = Math.hypot(dirX, dirZ)
    if (len > 0) {
      dirX /= len
      dirZ /= len
    }

    // --- Mode-specific horizontal velocity (vertical handled below) --------
    if (this.isPanicking()) {
      this.updatePanicFlee(delta, dirX, dirZ)
    } else if (this.mode === 'fly') {
      this.updateFly(delta, dirX, dirZ)
    } else if (this.mode === 'swim') {
      this.updateSwim(delta, dirX, dirZ)
    } else {
      this.updateWaddle(delta, dirX, dirZ)
    }

    // Give takeoff off the water a crisp upward pop instead of a slow ooze up.
    if (tookOff) this.velocity.y = Math.max(this.velocity.y, TAKEOFF_POP)

    // --- Apply horizontal movement, then push out of obstacle SIDES --------
    this.duck.group.position.x += this.velocity.x * delta
    this.duck.group.position.z += this.velocity.z * delta
    // STEP_UP lets her step onto / stand on low rocks (they're floors, not walls).
    resolveWalls(this.duck.group.position, this.velocity, DUCK_RADIUS, this.altitude, DUCK_HEIGHT, STEP_UP, this.colliders)

    // --- Vertical: find the floor under her new position and settle onto it -
    // Over the pond her "floor" is the waterline (so she floats on the surface);
    // otherwise it's the ground or a rock/tree top she's standing on. Doing this
    // AFTER the horizontal move means crossing the shoreline (or landing on a
    // rock she just flew over) resolves correctly.
    const pos = this.duck.group.position
    this.overWater = this.pond.isWater(pos.x, pos.z)
    this.groundHeight = this.overWater
      ? this.pond.floatLine
      : floorHeightAt(pos.x, pos.z, this.altitude, DUCK_RADIUS, STEP_UP, this.colliders, this.terrain.heightAt(pos.x, pos.z))
    this.updateAltitude(delta)

    // --- The Queen gathers nearby resources on foot or while swimming (not from
    //     the air). Ducklings never gather reeds; food is shared with subjects.
    if (this.mode !== 'fly') {
      const reed = this.reeds.nearestUncollected(pos.x, pos.z, REED_REACH)
      if (reed) this.reeds.collect(reed)
      const food = this.food.nearestUncollected(pos.x, pos.z, FOOD_REACH)
      if (food) this.food.collect(food)
    }

    // --- Splash when she breaks the surface (landing from air, or taking off) -
    if (this.pendingSplash > 0) {
      this.onSplash(pos.x, pos.z, this.pendingSplash) // splashdown from flight
      this.pendingSplash = 0
    } else if (tookOff) {
      this.onSplash(pos.x, pos.z, TAKEOFF_SPLASH) // launching off the water
    }
    this.prevMode = this.mode

    // --- Face the way she's moving (horizontal only) -----------------------
    const speed = Math.hypot(this.velocity.x, this.velocity.z)
    // minSpeed 0.1: ignore tiny drift so she doesn't twitch her facing at rest.
    this.heading = faceHeading(this.heading, this.velocity.x, this.velocity.z, TURN_SPEED, delta, 0.1)

    // --- Pose: waddle bob/roll on the ground, or a flight lean in the air ---
    this.applyPose(delta, speed)

    // --- Wings: flap while flying, fold back on the ground ------------------
    this.updateWings(delta)

    this.updateCrown(delta)
    this.duck.update(delta)
    this.quackFlourishTimer = Math.max(0, this.quackFlourishTimer - delta)
    this.panicTimer = Math.max(0, this.panicTimer - delta)
  }

  private updateWings(delta: number): void {
    if (this.isPanicking()) {
      this.flapIntensity = 0
      this.flapPhase += delta * PANIC_FLUTTER_SPEED
      const flutter = PANIC_FLUTTER_REST + Math.abs(Math.sin(this.flapPhase)) * PANIC_FLUTTER_AMPLITUDE
      this.duck.leftWing.rotation.z = -flutter
      this.duck.rightWing.rotation.z = flutter
      return
    }

    const challenge = !this.isPanicking() && (this.honkOffActive || this.quackFlourishTimer > 0)
    if (challenge && this.mode !== 'fly') {
      const held = this.honkOffActive ? 1 : 0
      const burst = this.quackFlourishTimer > 0 ? this.quackFlourishTimer / this.quackFlourishDuration : 0
      const intensity = Math.max(held * 0.55, burst)
      this.flapIntensity = 0
      this.flapPhase += delta * CHALLENGE_FLAP_SPEED
      const flap = CHALLENGE_WING_REST + Math.abs(Math.sin(this.flapPhase)) * CHALLENGE_WING_FLAP * intensity
      this.duck.leftWing.rotation.z = -flap
      this.duck.rightWing.rotation.z = flap
      return
    }

    // Wings come out only when she's actually flying: above her floor, OR holding
    // Space to take off. Resting on the ground (or on a rock) folds them —
    // otherwise she sits there with her wings stuck out mid-glide.
    const airborne = this.altitude > this.groundHeight + GROUND_EPS
    const flapping = this.input.isFlyHeld
    const wingsOut = this.mode === 'fly' && (airborne || flapping)

    if (wingsOut) {
      // Flap only while powering upward (Space held); otherwise hold the wings
      // out for a glide. flapIntensity eases between the two so the transition
      // from flapping to gliding isn't an abrupt snap.
      const target = flapping ? 1 : 0
      this.flapIntensity += (target - this.flapIntensity) * (1 - Math.exp(-FLAP_EASE * delta))
      this.flapPhase += delta * FLAP_SPEED

      // Spread the wings out (mirrored left/right), with the flap oscillation
      // scaled by how hard she's currently flapping. The negative on the left
      // is just because the wings hinge in opposite senses.
      const spread = FLAP_REST + Math.sin(this.flapPhase) * FLAP_AMPLITUDE * this.flapIntensity
      this.duck.leftWing.rotation.z = -spread
      this.duck.rightWing.rotation.z = spread
    } else {
      // Fold wings back to vertical: waddling, or grounded-and-idle in Fly mode.
      this.flapIntensity = 0
      const t = 1 - Math.exp(-WING_SETTLE * delta)
      this.duck.leftWing.rotation.z += (0 - this.duck.leftWing.rotation.z) * t
      this.duck.rightWing.rotation.z += (0 - this.duck.rightWing.rotation.z) * t
    }
  }

  /** Move her vertically toward/within her floor. In fly she integrates her
   *  vertical velocity and stops at the floor or the ceiling; in waddle she just
   *  settles onto the floor (so she can rest on a rock, or float off its edge). */
  private updateAltitude(delta: number): void {
    if (this.mode === 'fly') {
      this.altitude += this.velocity.y * delta
      if (this.altitude <= this.groundHeight) {
        // Coming down onto water fast enough? Remember it so we make a splash.
        if (this.overWater && this.velocity.y < -SPLASH_MIN_SPEED) {
          this.pendingSplash = -this.velocity.y
        }
        this.altitude = this.groundHeight // landed on the floor (ground/rock/water)
        if (this.velocity.y < 0) this.velocity.y = 0
      } else if (this.altitude >= MAX_ALTITUDE) {
        this.altitude = MAX_ALTITUDE
        if (this.velocity.y > 0) this.velocity.y = 0
      }
    } else {
      this.velocity.y = 0
      this.altitude += (this.groundHeight - this.altitude) * (1 - Math.exp(-LAND_SPEED * delta))
    }
  }

  private updateMode(): void {
    // No toggle keys — her mode follows her situation:
    //   still up in the air OR pressing Space -> fly (Space launches her)
    //   else over the pond                    -> swim
    //   else                                  -> waddle
    //
    // "Still aloft" only counts when she's ALREADY flying and remains above her
    // floor — i.e. she genuinely left the ground. Walking on rolling terrain, the
    // hill slopes away under her feet and her altitude eases down to follow it; we
    // must NOT read that lag as "airborne", or she'd flicker into flight (wings
    // popping out) every time she walks downhill. Launching is still instant via
    // Space (wantsUp).
    const stillAloft = this.mode === 'fly' && this.altitude > this.groundHeight + GROUND_EPS
    const wantsUp = this.input.isFlyHeld && !this.isPanicking()
    if (wantsUp || stillAloft) this.mode = 'fly'
    else if (this.overWater) this.mode = 'swim'
    else this.mode = 'waddle'
  }

  private updateWaddle(delta: number, dirX: number, dirZ: number): void {
    // Horizontal velocity only; the vertical settle happens in updateAltitude.
    const targetX = dirX * MAX_SPEED
    const targetZ = dirZ * MAX_SPEED
    const t = 1 - Math.exp(-RESPONSIVENESS * delta)
    this.velocity.x += (targetX - this.velocity.x) * t
    this.velocity.z += (targetZ - this.velocity.z) * t
  }

  private updateSwim(delta: number, dirX: number, dirZ: number): void {
    // Like waddling, but slower and much glidier — she coasts across the water.
    // Vertical settling to the waterline is handled in updateAltitude.
    const targetX = dirX * SWIM_SPEED
    const targetZ = dirZ * SWIM_SPEED
    const t = 1 - Math.exp(-SWIM_RESPONSIVENESS * delta)
    this.velocity.x += (targetX - this.velocity.x) * t
    this.velocity.z += (targetZ - this.velocity.z) * t
  }

  private updateFly(delta: number, dirX: number, dirZ: number): void {
    // Hold Space to fly up; release to drift gently back down. There's always a
    // downward "fall" target, and holding Space overrides it with a rise target.
    // (The actual altitude change + floor/ceiling clamp happen in updateAltitude.)
    const rising = this.input.isFlyHeld
    const targetY = rising ? FLY_RISE_SPEED : -FLY_FALL_SPEED

    const targetX = dirX * FLY_SPEED
    const targetZ = dirZ * FLY_SPEED
    const t = 1 - Math.exp(-FLY_RESPONSIVENESS * delta)
    this.velocity.x += (targetX - this.velocity.x) * t
    this.velocity.y += (targetY - this.velocity.y) * t
    this.velocity.z += (targetZ - this.velocity.z) * t
  }

  private updatePanicFlee(delta: number, dirX: number, dirZ: number): void {
    const pos = this.duck.group.position
    let fleeX = pos.x - this.panicFromX
    let fleeZ = pos.z - this.panicFromZ
    const fleeLen = Math.hypot(fleeX, fleeZ)
    if (fleeLen > 0.001) {
      fleeX /= fleeLen
      fleeZ /= fleeLen
    } else {
      fleeX = -Math.sin(this.heading)
      fleeZ = -Math.cos(this.heading)
    }

    let targetX = fleeX + dirX * PANIC_STEER_INFLUENCE
    let targetZ = fleeZ + dirZ * PANIC_STEER_INFLUENCE
    const targetLen = Math.hypot(targetX, targetZ)
    if (targetLen > 0.001) {
      targetX = (targetX / targetLen) * PANIC_SPEED
      targetZ = (targetZ / targetLen) * PANIC_SPEED
    } else {
      targetX = fleeX * PANIC_SPEED
      targetZ = fleeZ * PANIC_SPEED
    }

    const t = 1 - Math.exp(-PANIC_RESPONSIVENESS * delta)
    this.velocity.x += (targetX - this.velocity.x) * t
    this.velocity.z += (targetZ - this.velocity.z) * t

    if (this.mode === 'fly') {
      this.velocity.y += (-FLY_FALL_SPEED - this.velocity.y) * t
    }
  }

  private applyPose(delta: number, speed: number): void {
    let bob = 0
    let roll = 0
    let pitch = 0

    if (this.isPanicking()) {
      const moveFactor = Math.min(speed / PANIC_SPEED, 1)
      this.waddlePhase += delta * (12 + speed * 1.4)
      bob = Math.abs(Math.sin(this.waddlePhase)) * PANIC_WADDLE_BOB * moveFactor
      roll = Math.sin(this.waddlePhase) * PANIC_WADDLE_ROLL * moveFactor
      pitch = 0.18
    } else if (this.mode === 'waddle') {
      // Hop + side-to-side tilt, fading in/out with how fast she's walking.
      const moveFactor = Math.min(speed / MAX_SPEED, 1)
      this.waddlePhase += delta * (6 + speed) // steps come quicker when faster
      bob = Math.abs(Math.sin(this.waddlePhase)) * WADDLE_BOB * moveFactor
      roll = Math.sin(this.waddlePhase) * WADDLE_ROLL * moveFactor
    } else if (this.mode === 'swim') {
      // Float: a slow, gentle bob + sway that runs even when she's still — the
      // water's always moving her a little.
      this.waddlePhase += delta * 2.5
      bob = Math.sin(this.waddlePhase) * SWIM_BOB
      roll = Math.sin(this.waddlePhase * 0.7) * SWIM_ROLL
    } else {
      // Flying: lean nose-down with horizontal speed; nose-up while rising.
      const fwdFactor = Math.min(speed / FLY_SPEED, 1)
      pitch = -FLY_LEAN * fwdFactor + this.velocity.y * 0.04
    }

    if (this.honkOffActive && !this.isPanicking() && this.mode !== 'fly') {
      const bounce = Math.abs(Math.sin(this.flapPhase * 0.8))
      bob += bounce * CHALLENGE_BOB
      roll += Math.sin(this.flapPhase * 0.45) * CHALLENGE_ROLL
      pitch += CHALLENGE_PITCH
    }

    this.duck.group.position.y = this.altitude + bob
    this.duck.group.rotation.x = pitch // nose up/down
    this.duck.group.rotation.y = this.heading // turn
    this.duck.group.rotation.z = roll // waddle tilt
  }

  private updateCrown(delta: number): void {
    if (!this.duck.crown) return

    const targetX = this.isPanicking() ? 0.28 : this.honkOffActive ? -0.1 : 0
    const targetZ = this.isPanicking()
      ? Math.sin(this.waddlePhase * 0.5) * 0.22
      : this.honkOffActive
        ? Math.sin(this.flapPhase * 0.35) * 0.12
        : 0
    const t = 1 - Math.exp(-PANIC_CROWN_EASE * delta)
    this.duck.crown.rotation.x += (targetX - this.duck.crown.rotation.x) * t
    this.duck.crown.rotation.z += (targetZ - this.duck.crown.rotation.z) * t
  }
}
