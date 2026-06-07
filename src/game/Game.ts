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
import { Nests } from './Nests'
import { HUD } from './HUD'
import { deriveRng } from './rng'

// The default world seed. A given seed always generates the same layout; pass
// ?seed=123 in the URL to try another one.
const DEFAULT_WORLD_SEED = 20260606
const RESOLVE_SHAKEN_TIME = 20
const RESOLVE_SHAKEN_PENALTY = 0.15
const REGROUP_RADIUS = 5
const REGROUP_CLEAR_RATIO = 0.6
const NEST_COST = 10 // reeds spent to build one nest
const SEAT_RANGE = 3 // how close the Queen must stand to a nest to seat a hen on it
const SCARE_RANGE = 4 // a goose this close to a brooding hen scares her off (and grabs an egg)

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
  private readonly nests: Nests
  private wasBuildDown = false // edge-detect the B key (one nest per press)
  private wasSeatDown = false // edge-detect the E key (one hen seated per press)
  private resolveShakenTimer = 0

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
    // Nests the Queen builds by spending reeds (they don't do anything yet).
    this.nests = new Nests(this.scene)

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
      world.pond,
      this.nests,
      this.input,
      this.duck.group,
      this.flock,
      (active, resolve) => this.hud.setHonkOff(active, resolve),
      (gooseX, gooseZ) => this.handleQueenLostHonkOff(gooseX, gooseZ),
      () => this.resolvePenalty(),
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
    this.updateResolveShaken(delta)
    this.geese.update(delta)
    this.updateNestDefense()
    this.updateHatching(delta)
    this.splashFx.update(delta)
    this.hud.update(delta)
    this.cameraRig.update(delta)
    this.handleNestBuild()
    this.handleNestSeat()

    // Keep the HUD in sync (both only redraw on change).
    this.hud.setMode(this.duckController.getMode())
    this.hud.setSubjects(this.flock.subjectBreakdown)
    this.hud.setFood(this.food.total)
    this.hud.setReeds(this.reeds.total)
    this.hud.setStolen(this.food.stolen)
    this.hud.setNests(this.nests.count)

    this.renderer.render(this.scene, this.camera)
  }

  /**
   * Nest building: when the Queen has enough reeds and is on dry ground, the HUD
   * invites her to press B; pressing it spends the reeds and drops a nest at her
   * feet. The prompt only shows when it'll work, so the control teaches itself.
   */
  private handleNestBuild(): void {
    // "On land" = waddle mode (not swimming the pond, not airborne).
    const canBuild = this.duckController.getMode() === 'waddle' && this.reeds.total >= NEST_COST
    this.hud.setCanBuildNest(canBuild)

    const down = this.input.isDown('KeyB')
    if (down && !this.wasBuildDown && canBuild && this.reeds.spend(NEST_COST)) {
      const pos = this.duck.group.position
      this.nests.build(pos.x, pos.z)
      this.sound.nestBuilt()
      this.hud.showMessage('🪺 Nest built!')
    }
    this.wasBuildDown = down
  }

  /**
   * Seating a hen: when the Queen stands by an empty nest and has a hen in her
   * flock, the HUD invites her to press E; pressing it sends the nearest hen off
   * to brood on that nest. Like building, the prompt only shows when it'll work.
   */
  private handleNestSeat(): void {
    const pos = this.duck.group.position
    const nest = this.nests.nearestEmpty(pos.x, pos.z, SEAT_RANGE)
    const hen = nest ? this.flock.nearestFollowingHen(nest.x, nest.z) : null
    this.hud.setCanSeatHen(nest !== null && hen !== null)

    const down = this.input.isDown('KeyE')
    if (down && !this.wasSeatDown && nest && hen) {
      hen.assignToNest(nest)
      this.sound.henQuack() // a contented settling cluck
      this.hud.showMessage('🥚 A hen settles in')
    }
    this.wasSeatDown = down
  }

  /**
   * Hatching: any nest that's been brooded long enough turns one egg into a new
   * duckling, who pops out at the nest and joins the flock. That's the payoff for
   * building nests, seating hens, and keeping the geese off them.
   */
  private updateHatching(delta: number): void {
    for (const nest of this.nests.collectHatches(delta)) {
      this.flock.hatchAt(nest.x, nest.z)
      this.sound.peep() // a newborn cheep
      this.hud.showMessage('🐣 An egg hatched!')
    }
  }

  /**
   * Nest defence: a goose that wanders too close to a brooding hen scares her off
   * the nest AND filches an egg from it. That's the incentive to patrol and honk
   * geese away — leave them near your nests and they'll plunder your eggs.
   */
  private updateNestDefense(): void {
    for (const hen of this.flock.nestingHens) {
      const pos = hen.group.position
      const goose = this.geese.nearestGoose(pos.x, pos.z)
      if (!goose || goose.dist > SCARE_RANGE) continue

      const nest = hen.nest
      hen.spookFromNest(goose.x, goose.z)
      if (nest && nest.takeEgg()) {
        this.sound.honk() // the goose honks, triumphant
        this.hud.showMessage('🪿 A goose raided the nest!')
      }
    }
  }

  private handleQueenLostHonkOff(gooseX: number, gooseZ: number): void {
    this.duckController.startPanicFlee(gooseX, gooseZ)
    this.flock.scatterFrom(gooseX, gooseZ)
    this.resolveShakenTimer = RESOLVE_SHAKEN_TIME
    this.hud.showMessage('OUT-HONKED!')
    this.hud.setResolveShaken(true)
  }

  private resolvePenalty(): number {
    return this.resolveShakenTimer > 0 ? RESOLVE_SHAKEN_PENALTY : 0
  }

  private updateResolveShaken(delta: number): void {
    if (this.resolveShakenTimer <= 0) {
      this.hud.setResolveShaken(false)
      return
    }
    this.resolveShakenTimer = Math.max(0, this.resolveShakenTimer - delta)
    if (this.flock.subjectCount > 0 && this.flock.regroupedRatio(REGROUP_RADIUS) >= REGROUP_CLEAR_RATIO) {
      this.resolveShakenTimer = 0
    }
    this.hud.setResolveShaken(this.resolveShakenTimer > 0)
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
