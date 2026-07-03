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
 * The biome map can plug in a smooth per-position amplitude multiplier (the
 * optional `relief` callback), so its regions shape the land: hills swell in the
 * Stony Tors and flatten to bog in the Old Fen, easing across region borders.
 *
 * On top of those gentle swells sit a handful of distinct HILLS — localized
 * cosine-bell mounds placed away from spawn. Most are modest knolls, but a rare
 * one is a grand landmark peak that towers over the flock. Their bells have zero
 * slope at crest and foot, so even the tall ones are smooth, walkable, and read
 * as real hills rather than spikes.
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

/** A lone hill: a cosine-bell mound of height `amp`, fading to 0 at `radius`. */
interface Peak {
  x: number
  z: number
  radius: number
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
// The biggest swell's amplitude (units). Each finer octave is gentler. Bumped up
// from a flatter past so the rolling ground has real relief — still cozy and
// walkable, never cliffs.
const BASE_AMPLITUDE = 2.6
const AMPLITUDE_FALLOFF = 0.6 // each octave is 60% as tall as the last
const BASE_WAVELENGTH = 85 // the broadest swell spans ~85 units…
const WAVELENGTH_FALLOFF = 0.6 // …and finer octaves get shorter
const MIN_WAVELENGTH = 20 // but never so short they alias on the ground grid

// Distinct landmark hills scattered on top of the swells. Most are modest
// knolls; occasionally one is a grand peak that towers over the flock.
const PEAK_COUNT = 7
const PEAK_MIN_DIST = 55 // keep their crests clear of the spawn clearing…
const PEAK_MAX_DIST = 135 // …but inside the scenery spread (ground is 300 wide)
const KNOLL_AMP_MIN = 3.5
const KNOLL_AMP_MAX = 6
const KNOLL_RADIUS_MIN = 20
const KNOLL_RADIUS_MAX = 34
const GRAND_CHANCE = 0.22 // ~1-in-5 hills is a towering landmark instead
const GRAND_AMP_MIN = 9
const GRAND_AMP_MAX = 15
const GRAND_RADIUS_MIN = 38
const GRAND_RADIUS_MAX = 58

export class Terrain {
  private readonly waves: Wave[] = []
  private readonly peaks: Peak[] = []
  private readonly flats: FlatZone[] = []

  /**
   * @param relief optional per-position amplitude multiplier — the biome map
   *   plugs in here so its regions shape the land (the tors' hills swell, the
   *   fen lies low). It must be smooth and deterministic, like the waves.
   */
  constructor(rng: Rng, private readonly relief?: (x: number, z: number) => number) {
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

    for (let i = 0; i < PEAK_COUNT; i++) {
      const angle = rng() * Math.PI * 2
      const dist = rngRange(rng, PEAK_MIN_DIST, PEAK_MAX_DIST)
      const grand = rng() < GRAND_CHANCE
      this.peaks.push({
        x: Math.cos(angle) * dist,
        z: Math.sin(angle) * dist,
        amp: grand
          ? rngRange(rng, GRAND_AMP_MIN, GRAND_AMP_MAX)
          : rngRange(rng, KNOLL_AMP_MIN, KNOLL_AMP_MAX),
        radius: grand
          ? rngRange(rng, GRAND_RADIUS_MIN, GRAND_RADIUS_MAX)
          : rngRange(rng, KNOLL_RADIUS_MIN, KNOLL_RADIUS_MAX),
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
    for (const p of this.peaks) {
      const d = Math.hypot(x - p.x, z - p.z)
      if (d >= p.radius) continue
      // Cosine bell: full height at the crest, easing to 0 at the foot with zero
      // slope at both ends, so even tall hills stay smooth and walkable.
      h += p.amp * 0.5 * (1 + Math.cos((d / p.radius) * Math.PI))
    }
    if (this.relief) h *= this.relief(x, z)
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
