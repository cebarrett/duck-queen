/** The follower cap and the Marsh Baron's engagement gate are the same number by
 *  design: a full flock is exactly enough to challenge him, and the cap holds until
 *  he falls. Defining it once here means lowering the cap during balancing also
 *  lowers the gate — the two can never silently drift apart. */
export const FOLLOWER_CAP = 10

/** Plain-data campaign flags. Game owns this object; Geese writes to it; Flock,
 *  Swan (via Game), and the HUD (via Game) read from it.
 *
 *  The first five are the beginner-quest milestones — once true they stay true.
 *  They're latched (not read live) because the things they track (a one-off chat,
 *  food/reed stock, flock size) don't persist as live state, and a tutorial
 *  milestone should never un-complete. `metSwan` is latched by Game when a talk with
 *  Aldermere opens; the rest are flipped in updateBeginnerQuests().
 *
 *  The three `questGiven*` flags gate the main story quests: each unlocks the
 *  moment the player first talks to Aldermere at the right point in the campaign.
 *  That way Aldermere is the one who sends the Queen on each act, not the UI. */
export interface Progress {
  metSwan: boolean
  foragedFood: boolean
  gatheredReeds: boolean
  builtNest: boolean
  ralliedFlock: boolean
  baronDefeated: boolean
  treatyDefeated: boolean
  questGivenBaron: boolean
  questGivenTreaty: boolean
  questGivenFrontier: boolean
}

export function makeProgress(): Progress {
  return {
    metSwan: false,
    foragedFood: false,
    gatheredReeds: false,
    builtNest: false,
    ralliedFlock: false,
    baronDefeated: false,
    treatyDefeated: false,
    questGivenBaron: false,
    questGivenTreaty: false,
    questGivenFrontier: false,
  }
}
