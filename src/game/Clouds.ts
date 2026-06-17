import * as THREE from 'three'
import { box } from './modelUtils'
import type { Rng } from './rng'

// Blocky clouds drift slowly across the sky, high above the play area. They give
// the sky life and a sense of scale (handy when flying) while staying on-style:
// each cloud is a little cluster of flattened white boxes.
const COUNT = 10
const SPREAD = 220 // half-width of the band clouds drift across (x and z)
const MIN_Y = 42
const MAX_Y = 62
const PUFF_COLORS = [0xffffff, 0xf2f4f8]

interface Cloud {
  group: THREE.Group
  speed: number // world units/sec along +X
}

/**
 * Clouds owns a Group of drifting cloud clusters. Game adds the group to the
 * scene once and calls update(delta) each frame. Placement comes from the seeded
 * 'clouds' rng so the sky is identical for a given seed; the drift itself is just
 * a per-frame transform (no allocation), and each cloud wraps back to the far
 * side once it sails past the edge.
 */
export class Clouds {
  readonly group = new THREE.Group()
  private readonly clouds: Cloud[] = []

  constructor(rng: Rng) {
    for (let i = 0; i < COUNT; i++) {
      const cloud = makeCloud(rng)
      const x = (rng() * 2 - 1) * SPREAD
      const z = (rng() * 2 - 1) * SPREAD
      const y = MIN_Y + rng() * (MAX_Y - MIN_Y)
      cloud.position.set(x, y, z)
      this.group.add(cloud)
      this.clouds.push({ group: cloud, speed: 0.8 + rng() * 1.0 })
    }
  }

  update(delta: number): void {
    for (const c of this.clouds) {
      c.group.position.x += c.speed * delta
      // Sail off one edge, reappear on the other (z held, so its lane is stable).
      if (c.group.position.x > SPREAD) c.group.position.x = -SPREAD
    }
  }
}

/** A single cloud: a handful of flattened white box puffs clustered together. */
function makeCloud(rng: Rng): THREE.Group {
  const g = new THREE.Group()
  const puffs = 4 + Math.floor(rng() * 4) // 4..7
  for (let i = 0; i < puffs; i++) {
    const w = 5 + rng() * 7
    const h = 1.6 + rng() * 1.6
    const d = 4 + rng() * 5
    const color = PUFF_COLORS[Math.floor(rng() * PUFF_COLORS.length)]
    const px = (rng() * 2 - 1) * 6
    const py = (rng() * 2 - 1) * 1.2
    const pz = (rng() * 2 - 1) * 4
    const puff = box(w, h, d, color, [px, py, pz])
    // Clouds float far above and shouldn't drop flickering shadows on the play
    // area, nor catch them — keep them out of the shadow pass entirely.
    puff.castShadow = false
    puff.receiveShadow = false
    g.add(puff)
  }
  return g
}
