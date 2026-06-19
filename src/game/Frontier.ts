import type * as THREE from 'three'
import { type PondCircle, CLEAN_WATER } from './Water'
import type { FrontierSlice } from './persistence/saveSchema'

/**
 * The frontier: the outlying ponds the geese hold, and which of them the Queen has
 * reclaimed. This is the campaign's Act III — after the Marsh Baron and Lord
 * Boundary, the swan's "furthest, sleepiest edge". For now reclaiming is a pure
 * honk-off against each pond's lieutenant (see Geese.ts); this class only owns the
 * *ownership state* and the pond's water tint, so the rest of the game (the
 * minimap, the HUD, the flock's home, the swan) can ask it who holds what.
 *
 * The status enum keeps room for a future 'contested' state (geese trying to retake
 * a pond) and a settlement gate, so those can be layered in without reshaping this.
 */
export type TerritoryStatus = 'enemy' | 'claimed'

export interface Territory {
  readonly pond: PondCircle
  status: TerritoryStatus
  /** The pond disc's own material — retinted clean blue when reclaimed. */
  readonly tint: THREE.MeshStandardMaterial
}

/** One contestable pond + the handle to its water material (from Pond.addContestedCircle). */
export interface FrontierPond {
  readonly pond: PondCircle
  readonly tint: THREE.MeshStandardMaterial
}

export class Frontier {
  private readonly territories: Territory[]

  constructor(ponds: readonly FrontierPond[]) {
    this.territories = ponds.map(({ pond, tint }) => ({ pond, status: 'enemy' as const, tint }))
  }

  get total(): number {
    return this.territories.length
  }

  get claimedCount(): number {
    let n = 0
    for (const t of this.territories) if (t.status === 'claimed') n++
    return n
  }

  /** True once every frontier pond flies the Queen's banner (and there's at least one). */
  get allClaimed(): boolean {
    return this.total > 0 && this.claimedCount === this.total
  }

  /** The territories, in the same order Geese spawns its lieutenants — so a
   *  lieutenant and its pond stay paired by index. */
  get list(): readonly Territory[] {
    return this.territories
  }

  /** Snapshot each territory's ownership, in `list` order. */
  toSave(): FrontierSlice {
    return { statuses: this.territories.map((t) => t.status) }
  }

  /** Re-apply saved ownership: claim() each territory the save records as the Queen's,
   *  which also retints its water — reusing the live reclaim path rather than poking
   *  status directly. Index-aligned with `list`; extra/missing entries are skipped. */
  restore(slice: FrontierSlice): void {
    slice.statuses.forEach((status, i) => {
      const t = this.territories[i]
      if (t && status === 'claimed') this.claim(t)
    })
  }

  /** Reclaim a pond: flip it to the Queen's and clear its water from murky to blue. */
  claim(territory: Territory): void {
    if (territory.status === 'claimed') return
    territory.status = 'claimed'
    territory.tint.color.setHex(CLEAN_WATER)
  }

  /** Reclaimed ponds, for the flock to treat as home water when the Queen is away. */
  get claimedPonds(): PondCircle[] {
    return this.territories.filter((t) => t.status === 'claimed').map((t) => t.pond)
  }

  /** Per-pond ownership for the minimap (drawn as a ring tinted by who holds it). */
  get minimapTerritories(): { x: number; z: number; radius: number; claimed: boolean }[] {
    return this.territories.map((t) => ({
      x: t.pond.x,
      z: t.pond.z,
      radius: t.pond.radius,
      claimed: t.status === 'claimed',
    }))
  }
}
