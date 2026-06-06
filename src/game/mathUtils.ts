/**
 * Small shared math helpers used across the game.
 */

/**
 * Step `current` toward `target` (both radians) by fraction `t`, going the SHORT
 * way around the circle so we never spin the long way past the ±π seam. Used for
 * smoothly turning a duck to face where it's walking.
 */
export function approachAngle(current: number, target: number, t: number): number {
  let diff = target - current
  diff = Math.atan2(Math.sin(diff), Math.cos(diff)) // wrap into [-PI, PI]
  return current + diff * Math.min(t, 1)
}

/** A random number in [min, max). */
export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/**
 * Frame-rate-independent smoothing factor for an exponential ease. Multiply a
 * (target − current) difference by this to glide a fraction of the way there each
 * frame, at a rate that feels the same whether you run at 30fps or 144fps:
 *   value += (target − value) * easeFactor(rate, delta)
 * Higher `rate` = snappier; lower = heavier and laggier. This little `1 − e^(−k·dt)`
 * trick is the heartbeat of all the game's "ease toward" motion.
 */
export function easeFactor(rate: number, delta: number): number {
  return 1 - Math.exp(-rate * delta)
}

/** The outcome of a seek-with-arrival: the desired velocity, and whether the body
 *  is close enough to count as "arrived" (within stopRadius of the target). */
export interface SeekResult {
  vx: number
  vz: number
  arrived: boolean
}

/**
 * "Seek with arrival": the desired velocity to head from `pos` toward
 * (targetX, targetZ) at `topSpeed`, easing down to a stop as it nears — full
 * speed until within `arriveRadius`, then ramping linearly to 0 at the target.
 * Reports `arrived: true` (with zero velocity) once within `stopRadius`, so the
 * caller can switch state (pause, eat, flee-done…). Pass `arriveRadius = 0` for a
 * flat-out dash with no slow-down near the goal (e.g. a fleeing goose).
 *
 * This is the shared core of every "go to a point" behaviour — wandering,
 * foraging, fleeing, chasing a distraction — across the ducklings and geese.
 */
export function seekArrive(
  pos: { x: number; z: number },
  targetX: number,
  targetZ: number,
  topSpeed: number,
  arriveRadius: number,
  stopRadius: number,
): SeekResult {
  const dx = targetX - pos.x
  const dz = targetZ - pos.z
  const dist = Math.hypot(dx, dz)
  if (dist < stopRadius) return { vx: 0, vz: 0, arrived: true }
  if (dist === 0) return { vx: 0, vz: 0, arrived: false } // exactly on target: no direction
  const speed = dist < arriveRadius ? topSpeed * (dist / arriveRadius) : topSpeed
  return { vx: (dx / dist) * speed, vz: (dz / dist) * speed, arrived: false }
}

/**
 * A random point within `radius` of (homeX, homeZ) — the next spot for an idle
 * wanderer to amble to. Uses `Math.random` by default (wander targets are
 * gameplay, not world generation); pass a seeded `rng` if you ever need it stable.
 */
export function pointAround(
  homeX: number,
  homeZ: number,
  radius: number,
  rng: () => number = Math.random,
): { x: number; z: number } {
  const angle = rng() * Math.PI * 2
  const r = rng() * radius
  return { x: homeX + Math.cos(angle) * r, z: homeZ + Math.sin(angle) * r }
}

/**
 * Turn `heading` (radians) to face the travel direction (velX, velZ), rotating at
 * `turnSpeed` rad/sec the short way around. Holds the current heading when barely
 * moving (speed ≤ `minSpeed`) so a near-stationary body doesn't jitter its facing.
 * Returns the new heading.
 */
export function faceHeading(
  heading: number,
  velX: number,
  velZ: number,
  turnSpeed: number,
  delta: number,
  minSpeed = 0.05,
): number {
  if (Math.hypot(velX, velZ) <= minSpeed) return heading
  const target = Math.atan2(-velX, -velZ) // a body faces −Z at heading 0
  return approachAngle(heading, target, turnSpeed * delta)
}
