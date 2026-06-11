import { describe, it, expect } from 'vitest'
import { resolveWalls, floorHeightAt, type Collider } from './collision'

// A tall solid post at the origin: radius 1, from the ground up to y=5.
const post: Collider = { x: 0, z: 0, radius: 1, yMin: 0, yMax: 5 }
// A low rock at (10, 0): radius 1, only knee-high (up to y=0.4).
const rock: Collider = { x: 10, z: 0, radius: 1, yMin: 0, yMax: 0.4 }

describe('resolveWalls', () => {
  it('pushes a body out of an obstacle it overlaps', () => {
    // Body of radius 0.5 sitting half inside the post. minDist = 1 + 0.5 = 1.5.
    const pos = { x: 0.5, z: 0 }
    const vel = { x: 0, z: 0 }
    resolveWalls(pos, vel, 0.5, 0, 1.7, 0, [post])
    expect(Math.hypot(pos.x, pos.z)).toBeCloseTo(1.5) // shoved to the surface
  })

  it('cancels velocity heading into the wall but keeps the sideways slide', () => {
    const pos = { x: 0.5, z: 0 }
    const vel = { x: -1, z: 1 } // -x drives into the post, +z slides along it
    resolveWalls(pos, vel, 0.5, 0, 1.7, 0, [post])
    expect(vel.x).toBeCloseTo(0) // into-the-wall component removed
    expect(vel.z).toBeCloseTo(1) // sideways component preserved
  })

  it('leaves a body alone when it is not overlapping', () => {
    const pos = { x: 5, z: 0 }
    const vel = { x: -1, z: 0 }
    resolveWalls(pos, vel, 0.5, 0, 1.7, 0, [post])
    expect(pos).toEqual({ x: 5, z: 0 })
    expect(vel).toEqual({ x: -1, z: 0 })
  })

  it('walks UNDER an obstacle whose bottom is above the head', () => {
    const canopy: Collider = { x: 0, z: 0, radius: 3, yMin: 4, yMax: 8 }
    const pos = { x: 0, z: 0 }
    const vel = { x: 1, z: 0 }
    resolveWalls(pos, vel, 0.5, 0, 1.7, 0, [canopy]) // head at 1.7 < yMin 4
    expect(pos).toEqual({ x: 0, z: 0 }) // untouched
  })

  it('treats a low rock as a wall when the body cannot step up (stepUp 0)', () => {
    const pos = { x: 9.4, z: 0 } // overlapping the rock at (10,0)
    const vel = { x: 1, z: 0 }
    resolveWalls(pos, vel, 0.5, 0, 1.7, 0, [rock])
    expect(pos.x).toBeLessThan(9.4) // pushed back out, not climbed
  })

  it('treats that same rock as a floor (not a wall) when stepUp clears it', () => {
    const pos = { x: 9.4, z: 0 }
    const vel = { x: 1, z: 0 }
    resolveWalls(pos, vel, 0.5, 0, 1.7, 0.5, [rock]) // stepUp 0.5 > rock top 0.4
    expect(pos).toEqual({ x: 9.4, z: 0 }) // unobstructed — handled by floor pass
  })
})

describe('floorHeightAt', () => {
  it('returns ground level (0) when standing over nothing', () => {
    expect(floorHeightAt(50, 50, 0, 0.5, 0.5, [post, rock])).toBe(0)
  })

  it('returns a low rock-top when standing over it and able to step up', () => {
    expect(floorHeightAt(10, 0, 0, 0.5, 0.5, [rock])).toBeCloseTo(0.4)
  })

  it('ignores a surface higher than feet + stepUp (no yanking upward)', () => {
    // Feet on the ground, small stepUp: the 5-high post top is unreachable.
    expect(floorHeightAt(0, 0, 0, 0.5, 0.5, [post])).toBe(0)
  })

  it('takes the highest of several overlapping supports it can reach', () => {
    const lo: Collider = { x: 0, z: 0, radius: 1, yMin: 0, yMax: 0.3 }
    const hi: Collider = { x: 0, z: 0, radius: 1, yMin: 0, yMax: 0.6 }
    expect(floorHeightAt(0, 0, 0, 0.5, 1, [lo, hi])).toBeCloseTo(0.6)
  })
})
