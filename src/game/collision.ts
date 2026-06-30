/**
 * Shared world collision against the scenery (trees, rocks). Pure functions — no
 * THREE objects, no entity state — so the Queen, ducklings, and geese can all use
 * them, and the geometry is easy to reason about (and test) in isolation.
 */

/**
 * A solid obstacle as a vertical cylinder: a circle on the ground (x, z + radius)
 * that exists between heights yMin and yMax. A body collides with it only while
 * its own height range overlaps [yMin, yMax] — so you fly over the top, or walk
 * under a canopy that floats above you. (Trees push two of these: a thin trunk
 * from the ground, and a wider canopy up at leaf height.)
 */
export interface Collider {
  x: number
  z: number
  radius: number
  yMin: number
  yMax: number
}

/**
 * Push a body — a circle of `radius`, standing `height` tall with feet at `feet`
 * — out of the SIDES of any obstacle it overlaps, and cancel the part of its
 * velocity heading into the obstacle so it slides along instead of sticking.
 *
 * Obstacles whose top is within `stepUp` of the feet are treated as floors and
 * skipped here (handled by the vertical pass) rather than walls — that's how the
 * Queen stands on / steps onto low rocks. Creatures that don't climb pass
 * `stepUp = 0`, so every obstacle is a solid wall to walk around.
 *
 * Mutates `pos` (x/z) and `vel` (x/z) in place. `pos`/`vel` just need x and z, so
 * a THREE.Vector3 or a plain {x, z} both work.
 */
export function resolveWalls(
  pos: { x: number; z: number },
  vel: { x: number; z: number },
  radius: number,
  feet: number,
  height: number,
  stepUp: number,
  colliders: readonly Collider[],
): void {
  const head = feet + height

  for (const c of colliders) {
    if (head <= c.yMin) continue // whole body is below it -> walk under
    if (feet >= c.yMax - stepUp) continue // on top of it / can step up -> floor, not wall

    // Circle-vs-circle on the ground plane.
    const dx = pos.x - c.x
    const dz = pos.z - c.z
    const minDist = c.radius + radius
    const distSq = dx * dx + dz * dz
    if (distSq >= minDist * minDist) continue // not overlapping

    // Push out along the line from the obstacle's centre to the body.
    const dist = Math.sqrt(distSq) || 0.0001
    const nx = dx / dist
    const nz = dz / dist
    pos.x = c.x + nx * minDist
    pos.z = c.z + nz * minDist

    // Remove the velocity component pointing into the obstacle, keeping the
    // sideways part so it slides around.
    const into = vel.x * nx + vel.z * nz
    if (into < 0) {
      vel.x -= into * nx
      vel.z -= into * nz
    }
  }
}

/**
 * The height of the floor under a body at (x, z): the highest obstacle-top it's
 * standing over whose surface is at most `stepUp` above its feet, or the bare
 * ground if none. The stepUp limit means a rock it's descended onto / can step
 * up to supports it, while a tall treetop far overhead doesn't yank it upward.
 *
 * `groundBase` is the height of the ground itself under (x, z) — 0 on the old
 * flat world, or the rolling terrain height once there are hills. Obstacle tops
 * (yMax) are absolute world heights (scenery is placed sitting ON the terrain),
 * so the only change hills need is to start the search from the terrain instead
 * of from 0.
 */
export function floorHeightAt(
  x: number,
  z: number,
  feet: number,
  radius: number,
  stepUp: number,
  colliders: readonly Collider[],
  groundBase = 0,
): number {
  let support = groundBase // the ground is always under you, flat or hilly
  for (const c of colliders) {
    const dx = x - c.x
    const dz = z - c.z
    const reach = c.radius + radius
    if (dx * dx + dz * dz >= reach * reach) continue // not standing over it
    if (c.yMax <= feet + stepUp) support = Math.max(support, c.yMax)
  }
  return support
}
