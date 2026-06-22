/**
 * Input is the single place that listens to the keyboard and mouse. Everything
 * else (camera, duck controller) ASKS Input what's happening rather than adding
 * its own listeners. That keeps event handling in one spot and means the same
 * keys can later drive menus, other ducks, etc.
 *
 * Two kinds of input live here:
 *   - Keys: a set of "currently held" keys (used for movement in Step 4).
 *   - Mouse look: relative movement while the pointer is "locked" to the page.
 */
export class Input {
  // We store `event.code` (e.g. "KeyW", "Space") not `event.key`. `code` is the
  // physical key, so it's the same on QWERTY/AZERTY and ignores Shift/caps.
  private readonly keys = new Set<string>()
  // Keys pressed since the last endFrame() call — for one-shot actions.
  private readonly pressed = new Set<string>()

  // Mouse movement accumulated since the last time the camera read it.
  private mouseDX = 0
  private mouseDY = 0

  private locked = false

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', (e) => { this.keys.add(e.code); this.pressed.add(e.code) })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    // Held keys never get a keyup when the window loses focus, so clear them on blur.
    window.addEventListener('blur', () => this.keys.clear())

    // Right-click is a game command (dismiss the current modal), so don't let the
    // browser context menu cover the canvas or UI panels.
    window.addEventListener('pointerdown', (e) => {
      if (e.button !== 2) return
      this.pressed.add('MouseRight')
      e.preventDefault()
    }, { capture: true })
    window.addEventListener('contextmenu', (e) => e.preventDefault())

    // Pointer lock hides the cursor and gives us raw mouse movement (great for
    // looking around). The browser REQUIRES a user gesture to start it, which
    // is why we request it on click — you can't auto-lock on page load.
    element.addEventListener('click', () => {
      if (!this.locked) this.element.requestPointerLock()
    })

    // Fired when lock turns on or off (Esc turns it off automatically).
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element
    })

    // While locked, movementX/Y is how far the mouse moved THIS event, in
    // pixels — exactly what we want for look controls. We accumulate it and let
    // the camera drain it once per frame.
    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return
      this.mouseDX += e.movementX
      this.mouseDY += e.movementY
    })
  }

  /** Is this physical key currently held? e.g. isDown('KeyW'). */
  isDown(code: string): boolean {
    return this.keys.has(code)
  }

  /** True if the key was newly pressed since the last endFrame() — use for one-shot actions. */
  justPressed(code: string): boolean {
    return this.pressed.has(code)
  }

  /** Drain the just-pressed set. Call exactly once per frame, after all input consumers. */
  endFrame(): void {
    this.pressed.clear()
  }

  get isPointerLocked(): boolean {
    return this.locked
  }

  /**
   * Returns the mouse movement since the last call and resets it to zero.
   * "Consume" because reading it clears it — call this exactly once per frame.
   */
  consumeMouseDelta(): { x: number; y: number } {
    const delta = { x: this.mouseDX, y: this.mouseDY }
    this.mouseDX = 0
    this.mouseDY = 0
    return delta
  }
}
