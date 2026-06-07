import * as THREE from 'three'

/** One collectible thing (a food plant, a reed, …) sitting in the world. */
export interface Collectible {
  x: number
  z: number
  mesh: THREE.Object3D
  collected: boolean
  regrowTimer?: number // seconds until a harvested item grows back (regrowing patches only)
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
  private stolenCount = 0

  /** `regrowDelay` > 0 makes harvested items grow back after that many seconds
   *  (Food); 0 means once gathered they're gone for good (Reeds). */
  constructor(
    protected readonly scene: THREE.Scene,
    private readonly regrowDelay = 0,
  ) {}

  /** How many WE have gathered (for the HUD). */
  get total(): number {
    return this.count
  }

  /** How many a rival (a goose) has taken — food we never got. */
  get stolen(): number {
    return this.stolenCount
  }

  /** Spend `n` of what we've gathered (e.g. reeds to build a nest). Returns
   *  whether we could afford it; on success the total drops by `n`. */
  spend(n: number): boolean {
    if (this.count < n) return false
    this.count -= n
    return true
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
    this.harvest(item)
    this.count++
  }

  /** A rival snatches an item: same removal as collect(), but it counts against
   *  us (toward `stolen`) instead of crediting our `total`. Same plant, opposite
   *  outcome — that's the whole rivalry. */
  steal(item: Collectible): void {
    if (item.collected) return
    this.harvest(item)
    this.stolenCount++
  }

  /** Take an item out of play. On a regrowing patch it's just hidden and scheduled
   *  to grow back; otherwise it's removed from the scene and freed for good. */
  private harvest(item: Collectible): void {
    item.collected = true
    if (this.regrowDelay > 0) {
      item.mesh.visible = false
      item.regrowTimer = this.regrowDelay
    } else {
      this.scene.remove(item.mesh)
      disposeObject(item.mesh)
    }
  }

  /** Tick regrowth: a harvested item reappears (collectable again) once its delay
   *  elapses. A no-op on patches that don't regrow. */
  update(delta: number): void {
    if (this.regrowDelay <= 0) return
    for (const item of this.items) {
      if (item.regrowTimer === undefined) continue
      item.regrowTimer -= delta
      if (item.regrowTimer <= 0) {
        item.collected = false
        item.mesh.visible = true
        item.regrowTimer = undefined
      }
    }
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
