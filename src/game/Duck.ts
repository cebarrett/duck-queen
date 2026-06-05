import * as THREE from 'three'
import { buildDuckModel } from './duckModel'

/**
 * The Queen: a white box-duck wearing the golden crown. She's just the shared
 * duck model (see duckModel.ts) built with a crown at full size. Exposes her
 * Group and the two wing pivots so DuckController can move and flap her.
 */
export class Duck {
  readonly group: THREE.Group
  readonly leftWing: THREE.Group
  readonly rightWing: THREE.Group

  constructor() {
    const model = buildDuckModel({ featherColor: 0xf5f5f5, crown: true })
    this.group = model.group
    this.leftWing = model.leftWing
    this.rightWing = model.rightWing
  }
}
