import * as THREE from 'three'

// A mute swan: pure white, a long graceful neck held high, an orange beak with the
// signature black knob/mask at its base. Bigger and more elegant than the goose —
// it reads as stately at a glance. Kept a cool off-white (not pure 0xffffff) so it
// doesn't blow out under the scene light.
const WHITE = 0xeef1f5
const ORANGE = 0xf08a24 // beak
const BLACK = 0x1a1a1a // facial mask / knob / eyes

function box(
  w: number,
  h: number,
  d: number,
  color: number,
  position: [number, number, number],
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color }))
  m.position.set(...position)
  m.castShadow = true
  m.receiveShadow = true
  return m
}

/** What a built swan hands back: the whole thing plus the one part we animate —
 *  the neck pivot (for the slow, graceful sway). Rotating it swings the head. */
export interface SwanModel {
  group: THREE.Group
  neck: THREE.Group
}

/**
 * Build a blocky swan. Faces -Z; the Group's origin is at its feet (y = 0). The
 * body is a long boat-shape riding on short legs, with arched folded wings and a
 * tall neck curving up to a black-and-orange face. It only ever swims, so the legs
 * stay mostly under the waterline.
 */
export function buildSwan(): SwanModel {
  const group = new THREE.Group()

  // Short orange legs + webbed feet — tucked low, mostly submerged while afloat.
  group.add(box(0.3, 0.1, 0.5, ORANGE, [-0.26, 0.05, -0.05]))
  group.add(box(0.3, 0.1, 0.5, ORANGE, [0.26, 0.05, -0.05]))
  group.add(box(0.12, 0.3, 0.12, ORANGE, [-0.26, 0.2, 0]))
  group.add(box(0.12, 0.3, 0.12, ORANGE, [0.26, 0.2, 0]))

  // Body — long and boat-like, broad in the middle.
  group.add(box(1.1, 0.85, 2.0, WHITE, [0, 0.62, 0.1]))

  // A pert tail tilted up at the back (+Z).
  const tail = box(0.4, 0.42, 0.5, WHITE, [0, 0.9, 1.05])
  tail.rotation.x = -0.6
  group.add(tail)

  // Arched folded wings — the swan's signature raised-wing posture. Static (it
  // never flaps): a box each side, lifted and tilted outward over the back.
  group.add(makeWing(-1))
  group.add(makeWing(1))

  // Neck + head as ONE pivot at the base of the neck, near the front of the body.
  // It rises tall and mostly upright, with just a gentle forward lean up top and a
  // refined head held high — the stately swan poise, read in blocks.
  const neck = new THREE.Group()
  neck.position.set(0, 1.0, -0.7)
  neck.add(box(0.28, 0.98, 0.28, WHITE, [0, 0.49, 0])) // lower neck — tall and vertical
  const upper = box(0.26, 0.58, 0.26, WHITE, [0, 1.1, -0.1]) // upper neck — leans gently forward
  upper.rotation.x = -0.26
  neck.add(upper)
  neck.add(box(0.36, 0.36, 0.46, WHITE, [0, 1.46, -0.32])) // head — held high
  neck.add(box(0.2, 0.15, 0.42, ORANGE, [0, 1.4, -0.62])) // beak
  neck.add(box(0.18, 0.18, 0.13, BLACK, [0, 1.56, -0.35])) // the mute swan's black knob
  neck.add(box(0.07, 0.07, 0.07, BLACK, [-0.15, 1.48, -0.4])) // eyes
  neck.add(box(0.07, 0.07, 0.07, BLACK, [0.15, 1.48, -0.4]))
  group.add(neck)

  return { group, neck }
}

/** One arched folded wing, side = -1 (left) / +1 (right). A simple static box,
 *  hugging the body and tilted gently outward at the top so it reads as puffed up
 *  without sticking out like a fin. */
function makeWing(side: number): THREE.Mesh {
  const wing = box(0.2, 0.55, 1.3, WHITE, [side * 0.54, 0.9, 0.15])
  wing.rotation.z = side * 0.13 // top edge flares slightly outward
  return wing
}
