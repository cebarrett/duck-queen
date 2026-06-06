import * as THREE from 'three'
import { Goose } from './Goose'
import type { Sound } from './Sound'

const GOOSE_COUNT = 3
const AREA_CENTER_Z = -50 // out past the pond (which sits at z = -26)
const AREA_RADIUS = 12

/**
 * Geese owns the rival geese: spawns them and updates them each frame. Game just
 * calls geese.update(delta). Later phases add the honk-off here (it'll need the
 * Queen's position, the flock size, and Input).
 */
export class Geese {
  private readonly geese: Goose[] = []

  constructor(scene: THREE.Scene, sound: Sound) {
    for (let i = 0; i < GOOSE_COUNT; i++) {
      // Cluster them out past the far side of the pond, so you meet them by roaming.
      const angle = Math.random() * Math.PI * 2
      const radius = Math.random() * AREA_RADIUS
      const goose = new Goose(Math.cos(angle) * radius, AREA_CENTER_Z + Math.sin(angle) * radius, sound)
      this.geese.push(goose)
      scene.add(goose.group)
    }
  }

  update(delta: number): void {
    for (const goose of this.geese) {
      goose.update(delta)
    }
  }
}
