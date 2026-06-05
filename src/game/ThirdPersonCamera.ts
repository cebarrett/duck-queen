import * as THREE from 'three'
import type { Input } from './Input'

// --- Tuning knobs (all easy to tweak) -------------------------------------
const LOOK_HEIGHT = 1.2 // aim at the duck's head, not her feet
const DISTANCE = 7 // how far behind the duck the camera sits
const SENSITIVITY = 0.0025 // radians of orbit per pixel of mouse movement
const PITCH_MIN = -0.2 // how far we can look up from below (radians)
const PITCH_MAX = 1.2 // how far we can look down from above
const FOLLOW_SPEED = 8 // higher = the camera chases the duck more snappily

/**
 * A third-person camera that orbits a target (the duck) with the mouse and
 * smoothly follows it as it moves.
 *
 * The core idea is spherical coordinates: instead of storing the camera's x/y/z
 * directly, we store two angles — yaw (left/right) and pitch (up/down) — plus a
 * fixed distance. Each frame we convert (yaw, pitch, distance) into an x/y/z
 * offset from the duck and place the camera there. Angles are intuitive to
 * drive with a mouse; the trig does the rest.
 */
export class ThirdPersonCamera {
  private yaw = 0 // 0 = directly behind the duck (she faces -Z)
  private pitch = 0.35 // start with a gentle look-down

  // The point the camera looks at. We keep a SMOOTHED copy that eases toward
  // the duck so quick movements don't make the camera jitter.
  private readonly smoothedTarget = new THREE.Vector3()

  // A scratch vector reused every frame so we don't allocate garbage in the
  // render loop (allocating 60x/sec adds up — small but real footgun).
  private readonly tmp = new THREE.Vector3()

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: Input,
    private readonly target: THREE.Object3D,
  ) {
    // Start the smoothed target where the duck already is, so there's no
    // opening "swoop" on the very first frame.
    this.smoothedTarget.copy(target.position)
    this.smoothedTarget.y += LOOK_HEIGHT
  }

  update(delta: number): void {
    // 1) Mouse orbits the camera. Reading the delta also clears it.
    const mouse = this.input.consumeMouseDelta()
    this.yaw -= mouse.x * SENSITIVITY // drag right -> swing around to the right
    this.pitch += mouse.y * SENSITIVITY // drag down -> rise up and look down
    // Clamp pitch so you can never flip over the top/bottom (gimbal-flip guard).
    this.pitch = THREE.MathUtils.clamp(this.pitch, PITCH_MIN, PITCH_MAX)

    // 2) Ease the look-at point toward the duck's head. The exp() form makes
    //    the smoothing frame-rate independent: t≈1 snaps, t≈0 barely moves.
    const desired = this.tmp.copy(this.target.position)
    desired.y += LOOK_HEIGHT
    const t = 1 - Math.exp(-FOLLOW_SPEED * delta)
    this.smoothedTarget.lerp(desired, t)

    // 3) Convert (yaw, pitch, distance) into an offset and place the camera.
    //    cos(pitch) shrinks the horizontal radius as you look more steeply up
    //    or down; sin(pitch) raises/lowers the camera.
    const cosPitch = Math.cos(this.pitch)
    const offsetX = DISTANCE * cosPitch * Math.sin(this.yaw)
    const offsetZ = DISTANCE * cosPitch * Math.cos(this.yaw)
    const offsetY = DISTANCE * Math.sin(this.pitch)

    this.camera.position.set(
      this.smoothedTarget.x + offsetX,
      this.smoothedTarget.y + offsetY,
      this.smoothedTarget.z + offsetZ,
    )
    this.camera.lookAt(this.smoothedTarget)
  }

  /** The horizontal direction the camera faces — handy for camera-relative
   *  movement in Step 4. Returns yaw in radians. */
  getYaw(): number {
    return this.yaw
  }
}
