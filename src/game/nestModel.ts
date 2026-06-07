import * as THREE from 'three'

// A cozy blocky nest: a straw pad ringed by little twig blocks, with a clutch of
// pale eggs in the middle. Built once and dropped into the world by Nests.
const TWIG_DARK = 0x6f4a26
const TWIG_LIGHT = 0x9c7038
const STRAW = 0xc7a667
const EGG = 0xf4ecd6

function box(
  w: number,
  h: number,
  d: number,
  color: number,
  x: number,
  y: number,
  z: number,
  rotY = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color }))
  m.position.set(x, y, z)
  m.rotation.y = rotY
  return m
}

/**
 * Build a blocky nest as one Group, origin at its base (y = 0) so it sits on the
 * ground. It has no inherent facing — Nests gives each one a random spin so a row
 * of them doesn't look stamped from a mould.
 */
export function buildNest(): THREE.Group {
  const group = new THREE.Group()

  // Straw pad — the bowl floor: low and wide, mostly hidden under the rim.
  group.add(box(1.0, 0.14, 1.0, STRAW, 0, 0.07, 0))

  // Twig rim — a ring of little blocks fanned around the edge, alternating shades
  // so it reads as woven rather than a smooth wall.
  const RIM_COUNT = 12
  const R = 0.62
  for (let i = 0; i < RIM_COUNT; i++) {
    const a = (i / RIM_COUNT) * Math.PI * 2
    const color = i % 2 === 0 ? TWIG_DARK : TWIG_LIGHT
    group.add(box(0.36, 0.24, 0.22, color, Math.cos(a) * R, 0.16, Math.sin(a) * R, a))
  }

  // Eggs aren't baked in — a brooding hen lays them one at a time (see addEgg),
  // so a fresh nest starts empty and fills as she sits.
  return group
}

/** Where eggs sit in the bowl, filled in order as the hen lays them. */
const EGG_SLOTS: [number, number, number][] = [
  [-0.12, 0.2, 0.05],
  [0.13, 0.2, -0.03],
  [0.0, 0.2, 0.17],
  [-0.06, 0.2, -0.16],
  [0.2, 0.2, 0.12],
]

/** How many eggs one nest can hold. */
export const MAX_EGGS = EGG_SLOTS.length

/** Drop the next egg into a nest's bowl and return its mesh (so the nest can take
 *  it back later if a goose raids). `index` is 0-based; callers cap at MAX_EGGS. */
export function addEgg(group: THREE.Group, index: number): THREE.Mesh {
  const [x, y, z] = EGG_SLOTS[index % EGG_SLOTS.length]
  const egg = box(0.2, 0.24, 0.26, EGG, x, y, z)
  group.add(egg)
  return egg
}
