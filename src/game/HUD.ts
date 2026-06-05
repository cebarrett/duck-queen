import type { DuckMode } from './DuckController'

/**
 * HUD owns the on-screen overlay text (the #hud div from index.html). It shows
 * the current movement mode + controls on one line and the subject count on a
 * second. Keeping it in its own module means the rest of the game just says
 * "HUD, the mode is X" / "the count is N" without touching the DOM itself.
 */
export class HUD {
  private readonly element: HTMLElement
  private lastHtml = '' // remember what we drew so we only touch the DOM on change

  // We store the pieces and re-render whenever any of them changes.
  private mode: DuckMode = 'waddle'
  private subjects = 0
  private food = 0

  constructor() {
    const el = document.getElementById('hud')
    // A clear error beats a silent no-op if the HTML and code drift apart.
    if (!el) throw new Error('HUD: #hud element not found in index.html')
    this.element = el
  }

  setMode(mode: DuckMode): void {
    this.mode = mode
    this.render()
  }

  setSubjects(count: number): void {
    this.subjects = count
    this.render()
  }

  setFood(count: number): void {
    this.food = count
    this.render()
  }

  private render(): void {
    let line1: string
    if (this.mode === 'fly') {
      line1 = '🦆 FLY  ·  WASD move · hold Space to rise, release to descend'
    } else if (this.mode === 'swim') {
      line1 = '🦆 SWIM  ·  WASD paddle · Space to take off'
    } else {
      line1 = '🦆 WADDLE  ·  WASD move · Space to take off'
    }
    const line2 = `👑 Subjects: ${this.subjects}   🌿 Food: ${this.food}   ·  press Q to quack`

    // Two lines via <br>. The values are our own strings + an integer, so there's
    // nothing untrusted going into innerHTML here.
    const html = `${line1}<br>${line2}`
    if (html !== this.lastHtml) {
      this.element.innerHTML = html
      this.lastHtml = html
    }
  }
}
