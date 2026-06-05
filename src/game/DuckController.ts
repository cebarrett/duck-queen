import * as THREE from 'three'
import type { Input } from './Input'
import type { ThirdPersonCamera } from './ThirdPersonCamera'
import type { Duck } from './Duck'

// The two ways the Queen gets around. Exported so the HUD can label it.
export type DuckMode = 'waddle' | 'fly'

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

// --- Wing flap (fly only) --------------------------------------------------
const FLAP_SPEED = 14 // how fast the phase advances (radians/sec)
const FLAP_AMPLITUDE = 0.5 // half the up/down swing (radians)
const FLAP_REST = 0.9 // wings sit spread out this far while flying (radians)
const FLAP_EASE = 10 // how fast flapping ramps up/down as Space is held/released
const WING_SETTLE = 8 // how fast wings fold back to vertical on the ground

// --- Shared ----------------------------------------------------------------
const TURN_SPEED = 10 // how fast she rotates to face travel direction

/**
 * DuckController moves the Queen in one of two modes:
 *   - waddle: stuck to the ground, hops + tilts as she walks.
 *   - fly:    free in 3D; Space/Shift change altitude; she leans into the glide.
 *
 * Both modes share the same "ease toward a target velocity" core (see Step 4):
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
  private flapPhase = 0 // drives the wing flap sine wave while flying
  private flapIntensity = 0 // 0 = gliding (still wings), 1 = flapping hard

  private mode: DuckMode = 'waddle'

  constructor(
    private readonly duck: Duck,
    private readonly input: Input,
    private readonly camera: ThirdPersonCamera,
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

    // --- Mode-specific velocity + altitude ---------------------------------
    if (this.mode === 'fly') {
      this.updateFly(delta, dirX, dirZ)
    } else {
      this.updateWaddle(delta, dirX, dirZ)
    }

    // --- Apply horizontal movement (both modes) ----------------------------
    this.duck.group.position.x += this.velocity.x * delta
    this.duck.group.position.z += this.velocity.z * delta

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
    // Wings come out only when she's actually flying: off the ground, OR holding
    // Space to take off. Resting on the ground (even still in Fly mode) folds
    // them — otherwise she sits there with her wings stuck out mid-glide.
    const airborne = this.altitude > 0.05
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

  private updateMode(): void {
    // No toggle key: she's flying whenever she's off the ground OR pressing Space
    // to take off. Otherwise (resting on the ground, not pushing up) she waddles.
    // So tapping Space launches her, and she returns to waddling once she lands.
    const airborne = this.altitude > 0.05
    const wantsUp = this.input.isDown('Space')
    this.mode = airborne || wantsUp ? 'fly' : 'waddle'
  }

  private updateWaddle(delta: number, dirX: number, dirZ: number): void {
    const targetX = dirX * MAX_SPEED
    const targetZ = dirZ * MAX_SPEED
    const t = 1 - Math.exp(-RESPONSIVENESS * delta)
    this.velocity.x += (targetX - this.velocity.x) * t
    this.velocity.z += (targetZ - this.velocity.z) * t
    this.velocity.y = 0

    // Ease altitude back to ground level (only matters if we just left fly).
    this.altitude += (0 - this.altitude) * (1 - Math.exp(-LAND_SPEED * delta))
  }

  private updateFly(delta: number, dirX: number, dirZ: number): void {
    // Hold Space to fly up; release to drift gently back down. There's always a
    // downward "fall" target, and holding Space overrides it with a rise target.
    const rising = this.input.isDown('Space')
    const targetY = rising ? FLY_RISE_SPEED : -FLY_FALL_SPEED

    const targetX = dirX * FLY_SPEED
    const targetZ = dirZ * FLY_SPEED
    const t = 1 - Math.exp(-FLY_RESPONSIVENESS * delta)
    this.velocity.x += (targetX - this.velocity.x) * t
    this.velocity.y += (targetY - this.velocity.y) * t
    this.velocity.z += (targetZ - this.velocity.z) * t

    // Integrate altitude, and stop dead at the floor and the ceiling.
    this.altitude += this.velocity.y * delta
    if (this.altitude <= 0) {
      this.altitude = 0
      if (this.velocity.y < 0) this.velocity.y = 0
    } else if (this.altitude >= MAX_ALTITUDE) {
      this.altitude = MAX_ALTITUDE
      if (this.velocity.y > 0) this.velocity.y = 0
    }
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
    } else {
      // Cruising: lean nose-down with horizontal speed; nose-up while rising.
      const fwdFactor = Math.min(speed / FLY_SPEED, 1)
      pitch = -FLY_LEAN * fwdFactor + this.velocity.y * 0.04
    }

    this.duck.group.position.y = this.altitude + bob
    this.duck.group.rotation.x = pitch // nose up/down
    this.duck.group.rotation.y = this.heading // turn
    this.duck.group.rotation.z = roll // waddle tilt
  }
}

/**
 * Step `current` toward `target` (both radians) by fraction `t`, going the SHORT
 * way around the circle so we never spin the long way past the ±π seam.
 */
function approachAngle(current: number, target: number, t: number): number {
  let diff = target - current
  diff = Math.atan2(Math.sin(diff), Math.cos(diff)) // wrap into [-PI, PI]
  return current + diff * Math.min(t, 1)
}
