import { describe, it, expect } from 'vitest'
import { questViews, formatReward, type QuestCounts, FLOCK_GOAL, REEDS_GOAL } from './quests'
import { makeProgress, type Progress } from './Progress'

// The quest log is a pure projection of campaign state. These tests pin down both
// chains — the beginner tutorial (swan → forage → reeds → nest → flock) and the main
// story (Baron → Treaty → Frontier) — so the log can't drift from the actual
// progression in Progress/Frontier.

const NO_COUNTS: QuestCounts = { food: 0, reeds: 0, nests: 0, flock: 0 }

// The main-story quests are the last three entries, after the beginner chain.
const story = (progress: Progress, claimed = 0, total = 4, counts: QuestCounts = NO_COUNTS) =>
  questViews(progress, counts, claimed, total).slice(-3)

describe('questViews beginner chain', () => {
  it('starts with only the meet-the-swan quest active, the rest locked', () => {
    const [swan, forage, reeds, nest, rally] = questViews(makeProgress(), NO_COUNTS, 0, 4)
    expect(swan.state).toBe('active')
    expect(forage.state).toBe('locked')
    expect(reeds.state).toBe('locked')
    expect(nest.state).toBe('locked')
    expect(rally.state).toBe('locked')
  })

  it('rewards a single reed for meeting the swan', () => {
    const [swan] = questViews(makeProgress(), NO_COUNTS, 0, 4)
    expect(swan.reward).toEqual({ reeds: 1 })
  })

  it('unlocks each step as the prior milestone latches', () => {
    const progress = makeProgress()
    progress.metSwan = true
    expect(questViews(progress, NO_COUNTS, 0, 4)[1].state).toBe('active') // forage

    progress.foragedFood = true
    expect(questViews(progress, NO_COUNTS, 0, 4)[2].state).toBe('active') // reeds

    progress.gatheredReeds = true
    expect(questViews(progress, NO_COUNTS, 0, 4)[3].state).toBe('active') // nest

    progress.builtNest = true
    expect(questViews(progress, NO_COUNTS, 0, 4)[4].state).toBe('active') // rally

    progress.ralliedFlock = true
    expect(questViews(progress, NO_COUNTS, 0, 4)[4].state).toBe('complete')
  })

  it('shows the live count on the active step (clamped to the goal)', () => {
    const progress = makeProgress()
    progress.metSwan = true
    progress.foragedFood = true // reeds quest is now the active step
    const counts: QuestCounts = { food: 0, reeds: 7, nests: 0, flock: 0 }
    expect(questViews(progress, counts, 0, 4)[2].progress).toBe(`7/${REEDS_GOAL} reeds gathered`)
  })

  it('clamps the progress count so it never overshoots the goal', () => {
    const progress = makeProgress()
    progress.builtNest = true // rally quest is the active step
    const counts: QuestCounts = { food: 0, reeds: 0, nests: 0, flock: 99 }
    expect(questViews(progress, counts, 0, 4)[4].progress).toBe(`${FLOCK_GOAL}/${FLOCK_GOAL} ducks following`)
  })
})

describe('questViews main story', () => {
  it('starts with all acts locked until Aldermere speaks', () => {
    const [baron, treaty, frontier] = story(makeProgress())
    expect(baron.state).toBe('locked')
    expect(treaty.state).toBe('locked')
    expect(frontier.state).toBe('locked')
  })

  it('activates the Baron quest once Aldermere gives it', () => {
    const progress = makeProgress()
    progress.questGivenBaron = true
    const [baron, treaty, frontier] = story(progress)
    expect(baron.state).toBe('active')
    expect(treaty.state).toBe('locked')
    expect(frontier.state).toBe('locked')
  })

  it('Baron quest is independent of the beginner chain once given', () => {
    // Completing or skipping beginner quests doesn't affect the Baron quest state.
    const progress = makeProgress()
    progress.questGivenBaron = true
    expect(story(progress)[0].state).toBe('active')
    progress.foragedFood = true
    progress.gatheredReeds = true
    progress.builtNest = true
    progress.ralliedFlock = true
    expect(story(progress)[0].state).toBe('active')
  })

  it('completes the Baron quest once he falls', () => {
    const progress = makeProgress()
    progress.questGivenBaron = true
    progress.baronDefeated = true
    const [baron, treaty, frontier] = story(progress)
    expect(baron.state).toBe('complete')
    expect(treaty.state).toBe('locked') // Aldermere hasn't given Treaty yet
    expect(frontier.state).toBe('locked')
  })

  it('activates Treaty once Aldermere gives it after the Baron falls', () => {
    const progress = makeProgress()
    progress.questGivenBaron = true
    progress.baronDefeated = true
    progress.questGivenTreaty = true
    const [baron, treaty, frontier] = story(progress)
    expect(baron.state).toBe('complete')
    expect(treaty.state).toBe('active')
    expect(frontier.state).toBe('locked') // still gated on the Treaty
  })

  it('opens the frontier once Aldermere gives it and the Treaty holds', () => {
    const progress = makeProgress()
    progress.questGivenBaron = true
    progress.baronDefeated = true
    progress.questGivenTreaty = true
    progress.treatyDefeated = true
    progress.questGivenFrontier = true
    const [, treaty, frontier] = story(progress, 1, 4)
    expect(treaty.state).toBe('complete')
    expect(frontier.state).toBe('active')
    expect(frontier.progress).toBe('1/4 ponds reclaimed')
  })

  it('only completes the frontier when every pond is reclaimed', () => {
    const progress = makeProgress()
    progress.questGivenBaron = true
    progress.baronDefeated = true
    progress.questGivenTreaty = true
    progress.treatyDefeated = true
    progress.questGivenFrontier = true
    expect(story(progress, 3, 4)[2].state).toBe('active')
    expect(story(progress, 4, 4)[2].state).toBe('complete')
  })

  it('does not count an empty frontier (no ponds) as complete', () => {
    const progress = makeProgress()
    progress.questGivenBaron = true
    progress.baronDefeated = true
    progress.questGivenTreaty = true
    progress.treatyDefeated = true
    progress.questGivenFrontier = true
    expect(story(progress, 0, 0)[2].state).toBe('active')
  })
})

describe('quest rewards', () => {
  it('gives every quest a non-empty reward', () => {
    const views = questViews(makeProgress(), NO_COUNTS, 0, 4)
    for (const q of views) {
      expect((q.reward.food ?? 0) + (q.reward.reeds ?? 0)).toBeGreaterThan(0)
    }
  })
})

describe('formatReward', () => {
  it('renders a single resource', () => {
    expect(formatReward({ food: 3 })).toBe('🌿 +3 food')
    expect(formatReward({ reeds: 5 })).toBe('🌾 +5 reeds')
  })

  it('joins food and reeds with a separator', () => {
    expect(formatReward({ food: 10, reeds: 10 })).toBe('🌿 +10 food · 🌾 +10 reeds')
  })

  it('skips zero or missing amounts', () => {
    expect(formatReward({ food: 0, reeds: 5 })).toBe('🌾 +5 reeds')
    expect(formatReward({})).toBe('')
  })
})
