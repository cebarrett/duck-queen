import type { Progress } from './Progress'

/**
 * The quest log: a read-only view of the campaign's goals. The goals themselves
 * already live as state elsewhere — the beginner milestones and the Marsh Baron /
 * Treaty Flats as flags on `Progress`, the frontier as reclaimed-pond counts on
 * `Frontier` — so this module owns no state of its own. It just holds the quest
 * *copy* in one place and derives each quest's current standing from that state.
 *
 * The log is a beginner chain (swan → forage → reeds → nest → flock) that teaches
 * the basics, followed by the three main-story quests. Both are sequential (each
 * unlocks the next) and cannot be cancelled, so there's no "abandon" notion here.
 * Kept free of THREE/DOM imports so it stays a pure, testable function like
 * rng.ts/mathUtils.ts.
 */
export type QuestState = 'locked' | 'active' | 'complete'

/** A small payout granted once, the first time a quest completes. Plain data so
 *  Game can hand it straight to `food`/`reeds` gain() and the HUD can render it. */
export interface QuestReward {
  readonly food?: number
  readonly reeds?: number
}

export interface QuestView {
  readonly title: string
  /** Shown only once the quest is unlocked (state !== 'locked'); hidden until then. */
  readonly summary: string
  readonly state: QuestState
  /** A short progress note, e.g. '2/4 ponds reclaimed' — only on quests that track it. */
  readonly progress?: string
  /** What completing the quest pays out. Game grants it once on completion; the
   *  log shows it (via formatReward) as an incentive while active and a receipt
   *  once complete. */
  readonly reward: QuestReward
}

/** Render a reward as a short line like '🌿 +3 food' or '🌿 +10 food · 🌾 +10 reeds',
 *  using the same 🌿/🌾 icons the HUD shows for the food and reed counters. Shared by
 *  the quest log and the completion toast so they never disagree. */
export function formatReward(reward: QuestReward): string {
  const parts: string[] = []
  if (reward.food) parts.push(`🌿 +${reward.food} food`)
  if (reward.reeds) parts.push(`🌾 +${reward.reeds} reeds`)
  return parts.join(' · ')
}

/** Beginner-quest goals. Single source of truth — Game imports these to know when
 *  to latch the matching `Progress` flag, and they're woven into the quest copy
 *  below. REEDS_GOAL equals the nest cost on purpose: finishing it leaves exactly
 *  enough reeds to weave the first nest. */
export const FOOD_GOAL = 5
export const REEDS_GOAL = 10
export const NEST_GOAL = 1
export const FLOCK_GOAL = 6

/** Live gathered-resource/flock counts, passed in so this module needn't touch the
 *  game systems. Only used for the active beginner quest's progress note —
 *  completion itself is latched on `Progress`, not read from these. */
export interface QuestCounts {
  readonly food: number
  readonly reeds: number
  readonly nests: number
  readonly flock: number
}

/**
 * Derive every quest's current view from campaign state. The beginner counts and
 * the frontier are passed as plain numbers (not the game systems / Frontier object)
 * so this module needn't depend on THREE — Game already has the numbers to hand.
 */
export function questViews(
  progress: Progress,
  counts: QuestCounts,
  frontierClaimed: number,
  frontierTotal: number,
): QuestView[] {
  // --- Beginner chain: a sequential tutorial. Each step unlocks once the prior
  //     milestone is latched, and completes once its own flag is set. The progress
  //     note shows the live count while a step is active (it's hidden once locked
  //     or complete, so it never displays a stale or post-spend number).
  // The opening lesson: meet Aldermere, the old swan, who sends you off to forage.
  const swan: QuestState = progress.metSwan ? 'complete' : 'active'
  const forage: QuestState = progress.foragedFood
    ? 'complete'
    : progress.metSwan
      ? 'active'
      : 'locked'
  const reeds: QuestState = progress.gatheredReeds
    ? 'complete'
    : progress.foragedFood
      ? 'active'
      : 'locked'
  const nest: QuestState = progress.builtNest
    ? 'complete'
    : progress.gatheredReeds
      ? 'active'
      : 'locked'
  const rally: QuestState = progress.ralliedFlock
    ? 'complete'
    : progress.builtNest
      ? 'active'
      : 'locked'

  // Act I: Aldermere sends the Queen after the Marsh Baron on the first talk.
  const baron: QuestState = progress.baronDefeated
    ? 'complete'
    : progress.questGivenBaron
      ? 'active'
      : 'locked'

  // Act II: Aldermere gives this quest the first time the Queen speaks to him
  // after the Baron falls.
  const treaty: QuestState = progress.treatyDefeated
    ? 'complete'
    : progress.questGivenTreaty && progress.baronDefeated
      ? 'active'
      : 'locked'

  // Act III: Aldermere gives this quest the first time the Queen speaks to him
  // after the Treaty Flats are held; done when every far pond is reclaimed.
  const frontierDone = frontierTotal > 0 && frontierClaimed === frontierTotal
  const frontier: QuestState = frontierDone
    ? 'complete'
    : progress.questGivenFrontier && progress.treatyDefeated
      ? 'active'
      : 'locked'

  return [
    {
      title: 'Meet Aldermere the swan',
      summary:
        'An old swan named Aldermere glides your pond. Swim out to him and press F to talk — he keeps the count of every Duck Queen and has counsel for a young crown.',
      state: swan,
      reward: { reeds: 1 },
    },
    {
      title: 'Forage for food',
      summary:
        'Waddle over the wild plants dotting the marsh to gather food — your flock eats to hatch and grow. Bring in a first store of food.',
      state: forage,
      progress: `${Math.min(counts.food, FOOD_GOAL)}/${FOOD_GOAL} food gathered`,
      reward: { reeds: 5 },
    },
    {
      title: 'Gather reeds',
      summary:
        'Reeds line every pond, and only the Queen can pull them. Gather a bundle — enough to weave your first nest.',
      state: reeds,
      progress: `${Math.min(counts.reeds, REEDS_GOAL)}/${REEDS_GOAL} reeds gathered`,
      reward: { food: 3 },
    },
    {
      title: 'Build a nest',
      summary:
        'On dry land, press B to weave a nest from your reeds. A nest is where a hen broods eggs into new ducklings.',
      state: nest,
      progress: `${Math.min(counts.nests, NEST_GOAL)}/${NEST_GOAL} nests built`,
      reward: { food: 5 },
    },
    {
      title: 'Rally your flock',
      summary:
        'Press Q to quack and rally nearby ducks to follow you. Gather a proper little flock at your side.',
      state: rally,
      progress: `${Math.min(counts.flock, FLOCK_GOAL)}/${FLOCK_GOAL} ducks following`,
      reward: { food: 5, reeds: 5 },
    },
    {
      title: 'Break the Marsh Baron',
      summary:
        'Aldermere has marked a goose past the reeds who fancies himself a Baron. Rally a formidable flock and out-honk him to win the marsh — victory lifts the flock cap.',
      state: baron,
      reward: { food: 10, reeds: 10 },
    },
    {
      title: 'Hold the Treaty Flats',
      summary:
        'Aldermere warns that Lord Boundary has staked a claim on the Treaty Flats. Settle there — build and brood nests — then face him down.',
      state: treaty,
      reward: { food: 10, reeds: 10 },
    },
    {
      title: 'Take the Frontier Ponds',
      summary:
        'Aldermere points to the far ponds, each held by a lieutenant gander. Out-honk each one to fly your banner over the whole frontier.',
      state: frontier,
      progress: `${frontierClaimed}/${frontierTotal} ponds reclaimed`,
      reward: { food: 15, reeds: 15 },
    },
  ]
}
