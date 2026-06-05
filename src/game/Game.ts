import * as THREE from 'three'
import { World } from './World'
import { Duck } from './Duck'
import { Input } from './Input'
import { ThirdPersonCamera } from './ThirdPersonCamera'
import { DuckController } from './DuckController'
import { HUD } from './HUD'

/**
 * Game is the "conductor". It owns the three core Three.js objects and the
 * render loop, and (later) wires together the world, duck, camera, input, HUD.
 *
 * The three core objects you always need in Three.js:
 *   - Scene:    the container for everything you want to draw.
 *   - Camera:   the point of view it's drawn from.
 *   - Renderer: the thing that turns Scene + Camera into pixels on a <canvas>.
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene: THREE.Scene
  private readonly camera: THREE.PerspectiveCamera

  // Clock measures real time between frames so movement is smooth and
  // frame-rate independent (more on this in update()).
  private readonly clock = new THREE.Clock()

  // The player character — the duck Queen.
  private readonly duck = new Duck()

  // Input + the follow camera are created in the constructor (they need the
  // renderer's canvas / the camera / the duck, which are set up there).
  private readonly input: Input
  private readonly cameraRig: ThirdPersonCamera
  private readonly duckController: DuckController
  private readonly hud = new HUD()

  constructor() {
    // --- Renderer ---------------------------------------------------------
    // antialias smooths jagged edges. We append its <canvas> to the page.
    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    // On retina/high-DPI screens devicePixelRatio can be 2–3. Rendering at 3x
    // is 9x the pixels and tanks perf, so we cap it at 2. (Beginner footgun.)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    document.body.appendChild(this.renderer.domElement)

    // --- Scene ------------------------------------------------------------
    this.scene = new THREE.Scene()
    // World adds the ground, sky, fog, and lights to the scene.
    new World(this.scene)

    // --- Camera -----------------------------------------------------------
    // PerspectiveCamera(fov, aspect, near, far):
    //   fov  = vertical field of view in degrees (75 is a common game value).
    //   aspect = width / height; MUST match the canvas or things look stretched.
    //   near/far = the closest and farthest distances that get drawn.
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    )
    // Add the duck. `duck.group` is the single Group holding all her boxes.
    this.scene.add(this.duck.group)

    // Input listens to keyboard/mouse on the renderer's canvas; the camera rig
    // follows the duck and orbits via the mouse. The rig now drives the camera
    // every frame, so we no longer set camera.position by hand.
    this.input = new Input(this.renderer.domElement)
    this.cameraRig = new ThirdPersonCamera(this.camera, this.input, this.duck.group)
    this.duckController = new DuckController(this.duck, this.input, this.cameraRig)

    // Keep the camera/canvas correct when the window resizes.
    window.addEventListener('resize', this.onResize)
  }

  /** Start the render loop. */
  start(): void {
    // setAnimationLoop calls our callback ~60x/sec (synced to the display).
    // It's Three's preferred loop because it also works in VR/AR contexts.
    this.renderer.setAnimationLoop(this.update)
  }

  /**
   * Called once per frame. We use an arrow-function field (not a method) so
   * `this` stays bound to the Game when passed as a callback.
   */
  private update = (): void => {
    // delta = seconds since the last frame, so everything is frame-rate
    // independent (see the camera's smoothing and Step 4's movement).
    const delta = this.clock.getDelta()

    // Move the duck first, then let the camera follow her new position.
    this.duckController.update(delta)
    this.cameraRig.update(delta)

    // Keep the HUD in sync with the current mode (it only redraws on change).
    this.hud.setMode(this.duckController.getMode())

    this.renderer.render(this.scene, this.camera)
  }

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    // After changing aspect/fov you must recompute the projection matrix,
    // or the change won't take effect.
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  }
}
