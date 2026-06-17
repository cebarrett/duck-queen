import * as THREE from 'three'
import { Pond } from './Water'
import type { FrontierPond } from './Frontier'
import type { Rng } from './rng'
import type { Collider } from './collision'
import { TREATY_FLATS } from './Biomes'
import { Wind } from './Wind'

// A calm sky blue and a grassy green. Defined once so the sky, the fog, and the
// hemisphere light can all share the same palette (keeps everything cohesive).
const SKY_COLOR = 0x8ec9ff
const GROUND_COLOR = 0x88bb55

/**
 * World builds the static environment: the ground, the sky/background, fog,
 * and the lights. It doesn't animate anything, so it has no update() — it just
 * adds its objects to the Scene it's handed in the constructor.
 */
export class World {
  // Filled in by addScenery(); the DuckController reads this to block movement.
  readonly colliders: Collider[] = []

  // The pond — a short waddle ahead of spawn (-Z). The duck controller and the
  // ducklings read this to know where they can swim.
  readonly pond = new Pond(0, -26, 10)

  // The outlying ponds the geese hold — Act III's contestable territory. Recorded
  // here (with each disc's tint handle) as they're generated, for the Frontier.
  readonly frontierPonds: FrontierPond[] = []

  constructor(scene: THREE.Scene, rng: Rng, pondRng: Rng, terrainRng: Rng, private readonly wind: Wind) {
    this.addSky(scene)
    this.addLights(scene)
    this.addGround(scene, terrainRng)
    // Scatter the extra ponds BEFORE the scenery so trees/rocks avoid them too.
    this.addTreatyFlatsWater()
    this.addExtraPonds(pondRng)
    scene.add(this.pond.mesh)
    this.addTreatyFlatsDressing(scene, rng)
    this.addScenery(scene, rng)
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
        map: makeSkyGradient(),
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      }),
    )
    sky.renderOrder = -1
    sky.frustumCulled = false // centred on origin, the camera is always inside it
    scene.add(sky)
  }

  private addLights(scene: THREE.Scene): void {
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
  }

  private addGround(scene: THREE.Scene, terrainRng: Rng): void {
    // A plane is created lying in the X/Y plane (facing the camera). We rotate
    // it -90° around X so it lies flat in X/Z with "up" (+Y) as its normal —
    // i.e. a floor. Math.PI/2 radians = 90°. We subdivide it (60×60) so we have
    // vertices to tint.
    const geometry = new THREE.PlaneGeometry(300, 300, 60, 60)
    // Mottle the floor with smooth patches of slightly varied greens via vertex
    // colours, so it reads as gentle terrain instead of one flat wash. The plane
    // stays perfectly FLAT (no height displacement), so collision/floorHeightAt
    // are untouched. Tints come from the seeded 'terrain' stream, so the mottling
    // is identical for a given seed.
    applyGroundTint(geometry, terrainRng)
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
   */
  private addScenery(scene: THREE.Scene, rng: Rng): void {
    // `rng` is seeded from the one world seed (see rng.ts / Game), so the scenery
    // layout is identical for a given seed.

    // Share ONE material per type instead of making a fresh one for every
    // object. Identical materials can be reused, and it keeps the GPU happy once
    // there are lots of objects — a good habit to start now.
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b })
    const leafMats = [
      new THREE.MeshStandardMaterial({ color: 0x3f7d34 }),
      new THREE.MeshStandardMaterial({ color: 0x4a8c2f }),
      new THREE.MeshStandardMaterial({ color: 0x355e2a }),
      new THREE.MeshStandardMaterial({ color: 0x527a35 }),
      new THREE.MeshStandardMaterial({ color: 0x2e6b28 }),
    ]
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8b929c })

    const COUNT = 70
    const SPREAD = 120 // half-width of the area we scatter over (ground is 300)

    for (let i = 0; i < COUNT; i++) {
      // A random spot in a square. rng() returns 0..1, so (rng()*2-1) is -1..1.
      const x = (rng() * 2 - 1) * SPREAD
      const z = (rng() * 2 - 1) * SPREAD

      // Keep a clear circle around the spawn point so nothing lands on the Queen.
      if (Math.hypot(x, z) < 10) continue
      // Keep the Treaty Flats legible as a distinct biome and playable boss arena.
      if (Math.hypot(x - TREATY_FLATS.x, z - TREATY_FLATS.z) < TREATY_FLATS.radius + 4) continue
      // Don't grow trees/rocks in the pond.
      if (this.pond.isWater(x, z)) continue

      if (rng() < 0.7) {
        // Tree = a trunk box with a leafy box on top; sizes varied a little so
        // they're not all identical.
        const trunkH = 2.5 + rng() * 3.5
        const leaf = 2 + rng() * 1.8
        const leafCenterY = trunkH + leaf * 0.35
        const leafMat = leafMats[Math.abs(Math.round(x * 7.3 + z * 11.7)) % leafMats.length]
        const trunk = boxMesh(trunkMat, 0.6, trunkH, 0.6, x, trunkH / 2, z)
        trunk.castShadow = true
        trunk.receiveShadow = true
        scene.add(trunk)
        const canopy = boxMesh(leafMat, leaf, leaf, leaf, x, leafCenterY, z)
        canopy.castShadow = true
        scene.add(canopy)
        this.wind.register(canopy, 0.03, Wind.phaseFor(x, z)) // leaves stir gently in the breeze

        // Two colliders: a thin trunk (so you can walk right up to it) and the
        // wider canopy up at leaf height (so you bonk it only while flying through).
        this.colliders.push({ x, z, radius: 0.4, yMin: 0, yMax: trunkH })
        this.colliders.push({
          x,
          z,
          radius: leaf * 0.45,
          yMin: leafCenterY - leaf / 2,
          yMax: leafCenterY + leaf / 2,
        })
      } else {
        // Rock = a squat block sitting low to the ground.
        const s = 1 + rng() * 2
        const rock = boxMesh(rockMat, s, s * 0.7, s, x, s * 0.25, z)
        rock.castShadow = true
        rock.receiveShadow = true
        scene.add(rock)
        this.colliders.push({ x, z, radius: s * 0.5, yMin: 0, yMax: s * 0.6 })
      }
    }
  }
}

/** Paint a vertical gradient onto a tiny canvas and hand it back as a texture for
 *  the sky dome: deep blue overhead (canvas top → dome top) easing through the
 *  fog colour at the horizon (canvas middle → dome equator) to a pale band below. */
function makeSkyGradient(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 2
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const grad = ctx.createLinearGradient(0, 0, 0, 256)
  grad.addColorStop(0.0, '#3f86dd') // straight overhead — deeper blue
  grad.addColorStop(0.5, '#8ec9ff') // the horizon band — matches the fog colour
  grad.addColorStop(0.62, '#c4e2ff') // just below the horizon — pale (mostly hidden by the ground)
  grad.addColorStop(1.0, '#e8f3ff')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Tint a (flat) ground plane's vertices with smooth patches of varied greens.
 *  Builds a coarse grid of random tints from the seeded rng and bilinearly
 *  blends them per vertex, so the colour drifts in soft patches rather than
 *  per-vertex static. */
function applyGroundTint(geometry: THREE.PlaneGeometry, rng: Rng): void {
  const GREENS = [0x7fae4c, 0x8ec25a, 0x9bbf65].map((c) => new THREE.Color(c))
  const G = 12 // coarse tint grid (G+1 nodes per side)
  const grid: THREE.Color[] = []
  for (let i = 0; i < (G + 1) * (G + 1); i++) {
    const base = GREENS[Math.floor(rng() * GREENS.length)].clone()
    base.multiplyScalar(0.92 + rng() * 0.12) // small brightness jitter so even same-green nodes differ
    grid.push(base)
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
