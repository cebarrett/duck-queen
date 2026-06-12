import * as THREE from 'three'
import { box } from './modelUtils'
import type { Pond } from './Water'
import { ResourcePatch, type Collectible } from './ResourcePatch'
import type { Rng } from './rng'

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
const REGROW_TIME = 30 // seconds for a foraged or stolen plant to grow back (renewable food)

/** A food plant the ducklings forage. (Alias kept so callers can name the type.) */
export type FoodItem = Collectible

/**
 * Food is a ResourcePatch of edible plants — leafy sprouts on land, lily-pads in
 * the pond. The flock's followers gather these (see DuckSubject).
 */
export class Food extends ResourcePatch {
  constructor(scene: THREE.Scene, private readonly pond: Pond, private readonly rng: Rng) {
    super(scene, REGROW_TIME)
    this.scatterLand()
    this.scatterWater()
  }

  private scatterLand(): void {
    let placed = 0
    for (let guard = 0; placed < LAND_COUNT && guard < 2000; guard++) {
      const x = (this.rng() * 2 - 1) * LAND_SPREAD
      const z = (this.rng() * 2 - 1) * LAND_SPREAD
      if (Math.hypot(x, z) < 8) continue // keep the spawn point clear
      if (this.pond.isWater(x, z)) continue // land plants don't go in the pond
      this.plant(makeLandPlant(), x, 0, z)
      placed++
    }
  }

  private scatterWater(): void {
    for (let i = 0; i < WATER_COUNT; i++) {
      const angle = this.rng() * Math.PI * 2
      const r = this.rng() * (this.pond.radius - 1.5) // inside, off the edge
      this.plant(makeWaterPlant(), this.pond.centerX + Math.cos(angle) * r, this.pond.surfaceY, this.pond.centerZ + Math.sin(angle) * r)
    }
  }

  private plant(mesh: THREE.Object3D, x: number, y: number, z: number): void {
    mesh.rotation.y = this.rng() * Math.PI * 2 // vary the facing
    this.add(mesh, x, y, z)
  }
}

// --- Plant models ------------------------------------------------------------

/** A little leafy sprout with a red berry, sitting on the ground (origin at base). */
function makeLandPlant(): THREE.Group {
  const g = new THREE.Group()
  g.add(box(0.07, 0.28, 0.07, STEM, [0, 0.14, 0])) // stem
  g.add(box(0.34, 0.22, 0.34, LEAF, [0, 0.3, 0])) // leafy top
  g.add(box(0.16, 0.14, 0.16, LEAF, [0.16, 0.24, 0.04])) // a stray leaf clump
  g.add(box(0.09, 0.09, 0.09, BERRY, [0, 0.46, 0])) // berry, the bright bit
  return g
}

/** A lily pad with a small flower, floating flat on the water (origin at surface). */
function makeWaterPlant(): THREE.Group {
  const g = new THREE.Group()
  g.add(box(0.55, 0.05, 0.55, PAD, [0, 0.03, 0])) // the flat pad
  g.add(box(0.2, 0.04, 0.2, PAD, [0.18, 0.05, 0.12])) // a second smaller pad
  g.add(box(0.12, 0.14, 0.12, FLOWER, [-0.05, 0.1, -0.05])) // flower
  return g
}
