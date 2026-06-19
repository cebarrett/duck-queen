import * as THREE from 'three'
import { disposeObject } from './modelUtils'
import type { PatchSlice } from './persistence/saveSchema'

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

  /** Current uncollected items for UI/AI that needs to know what remains in the
   *  world without being allowed to mutate the patch. */
  get available(): readonly Collectible[] {
    return this.items.filter((item) => !item.collected)
  }

  /** Spend `n` of what we've gathered (e.g. reeds to build a nest). Returns
   *  whether we could afford it; on success the total drops by `n`. */
  spend(n: number): boolean {
    if (this.count < n) return false
    this.count -= n
    return true
  }

  /** Add gathered resources that did not come from a visible patch item, such as
   *  a duck triumphantly yanking a worm out of the ground. */
  gain(n = 1): void {
    this.count += n
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

  /** A rival snatches an item: same removal as collect(), but it never credits
   *  our `total` — the food is simply denied to us. Same plant, opposite
   *  outcome — that's the whole rivalry. */
  steal(item: Collectible): void {
    if (item.collected) return
    this.harvest(item)
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

  /** Snapshot the gathered total plus any item that's diverged from a fresh patch
   *  (gathered, or mid-regrow). Items are keyed by index into the seeded scatter
   *  order, so restore() can line them back up against the regenerated patch. */
  toSave(): PatchSlice {
    const items = this.items
      .map((item, i) => ({ i, collected: item.collected, regrowTimer: item.regrowTimer ?? null }))
      .filter((s) => s.collected || s.regrowTimer !== null)
    return { total: this.count, items }
  }

  /** Apply a saved slice onto the freshly-scattered patch. The patch has already
   *  regenerated identically from the seed, so we only re-apply the divergences,
   *  mirroring what harvest() does to the mesh (hide-to-regrow vs. remove for good). */
  restore(slice: PatchSlice): void {
    this.count = slice.total
    for (const s of slice.items) {
      const item = this.items[s.i]
      if (!item) continue // index out of range (seed/schema drift) — skip safely
      item.collected = s.collected
      item.regrowTimer = s.regrowTimer ?? undefined
      if (!s.collected) continue
      if (this.regrowDelay > 0) {
        item.mesh.visible = false // a regrowing patch (Food): hidden until it grows back
      } else {
        this.scene.remove(item.mesh) // a one-shot patch (Reeds): gone for good
        disposeObject(item.mesh)
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

