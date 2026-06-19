/** The follower cap and the Marsh Baron's engagement gate are the same number by
 *  design: a full flock is exactly enough to challenge him, and the cap holds until
 *  he falls. Defining it once here means lowering the cap during balancing also
 *  lowers the gate — the two can never silently drift apart. */
export const FOLLOWER_CAP = 10

/** Plain-data campaign flags. Game owns this object; Geese writes to it; Flock,
 *  Swan (via Game), and the HUD (via Game) read from it.
 *
 *  The first four are the beginner-quest milestones — once true they stay true.
 *  They're latched (not read live) because the things they track (food/reed stock,
 *  flock size) all fall again as you spend or lose them, and a tutorial milestone
 *  should never un-complete. Game flips them in updateBeginnerQuests(). */
export interface Progress {
  foragedFood: boolean
  gatheredReeds: boolean
  builtNest: boolean
  ralliedFlock: boolean
  baronDefeated: boolean
  treatyDefeated: boolean
}

export function makeProgress(): Progress {
  return {
    foragedFood: false,
    gatheredReeds: false,
    builtNest: false,
    ralliedFlock: false,
    baronDefeated: false,
    treatyDefeated: false,
  }
}
