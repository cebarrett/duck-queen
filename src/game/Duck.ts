import * as THREE from 'three'

// The duck's palette, named so the intent is obvious at each call site.
// A soft off-white (not pure 0xffffff) so the sun's shading still reads on her.
const FEATHER = 0xf5f5f5
const ORANGE = 0xff9f1c
const BLACK = 0x222222
const GOLD = 0xffd700
const JEWEL = 0xff4d4d

/**
 * Small helper: make a coloured box at a position. Returns a Mesh so the caller
 * can tweak it further (e.g. rotate the tail). Keeping this here means the duck
 * is just a readable list of "box here, box there".
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
 * Build one wing as a hinged pivot. `side` is -1 for the left wing (-X) and +1
 * for the right (+X). The pivot Group sits at the shoulder; the wing box is
 * offset DOWN and slightly OUT from it, so rotating the pivot around its forward
 * (Z) axis swings the wing up/out like a real flap, hinging at the shoulder
 * instead of spinning around the wing's own middle.
 */
function makeWing(side: number): THREE.Group {
  const pivot = new THREE.Group()
  pivot.position.set(side * 0.45, 0.85, 0.05) // the shoulder hinge point
  pivot.add(box(0.15, 0.5, 0.9, FEATHER, [side * 0.1, -0.25, 0]))
  return pivot
}

/**
 * The Queen, in placeholder boxes. Everything is parented to a single Group so
 * the rest of the game can move/turn ONE object (`duck.group`) and all the
 * boxes come along for free — that's the whole point of a Group.
 *
 * Convention: the duck faces -Z (beak points toward -Z). Three.js cameras also
 * look down -Z by default, so "-Z = forward" keeps later movement math simple.
 * The Group's origin sits at the duck's feet (y = 0), so placing her on the
 * ground is just `group.position.y = 0`.
 */
export class Duck {
  readonly group = new THREE.Group()

  // The wings are hinged so they can flap. These are the pivot Groups (the
  // "shoulders"); the controller rotates them. Assigned in the constructor.
  readonly leftWing: THREE.Group
  readonly rightWing: THREE.Group

  constructor() {
    const g = this.group

    // Body — the main blob. Longer front-to-back (depth) than it is wide.
    g.add(box(1.0, 0.8, 1.4, FEATHER, [0, 0.55, 0]))

    // Feet — two flat orange boxes poking out the front-bottom.
    g.add(box(0.25, 0.1, 0.5, ORANGE, [-0.25, 0.05, 0.1]))
    g.add(box(0.25, 0.1, 0.5, ORANGE, [0.25, 0.05, 0.1]))

    // Head — a cube sitting up and toward the front (-Z).
    g.add(box(0.7, 0.7, 0.7, FEATHER, [0, 1.25, -0.5]))

    // Beak — orange box sticking out the front of the head.
    g.add(box(0.45, 0.22, 0.45, ORANGE, [0, 1.15, -0.95]))

    // Eyes — small dark cubes on the front corners of the head.
    g.add(box(0.12, 0.12, 0.12, BLACK, [-0.22, 1.4, -0.82]))
    g.add(box(0.12, 0.12, 0.12, BLACK, [0.22, 1.4, -0.82]))

    // Tail — a stub at the back (+Z), tilted upward for a jaunty look.
    const tail = box(0.5, 0.35, 0.4, FEATHER, [0, 0.8, 0.8])
    tail.rotation.x = -0.5 // tilt the top backward/up (radians)
    g.add(tail)

    // Wings — thin slabs on each side. Each one hangs from a small pivot Group
    // at the shoulder, so the controller can FLAP it by rotating the pivot. (A
    // box rotates around its own centre, which would just spin in place; the
    // pivot Group gives us a proper shoulder hinge to swing the wing from.)
    this.leftWing = makeWing(-1)
    this.rightWing = makeWing(1)
    g.add(this.leftWing, this.rightWing)

    // Crown — because she is the QUEEN. A gold band, three points, one jewel.
    this.addCrown()
  }

  private addCrown(): void {
    const g = this.group
    const headTopY = 1.6 // just above the 0.7-tall head centred at y=1.25

    // The band.
    g.add(box(0.5, 0.18, 0.5, GOLD, [0, headTopY, -0.5]))

    // Three little points across the front of the band.
    for (const x of [-0.16, 0, 0.16]) {
      g.add(box(0.1, 0.16, 0.1, GOLD, [x, headTopY + 0.16, -0.5]))
    }

    // A red jewel on the front of the band.
    g.add(box(0.1, 0.1, 0.06, JEWEL, [0, headTopY, -0.76]))
  }
}
