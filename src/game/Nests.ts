import * as THREE from 'three'
import { buildNest, addEgg, MAX_EGGS } from './nestModel'
import type { DuckSubject } from './DuckSubject'
import type { Terrain } from './terrain'
import type { NestSlice, NestsSlice } from './persistence/saveSchema'

const HATCH_TIME = 18 // seconds of brooding to incubate one egg into a duckling

/**
 * A single nest in the world: where it sits, its mesh, how many eggs it holds,
 * and whether a hen is currently brooding on it. (The eggs don't do anything yet.)
 */
export class Nest {
  readonly group: THREE.Group
  eggs = 0
  private _brooder: DuckSubject | null = null
  private readonly eggMeshes: THREE.Mesh[] = []
  private broodTime = 0 // seconds the current egg has been sat on (only while occupied)

  /** The hen currently brooding here (or walking to settle), or null. */
  get brooder(): DuckSubject | null { return this._brooder }

  /** True when a hen has claimed this nest. */
  get occupied(): boolean { return this._brooder !== null }

  /** Called by the hen when she claims this nest. */
  occupy(hen: DuckSubject): void { this._brooder = hen }

  /** Called by the hen whenever she leaves — for any reason. */
  vacate(): void { this._brooder = null }

  constructor(
    readonly x: number,
    readonly z: number,
    groundY = 0,
  ) {
    this.group = buildNest()
    this.group.position.set(x, groundY, z) // sit on the hill the Queen built it on
    this.group.rotation.y = Math.random() * Math.PI * 2 // player-driven placement, not seeded
  }

  /** Snapshot this nest: where it sits, its eggs, current brood progress, and facing. */
  toSave(): NestSlice {
    return { x: this.x, z: this.z, eggs: this.eggs, broodTime: this.broodTime, rotationY: this.group.rotation.y }
  }

  /** Rebuild a freshly-built nest's contents from a saved slice: re-add its eggs (which
   *  reconstructs the egg meshes via the normal path), restore brood progress and facing. */
  restore(s: NestSlice): void {
    this.group.rotation.y = s.rotationY
    for (let i = 0; i < s.eggs; i++) this.layEgg()
    this.broodTime = s.broodTime
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

  /** Free every mesh in the nest (bowl + any remaining eggs) after it's been
   *  taken out of the scene. Called when the Queen razes the nest. */
  dispose(): void {
    this.group.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return
      obj.geometry.dispose()
      const mat = obj.material
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
      else mat.dispose()
    })
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

  constructor(
    private readonly scene: THREE.Scene,
    private readonly terrain: Terrain,
  ) {}

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

  /** Build a fresh, empty nest on the ground at (x, z), sat on the terrain there. */
  build(x: number, z: number): Nest {
    const nest = new Nest(x, z, this.terrain.heightAt(x, z))
    this.scene.add(nest.group)
    this.all.push(nest)
    return nest
  }

  /** This nest's index in the array (for pairing a brooding hen with her nest in a save). */
  indexOf(nest: Nest): number {
    return this.all.indexOf(nest)
  }

  /** Snapshot every standing nest. */
  toSave(): NestsSlice {
    return { nests: this.all.map((nest) => nest.toSave()) }
  }

  /** Rebuild the saved nests onto a fresh (empty) Nests via the normal build path. */
  restore(slice: NestsSlice): void {
    for (const s of slice.nests) {
      const nest = this.build(s.x, s.z)
      nest.restore(s)
    }
  }

  /** Tear a nest down: drop it from the scene and free its meshes. Any eggs still
   *  in the bowl are lost. The caller rouses off a brooding hen (if any) first. */
  remove(nest: Nest): void {
    const i = this.all.indexOf(nest)
    if (i === -1) return
    this.all.splice(i, 1)
    this.scene.remove(nest.group)
    nest.dispose()
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

  /** The nearest nest of ANY kind (occupied or not) within `radius`, or null. A
   *  routed goose uses this to flee *away from* the nest it was menacing. */
  nearestNest(x: number, z: number, radius: number): Nest | null {
    return this.nearest(x, z, radius, null)
  }

  /** How many nests stand within a circular area. Bosses/biomes use this to ask
   *  whether the Queen has built an actual foothold, not merely marched through. */
  countWithin(x: number, z: number, radius: number): number {
    return this.countWhere(x, z, radius, null)
  }

  /** How many nests in an area are actively held by brooding hens. */
  occupiedWithin(x: number, z: number, radius: number): number {
    return this.countWhere(x, z, radius, true)
  }

  private nearest(x: number, z: number, radius: number, occupied: boolean | null): Nest | null {
    let best: Nest | null = null
    let bestSq = radius * radius
    for (const nest of this.all) {
      if (occupied !== null && nest.occupied !== occupied) continue
      const dSq = (nest.x - x) ** 2 + (nest.z - z) ** 2
      if (dSq < bestSq) {
        bestSq = dSq
        best = nest
      }
    }
    return best
  }

  private countWhere(x: number, z: number, radius: number, occupied: boolean | null): number {
    let n = 0
    const rSq = radius * radius
    for (const nest of this.all) {
      if (occupied !== null && nest.occupied !== occupied) continue
      const dSq = (nest.x - x) ** 2 + (nest.z - z) ** 2
      if (dSq <= rSq) n++
    }
    return n
  }
}
