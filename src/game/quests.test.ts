import { describe, it, expect } from 'vitest'
import { questViews } from './quests'
import { makeProgress } from './Progress'

// The quest log is a pure projection of campaign state. These tests pin down the
// unlock chain (each act opens the next) so the log can't drift from the actual
// progression in Progress/Frontier.

describe('questViews', () => {
  it('starts with the Baron active and the later acts locked', () => {
    const [baron, treaty, frontier] = questViews(makeProgress(), 0, 4)
    expect(baron.state).toBe('active')
    expect(treaty.state).toBe('locked')
    expect(frontier.state).toBe('locked')
  })

  it('completes the Baron and opens the Treaty Flats once he falls', () => {
    const progress = makeProgress()
    progress.baronDefeated = true
    const [baron, treaty, frontier] = questViews(progress, 0, 4)
    expect(baron.state).toBe('complete')
    expect(treaty.state).toBe('active')
    expect(frontier.state).toBe('locked') // still gated on the Treaty
  })

  it('opens the frontier once the Treaty holds', () => {
    const progress = makeProgress()
    progress.baronDefeated = true
    progress.treatyDefeated = true
    const [, treaty, frontier] = questViews(progress, 1, 4)
    expect(treaty.state).toBe('complete')
    expect(frontier.state).toBe('active')
    expect(frontier.progress).toBe('1/4 ponds reclaimed')
  })

  it('only completes the frontier when every pond is reclaimed', () => {
    const progress = makeProgress()
    progress.baronDefeated = true
    progress.treatyDefeated = true
    expect(questViews(progress, 3, 4)[2].state).toBe('active')
    expect(questViews(progress, 4, 4)[2].state).toBe('complete')
  })

  it('does not count an empty frontier (no ponds) as complete', () => {
    const progress = makeProgress()
    progress.baronDefeated = true
    progress.treatyDefeated = true
    expect(questViews(progress, 0, 0)[2].state).toBe('active')
  })
})
