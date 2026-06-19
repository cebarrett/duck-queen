import type { Progress } from './Progress'

/**
 * The quest log: a read-only view of the campaign's main-story goals. The goals
 * themselves already live as state elsewhere — the Marsh Baron and Treaty Flats
 * as flags on `Progress`, the frontier as reclaimed-pond counts on `Frontier` —
 * so this module owns no state of its own. It just holds the quest *copy* in one
 * place and derives each quest's current standing from that state.
 *
 * All three are sequential main-story quests (each unlocks the next) and cannot be
 * cancelled, so there's no "side quest" or "abandon" notion here. Kept free of
 * THREE/DOM imports so it stays a pure, testable function like rng.ts/mathUtils.ts.
 */
export type QuestState = 'locked' | 'active' | 'complete'

export interface QuestView {
  readonly title: string
  /** Shown only once the quest is unlocked (state !== 'locked'); hidden until then. */
  readonly summary: string
  readonly state: QuestState
  /** A short progress note, e.g. '2/4 ponds reclaimed' — only on quests that track it. */
  readonly progress?: string
}

/**
 * Derive the three main-story quests' current views from campaign state. The
 * frontier is passed as plain counts (not the Frontier object) so this module
 * needn't depend on Frontier/THREE — Game already has the numbers to hand.
 */
export function questViews(
  progress: Progress,
  frontierClaimed: number,
  frontierTotal: number,
): QuestView[] {
  // The opening quest: always available from the very start.
  const baron: QuestState = progress.baronDefeated ? 'complete' : 'active'

  // Act II opens once the Baron falls.
  const treaty: QuestState = progress.treatyDefeated
    ? 'complete'
    : progress.baronDefeated
      ? 'active'
      : 'locked'

  // Act III opens once the Treaty Flats hold; done when every far pond is reclaimed.
  const frontierDone = frontierTotal > 0 && frontierClaimed === frontierTotal
  const frontier: QuestState = frontierDone
    ? 'complete'
    : progress.treatyDefeated
      ? 'active'
      : 'locked'

  return [
    {
      title: 'Break the Marsh Baron',
      summary:
        'Rally a formidable flock and out-honk the Marsh Baron to win the marsh — victory lifts the flock cap.',
      state: baron,
    },
    {
      title: 'Hold the Treaty Flats',
      summary:
        'Settle the Treaty Flats — build and brood nests there — then face down Lord Boundary.',
      state: treaty,
    },
    {
      title: 'Take the Frontier Ponds',
      summary:
        'Out-honk the lieutenant gander at each outlying pond to fly your banner over the whole frontier.',
      state: frontier,
      progress: `${frontierClaimed}/${frontierTotal} ponds reclaimed`,
    },
  ]
}
