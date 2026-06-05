import * as THREE from 'three'
import type { Input } from './Input'
import type { ThirdPersonCamera } from './ThirdPersonCamera'
import type { Duck } from './Duck'
import type { Collider } from './World'
import type { Pond } from './Water'
import { approachAngle } from './mathUtils'

// The ways the Queen gets around. Exported so the HUD can label it.
export type DuckMode = 'waddle' | 'fly' | 'swim'

// --- Waddle (ground) tuning ------------------------------------------------
const MAX_SPEED = 6 // top waddle speed (units/second)
const RESPONSIVENESS = 6 // how fast velocity chases the target; lower = heavier
const WADDLE_BOB = 0.08 // how high she hops while waddling (units)
const WADDLE_ROLL = 0.15 // how far she tilts side-to-side (radians)
const LAND_SPEED = 4 // how fast she sinks back to the ground after flying

// --- Fly tuning: heavier (more glide/inertia) but still settles ------------
const FLY_SPEED = 7 // top horizontal fly speed
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

// --- Wing flap (fly only) --------------------------------------------------
const FLAP_SPEED = 14 // how fast the phase advances (radians/sec)
const FLAP_AMPLITUDE = 0.5 // half the up/down swing (radians)
const FLAP_REST = 0.9 // wings sit spread out this far while flying (radians)
const FLAP_EASE = 10 // how fast flapping ramps up/down as Space is held/released
const WING_SETTLE = 8 // how fast wings fold back to vertical on the ground

// --- Shared ----------------------------------------------------------------
const TURN_SPEED = 10 // how fast she rotates to face travel direction
const DUCK_RADIUS = 0.5 // her footprint for collision (a circle on the ground)
const DUCK_HEIGHT = 1.7 // how tall she is, for "can I fly over this?" checks
const STEP_UP = 0.6 // surfaces within this height of her feet are floors she can
//                     stand on / step up onto; taller ones act as solid walls
const GROUND_EPS = 0.05 // how far above her floor counts as "in the air"

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

  private mode: DuckMode = 'waddle'

  constructor(
    private readonly duck: Duck,
    private readonly input: Input,
    private readonly camera: ThirdPersonCamera,
    private readonly colliders: Collider[],
    private readonly pond: Pond,
  ) {}

  getMode(): DuckMode {
    return this.mode
  }

  update(delta: number): void {
    this.updateMode()

    // --- Camera-relative ground directions (same as Step 4) ----------------
    const yaw = this.camera.getYaw()
    const forwardX = -Math.sin(yaw)
    const forwardZ = -Math.cos(yaw)
    const rightX = Math.cos(yaw)
    const rightZ = -Math.sin(yaw)

    // --- WASD -> a horizontal direction, normalized so diagonals aren't fast -
    let dirX = 0
    let dirZ = 0
    if (this.input.isDown('KeyW')) {
      dirX += forwardX
      dirZ += forwardZ
    }
    if (this.input.isDown('KeyS')) {
      dirX -= forwardX
      dirZ -= forwardZ
    }
    if (this.input.isDown('KeyD')) {
      dirX += rightX
      dirZ += rightZ
    }
    if (this.input.isDown('KeyA')) {
      dirX -= rightX
      dirZ -= rightZ
    }
    const len = Math.hypot(dirX, dirZ)
    if (len > 0) {
      dirX /= len
      dirZ /= len
    }

    // --- Mode-specific horizontal velocity (vertical handled below) --------
    if (this.mode === 'fly') {
      this.updateFly(delta, dirX, dirZ)
    } else if (this.mode === 'swim') {
      this.updateSwim(delta, dirX, dirZ)
    } else {
      this.updateWaddle(delta, dirX, dirZ)
    }

    // --- Apply horizontal movement, then push out of obstacle SIDES --------
    this.duck.group.position.x += this.velocity.x * delta
    this.duck.group.position.z += this.velocity.z * delta
    this.resolveWalls()

    // --- Vertical: find the floor under her new position and settle onto it -
    // Over the pond her "floor" is the waterline (so she floats on the surface);
    // otherwise it's the ground or a rock/tree top she's standing on. Doing this
    // AFTER the horizontal move means crossing the shoreline (or landing on a
    // rock she just flew over) resolves correctly.
    const pos = this.duck.group.position
    this.overWater = this.pond.isWater(pos.x, pos.z)
    this.groundHeight = this.overWater
      ? this.pond.floatLine
      : this.supportHeightAt(pos.x, pos.z, this.altitude)
    this.updateAltitude(delta)

    // --- Face the way she's moving (horizontal only) -----------------------
    const speed = Math.hypot(this.velocity.x, this.velocity.z)
    if (speed > 0.1) {
      const targetHeading = Math.atan2(-this.velocity.x, -this.velocity.z)
      this.heading = approachAngle(this.heading, targetHeading, TURN_SPEED * delta)
    }

    // --- Pose: waddle bob/roll on the ground, or a flight lean in the air ---
    this.applyPose(delta, speed)

    // --- Wings: flap while flying, fold back on the ground ------------------
    this.updateWings(delta)
  }

  private updateWings(delta: number): void {
    // Wings come out only when she's actually flying: above her floor, OR holding
    // Space to take off. Resting on the ground (or on a rock) folds them —
    // otherwise she sits there with her wings stuck out mid-glide.
    const airborne = this.altitude > this.groundHeight + GROUND_EPS
    const flapping = this.input.isDown('Space')
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

  /**
   * Horizontal collision: push the duck (a circle of DUCK_RADIUS, DUCK_HEIGHT
   * tall) out of the SIDES of any obstacle her body intersects, and cancel the
   * velocity heading into it so she slides along instead of sticking.
   *
   * Crucially, we SKIP any obstacle whose top is within STEP_UP of her feet —
   * those are floors she stands on or steps up onto (handled by the vertical
   * pass), not walls. That's what stopped her being shoved off a rock's top.
   */
  private resolveWalls(): void {
    const pos = this.duck.group.position
    const feet = this.altitude
    const head = feet + DUCK_HEIGHT

    for (const c of this.colliders) {
      if (head <= c.yMin) continue // her whole body is below it -> walk under
      if (feet >= c.yMax - STEP_UP) continue // she's on top / stepping up -> floor, not wall

      // Circle-vs-circle on the ground plane.
      const dx = pos.x - c.x
      const dz = pos.z - c.z
      const minDist = c.radius + DUCK_RADIUS
      const distSq = dx * dx + dz * dz
      if (distSq >= minDist * minDist) continue // not overlapping

      // Push her out along the line from the obstacle's centre to her.
      const dist = Math.sqrt(distSq) || 0.0001
      const nx = dx / dist
      const nz = dz / dist
      pos.x = c.x + nx * minDist
      pos.z = c.z + nz * minDist

      // Remove the velocity component pointing into the obstacle, keeping the
      // sideways part so she slides around it.
      const into = this.velocity.x * nx + this.velocity.z * nz
      if (into < 0) {
        this.velocity.x -= into * nx
        this.velocity.z -= into * nz
      }
    }
  }

  /**
   * The height of the floor under her at (x, z): the highest obstacle-top she's
   * standing over whose surface is at most STEP_UP above her feet, or 0 (the
   * ground) if none. The STEP_UP limit means a rock she's descended onto or can
   * step up to supports her, but a tall treetop far above doesn't yank her up.
   */
  private supportHeightAt(x: number, z: number, feet: number): number {
    let support = 0 // the ground is always there at y = 0
    for (const c of this.colliders) {
      const dx = x - c.x
      const dz = z - c.z
      const reach = c.radius + DUCK_RADIUS
      if (dx * dx + dz * dz >= reach * reach) continue // not standing over it
      if (c.yMax <= feet + STEP_UP) support = Math.max(support, c.yMax)
    }
    return support
  }

  /** Move her vertically toward/within her floor. In fly she integrates her
   *  vertical velocity and stops at the floor or the ceiling; in waddle she just
   *  settles onto the floor (so she can rest on a rock, or float off its edge). */
  private updateAltitude(delta: number): void {
    if (this.mode === 'fly') {
      this.altitude += this.velocity.y * delta
      if (this.altitude <= this.groundHeight) {
        this.altitude = this.groundHeight // landed on the floor (ground/rock top)
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
    //   above the floor OR pressing Space -> fly (Space launches her)
    //   else over the pond               -> swim
    //   else                             -> waddle
    const airborne = this.altitude > this.groundHeight + GROUND_EPS
    const wantsUp = this.input.isDown('Space')
    if (wantsUp || airborne) this.mode = 'fly'
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
    const rising = this.input.isDown('Space')
    const targetY = rising ? FLY_RISE_SPEED : -FLY_FALL_SPEED

    const targetX = dirX * FLY_SPEED
    const targetZ = dirZ * FLY_SPEED
    const t = 1 - Math.exp(-FLY_RESPONSIVENESS * delta)
    this.velocity.x += (targetX - this.velocity.x) * t
    this.velocity.y += (targetY - this.velocity.y) * t
    this.velocity.z += (targetZ - this.velocity.z) * t
  }

  private applyPose(delta: number, speed: number): void {
    let bob = 0
    let roll = 0
    let pitch = 0

    if (this.mode === 'waddle') {
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

    this.duck.group.position.y = this.altitude + bob
    this.duck.group.rotation.x = pitch // nose up/down
    this.duck.group.rotation.y = this.heading // turn
    this.duck.group.rotation.z = roll // waddle tilt
  }
}
