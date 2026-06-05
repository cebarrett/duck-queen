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
