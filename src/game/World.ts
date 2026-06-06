import * as THREE from 'three'
import { Pond } from './Water'
import type { Rng } from './rng'

// A calm sky blue and a grassy green. Defined once so the sky, the fog, and the
// hemisphere light can all share the same palette (keeps everything cohesive).
const SKY_COLOR = 0x8ec9ff
const GROUND_COLOR = 0x88bb55

/**
 * A solid obstacle, described as a vertical cylinder: a circle on the ground
 * (centre x/z + radius) that exists between heights yMin and yMax. The duck is
 * blocked by it only when she's within that height range — so she can fly over
 * the top, or walk under a canopy that floats above her.
 */
export interface Collider {
  x: number
  z: number
  radius: number
  yMin: number
  yMax: number
}

/**
 * World builds the static environment: the ground, the sky/background, fog,
 * and the lights. It doesn't animate anything, so it has no update() — it just
 * adds its objects to the Scene it's handed in the constructor.
 */
export class World {
  // Filled in by addScenery(); the DuckController reads this to block movement.
  readonly colliders: Collider[] = []

  // The pond — a short waddle ahead of spawn (-Z). The duck controller and the
  // ducklings read this to know where they can swim.
  readonly pond = new Pond(0, -26, 10)

  constructor(scene: THREE.Scene, rng: Rng) {
    this.addSky(scene)
    this.addLights(scene)
    this.addGround(scene)
    scene.add(this.pond.mesh)
    this.addScenery(scene, rng)
  }

  private addSky(scene: THREE.Scene): void {
    // The background is the flat colour behind everything.
    scene.background = new THREE.Color(SKY_COLOR)

    // Fog fades distant objects toward a colour. Using the SKY colour makes the
    // ground melt into the horizon instead of ending at a hard edge — cozy, and
    // it hides the far edge of our finite ground plane. Fog(color, near, far):
    // fully clear before `near`, fully fogged past `far`.
    scene.fog = new THREE.Fog(SKY_COLOR, 30, 140)
  }

  private addLights(scene: THREE.Scene): void {
    // HemisphereLight = soft, directionless ambient light: sky colour from
    // above, ground colour bounced from below. It fills shadows so nothing is
    // pure black, but it's too flat on its own to show an object's shape.
    const hemi = new THREE.HemisphereLight(SKY_COLOR, GROUND_COLOR, 1.0)
    scene.add(hemi)

    // DirectionalLight = parallel rays from one direction, like the sun. This
    // is what gives boxes a bright side and a dim side so they read as 3D.
    // Its `position` only sets the *direction* the light comes from.
    const sun = new THREE.DirectionalLight(0xffffff, 2.0)
    sun.position.set(8, 15, 6)
    scene.add(sun)
  }

  private addGround(scene: THREE.Scene): void {
    // A plane is created lying in the X/Y plane (facing the camera). We rotate
    // it -90° around X so it lies flat in X/Z with "up" (+Y) as its normal —
    // i.e. a floor. Math.PI/2 radians = 90°.
    const geometry = new THREE.PlaneGeometry(300, 300)
    // MeshStandardMaterial is a physically-based material: it RESPONDS to light
    // (unlike the cube's old MeshNormalMaterial). With no lights it'd be black —
    // that's the classic "why is everything black?" beginner footgun, which is
    // exactly why we added lights above first.
    const material = new THREE.MeshStandardMaterial({ color: GROUND_COLOR })
    const ground = new THREE.Mesh(geometry, material)
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)
  }

  /**
   * Scatter blocky trees and rocks so you can judge height, distance, and speed
   * — a flat plane gives your eye nothing to measure against. Tall trees double
   * as altitude markers when you're flying.
   */
  private addScenery(scene: THREE.Scene, rng: Rng): void {
    // `rng` is seeded from the one world seed (see rng.ts / Game), so the scenery
    // layout is identical for a given seed.

    // Share ONE material per type instead of making a fresh one for every
    // object. Identical materials can be reused, and it keeps the GPU happy once
    // there are lots of objects — a good habit to start now.
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a5a2b })
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f7d34 })
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x8b929c })

    const COUNT = 70
    const SPREAD = 120 // half-width of the area we scatter over (ground is 300)

    for (let i = 0; i < COUNT; i++) {
      // A random spot in a square. rng() returns 0..1, so (rng()*2-1) is -1..1.
      const x = (rng() * 2 - 1) * SPREAD
      const z = (rng() * 2 - 1) * SPREAD

      // Keep a clear circle around the spawn point so nothing lands on the Queen.
      if (Math.hypot(x, z) < 10) continue
      // Don't grow trees/rocks in the pond.
      if (this.pond.isWater(x, z)) continue

      if (rng() < 0.7) {
        // Tree = a trunk box with a leafy box on top; sizes varied a little so
        // they're not all identical.
        const trunkH = 2.5 + rng() * 3.5
        const leaf = 2 + rng() * 1.8
        const leafCenterY = trunkH + leaf * 0.35
        scene.add(boxMesh(trunkMat, 0.6, trunkH, 0.6, x, trunkH / 2, z))
        scene.add(boxMesh(leafMat, leaf, leaf, leaf, x, leafCenterY, z))

        // Two colliders: a thin trunk (so you can walk right up to it) and the
        // wider canopy up at leaf height (so you bonk it only while flying through).
        this.colliders.push({ x, z, radius: 0.4, yMin: 0, yMax: trunkH })
        this.colliders.push({
          x,
          z,
          radius: leaf * 0.45,
          yMin: leafCenterY - leaf / 2,
          yMax: leafCenterY + leaf / 2,
        })
      } else {
        // Rock = a squat block sitting low to the ground.
        const s = 1 + rng() * 2
        scene.add(boxMesh(rockMat, s, s * 0.7, s, x, s * 0.25, z))
        this.colliders.push({ x, z, radius: s * 0.5, yMin: 0, yMax: s * 0.6 })
      }
    }
  }
}

/** Make a box mesh of a given size at a position, reusing the passed material. */
function boxMesh(
  material: THREE.Material,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material)
  m.position.set(x, y, z)
  return m
}
