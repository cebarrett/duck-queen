import * as THREE from 'three'

// Shared palette for all ducks. Feather colour is per-duck (the Queen is white,
// her subjects are duckling-yellow), so it's passed in rather than fixed here.
const ORANGE = 0xff9f1c
const BLACK = 0x222222
const GOLD = 0xffd700
const JEWEL = 0xff4d4d

/** What a built duck hands back: the whole thing as one Group, plus the two wing
 *  pivots in case something wants to animate them (the Queen's controller flaps). */
export interface DuckModel {
  group: THREE.Group
  leftWing: THREE.Group
  rightWing: THREE.Group
  crown?: THREE.Group
}

export interface DuckModelOptions {
  featherColor?: number // body/head/wing/tail colour (default soft white)
  crown?: boolean // give her the golden crown (the Queen) — default no
  scale?: number // overall size multiplier (ducklings are smaller) — default 1
}

/**
 * Build a blocky duck out of boxes and return it as one Group. Used by BOTH the
 * Queen (Duck.ts) and her subjects (Duckling.ts) so they share exactly the same
 * geometry — the Queen is just "this, plus a crown, full size".
 *
 * Convention (unchanged): the duck faces -Z, and the Group's origin is at her feet
 * (y = 0), so standing on the ground is just `group.position.y = 0`. Scaling the
 * group scales about the feet, so a smaller duckling still sits on the ground.
 */
export function buildDuckModel(opts: DuckModelOptions = {}): DuckModel {
  const feather = opts.featherColor ?? 0xf5f5f5
  const withCrown = opts.crown ?? false
  const scale = opts.scale ?? 1

  const group = new THREE.Group()

  // Body — the main blob. Longer front-to-back (depth) than it is wide.
  group.add(box(1.0, 0.8, 1.4, feather, [0, 0.55, 0]))

  // Feet — two flat orange boxes poking out the front-bottom.
  group.add(box(0.25, 0.1, 0.5, ORANGE, [-0.25, 0.05, 0.1]))
  group.add(box(0.25, 0.1, 0.5, ORANGE, [0.25, 0.05, 0.1]))

  // Head — a cube sitting up and toward the front (-Z).
  group.add(box(0.7, 0.7, 0.7, feather, [0, 1.25, -0.5]))

  // Beak — orange box sticking out the front of the head.
  group.add(box(0.45, 0.22, 0.45, ORANGE, [0, 1.15, -0.95]))

  // Eyes — small dark cubes on the front corners of the head.
  group.add(box(0.12, 0.12, 0.12, BLACK, [-0.22, 1.4, -0.82]))
  group.add(box(0.12, 0.12, 0.12, BLACK, [0.22, 1.4, -0.82]))

  // Tail — a stub at the back (+Z), tilted upward for a jaunty look.
  const tail = box(0.5, 0.35, 0.4, feather, [0, 0.8, 0.8])
  tail.rotation.x = -0.5 // tilt the top backward/up (radians)
  group.add(tail)

  // Wings — hinged pivots so they can flap (see makeWing).
  const leftWing = makeWing(-1, feather)
  const rightWing = makeWing(1, feather)
  group.add(leftWing, rightWing)

  const crown = withCrown ? addCrown(group) : undefined

  group.scale.setScalar(scale)
  return { group, leftWing, rightWing, crown }
}

/**
 * Make a coloured box at a position. Returns the Mesh so the caller can tweak it
 * (e.g. rotate the tail). Keeps the duck a readable list of "box here, box there".
 */
function box(
  width: number,
  height: number,
  depth: number,
  color: number,
  position: [number, number, number],
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(width, height, depth),
    new THREE.MeshStandardMaterial({ color }),
  )
  mesh.position.set(...position)
  return mesh
}

/**
 * Build one wing as a hinged pivot. `side` is -1 (left, -X) or +1 (right, +X). The
 * pivot Group sits at the shoulder; the wing box hangs DOWN and slightly OUT from
 * it, so rotating the pivot around its forward (Z) axis swings the wing up/out like
 * a real flap — hinging at the shoulder instead of spinning around its own middle.
 */
function makeWing(side: number, feather: number): THREE.Group {
  const pivot = new THREE.Group()
  pivot.position.set(side * 0.45, 0.85, 0.05) // the shoulder hinge point
  pivot.add(box(0.15, 0.5, 0.9, feather, [side * 0.1, -0.25, 0]))
  return pivot
}

/** The golden crown — a band, three points, and a red jewel. Queen only. */
function addCrown(group: THREE.Group): THREE.Group {
  const crown = new THREE.Group()
  const headTopY = 1.6 // just above the 0.7-tall head centred at y=1.25
  crown.position.set(0, headTopY, -0.5)
  crown.add(box(0.5, 0.18, 0.5, GOLD, [0, 0, 0]))
  for (const x of [-0.16, 0, 0.16]) {
    crown.add(box(0.1, 0.16, 0.1, GOLD, [x, 0.16, 0]))
  }
  crown.add(box(0.1, 0.1, 0.06, JEWEL, [0, 0, -0.26]))
  group.add(crown)
  return crown
}
