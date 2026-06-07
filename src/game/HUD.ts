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
  private subjects = { ducklings: 0, males: 0, females: 0, nesting: 0 }
  private food = 0
  private reeds = 0
  private stolen = 0
  private nests = 0
  private canBuildNest = false
  private canSeatHen = false
  private resolveShaken = false

  // A centred banner + meter shown only during a honk-off.
  private readonly honkBanner: HTMLElement
  private readonly honkFill: HTMLElement
  private readonly messageBanner: HTMLElement
  private messageTimer = 0

  constructor() {
    const el = document.getElementById('hud')
    // A clear error beats a silent no-op if the HTML and code drift apart.
    if (!el) throw new Error('HUD: #hud element not found in index.html')
    this.element = el

    // Build the honk-off banner in code (it's not in index.html). Centred,
    // hidden until a honk-off starts.
    const banner = document.createElement('div')
    banner.style.cssText =
      'position:fixed;top:32%;left:50%;transform:translateX(-50%);text-align:center;' +
      'color:#fff;font-weight:700;text-shadow:0 1px 3px rgba(0,0,0,.6);' +
      'pointer-events:none;user-select:none;display:none;'
    const label = document.createElement('div')
    label.textContent = '🪿 HONK-OFF! · mash Q!'
    label.style.cssText = 'font-size:22px;margin-bottom:6px;'
    const meter = document.createElement('div')
    meter.style.cssText =
      'width:260px;height:20px;margin:0 auto;background:rgba(0,0,0,.4);' +
      'border:2px solid #fff;border-radius:11px;overflow:hidden;'
    const fill = document.createElement('div')
    fill.style.cssText = 'height:100%;width:0%;background:#ffd400;transition:width 60ms linear;'
    meter.appendChild(fill)
    banner.appendChild(label)
    banner.appendChild(meter)
    document.body.appendChild(banner)
    this.honkBanner = banner
    this.honkFill = fill

    const message = document.createElement('div')
    message.style.cssText =
      'position:fixed;top:24%;left:50%;transform:translateX(-50%);' +
      'color:#fff;font-size:28px;font-weight:800;text-shadow:0 2px 4px rgba(0,0,0,.65);' +
      'pointer-events:none;user-select:none;display:none;'
    document.body.appendChild(message)
    this.messageBanner = message
  }

  /** Show/hide the honk-off banner and set the resolve meter (0..1). */
  setHonkOff(active: boolean, resolve: number): void {
    this.honkBanner.style.display = active ? 'block' : 'none'
    if (active) this.honkFill.style.width = `${Math.round(resolve * 100)}%`
  }

  showMessage(text: string, seconds = 1.6): void {
    this.messageBanner.textContent = text
    this.messageBanner.style.display = 'block'
    this.messageTimer = seconds
  }

  setResolveShaken(shaken: boolean): void {
    this.resolveShaken = shaken
    this.render()
  }

  update(delta: number): void {
    if (this.messageTimer <= 0) return
    this.messageTimer -= delta
    if (this.messageTimer <= 0) {
      this.messageTimer = 0
      this.messageBanner.style.display = 'none'
    }
  }

  setMode(mode: DuckMode): void {
    this.mode = mode
    this.render()
  }

  setSubjects(breakdown: { ducklings: number; males: number; females: number; nesting: number }): void {
    this.subjects = breakdown
    this.render()
  }

  setFood(count: number): void {
    this.food = count
    this.render()
  }

  setReeds(count: number): void {
    this.reeds = count
    this.render()
  }

  setStolen(count: number): void {
    this.stolen = count
    this.render()
  }

  setNests(count: number): void {
    this.nests = count
    this.render()
  }

  /** Whether the Queen can build a nest right now — drives the contextual prompt
   *  so the B control only advertises itself when it'll actually do something. */
  setCanBuildNest(canBuild: boolean): void {
    this.canBuildNest = canBuild
    this.render()
  }

  /** Whether the Queen can seat a hen on a nearby empty nest — drives the E prompt. */
  setCanSeatHen(canSeat: boolean): void {
    this.canSeatHen = canSeat
    this.render()
  }

  private render(): void {
    let line1: string
    if (this.mode === 'fly') {
      line1 = '🦆 FLY  ·  WASD move · hold Space to rise, release to descend · Q quack'
    } else if (this.mode === 'swim') {
      line1 = '🦆 SWIM  ·  WASD paddle · Space to take off · Q quack'
    } else {
      line1 = '🦆 WADDLE  ·  WASD move · Space to take off · Q quack'
    }
    // Only nag about building / seating when it's actually possible, so each
    // control advertises itself exactly when it'll do something.
    if (this.canBuildNest) line1 += '   ·   🪺 Press B to build a nest!'
    if (this.canSeatHen) line1 += '   ·   🥚 Press E to seat a hen'

    const shaken = this.resolveShaken ? '   Resolve shaken' : ''
    const s = this.subjects
    const total = s.ducklings + s.males + s.females
    // Ducklings have no sex in this game; drakes (♂) and hens (♀) are the adults.
    // The chorus tag shows how many of the three voices are present — a full 3/3
    // out-honks the geese; lose a voice and your honk-offs get harder.
    const voices = (s.ducklings > 0 ? 1 : 0) + (s.males > 0 ? 1 : 0) + (s.females > 0 ? 1 : 0)
    const chorus = total > 0 ? `   🎵 ${voices}/3` : ''
    const nesting = s.nesting > 0 ? `   🥚 ${s.nesting} nesting` : ''
    const flock = `👑 Subjects: ${total}  (🐤${s.ducklings} ♂${s.males} ♀${s.females})${chorus}${nesting}`
    const line2 = `${flock}   🌿 Food: ${this.food}   🌾 Reeds: ${this.reeds}   🪺 Nests: ${this.nests}   🪿 Stolen: ${this.stolen}${shaken}`

    // Two lines via <br>. The values are our own strings + an integer, so there's
    // nothing untrusted going into innerHTML here.
    const html = `${line1}<br>${line2}`
    if (html !== this.lastHtml) {
      this.element.innerHTML = html
      this.lastHtml = html
    }
  }
}
