import * as THREE from 'three'
import type { Input } from './Input'
import type { Goose } from './Goose'

const QUACK_GAIN = 0.022

export interface StandoffConfig {
  disengageRange: number
  drain: number
  /** Compute the starting resolve value at the moment the fight begins. */
  startResolve: () => number
  /** Compute the passive support fill rate (units/sec) each frame. */
  passiveSupport: () => number
  /** If set, fire onPeriodic every periodicInterval seconds after firstPeriod. */
  periodicInterval?: number
  firstPeriod?: number
  /** Periodic pressure callback; receives a knockback function to drop resolve. */
  onPeriodic?: (knockback: (amount: number) => void) => void
  /** Called immediately after startPosturing — use for the "squares up" banner. */
  onStart?: () => void
  onWin: (goose: Goose) => void
  onLose: (goose: Goose, queenPos: THREE.Vector3) => void
  /** Called every frame with the live resolve, and once on end with active=false. */
  onUpdate: (active: boolean, resolve: number) => void
  /** Called after every end (win or lose), after the win/lose callback. */
  onFinish?: () => void
}

/**
 * One standoff instance owns the shared honk-off mechanics: Q press edge-
 * detection, fill-minus-drain resolve math, disengage check, and the optional
 * periodic pressure effect. Parameterize a new encounter with a StandoffConfig.
 */
export class Standoff {
  private resolve = 0
  private periodicTimer = 0
  private current: Goose | null = null

  constructor(
    private readonly input: Input,
    private readonly queen: THREE.Object3D,
    private readonly cfg: StandoffConfig,
  ) {}

  get isActive(): boolean {
    return this.current !== null
  }

  start(goose: Goose): void {
    this.current = goose
    goose.startPosturing()
    this.resolve = this.cfg.startResolve()
    this.periodicTimer = this.cfg.firstPeriod ?? this.cfg.periodicInterval ?? 0
    this.cfg.onUpdate(true, this.resolve)
    this.cfg.onStart?.()
  }

  update(delta: number): void {
    const goose = this.current
    if (!goose) return

    const qp = this.queen.position
    const gp = goose.group.position
    goose.aimAt(qp.x, qp.z)

    if (Math.hypot(gp.x - qp.x, gp.z - qp.z) > this.cfg.disengageRange) {
      this.finish(false)
      return
    }

    if (this.cfg.periodicInterval !== undefined) {
      this.periodicTimer -= delta
      if (this.periodicTimer <= 0) {
        this.periodicTimer = this.cfg.periodicInterval
        this.cfg.onPeriodic?.((amount) => {
          this.resolve = Math.max(0, this.resolve - amount)
        })
      }
    }

    if (this.input.justPressedAction('quack')) this.resolve += QUACK_GAIN

    this.resolve += (this.cfg.passiveSupport() - this.cfg.drain) * delta
    this.resolve = Math.max(0, Math.min(1, this.resolve))
    this.cfg.onUpdate(true, this.resolve)

    if (this.resolve >= 1) this.finish(true)
    else if (this.resolve <= 0) this.finish(false)
  }

  private finish(won: boolean): void {
    const goose = this.current!
    const qp = this.queen.position
    goose.stopPosturing(won)
    this.current = null
    this.resolve = 0
    this.cfg.onUpdate(false, 0)
    if (won) this.cfg.onWin(goose)
    else this.cfg.onLose(goose, qp)
    this.cfg.onFinish?.()
  }
}
