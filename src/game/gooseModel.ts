import * as THREE from 'three'

// A goose is bigger than the Queen and grey, with a long neck — clearly a
// different, more imposing bird at a glance.
const GREY = 0x8d949c
const ORANGE = 0xff9f1c
const BLACK = 0x222222

function box(w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color }))
  m.position.set(x, y, z)
  return m
}

/**
 * Build a blocky goose as one Group. Same conventions as the duck: it faces -Z,
 * and the Group's origin is at its feet (y = 0). It's noticeably larger and
 * taller than the duck Queen — the long neck does most of that work.
 */
export function buildGoose(): THREE.Group {
  const g = new THREE.Group()

  // Body — big and long.
  g.add(box(1.2, 1.0, 1.9, GREY, 0, 0.7, 0.1))

  // Feet.
  g.add(box(0.3, 0.12, 0.6, ORANGE, -0.3, 0.06, -0.1))
  g.add(box(0.3, 0.12, 0.6, ORANGE, 0.3, 0.06, -0.1))

  // Tail stub at the back (+Z), tilted up.
  const tail = box(0.5, 0.4, 0.5, GREY, 0, 0.95, 1.05)
  tail.rotation.x = -0.4
  g.add(tail)

  // Wings — slabs on the sides.
  g.add(box(0.18, 0.6, 1.1, GREY, -0.66, 0.85, 0.1))
  g.add(box(0.18, 0.6, 1.1, GREY, 0.66, 0.85, 0.1))

  // Long neck rising from the front (-Z).
  g.add(box(0.36, 1.1, 0.36, GREY, 0, 1.5, -0.55))

  // Head at the top of the neck, leaning forward.
  g.add(box(0.5, 0.5, 0.62, GREY, 0, 2.15, -0.75))

  // Beak — orange, sticking forward.
  g.add(box(0.3, 0.22, 0.52, ORANGE, 0, 2.1, -1.2))

  // Eyes.
  g.add(box(0.12, 0.12, 0.12, BLACK, -0.2, 2.28, -0.86))
  g.add(box(0.12, 0.12, 0.12, BLACK, 0.2, 2.28, -0.86))

  return g
}
