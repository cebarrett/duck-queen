/**
 * The world's rolling terrain — gentle hills so the ground isn't one flat sheet.
 *
 * It's WORLD GENERATION, so the shape is deterministic: built once from a seeded
 * `Rng` stream (see rng.ts), the same seed always raises the same hills. The
 * height is a smooth sum of a few sine waves ("octaves") at different
 * directions, wavelengths and amplitudes — cheap to sample anywhere, and smooth
 * enough that the displaced ground lights cleanly and creatures glide up and
 * down it without stair-steps.
 *
 * `heightAt(x, z)` is the single source of truth for "how high is the ground
 * here?": the ground mesh is displaced by it, the Queen's shared floor
 * (`floorHeightAt`) starts from it, scenery sits on it, and every ground creature
 * rides it. Keeping it one pure function means the hills can't disagree with
 * themselves between systems.
 *
 * Some places must stay LEVEL — the spawn clearing, every pond (so the flat
 * water disc isn't swallowed by a hill), and the Treaty Flats arena. Register
 * those with `flatten()`; inside a flat zone the height eases back to 0, with a
 * soft falloff so the bank rises gently away from it.
 */
import { rngRange, type Rng } from './rng'

/** One sine wave contributing to the terrain: a travelling ripple in some
 *  direction, of a given wavelength, amplitude and phase. */
interface Wave {
  dirX: number
  dirZ: number
  freq: number
  phase: number
  amp: number
}

/** A region kept flat: level out to `radius`, then ease back to full hills over
 *  the next `falloff` units. */
interface FlatZone {
  x: number
  z: number
  radius: number
  falloff: number
}

const OCTAVES = 5
// The biggest swell's amplitude (units). Each finer octave is gentler. Kept
// modest so the hills are cozy and walkable, never cliffs.
const BASE_AMPLITUDE = 1.5
const AMPLITUDE_FALLOFF = 0.6 // each octave is 60% as tall as the last
const BASE_WAVELENGTH = 85 // the broadest swell spans ~85 units…
const WAVELENGTH_FALLOFF = 0.6 // …and finer octaves get shorter
const MIN_WAVELENGTH = 20 // but never so short they alias on the ground grid

export class Terrain {
  private readonly waves: Wave[] = []
  private readonly flats: FlatZone[] = []

  constructor(rng: Rng) {
    for (let i = 0; i < OCTAVES; i++) {
      const angle = rng() * Math.PI * 2
      const wavelength = Math.max(
        MIN_WAVELENGTH,
        BASE_WAVELENGTH * WAVELENGTH_FALLOFF ** i * rngRange(rng, 0.8, 1.2),
      )
      this.waves.push({
        dirX: Math.cos(angle),
        dirZ: Math.sin(angle),
        freq: (Math.PI * 2) / wavelength,
        phase: rng() * Math.PI * 2,
        amp: BASE_AMPLITUDE * AMPLITUDE_FALLOFF ** i * rngRange(rng, 0.85, 1.15),
      })
    }
  }

  /** Keep a disc of the world level: flat out to `radius`, easing back to full
   *  hills over the next `falloff` units. Used for the spawn clearing, ponds and
   *  arenas so water and gameplay areas stay sensible. */
  flatten(x: number, z: number, radius: number, falloff: number): void {
    this.flats.push({ x, z, radius, falloff })
  }

  /** The ground height at (x, z) — the one number every system measures from. */
  heightAt(x: number, z: number): number {
    let h = 0
    for (const w of this.waves) {
      h += w.amp * Math.sin((w.dirX * x + w.dirZ * z) * w.freq + w.phase)
    }
    return h * this.flatFactor(x, z)
  }

  /** 0 inside any flat zone, 1 out where the hills are full, smoothly between. A
   *  point in several zones takes the flattest (the min), so overlapping clearings
   *  don't fight each other. */
  private flatFactor(x: number, z: number): number {
    let factor = 1
    for (const zone of this.flats) {
      const d = Math.hypot(x - zone.x, z - zone.z)
      if (d <= zone.radius) return 0
      if (d < zone.radius + zone.falloff) {
        const t = (d - zone.radius) / zone.falloff
        factor = Math.min(factor, t * t * (3 - 2 * t)) // smoothstep ease
      }
    }
    return factor
  }
}
