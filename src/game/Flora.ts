import * as THREE from 'three'
import { box } from './modelUtils'
import type { Pond } from './Water'
import type { Rng } from './rng'
import { Wind } from './Wind'
import { TREATY_FLATS } from './Biomes'

// Little blocky grass tufts and occasional flowers dotted across the play area —
// they give the ground texture and pops of cozy colour, and they sway in the
// breeze (see Wind). Purely decorative: no colliders, so you walk straight
// through them. Placement is seeded ('flora' stream), so the meadow is identical
// for a given seed.
const COUNT = 140
const SPREAD = 100 // half-width of the area to scatter over
const FLOWER_CHANCE = 0.18

const BLADE_GREENS = [0x86a957, 0xb7c36b, 0x77a24a]
const FLOWER_CAPS = [0xff9ecb, 0xffe066, 0xff9e6b]
const FLOWER_STEM = 0x5a7d33

/**
 * Flora scatters grass tufts and flowers onto the land. Built once in the
 * constructor; the swaying tufts register with the shared Wind. It avoids the
 * pond, the spawn circle, and the Treaty Flats so those stay legible.
 */
export class Flora {
  constructor(scene: THREE.Scene, pond: Pond, wind: Wind, rng: Rng) {
    let placed = 0
    for (let guard = 0; placed < COUNT && guard < 4000; guard++) {
      const x = (rng() * 2 - 1) * SPREAD
      const z = (rng() * 2 - 1) * SPREAD
      if (Math.hypot(x, z) < 6) continue // keep the spawn point clear
      if (pond.isWater(x, z)) continue // grass doesn't grow in the pond
      // Keep the Treaty Flats reading as its own windgrass meadow.
      if (Math.hypot(x - TREATY_FLATS.x, z - TREATY_FLATS.z) < TREATY_FLATS.radius + 2) continue

      const mesh = rng() < FLOWER_CHANCE ? makeFlower(rng) : makeTuft(rng)
      mesh.position.set(x, 0, z)
      mesh.rotation.y = rng() * Math.PI * 2
      scene.add(mesh)
      // Origin at the base, so a z-lean bends it from the ground like real grass.
      wind.register(mesh, 0.10, Wind.phaseFor(x, z))
      placed++
    }
  }
}

/** A tuft of a few short, thin grass blades fanned out from a shared base. */
function makeTuft(rng: Rng): THREE.Group {
  const g = new THREE.Group()
  const blades = 3 + Math.floor(rng() * 2) // 3..4
  for (let i = 0; i < blades; i++) {
    const h = 0.3 + rng() * 0.4
    const color = BLADE_GREENS[Math.floor(rng() * BLADE_GREENS.length)]
    const bx = (rng() * 2 - 1) * 0.14
    const bz = (rng() * 2 - 1) * 0.14
    const blade = box(0.05, h, 0.05, color, [bx, h / 2, bz])
    blade.rotation.z = (rng() * 2 - 1) * 0.25 // a little fan
    blade.castShadow = false // too small to cast a meaningful shadow — skip the work
    blade.receiveShadow = false
    g.add(blade)
  }
  return g
}

/** A single flower: a slim stem with a bright blocky cap. */
function makeFlower(rng: Rng): THREE.Group {
  const g = new THREE.Group()
  const h = 0.4 + rng() * 0.3
  const stem = box(0.05, h, 0.05, FLOWER_STEM, [0, h / 2, 0])
  stem.castShadow = false
  stem.receiveShadow = false
  g.add(stem)
  const cap = FLOWER_CAPS[Math.floor(rng() * FLOWER_CAPS.length)]
  const head = box(0.16, 0.12, 0.16, cap, [0, h + 0.04, 0])
  head.castShadow = false
  head.receiveShadow = false
  g.add(head)
  return g
}
