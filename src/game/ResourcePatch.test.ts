import { describe, it, expect } from 'vitest'
import * as THREE from 'three'
import { ResourcePatch } from './ResourcePatch'

// A minimal patch that scatters `n` plain markers in a fixed order, standing in for
// the deterministic seeded scatter that Food/Reeds do. The order is what restore()
// relies on (items are keyed by index), so plain markers are enough to exercise it.
class TestPatch extends ResourcePatch {
  constructor(scene: THREE.Scene, regrowDelay: number, n: number) {
    super(scene, regrowDelay)
    for (let i = 0; i < n; i++) this.add(new THREE.Group(), i, 0, 0)
  }
}

describe('ResourcePatch save/restore', () => {
  it('round-trips the inventory total, gathered total, and which items were collected', () => {
    const scene = new THREE.Scene()
    const a = new TestPatch(scene, 0, 4)
    a.collect(a.items[1])
    a.collect(a.items[3])
    a.gain(2, { countsAsGathered: false }) // total now 4: two gathered, two rewarded

    const slice = a.toSave()
    expect(slice.total).toBe(4)
    expect(slice.gathered).toBe(2)
    expect(slice.items.map((s) => s.i).sort()).toEqual([1, 3])

    const b = new TestPatch(scene, 0, 4)
    b.restore(slice)
    expect(b.total).toBe(4)
    expect(b.gatheredTotal).toBe(2)
    // Items 1 and 3 are gone; 0 and 2 remain available.
    expect(b.available.map((it) => it.x).sort()).toEqual([0, 2])
  })

  it('tracks gameplay gains separately from rewards', () => {
    const scene = new THREE.Scene()
    const patch = new TestPatch(scene, 0, 2)

    patch.gain(5, { countsAsGathered: false })
    expect(patch.total).toBe(5)
    expect(patch.gatheredTotal).toBe(0)

    patch.gain(1)
    patch.collect(patch.items[0])
    expect(patch.total).toBe(7)
    expect(patch.gatheredTotal).toBe(2)
  })

  it('infers legacy one-shot gathered totals from harvested items, not rewarded inventory', () => {
    const scene = new THREE.Scene()
    const patch = new TestPatch(scene, 0, 4)

    patch.restore({
      total: 6,
      items: [
        { i: 1, collected: true, regrowTimer: null },
        { i: 3, collected: true, regrowTimer: null },
      ],
    })

    expect(patch.total).toBe(6)
    expect(patch.gatheredTotal).toBe(2)
  })

  it('only stores diverged items, not the whole patch', () => {
    const scene = new THREE.Scene()
    const patch = new TestPatch(scene, 0, 10)
    patch.collect(patch.items[5])
    expect(patch.toSave().items).toHaveLength(1)
  })

  it('preserves a mid-regrow timer on a regrowing patch', () => {
    const scene = new THREE.Scene()
    const a = new TestPatch(scene, 30, 3)
    a.collect(a.items[0]) // regrowing patch hides + schedules regrow
    const slice = a.toSave()
    expect(slice.items[0].regrowTimer).toBeGreaterThan(0)

    const b = new TestPatch(scene, 30, 3)
    b.restore(slice)
    expect(b.items[0].collected).toBe(true)
    expect(b.items[0].mesh.visible).toBe(false)
    // It grows back after its delay elapses, exactly like a live-harvested one.
    b.update(31)
    expect(b.items[0].collected).toBe(false)
    expect(b.items[0].mesh.visible).toBe(true)
  })
})
