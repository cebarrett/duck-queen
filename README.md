# 🦆 Duck Queen

A cozy, blocky 3D browser game where you play a duck **Queen**. Rally scattered
mallard pairs, raise ducklings, forage food and reeds, swim your pond, and build
nests for your hens to brood in — all while fending off rival **geese** with
non-violent **honk-offs** before they raid your nests.

Built with **[Three.js](https://threejs.org/) + TypeScript + [Vite](https://vitejs.dev/)**.
Everything is made of blocky boxes — that's the intended cozy, voxel-y art style.
The world is alive around you: a gradient sky with a gentle day/night cycle,
drifting clouds, mottled ground scattered with grass tufts and flowers, trees
and reeds that sway in a gentle breeze, foam-fringed ponds, and butterflies and
dragonflies flitting about.

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

### Trying it on Meta Quest 3

The game now exposes an **ENTER VR** button when WebXR immersive VR is available.
Quest Browser requires a secure context for WebXR: a production build served from
HTTPS works, and a trusted HTTPS tunnel/proxy to your local Vite server works.
Opening `http://<your-computer-ip>:5173` directly from the headset is not enough
for WebXR, even though the flat page may load.

For local headset testing, start Vite on your network and put an HTTPS tunnel in
front of it:

```bash
npm run dev -- --host 0.0.0.0
```

Then open the tunnel's HTTPS URL in Quest Browser and press **ENTER VR**.

### Other commands

```bash
npm run build     # type-check + production build into dist/
npm run preview   # serve the production build locally
npm test          # run unit tests in watch mode (Vitest)
npm run test:run  # run the tests once and exit
```

The tests cover the game's pure logic — the seeded RNG (`rng.ts`), steering/
math helpers (`mathUtils.ts`), and world collision (`collision.ts`) — living in
`*.test.ts` files next to the code they test. Rendering, animation, and audio
are verified by eye in the browser, not by tests.

## Controls

| Input | Action |
|-------|--------|
| **W A S D** | Move (relative to where the camera is facing) |
| **Mouse** | Look around / orbit the camera |
| **Click** | Capture the mouse · **Esc** releases it |
| **Space** | Take off / hold to fly up · release to glide back down |
| **Q** | Quack — rally nearby ducks to follow you (and your weapon in a honk-off) |
| **F** | Talk to Aldermere the swan / advance dialogue |
| **B** | Build a nest (costs 10 reeds) |
| **E** | Seat a hen on a nearby empty nest |
| **R** | Rouse a brooding hen off a nearby nest (she rejoins the flock; eggs stay) |
| **X** | Raze a nearby nest, recovering half the reeds it cost (5) |
| **J** | Open / close the quest log (also the 📜 **Quests** button, bottom-left) |
| **K** | Open / close the royal flock roster (also the 🪶 **Roster** button, bottom-left) |
| **Esc / Right-click** | Dismiss the quest log, roster, settings menu, or active dialogue; Esc also releases captured mouse |

The **B**, **E**, **R**, and **X** prompts only appear in the HUD when the action
will actually work, so you don't have to memorize them.

### Quest 3 WebXR controls

| Input | Action |
|-------|--------|
| **Left stick** | Move / paddle / waddle relative to the VR camera rig |
| **Right stick left/right** | Comfort snap-turn the third-person camera rig |
| **Right trigger** | Quack / mash during honk-offs |
| **Right grip** | Take off / hold to fly up · release to glide down |
| **A** | Talk to the swan / advance dialogue |
| **B** | Build a nest when the prompt is active |
| **X** | Seat a hen, or rouse a brooding hen when nearby |
| **Y** | Raze a nearby nest |
| **Right stick click** | Open / close the quest log |
| **Left stick click** | Open / close the royal flock roster |
| **Left trigger** | Dismiss the active dialogue or VR panel |

In VR, the normal DOM HUD is replaced inside the headset by lightweight in-world
canvas panels for status, prompts, honk-offs, dialogue, quests, and the roster.
Quest/roster panels scroll with either stick while open.

The **⚙️ Settings** button in the bottom-right opens a small menu. For now it holds
a single option, **Reset game progress**, which wipes your saved game and reloads
the page to start fresh.

## Saving & progress

Your progress is **saved automatically** to the browser's local storage, so your
flock, foraged food and reeds, built nests (and the eggs in them), reclaimed
frontier ponds, defeated bosses, quest rewards, and the current time of day all
survive a page reload — the world picks up right where you left it. The game
autosaves every so often and again whenever you leave or hide the tab.

To start over, use **⚙️ Settings → Reset game progress**, which clears the save and
reloads into a brand-new game.

The persistence layer is built around a small swappable **storage backend**
(`src/game/persistence/`), so the same saves could later be pointed at a cloud
store instead of local storage without touching the game itself.

## What you can do

- **Rally a flock.** Quack (**Q**) to gather wandering adult mallards — paired
  *drakes* (♂) and *hens* (♀) who spawn together but are scattered across the
  marsh instead of clustered around the home pond. No two are quite alike: each
  duck is built a touch bigger or
  smaller, with its own subtly-shaded feathers (a greener or duller drake head, a
  lighter or darker hen brown, and a slightly warmer or paler duckling yellow),
  so a gathered flock reads as a crowd of individuals. Their blocky bills open
  when they quack, peep, or call back.
  Lead them around, but don't stray too far or they get lost. You can lead **up
  to 10** at once for now — best the **Marsh Baron** to prove your leadership
  and that cap lifts. Press **K** (or the 🪶 **Roster** button, bottom-left) to open
  the **royal flock roster** — a window listing every drake, hen, and duckling
  subject by name, grouped by kind, with what each one is up to right now
  (following, foraging, holding home, brooding, and so on). Ducklings arrive from
  hatched eggs rather than the starter world population; each duckling also
  has a little **quirk** — a *fast forager*, a *fast runner*, or a *loud honker* —
  that nudges how it behaves and shows beside its name; it keeps that quirk even
  after it grows into a drake or hen.
- **Move three ways.** Waddle on land, **hold Space** to fly (descend onto a rock
  or tree to perch on top), and paddle across the **pond**.
- **Forage.** Your flock gathers food plants; only the Queen herself harvests
  the **reeds** along the shoreline.
- **Honk off the geese.** Get close to a rival goose and it squares up — **mash Q**
  to out-honk it (a bigger flock at your back helps). A first gaggle waits near
  the home pond, with more ordinary geese scattered through the wider marsh.
  Honk-offs are little chorus showdowns now: the Queen flaps and puffs, nearby
  subjects peep/quack back, and the goose gapes, pumps its wings, and wobbles
  indignantly. Win and one flees, cowed for a while; lose and the whole helping
  chorus scatters while the goose struts back to stealing your food. Boss-style
  geese, once bested, fly off into the distance and leave the marsh for good.
- **Build nests and brood.** Spend 10 reeds to **build a nest** (**B**), then
  **seat a hen** on it (**E**). She'll settle in and lay eggs over time. An egg
  hatches into a duckling only once you've foraged **5 food** to feed it — and
  hatching spends that food, so keep your flock gathering.
- **Leave the flock with duties.** If the Queen travels too far, her subjects
  hold the home pond instead of wandering off: adults post near nests, ducklings
  huddle close, and nearby food still gets foraged.
- **Defend your nests.** Geese actively hunt brooding hens — if one reaches a
  nest it scares the hen off and steals an egg. Keep geese honked away (a beaten
  goose stays cowed) so your hens can brood in peace.
- **Reclaim the frontier.** Once you've broken the Marsh Baron and held the Treaty
  Flats against Lord Boundary, the war moves outward: the scattered outlying ponds
  show up **murky and goose-held**, each guarded by a steel-blue **lieutenant
  gander**. Those lieutenants already patrol their ponds before Lord Boundary falls;
  trespass too close and they'll chase the Queen off, but the ponds can't be
  reclaimed until the Treaty Flats hold. After that, lead a strong flock out and
  **out-honk** each one to flip its pond back to you — the defeated lieutenant flies
  off for good, the water clears to blue, the minimap recolours, and the HUD tracks
  your progress (🪶 Frontier). Reclaim them all and the swan has something to say
  about what comes next.

- **Follow the quest log.** Press **J** (or click the 📜 **Quests** button in the
  bottom-left) to open the quest log. It opens with a short **beginner chain** that
  teaches the basics one step at a time — **meet Aldermere the swan**, **forage for
  food**, **gather reeds**, **build a nest**, and **rally your flock** — each
  unlocking the next as you reach it. After those come the three main-story goals in order: breaking the **Marsh
  Baron** (always available from the start), holding the **Treaty Flats** against
  Lord Boundary, and **taking the frontier ponds**. Each chain unlocks in sequence;
  quests you haven't reached yet are shown but kept under wraps until then. None can
  be cancelled. Every quest pays out a small **reward** of 🌿 food and/or 🌾 reeds the
  first time you complete it — the log shows what each one gives.

## World seed

The world (scenery, pond, food, reeds, scattered mallard pairs, geese) is
generated from a single seed, so the **same seed always produces the same
layout**. Your save remembers its own seed, so a reload restores the same world.
Add `?seed=123` to the URL to explore a different one — an explicit `?seed=`
**starts a fresh game in that world** and ignores your save (handy for poking at
layouts), while removing it again returns to your saved game.

## Your own sounds (optional)

Sounds are synthesized by default. To use real recordings, drop any of these into
`public/` and they'll play automatically if present:

`quack.mp3` (the Queen) · `peep.mp3` (ducklings) · `honk.mp3` (geese) ·
`drake.mp3` & `hen.mp3` (adult mallards).

Animal calls are distance-faded; goose honks are also rate-limited and mixed by
priority, so a real `honk.mp3` won't stack into a full-volume wall of geese.

## Project structure

```
src/
  main.ts              # entry point
  style.css
  game/
    Game.ts            # the conductor: renderer, scene, camera, render loop, wiring
    Biomes.ts          # named campaign regions such as the Treaty Flats
    World.ts           # ground, day/night sky, fog, lights, scenery (+ colliders)
    Water.ts           # the pond (+ shoreline foam)
    Wind.ts            # gentle breeze that sways trees, reeds, grass and flora
    Clouds.ts          # blocky clouds drifting across the sky
    Flora.ts           # scattered grass tufts and flowers on the land
    Critters.ts        # ambient butterflies and dragonflies
    Frontier.ts        # ownership state for the goose-held outlying ponds
    collision.ts       # shared wall/floor collision (Queen, subjects, geese)
    rng.ts             # seeded RNG for deterministic world generation
    mathUtils.ts       # shared steering helpers
    Duck.ts            # the player: the duck Queen
    DuckController.ts  # the Queen's movement & feel (waddle / fly / swim), collision
    ThirdPersonCamera.ts # desktop orbit camera + Quest WebXR third-person rig
    Input.ts           # semantic keyboard/mouse/WebXR controller input
    modelUtils.ts      # shared box/material helpers for blocky models
    duckModel.ts       # shared blocky-duck builder (Queen, ducklings, mallards)
    DuckSubject.ts     # a flock subject: wander / follow / forage / brood
    subjectKinds.ts    # the duckling / drake / hen kinds (look + voice)
    Flock.ts           # spawns mallard pairs, handles the quack rally
    gooseModel.ts      # blocky goose builder
    Goose.ts           # a rival goose: wander / forage / posture / flee / raid
    Geese.ts           # spawns geese, runs the honk-offs
    Standoff.ts        # shared honk-off resolve meter and win/lose mechanics
    ResourcePatch.ts   # base for gatherable patches (Food, Reeds)
    Food.ts            # food plants the flock forages
    Reeds.ts           # shoreline reeds (the Queen only)
    nestModel.ts       # blocky nest builder
    Nests.ts           # nests the Queen builds; hens brood, geese raid
    Progress.ts        # latched campaign/tutorial flags
    quests.ts          # pure quest-log projection and rewards
    Swan.ts            # Aldermere's movement and dialogue state machine
    swanDialogue.ts    # Aldermere's story text
    swanModel.ts       # blocky swan builder
    Sound.ts           # SFX (recorded files or synthesized)
    Splash.ts          # water ripple effect
    HUD.ts             # on-screen status (mode, flock, resources, nests)
    XRHud.ts           # in-headset canvas HUD/panels for WebXR
    RosterPanel.ts     # 🪶 royal flock roster window (named drake/hen/duckling subjects)
    SettingsMenu.ts    # ⚙️ corner menu (reset game progress)
    persistence/       # save/load: swappable storage backend + autosave
      saveSchema.ts        # the versioned save shape (plain data)
      StorageBackend.ts    # the swappable storage interface (local today, cloud later)
      LocalStorageBackend.ts
      SaveManager.ts       # JSON, versioning/migration, autosave lifecycle
```

See [`CLAUDE.md`](CLAUDE.md) for the conventions the code follows (deterministic
world generation, the shared collision module, the blocky art direction, audio).
