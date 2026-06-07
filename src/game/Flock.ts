import * as THREE from 'three'
import { DuckSubject, type FlockContext } from './DuckSubject'
import type { SubjectKind } from './subjectKinds'
import type { Input } from './Input'
import type { Sound } from './Sound'
import type { Pond } from './Water'
import type { Food } from './Food'
import type { Collider } from './collision'
import type { Rng } from './rng'

// The flock roster: which kinds make up the subjects. A guaranteed mix (so you
// always see some grown mallards), shuffled into random spawn slots by the seed.
const COMPOSITION: SubjectKind[] = [
  'duckling', 'duckling', 'duckling', 'duckling',
  'drake', 'drake',
  'hen', 'hen',
]
const QUACK_RANGE = 12 // a quack recruits idle ducks within this distance
const SCATTER_RANGE = 10 // subjects this close to conflict briefly scatter

/**
 * The Flock owns all the duck subjects: spawns them, updates them, and turns the
 * Queen's quack into recruitment. Game just calls flock.update(delta) and reads
 * followerCount for the HUD.
 */
export class Flock {
  private readonly members: DuckSubject[] = []
  private wasQuackDown = false // edge-detect the Q key (one quack per press)

  constructor(
    scene: THREE.Scene,
    private readonly input: Input,
    private readonly queen: THREE.Object3D,
    private readonly sound: Sound,
    pond: Pond,
    food: Food,
    colliders: readonly Collider[],
    rng: Rng,
  ) {
    // Shuffle the roster into random spawn slots, deterministically from the seed
    // (Fisher–Yates). So a given seed always yields the same mix in the same spots.
    const kinds = [...COMPOSITION]
    for (let i = kinds.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[kinds[i], kinds[j]] = [kinds[j], kinds[i]]
    }

    for (const kind of kinds) {
      const angle = rng() * Math.PI * 2
      const radius = 6 + rng() * 8
      const subject = new DuckSubject(Math.cos(angle) * radius, Math.sin(angle) * radius, kind, pond, food, this.sound, colliders, rng)
      this.members.push(subject)
      scene.add(subject.group)
    }
  }

  /** How many ducks are currently the Queen's subjects (following or briefly
   *  distracted — a lost duck no longer counts). */
  get subjectCount(): number {
    let n = 0
    for (const d of this.members) if (d.isSubject) n++
    return n
  }

  /** Scatter current subjects near a conflict point. They still count as hers,
   *  just briefly panic-skitter before following again. */
  scatterFrom(x: number, z: number): void {
    for (const d of this.members) {
      if (!d.isSubject) continue
      const pos = d.group.position
      if (Math.hypot(pos.x - x, pos.z - z) <= SCATTER_RANGE) d.scatterFrom(x, z)
    }
  }

  /** Ratio of current subjects within `radius` of the Queen. With no subjects,
   *  treat the flock as fully regrouped so callers don't divide by zero. */
  regroupedRatio(radius: number): number {
    const qx = this.queen.position.x
    const qz = this.queen.position.z
    let subjects = 0
    let nearby = 0

    for (const d of this.members) {
      if (!d.isSubject) continue
      subjects++
      const pos = d.group.position
      if (Math.hypot(pos.x - qx, pos.z - qz) <= radius) nearby++
    }

    return subjects === 0 ? 1 : nearby / subjects
  }

  update(delta: number): void {
    this.handleQuack()

    // The shared context each follower needs: where the Queen is + who the
    // flockmates are (for separation).
    const ctx: FlockContext = {
      queenX: this.queen.position.x,
      queenZ: this.queen.position.z,
      flock: this.members,
    }
    for (const subject of this.members) {
      subject.update(delta, ctx)
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
      for (const d of this.members) {
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
