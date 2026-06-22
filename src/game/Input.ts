export type InputAction =
  | 'quack'
  | 'talk'
  | 'buildNest'
  | 'seatHen'
  | 'rouseHen'
  | 'seatOrRouseHen'
  | 'razeNest'
  | 'questLog'
  | 'roster'
  | 'dismiss'

export interface InputSnapshot {
  moveRight: number
  moveForward: number
  flyHeld: boolean
  menuScroll: number
  xrPresenting: boolean
}

const ACTION_KEYS: Partial<Record<string, InputAction>> = {
  KeyQ: 'quack',
  KeyF: 'talk',
  KeyB: 'buildNest',
  KeyE: 'seatHen',
  KeyR: 'rouseHen',
  KeyX: 'razeNest',
  KeyJ: 'questLog',
  KeyK: 'roster',
  Escape: 'dismiss',
  MouseRight: 'dismiss',
}

const STICK_DEADZONE = 0.18
const SNAP_TURN_THRESHOLD = 0.72
const SNAP_TURN_RADIANS = Math.PI / 6

/**
 * Input is the single place that listens to player controls. Everything else
 * asks for semantic intent rather than raw keyboard, mouse, or XR controller
 * state. Desktop keeps the old WASD/mouse bindings; WebXR adds Quest Touch
 * controller polling on top of the same actions.
 */
export class Input {
  // We store `event.code` (e.g. "KeyW", "Space") not `event.key`. `code` is the
  // physical key, so it's the same on QWERTY/AZERTY and ignores Shift/caps.
  private readonly keys = new Set<string>()
  // Keys pressed since the last endFrame() call — for one-shot actions.
  private readonly pressed = new Set<string>()
  private readonly actionsPressed = new Set<InputAction>()

  // Mouse movement accumulated since the last time the camera read it.
  private mouseDX = 0
  private mouseDY = 0

  private xrSession: XRSession | null = null
  private xrPanelOpen = false
  private readonly xrPressedButtons = new Set<string>()
  private moveRight = 0
  private moveForward = 0
  private flyHeld = false
  private menuScroll = 0
  private snapTurn = 0

  private locked = false

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code)
      if (!e.repeat) this.pressCode(e.code)
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    // Held keys never get a keyup when the window loses focus, so clear them on blur.
    window.addEventListener('blur', () => {
      this.keys.clear()
      this.flyHeld = false
      this.moveRight = 0
      this.moveForward = 0
    })

    // Right-click is a game command (dismiss the current modal), so don't let the
    // browser context menu cover the canvas or UI panels.
    window.addEventListener('pointerdown', (e) => {
      if (e.button !== 2) return
      this.pressCode('MouseRight')
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

  setXRSession(session: XRSession | null): void {
    this.xrSession = session
    this.xrPressedButtons.clear()
    this.snapTurn = 0
  }

  setXRPanelOpen(open: boolean): void {
    this.xrPanelOpen = open
  }

  update(): void {
    this.updateKeyboardSnapshot()
    this.updateXRSnapshot()
  }

  /** Is this physical key currently held? e.g. isDown('KeyW'). */
  isDown(code: string): boolean {
    return this.keys.has(code)
  }

  /** True if the key was newly pressed since the last endFrame() — use for one-shot actions. */
  justPressed(code: string): boolean {
    return this.pressed.has(code)
  }

  justPressedAction(action: InputAction): boolean {
    return this.actionsPressed.has(action)
  }

  getSnapshot(): InputSnapshot {
    return {
      moveRight: this.moveRight,
      moveForward: this.moveForward,
      flyHeld: this.flyHeld,
      menuScroll: this.menuScroll,
      xrPresenting: this.xrSession !== null,
    }
  }

  getMovement(): { right: number; forward: number } {
    return { right: this.moveRight, forward: this.moveForward }
  }

  get isFlyHeld(): boolean {
    return this.flyHeld
  }

  getMenuScroll(): number {
    return this.menuScroll
  }

  /** Drain the just-pressed set. Call exactly once per frame, after all input consumers. */
  endFrame(): void {
    this.pressed.clear()
    this.actionsPressed.clear()
    this.menuScroll = 0
  }

  get isPointerLocked(): boolean {
    return this.locked
  }

  /**
   * Returns the mouse movement since the last call and resets it to zero.
   * "Consume" because reading it clears it — call this exactly once per frame.
   */
  consumeLookDelta(): { x: number; y: number } {
    const delta = { x: this.mouseDX, y: this.mouseDY }
    this.mouseDX = 0
    this.mouseDY = 0
    return delta
  }

  consumeMouseDelta(): { x: number; y: number } {
    return this.consumeLookDelta()
  }

  consumeSnapTurn(): number {
    const turn = this.snapTurn
    this.snapTurn = 0
    return turn
  }

  private pressCode(code: string): void {
    this.pressed.add(code)
    const action = ACTION_KEYS[code]
    if (action) this.actionsPressed.add(action)
  }

  private pressAction(action: InputAction): void {
    this.actionsPressed.add(action)
  }

  private updateKeyboardSnapshot(): void {
    let right = 0
    let forward = 0
    if (this.keys.has('KeyW')) forward += 1
    if (this.keys.has('KeyS')) forward -= 1
    if (this.keys.has('KeyD')) right += 1
    if (this.keys.has('KeyA')) right -= 1

    const len = Math.hypot(right, forward)
    this.moveRight = len > 1 ? right / len : right
    this.moveForward = len > 1 ? forward / len : forward
    this.flyHeld = this.keys.has('Space')
  }

  private updateXRSnapshot(): void {
    const session = this.xrSession
    if (!session) return

    let moveRight = 0
    let moveForward = 0
    let lookX = 0
    let scroll = 0
    let flyHeld = false
    const seenButtons = new Set<string>()

    for (const source of session.inputSources) {
      const gamepad = source.gamepad
      if (!gamepad) continue

      const hand = source.handedness
      const stick = this.thumbstick(gamepad)
      if (hand === 'left') {
        moveRight = stick.x
        moveForward = -stick.y
        scroll = -stick.y
      } else if (hand === 'right') {
        lookX = stick.x
        scroll = Math.abs(stick.y) > Math.abs(scroll) ? -stick.y : scroll
      }

      const trigger = this.buttonDown(gamepad, 0)
      const grip = this.buttonDown(gamepad, 1)
      const stickClick = this.buttonDown(gamepad, 3)
      const lowerFace = this.buttonDown(gamepad, 4)
      const upperFace = this.buttonDown(gamepad, 5)

      if (hand === 'right') flyHeld = flyHeld || grip

      this.edgeButton(seenButtons, hand, 0, trigger, hand === 'right' ? 'quack' : 'dismiss')
      if (hand === 'left') {
        this.edgeButton(seenButtons, hand, 3, stickClick, 'roster')
        this.edgeButton(seenButtons, hand, 4, lowerFace, 'seatOrRouseHen')
        this.edgeButton(seenButtons, hand, 5, upperFace, 'razeNest')
      } else if (hand === 'right') {
        this.edgeButton(seenButtons, hand, 3, stickClick, 'questLog')
        this.edgeButton(seenButtons, hand, 4, lowerFace, 'talk')
        this.edgeButton(seenButtons, hand, 5, upperFace, 'buildNest')
      }
    }

    for (const key of this.xrPressedButtons) {
      if (key.startsWith('snap:')) continue
      if (!seenButtons.has(key)) this.xrPressedButtons.delete(key)
    }

    if (this.xrPanelOpen) {
      this.moveRight = 0
      this.moveForward = 0
      this.menuScroll = this.applyDeadzone(scroll)
    } else {
      this.moveRight = this.applyDeadzone(moveRight)
      this.moveForward = this.applyDeadzone(moveForward)
      this.menuScroll = 0
      this.updateSnapTurn(lookX)
    }
    this.flyHeld = flyHeld
  }

  private edgeButton(
    seenButtons: Set<string>,
    hand: XRHandedness,
    index: number,
    down: boolean,
    action: InputAction,
  ): void {
    const key = `${hand}:${index}`
    seenButtons.add(key)
    const wasDown = this.xrPressedButtons.has(key)
    if (down && !wasDown) {
      this.xrPressedButtons.add(key)
      this.pressAction(action)
    } else if (!down && wasDown) {
      this.xrPressedButtons.delete(key)
    }
  }

  private thumbstick(gamepad: Gamepad): { x: number; y: number } {
    const axes = gamepad.axes
    const x = axes.length >= 4 ? axes[2] : axes[0] ?? 0
    const y = axes.length >= 4 ? axes[3] : axes[1] ?? 0
    return { x: this.applyDeadzone(x), y: this.applyDeadzone(y) }
  }

  private buttonDown(gamepad: Gamepad, index: number): boolean {
    const button = gamepad.buttons[index]
    return Boolean(button && (button.pressed || button.value > 0.65))
  }

  private applyDeadzone(value: number): number {
    return Math.abs(value) < STICK_DEADZONE ? 0 : value
  }

  private updateSnapTurn(lookX: number): void {
    const key = 'snap:right'
    if (lookX > SNAP_TURN_THRESHOLD && !this.xrPressedButtons.has(key)) {
      this.snapTurn -= SNAP_TURN_RADIANS
      this.xrPressedButtons.add(key)
    } else if (lookX < -SNAP_TURN_THRESHOLD && !this.xrPressedButtons.has(key)) {
      this.snapTurn += SNAP_TURN_RADIANS
      this.xrPressedButtons.add(key)
    } else if (Math.abs(lookX) < 0.35) {
      this.xrPressedButtons.delete(key)
    }
  }
}
