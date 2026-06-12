import * as THREE from 'three'
import { buildDuckModel, setBillOpen } from './duckModel'

const QUACK_BILL_TIME = 0.32
const QUACK_BILL_SYLLABLE = 0.16

/**
 * The Queen: a white box-duck wearing the golden crown. She's just the shared
 * duck model (see duckModel.ts) built with a crown at full size. Exposes her
 * Group and the two wing pivots so DuckController can move and flap her.
 */
export class Duck {
  readonly group: THREE.Group
  readonly leftWing: THREE.Group
  readonly rightWing: THREE.Group
  readonly crown?: THREE.Group
  private readonly upperBill: THREE.Group
  private readonly lowerBill: THREE.Group
  private billTimer = 0
  private billDuration = QUACK_BILL_TIME

  constructor() {
    const model = buildDuckModel({ featherColor: 0xf5f5f5, crown: true })
    this.group = model.group
    this.leftWing = model.leftWing
    this.rightWing = model.rightWing
    this.crown = model.crown
    this.upperBill = model.upperBill
    this.lowerBill = model.lowerBill
  }

  quack(duration = QUACK_BILL_TIME): void {
    this.billDuration = Math.max(QUACK_BILL_TIME, duration)
    this.billTimer = this.billDuration
  }

  update(delta: number): void {
    if (this.billTimer > 0) this.billTimer = Math.max(0, this.billTimer - delta)
    const progress = this.billTimer / this.billDuration
    const syllables = Math.max(1, Math.ceil(this.billDuration / QUACK_BILL_SYLLABLE))
    const open = progress > 0 ? Math.abs(Math.sin(progress * syllables * Math.PI)) : 0
    setBillOpen(this.upperBill, this.lowerBill, open)
  }
}
