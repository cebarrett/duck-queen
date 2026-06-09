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
  group.add(box(0.32, 0.1, 0.55, ORANGE, [-0.28, 0.05, -0.05]))
  group.add(box(0.32, 0.1, 0.55, ORANGE, [0.28, 0.05, -0.05]))
  group.add(box(0.13, 0.32, 0.13, ORANGE, [-0.28, 0.22, 0]))
  group.add(box(0.13, 0.32, 0.13, ORANGE, [0.28, 0.22, 0]))

  // Body — wide and boat-like, noticeably broader than the goose.
  group.add(box(1.55, 1.05, 2.5, WHITE, [0, 0.68, 0.1]))

  // A tall, swept tail at the back (+Z) — more upright than the goose's stub.
  const tail = box(0.58, 0.68, 0.68, WHITE, [0, 1.05, 1.3])
  tail.rotation.x = -0.75
  group.add(tail)

  // Wings — the swan's signature busking posture: large boxes arched well above
  // the body and tilted steeply outward. Static (it never flaps).
  group.add(makeWing(-1))
  group.add(makeWing(1))

  // Neck + head as ONE pivot at the base of the neck, near the front of the body.
  // S-curve: lower segment rises vertically, upper segment leans clearly forward,
  // head is held high — the stately swan silhouette, read in blocks.
  const neck = new THREE.Group()
  neck.position.set(0, 1.12, -0.82)
  neck.add(box(0.32, 1.15, 0.32, WHITE, [0, 0.58, 0])) // lower neck — tall and vertical
  const upper = box(0.28, 0.72, 0.28, WHITE, [0, 1.37, -0.18]) // upper neck — leans forward
  upper.rotation.x = -0.38
  neck.add(upper)
  neck.add(box(0.42, 0.42, 0.54, WHITE, [0, 1.78, -0.46])) // head — held high
  neck.add(box(0.22, 0.17, 0.46, ORANGE, [0, 1.72, -0.80])) // beak — prominent
  neck.add(box(0.21, 0.21, 0.15, BLACK, [0, 1.92, -0.48])) // the mute swan's black knob
  neck.add(box(0.08, 0.08, 0.08, BLACK, [-0.18, 1.80, -0.54])) // eyes
  neck.add(box(0.08, 0.08, 0.08, BLACK, [0.18, 1.80, -0.54]))
  group.add(neck)

  // Scale the whole thing up so it reads as clearly bigger than the goose.
  group.scale.setScalar(1.28)

  return { group, neck }
}

/** One wing in the swan's busking posture, side = -1 (left) / +1 (right).
 *  A large box lifted above the body and tilted steeply outward — that dramatic
 *  arched silhouette that makes swans look nothing like geese. */
function makeWing(side: number): THREE.Mesh {
  const wing = box(0.3, 0.92, 1.75, WHITE, [side * 0.76, 1.12, 0.12])
  wing.rotation.z = side * 0.48 // ~27° — dramatically arched over the back
  return wing
}
