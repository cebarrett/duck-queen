import * as THREE from 'three'
import { Duckling, type FlockContext } from './Duckling'
import type { Input } from './Input'
import type { Sound } from './Sound'
import type { Pond } from './Water'
import type { Food } from './Food'

const DUCKLING_COUNT = 8
const QUACK_RANGE = 12 // a quack recruits idle ducks within this distance

/**
 * The Flock owns all the duck subjects: spawns them, updates them, and turns the
 * Queen's quack into recruitment. Game just calls flock.update(delta) and reads
 * followerCount for the HUD.
 */
export class Flock {
  private readonly ducklings: Duckling[] = []
  private wasQuackDown = false // edge-detect the Q key (one quack per press)

  constructor(
    scene: THREE.Scene,
    private readonly input: Input,
    private readonly queen: THREE.Object3D,
    private readonly sound: Sound,
    pond: Pond,
    food: Food,
  ) {
    for (let i = 0; i < DUCKLING_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2
      const radius = 6 + Math.random() * 8
      const duckling = new Duckling(Math.cos(angle) * radius, Math.sin(angle) * radius, pond, food, this.sound)
      this.ducklings.push(duckling)
      scene.add(duckling.group)
    }
  }

  /** How many ducks are currently the Queen's subjects (following or briefly
   *  distracted — a lost duck no longer counts). */
  get subjectCount(): number {
    let n = 0
    for (const d of this.ducklings) if (d.isSubject) n++
    return n
  }

  update(delta: number): void {
    this.handleQuack()

    // The shared context each follower needs: where the Queen is + who the
    // flockmates are (for separation).
    const ctx: FlockContext = {
      queenX: this.queen.position.x,
      queenZ: this.queen.position.z,
      flock: this.ducklings,
    }
    for (const duckling of this.ducklings) {
      duckling.update(delta, ctx)
    }
  }

  /** On a fresh Q press: recall the existing flock (interrupting any foraging /
   *  distraction so they fall back in behind her), AND recruit any new ducks in
   *  range. So a quack is both "come here" to strangers and "to me!" to her own. */
  private handleQuack(): void {
    const down = this.input.isDown('KeyQ')
    if (down && !this.wasQuackDown) {
      this.sound.quack() // the Queen quacks — even if no ducks are in earshot

      const qx = this.queen.position.x
      const qz = this.queen.position.z
      for (const d of this.ducklings) {
        if (d.isSubject) {
          d.rally() // already hers — snap her back to following
        } else {
          const dist = Math.hypot(d.group.position.x - qx, d.group.position.z - qz)
          if (dist <= QUACK_RANGE) d.recruit()
        }
      }
    }
    this.wasQuackDown = down
  }
}
