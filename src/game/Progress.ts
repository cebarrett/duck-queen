/** The follower cap and the Marsh Baron's engagement gate are the same number by
 *  design: a full flock is exactly enough to challenge him, and the cap holds until
 *  he falls. Defining it once here means lowering the cap during balancing also
 *  lowers the gate — the two can never silently drift apart. */
export const FOLLOWER_CAP = 10

/** Plain-data campaign flags. Game owns this object; Geese writes to it; Flock,
 *  Swan (via Game), and the HUD (via Game) read from it. */
export interface Progress {
  baronDefeated: boolean
  treatyDefeated: boolean
}

export function makeProgress(): Progress {
  return { baronDefeated: false, treatyDefeated: false }
}
