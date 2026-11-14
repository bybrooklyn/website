# Mote

A small engine for tiny demos and games in the browser, in TypeScript, so that each mini does not write its
own loop, canvas and input again. Every mini on the site runs on it except the Walker and the generalist,
whose engine is the Rust crate in `walker/`. It has a project page at `/projects/mote/` and a logo, a speck
in a beam of light.

## Where the code is

`src/mote/`. Its own `README.md` there says what each file gives and how to write and add a mini. It is
under the MIT license in that folder (`src/mote/LICENSE`), plainer than the rest of the site's code.

| File | What it is |
|---|---|
| `stage.ts` | The canvas, a loop in fixed steps of 1/120 s, mouse and keys, the page's colours, a panel for buttons, a little kept between visits, the address. Runs only while seen and stops when the scene rests. |
| `flat.ts` | 2D physics: boxes, balls, bars and shapes, walls, pins, rods, ropes, a motor, a hand to grab with. |
| `space.ts` | 3D physics: solids that fall, tumble and hit each other and fixed slabs, each turning by its own inertia tensor. |
| `grid.ts` | The broad phase both physics use: which pairs of bodies are near enough to be worth a closer look. |
| `gl.ts` | 3D drawing on WebGL 2: depth, a sun with shadows, sky light, numbers on faces, floating words, glow. |
| `solids.ts` | The shapes of dice and other solids, drawn on a 2D canvas where WebGL 2 is missing. |
| `sound.ts` | Knocks and notes made by the browser with no files, silent until turned on. |

## Built

All of the above. The physics in `flat.ts` and `space.ts` follows the soft step method Erin Catto described
for Box2D 3. Mote began on 10 Nov 2026 on forked libraries (planck, cannon and three) and by 11 Nov had
none: what was needed was written into it.

### The broad phase

Until 13 Nov 2026 both physics tested every pair of bodies in a nested loop: 1,000 bodies are 499,500
pairs a step. Now `grid.ts` finds the pairs worth a look, and the same test as before is run on those
alone.

- **What it is.** A hashed grid: space is cut into cubes about the size of a moving body's box, each body
  is listed under the cubes its box covers, and two bodies under one cube are a pair. A body that would
  cover more than sixteen cubes (a floor, a wall, a long ramp) is kept out of the grid and set against
  every body by its box. A grid suits the minis, which have many small moving things of about one size and
  a few large fixed ones; sweep and prune on one axis does badly in a tall pile, where a whole column shares
  an axis, and a tree of boxes is more code for no gain at these sizes.
- **The same answers.** Each body's box holds every place the old test could let a pair through: in 2D a
  body's middle, its size and its share of the margin; in 3D the same for a solid that moves, and for one
  that does not (fixed, asleep or held) the space its faces pushed out by the most any moving solid
  reaches, since that is what the old test measured against. The pairs are put back in the order the loop
  met them, by first body and then second, so the solver, which depends on order, does the same work.
  `pairs.test.ts` runs Blocks, Plinko's board, the dice tower and two crowded heaps with the grid and with a
  loop over every pair, and every body ends in the same place, turned the same way, to the bit. A check
  against the old files themselves gave the same.
- **Nothing made in a step.** The grid keeps its arrays and grows them only when a scene grows.
- **Also in 3D:** last step's contacts were found again by a search through all of them for each new one,
  which in a pile of thousands cost more than the pairs did. They are kept in a map by pair.

Step times from `crowd.test.ts` (one step of 1/120 s, the middle of a few, on four cores of this computer;
"loose" is balls thrown about a box, "pile" is blocks or cubes stacked touching):

| Bodies | 2D loose, before | after | 2D pile, before | after | 3D loose, before | after | 3D pile, before | after |
|---|---|---|---|---|---|---|---|---|
| 100 | 1.1 ms | 1.0 ms | 4.3 ms | 4.6 ms | 17 ms | 14 ms | 35 ms | 35 ms |
| 500 | 5.5 ms | 1.6 ms | 12 ms | 11 ms | 77 ms | 54 ms | 263 ms | 227 ms |
| 1,000 | 17 ms | 2.6 ms | 32 ms | 18 ms | 201 ms | 107 ms | 627 ms | 473 ms |
| 5,000 | 421 ms | 7.3 ms | 471 ms | 95 ms | 2,260 ms | 113 ms | 6,338 ms | 2,292 ms |

Finding pairs no longer grows with the square of the count. What is left is the work on each pair that
touches: in 2D that keeps a pile of 1,000 inside its 8.3 ms only on a fast machine, and in 3D the contact
code (`touch`, which makes many small arrays) is now nearly all of a step.

### How hard a solid is to turn

Until 13 Nov 2026 `space.ts` gave every solid one number for how hard it is to turn, right for a cube
and the regular dice and wrong for anything long, flat or lopsided. Now each solid has its inertia
tensor, from its shape.

- **From the shape.** `inertia(points, faces)` sums the tensor over the pyramids from the solid's middle
  to each triangle of its faces, so it works for any solid that bulges everywhere: a box, a rod, a ball
  of faces, every die. The test checks a box against its formula exactly and a rod and a ball of many
  faces against a cylinder and a sphere to within 1%.
- **Into the world each step.** The tensor's inverse is turned by the solid's turn at the start of each
  step and used for every push in it.
- **The spin by itself.** A solid harder to turn one way than another changes its spin with no push (a
  bar tumbles, a coin wobbles). That is taken on each part of a step in the solid's own frame by the
  implicit midpoint rule, solved by Newton's method in two or three goes. The rule keeps the energy of the
  spin and the size of its angular momentum exactly; the plain step adds energy each time. A box spinning
  free for ten thousand steps keeps its energy to one part in a billion; the direction of its momentum
  wobbles by 1.2% at 240 steps a second (0.6% at 480), and the wobble does not grow. A bar spun about its
  middle axis turns right over, again and again, as a real one does; spun about its long or short axis it
  stays within a few degrees. A lopsided wedge dropped on a corner turns the way its tensor says, to a
  sixth of a degree, where one number would put it four degrees off.
- **The same as before where it should be.** Where the tensor is the same about every axis (within one
  part in a billion: a cube and the four, six, eight, twelve and twenty sided dice) the one number is
  kept, worked out as before, and those solids step exactly as they did, to the bit. The ten-sided die is
  not the same about every axis, so it now turns as its shape says; its fairness test still passes.

## Decided

- **No third-party libraries, by rule.** Nothing forked and nothing added: what Mote needs is written in its
  own TypeScript. `src/mote/` imports nothing from outside its folder, and `scripts/lint.ts` fails if it
  does.
- Features are added when a mini needs them.

## Open

- **Its API is uneven between its parts**, to be put right in the audit: `flat.ts` counts in pixels with y
  down and `space.ts` in units with y up; `flat.still` is a value where `space.still()` is a call; a few
  calls take a row of bare numbers.
- **Features for when a mini needs one:** a camera that pans and zooms; particles; sprites and a tile grid;
  springs and motors between bodies; one-way platforms, and sensors that notice a body without stopping it;
  saving a run and playing it back; a debug view of contacts, joints and sleeping bodies; a frame-time meter
  beyond the `?debug` step time; touch with two fingers; text input.
- **For the 3D side:** smooth shading across faces, a shadow under each solid, pictures drawn onto faces,
  loading a simple model from a file, a wireframe view, dice that hit each other corner to corner rather
  than as balls, a camera that can be moved.
- **A repository of its own**, if anyone else wants to use it.
- scriptc (which compiles TypeScript to native programs and WASI modules) was looked at: it does not draw to
  a browser canvas, so it is no use for minis; it could matter for a desktop build later.

## How to run and test

```sh
bun test src/mote     # flat, space, grid, pairs, replay, crowd, gl and the rest
```

`gl.test.ts` draws a scene in headless Chromium and reads its pixels. `replay.test.ts` checks that a scene
run twice ends the same and that a step is fast enough. `grid.test.ts` checks the broad phase against a
loop over every pair, and `pairs.test.ts` the minis' scenes with it and without, to the bit. `crowd.test.ts`
prints step times for 100 to 5,000 bodies and takes about forty seconds; run it on its own with
`bun test src/mote/crowd.test.ts` when measuring.

## Known weak spots

- `stage.ts`, `solids.ts`, `sound.ts` and `index.ts` have no test beside them; they are on the lint's list
  of files written before the rule, which is not to grow.
- Mote was written before the rule that every exported thing has a sentence above it, and is held to it
  only for what is added.
