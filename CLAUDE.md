# Duck Queen — project guide

A cozy, blocky 3D browser game (Three.js + TypeScript + Vite) where you play a duck
Queen: rally a flock, forage, swim, and have non-violent honk-offs with rival geese.
See [README.md](README.md) for how to run and the controls.

This file is the repo's agent guide; some tools refer to the same role as
`AGENTS.md`. Keep this guidance aligned with the README when the project's
developer-facing conventions or player-facing behavior change.

## Conventions

### World generation is deterministic
Anything that **places objects in the world** — the terrain's hills, scenery (trees/rocks),
the pond, food plants, reeds, ambient critter starting positions, ducklings, geese, swans,
frontier ponds — must take its randomness from the **seeded RNG in [`src/game/rng.ts`](src/game/rng.ts)**,
never from `Math.random()`. `Game` picks one world seed and hands each system its own
derived stream (`deriveRng(seed, '<name>')`).

The ground isn't flat: [`src/game/terrain.ts`](src/game/terrain.ts) is a deterministic
rolling-hills heightfield, built once from the `'terrain'` stream. It's the single source
of truth for "how high is the ground here?" via `heightAt(x, z)` — the ground mesh is
displaced by it, the Queen's floor (`floorHeightAt`) starts from it, and every grounded
object (scenery, food, flora, reeds, nests, the Queen, ducklings, geese) sits on it.
**Anything you add that rests on the ground must offset its `y` by `terrain.heightAt(x, z)`**,
or it'll float/sink on a hillside. The spawn clearing, every pond, and the Treaty Flats
arena are registered as flat zones (`terrain.flatten(...)`) so they stay level.

**The same seed must always produce the exact same world layout.** (You can try a
specific one with `?seed=123` in the URL.) When adding anything that spawns or scatters
objects, thread a seeded `Rng` into it and draw positions/sizes from that.

Randomness that drives *behaviour during play* — a duck deciding to wander, a goose
honking, foraging choices, idle fidget timing — is gameplay, not generation, and may
freely use `Math.random()`.

### Input and HUD text stay together
`src/game/Input.ts` is the source of truth for keyboard, mouse, and WebXR controller
actions. When adding or changing a player action, update the matching HUD/XR prompt
text and the controls table in `README.md` in the same change. Dialogue and quest copy
that names a key (for example Aldermere's **F** talk prompt) should stay in sync too.

### World collision is shared
Collision against the scenery lives in **[`src/game/collision.ts`](src/game/collision.ts)**
as two pure functions — `resolveWalls(...)` (push a body out of obstacle sides + slide
its velocity) and `floorHeightAt(...)` (the surface height under it, measured up from the
terrain's `groundBase` height). The Queen, the ducklings, and the geese all use them;
don't re-implement the math per creature.

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
  Run `npm run test:run` as well when touching pure logic (`rng.ts`, `collision.ts`,
  `mathUtils.ts`, `quests.ts`, resource save/restore, persistence, or traits).
- **Update `README.md` when making substantial changes**: if a change affects setup,
  controls, gameplay, features, architecture, or other user-facing behavior, update the
  README in the same change.
- Each creature is a small state machine with shared steering helpers
  (`mathUtils.ts`) — the duckling, goose, etc. all follow that shape.
