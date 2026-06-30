import * as THREE from 'three'
import { box } from './modelUtils'
import type { Pond } from './Water'
import type { Terrain } from './terrain'
import { ResourcePatch } from './ResourcePatch'
import { type Rng, rngRange } from './rng'
import { Wind } from './Wind'

const STALK = 0x6fae3c // reed green
const STALK2 = 0x8fbf4a // a lighter green, for variety
const CATTAIL = 0x7a5230 // brown cattail head

const REEDS_PER_RADIUS = 1.6 // shoreline density (the main pond: 16 reeds, radius 10)

/**
 * Reeds grow in a band around every pond's shoreline (some just in the shallows,
 * some on the bank). They're gathered ONLY by the Duck Queen — the ducklings
 * ignore them — and are the material for building nests. Each pond gets a fringe
 * scaled to its size, so the smaller extra ponds get proportionally fewer reeds.
 */
export class Reeds extends ResourcePatch {
  constructor(scene: THREE.Scene, pond: Pond, terrain: Terrain, rng: Rng, wind: Wind) {
    super(scene)
    // Walk every water patch (the main pond first, then the extras). Doing the
    // main pond first with the same per-reed draws keeps its layout unchanged.
    for (const patch of pond.patches) {
      const count = Math.round(REEDS_PER_RADIUS * patch.radius)
      for (let i = 0; i < count; i++) {
        const angle = rng() * Math.PI * 2
        // A ring hugging the shoreline: from just inside the water to just onto land.
        const r = patch.radius + rngRange(rng, -1.5, 2.5)
        const x = patch.x + Math.cos(angle) * r
        const z = patch.z + Math.sin(angle) * r
        const clump = makeReedClump()
        clump.rotation.y = rng() * Math.PI * 2
        // Reeds stand up from the shoreline; on the bank they ride the terrain (in
        // the water the pond's flat zone keeps the ground near 0).
        this.add(clump, x, terrain.heightAt(x, z), z)
        // The clump's origin is at its base, so a z-lean reads as the whole reed
        // bowing in the wind. (Wind drops it automatically if the Queen harvests it.)
        wind.register(clump, 0.06, Wind.phaseFor(x, z))
      }
    }
  }
}

/** A little clump of tall reeds with a cattail — a few thin stalks, slightly fanned. */
function makeReedClump(): THREE.Group {
  const g = new THREE.Group()
  const stalk = (h: number, color: number, x: number, z: number, tilt: number) => {
    const m = box(0.06, h, 0.06, color, [x, h / 2, z])
    m.rotation.z = tilt // lean it a touch so the clump isn't stiff
    g.add(m)
    return m
  }
  stalk(1.1, STALK, 0, 0, 0.05)
  stalk(0.9, STALK2, 0.12, 0.05, -0.12)
  stalk(1.0, STALK, -0.1, -0.06, 0.14)

  // A brown cattail head near the top of the tallest stalk.
  g.add(box(0.1, 0.26, 0.1, CATTAIL, [0.02, 1.0, 0]))
  return g
}
