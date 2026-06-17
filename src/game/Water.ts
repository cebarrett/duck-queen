import * as THREE from 'three'

/** One circular patch of water — its centre and radius. */
export interface PondCircle {
  x: number
  z: number
  radius: number
}

// A goose-held frontier pond is murkier than the Queen's clean blue water — a
// swampy green-brown — until she reclaims it and it clears back to CLEAN_WATER.
export const CLEAN_WATER = 0x3a8ee6
const ENEMY_WATER = 0x5d6b46

/**
 * The pond water. Originally a single circular disc; now it can hold SEVERAL —
 * a main pond plus a few smaller ones scattered around the world. It stays one
 * object so the rest of the game keeps asking it the same questions:
 *
 *   - surfaceY: where every water surface sits. A hair ABOVE the ground (y=0) so the
 *     two coplanar planes don't "z-fight" (flicker as the GPU can't decide which
 *     is in front).
 *   - floatLine: the y a duck's body sits at while floating — below the surface,
 *     so the waterline cuts across its middle and it looks half-submerged.
 *   - isWater(x, z): "is this spot over ANY pond?" — a cheap point-in-circle test
 *     across every patch, so swimming, floating and scenery-avoidance all just work
 *     for the extra ponds without any caller changing.
 *
 * centerX / centerZ / radius describe the MAIN pond (the first circle). Code that
 * places things on "the pond" — the reeds, the water plants, the swan — keeps using
 * those, so it all stays on the original pond near spawn.
 */
export class Pond {
  readonly surfaceY = 0.02
  readonly floatLine = -0.35

  // One Group holds every disc; World adds it to the scene once.
  readonly mesh = new THREE.Group()
  private readonly circles: PondCircle[] = []
  // Frontier discs each get their OWN material (so they can be tinted murky and
  // cleared on reclaim); we animate their opacity alongside the shared one.
  private readonly contestedMaterials: THREE.MeshStandardMaterial[] = []
  // Share one material across every (uncontested) disc — cheaper, and they all
  // look identical.
  private readonly material = new THREE.MeshStandardMaterial({
    color: CLEAN_WATER,
    transparent: true, // let the duck show through, tinted
    opacity: 0.72,
    roughness: 0.25, // a bit of sheen under the "sun"
    metalness: 0,
  })

  // A pale "shallows" ring laid at each shoreline softens the hard circle where
  // water meets ground and reads as wet. Shared across the clean ponds; contested
  // ponds get their own murkier clones (tracked so they breathe in step).
  private readonly foamMaterial = new THREE.MeshStandardMaterial({
    color: 0xeaf4ff,
    transparent: true,
    opacity: 0.5,
    roughness: 0.6,
    metalness: 0,
    depthWrite: false, // translucent decal — don't block what's behind it
  })
  private readonly contestedFoams: THREE.MeshStandardMaterial[] = []

  constructor(
    readonly centerX: number,
    readonly centerZ: number,
    readonly radius: number,
  ) {
    // The main pond is just the first circle.
    this.addCircle(centerX, centerZ, radius)
  }

  /** Add another circular pond: build its disc and register it for isWater(). */
  addCircle(x: number, z: number, radius: number): void {
    // CircleGeometry is born standing up (in the X/Y plane), so rotate it flat —
    // the same trick the ground uses.
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), this.material)
    disc.rotation.x = -Math.PI / 2
    disc.position.set(x, this.surfaceY, z)
    this.mesh.add(disc)
    this.addFoamRing(x, z, radius, this.foamMaterial)
    this.circles.push({ x, z, radius })
  }

  /** A flat ring decal hugging a pond's shoreline (a little inside the water to a
   *  little onto the bank), just above the water so it doesn't z-fight. */
  private addFoamRing(x: number, z: number, radius: number, material: THREE.Material): void {
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius - 0.4, radius + 0.5, 48), material)
    ring.rotation.x = -Math.PI / 2
    ring.position.set(x, this.surfaceY + 0.005, z)
    this.mesh.add(ring)
  }

  /** Add a CONTESTED pond (a goose-held frontier one): same as addCircle, but the
   *  disc gets its own murky material, returned so the Frontier can clear it to
   *  blue when the Queen reclaims the pond. */
  addContestedCircle(x: number, z: number, radius: number): THREE.MeshStandardMaterial {
    const mat = this.material.clone()
    mat.color.setHex(ENEMY_WATER)
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 48), mat)
    disc.rotation.x = -Math.PI / 2
    disc.position.set(x, this.surfaceY, z)
    this.mesh.add(disc)
    // A murkier foam so the contested shoreline reads as scummy, not fresh.
    const foam = this.foamMaterial.clone()
    foam.color.setHex(0x9aa37a)
    this.contestedFoams.push(foam)
    this.addFoamRing(x, z, radius, foam)
    this.circles.push({ x, z, radius })
    this.contestedMaterials.push(mat)
    return mat
  }

  /** Every water circle (the main pond first, then the extras). Lets callers that
   *  want to dress each pond — e.g. the reeds — walk all of them. */
  get patches(): readonly PondCircle[] {
    return this.circles
  }

  /** Is the point (x, z) over any pond? Cheapest possible region test: compare
   *  squared distance to squared radius (no square root needed). */
  isWater(x: number, z: number): boolean {
    for (const c of this.circles) {
      const dx = x - c.x
      const dz = z - c.z
      if (dx * dx + dz * dz < c.radius * c.radius) return true
    }
    return false
  }

  /** Would a new circle of `radius` centred at (x, z) touch any existing pond?
   *  Used when scattering the extra ponds so they don't overlap each other or the
   *  main pond. */
  overlaps(x: number, z: number, radius: number): boolean {
    for (const c of this.circles) {
      if (Math.hypot(x - c.x, z - c.z) < radius + c.radius) return true
    }
    return false
  }

  private time = 0

  update(dt: number): void {
    this.time += dt
    const opacity = 0.72 + Math.sin(this.time * 0.8) * 0.06
    this.material.opacity = opacity
    for (const mat of this.contestedMaterials) mat.opacity = opacity
    // The foam breathes too, a touch out of phase, so the shoreline feels alive.
    const foamOpacity = 0.5 + Math.sin(this.time * 0.8 + 1.0) * 0.08
    this.foamMaterial.opacity = foamOpacity
    for (const mat of this.contestedFoams) mat.opacity = foamOpacity
  }
}
