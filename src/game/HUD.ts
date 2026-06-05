import type { DuckMode } from './DuckController'

/**
 * HUD owns the on-screen overlay text (the #hud div from index.html). For now
 * it just shows the current movement mode and its controls. Keeping it in its
 * own module means the rest of the game says "HUD, show this mode" without
 * knowing anything about the DOM.
 */
export class HUD {
  private readonly element: HTMLElement
  private lastText = '' // remember what we drew so we only touch the DOM on change

  constructor() {
    const el = document.getElementById('hud')
    // A clear error beats a silent no-op if the HTML and code drift apart.
    if (!el) throw new Error('HUD: #hud element not found in index.html')
    this.element = el
  }

  setMode(mode: DuckMode): void {
    const text =
      mode === 'fly'
        ? '🦆 FLY  ·  WASD move · hold Space to rise, release to descend'
        : '🦆 WADDLE  ·  WASD move · Space to take off'

    // Writing to the DOM every frame is wasteful; only update when it changed.
    if (text !== this.lastText) {
      this.element.textContent = text
      this.lastText = text
    }
  }
}
