/**
 * SettingsMenu owns a small ⚙️ button in the corner and the panel it opens.
 * Like the HUD banners, it builds its DOM in code and appends it to <body>.
 *
 * Most of the overlay has `pointer-events: none` so clicks fall through to the
 * canvas (which is what engages pointer lock). The bits the player actually
 * clicks here — the gear and the panel — opt back in with `pointer-events:auto`
 * and live OUTSIDE the canvas, so clicking them never requests pointer lock.
 *
 * For now the only setting is "Reset game progress", which wipes the saved game
 * and reloads the page to start fresh (the reset work itself lives in Game, handed
 * to us as `onReset`).
 */
export class SettingsMenu {
  private readonly panel: HTMLElement
  private open = false

  /** Called before the settings panel opens or closes — used by Game to dismiss other modals. */
  onBeforeToggle?: () => void

  constructor(private readonly onReset: () => void) {
    const button = document.createElement('button')
    button.textContent = '⚙️'
    button.setAttribute('aria-label', 'Settings')
    button.style.cssText =
      'position:fixed;bottom:14px;right:14px;width:44px;height:44px;' +
      'font-size:22px;line-height:1;cursor:pointer;' +
      'background:rgba(16,20,27,.82);color:#f3f6f9;' +
      'border:2px solid rgba(238,241,245,.85);border-radius:10px;' +
      'box-shadow:0 2px 8px rgba(0,0,0,.35);' +
      'pointer-events:auto;user-select:none;z-index:10;'
    button.addEventListener('click', () => this.toggle())
    document.body.appendChild(button)

    // The panel: a calm dark card matching the dialogue box, hidden until opened.
    const panel = document.createElement('div')
    panel.style.cssText =
      'position:fixed;bottom:66px;right:14px;width:min(280px,86vw);' +
      'background:rgba(16,20,27,.92);color:#f3f6f9;text-shadow:0 1px 2px rgba(0,0,0,.55);' +
      'border:2px solid rgba(238,241,245,.85);border-radius:14px;' +
      'padding:16px 18px;box-shadow:0 4px 16px rgba(0,0,0,.45);' +
      'pointer-events:auto;user-select:none;display:none;z-index:10;'

    const title = document.createElement('div')
    title.textContent = '⚙️ Settings'
    title.style.cssText = 'font-size:17px;font-weight:800;color:#cfe0f5;margin-bottom:12px;'

    const reset = document.createElement('button')
    reset.textContent = '🔄 Reset game progress'
    reset.style.cssText =
      'display:block;width:100%;padding:10px 12px;font-size:15px;font-weight:700;' +
      'cursor:pointer;color:#f3f6f9;background:rgba(255,95,97,.22);' +
      'border:2px solid rgba(255,120,122,.85);border-radius:10px;'
    // Hand off to Game, which clears the save and then reloads into a fresh world.
    reset.addEventListener('click', () => this.onReset())

    panel.appendChild(title)
    panel.appendChild(reset)
    document.body.appendChild(panel)
    this.panel = panel
  }

  private toggle(): void {
    this.onBeforeToggle?.()
    this.open = !this.open
    this.panel.style.display = this.open ? 'block' : 'none'
  }

  /** Close the settings panel unconditionally (called by Game when another modal opens). */
  close(): void {
    this.open = false
    this.panel.style.display = 'none'
  }
}
