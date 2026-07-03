import * as THREE from 'three'
import { Pond } from './Water'
import type { FrontierPond } from './Frontier'
import { rngRange, type Rng } from './rng'
import type { Collider } from './collision'
import { TREATY_FLATS, BIOME_DEFS, type BiomeKind, type BiomeMap } from './Biomes'
import type { Terrain } from './terrain'
import { Wind } from './Wind'
import type { WorldSlice } from './persistence/saveSchema'
import { box } from './modelUtils'

// A calm sky blue and a grassy green. Defined once so the sky, the fog, and the
// hemisphere light can all share the same palette (keeps everything cohesive).
const SKY_COLOR = 0x8ec9ff
const GROUND_COLOR = 0x88bb55
const DAY_SECONDS = 180
const NIGHT_SECONDS = 180
const FULL_DAY_SECONDS = DAY_SECONDS + NIGHT_SECONDS
const CELESTIAL_DISTANCE = 120

interface SkyTexture {
  texture: THREE.CanvasTexture
  paint: (palette: SkyPalette) => void
}

interface SkyPalette {
  top: THREE.ColorRepresentation
  horizon: THREE.ColorRepresentation
  lower: THREE.ColorRepresentation
  fog: THREE.ColorRepresentation
}

/**
 * World builds the environment: the ground, the sky/background, fog, lights,
 * water, scenery, and the cosmetic day/night clock. World generation still
 * happens once from seeded RNG streams; update() only animates visual state.
 */
export class World {
  // Filled in by addScenery(); the DuckController reads this to block movement.
  readonly colliders: Collider[] = []

  // The pond — a short waddle ahead of spawn (-Z). The duck controller and the
  // flock subjects read this to know where they can swim.
  readonly pond = new Pond(0, -26, 10)

  // The outlying ponds the geese hold — Act III's contestable territory. Recorded
  // here (with each disc's tint handle) as they're generated, for the Frontier.
  readonly frontierPonds: FrontierPond[] = []

  private readonly skyTexture: SkyTexture
  private readonly scene: THREE.Scene
  private readonly hemi: THREE.HemisphereLight
  private readonly sun: THREE.DirectionalLight
  private readonly moon: THREE.DirectionalLight
  private readonly sunBlock: THREE.Sprite
  private readonly moonBlock: THREE.Sprite
  private readonly fogColor = new THREE.Color(SKY_COLOR)
  private timeOfDay = DAY_SECONDS * 0.25 // begin in a bright, welcoming morning

  constructor(
    scene: THREE.Scene,
    rng: Rng,
    pondRng: Rng,
    private readonly terrain: Terrain,
    tintRng: Rng,
    private readonly wind: Wind,
    private readonly biomes: BiomeMap,
  ) {
    this.scene = scene
    this.skyTexture = makeSkyGradient()
    this.addSky(scene)
    const lights = this.addLights(scene)
    this.hemi = lights.hemi
    this.sun = lights.sun
    this.moon = lights.moon
    const celestials = this.addCelestials(scene)
    this.sunBlock = celestials.sun
    this.moonBlock = celestials.moon
    // Lay out the water FIRST: ponds (and the spawn clearing + Treaty arena) are
    // the regions that must stay level, so register them as flat zones before the
    // hills are raised under everything else. The fen pools draw from the same
    // pond stream AFTER the frontier ponds, so those keep their per-seed layout.
    this.addTreatyFlatsWater()
    this.addExtraPonds(pondRng)
    this.addFenPools(pondRng)
    scene.add(this.pond.mesh)
    this.registerFlatZones()
    this.addGround(scene, tintRng)
    this.addTreatyFlatsDressing(scene, rng)
    this.addScenery(scene, rng)
    this.update(0)
  }

  /** Keep the playable, water-bearing and arena areas level so the flat water
   *  discs aren't swallowed by a hill and the spawn clearing stays a calm, even
   *  start. Everywhere else the terrain rolls. */
  private registerFlatZones(): void {
    // The spawn clearing, easing into the hills over a comfortable margin.
    this.terrain.flatten(0, 0, 10, 16)
    // Every pond — flat out a little past each shoreline so the bank rises gently.
    for (const c of this.pond.patches) this.terrain.flatten(c.x, c.z, c.radius + 3, 6)
    // The Treaty Flats live up to their name: a level arena for the boss.
    this.terrain.flatten(TREATY_FLATS.x, TREATY_FLATS.z, TREATY_FLATS.radius, 8)
  }

  /** Day and night each last about three minutes. For now this is cosmetic: it
   *  tints the sky/fog and changes light levels without moving any gameplay
   *  state or world-generation placement. Keeping the clock here gives later
   *  gameplay systems one world-time source to read from. */
  update(delta: number): void {
    this.timeOfDay = (this.timeOfDay + delta) % FULL_DAY_SECONDS
    const phase = this.timeOfDay / FULL_DAY_SECONDS
    const sunWave = Math.sin(phase * Math.PI * 2)
    const sunHeight = THREE.MathUtils.clamp(sunWave, 0, 1)
    const moonHeight = THREE.MathUtils.clamp(-sunWave, 0, 1)
    const twilight = 1 - smoothBand(Math.abs(sunWave), 0.03, 0.35)
    const day = smoothBand(sunHeight, 0.02, 0.45)
    const night = smoothBand(moonHeight, 0.02, 0.45)

    const palette = this.makePalette(day, twilight, night)
    this.skyTexture.paint(palette)

    this.fogColor.set(palette.fog)
    if (this.sceneFog) this.sceneFog.color.copy(this.fogColor)
    if (this.scene.background instanceof THREE.Color) this.scene.background.copy(this.fogColor)

    this.hemi.color.copy(new THREE.Color(0x5d7ec8).lerp(new THREE.Color(SKY_COLOR), day))
    this.hemi.groundColor.copy(new THREE.Color(0x334c3f).lerp(new THREE.Color(GROUND_COLOR), day))
    this.hemi.intensity = THREE.MathUtils.lerp(0.42, 1.0, day) + twilight * 0.08

    this.sun.intensity = THREE.MathUtils.lerp(0.08, 2.05, day)
    this.sun.color.copy(new THREE.Color(0xff9a5e).lerp(new THREE.Color(0xfff4e0), Math.max(day, 0.15)))
    this.moon.intensity = THREE.MathUtils.lerp(0.18, 0.72, night)

    this.positionCelestials(phase)
  }

  toSave(): WorldSlice {
    return { timeOfDay: this.timeOfDay }
  }

  restore(slice: WorldSlice): void {
    this.timeOfDay = normalizeTimeOfDay(slice.timeOfDay)
    this.update(0)
  }

  /** The Treaty Flats are visible from the beginning, but their boss remains
   *  dormant until the Marsh Baron is broken. The water is registered as a pond
   *  before random scenery scatters, so movement, swimming, reeds and collision
   *  avoidance all treat it like a real biome rather than painted backdrop. */
  private addTreatyFlatsWater(): void {
    this.pond.addCircle(TREATY_FLATS.x, TREATY_FLATS.z, TREATY_FLATS.pondRadius)
  }

  /**
   * A few smaller ponds dotted around the world, in addition to the main one near
   * spawn. They're "placed objects", so their spots come from the SEEDED rng (same
   * seed → same ponds). We keep them in a mid-distance ring around spawn — out of
   * the immediate starting area and the geese's corridor to the north (-Z) — and
   * reject any that would overlap an existing pond. Because the Pond's isWater()
   * now covers every circle, these are instantly swimmable: the Queen, the flock
   * and the geese all float on them with no other code change.
   */
  private addExtraPonds(rng: Rng): void {
    const TARGET = 3 // a few more
    const MARGIN = 6 // clear gap to leave between ponds
    let made = 0
    for (let guard = 0; made < TARGET && guard < 300; guard++) {
      const x = (rng() * 2 - 1) * 75
      const z = -36 + rng() * 111 // z in [-36, 75]: around + in front of spawn, not the -Z geese corridor
      const radius = 5 + rng() * 4 // 5..9 — smaller than the main pond (10)
      const dist = Math.hypot(x, z)
      if (dist < 22 || dist > 75) continue // keep the spawn area open; don't get lost in the fog
      if (this.pond.overlaps(x, z, radius + MARGIN)) continue // no overlaps
      // These outlying ponds are the contestable frontier: each gets its own
      // (murky) water material so it can be cleared to blue when reclaimed. Drawing
      // them this way doesn't touch the rng draws above, so the layout per seed is
      // unchanged.
      const tint = this.pond.addContestedCircle(x, z, radius)
      this.frontierPonds.push({ pond: { x, z, radius }, tint })
      made++
    }
  }

  /**
   * The Old Fen is dotted with tiny pools — real, swimmable water, so the fen
   * plays differently: the Queen and her flock can paddle puddle to puddle, and
   * the reeds fringe them like any other shoreline. A couple are placed near
   * each fen region's heart, from the same seeded pond stream (drawn after the
   * frontier ponds so those layouts are untouched per seed).
   */
  private addFenPools(rng: Rng): void {
    const POOLS_PER_FEN = 2
    for (const site of this.biomes.sites) {
      if (site.kind !== 'fen') continue
      let made = 0
      for (let guard = 0; made < POOLS_PER_FEN && guard < 40; guard++) {
        const x = site.x + (rng() * 2 - 1) * 16
        const z = site.z + (rng() * 2 - 1) * 16
        const radius = rngRange(rng, 2.5, 4)
        if (Math.hypot(x, z) < 20) continue // never crowd the spawn clearing
        if (Math.hypot(x - TREATY_FLATS.x, z - TREATY_FLATS.z) < TREATY_FLATS.radius + 4) continue
        if (this.pond.overlaps(x, z, radius + 4)) continue
        this.pond.addCircle(x, z, radius)
        made++
      }
    }
  }

  private get sceneFog(): THREE.Fog | null {
    return this.scene.fog instanceof THREE.Fog ? this.scene.fog : null
  }

  private addSky(scene: THREE.Scene): void {
    // A flat fallback colour behind everything (seen only if the dome below ever
    // fails to draw).
    scene.background = new THREE.Color(SKY_COLOR)

    // Fog fades distant objects toward a colour. Using the SKY colour makes the
    // ground melt into the horizon instead of ending at a hard edge — cozy, and
    // it hides the far edge of our finite ground plane. Fog(color, near, far):
    // fully clear before `near`, fully fogged past `far`.
    scene.fog = new THREE.Fog(SKY_COLOR, 30, 140)

    // A big inward-facing dome painted with a vertical gradient — a deeper blue
    // overhead easing to the pale fog colour at the horizon — so the sky reads
    // with depth instead of one flat wash. fog:false keeps the dome itself from
    // being fogged out (it sits well past the fog's far distance), and matching
    // its horizon band to the fog colour preserves the "ground melts into the
    // sky" trick. depthWrite:false + renderOrder -1 draw it behind everything.
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(500, 32, 16),
      new THREE.MeshBasicMaterial({
        map: this.skyTexture.texture,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      }),
    )
    sky.renderOrder = -1
    sky.frustumCulled = false // centred on origin, the camera is always inside it
    scene.add(sky)
  }

  private addLights(scene: THREE.Scene): {
    hemi: THREE.HemisphereLight
    sun: THREE.DirectionalLight
    moon: THREE.DirectionalLight
  } {
    // HemisphereLight = soft, directionless ambient light: sky colour from
    // above, ground colour bounced from below. It fills shadows so nothing is
    // pure black, but it's too flat on its own to show an object's shape.
    const hemi = new THREE.HemisphereLight(SKY_COLOR, GROUND_COLOR, 1.0)
    scene.add(hemi)

    // DirectionalLight = parallel rays from one direction, like the sun. This
    // is what gives boxes a bright side and a dim side so they read as 3D.
    // Its `position` only sets the *direction* the light comes from.
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.0)
    sun.position.set(8, 15, 6)
    sun.castShadow = true
    sun.shadow.mapSize.width = 2048
    sun.shadow.mapSize.height = 2048
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 200
    sun.shadow.camera.left = -70
    sun.shadow.camera.right = 70
    sun.shadow.camera.top = 70
    sun.shadow.camera.bottom = -70
    scene.add(sun)

    const moon = new THREE.DirectionalLight(0x9fb8ff, 0.25)
    moon.position.set(-8, 15, -6)
    scene.add(moon)

    return { hemi, sun, moon }
  }

  private addCelestials(scene: THREE.Scene): { sun: THREE.Sprite; moon: THREE.Sprite } {
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeSunTexture(),
      transparent: true,
      fog: false,
      depthWrite: false,
      toneMapped: false,
    }))
    sun.scale.set(9, 9, 1)

    const moon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeMoonTexture(),
      transparent: true,
      fog: false,
      depthWrite: false,
      toneMapped: false,
    }))
    moon.scale.set(7, 7, 1)

    for (const body of [sun, moon]) {
      body.renderOrder = -0.5
      body.frustumCulled = false
      scene.add(body)
    }
    return { sun, moon }
  }

  private positionCelestials(phase: number): void {
    const angle = phase * Math.PI * 2
    const x = Math.cos(angle) * CELESTIAL_DISTANCE
    const y = Math.sin(angle) * CELESTIAL_DISTANCE
    const z = 16
    this.sun.position.set(x, y, z)
    this.moon.position.set(-x, -y, -z)
    this.sunBlock.position.copy(this.sun.position)
    this.moonBlock.position.copy(this.moon.position)
    this.sunBlock.visible = y > -8
    this.moonBlock.visible = -y > -8
  }

  private makePalette(day: number, twilight: number, night: number): SkyPalette {
    const top = new THREE.Color(0x18284d).lerp(new THREE.Color(0x3f86dd), day).lerp(new THREE.Color(0x6c5aa0), twilight * 0.45)
    const horizon = new THREE.Color(0x28405f).lerp(new THREE.Color(SKY_COLOR), day).lerp(new THREE.Color(0xff9f73), twilight * 0.42)
    const lower = new THREE.Color(0x415a72).lerp(new THREE.Color(0xc4e2ff), day).lerp(new THREE.Color(0xf7c184), twilight * 0.35)
    const fog = new THREE.Color(0x31445a).lerp(new THREE.Color(SKY_COLOR), day).lerp(new THREE.Color(0xd89172), twilight * 0.28)
    if (night > 0.65) {
      horizon.lerp(new THREE.Color(0x354d76), (night - 0.65) / 0.35)
      fog.lerp(new THREE.Color(0x394b63), (night - 0.65) / 0.35)
    }
    return {
      top: top.getHex(),
      horizon: horizon.getHex(),
      lower: lower.getHex(),
      fog: fog.getHex(),
    }
  }

  private addGround(scene: THREE.Scene, tintRng: Rng): void {
    // A plane is created lying in the X/Y plane (facing the camera). We rotate
    // it -90° around X so it lies flat in X/Z with "up" (+Y) as its normal —
    // i.e. a floor. Math.PI/2 radians = 90°. We subdivide it finely (120×120 over
    // 300 units → ~2.5u spacing) so the rolling hills displace smoothly.
    const geometry = new THREE.PlaneGeometry(300, 300, 120, 120)
    // Raise the floor into gentle hills from the seeded terrain, then paint it
    // with smooth patches of each biome's ground palette via vertex colours —
    // meadow greens easing into prairie gold, fen mud, tor sage, amber russet.
    // Both are deterministic per seed.
    displaceToTerrain(geometry, this.terrain)
    applyGroundTint(geometry, tintRng, this.biomes)
    // MeshStandardMaterial is a physically-based material: it RESPONDS to light
    // (unlike the cube's old MeshNormalMaterial). With no lights it'd be black —
    // that's the classic "why is everything black?" beginner footgun, which is
    // exactly why we added lights above first. vertexColors mixes in our per-
    // vertex tints.
    const material = new THREE.MeshStandardMaterial({ vertexColors: true })
    const ground = new THREE.Mesh(geometry, material)
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)
  }

  /** Old Fenna-era border country: windgrass, treaty posts, pale feathers, and a
   *  half-sunk stone that makes the Flats read as a place with history. */
  private addTreatyFlatsDressing(scene: THREE.Scene, rng: Rng): void {
    const x = TREATY_FLATS.x
    const z = TREATY_FLATS.z
    const r = TREATY_FLATS.radius

    const meadowMat = new THREE.MeshStandardMaterial({ color: 0x9bbf65, roughness: 0.9 })
    const meadow = new THREE.Mesh(new THREE.CircleGeometry(r, 64), meadowMat)
    meadow.rotation.x = -Math.PI / 2
    meadow.position.set(x, 0.012, z)
    meadow.receiveShadow = true
    scene.add(meadow)

    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xb5b0a0, roughness: 0.8 })
    const darkStoneMat = new THREE.MeshStandardMaterial({ color: 0x74766f, roughness: 0.9 })
    const postMat = new THREE.MeshStandardMaterial({ color: 0x7a5230 })
    const featherMat = new THREE.MeshStandardMaterial({ color: 0xf2efe5 })
    const grassMats = [
      new THREE.MeshStandardMaterial({ color: 0xb7c36b }),
      new THREE.MeshStandardMaterial({ color: 0x86a957 }),
      new THREE.MeshStandardMaterial({ color: 0xd0c178 }),
    ]

    const treatyStone = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.75, 1.2), darkStoneMat)
    treatyStone.position.set(x - 3.5, 0.34, z - 2.5)
    treatyStone.rotation.y = -0.35
    treatyStone.castShadow = true
    treatyStone.receiveShadow = true
    scene.add(treatyStone)
    this.colliders.push({ x: x - 3.5, z: z - 2.5, radius: 1.4, yMin: 0, yMax: 0.8 })

    for (let i = 0; i < 8; i++) {
      const t = i / 7
      const px = x - r * 0.85 + t * r * 1.7
      const pz = z + Math.sin(t * Math.PI * 2) * 2.2
      const post = boxMesh(postMat, 0.2, 1.8, 0.2, px, 0.9, pz)
      post.castShadow = true
      scene.add(post)

      const feather = boxMesh(featherMat, 0.16, 0.55, 0.08, px + 0.05, 1.95, pz)
      feather.rotation.z = t % 2 === 0 ? 0.35 : -0.35
      feather.castShadow = true
      scene.add(feather)
    }

    for (let i = 0; i < 42; i++) {
      const a = rng() * Math.PI * 2
      const radius = TREATY_FLATS.pondRadius + 2 + rng() * (r - TREATY_FLATS.pondRadius - 3)
      const gx = x + Math.cos(a) * radius
      const gz = z + Math.sin(a) * radius
      const h = 0.8 + rng() * 1.3
      const mat = grassMats[i % grassMats.length]
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.09, h, 0.09), mat)
      blade.position.set(gx, h / 2, gz)
      blade.rotation.z = (rng() - 0.5) * 0.45
      blade.rotation.y = rng() * Math.PI
      blade.castShadow = true
      scene.add(blade)
      this.wind.register(blade, 0.08, Wind.phaseFor(gx, gz)) // windgrass sways in the breeze
    }

    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.25
      const sx = x + Math.cos(a) * (r * 0.72)
      const sz = z + Math.sin(a) * (r * 0.72)
      const s = 0.8 + rng() * 0.55
      const stone = boxMesh(stoneMat, s * 1.4, s * 0.55, s, sx, s * 0.23, sz)
      stone.rotation.y = rng() * Math.PI
      stone.castShadow = true
      stone.receiveShadow = true
      scene.add(stone)
      this.colliders.push({ x: sx, z: sz, radius: s * 0.65, yMin: 0, yMax: s * 0.55 })
    }
  }

  /**
   * Scatter blocky trees and rocks so you can judge height, distance, and speed
   * — a flat plane gives your eye nothing to measure against. Tall trees double
   * as altitude markers when you're flying.
   *
   * WHAT grows at a spot — and how likely anything is to grow there at all —
   * comes from the biome map: oaks in the meadow, dense pale birches in the
   * Birchwood, pines and boulders on the Stony Tors, dead snags in the Old Fen,
   * flame-coloured canopies in the Amberwood, lone oaks and scrub out on the
   * open prairie.
   */
  private addScenery(scene: THREE.Scene, rng: Rng): void {
    // `rng` is seeded from the one world seed (see rng.ts / Game), so the scenery
    // layout is identical for a given seed.
    const ATTEMPTS = 170
    const SPREAD = 120 // half-width of the area we scatter over (ground is 300)

    for (let i = 0; i < ATTEMPTS; i++) {
      // A random spot in a square. rng() returns 0..1, so (rng()*2-1) is -1..1.
      const x = (rng() * 2 - 1) * SPREAD
      const z = (rng() * 2 - 1) * SPREAD

      // Keep a clear circle around the spawn point so nothing lands on the Queen.
      if (Math.hypot(x, z) < 10) continue
      // Keep the Treaty Flats legible as a distinct region and playable boss arena.
      if (Math.hypot(x - TREATY_FLATS.x, z - TREATY_FLATS.z) < TREATY_FLATS.radius + 4) continue
      // Don't grow trees/rocks in the water.
      if (this.pond.isWater(x, z)) continue

      // Sparse biomes (the open prairie) leave most spots empty; woods take most.
      const def = BIOME_DEFS[this.biomes.kindAt(x, z)]
      if (rng() >= def.sceneryDensity) continue

      // Sit each piece on the hill under it: its base starts at the terrain
      // height, and its colliders' y-ranges shift up with it so collision still
      // lines up with where it's actually drawn.
      const base = this.terrain.heightAt(x, z)

      if (rng() < def.treeChance) this.spawnTree(scene, def.kind, x, z, base, rng)
      else this.spawnRock(scene, def.kind, x, z, base, rng)
    }
  }

  /** Grow this biome's kind of tree at (x, z), sitting on terrain height `base`. */
  private spawnTree(scene: THREE.Scene, kind: BiomeKind, x: number, z: number, base: number, rng: Rng): void {
    switch (kind) {
      case 'birchwood':
        this.spawnBirch(scene, x, z, base, rng)
        break
      case 'tors':
        this.spawnPine(scene, x, z, base, rng)
        break
      case 'fen':
        this.spawnSnag(scene, x, z, base, rng)
        break
      case 'prairie':
        // The open prairie is mostly scrub, with the odd grand lone oak.
        if (rng() < 0.6) this.spawnScrub(scene, x, z, base, rng)
        else this.spawnLeafyTree(scene, x, z, base, rng, PRAIRIE_CANOPY, { grand: true })
        break
      case 'amberwood':
        this.spawnLeafyTree(scene, x, z, base, rng, AMBER_CANOPY, { leafLitter: true })
        break
      default:
        this.spawnLeafyTree(scene, x, z, base, rng, MEADOW_CANOPY)
    }
  }

  /** The classic tree — a trunk box with a leafy cube on top. The canopy palette
   *  varies by biome (meadow greens, amber flame); `grand` grows the prairie's
   *  lone oaks bigger, `leafLitter` drops an autumn leaf-mat at the foot. */
  private spawnLeafyTree(
    scene: THREE.Scene,
    x: number,
    z: number,
    base: number,
    rng: Rng,
    canopyColors: readonly number[],
    opts?: { grand?: boolean; leafLitter?: boolean },
  ): void {
    const trunkH = opts?.grand ? 3.5 + rng() * 2 : 2.5 + rng() * 3.5
    const leaf = opts?.grand ? 2.8 + rng() * 1.4 : 2 + rng() * 1.8
    const leafCenterY = base + trunkH + leaf * 0.35
    const color = canopyColors[Math.abs(Math.round(x * 7.3 + z * 11.7)) % canopyColors.length]
    scene.add(box(0.6, trunkH, 0.6, TRUNK_BROWN, [x, base + trunkH / 2, z]))
    const canopy = box(leaf, leaf, leaf, color, [x, leafCenterY, z])
    scene.add(canopy)
    this.wind.register(canopy, 0.03, Wind.phaseFor(x, z)) // leaves stir gently in the breeze

    // Two colliders: a thin trunk (so you can walk right up to it) and the
    // wider canopy up at leaf height (so you bonk it only while flying through).
    this.colliders.push({ x, z, radius: 0.4, yMin: base, yMax: base + trunkH })
    this.colliders.push({
      x,
      z,
      radius: leaf * 0.45,
      yMin: leafCenterY - leaf / 2,
      yMax: leafCenterY + leaf / 2,
    })

    if (opts?.leafLitter) {
      // A mat of fallen leaves under the canopy — pure decoration, no collider.
      const w = 1.4 + rng() * 1.2
      const litter = box(w, 0.08, w, LEAF_LITTER, [x, base + 0.05, z])
      litter.rotation.y = rng() * Math.PI
      litter.castShadow = false
      scene.add(litter)
    }
  }

  /** A pale birch: slim white trunk with dark bark ticks, a light double canopy. */
  private spawnBirch(scene: THREE.Scene, x: number, z: number, base: number, rng: Rng): void {
    const trunkH = 3.5 + rng() * 2
    const leaf = 1.6 + rng() * 1.2
    scene.add(box(0.45, trunkH, 0.45, BIRCH_BARK, [x, base + trunkH / 2, z]))
    // Two dark ticks so the trunk reads as birch, not plain white.
    scene.add(box(0.5, 0.16, 0.5, BIRCH_TICK, [x, base + trunkH * 0.3, z]))
    scene.add(box(0.5, 0.16, 0.5, BIRCH_TICK, [x, base + trunkH * 0.62, z]))

    const color = BIRCH_CANOPY[Math.abs(Math.round(x * 7.3 + z * 11.7)) % BIRCH_CANOPY.length]
    const canopyY = base + trunkH + leaf * 0.28
    const canopy = box(leaf, leaf * 0.8, leaf, color, [x, canopyY, z])
    scene.add(canopy)
    const crown = box(leaf * 0.55, leaf * 0.45, leaf * 0.55, color, [x, canopyY + leaf * 0.55, z])
    scene.add(crown)
    this.wind.register(canopy, 0.035, Wind.phaseFor(x, z))
    this.wind.register(crown, 0.045, Wind.phaseFor(x, z) + 0.6)

    this.colliders.push({ x, z, radius: 0.3, yMin: base, yMax: base + trunkH })
    this.colliders.push({
      x,
      z,
      radius: leaf * 0.45,
      yMin: canopyY - leaf * 0.4,
      yMax: canopyY + leaf * 0.85,
    })
  }

  /** A tor pine: short trunk with three stacked, shrinking dark tiers. */
  private spawnPine(scene: THREE.Scene, x: number, z: number, base: number, rng: Rng): void {
    const trunkH = 1.6 + rng() * 1.2
    const w0 = 2.1 + rng()
    const color = PINE_GREENS[Math.abs(Math.round(x * 7.3 + z * 11.7)) % PINE_GREENS.length]
    scene.add(box(0.5, trunkH, 0.5, PINE_TRUNK, [x, base + trunkH / 2, z]))

    let y = base + trunkH + 0.35
    let w = w0
    let top: THREE.Mesh | null = null
    for (let tier = 0; tier < 3; tier++) {
      top = box(w, 0.85, w, color, [x, y, z])
      scene.add(top)
      y += 0.72
      w *= 0.68
    }
    if (top) this.wind.register(top, 0.04, Wind.phaseFor(x, z)) // only the crown sways

    this.colliders.push({ x, z, radius: 0.35, yMin: base, yMax: base + trunkH })
    this.colliders.push({ x, z, radius: w0 * 0.42, yMin: base + trunkH, yMax: y })
  }

  /** A fen snag: a leaning dead trunk with a stub branch, sometimes moss-capped. */
  private spawnSnag(scene: THREE.Scene, x: number, z: number, base: number, rng: Rng): void {
    const trunkH = 1.8 + rng() * 1.4
    const w = 0.5 + rng() * 0.2
    const trunk = box(w, trunkH, w, SNAG_WOOD, [x, base + trunkH / 2, z])
    trunk.rotation.z = (rng() - 0.5) * 0.16 // dead wood leans
    trunk.rotation.y = rng() * Math.PI
    scene.add(trunk)

    const branch = box(0.8, 0.16, 0.16, SNAG_WOOD, [x + 0.45, base + trunkH * 0.72, z])
    branch.rotation.z = 0.35
    scene.add(branch)

    if (rng() < 0.5) {
      scene.add(box(w + 0.18, 0.16, w + 0.18, SNAG_MOSS, [x, base + trunkH + 0.06, z]))
    }
    this.colliders.push({ x, z, radius: 0.4, yMin: base, yMax: base + trunkH })
  }

  /** A prairie scrub bush: a squat dry-green clump, low enough to hop onto. */
  private spawnScrub(scene: THREE.Scene, x: number, z: number, base: number, rng: Rng): void {
    const s = 0.9 + rng() * 0.6
    const bush = box(s, s * 0.6, s, SCRUB_GREEN, [x, base + s * 0.3, z])
    bush.rotation.y = rng() * Math.PI
    scene.add(bush)
    const side = box(s * 0.6, s * 0.4, s * 0.6, SCRUB_DRY, [x + s * 0.45, base + s * 0.2, z])
    scene.add(side)
    this.wind.register(bush, 0.02, Wind.phaseFor(x, z))
    this.colliders.push({ x, z, radius: s * 0.5, yMin: base, yMax: base + s * 0.6 })
  }

  /** A rock in this biome's stone: squat everywhere, but on the Stony Tors they
   *  run bigger and sometimes stack into a little cairn — the tors themselves. */
  private spawnRock(scene: THREE.Scene, kind: BiomeKind, x: number, z: number, base: number, rng: Rng): void {
    const color = ROCK_COLORS[kind]
    const big = kind === 'tors'
    const s = (big ? 1.3 : 1) + rng() * (big ? 2.2 : 2)
    const rock = box(s, s * 0.7, s, color, [x, base + s * 0.25, z])
    rock.rotation.y = rng() * Math.PI
    scene.add(rock)
    this.colliders.push({ x, z, radius: s * 0.5, yMin: base, yMax: base + s * 0.6 })

    if (big && rng() < 0.45) {
      const s2 = s * 0.55
      const cap = box(s2, s2 * 0.8, s2, color, [x, base + s * 0.7 + s2 * 0.3, z])
      cap.rotation.y = rng() * 0.8
      scene.add(cap)
      this.colliders.push({
        x,
        z,
        radius: s2 * 0.5,
        yMin: base + s * 0.6,
        yMax: base + s * 0.7 + s2 * 0.7,
      })
    }
  }
}

// --- Biome scenery palettes ----------------------------------------------------
// One material per colour is shared automatically via modelUtils' box() cache.
const TRUNK_BROWN = 0x8a5a2b
const MEADOW_CANOPY = [0x3f7d34, 0x4a8c2f, 0x355e2a, 0x527a35, 0x2e6b28] as const
const AMBER_CANOPY = [0xc9642f, 0xd98a33, 0xb44f2a, 0xd9a441] as const
const PRAIRIE_CANOPY = [0x6f8f3a, 0x7d9a41, 0x8aa03f] as const
const BIRCH_CANOPY = [0x9ac86a, 0xa8d178, 0x8bbf5e] as const
const BIRCH_BARK = 0xe8e4d4
const BIRCH_TICK = 0x4b463c
const PINE_GREENS = [0x2c6136, 0x2f6b40, 0x28573a] as const
const PINE_TRUNK = 0x6e4a26
const SNAG_WOOD = 0x584a35
const SNAG_MOSS = 0x6f7d40
const SCRUB_GREEN = 0x8f9a44
const SCRUB_DRY = 0x7d8b3c
const LEAF_LITTER = 0xa65f26
const ROCK_COLORS: Record<BiomeKind, number> = {
  meadow: 0x8b929c,
  birchwood: 0x8b929c,
  prairie: 0xa89a76,
  tors: 0x9aa2ac,
  fen: 0x707c62,
  amberwood: 0x8d8071,
}

/** Paint a vertical gradient onto a tiny canvas and hand it back as a texture for
 *  the sky dome: overhead colour (canvas top -> dome top) easing through the
 *  fog colour at the horizon (canvas middle -> dome equator) to a pale band below. */
function makeSkyGradient(): SkyTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const paint = (palette: SkyPalette): void => {
    const grad = ctx.createLinearGradient(0, 0, 0, 256)
    grad.addColorStop(0.0, colorCss(palette.top))
    grad.addColorStop(0.5, colorCss(palette.horizon))
    grad.addColorStop(0.62, colorCss(palette.lower))
    grad.addColorStop(1.0, colorCss(palette.lower))
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    tex.needsUpdate = true
  }
  paint({
    top: 0x3f86dd,
    horizon: SKY_COLOR,
    lower: 0xc4e2ff,
    fog: SKY_COLOR,
  })
  return { texture: tex, paint }
}

function smoothBand(value: number, low: number, high: number): number {
  return THREE.MathUtils.smoothstep(value, low, high)
}

function normalizeTimeOfDay(value: number): number {
  if (!Number.isFinite(value)) return DAY_SECONDS * 0.25
  return ((value % FULL_DAY_SECONDS) + FULL_DAY_SECONDS) % FULL_DAY_SECONDS
}

function colorCss(color: THREE.ColorRepresentation): string {
  return `#${new THREE.Color(color).getHexString()}`
}

function makeSunTexture(): THREE.CanvasTexture {
  return makePixelTexture((ctx) => {
    ctx.fillStyle = '#ffdf55'
    ctx.fillRect(2, 2, 12, 12)
    ctx.fillStyle = '#ffe978'
    ctx.fillRect(5, 5, 6, 6)
  })
}

function makeMoonTexture(): THREE.CanvasTexture {
  return makePixelTexture((ctx) => {
    ctx.fillStyle = '#d8e2ff'
    ctx.fillRect(3, 3, 10, 10)
    ctx.fillRect(2, 5, 12, 6)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.fillRect(8, 3, 5, 10)
    ctx.fillRect(7, 5, 7, 6)
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#eef3ff'
    ctx.fillRect(4, 4, 3, 3)
  })
}

function makePixelTexture(draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 16
  canvas.height = 16
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  draw(ctx)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.NearestFilter
  tex.minFilter = THREE.NearestFilter
  tex.needsUpdate = true
  return tex
}

/** Raise a (flat, X/Y) ground plane into the terrain's hills by pushing each
 *  vertex out along its local +Z — which becomes world +Y (height) once the mesh
 *  is rotated flat. The plane lies in X/Y, and rotating it -90° about X maps a
 *  local vertex (x, y) to world (x, height, -y); so the world spot under it is
 *  (x, -y), and that's where we sample the terrain. Normals are recomputed so the
 *  hillsides catch the light. */
function displaceToTerrain(geometry: THREE.PlaneGeometry, terrain: Terrain): void {
  const pos = geometry.attributes.position
  for (let v = 0; v < pos.count; v++) {
    pos.setZ(v, terrain.heightAt(pos.getX(v), -pos.getY(v)))
  }
  pos.needsUpdate = true
  geometry.computeVertexNormals()
}

/** Tint a (flat) ground plane's vertices with smooth patches of each biome's
 *  ground palette. Builds a coarse grid of tints — each node samples the biome
 *  blend under it, picking a palette entry per contributing biome and mixing by
 *  weight — and bilinearly blends them per vertex, so the colour drifts in soft
 *  patches AND crossfades where regions meet. */
function applyGroundTint(geometry: THREE.PlaneGeometry, rng: Rng, biomes: BiomeMap): void {
  const G = 16 // coarse tint grid (G+1 nodes per side)
  const grid: THREE.Color[] = []
  const swatch = new THREE.Color()
  for (let iy = 0; iy <= G; iy++) {
    for (let ix = 0; ix <= G; ix++) {
      // The node's spot in the world: plane local (x, y) → world (x, -y) once
      // the mesh is rotated flat (same mapping as displaceToTerrain).
      const worldX = -150 + (ix / G) * 300
      const worldZ = -(-150 + (iy / G) * 300)
      const pick = rng() // one shared palette-index draw, reused across the blend
      const jitter = 0.92 + rng() * 0.12 // small brightness jitter so even same-colour nodes differ
      const node = new THREE.Color(0, 0, 0)
      biomes.eachWeight(worldX, worldZ, (kind, weight) => {
        const palette = BIOME_DEFS[kind].ground
        swatch.setHex(palette[Math.floor(pick * palette.length)])
        node.r += swatch.r * weight
        node.g += swatch.g * weight
        node.b += swatch.b * weight
      })
      grid.push(node.multiplyScalar(jitter))
    }
  }

  const pos = geometry.attributes.position
  const colors = new Float32Array(pos.count * 3)
  const top = new THREE.Color()
  const bot = new THREE.Color()
  for (let v = 0; v < pos.count; v++) {
    // The plane spans [-150,150] in x and y (before it's rotated flat). Map to [0,1].
    const gx = ((pos.getX(v) + 150) / 300) * G
    const gy = ((pos.getY(v) + 150) / 300) * G
    const x0 = Math.min(Math.floor(gx), G - 1)
    const y0 = Math.min(Math.floor(gy), G - 1)
    const fx = gx - x0
    const fy = gy - y0
    const row = (y0 + 0) * (G + 1) + x0
    const row2 = (y0 + 1) * (G + 1) + x0
    top.copy(grid[row]).lerp(grid[row + 1], fx)
    bot.copy(grid[row2]).lerp(grid[row2 + 1], fx)
    top.lerp(bot, fy)
    colors[v * 3] = top.r
    colors[v * 3 + 1] = top.g
    colors[v * 3 + 2] = top.b
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

/** Make a box mesh of a given size at a position, reusing the passed material. */
function boxMesh(
  material: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  m.position.set(x, y, z)
  return m
}
