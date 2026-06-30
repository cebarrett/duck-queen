import * as THREE from 'three'
import { box } from './modelUtils'
import type { Rng } from './rng'
import type { Terrain } from './terrain'

// A few drifting critters — butterflies and dragonflies — flit over the world to
// make it feel alive. They're pure ambience: they fly, ignore everything, and
// have no gameplay weight. Their START positions come from the seeded 'critters'
// stream (so the world is deterministic); their wandering DURING play is
// behaviour, so it freely uses Math.random() (per the project conventions).
const COUNT = 8
const SPREAD = 70 // half-width of the band they roam
const MIN_Y = 1.0
const MAX_Y = 2.8

interface Kind {
  body: { w: number; h: number; d: number; color: number }
  wing: { w: number; h: number; d: number; colors: number[] }
  wingY: number
  rest: number // wing rest angle (radians)
  flapAmp: number // flap amplitude (radians)
  flapSpeed: number // flap rate (radians/sec)
  speed: number // cruise speed (units/sec)
  turn: number // how briskly heading wanders (radians/sec)
}

const BUTTERFLY: Kind = {
  body: { w: 0.1, h: 0.1, d: 0.3, color: 0x33302f },
  wing: { w: 0.42, h: 0.04, d: 0.5, colors: [0xff9ecb, 0xffe066, 0xff9e6b] },
  wingY: 0.02,
  rest: 0.15,
  flapAmp: 0.7,
  flapSpeed: 14,
  speed: 2.4,
  turn: 1.6,
}
const DRAGONFLY: Kind = {
  body: { w: 0.07, h: 0.07, d: 0.7, color: 0x2f6f63 },
  wing: { w: 0.5, h: 0.03, d: 0.16, colors: [0x4ad0c0, 0x8fe6da] },
  wingY: 0.03,
  rest: 0.05,
  flapAmp: 0.28,
  flapSpeed: 32,
  speed: 4.2,
  turn: 2.4,
}

interface Critter {
  group: THREE.Group
  leftWing: THREE.Group
  rightWing: THREE.Group
  kind: Kind
  heading: number // radians, current travel direction in the XZ plane
  baseY: number // cruise height ABOVE the terrain (so they clear the hills)
  bobPhase: number
  flapPhase: number
}

/**
 * Critters owns a Group of butterflies/dragonflies. Game adds the group to the
 * scene once and calls update(delta). Each critter flaps its wings (pivot groups,
 * the same trick the duck wings use), drifts along a slowly wandering heading,
 * and bobs gently; it steers back toward the middle when it nears the edge so it
 * never wanders off into the fog.
 */
export class Critters {
  readonly group = new THREE.Group()
  private readonly critters: Critter[] = []

  constructor(rng: Rng, private readonly terrain: Terrain) {
    for (let i = 0; i < COUNT; i++) {
      const kind = rng() < 0.6 ? BUTTERFLY : DRAGONFLY
      const { group, leftWing, rightWing } = makeCritter(kind, rng)
      const x = (rng() * 2 - 1) * SPREAD
      const z = (rng() * 2 - 1) * SPREAD
      const baseY = MIN_Y + rng() * (MAX_Y - MIN_Y)
      group.position.set(x, terrain.heightAt(x, z) + baseY, z)
      const heading = rng() * Math.PI * 2
      group.rotation.y = heading
      this.group.add(group)
      this.critters.push({
        group,
        leftWing,
        rightWing,
        kind,
        heading,
        baseY,
        bobPhase: rng() * Math.PI * 2,
        flapPhase: rng() * Math.PI * 2,
      })
    }
  }

  update(delta: number): void {
    for (const c of this.critters) {
      // Wander the heading a little (gameplay-time behaviour → Math.random is fine).
      c.heading += (Math.random() - 0.5) * c.kind.turn * delta
      const pos = c.group.position
      // Steer back toward the centre if we've drifted near the edge.
      if (Math.hypot(pos.x, pos.z) > SPREAD) {
        const inward = Math.atan2(-pos.z, -pos.x) // note: heading 0 = +X, so atan2(z,x)-style
        c.heading += angleToward(c.heading, inward) * 2 * delta
      }
      // Advance along the heading in the XZ plane.
      pos.x += Math.cos(c.heading) * c.kind.speed * delta
      pos.z += Math.sin(c.heading) * c.kind.speed * delta
      // Turn the body to face travel (the model's nose is -Z; this lines that up
      // with the heading direction (cos h, sin h) in the XZ plane).
      c.group.rotation.y = Math.atan2(-Math.cos(c.heading), -Math.sin(c.heading))

      // Gentle vertical bob, riding at cruise height above whatever hill is below.
      c.bobPhase += delta * 2.5
      pos.y = this.terrain.heightAt(pos.x, pos.z) + c.baseY + Math.sin(c.bobPhase) * 0.18

      // Flap the wings (mirrored pivots).
      c.flapPhase += delta * c.kind.flapSpeed
      const flap = c.kind.rest + Math.sin(c.flapPhase) * c.kind.flapAmp
      c.rightWing.rotation.z = flap
      c.leftWing.rotation.z = -flap
    }
  }
}

/** Smallest signed angle to rotate `from` toward `to` (result in (-π, π]). */
function angleToward(from: number, to: number): number {
  let d = to - from
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

/** Build a critter: a slim body plus two wings on mirrored pivot groups. */
function makeCritter(kind: Kind, rng: Rng): { group: THREE.Group; leftWing: THREE.Group; rightWing: THREE.Group } {
  const g = new THREE.Group()
  g.add(box(kind.body.w, kind.body.h, kind.body.d, kind.body.color, [0, 0, 0]))

  const color = kind.wing.colors[Math.floor(rng() * kind.wing.colors.length)]
  // Right wing: pivot at the body, the plate extends outward (+x) from it so a
  // z-rotation lifts/drops it like a flap.
  const rightWing = new THREE.Group()
  rightWing.position.set(0, kind.wingY, 0)
  rightWing.add(box(kind.wing.w, kind.wing.h, kind.wing.d, color, [kind.wing.w / 2, 0, 0]))
  g.add(rightWing)

  const leftWing = new THREE.Group()
  leftWing.position.set(0, kind.wingY, 0)
  leftWing.add(box(kind.wing.w, kind.wing.h, kind.wing.d, color, [-kind.wing.w / 2, 0, 0]))
  g.add(leftWing)

  // The wings shouldn't catch the shadow pass — they're tiny and constantly moving.
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.isMesh) {
      m.castShadow = false
      m.receiveShadow = false
    }
  })
  return { group: g, leftWing, rightWing }
}
