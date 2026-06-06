import * as THREE from 'three'

// A goose is bigger than the Queen and grey, with a long neck and proper legs —
// clearly a different, more imposing bird at a glance.
const GREY = 0x8d949c
const ORANGE = 0xff9f1c
const BLACK = 0x222222

function box(
  w: number,
  h: number,
  d: number,
  color: number,
  position: [number, number, number],
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color }))
  m.position.set(...position)
  return m
}

/** What a built goose hands back: the whole thing plus the parts we animate —
 *  the two wing pivots (for flapping) and the neck pivot (for looking/pecking
 *  and the walking head-bob). Rotating a pivot swings everything parented to it. */
export interface GooseModel {
  group: THREE.Group
  leftWing: THREE.Group
  rightWing: THREE.Group
  neck: THREE.Group
}

/**
 * Build a blocky goose. Faces -Z; the Group's origin is at its feet (y = 0). It
 * stands tall on orange legs, so it reads as deliberate rather than ducky.
 */
export function buildGoose(): GooseModel {
  const group = new THREE.Group()

  // Feet + long orange legs (these raise the whole body, the goose look).
  group.add(box(0.34, 0.1, 0.6, ORANGE, [-0.3, 0.05, -0.05]))
  group.add(box(0.34, 0.1, 0.6, ORANGE, [0.3, 0.05, -0.05]))
  group.add(box(0.14, 0.42, 0.14, ORANGE, [-0.3, 0.28, 0]))
  group.add(box(0.14, 0.42, 0.14, ORANGE, [0.3, 0.28, 0]))

  // Body — big and long, riding up on the legs.
  group.add(box(1.2, 1.0, 1.9, GREY, [0, 0.98, 0.1]))

  // Tail stub at the back (+Z), tilted up.
  const tail = box(0.5, 0.4, 0.5, GREY, [0, 1.2, 1.0])
  tail.rotation.x = -0.4
  group.add(tail)

  // Wings — hinged pivots at the shoulders so they can flap.
  const leftWing = makeWing(-1)
  const rightWing = makeWing(1)
  group.add(leftWing, rightWing)

  // Neck + head as ONE pivot at the base of the neck. Rotating it turns/dips the
  // whole head — that's how it looks around, pecks, and bobs while walking.
  const neck = new THREE.Group()
  neck.position.set(0, 1.35, -0.55)
  neck.add(box(0.36, 1.0, 0.36, GREY, [0, 0.5, 0])) // neck stalk, rising from the pivot
  neck.add(box(0.5, 0.5, 0.62, GREY, [0, 1.05, -0.2])) // head
  neck.add(box(0.3, 0.22, 0.52, ORANGE, [0, 1.0, -0.65])) // beak
  neck.add(box(0.12, 0.12, 0.12, BLACK, [-0.2, 1.18, -0.32])) // eyes
  neck.add(box(0.12, 0.12, 0.12, BLACK, [0.2, 1.18, -0.32]))
  group.add(neck)

  return { group, leftWing, rightWing, neck }
}

/** One wing as a hinged pivot at the shoulder. side = -1 (left) / +1 (right).
 *  Folded is rotation.z = 0 (lying along the body); rotating z spreads it. */
function makeWing(side: number): THREE.Group {
  const pivot = new THREE.Group()
  pivot.position.set(side * 0.58, 1.25, 0.1)
  pivot.add(box(0.18, 0.7, 1.1, GREY, [side * 0.05, -0.35, 0]))
  return pivot
}
