# Duck Queen — project guide

A cozy, blocky 3D browser game (Three.js + TypeScript + Vite) where you play a duck
Queen: rally a flock, forage, swim, and have non-violent honk-offs with rival geese.
See [README.md](README.md) for how to run and the controls.

## Conventions

### World generation is deterministic
Anything that **places objects in the world** — scenery (trees/rocks), the pond, food
plants, reeds, ducklings, geese — must take its randomness from the **seeded RNG in
[`src/game/rng.ts`](src/game/rng.ts)**, never from `Math.random()`. `Game` picks one
world seed and hands each system its own derived stream (`deriveRng(seed, '<name>')`).

**The same seed must always produce the exact same world layout.** (You can try a
specific one with `?seed=123` in the URL.) When adding anything that spawns or scatters
objects, thread a seeded `Rng` into it and draw positions/sizes from that.

Randomness that drives *behaviour during play* — a duck deciding to wander, a goose
honking, foraging choices, idle fidget timing — is gameplay, not generation, and may
freely use `Math.random()`.

### World collision is shared
Collision against the scenery lives in **[`src/game/collision.ts`](src/game/collision.ts)**
as two pure functions — `resolveWalls(...)` (push a body out of obstacle sides + slide
its velocity) and `floorHeightAt(...)` (the surface height under it). The Queen, the
ducklings, and the geese all use them; don't re-implement the math per creature.

To give a **new ground creature** collision: pass it `World`'s `colliders` array, and
after you apply its movement call `resolveWalls(pos, vel, radius, feet, height, stepUp,
colliders)`. Two knobs shape the feel:
- **`stepUp`** — surfaces within this of the feet are floors (skipped as walls). The
  Queen passes `STEP_UP` so she can stand on / step onto low rocks; NPCs that don't
  climb pass `0`, so every obstacle is a solid wall to walk around.
- **collision `height`** — keep it *below the tree canopies* (the Queen uses `1.7`) so a
  body bumps trunks and rocks but walks *under* the leaves.

### Other notes
- **The blocky art is the intended style**, not a placeholder to replace. Keep new
  models blocky (boxes). Animate via pivot groups (see the duck wings / goose neck).
- **Audio**: voiced sounds (quack/peep/honk) load an optional `public/<name>.mp3` and
  fall back to a synth, via the shared `Sample` loader in [`Sound.ts`](src/game/Sound.ts).
- **Verify with `npx tsc --noEmit`** after changes (the dev server doesn't type-check).
- Each creature is a small state machine with shared steering helpers
  (`mathUtils.ts`) — the duckling, goose, etc. all follow that shape.
