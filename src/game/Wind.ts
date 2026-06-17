import * as THREE from 'three'

/**
 * A gentle, world-wide breeze. One shared clock drives every registered mesh;
 * each leans on a sine wave offset by a per-object phase (derived from its
 * position) so the field looks like a wind passing through rather than every
 * object twitching in lockstep.
 *
 * This is PURELY visual: it only rotates the display mesh's `rotation.z`. The
 * colliders are separate static data (see collision.ts), so swaying a tree or
 * reed never changes what you bump into.
 *
 * Lifecycle: a registered mesh that gets removed from the scene (e.g. a reed the
 * Queen harvests) is dropped lazily on the next update when its `.parent` goes
 * null — so callers don't have to unregister.
 */
const SPEED = 1.2 // radians/sec of the breeze oscillation

interface Swayable {
  mesh: THREE.Object3D
  baseZ: number // the mesh's resting z-rotation, so we sway AROUND its natural lean
  amp: number // lean amplitude in radians
  phase: number // per-object offset so the field isn't synchronized
}

export class Wind {
  private readonly items: Swayable[] = []
  private time = 0

  /** Register a mesh to sway. `amp` is the lean amplitude (radians); `phase`
   *  should be derived from the object's position so it's deterministic. */
  register(mesh: THREE.Object3D, amp: number, phase: number): void {
    this.items.push({ mesh, baseZ: mesh.rotation.z, amp, phase })
  }

  /** A deterministic phase from a world position — no rng draw, so registering
   *  swayables never perturbs the seeded layout. */
  static phaseFor(x: number, z: number): number {
    return x * 0.7 + z * 0.5
  }

  update(delta: number): void {
    this.time += delta
    // Iterate backwards so we can drop meshes that have left the scene.
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]
      if (!it.mesh.parent) {
        this.items.splice(i, 1)
        continue
      }
      it.mesh.rotation.z = it.baseZ + Math.sin(this.time * SPEED + it.phase) * it.amp
    }
  }
}
