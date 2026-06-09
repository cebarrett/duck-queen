import * as THREE from 'three'

// Shared palette for all ducks. Feather colour is per-duck (the Queen is white,
// her subjects are duckling-yellow), so it's passed in rather than fixed here.
const ORANGE = 0xff9f1c
const BLACK = 0x222222
const GOLD = 0xffd700
const JEWEL = 0xff4d4d

/** What a built duck hands back: the whole thing as one Group, plus the pivots
 *  something might want to animate — the two wings (the Queen's controller flaps
 *  them) and the head (subjects tip/turn it for their idle fidgets). */
export interface DuckModel {
  group: THREE.Group
  leftWing: THREE.Group
  rightWing: THREE.Group
  head: THREE.Group
  crown?: THREE.Group
}

export interface DuckModelOptions {
  featherColor?: number // base colour for body/head/wings/tail (default soft white)
  bodyColor?: number // body + tail + wings — defaults to featherColor
  headColor?: number // head — defaults to featherColor (a drake gets a green head)
  billColor?: number // beak — defaults to orange
  neckRingColor?: number // optional collar band (the drake's white neck ring)
  breastColor?: number // optional breast patch (the drake's chestnut front)
  crown?: boolean // give her the golden crown (the Queen) — default no
  scale?: number // overall size multiplier (ducklings are smaller) — default 1
}

/**
 * Build a blocky duck out of boxes and return it as one Group. Used by BOTH the
 * Queen (Duck.ts) and her subjects (DuckSubject.ts) so they share exactly the same
 * geometry — the Queen is just "this, plus a crown, full size".
 *
 * Convention (unchanged): the duck faces -Z, and the Group's origin is at her feet
 * (y = 0), so standing on the ground is just `group.position.y = 0`. Scaling the
 * group scales about the feet, so a smaller duckling still sits on the ground.
 */
export function buildDuckModel(opts: DuckModelOptions = {}): DuckModel {
  // Resolve the per-part palette. Everything falls back to featherColor (or
  // orange for the bill), so callers that pass only featherColor — the Queen and
  // the ducklings — render exactly as before; mallards override head/body/bill.
  const feather = opts.featherColor ?? 0xf5f5f5
  const body = opts.bodyColor ?? feather
  const headColor = opts.headColor ?? feather
  const bill = opts.billColor ?? ORANGE
  const withCrown = opts.crown ?? false
  const scale = opts.scale ?? 1

  const group = new THREE.Group()

  // Body — the main blob. Longer front-to-back (depth) than it is wide.
  group.add(box(1.0, 0.8, 1.4, body, [0, 0.55, 0]))

  // Feet — two flat orange boxes poking out the front-bottom. (Mallards, ducklings
  // and the Queen all have orange feet, so this stays orange.)
  group.add(box(0.25, 0.1, 0.5, ORANGE, [-0.25, 0.05, 0.1]))
  group.add(box(0.25, 0.1, 0.5, ORANGE, [0.25, 0.05, 0.1]))

  // Optional chestnut breast patch (the drake), poking proud of the body's front.
  if (opts.breastColor !== undefined) {
    group.add(box(0.86, 0.55, 0.32, opts.breastColor, [0, 0.62, -0.74]))
  }
  // Optional white collar band (the drake's neck ring), at the head/body junction.
  if (opts.neckRingColor !== undefined) {
    group.add(box(0.74, 0.16, 0.74, opts.neckRingColor, [0, 0.98, -0.45]))
  }

  // Head, beak and eyes live under ONE pivot at the base of the neck, so the whole
  // head can tip up (gaze at the sky), dip down (peck the ground) and turn (look
  // around) as a unit — that's what the subjects' idle fidgets animate. At rest
  // (rotation 0) it sits exactly where a fixed head would, so nothing looks moved.
  const head = new THREE.Group()
  head.position.set(0, 1.0, -0.4)
  head.add(box(0.7, 0.7, 0.7, headColor, [0, 0.25, -0.1])) // head cube
  head.add(box(0.45, 0.22, 0.45, bill, [0, 0.15, -0.55])) // beak, out the front
  head.add(box(0.12, 0.12, 0.12, BLACK, [-0.22, 0.4, -0.42])) // eyes
  head.add(box(0.12, 0.12, 0.12, BLACK, [0.22, 0.4, -0.42]))
  group.add(head)

  // Tail — a stub at the back (+Z), tilted upward for a jaunty look.
  const tail = box(0.5, 0.35, 0.4, body, [0, 0.8, 0.8])
  tail.rotation.x = -0.5 // tilt the top backward/up (radians)
  group.add(tail)

  // Wings — hinged pivots so they can flap (see makeWing).
  const leftWing = makeWing(-1, body)
  const rightWing = makeWing(1, body)
  group.add(leftWing, rightWing)

  // Crown rides on the head pivot (Queen only), so it'd tip with her head too.
  const crown = withCrown ? addCrown(head) : undefined

  group.scale.setScalar(scale)
  return { group, leftWing, rightWing, head, crown }
}

// --- Mallard palettes ------------------------------------------------------
// The body/head/bill colours that turn the shared duck into an adult mallard.
// (Each kind's size and voice come from the subject-kinds table, added later.)

/** Drake (male mallard): glossy green head, white collar, chestnut breast, grey
 *  flanks, yellow bill — the instantly-readable "mallard" look. */
export const MALLARD_DRAKE: DuckModelOptions = {
  bodyColor: 0x9a9ea4, // pale grey flanks
  headColor: 0x1b7a43, // glossy green head
  billColor: 0xf3c24b, // yellow bill
  neckRingColor: 0xf6f6f6, // white collar
  breastColor: 0x7c4a2f, // chestnut breast
}

/** Hen (female mallard): mottled brown all over with a dull orange bill. */
export const MALLARD_HEN: DuckModelOptions = {
  bodyColor: 0x8a6c49, // mottled brown body
  headColor: 0x6f5536, // darker brown crown
  billColor: 0xcf9a4c, // dull orange bill
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
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/**
 * Build one wing as a hinged pivot. `side` is -1 (left, -X) or +1 (right, +X). The
 * pivot Group sits at the shoulder; the wing box hangs DOWN and slightly OUT from
 * it, so rotating the pivot around its forward (Z) axis swings the wing up/out like
 * a real flap — hinging at the shoulder instead of spinning around its own middle.
 */
function makeWing(side: number, color: number): THREE.Group {
  const pivot = new THREE.Group()
  pivot.position.set(side * 0.45, 0.85, 0.05) // the shoulder hinge point
  pivot.add(box(0.15, 0.5, 0.9, color, [side * 0.1, -0.25, 0]))
  return pivot
}

/** The golden crown — a band, three points, and a red jewel. Queen only. Added to
 *  the head pivot, with positions in that pivot's space (the head sits at y 1.0). */
function addCrown(head: THREE.Group): THREE.Group {
  const crown = new THREE.Group()
  crown.position.set(0, 0.6, -0.1) // atop the head, in the head pivot's local space
  crown.add(box(0.5, 0.18, 0.5, GOLD, [0, 0, 0]))
  for (const x of [-0.16, 0, 0.16]) {
    crown.add(box(0.1, 0.16, 0.1, GOLD, [x, 0.16, 0]))
  }
  crown.add(box(0.1, 0.1, 0.06, JEWEL, [0, 0, -0.26]))
  head.add(crown)
  return crown
}
