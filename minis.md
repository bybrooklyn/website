# Minis and Mote

Written 11 Nov 2026.

## What this is

- **Mote** (`src/mote/`): a tiny engine so that small demos and games do not each rewrite the loop, the
  canvas and the input. A stage, 2D physics and 3D solids on a flat canvas. MIT, free to copy.
- **Minis** (`/minis/`): tiny things to play with, each opened in the same kind of panel as a post or a
  project. Each is one file in `src/minis/` and a few lines in `src/content/minis/`.

How to add one is in `src/mote/README.md`.

## Built

- Blocks (toy): the pile of blocks. Also what posts embed.
- Balance (game): keep a ball on a tilting beam against the wind. Keeps a best time.
- Chain (toy): beads on a rope with a weight.
- Solid (toy, 3D): a shape to spin; click for the next one.
- A project page for Mote at `/projects/mote/`.
- Tests for the physics (`bun run test`): friction angles, toppling, a pendulum's period, a standing
  tower, a rolling ball that stops, a chain that holds, and no energy from nowhere.
- The list on `/minis/` shows each mini running, small.

## Ideas, not built

From the conversation on 10 and 11 Nov:

1. The 404 page: blocks spelling 404 that fall when the page loads.
2. The blocks demo on the home page, beside the Playmatter clip.
3. A post about writing the physics: warm starting, why blocks sleep, what broke. With a mini at each step.
4. More minis on the physics: a ragdoll, a tower to knock over, a seesaw, a marble run you draw.
5. More tiny games: something with the 3D solids, something for two people on one keyboard.
6. More for Mote when a mini needs it:
   - sound: short synthesized blips, no files
   - a camera that pans and zooms
   - particles
   - sprites and a tile grid
   - springs and motors between bodies
   - one-way platforms, and sensors that notice a body without stopping it
   - saving a run and playing it back
   - a debug view that draws contacts, joints and which bodies are asleep
   - a frame-time meter
   - touch with two fingers
   - text input
7. Its own repository, if anyone else wants to use it.
8. A logo for Mote. Four were drawn on 11 Nov: a speck in a beam of light, the word with the o as the
   mote, a falling block, a dot with its orbit. One to be chosen.

## Not doing

- scriptc (vercel-labs): it compiles TypeScript to native programs and WASI modules. It does not draw to a
  browser canvas, so it is no use for minis on the site. It could matter later for a desktop build.
