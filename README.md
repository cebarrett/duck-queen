# 🦆 Duck Queen

A cozy, blocky 3D game where you play a duck **Queen**: waddle, fly, and perch
your way around a little world, then **quack** to rally wandering ducks into a
parade that follows you (and occasionally gets distracted, and wanders off if you
neglect them). A pond to swim in is on the way.

Built with **[Three.js](https://threejs.org/) + TypeScript + [Vite](https://vitejs.dev/)**.
All characters are placeholder boxes for now — easy to swap for real models later.

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
| **Q** | Quack — rally nearby ducks to follow you |

Fly up and descend onto a rock or tree to perch on top of it. Lead your flock
around, but don't leave them too far behind or they'll get lost!

### Your own quack (optional)

The quack sound is synthesized by default. To use a real recording, drop an audio
file at `public/quack.mp3` and it'll play instead automatically.

## Project structure

```
src/
  main.ts            # entry point
  style.css
  game/
    Game.ts          # the conductor: renderer, scene, camera, render loop
    World.ts         # ground, sky, fog, lights, scenery (+ colliders)
    Water.ts         # the pond
    duckModel.ts     # shared blocky-duck builder (Queen + subjects)
    Duck.ts          # the player: the duck Queen
    DuckController.ts # movement & feel (waddle / fly), collisions
    ThirdPersonCamera.ts
    Input.ts         # keyboard, mouse, pointer lock
    Duckling.ts      # a duck subject: wander / follow / distracted
    Flock.ts         # spawns subjects, handles the quack rally
    Sound.ts         # quack SFX (recorded file or synthesized)
    HUD.ts           # on-screen mode + subject count
    mathUtils.ts
```
