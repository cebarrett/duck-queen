import * as THREE from 'three'
import { buildNest, addEgg, MAX_EGGS } from './nestModel'

const HATCH_TIME = 18 // seconds of brooding to incubate one egg into a duckling

/**
 * A single nest in the world: where it sits, its mesh, how many eggs it holds,
 * and whether a hen is currently brooding on it. (The eggs don't do anything yet.)
 */
export class Nest {
  readonly group: THREE.Group
  eggs = 0
  occupied = false
  private readonly eggMeshes: THREE.Mesh[] = []
  private broodTime = 0 // seconds the current egg has been sat on (only while occupied)

  constructor(
    readonly x: number,
    readonly z: number,
  ) {
    this.group = buildNest()
    this.group.position.set(x, 0, z)
    this.group.rotation.y = Math.random() * Math.PI * 2 // player-driven placement, not seeded
  }

  /** Lay one more egg into the bowl, up to the nest's capacity. */
  layEgg(): void {
    if (this.eggs >= MAX_EGGS) return
    this.eggMeshes.push(addEgg(this.group, this.eggs))
    this.eggs++
  }

  /** A goose filches the most recent egg. Returns whether there was one to take. */
  takeEgg(): boolean {
    return this.removeEgg()
  }

  /** Advance incubation while a hen is brooding. Returns true when an egg has been
   *  sat on long enough to hatch (and consumes it — the caller turns it into a
   *  duckling). Incubation only runs while occupied, so a goose scaring the hen off
   *  pauses it; progress is kept, so re-seating her resumes where she left off. */
  incubate(delta: number): boolean {
    if (!this.occupied || this.eggs === 0) return false
    this.broodTime += delta
    if (this.broodTime < HATCH_TIME) return false
    this.broodTime -= HATCH_TIME // carry the remainder toward the next egg
    this.removeEgg() // the egg becomes a duckling — gone from the bowl
    return true
  }

  /** Remove the most recent egg (mesh + count). Shared by theft and hatching. */
  private removeEgg(): boolean {
    const egg = this.eggMeshes.pop()
    if (!egg) return false
    this.group.remove(egg)
    egg.geometry.dispose()
    const mat = egg.material
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else mat.dispose()
    this.eggs--
    return true
  }
}

/**
 * Nests owns every nest the player has built. A hen can brood on one and slowly
 * lay eggs; beyond that they don't DO anything yet — but this is the clean home
 * for whatever they grow into later.
 */
export class Nests {
  readonly all: Nest[] = []

  constructor(private readonly scene: THREE.Scene) {}

  /** How many nests stand in the world. */
  get count(): number {
    return this.all.length
  }

  /** Total eggs laid across all nests (for the HUD). */
  get eggCount(): number {
    let n = 0
    for (const nest of this.all) n += nest.eggs
    return n
  }

  /** Build a fresh, empty nest on the ground at (x, z). */
  build(x: number, z: number): Nest {
    const nest = new Nest(x, z)
    this.scene.add(nest.group)
    this.all.push(nest)
    return nest
  }

  /** Advance incubation on every nest and return those that hatched an egg this
   *  frame, so the caller can spawn a duckling at each. */
  collectHatches(delta: number): Nest[] {
    const hatched: Nest[] = []
    for (const nest of this.all) if (nest.incubate(delta)) hatched.push(nest)
    return hatched
  }

  /** The nearest unoccupied nest within `radius` of (x, z), or null. */
  nearestEmpty(x: number, z: number, radius: number): Nest | null {
    return this.nearest(x, z, radius, false)
  }

  /** The nearest OCCUPIED nest (a brooding hen sitting on it) within `radius`, or
   *  null. Geese use this to hunt down nesting hens. */
  nearestOccupied(x: number, z: number, radius: number): Nest | null {
    return this.nearest(x, z, radius, true)
  }

  private nearest(x: number, z: number, radius: number, occupied: boolean): Nest | null {
    let best: Nest | null = null
    let bestSq = radius * radius
    for (const nest of this.all) {
      if (nest.occupied !== occupied) continue
      const dSq = (nest.x - x) ** 2 + (nest.z - z) ** 2
      if (dSq < bestSq) {
        bestSq = dSq
        best = nest
      }
    }
    return best
  }
}
