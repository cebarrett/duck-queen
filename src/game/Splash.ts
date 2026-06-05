import * as THREE from 'three'

// How a ripple grows and fades.
const DURATION = 0.6 // seconds a ripple lives
const START_SCALE = 0.4 // ring radius (world units) at birth
const BASE_MAX_SCALE = 1.6 // how big it gets...
const STRENGTH_MAX_SCALE = 1.4 // ...plus a bit more for a harder splash
const START_OPACITY = 0.6

interface Ripple {
  mesh: THREE.Mesh
  age: number
  maxScale: number
}

/**
 * Splash draws expanding ring ripples on the pond when the duck breaks the
 * surface. Game owns one of these, calls spawn() when a splash happens, and
 * update(delta) each frame to grow/fade the active ripples (and clean them up).
 */
export class Splash {
  private readonly ripples: Ripple[] = []

  // One geometry shared by every ripple — a thin flat ring we scale up. Cheaper
  // than building a new ring each splash.
  private readonly geometry = new THREE.RingGeometry(0.82, 1.0, 28)

  constructor(
    private readonly scene: THREE.Scene,
    private readonly surfaceY: number,
  ) {
    this.geometry.rotateX(-Math.PI / 2) // lay it flat once, here
  }

  spawn(x: number, z: number, strength: number): void {
    // Each ripple needs its own material (its opacity animates independently).
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: START_OPACITY,
      side: THREE.DoubleSide,
      depthWrite: false, // it's a translucent decal — don't block what's behind it
    })
    const mesh = new THREE.Mesh(this.geometry, material)
    mesh.position.set(x, this.surfaceY + 0.02, z) // just above the water surface
    mesh.scale.setScalar(START_SCALE)
    this.scene.add(mesh)

    const maxScale = BASE_MAX_SCALE + STRENGTH_MAX_SCALE * Math.min(strength / 5, 1)
    this.ripples.push({ mesh, age: 0, maxScale })
  }

  update(delta: number): void {
    // Iterate backwards so we can splice finished ripples out as we go.
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i]
      r.age += delta
      const t = r.age / DURATION

      if (t >= 1) {
        this.scene.remove(r.mesh)
        ;(r.mesh.material as THREE.Material).dispose() // free the per-ripple material
        this.ripples.splice(i, 1)
        continue
      }

      // Grow outward, fade out.
      r.mesh.scale.setScalar(START_SCALE + (r.maxScale - START_SCALE) * t)
      ;(r.mesh.material as THREE.MeshBasicMaterial).opacity = START_OPACITY * (1 - t)
    }
  }
}
