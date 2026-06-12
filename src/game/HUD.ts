import type { DuckMode } from './DuckController'

interface MinimapPoint {
  x: number
  z: number
}

interface MinimapCircle extends MinimapPoint {
  radius: number
}

interface MinimapAlly extends MinimapPoint {
  kind: 'duckling' | 'drake' | 'hen'
  subject: boolean
  nesting: boolean
  holding: boolean
}

interface MinimapEnemy extends MinimapPoint {
  boss: boolean
  defeated: boolean
}

interface MinimapNest extends MinimapPoint {
  occupied: boolean
  eggs: number
}

interface MinimapTerritory extends MinimapCircle {
  claimed: boolean
}

export interface MinimapSnapshot {
  queen: MinimapPoint & { heading: number }
  ponds: readonly MinimapCircle[]
  food: readonly MinimapPoint[]
  reeds: readonly MinimapPoint[]
  allies: readonly MinimapAlly[]
  enemies: readonly MinimapEnemy[]
  neutrals: readonly MinimapPoint[]
  nests: readonly MinimapNest[]
  territories: readonly MinimapTerritory[]
}

const MAP_SIZE = 282
const MAP_RANGE = 105 // world units from centre to edge
const MAP_BG = 'rgba(92, 132, 58, 0.86)'
const MAP_EDGE = 'rgba(244, 248, 251, 0.72)'

/**
 * HUD owns the on-screen overlay text (the #hud div from index.html). It shows
 * the current movement mode + controls on one line and the subject count on a
 * second. Keeping it in its own module means the rest of the game just says
 * "HUD, the mode is X" / "the count is N" without touching the DOM itself.
 */
export class HUD {
  private readonly element: HTMLElement
  private lastHtml = '' // remember what we drew so we only touch the DOM on change
  private readonly minimapCanvas: HTMLCanvasElement
  private readonly minimapCtx: CanvasRenderingContext2D

  // We store the pieces and re-render whenever any of them changes.
  private mode: DuckMode = 'waddle'
  private subjects = { ducklings: 0, males: 0, females: 0, nesting: 0 }
  private food = 0
  private reeds = 0
  private nests = 0
  private canBuildNest = false
  private canSeatHen = false
  private canKickHen = false
  private canRazeNest = false
  private resolveShaken = false
  // The frontier (Act III) objective — shown only once the phase has opened.
  private frontierActive = false
  private frontierClaimed = 0
  private frontierTotal = 0

  // A centred banner + meter shown only during a honk-off (or boss fight).
  private readonly honkBanner: HTMLElement
  private readonly honkLabel: HTMLElement
  private readonly honkFill: HTMLElement
  private readonly messageBanner: HTMLElement
  private readonly talkPrompt: HTMLElement
  private messageTimer = 0

  // A bottom-centre dialogue box, shown only while talking with an NPC (the swan).
  private readonly dialogueBox: HTMLElement
  private readonly dialogueName: HTMLElement
  private readonly dialogueText: HTMLElement
  private readonly dialogueHint: HTMLElement

  constructor() {
    const el = document.getElementById('hud')
    // A clear error beats a silent no-op if the HTML and code drift apart.
    if (!el) throw new Error('HUD: #hud element not found in index.html')
    this.element = el

    const minimapWrap = document.createElement('div')
    minimapWrap.id = 'minimap'
    const minimap = document.createElement('canvas')
    minimap.style.cssText = 'display:block;width:100%;height:100%;'
    minimapWrap.appendChild(minimap)
    document.body.appendChild(minimapWrap)
    this.minimapCanvas = minimap
    const ctx = minimap.getContext('2d')
    if (!ctx) throw new Error('HUD: minimap canvas context not available')
    this.minimapCtx = ctx
    this.resizeMinimap()

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
    this.honkLabel = label
    this.honkFill = fill

    const message = document.createElement('div')
    message.style.cssText =
      'position:fixed;top:24%;left:50%;transform:translateX(-50%);' +
      'color:#fff;font-size:28px;font-weight:800;text-shadow:0 2px 4px rgba(0,0,0,.65);' +
      'pointer-events:none;user-select:none;display:none;'
    document.body.appendChild(message)
    this.messageBanner = message

    const talkPrompt = document.createElement('div')
    talkPrompt.textContent = '🦢 Press F to talk to the swan'
    talkPrompt.style.cssText =
      'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
      'color:#fff;font-size:26px;font-weight:800;text-align:center;' +
      'text-shadow:0 2px 5px rgba(0,0,0,.75);' +
      'pointer-events:none;user-select:none;display:none;'
    document.body.appendChild(talkPrompt)
    this.talkPrompt = talkPrompt

    // The dialogue box: a wide, calm panel near the bottom. Built in code (like the
    // honk banner) and hidden until a conversation opens.
    const dialogue = document.createElement('div')
    dialogue.style.cssText =
      'position:fixed;left:50%;bottom:7%;transform:translateX(-50%);' +
      'width:min(700px,88vw);background:rgba(16,20,27,.82);' +
      'border:2px solid rgba(238,241,245,.85);border-radius:14px;' +
      'padding:16px 22px;color:#f3f6f9;text-shadow:0 1px 2px rgba(0,0,0,.55);' +
      'pointer-events:none;user-select:none;display:none;'
    const dName = document.createElement('div')
    dName.style.cssText = 'font-size:17px;font-weight:800;color:#cfe0f5;margin-bottom:7px;letter-spacing:.2px;'
    const dText = document.createElement('div')
    dText.style.cssText = 'font-size:18px;line-height:1.55;font-weight:500;'
    const dHint = document.createElement('div')
    dHint.style.cssText = 'font-size:13px;font-weight:600;opacity:.65;margin-top:12px;text-align:right;'
    dialogue.appendChild(dName)
    dialogue.appendChild(dText)
    dialogue.appendChild(dHint)
    document.body.appendChild(dialogue)
    this.dialogueBox = dialogue
    this.dialogueName = dName
    this.dialogueText = dText
    this.dialogueHint = dHint
  }

  /** Show a line of NPC dialogue, or hide the box when `name` is null. */
  setDialogue(name: string | null, text = '', hint = ''): void {
    if (name === null) {
      this.dialogueBox.style.display = 'none'
      return
    }
    this.dialogueName.textContent = name
    this.dialogueText.textContent = text
    this.dialogueHint.textContent = hint
    this.dialogueBox.style.display = 'block'
  }

  /** Whether the Queen is close enough to strike up a conversation — drives the F prompt. */
  setCanTalk(canTalk: boolean): void {
    this.talkPrompt.style.display = canTalk ? 'block' : 'none'
  }

  /** Show/hide the honk-off banner and set the resolve meter (0..1). `label` and
   *  `color` let the boss fight wear its own dramatic banner. */
  setHonkOff(active: boolean, resolve: number, label = '🪿 HONK-OFF! · mash Q!', color = '#ffd400'): void {
    this.honkBanner.style.display = active ? 'block' : 'none'
    if (active) {
      this.honkLabel.textContent = label
      this.honkFill.style.background = color
      this.honkFill.style.width = `${Math.round(resolve * 100)}%`
    }
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

  setMinimap(snapshot: MinimapSnapshot): void {
    this.resizeMinimap()
    this.drawMinimap(snapshot)
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

  setNests(count: number): void {
    this.nests = count
    this.render()
  }

  /** The frontier objective: how many outlying ponds are reclaimed, and whether the
   *  phase is open yet (it only shows after Lord Boundary falls). */
  setFrontier(claimed: number, total: number, active: boolean): void {
    this.frontierClaimed = claimed
    this.frontierTotal = total
    this.frontierActive = active
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

  /** Whether a hen is brooding on a nearby nest the Queen could rouse — drives the R prompt. */
  setCanKickHen(canKick: boolean): void {
    this.canKickHen = canKick
    this.render()
  }

  /** Whether the Queen stands by a nest she could raze for a refund — drives the X prompt. */
  setCanRazeNest(canRaze: boolean): void {
    this.canRazeNest = canRaze
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
    if (this.canKickHen) line1 += '   ·   🐤 Press R to rouse the hen'
    if (this.canRazeNest) line1 += '   ·   ♻️ Press X to raze the nest'

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
    // Once the frontier opens (after Lord Boundary), show how many far ponds are reclaimed.
    const frontier = this.frontierActive ? `   🪶 Frontier: ${this.frontierClaimed}/${this.frontierTotal}` : ''
    const line2 = `${flock}   🌿 Food: ${this.food}   🌾 Reeds: ${this.reeds}   🪺 Nests: ${this.nests}${frontier}${shaken}`

    // Two lines via <br>. The values are our own strings + an integer, so there's
    // nothing untrusted going into innerHTML here.
    const html = `${line1}<br>${line2}`
    if (html !== this.lastHtml) {
      this.element.innerHTML = html
      this.lastHtml = html
    }
  }

  private resizeMinimap(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.round(MAP_SIZE * dpr)
    if (this.minimapCanvas.width === w && this.minimapCanvas.height === w) return
    this.minimapCanvas.width = w
    this.minimapCanvas.height = w
    this.minimapCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  private drawMinimap(snapshot: MinimapSnapshot): void {
    const ctx = this.minimapCtx
    const size = MAP_SIZE
    const mid = size / 2
    const scale = mid / MAP_RANGE
    const toMap = (p: MinimapPoint, clamp = false): { x: number; y: number; edge: boolean } => {
      const rawX = mid + (p.x - snapshot.queen.x) * scale
      const rawY = mid + (p.z - snapshot.queen.z) * scale
      if (!clamp) return { x: rawX, y: rawY, edge: rawX < 0 || rawX > size || rawY < 0 || rawY > size }
      const pad = 8
      return {
        x: Math.max(pad, Math.min(size - pad, rawX)),
        y: Math.max(pad, Math.min(size - pad, rawY)),
        edge: rawX < pad || rawX > size - pad || rawY < pad || rawY > size - pad,
      }
    }

    ctx.clearRect(0, 0, size, size)
    ctx.fillStyle = MAP_BG
    ctx.fillRect(0, 0, size, size)
    this.drawMapGrid(ctx, size, mid)

    for (const pond of snapshot.ponds) {
      const p = toMap(pond)
      const r = pond.radius * scale
      if (p.x + r < 0 || p.x - r > size || p.y + r < 0 || p.y - r > size) continue
      ctx.beginPath()
      ctx.arc(p.x, p.y, Math.max(2, r), 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(70, 155, 226, 0.58)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(184, 225, 255, 0.82)'
      ctx.lineWidth = 1
      ctx.stroke()
    }

    // Frontier territories: a coloured ring over the pond marks who holds it —
    // warm orange while a gander holds it, bright cyan once the Queen reclaims it.
    for (const territory of snapshot.territories) {
      const p = toMap(territory)
      const r = Math.max(2, territory.radius * scale)
      if (p.x + r < 0 || p.x - r > size || p.y + r < 0 || p.y - r > size) continue
      ctx.beginPath()
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
      ctx.strokeStyle = territory.claimed ? 'rgba(122, 208, 255, 0.95)' : 'rgba(255, 120, 70, 0.9)'
      ctx.lineWidth = 2.5
      ctx.stroke()
    }

    this.drawPoints(ctx, snapshot.food, toMap, '#72d84d', 1.9)
    this.drawPoints(ctx, snapshot.reeds, toMap, '#d3c15b', 2.0)

    for (const nest of snapshot.nests) {
      const p = toMap(nest, true)
      this.drawDiamond(ctx, p.x, p.y, nest.occupied ? '#f6d17b' : '#c79858', nest.eggs > 0 ? 4.5 : 3.4, p.edge ? 0.55 : 1)
    }

    for (const ally of snapshot.allies) {
      const p = toMap(ally, true)
      const color = ally.nesting ? '#f6d17b' : ally.holding ? '#79d5a3' : ally.subject ? '#ffd84a' : '#fff1a8'
      const radius = ally.kind === 'duckling' ? 2.3 : 3.1
      this.drawDot(ctx, p.x, p.y, color, radius, p.edge ? 0.55 : 1)
    }

    for (const neutral of snapshot.neutrals) {
      const p = toMap(neutral, true)
      this.drawDot(ctx, p.x, p.y, '#d9ecff', 3.5, p.edge ? 0.55 : 1)
    }

    for (const enemy of snapshot.enemies) {
      const p = toMap(enemy, true)
      const color = enemy.defeated ? '#8d9aa3' : enemy.boss ? '#ff5f61' : '#ff9a4d'
      this.drawEnemy(ctx, p.x, p.y, color, enemy.boss ? 4.8 : 3.5, p.edge ? 0.55 : 1)
    }

    this.drawQueen(ctx, mid, mid, snapshot.queen.heading)
    ctx.strokeStyle = MAP_EDGE
    ctx.lineWidth = 2
    ctx.strokeRect(1, 1, size - 2, size - 2)
  }

  private drawMapGrid(ctx: CanvasRenderingContext2D, size: number, mid: number): void {
    ctx.strokeStyle = 'rgba(255,255,255,.09)'
    ctx.lineWidth = 1
    for (let x = 24; x < size; x += 24) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, size)
      ctx.stroke()
    }
    for (let y = 24; y < size; y += 24) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(size, y)
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(255,255,255,.18)'
    ctx.beginPath()
    ctx.moveTo(mid, 0)
    ctx.lineTo(mid, size)
    ctx.moveTo(0, mid)
    ctx.lineTo(size, mid)
    ctx.stroke()
  }

  private drawPoints(
    ctx: CanvasRenderingContext2D,
    points: readonly MinimapPoint[],
    toMap: (p: MinimapPoint, clamp?: boolean) => { x: number; y: number; edge: boolean },
    color: string,
    radius: number,
  ): void {
    for (const point of points) {
      const p = toMap(point)
      if (p.edge) continue
      this.drawDot(ctx, p.x, p.y, color, radius, 0.9)
    }
  }

  private drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, radius: number, alpha = 1): void {
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,.5)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
  }

  private drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, radius: number, alpha = 1): void {
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.beginPath()
    ctx.moveTo(x, y - radius)
    ctx.lineTo(x + radius, y)
    ctx.lineTo(x, y + radius)
    ctx.lineTo(x - radius, y)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
    ctx.strokeStyle = 'rgba(0,0,0,.55)'
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.restore()
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, radius: number, alpha = 1): void {
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.strokeStyle = color
    ctx.lineWidth = 2.2
    ctx.beginPath()
    ctx.moveTo(x - radius, y - radius)
    ctx.lineTo(x + radius, y + radius)
    ctx.moveTo(x + radius, y - radius)
    ctx.lineTo(x - radius, y + radius)
    ctx.stroke()
    ctx.restore()
  }

  private drawQueen(ctx: CanvasRenderingContext2D, x: number, y: number, heading: number): void {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(-heading)
    ctx.beginPath()
    ctx.moveTo(0, -7)
    ctx.lineTo(5.5, 5.5)
    ctx.lineTo(0, 2.5)
    ctx.lineTo(-5.5, 5.5)
    ctx.closePath()
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.strokeStyle = '#ffd84a'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.restore()
  }
}
