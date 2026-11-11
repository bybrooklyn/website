# Minis and Mote

Written 11 Nov 2026.

## What this is

- **Mote** (`src/mote/`): a small engine so that small demos and games do not each rewrite the loop, the
  canvas and the input. A stage, 2D physics, 3D physics and 3D drawing, all its own: no dependencies.
  (For the night of 10 Nov it stood on forks of planck, cannon and three. They were taken out on
  11 Nov and what was needed was written into Mote.) MIT, free to copy.
- **Minis** (`/minis/`): tiny things to play with, each opened in the same kind of panel as a post or a
  project. Each is one file in `src/minis/` and a few lines in `src/content/minis/`.

How to add one is in `src/mote/README.md`.

## Built

- **Blocks** (toy): a pile of blocks. Double-click an empty spot, or press Space, for a new piece. Also what posts embed.
- **Balance** (game): roll a ball along a tilting beam onto marks, against a clock and the wind.
- **Climb** (game): a block with a hammer and a long way up. The hammer follows the mouse, which the game holds inside its box.
- **Chain** (toy): beads on a rope with a weight.
- **Solid** (toy, 3D): a shape to spin; click for the next one.
- **Table** (toy, 3D): a dice tower with real tumbling dice, typed rolls and a history, and a D&D helper with a fight view and a character view.
- Mote has a project page at `/projects/mote/`, a logo (a speck in a beam of light) and tests (`bun run test`).
- The list on `/minis/` shows each mini running, small.
- A terminal player (`src/components/Terminal.astro`) for command-line projects. It is not part of Mote.

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
8. For the 3D side: smooth shading across faces, a shadow under each solid, pictures drawn onto faces,
   loading a simple model from a file, a wireframe view, dice that hit each other corner to corner
   and not as balls, a camera you can move.
9. More minis: a marble run you draw, a ragdoll, a seesaw, a tower to knock down, something for two
   people on one keyboard, a daily puzzle with the same layout for everyone that day.
10. For the Table: sharing a fight between two browsers, a spell-slot tracker, saving more than one
    character, loud dice.
11. For Climb: more of the mountain, a clock, a ghost of your best run.
12. For the terminal: recordings of the full-screen menus, made with asciinema.

## Not doing

- scriptc (vercel-labs): it compiles TypeScript to native programs and WASI modules. It does not draw to a
  browser canvas, so it is no use for minis on the site. It could matter later for a desktop build.
