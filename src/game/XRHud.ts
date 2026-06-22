import * as THREE from 'three'
import type { DuckMode } from './DuckController'
import type { RosterEntry } from './Flock'
import { formatReward, type QuestView } from './quests'

type SubjectBreakdown = { ducklings: number; males: number; females: number; nesting: number }

const PANEL_BG = 'rgba(16, 20, 27, 0.82)'
const PANEL_STROKE = 'rgba(238, 241, 245, 0.86)'
const TEXT = '#f3f6f9'
const MUTED = '#cfe0f5'
const GOLD = '#ffd84a'

class CanvasPanel {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  readonly texture: THREE.CanvasTexture
  readonly mesh: THREE.Mesh

  constructor(width: number, height: number, worldWidth: number, worldHeight: number) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = width
    this.canvas.height = height
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('XRHud: canvas context not available')
    this.ctx = ctx

    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.minFilter = THREE.LinearFilter
    this.texture.magFilter = THREE.LinearFilter

    const geometry = new THREE.PlaneGeometry(worldWidth, worldHeight)
    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    this.mesh = new THREE.Mesh(geometry, material)
    this.mesh.renderOrder = 1000
    this.mesh.visible = false
  }

  redraw(draw: (ctx: CanvasRenderingContext2D) => void): void {
    draw(this.ctx)
    this.texture.needsUpdate = true
  }
}

export class XRHud {
  readonly group = new THREE.Group()

  private readonly status = new CanvasPanel(900, 360, 1.55, 0.62)
  private readonly center = new CanvasPanel(900, 270, 1.5, 0.45)
  private readonly panel = new CanvasPanel(1050, 760, 1.9, 1.38)

  private active = false
  private mode: DuckMode = 'waddle'
  private subjects: SubjectBreakdown = { ducklings: 0, males: 0, females: 0, nesting: 0 }
  private food = 0
  private reeds = 0
  private nests = 0
  private frontierActive = false
  private frontierClaimed = 0
  private frontierTotal = 0
  private canTalk = false
  private canBuildNest = false
  private canSeatHen = false
  private canKickHen = false
  private canRazeNest = false
  private resolveShaken = false
  private honkOff: { active: boolean; resolve: number; label: string; color: string } = {
    active: false,
    resolve: 0,
    label: '',
    color: GOLD,
  }
  private message = ''
  private messageTimer = 0
  private dialogue: { name: string; text: string; hint: string } | null = null
  private quests: readonly QuestView[] = []
  private roster: readonly RosterEntry[] = []
  private panelMode: 'quests' | 'roster' | null = null
  private panelScroll = 0
  private statusDirty = true
  private centerDirty = true
  private panelDirty = true

  constructor(camera: THREE.Camera) {
    this.group.position.set(0, -0.18, -2.15)
    camera.add(this.group)

    this.status.mesh.position.set(-0.82, -0.4, 0)
    this.center.mesh.position.set(0, -0.02, -0.02)
    this.panel.mesh.position.set(0, 0.03, -0.04)

    this.group.add(this.status.mesh)
    this.group.add(this.center.mesh)
    this.group.add(this.panel.mesh)
    this.group.visible = false
  }

  setActive(active: boolean): void {
    this.active = active
    this.group.visible = active
    this.status.mesh.visible = active
    this.center.mesh.visible = false
    this.panel.mesh.visible = false
    this.statusDirty = true
    this.centerDirty = true
    this.panelDirty = true
  }

  get isPanelOpen(): boolean {
    return this.panelMode !== null
  }

  update(delta: number, panelScroll: number): void {
    if (!this.active) return

    if (this.messageTimer > 0) {
      this.messageTimer = Math.max(0, this.messageTimer - delta)
      if (this.messageTimer === 0) this.centerDirty = true
    }

    if (this.panelMode && panelScroll !== 0) {
      this.panelScroll = Math.max(0, this.panelScroll + panelScroll * delta * 14)
      this.panelDirty = true
    }

    if (this.statusDirty) this.drawStatus()
    if (this.centerDirty) this.drawCenter()
    if (this.panelDirty) this.drawPanel()
  }

  setMode(mode: DuckMode): void {
    if (this.mode === mode) return
    this.mode = mode
    this.statusDirty = true
  }

  setSubjects(subjects: SubjectBreakdown): void {
    this.subjects = subjects
    this.statusDirty = true
    this.panelDirty = true
  }

  setFood(food: number): void {
    if (this.food === food) return
    this.food = food
    this.statusDirty = true
  }

  setReeds(reeds: number): void {
    if (this.reeds === reeds) return
    this.reeds = reeds
    this.statusDirty = true
  }

  setNests(nests: number): void {
    if (this.nests === nests) return
    this.nests = nests
    this.statusDirty = true
  }

  setFrontier(claimed: number, total: number, active: boolean): void {
    this.frontierClaimed = claimed
    this.frontierTotal = total
    this.frontierActive = active
    this.statusDirty = true
  }

  setCanTalk(canTalk: boolean): void {
    if (this.canTalk === canTalk) return
    this.canTalk = canTalk
    this.statusDirty = true
  }

  setCanBuildNest(canBuild: boolean): void {
    if (this.canBuildNest === canBuild) return
    this.canBuildNest = canBuild
    this.statusDirty = true
  }

  setCanSeatHen(canSeat: boolean): void {
    if (this.canSeatHen === canSeat) return
    this.canSeatHen = canSeat
    this.statusDirty = true
  }

  setCanKickHen(canKick: boolean): void {
    if (this.canKickHen === canKick) return
    this.canKickHen = canKick
    this.statusDirty = true
  }

  setCanRazeNest(canRaze: boolean): void {
    if (this.canRazeNest === canRaze) return
    this.canRazeNest = canRaze
    this.statusDirty = true
  }

  setResolveShaken(shaken: boolean): void {
    if (this.resolveShaken === shaken) return
    this.resolveShaken = shaken
    this.statusDirty = true
  }

  setHonkOff(active: boolean, resolve: number, label = 'HONK-OFF! mash trigger', color = GOLD): void {
    this.honkOff = { active, resolve, label: this.stripEmoji(label), color }
    this.centerDirty = true
  }

  showMessage(text: string, seconds = 1.6): void {
    this.message = text
    this.messageTimer = seconds
    this.centerDirty = true
  }

  setDialogue(name: string | null, text = '', hint = ''): void {
    this.dialogue = name === null ? null : { name, text, hint }
    this.centerDirty = true
  }

  setQuests(views: readonly QuestView[]): void {
    this.quests = views
    this.panelDirty = true
  }

  setRoster(roster: readonly RosterEntry[]): void {
    this.roster = roster
    this.panelDirty = true
  }

  toggleQuestLog(): void {
    this.panelMode = this.panelMode === 'quests' ? null : 'quests'
    this.panelScroll = 0
    this.panelDirty = true
  }

  closeQuestLog(): void {
    if (this.panelMode !== 'quests') return
    this.panelMode = null
    this.panelDirty = true
  }

  toggleRoster(): void {
    this.panelMode = this.panelMode === 'roster' ? null : 'roster'
    this.panelScroll = 0
    this.panelDirty = true
  }

  closeRoster(): void {
    if (this.panelMode !== 'roster') return
    this.panelMode = null
    this.panelDirty = true
  }

  closePanels(): void {
    if (!this.panelMode) return
    this.panelMode = null
    this.panelDirty = true
  }

  private drawStatus(): void {
    this.status.redraw((ctx) => {
      this.clearPanel(ctx, this.status.canvas.width, this.status.canvas.height, 28)
      ctx.fillStyle = TEXT
      ctx.font = '700 42px system-ui, sans-serif'
      ctx.fillText(`DUCK QUEEN VR - ${this.mode.toUpperCase()}`, 36, 64)

      const total = this.subjects.ducklings + this.subjects.males + this.subjects.females
      ctx.font = '600 31px system-ui, sans-serif'
      ctx.fillText(`Subjects ${total}  Food ${this.food}  Reeds ${this.reeds}  Nests ${this.nests}`, 36, 118)

      ctx.fillStyle = MUTED
      ctx.font = '600 25px system-ui, sans-serif'
      const frontier = this.frontierActive ? `  Frontier ${this.frontierClaimed}/${this.frontierTotal}` : ''
      const shaken = this.resolveShaken ? '  Resolve shaken' : ''
      ctx.fillText(`L stick move  R stick snap turn  RT quack  RG fly${frontier}${shaken}`, 36, 166)

      const prompts: string[] = []
      if (this.canTalk) prompts.push('A talk')
      if (this.canBuildNest) prompts.push('B build')
      if (this.canSeatHen || this.canKickHen) prompts.push('X seat/rouse')
      if (this.canRazeNest) prompts.push('Y raze')
      prompts.push('stick clicks: quests/roster')

      ctx.fillStyle = prompts.length > 1 ? GOLD : 'rgba(243,246,249,.78)'
      ctx.font = '700 26px system-ui, sans-serif'
      this.drawWrapped(ctx, prompts.join('   '), 36, 226, 820, 34, 3)
    })
    this.statusDirty = false
  }

  private drawCenter(): void {
    const visible = this.dialogue !== null || this.honkOff.active || this.messageTimer > 0
    this.center.mesh.visible = this.active && visible && !this.panelMode
    if (!visible) {
      this.centerDirty = false
      return
    }

    this.center.redraw((ctx) => {
      this.clearPanel(ctx, this.center.canvas.width, this.center.canvas.height, 24)

      if (this.dialogue) {
        ctx.fillStyle = MUTED
        ctx.font = '800 32px system-ui, sans-serif'
        ctx.fillText(this.dialogue.name, 36, 52)
        ctx.fillStyle = TEXT
        ctx.font = '600 29px system-ui, sans-serif'
        this.drawWrapped(ctx, this.dialogue.text, 36, 100, 820, 36, 3)
        ctx.fillStyle = 'rgba(243,246,249,.72)'
        ctx.font = '600 22px system-ui, sans-serif'
        ctx.fillText(this.dialogue.hint.replaceAll('F', 'A'), 590, 235)
        return
      }

      if (this.honkOff.active) {
        ctx.fillStyle = TEXT
        ctx.font = '800 40px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText(this.honkOff.label, 450, 72)
        ctx.textAlign = 'left'
        ctx.fillStyle = 'rgba(0,0,0,.5)'
        this.roundRect(ctx, 210, 122, 480, 44, 22)
        ctx.fill()
        ctx.fillStyle = this.honkOff.color
        this.roundRect(ctx, 214, 126, Math.max(0, Math.min(472, this.honkOff.resolve * 472)), 36, 18)
        ctx.fill()
        ctx.fillStyle = MUTED
        ctx.font = '700 25px system-ui, sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('Mash right trigger', 450, 215)
        ctx.textAlign = 'left'
        return
      }

      ctx.fillStyle = TEXT
      ctx.font = '800 38px system-ui, sans-serif'
      ctx.textAlign = 'center'
      this.drawWrapped(ctx, this.message, 80, 106, 740, 46, 3, 'center')
      ctx.textAlign = 'left'
    })
    this.centerDirty = false
  }

  private drawPanel(): void {
    this.panel.mesh.visible = this.active && this.panelMode !== null
    if (!this.panelMode) {
      this.panelDirty = false
      return
    }

    const title = this.panelMode === 'quests' ? 'Quest Log' : 'Royal Flock Roster'
    const lines = this.panelMode === 'quests' ? this.questLines() : this.rosterLines()
    const maxScroll = Math.max(0, lines.length - 13)
    this.panelScroll = Math.min(this.panelScroll, maxScroll)
    const start = Math.floor(this.panelScroll)
    const visible = lines.slice(start, start + 13)

    this.panel.redraw((ctx) => {
      this.clearPanel(ctx, this.panel.canvas.width, this.panel.canvas.height, 30)
      ctx.fillStyle = TEXT
      ctx.font = '800 44px system-ui, sans-serif'
      ctx.fillText(title, 44, 66)
      ctx.fillStyle = MUTED
      ctx.font = '600 23px system-ui, sans-serif'
      ctx.fillText('Use a stick up/down to scroll. Left trigger closes.', 44, 108)

      let y = 158
      for (const line of visible) {
        ctx.fillStyle = line.startsWith('  ') ? 'rgba(243,246,249,.82)' : GOLD
        ctx.font = line.startsWith('  ') ? '600 25px system-ui, sans-serif' : '800 28px system-ui, sans-serif'
        const used = this.drawWrapped(ctx, line.trim(), 54, y, 940, 31, 2)
        y += used + 18
      }
    })
    this.panelDirty = false
  }

  private questLines(): string[] {
    const sorted = [
      ...this.quests.filter((q) => q.state !== 'complete'),
      ...this.quests.filter((q) => q.state === 'complete'),
    ]
    const lines: string[] = []
    for (const quest of sorted) {
      const status = quest.state === 'complete' ? 'Complete' : quest.state === 'active' ? 'In progress' : 'Locked'
      lines.push(`${status}: ${quest.title}`)
      if (quest.state === 'locked') {
        lines.push('  ???')
      } else {
        lines.push(`  ${quest.summary}`)
        if (quest.progress) lines.push(`  ${quest.progress}`)
        lines.push(`  Reward: ${formatReward(quest.reward)}`)
      }
    }
    return lines.length > 0 ? lines : ['No quests yet.']
  }

  private rosterLines(): string[] {
    if (this.roster.length === 0) return ['No subjects yet.', '  Quack near ducks to rally them.']
    const labels: Record<RosterEntry['kind'], string> = {
      drake: 'Drakes',
      hen: 'Hens',
      duckling: 'Ducklings',
    }
    const lines: string[] = []
    for (const kind of ['drake', 'hen', 'duckling'] as const) {
      const entries = this.roster.filter((r) => r.kind === kind)
      if (entries.length === 0) continue
      lines.push(`${labels[kind]} - ${entries.length}`)
      for (const entry of entries) {
        const trait = entry.trait ? ` (${entry.trait.replaceAll('-', ' ')})` : ''
        lines.push(`  ${entry.name}${trait}: ${entry.activity}`)
      }
    }
    return lines
  }

  private clearPanel(ctx: CanvasRenderingContext2D, width: number, height: number, radius: number): void {
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = PANEL_BG
    this.roundRect(ctx, 0, 0, width, height, radius)
    ctx.fill()
    ctx.strokeStyle = PANEL_STROKE
    ctx.lineWidth = 5
    this.roundRect(ctx, 3, 3, width - 6, height - 6, radius)
    ctx.stroke()
  }

  private drawWrapped(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    lineHeight: number,
    maxLines: number,
    align: CanvasTextAlign = 'left',
  ): number {
    const oldAlign = ctx.textAlign
    ctx.textAlign = align
    const anchorX = align === 'center' ? x + maxWidth / 2 : x
    const words = text.split(/\s+/)
    let line = ''
    let lines = 0
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (ctx.measureText(next).width > maxWidth && line) {
        ctx.fillText(line, anchorX, y + lines * lineHeight)
        line = word
        lines++
        if (lines >= maxLines) break
      } else {
        line = next
      }
    }
    if (line && lines < maxLines) {
      ctx.fillText(line, anchorX, y + lines * lineHeight)
      lines++
    }
    ctx.textAlign = oldAlign
    return lines * lineHeight
  }

  private roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
    const r = Math.min(radius, width / 2, height / 2)
    ctx.beginPath()
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + width, y, x + width, y + height, r)
    ctx.arcTo(x + width, y + height, x, y + height, r)
    ctx.arcTo(x, y + height, x, y, r)
    ctx.arcTo(x, y, x + width, y, r)
    ctx.closePath()
  }

  private stripEmoji(text: string): string {
    return text.replace(/[^\x20-\x7E]/g, '').replace(/\s+/g, ' ').trim()
  }
}
