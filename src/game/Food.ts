import * as THREE from 'three'
import type { Pond } from './Water'

// Plant palette — greens distinct from the grass/trees, plus bright accents so a
// plant is easy to spot (and to aim a flock at).
const LEAF = 0x7ac943
const STEM = 0x4a7d2a
const BERRY = 0xe23b3b
const PAD = 0x4aa05a
const FLOWER = 0xff9ecb

const LAND_COUNT = 18
const WATER_COUNT = 8
const LAND_SPREAD = 100 // half-width of the area land plants scatter over

/** One edible plant. The ducks read its x/z and `collected` flag; collecting it
 *  removes the mesh and bumps the counter. */
export interface FoodItem {
  x: number
  z: number
  mesh: THREE.Object3D
  inWater: boolean
  collected: boolean
}

/**
 * Food owns every plant in the world: it builds + scatters them, and offers the
 * two things the ducks need — find the nearest uncollected plant near a point,
 * and collect one. `total` is how many the flock has gathered (for the HUD).
 */
export class Food {
  readonly items: FoodItem[] = []
  private collectedCount = 0

  constructor(
    private readonly scene: THREE.Scene,
    private readonly pond: Pond,
  ) {
    this.scatterLand()
    this.scatterWater()
  }

  get total(): number {
    return this.collectedCount
  }

  /** The closest uncollected plant within `radius` of (x, z), or null. A plain
   *  O(n) scan — fine for a few dozen plants. */
  nearestUncollected(x: number, z: number, radius: number): FoodItem | null {
    let best: FoodItem | null = null
    let bestSq = radius * radius
    for (const item of this.items) {
      if (item.collected) continue
      const dSq = (item.x - x) ** 2 + (item.z - z) ** 2
      if (dSq < bestSq) {
        bestSq = dSq
        best = item
      }
    }
    return best
  }

  /** Eat a plant: mark it collected, remove + free its mesh, bump the count. The
   *  `collected` guard means if two ducks reach the same plant, only one scores. */
  collect(item: FoodItem): void {
    if (item.collected) return
    item.collected = true
    this.scene.remove(item.mesh)
    disposeObject(item.mesh)
    this.collectedCount++
  }

  private scatterLand(): void {
    let placed = 0
    for (let guard = 0; placed < LAND_COUNT && guard < 2000; guard++) {
      const x = (Math.random() * 2 - 1) * LAND_SPREAD
      const z = (Math.random() * 2 - 1) * LAND_SPREAD
      if (Math.hypot(x, z) < 8) continue // keep the spawn point clear
      if (this.pond.isWater(x, z)) continue // land plants don't go in the pond
      this.add(x, z, false)
      placed++
    }
  }

  private scatterWater(): void {
    for (let i = 0; i < WATER_COUNT; i++) {
      // A random spot inside the pond, kept off the very edge.
      const angle = Math.random() * Math.PI * 2
      const r = Math.random() * (this.pond.radius - 1.5)
      this.add(this.pond.centerX + Math.cos(angle) * r, this.pond.centerZ + Math.sin(angle) * r, true)
    }
  }

  private add(x: number, z: number, inWater: boolean): void {
    const mesh = inWater ? makeWaterPlant() : makeLandPlant()
    mesh.position.set(x, inWater ? this.pond.surfaceY : 0, z)
    mesh.rotation.y = Math.random() * Math.PI * 2 // vary the facing
    this.scene.add(mesh)
    this.items.push({ x, z, mesh, inWater, collected: false })
  }
}

// --- Plant models (each builds its own geometry/material so disposing one on
//     collect can't free anything another plant is using) ---------------------

function box(w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color }))
  m.position.set(x, y, z)
  return m
}

/** A little leafy sprout with a red berry, sitting on the ground (origin at base). */
function makeLandPlant(): THREE.Group {
  const g = new THREE.Group()
  g.add(box(0.07, 0.28, 0.07, STEM, 0, 0.14, 0)) // stem
  g.add(box(0.34, 0.22, 0.34, LEAF, 0, 0.3, 0)) // leafy top
  g.add(box(0.16, 0.14, 0.16, LEAF, 0.16, 0.24, 0.04)) // a stray leaf clump
  g.add(box(0.09, 0.09, 0.09, BERRY, 0, 0.46, 0)) // berry, the bright bit
  return g
}

/** A lily pad with a small flower, floating flat on the water (origin at surface). */
function makeWaterPlant(): THREE.Group {
  const g = new THREE.Group()
  g.add(box(0.55, 0.05, 0.55, PAD, 0, 0.03, 0)) // the flat pad
  g.add(box(0.2, 0.04, 0.2, PAD, 0.18, 0.05, 0.12)) // a second smaller pad
  g.add(box(0.12, 0.14, 0.12, FLOWER, -0.05, 0.1, -0.05)) // flower
  return g
}

/** Free a removed plant's GPU resources (geometry + material) so they don't leak. */
function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else if (mat) mat.dispose()
  })
}
