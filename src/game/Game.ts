import * as THREE from 'three'
import { World } from './World'
import { Duck } from './Duck'
import { Input } from './Input'
import { ThirdPersonCamera } from './ThirdPersonCamera'
import { DuckController } from './DuckController'
import { Flock } from './Flock'
import { Geese } from './Geese'
import { Food } from './Food'
import { Reeds } from './Reeds'
import { Sound } from './Sound'
import { Splash } from './Splash'
import { HUD } from './HUD'
import { deriveRng } from './rng'

// The default world seed. A given seed always generates the same layout; pass
// ?seed=123 in the URL to try another one.
const DEFAULT_WORLD_SEED = 20260606

function getWorldSeed(): number {
  const raw = new URLSearchParams(window.location.search).get('seed')
  const parsed = raw === null ? NaN : Number(raw)
  return Number.isFinite(parsed) ? parsed : DEFAULT_WORLD_SEED
}

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
  private readonly flock: Flock
  private readonly geese: Geese
  private readonly food: Food
  private readonly reeds: Reeds
  private readonly sound = new Sound()
  private readonly splashFx: Splash
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

    // --- World seed -------------------------------------------------------
    // ONE seed drives all world generation, so a given seed always produces the
    // exact same layout. Each system gets its own derived stream (see rng.ts).
    // Override with ?seed=123 in the URL to explore other layouts.
    const seed = getWorldSeed()

    // --- Scene ------------------------------------------------------------
    this.scene = new THREE.Scene()
    // World adds the ground, sky, fog, lights, and scenery to the scene, and
    // exposes the scenery's colliders so the duck can bump into them.
    const world = new World(this.scene, deriveRng(seed, 'scenery'))

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
    // Scatter edible plants for the flock to forage (land + pond).
    this.food = new Food(this.scene, world.pond, deriveRng(seed, 'food'))
    // Reeds grow on the shoreline — only the Queen gathers these.
    this.reeds = new Reeds(this.scene, world.pond, deriveRng(seed, 'reeds'))

    // Splash effects live on the water surface; a splash plays a sound + ripple.
    this.splashFx = new Splash(this.scene, world.pond.surfaceY)
    this.duckController = new DuckController(
      this.duck,
      this.input,
      this.cameraRig,
      world.colliders,
      world.pond,
      this.reeds,
      (x, z, strength) => {
        this.sound.splash(strength)
        this.splashFx.spawn(x, z, strength)
      },
    )

    // The duck subjects. The Flock spawns and updates them; it needs Input (to
    // hear the Queen's quack) and the Queen's Group (to know where she is).
    this.flock = new Flock(this.scene, this.input, this.duck.group, this.sound, world.pond, this.food, world.colliders, deriveRng(seed, 'flock'))

    // The rival geese — they wander, honk, forage your plants, and face off with
    // the Queen in honk-offs (which read Input + flock size, and drive the HUD meter).
    this.geese = new Geese(
      this.scene,
      this.sound,
      this.food,
      this.input,
      this.duck.group,
      this.flock,
      (active, resolve) => this.hud.setHonkOff(active, resolve),
      world.colliders,
      deriveRng(seed, 'geese'),
    )

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
    //
    // We CLAMP it to 0.1s. Normally delta is ~0.016s (60fps). But if the tab is
    // backgrounded or the game hitches, the next frame's delta can be huge —
    // which would teleport the duck a giant distance in one step (flinging her
    // off the map, or tunnelling straight through a tree before collision can
    // catch it). Capping the step keeps a hiccup from breaking the simulation.
    const delta = Math.min(this.clock.getDelta(), 0.1)

    // Move the duck first, then let the camera follow her new position.
    this.duckController.update(delta)
    this.flock.update(delta)
    this.geese.update(delta)
    this.splashFx.update(delta)
    this.cameraRig.update(delta)

    // Keep the HUD in sync (both only redraw on change).
    this.hud.setMode(this.duckController.getMode())
    this.hud.setSubjects(this.flock.subjectCount)
    this.hud.setFood(this.food.total)
    this.hud.setReeds(this.reeds.total)
    this.hud.setStolen(this.food.stolen)

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
