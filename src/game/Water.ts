import * as THREE from 'three'

/**
 * A circular pond. It's deliberately simple: a flat, see-through blue disc lying
 * on the green ground (no carved-out terrain). It knows its geometry so the rest
 * of the game can ask "is this spot over water?" with a cheap point-in-circle test.
 *
 *   - surfaceY: where the water surface sits. A hair ABOVE the ground (y=0) so the
 *     two coplanar planes don't "z-fight" (flicker as the GPU can't decide which
 *     is in front).
 *   - floatLine: the y a duck's body sits at while floating — below the surface,
 *     so the waterline cuts across its middle and it looks half-submerged.
 */
export class Pond {
  readonly surfaceY = 0.02
  readonly floatLine = -0.35

  readonly mesh: THREE.Mesh

  constructor(
    readonly centerX: number,
    readonly centerZ: number,
    readonly radius: number,
  ) {
    // CircleGeometry is born standing up (in the X/Y plane), so rotate it flat —
    // the same trick the ground uses.
    const geometry = new THREE.CircleGeometry(radius, 48)
    const material = new THREE.MeshStandardMaterial({
      color: 0x3a8ee6,
      transparent: true, // let the duck show through, tinted
      opacity: 0.72,
      roughness: 0.25, // a bit of sheen under the "sun"
      metalness: 0,
    })
    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.rotation.x = -Math.PI / 2
    this.mesh.position.set(centerX, this.surfaceY, centerZ)
  }

  /** Is the point (x, z) over the water? Cheapest possible region test: compare
   *  squared distance to squared radius (no square root needed). */
  isWater(x: number, z: number): boolean {
    const dx = x - this.centerX
    const dz = z - this.centerZ
    return dx * dx + dz * dz < this.radius * this.radius
  }
}
