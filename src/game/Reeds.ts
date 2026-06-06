import * as THREE from 'three'
import type { Pond } from './Water'
import { ResourcePatch } from './ResourcePatch'
import { randRange } from './mathUtils'

const STALK = 0x6fae3c // reed green
const STALK2 = 0x8fbf4a // a lighter green, for variety
const CATTAIL = 0x7a5230 // brown cattail head

const REED_COUNT = 16

/**
 * Reeds grow in a band around the pond's shoreline (some just in the shallows,
 * some on the bank). They're gathered ONLY by the Duck Queen — the ducklings
 * ignore them — and will later be the material for building nests.
 */
export class Reeds extends ResourcePatch {
  constructor(scene: THREE.Scene, pond: Pond) {
    super(scene)
    for (let i = 0; i < REED_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2
      // A ring hugging the shoreline: from just inside the water to just onto land.
      const r = pond.radius + randRange(-1.5, 2.5)
      const x = pond.centerX + Math.cos(angle) * r
      const z = pond.centerZ + Math.sin(angle) * r
      const clump = makeReedClump()
      clump.rotation.y = Math.random() * Math.PI * 2
      this.add(clump, x, 0, z) // reeds stand up from the shoreline (base at y=0)
    }
  }
}

/** A little clump of tall reeds with a cattail — a few thin stalks, slightly fanned. */
function makeReedClump(): THREE.Group {
  const g = new THREE.Group()
  const stalk = (h: number, color: number, x: number, z: number, tilt: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.06, h, 0.06), new THREE.MeshStandardMaterial({ color }))
    m.position.set(x, h / 2, z)
    m.rotation.z = tilt // lean it a touch so the clump isn't stiff
    g.add(m)
    return m
  }
  stalk(1.1, STALK, 0, 0, 0.05)
  stalk(0.9, STALK2, 0.12, 0.05, -0.12)
  stalk(1.0, STALK, -0.1, -0.06, 0.14)

  // A brown cattail head near the top of the tallest stalk.
  const cattail = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 0.26, 0.1),
    new THREE.MeshStandardMaterial({ color: CATTAIL }),
  )
  cattail.position.set(0.02, 1.0, 0)
  g.add(cattail)
  return g
}
