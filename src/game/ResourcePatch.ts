import * as THREE from 'three'

/** One collectible thing (a food plant, a reed, …) sitting in the world. */
export interface Collectible {
  x: number
  z: number
  mesh: THREE.Object3D
  collected: boolean
}

/**
 * A patch of collectibles. Holds the items, finds the nearest uncollected one
 * near a point, and collects one (removing + freeing its mesh) while counting the
 * total. Food and Reeds are both just a ResourcePatch that scatters its own kind
 * of plant — the only differences are the model, where they grow, and who's
 * allowed to gather them (which lives in the gatherer, not here).
 */
export class ResourcePatch {
  readonly items: Collectible[] = []
  private count = 0

  constructor(protected readonly scene: THREE.Scene) {}

  /** How many have been gathered (for the HUD). */
  get total(): number {
    return this.count
  }

  /** The closest uncollected item within `radius` of (x, z), or null. Plain O(n)
   *  scan — fine for a few dozen items. */
  nearestUncollected(x: number, z: number, radius: number): Collectible | null {
    let best: Collectible | null = null
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

  /** Gather an item: mark it collected, remove + free its mesh, bump the count.
   *  The `collected` guard means two gatherers can't both score the same item. */
  collect(item: Collectible): void {
    if (item.collected) return
    item.collected = true
    this.scene.remove(item.mesh)
    disposeObject(item.mesh)
    this.count++
  }

  /** Subclasses call this to drop a built mesh into the world at (x, y, z) and
   *  register it as collectible. */
  protected add(mesh: THREE.Object3D, x: number, y: number, z: number): void {
    mesh.position.set(x, y, z)
    this.scene.add(mesh)
    this.items.push({ x, z, mesh, collected: false })
  }
}

/** Free a removed item's GPU resources (geometry + material) so they don't leak. */
function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const mat = mesh.material
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else if (mat) mat.dispose()
  })
}
