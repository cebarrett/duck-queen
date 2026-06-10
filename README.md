# 🦆 Duck Queen

A cozy, blocky 3D browser game where you play a duck **Queen**. Rally a flock of
ducklings and grown mallards, forage food and reeds, swim your pond, and build
nests for your hens to brood in — all while fending off rival **geese** with
non-violent **honk-offs** before they raid your nests.

Built with **[Three.js](https://threejs.org/) + TypeScript + [Vite](https://vitejs.dev/)**.
Everything is made of blocky boxes — that's the intended cozy, voxel-y art style.

## Running it locally

**Prerequisites:** [Node.js](https://nodejs.org/) 18+ and npm.

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (opens http://localhost:5173)
npm run dev
```

Then **click the page once** (this captures the mouse for looking around and
unlocks audio), and play.

### Other commands

```bash
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build locally
```

## Controls

| Input | Action |
|-------|--------|
| **W A S D** | Move (relative to where the camera is facing) |
| **Mouse** | Look around / orbit the camera |
| **Click** | Capture the mouse · **Esc** releases it |
| **Space** | Take off / hold to fly up · release to glide back down |
| **Q** | Quack — rally nearby ducks to follow you (and your weapon in a honk-off) |
| **B** | Build a nest (costs 10 reeds) |
| **E** | Seat a hen on a nearby empty nest |

The **B** and **E** prompts only appear in the HUD when the action will actually
work, so you don't have to memorize them.

## What you can do

- **Rally a flock.** Quack (**Q**) to gather wandering ducks — yellow *ducklings*
  plus adult *drakes* (♂) and *hens* (♀), who look and sound different but all
  follow the same. Lead them around, but don't stray too far or they get lost.
  You can lead **up to 10** at once for now — best the **Marsh Baron** to prove
  your leadership and that cap lifts.
- **Move three ways.** Waddle on land, **hold Space** to fly (descend onto a rock
  or tree to perch on top), and paddle across the **pond**.
- **Forage.** Your ducklings gather food plants; only the Queen herself harvests
  the **reeds** along the shoreline.
- **Honk off the geese.** Get close to a rival goose and it squares up — **mash Q**
  to out-honk it (a bigger flock at your back helps). Win and it flees, cowed for
  a while; lose and it struts back to stealing your food.
- **Build nests and brood.** Spend 10 reeds to **build a nest** (**B**), then
  **seat a hen** on it (**E**). She'll settle in and lay eggs over time. An egg
  hatches into a duckling only once you've foraged **5 food** to feed it — and
  hatching spends that food, so keep your ducklings gathering.
- **Leave the flock with duties.** If the Queen travels too far, her subjects
  hold the home pond instead of wandering off: adults post near nests, ducklings
  huddle close, and nearby food still gets foraged.
- **Defend your nests.** Geese actively hunt brooding hens — if one reaches a
  nest it scares the hen off and steals an egg. Keep geese honked away (a beaten
  goose stays cowed) so your hens can brood in peace.

## World seed

The world (scenery, pond, food, reeds, flock, geese) is generated from a single
seed, so the **same seed always produces the same layout**. Add `?seed=123` to the
URL to explore a different one.

## Your own sounds (optional)

Sounds are synthesized by default. To use real recordings, drop any of these into
`public/` and they'll play automatically if present:

`quack.mp3` (the Queen) · `peep.mp3` (ducklings) · `honk.mp3` (geese) ·
`drake.mp3` & `hen.mp3` (adult mallards).

## Project structure

```
src/
  main.ts              # entry point
  style.css
  game/
    Game.ts            # the conductor: renderer, scene, camera, render loop, wiring
    World.ts           # ground, sky, fog, lights, scenery (+ colliders)
    Water.ts           # the pond
    collision.ts       # shared wall/floor collision (Queen, subjects, geese)
    rng.ts             # seeded RNG for deterministic world generation
    Duck.ts            # the player: the duck Queen
    DuckController.ts  # the Queen's movement & feel (waddle / fly / swim), collision
    ThirdPersonCamera.ts
    Input.ts           # keyboard, mouse, pointer lock
    duckModel.ts       # shared blocky-duck builder (Queen, ducklings, mallards)
    DuckSubject.ts     # a flock subject: wander / follow / forage / brood
    subjectKinds.ts    # the duckling / drake / hen kinds (look + voice)
    Flock.ts           # spawns subjects, handles the quack rally
    gooseModel.ts      # blocky goose builder
    Goose.ts           # a rival goose: wander / forage / posture / flee / raid
    Geese.ts           # spawns geese, runs the honk-offs
    ResourcePatch.ts   # base for gatherable patches (Food, Reeds)
    Food.ts            # food plants the flock forages
    Reeds.ts           # shoreline reeds (the Queen only)
    nestModel.ts       # blocky nest builder
    Nests.ts           # nests the Queen builds; hens brood, geese raid
    Sound.ts           # SFX (recorded files or synthesized)
    Splash.ts          # water ripple effect
    HUD.ts             # on-screen status (mode, flock, resources, nests)
    mathUtils.ts       # shared steering helpers
```

See [`CLAUDE.md`](CLAUDE.md) for the conventions the code follows (deterministic
world generation, the shared collision module, the blocky art direction, audio).
