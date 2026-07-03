import * as THREE from 'three'
import { box } from './modelUtils'
import type { Pond } from './Water'
import type { Terrain } from './terrain'
import type { Rng } from './rng'
import { Wind } from './Wind'
import { TREATY_FLATS, BIOME_DEFS, type BiomeKind, type BiomeMap } from './Biomes'

// Little blocky undergrowth dotted across the play area — it gives the ground
// texture and pops of cozy colour, and most of it sways in the breeze (see
// Wind). Purely decorative: no colliders, so you walk straight through it.
// Placement is seeded ('flora' stream), so the meadow is identical for a given
// seed. WHAT sprouts at a spot comes from the biome map: grass and wildflowers
// in the meadow, ferns and snowdrops in the Birchwood, tall wheatgrass on the
// prairie, purple heather on the tors, toadstools and tussocks in the fen,
// leaf-litter and brown mushrooms in the Amberwood.
const ATTEMPTS = 340
const SPREAD = 100 // half-width of the area to scatter over

/**
 * Flora scatters biome-appropriate undergrowth onto the land. Built once in the
 * constructor; the swaying pieces register with the shared Wind. It avoids the
 * water, the spawn circle, and the Treaty Flats so those stay legible.
 */
export class Flora {
  constructor(scene: THREE.Scene, pond: Pond, terrain: Terrain, wind: Wind, rng: Rng, biomes: BiomeMap) {
    for (let i = 0; i < ATTEMPTS; i++) {
      const x = (rng() * 2 - 1) * SPREAD
      const z = (rng() * 2 - 1) * SPREAD
      if (Math.hypot(x, z) < 6) continue // keep the spawn point clear
      if (pond.isWater(x, z)) continue // undergrowth doesn't grow in the water
      // Keep the Treaty Flats reading as its own windgrass meadow.
      if (Math.hypot(x - TREATY_FLATS.x, z - TREATY_FLATS.z) < TREATY_FLATS.radius + 2) continue

      const kind = biomes.kindAt(x, z)
      if (rng() >= BIOME_DEFS[kind].floraDensity) continue // this biome grows sparser cover

      const { mesh, sway } = makeFloraFor(kind, rng)
      mesh.position.set(x, terrain.heightAt(x, z), z) // grow up out of the hillside
      mesh.rotation.y = rng() * Math.PI * 2
      scene.add(mesh)
      // Origin at the base, so a z-lean bends it from the ground like real grass.
      if (sway > 0) wind.register(mesh, sway, Wind.phaseFor(x, z))
    }
  }
}

/** Build one piece of this biome's undergrowth; `sway` is its wind amplitude
 *  (0 for things that shouldn't bend, like mushrooms). */
function makeFloraFor(kind: BiomeKind, rng: Rng): { mesh: THREE.Group; sway: number } {
  switch (kind) {
    case 'birchwood':
      if (rng() < 0.12) return { mesh: makeFlower(rng, BIRCH_FLOWER_CAPS), sway: 0.1 }
      return { mesh: makeTuft(rng, FERN_GREENS, 0.4, 0.4), sway: 0.12 }
    case 'prairie':
      if (rng() < 0.1) return { mesh: makeFlower(rng, PRAIRIE_FLOWER_CAPS), sway: 0.1 }
      return { mesh: makeWheat(rng), sway: 0.14 }
    case 'tors':
      return { mesh: makeHeather(rng), sway: 0.06 }
    case 'fen':
      if (rng() < 0.35) return { mesh: makeToadstool(rng, FEN_CAP), sway: 0 }
      return { mesh: makeTuft(rng, FEN_GREENS, 0.35, 0.3), sway: 0.1 }
    case 'amberwood':
      if (rng() < 0.25) return { mesh: makeToadstool(rng, AMBER_CAP), sway: 0 }
      return { mesh: makeTuft(rng, AMBER_BLADES, 0.3, 0.35), sway: 0.1 }
    default:
      if (rng() < 0.18) return { mesh: makeFlower(rng, MEADOW_FLOWER_CAPS), sway: 0.1 }
      return { mesh: makeTuft(rng, MEADOW_GREENS, 0.3, 0.4), sway: 0.1 }
  }
}

// --- Palettes -------------------------------------------------------------------
const MEADOW_GREENS = [0x86a957, 0xb7c36b, 0x77a24a] as const
const MEADOW_FLOWER_CAPS = [0xff9ecb, 0xffe066, 0xff9e6b] as const
const FERN_GREENS = [0x5f9948, 0x74af5a, 0x69a250] as const
const BIRCH_FLOWER_CAPS = [0xf2eedd, 0xe9f0d8] as const
const WHEAT_GOLDS = [0xd6c06a, 0xcdb75f, 0xdfca75] as const
const WHEAT_HEAD = 0xe6d383
const PRAIRIE_FLOWER_CAPS = [0xffd24a, 0xff9e3d] as const
const HEATHER_GREENS = [0x7d925f, 0x87a06b] as const
const HEATHER_BLOOMS = [0xb07fd6, 0x9a6fc0] as const
const FEN_GREENS = [0x5c6e3b, 0x66753f] as const
const FEN_CAP = 0xd6503c
const AMBER_BLADES = [0xc0812f, 0xa96428, 0xd0a03d] as const
const AMBER_CAP = 0xa07040
const FLOWER_STEM = 0x5a7d33
const STOOL_STEM = 0xe6dcc2

// --- Builders --------------------------------------------------------------------

/** A tuft of a few short, thin blades fanned out from a shared base. The palette
 *  and blade height range vary by biome (meadow grass, birch ferns, fen tussocks,
 *  amber leaf-litter). */
function makeTuft(rng: Rng, colors: readonly number[], minH: number, varH: number): THREE.Group {
  const g = new THREE.Group()
  const blades = 3 + Math.floor(rng() * 2) // 3..4
  for (let i = 0; i < blades; i++) {
    const h = minH + rng() * varH
    const color = colors[Math.floor(rng() * colors.length)]
    const bx = (rng() * 2 - 1) * 0.14
    const bz = (rng() * 2 - 1) * 0.14
    const blade = quiet(box(0.05, h, 0.05, color, [bx, h / 2, bz]))
    blade.rotation.z = (rng() * 2 - 1) * 0.25 // a little fan
    g.add(blade)
  }
  return g
}

/** A single flower: a slim stem with a bright blocky cap. */
function makeFlower(rng: Rng, caps: readonly number[]): THREE.Group {
  const g = new THREE.Group()
  const h = 0.4 + rng() * 0.3
  g.add(quiet(box(0.05, h, 0.05, FLOWER_STEM, [0, h / 2, 0])))
  const cap = caps[Math.floor(rng() * caps.length)]
  g.add(quiet(box(0.16, 0.12, 0.16, cap, [0, h + 0.04, 0])))
  return g
}

/** Tall prairie wheatgrass: a few golden stalks with pale seed-heads. */
function makeWheat(rng: Rng): THREE.Group {
  const g = new THREE.Group()
  const stalks = 2 + Math.floor(rng() * 2) // 2..3
  for (let i = 0; i < stalks; i++) {
    const h = 0.8 + rng() * 0.5
    const color = WHEAT_GOLDS[Math.floor(rng() * WHEAT_GOLDS.length)]
    const bx = (rng() * 2 - 1) * 0.12
    const bz = (rng() * 2 - 1) * 0.12
    const stalk = quiet(box(0.05, h, 0.05, color, [bx, h / 2, bz]))
    stalk.rotation.z = (rng() * 2 - 1) * 0.18
    g.add(stalk)
    g.add(quiet(box(0.09, 0.2, 0.09, WHEAT_HEAD, [bx, h + 0.06, bz])))
  }
  return g
}

/** Tor heather: a low grey-green clump with tiny purple blooms. */
function makeHeather(rng: Rng): THREE.Group {
  const g = new THREE.Group()
  const blades = 3 + Math.floor(rng() * 2)
  for (let i = 0; i < blades; i++) {
    const h = 0.18 + rng() * 0.18
    const color = HEATHER_GREENS[Math.floor(rng() * HEATHER_GREENS.length)]
    const bx = (rng() * 2 - 1) * 0.14
    const bz = (rng() * 2 - 1) * 0.14
    g.add(quiet(box(0.06, h, 0.06, color, [bx, h / 2, bz])))
    if (i < 2) {
      const bloom = HEATHER_BLOOMS[Math.floor(rng() * HEATHER_BLOOMS.length)]
      g.add(quiet(box(0.09, 0.08, 0.09, bloom, [bx, h + 0.03, bz])))
    }
  }
  return g
}

/** A little toadstool: a pale stem under a bright cap (fen red, amber brown). */
function makeToadstool(rng: Rng, cap: number): THREE.Group {
  const g = new THREE.Group()
  const h = 0.2 + rng() * 0.12
  const w = 0.24 + rng() * 0.12
  g.add(quiet(box(0.09, h, 0.09, STOOL_STEM, [0, h / 2, 0])))
  g.add(quiet(box(w, 0.1, w, cap, [0, h + 0.04, 0])))
  return g
}

/** Flora is too small to be worth the shadow pass — skip that work per box. */
function quiet(mesh: THREE.Mesh): THREE.Mesh {
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}
