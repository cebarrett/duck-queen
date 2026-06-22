import * as THREE from 'three'
import type { Input } from './Input'

export interface CameraController {
  update(delta: number): void
  getYaw(): number
  setXRActive(active: boolean): void
}

// --- Tuning knobs (all easy to tweak) -------------------------------------
const LOOK_HEIGHT = 1.2 // aim at the duck's head, not her feet
const DISTANCE = 7 // how far behind the duck the camera sits
const XR_DISTANCE = 5.8 // the floor-space origin trails the Queen by this much
const SENSITIVITY = 0.0025 // radians of orbit per pixel of mouse movement
const PITCH_MIN = -0.2 // how far we can look up from below (radians)
const PITCH_MAX = 1.2 // how far we can look down from above
const FOLLOW_SPEED = 8 // higher = the camera chases the duck more snappily
const XR_FOLLOW_SPEED = 5 // a little softer than desktop to avoid headset lurch
const XR_VERTICAL_FOLLOW_SPEED = 2
const MIN_HEIGHT = 0.4 // keep the camera above the ground (y=0) so we never see
//                        through the single-sided ground plane from below

/**
 * A third-person camera controller with two modes:
 * - desktop: classic mouse orbit, where this code owns the camera transform
 * - XR: a parent rig follows/orbits the Queen while WebXR owns the headset pose
 *
 * The split keeps desktop behavior intact and gives WebXR a stable floor-space
 * origin instead of forcing the headset itself to be a scripted game camera.
 */
export class ThirdPersonCamera implements CameraController {
  private readonly root = new THREE.Group()
  private readonly desktop: DesktopThirdPersonCamera
  private readonly xr: XRThirdPersonCamera
  private xrActive = false

  constructor(
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    input: Input,
    target: THREE.Object3D,
  ) {
    this.root.name = 'CameraRig'
    scene.add(this.root)
    this.root.add(camera)

    this.desktop = new DesktopThirdPersonCamera(this.root, camera, input, target)
    this.xr = new XRThirdPersonCamera(this.root, camera, input, target)
  }

  update(delta: number): void {
    if (this.xrActive) this.xr.update(delta)
    else this.desktop.update(delta)
  }

  getYaw(): number {
    return this.xrActive ? this.xr.getYaw() : this.desktop.getYaw()
  }

  setXRActive(active: boolean): void {
    if (this.xrActive === active) return
    this.xrActive = active
    if (active) this.xr.enter(this.desktop.getYaw())
    else this.desktop.enter(this.xr.getYaw())
  }
}

class DesktopThirdPersonCamera {
  private yaw = 0 // 0 = directly behind the duck (she faces -Z)
  private pitch = 0.35 // start with a gentle look-down

  // The point the camera looks at. We keep a SMOOTHED copy that eases toward
  // the duck so quick movements don't make the camera jitter.
  private readonly smoothedTarget = new THREE.Vector3()

  // A scratch vector reused every frame so we don't allocate garbage in the
  // render loop (allocating 60x/sec adds up — small but real footgun).
  private readonly tmp = new THREE.Vector3()

  constructor(
    private readonly root: THREE.Group,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: Input,
    private readonly target: THREE.Object3D,
  ) {
    // Start the smoothed target where the duck already is, so there's no
    // opening "swoop" on the very first frame.
    this.smoothedTarget.copy(target.position)
    this.smoothedTarget.y += LOOK_HEIGHT
  }

  enter(yaw: number): void {
    this.yaw = yaw
    this.root.position.set(0, 0, 0)
    this.root.rotation.set(0, 0, 0)
    this.root.scale.set(1, 1, 1)
  }

  update(delta: number): void {
    // 1) Mouse orbits the camera. Reading the delta also clears it.
    const mouse = this.input.consumeLookDelta()
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

    // Clamp the camera's height so it can't dip below the ground (which would
    // show the ground plane's invisible underside). This only bites when she's
    // near the ground — up in the air the camera is nowhere near y=0.
    const camY = Math.max(this.smoothedTarget.y + offsetY, MIN_HEIGHT)

    this.camera.position.set(
      this.smoothedTarget.x + offsetX,
      camY,
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

class XRThirdPersonCamera {
  private yaw = 0
  private readonly smoothedTarget = new THREE.Vector3()
  private readonly tmp = new THREE.Vector3()

  constructor(
    private readonly root: THREE.Group,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly input: Input,
    private readonly target: THREE.Object3D,
  ) {
    this.smoothedTarget.copy(target.position)
    this.smoothedTarget.y += LOOK_HEIGHT
  }

  enter(yaw: number): void {
    this.yaw = yaw
    this.camera.position.set(0, 0, 0)
    this.camera.rotation.set(0, 0, 0)
    this.camera.scale.set(1, 1, 1)
    this.camera.updateMatrixWorld(true)
  }

  update(delta: number): void {
    this.yaw += this.input.consumeSnapTurn()

    const desired = this.tmp.copy(this.target.position)
    desired.y += LOOK_HEIGHT
    const t = 1 - Math.exp(-XR_FOLLOW_SPEED * delta)
    this.smoothedTarget.x += (desired.x - this.smoothedTarget.x) * t
    this.smoothedTarget.z += (desired.z - this.smoothedTarget.z) * t

    const yT = 1 - Math.exp(-XR_VERTICAL_FOLLOW_SPEED * delta)
    this.smoothedTarget.y += (desired.y - this.smoothedTarget.y) * yT

    const offsetX = XR_DISTANCE * Math.sin(this.yaw)
    const offsetZ = XR_DISTANCE * Math.cos(this.yaw)
    const rootY = Math.max(0, this.smoothedTarget.y - LOOK_HEIGHT)

    this.root.position.set(
      this.smoothedTarget.x + offsetX,
      rootY,
      this.smoothedTarget.z + offsetZ,
    )
    this.root.rotation.set(0, this.yaw, 0)
  }

  getYaw(): number {
    return this.yaw
  }
}
