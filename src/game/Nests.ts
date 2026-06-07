import * as THREE from 'three'
import { buildNest } from './nestModel'

/**
 * Nests owns the nests the player has built. For now it just spawns and counts
 * them — they don't DO anything yet — but keeping it as its own little system
 * gives a clean home for whatever nests grow into later (resting, hatching, …).
 */
export class Nests {
  private built = 0

  constructor(private readonly scene: THREE.Scene) {}

  /** How many nests stand in the world (for the HUD). */
  get count(): number {
    return this.built
  }

  /** Drop a fresh nest on the ground at (x, z). Placement is player-driven during
   *  play, not world generation, so a Math.random spin here is fine (not seeded). */
  build(x: number, z: number): void {
    const nest = buildNest()
    nest.position.set(x, 0, z)
    nest.rotation.y = Math.random() * Math.PI * 2
    this.scene.add(nest)
    this.built++
  }
}
