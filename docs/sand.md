# A sand simulator

A mini: a grid of grains, each of one material, that fall, flow, burn and react with each other. A plan
dated 13 November 2026. Stage 1, the engine and its tests, was built on 14 November 2026; the mini is a
draft at `/minis/sand/`, not listed.

## Where the code is

- `sand/`: the engine, a Rust crate of its own built to WebAssembly. `sand/README.md` lists every function
  the page calls. `materials.rs` is the table of materials and reactions, `world.rs` the grid, chunks,
  step and brush, `level.rs` the pass that levels water and steam through a connected body.
- `public/wasm/sand.wasm` and `sand-scalar.wasm`: the built modules, with SIMD and without, committed.
- `src/mote/cells.ts`: Mote's drawing of a grid of cells, one texture of cell bytes colored in the shader.
- `src/minis/grains.ts`: what the page needs of the engine; `src/minis/sand.ts`: the scene.
- `scripts/sand-speed.ts`: the speed in headless Chromium.

## Decided

- **A grid of cells**, as falling-sand toys are: every cell holds one material and moves by simple rules.
- **A sandbox**: pick a material, pour it with the pointer, watch. Brush size, erase, pause, step, clear,
  and a link that shares the world.
- **Fast and accurate.** Fast: a large world at sixty frames a second. Accurate: the rules give the same
  world from the same start on every machine, sand piles and water levels as they should, and nothing is
  made or lost that a reaction does not account for.
- **Materials in the first version.** Sand, water, fire and dirt. The elements: stone, wood, oil, lava, ice,
  steam, smoke, acid. Pride sand: sand in the flags' colors that keeps its stripes as it falls, and a brush
  that pours a whole flag.
- **Rust, WebAssembly and the graphics card, each for what it does well.**
  - The simulation is Rust built to WebAssembly, as the Walker's engine is. A grain moves by swapping with
    a neighbor and two often want the same place; on the processor one goes first, where a graphics card
    would have to work in fixed blocks that change how sand and water feel.
  - The graphics card draws it, through Mote: a color for each grain, glow from fire and lava, and smoke.
  - What only spreads (heat, later perhaps smoke and pressure) may move to the graphics card afterwards,
    measured before it is kept.

## The design

### The world

- A grid of cells, each a few bytes: its material, a shade (so that sand is not one flat color and pride
  sand keeps its stripe), a lifetime or temperature, and a flag for "moved this step".
- Cut into chunks of 64 by 64. A chunk with nothing moving sleeps and costs nothing; a chunk wakes when a
  neighbor pushes something into it or a brush touches it. Each awake chunk keeps the small rectangle in
  which things moved, and only that is worked through.
- Size to aim for: 1024 by 576 cells on a desktop, fewer on a phone, drawn at whole-pixel multiples so
  grains are square and sharp.

### The step

- Cells are visited bottom to top, and left to right or right to left by turns, so nothing drifts to one
  side. A cell that has moved this step is not moved again.
- Kinds of movement, one rule each: powders fall and slide off slopes (sand, dirt, pride sand); liquids
  fall and then spread sideways several cells in a step, so that water levels quickly (water, oil, lava,
  acid); gases rise and spread (steam, smoke); fire rises, flickers and dies; solids stay (stone, wood,
  ice). Density decides who sinks through whom: sand through water, water through oil.
- Chance is used for a natural look (which way a grain slides, whether a flame catches), from a counter
  kept in the world, so that the same world and the same strokes give the same result.

### Reactions

A table, one line each, of what two neighbors make: fire and wood make fire and smoke; fire and oil burn
fast; water and fire make steam; lava and water make stone and steam; lava lights what burns; ice and heat
make water; steam cools to water; acid eats stone, wood and dirt and is used up; dirt and water make wet
dirt, which holds its slope. Temperature is a number in each cell that spreads to neighbors, so that ice
near lava melts without touching it. The table is data, so a material is added by adding lines.

### Speed

- The step in Rust with no allocation, the grid in one flat array, and SIMD where a rule allows it.
- Workers: chunks are worked through in a checkerboard of four phases, so that no two workers touch
  neighbors at once. This needs shared memory, which needs the page isolated by two headers, as mdQuire's
  pages are; without it the mini runs on one worker and a smaller world.
- The page draws from the engine's memory with no copy: one texture of cell bytes, colored in the shader.
- Measured, with targets: a full world of falling sand, a full world of water levelling, and a forest
  fire, each at sixty frames a second on the owner's machine and thirty on a mid phone.

### Accuracy, tested

- The same seed and the same strokes give the same world to the byte, natively and in WebAssembly.
- Nothing appears or vanishes: the count of each material changes only by what the reactions table says.
- Sand piles at its angle; water in two joined vessels reaches one level; oil floats on water; a sealed
  box of steam stays sealed.
- Sleeping chunks never hide work: a world run with sleeping off gives the same result.

### The page

- The canvas fills the mini's frame. A row of materials as swatches with names, the brush size, erase,
  pause, step, clear, and "copy link to this world". Pride sand opens to the flags.
- The pointer pours; a drag draws a line with no gaps however fast it moves. Touch works, and the page
  does not scroll while pouring. Keys pick materials and change the brush.
- The world in a link: small worlds packed into the address; larger ones saved as a file.
- Glow is allowed inside the mini. Outside it the site's rules hold: nothing moves by itself, and the
  simulation rests when nothing is moving or the mini is out of sight.

## Built: stage 1

### The world as built

- **A cell is four bytes**, one u32: the material; a shade chosen by chance when it is made; a byte kept
  for stage 2 (always 0 now, carried with the cell when it moves); and the clock of the step it last moved
  in (six bits) with its falling speed (two bits). The page draws the grid as a picture of four channels
  straight out of the module's memory, reading only the first two.
- **One flat array** with a border of 8 cells all round, wall or void by the setting for the edges, so no
  rule checks a bound.
- **Chunks of 64 by 64.** A change to a cell adds to its chunk's rectangle the cells it could set moving:
  5 either side (the farthest any material looks sideways) and 2 above and below. Each chunk keeps one
  rectangle for this step and one for the next. The rectangles are read as the step reaches each row, so
  a cell set moving earlier in the same step is still reached. A chunk with an empty rectangle costs
  nothing. A cell that could have moved and by chance did not keeps itself in next step's rectangle; every
  rule that uses chance does this, which is what makes sleeping exact.
- **The step**: rows from the bottom up, each row left to right and right to left on alternate steps,
  chunk by chunk in the same direction. A cell that moved this step is not moved again. Powders fall,
  gathering speed to 4 cells a step, and slide off a slope: sand when the cell beside it and the one under
  that are open (45 degrees), dirt when two under it are (about 63). Liquids fall, slide, and spread up to
  5 cells sideways toward somewhere lower; one with something resting on it is pushed, and spreads as far
  as it can. A cell whose support has just moved away goes to a side before following it down, so the
  face of a heap of water flows out at once. Gases do the same upside down. Nothing moves diagonally
  between two cells that touch only at their corners, so a wall of such cells holds. A falling cell passes
  through a lighter liquid or gas, one cell a step.
- **Levelling** (`level.rs`). Cell by cell, water in one arm of a U never reaches the other. After the
  cells move, each body of one liquid near a change (its cells joined by their sides) moves up to 64 of
  its highest surface cells to its lowest open places, while each place is lower than its top. Steam is
  the same upside down. Every move lowers a cell, so it comes to rest and does not flicker. What a body
  does depends only on its own cells, and bodies are applied in order of their first cell.
- **Chance** comes from a hash of the world's seed, the step, and the cell's place: the same three give
  the same number whatever order cells are reached in, which is what lets sleeping and a checkerboard of
  phases give the same world.
- **Materials**: empty, sand, water, stone, dirt and steam, and two edges (wall and void). Steam was
  chosen over smoke because it is kept exactly until stage 2's heat turns it back to water. Wet dirt
  needs dirt and water to react, so it is left to stage 2.
- **Brushes** in the engine: a line between two cells with a radius and no gaps however long, each cell
  filled by a chance (powders, water and steam are poured at 45 in 100, stone laid solid), only into
  empty cells; erase; clear.
- **The edges** are walled. Open edges, where what moves past one is gone, are built as a setting
  (`set_edges`) and tested, but not offered on the page.

### Speed

No allocation in the step: everything the step uses, the levelling pass's lists included, is made with
the world. Measured on four cores of this computer (`taskset -c 0-3`), a world of 1024 by 576, the mean
step and the slowest:

| World | Native | Chromium, SIMD build | Chromium, no SIMD |
|---|---|---|---|
| The whole world sprinkled half full of falling sand, first 120 steps | 2.15 ms (7.3) | 2.41 ms (10.6) | 2.67 ms (11.4) |
| A dam of water 512 wide and 476 high let go, first 300 steps | 4.8 ms (9.7) | 5.6 ms (6.6) | 6.4 ms (10.6) |
| A settled world (hills, ledges, a lake) with sand poured in one place | 0.043 ms (0.07) | 0.058 ms (0.2) | 0.067 ms (0.2) |
| The same, with water poured into its lake | 0.115 ms (0.18) | 0.14 ms (0.3) | 0.17 ms (0.4) |
| The same, untouched | 0.017 ms (0.05) | 0.021 ms (0.2) | 0.022 ms (0.1) |

The target, sixty steps a second, leaves 16.7 ms a step: the busiest world here takes under half of that
in the browser. Sleeping off, falling sand takes 3.3 ms natively. A settled world with one small
pour costs a few hundredths of a millisecond, as sleeping should make it.

Times in the browser move by a tenth or more from run to run; a second run of the same was up to 60%
slower throughout, so each number above is from one clean run, with the native ones checked twice.

**SIMD.** One rule allows it plainly: four cells are tested at once for being empty and passed over
together. It did not measurably help. Natively the times are the same with it and without
(`--features scalar`); in Chromium a SIMD build without that test took 2.46 ms on falling sand where the
full SIMD build took 2.48 ms in the same run, and the dam was the same to a hundredth. The SIMD build's
lead over the build without SIMD (about a tenth) comes from the compiler's own use of it. The test is
kept, as it costs nothing in size and both builds give the same cells to the byte, but it could go. The
rules themselves branch on every neighbor, which SIMD does not suit.

**Four phases, for workers later.** The step can already work through chunks in a checkerboard of four
phases (`set_order(1)`): every other chunk across and down, each from its bottom row up. A cell moves at
most 5 cells sideways and 4 down in a step, and a change marks at most 5 cells sideways and 2 up or down,
so a chunk's reads, writes and marks stay within the chunks beside it; two chunks of one phase are a chunk
apart and never touch the same cell. A phase can therefore be shared among workers and give the world
one thread gives, provided each worker keeps its marks on neighboring chunks apart and they are merged
after the phase. The levelling pass looks at whole bodies, across chunks, and runs after the four phases
on one thread (or finds bodies in parallel and applies their moves in order of their first cell, as now).
Sleeping is tested to change nothing in either order. The two orders give different worlds, so moving
to phases in stage 4 means taking the fingerprint again.

### Accuracy, tested

Each is a test in `sand/tests/accuracy.rs`, run natively; those marked so also run in the built module
(`src/minis/grains.test.ts`).

- **The same seed and strokes give the same world to the byte**, and another seed does not. A busy world
  made through the exported functions has one fingerprint natively, in the SIMD build and in the build
  without SIMD (`sand/tests/unchanged.rs` and the WebAssembly test).
- **Nothing appears or vanishes**: every material counted after 3,000 steps of a busy world, and after
  each of 60 strokes while it is still stirring (also in WebAssembly).
- **Sand piles at 45 degrees and dirt at about 63**: poured from one point onto a floor, sand comes to
  between 40 and 47 degrees and dirt between 58 and 65, for three seeds.
- **Joined vessels reach one level within 250 steps** (about 190, measured), within one cell, and are then
  still: the fingerprint does not change over 50 more steps and no chunk is awake. A puddle spreads flat
  and comes to rest.
- **The heavier sinks**: a box of steam, water and sand, layered upside down, ends sand, water, steam, with
  no water or sand over anything lighter.
- **A sealed box stays sealed**: steam in a diamond of single cells touching only at their corners stays
  in for 3,000 steps, and water in a V of such cells does not leak. Steam gathers level under a lid.
- **Sleeping hides no work**: a busy world, with strokes while it runs, gives the same cells to the byte
  every step for 900 steps with sleeping on and off, in both orders (also in WebAssembly).
- **Nothing drifts**: sand and water poured in the middle of a box, 40 seeds each, end with their middle
  of mass within three standard errors of the middle.
- An open world lets everything fall out; a settled world sleeps until touched.

Also looked at in headless Chromium, with real drags: sand piles, dirt holds a steeper slope, water fills
two vessels joined at the foot to one level and two pictures of it 1.5 s apart are identical, steam rises
and gathers level under a lid, and nothing passes a wall of single cells touching at their corners. The
page asks for no frames once the world is still or the mini is scrolled out of sight.

### What stage 2 can rely on

- A material is a line in `MATERIALS` and a constant for its number; its colors go into the palette, and
  the page offers it if `paint` is true. A new kind of movement is a new rule in `world.rs`.
- `REACTIONS` and `reaction(a, b)` are there and empty; the step reads nothing from them yet. A reaction
  is a change to a cell and must call `touch` for it; one that could happen and by chance does not must
  call `stay`, or sleeping stops being exact (the test will say so).
- A cell that changes by itself (fire burning down) writes itself and calls `touch` each step, which keeps
  its chunk awake.
- Byte 2 of every cell is free for a lifetime or a temperature. Heat that spreads every step through the
  whole world may be better as a plane of its own, as the plan says it may later move to the graphics card.
- A new rule that looks farther than 5 cells sideways or 2 up or down must widen the margins in
  `world.rs`, or sleeping will hide work.
- The levelling pass already handles every liquid and gas: oil and water are separate bodies, and water
  sinks through lighter oil cell by cell.
- The fingerprint changes whenever a rule does: take it again in `sand/tests/unchanged.rs` and
  `src/minis/grains.test.ts` together.

## Stages

1. The engine and its tests: the grid, chunks and sleeping, powders, liquids and gases, with sand, water,
   stone and dirt. Drawn plainly. Speed measured. Built 14 November 2026, with steam as the gas.
2. Heat and reactions: fire, wood, oil, lava, ice, steam, smoke, acid, with the table and the conservation
   tests.
3. The page: the materials row, brushes, pride sand and the flag brush, links, touch and keys, glow.
4. Workers and the graphics card for what spreads, each kept only if it measures faster.

## Open

- Its name.
- Whether worlds wrap at the edges, are walled, or let things fall out of the bottom. Walled for now;
  open edges are built as a setting.
- Wind, gravity that can be turned, and a way to shake the world.
- Living things and things that explode, chosen against for the first version.
- To confirm from stage 1: sand at 45 degrees (real sand rests nearer 34) and dirt at about 63; steam that
  gathers level under a ceiling as an upside-down liquid rather than spreading through the whole space;
  water levelled through a body by moving its top cells to its lowest places, up to 64 a step; a cell of
  one CSS pixel (in whole device pixels) so that a desktop gets near the plan's 1024 by 576, which makes
  grains small; pouring at 45 cells in 100.

## How to run and test

```sh
bun run wasm                          # builds sand.wasm and sand-scalar.wasm with the Walker's modules
cd sand && cargo test                 # the rules and every accuracy test, in about a second
bun test src/minis/grains.test.ts     # the built modules: fingerprint, sleeping, counts, materials
bun test src/mote/cells.test.ts       # the grid drawn in headless Chromium
cd sand && cargo run --release --example speed               # the speed natively
cd sand && cargo run --release --example speed --features scalar   # without the hand-written SIMD
bun scripts/sand-speed.ts             # the speed in headless Chromium, both builds
```

The page itself is a draft: `bun run dev` shows it at `/minis/sand/`, as does a build with
`SHOW_DRAFTS=1`.

## Known weak spots

- The levelling pass looks at a whole body while any part of it is awake, so a large lake with a small
  pour into it costs the lake's size each step (0.115 ms (0.18) natively for the test's lake).
- A world sprinkled everywhere with single drops makes the first steps slow while the pass looks at each
  drop as a body (the slowest step of a sprinkled world of water is about 16 ms natively).
- Touch was checked by the canvas's `touch-action` and Mote's pointer events, not by a real touch drag.
- The world is made once, for the size the mini has when it loads; a resize keeps it and fits it again in
  whole pixels, cutting its edges if the canvas has grown smaller than it.
- With no WebGL 2 the page says so and draws nothing.
