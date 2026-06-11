import { describe, it, expect } from 'vitest'
import { approachAngle, easeFactor, seekArrive, faceHeading } from './mathUtils'

const TAU = Math.PI * 2

describe('approachAngle', () => {
  it('moves a fraction of the way toward the target', () => {
    expect(approachAngle(0, 1, 0.5)).toBeCloseTo(0.5)
  })

  it('takes the SHORT way around the ±π seam', () => {
    // From +3.0 rad, the target -3.0 rad is only ~0.28 rad away the short way
    // (across the seam), NOT ~6 rad the long way. A half-step should cross the
    // seam, landing just past ±π, not swing back toward 0.
    const result = approachAngle(3.0, -3.0, 0.5)
    // Short-way midpoint is near ±π (~3.14), wrapped — verify it didn't go the
    // long way (which would head toward 0).
    const wrapped = Math.atan2(Math.sin(result), Math.cos(result))
    expect(Math.abs(wrapped)).toBeGreaterThan(3.0)
  })

  it('clamps t to 1 (never overshoots)', () => {
    expect(approachAngle(0, 1, 5)).toBeCloseTo(1)
  })

  it('stays put when already on target', () => {
    expect(approachAngle(1.234, 1.234, 0.5)).toBeCloseTo(1.234)
  })
})

describe('easeFactor', () => {
  it('is 0 at zero delta and approaches 1 over time', () => {
    expect(easeFactor(5, 0)).toBeCloseTo(0)
    expect(easeFactor(5, 100)).toBeCloseTo(1)
  })

  it('is monotonic in both rate and delta', () => {
    expect(easeFactor(10, 0.1)).toBeGreaterThan(easeFactor(5, 0.1))
    expect(easeFactor(5, 0.2)).toBeGreaterThan(easeFactor(5, 0.1))
  })
})

describe('seekArrive', () => {
  const pos = { x: 0, z: 0 }

  it('reports arrived (zero velocity) within stopRadius', () => {
    const r = seekArrive({ x: 0, z: 0 }, 0.1, 0, 5, 2, 0.5)
    expect(r.arrived).toBe(true)
    expect(r.vx).toBe(0)
    expect(r.vz).toBe(0)
  })

  it('runs at top speed beyond the arrive radius', () => {
    const r = seekArrive(pos, 10, 0, 5, 2, 0.5)
    expect(r.arrived).toBe(false)
    expect(Math.hypot(r.vx, r.vz)).toBeCloseTo(5) // full topSpeed, heading +x
    expect(r.vx).toBeCloseTo(5)
    expect(r.vz).toBeCloseTo(0)
  })

  it('eases down linearly inside the arrive radius', () => {
    // Halfway into the arrive radius -> half top speed.
    const r = seekArrive(pos, 1, 0, 5, 2, 0.5)
    expect(Math.hypot(r.vx, r.vz)).toBeCloseTo(2.5)
  })

  it('handles being exactly on target without dividing by zero', () => {
    const r = seekArrive(pos, 0, 0, 5, 2, 0) // stopRadius 0 so it doesn't early-return
    expect(r.arrived).toBe(false)
    expect(r.vx).toBe(0)
    expect(r.vz).toBe(0)
  })
})

describe('faceHeading', () => {
  it('holds heading when barely moving (no jitter)', () => {
    expect(faceHeading(1.5, 0.01, 0.01, 10, 0.016)).toBe(1.5)
  })

  it('turns toward the travel direction', () => {
    // Moving in +x; a body faces -z at heading 0, so it should rotate away from 0.
    const h = faceHeading(0, 1, 0, 10, 0.016)
    expect(h).not.toBe(0)
    expect(Math.abs(h)).toBeGreaterThan(0)
    expect(Math.abs(h)).toBeLessThanOrEqual(TAU)
  })
})
