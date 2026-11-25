# A sand simulator

A mini: a grid of grains, each of one material, that fall, flow, burn and react with each other. A plan
dated 13 November 2026. Stage 1, the engine and its tests, was built on 14 November 2026, stage 2, heat
and reactions, the same day, and stage 3, the page, on 14 and 15 November; after it, how sand and lava move
and how the flags look were reworked, and stage 4 was measured. The mini is a draft at `/minis/sand/`, not
listed.

## Where the code is

- `sand/`: the engine, a Rust crate of its own built to WebAssembly. `sand/README.md` lists every function
  the page calls. `materials.rs` is the table of materials and the table of reactions, `world.rs` the
  grid, chunks, step and brush, `react.rs` the step's reading of the reactions, `heat.rs` the pass that
  spreads heat, `level.rs` the pass that levels water and steam through a connected body.
- `sand/tests/`: `accuracy.rs` (movement, counts, sleeping), `reactions.rs` (heat and every reaction the
  plan names), `unchanged.rs` (the fingerprint), and `common/` what they share.
- `public/wasm/sand.wasm` and `sand-scalar.wasm`: the built modules, with SIMD and without, committed.
- `src/mote/cells.ts`: Mote's drawing of a grid of cells, one texture of cell bytes colored in the shader,
  with stripe colors, light and soft gases.
- `src/minis/grains.ts`: what the page needs of the engine (the row's order and keys, how hard each
  material is poured, the world's size, the flag brush's block); `src/minis/sand.ts`: the scene and its
  panel, which is the page's side (the pointer, the view, the column, sound); `src/minis/sand-core.ts`:
  the world's side (the engine, the grid that draws it, the stepping, undo), driven by messages and run
  in a worker by `src/minis/sand-worker.ts`; `src/minis/flags.ts`: the flags; `src/minis/worlds.ts`: a
  world as text, for a link or a file.
- `sand/examples/film.rs`: films a scene frame by frame as one picture, to look at how things fall, flow
  and burn without the page.
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

## Built: stage 2

### Heat

- **Byte 2 of every cell is its temperature**, 0 to 255, room temperature 40. Air (an empty cell) holds
  one too, so heat crosses a gap through it. A new world, an erased cell and a cleared world are air at
  40. The brush lays each material at the temperature its line says (`made`): ice at 0, lava at 250, a
  flame at 230, steam at 120, everything else at 40.
- **Heat spreads by a pass after the cells move** (`heat.rs`). Across each side between two cells it flows
  from the hotter to the colder: the difference times the slower of the two conductors (`conduct`, 0 to
  32), over 256. The part of a unit left over is rounded up by chance in proportion, the chance belonging
  to the side (seed, step and where the side is), so both cells find the same flow and one gains exactly
  what the other loses. Every cell reads temperatures from before the pass, so the order cells are
  reached in changes nothing. Two cells within 2 of each other pass nothing: that is what lets a world
  come to rest. Rounding toward nothing was tried first and abandoned: it left a band of 8 to 21 degrees
  that never moved, so heat could not cross a body of water and ice in warm water never melted.
- **Heat goes up faster than down** between two cells that can flow (air, liquids, gases, flames): twice
  as fast up and half as fast across the other way. Hot air and smoke carry heat upward; a flame heats
  the wood above it more than the wood beside it.
- **Heat is kept.** It moves with a cell when the cell moves (a swap is a true swap of all three bytes).
  Melting and boiling store heat in the water and steam they make (`latent`: water 8, steam 28, wet dirt
  8), so a cell's heat is its temperature plus what its material stores; freezing and condensing give it
  back. What makes or takes heat is stated: the brush; a flame cooling by 4 a step; burning wood warming
  itself by 16 a step up to 200; what catches fire starting at least as hot as its line's `hot`; air above
  room temperature cooling by 1 a step (the open air carrying heat away, so a fire does not slowly heat
  the whole world); and the steam that escapes from wet dirt under lava (`Heat::Lost`).
- **Each band of change is apart from its reverse**, so nothing flips back and forth: ice melts at 28 or
  more into water 8 cooler, water freezes at 12 or less into ice 8 warmer, water boils at 80 or more into
  steam 20 cooler, steam condenses at 56 or less into water 20 warmer. A test checks every such pair.
- **Sleeping stays exact with heat.** Each chunk has a second pair of rectangles for heat. Anything that
  changes a temperature marks the cell and its four neighbors: a swap of two cells at different
  temperatures, or of a cell still warming or cooling itself; a reaction; the brush. A cell with any side
  that could carry heat this step, whether by chance it did or not, wakes itself and its neighbors for the
  next step, for the heat pass and for the rules (so a cell that crosses a melting point is visited). Sand
  falling through air all at one temperature wakes no heat, which is why it costs what it did in stage 1.

### The materials

One line each in `MATERIALS`. Conduct is in 32nds of the most; `made` is the temperature the brush lays.

| Material | Kind | Density | Conducts | Made at | Besides |
|---|---|---|---|---|---|
| air (empty) | empty | 0 | 12 | 40 | cools 1 a step down to 40; lets air reach what burns |
| sand | powder | 160 | 12 | 40 | slides at 45 degrees and rolls on landing (`roll` 255): heaps near 35 |
| water | liquid | 100 | 32 | 40 | levels; stores 8 |
| stone | solid | 255 | 24 | 40 | |
| dirt | powder | 150 | 12 | 40 | slides at about 63 degrees |
| steam | gas | 4 | 2 | 160 | levels under a ceiling; stores 28; airy |
| wood | solid | 255 | 24 | 40 | |
| oil | liquid | 80 | 16 | 40 | levels; floats on water |
| lava | liquid | 200 | 8 | 250 | creeps (moves sideways 96 steps in 256); hardens where it rests; shade follows heat |
| ice | solid | 255 | 32 | 0 | |
| smoke | gas | 3 | 10 | 90 | does not level: rises, drifts and thins; airy |
| fire | fire (new kind) | 1 | 1 | 230 | rises and wavers; cools 2 a step; shade follows heat; airy |
| acid | liquid | 110 | 28 | 40 | levels; sinks under water |
| wet dirt | powder | 170 | 12 | 40 | slides at about 72 degrees; stores 8; not offered to the brush |
| ember (burning wood) | solid | 255 | 20 | 200 | warms 16 a step up to 200; shade flickers with heat; not offered |
| ash | powder | 40 | 6 | 40 | floats; airy; not offered |
| rock | powder | 190 | 24 | 40 | loose stone that lava makes in water or on loose ground: floats on lava, sinks in water, piles; not offered |
| burning oil | liquid | 80 | 16 | 185 | warms 16 a step up to 185; shade flickers with heat; not offered |

Fire is a new kind: each step it moves up, or up and to a side by chance (a quarter of the time each
way; an eighth since the owner's play, below), so a flame wavers; when it cannot rise it moves to a side now and then. It never levels. A falling
cell passes through it as through a lighter gas.

### The reactions as built

`REACTIONS` in `materials.rs`, one line each, tried in order by the cell named first when it is visited,
before it moves; the first that happens is the one, and a cell that changes does not move that step. A line
with a neighbor looks at the four sides from one picked by chance. Chances are in 1024ths each step
("always" is every time it can). "Airy" is air, smoke, steam, fire or ash: what lets air reach what burns.

| The cell | Beside | Its temperature | Becomes | The neighbor becomes | Chance | Heat |
|---|---|---|---|---|---|---|
| water | alone | 12 or less | ice | | always | kept (gives back 8) |
| water | alone | 80 or more | steam | | always | kept (stores 20 more) |
| dirt | water | any | wet dirt | air | 96 | shared |
| steam | alone | 56 or less | water | | always | kept (gives back 20) |
| wood | anything airy | 90 or more | burning wood | as it was | 384 | kept |
| wood | fire | any | burning wood | as it was | 192 | kept |
| wood | lava | any | burning wood | as it was | 64 | kept |
| oil | anything airy | 85 or more | burning oil | as it was | 512 | it starts at 185 or more |
| oil | lava | any | burning oil | as it was | 256 | it starts at 185 or more |
| oil | fire | any | burning oil | as it was | 96 | it starts at 185 or more |
| lava, at rest on a solid | alone | 100 or less | stone | | always | kept |
| lava, at rest on a powder or on lava | alone | 100 or less | rock | | always | kept |
| lava | water | any | rock | steam | 64 | shared |
| lava, at rest | water | 100 or less | rock | | always | kept |
| ice | alone | 28 or more | water | | always | kept (stores 8) |
| smoke | alone | any | air | | 12 | kept |
| fire | alone | 60 or less | air | | always | kept |
| fire | alone | 90 or less | smoke | | 40 | kept |
| fire | water | any | air | steam | 640 | shared |
| acid | stone | any | smoke | air | 24 | kept |
| acid | wood | any | smoke | air | 32 | kept |
| acid | dirt | any | smoke | air | 40 | kept |
| acid | wet dirt | any | smoke | air | 40 | kept |
| wet dirt | air | 78 or more | dirt | steam | 256 | carried (the steam takes the dirt's heat) |
| wet dirt | lava | any | dirt | stone | 128 | shared, less 90 that escapes |
| burning wood | water | any | wood | steam | 512 | shared |
| burning wood | alone | any | smoke | | 4 | kept |
| burning wood | alone | any | ash | | 2 | kept |
| burning wood | air | any | as it was | fire | 128 | the flame starts at 230 or more |
| burning oil | air | any | as it was | fire | 160 | the flame starts at 230 or more |
| burning oil | alone | any | smoke | | 2 | kept |
| burning oil | alone | any | air | | 6 | kept |

What each line does to the counts follows from it (`changes` in `materials.rs`): wood becomes burning wood
one for one, burning wood becomes smoke or ash one for one, smoke thins to nothing and fire dies to nothing
(the stated losses), a flame is made from the air by burning wood (a stated making), lava and water make
stone and steam one for one, acid and what it eats make smoke and air one for one, dirt and water make one
wet dirt and leave air (wet dirt counts as both), and wet dirt dries to one dirt and one steam, or, under
lava, to dirt with its water escaping as steam into the ground (a stated loss). The engine counts every
line that happens (`World::fired`); a test holds every material's count, after thousands of steps of a
busy world, to what those lines say.

**Heat rules of a line**: kept (each cell keeps its temperature, less what its new material stores more);
shared (the two share their heat evenly, less what the new materials store); carried (the new neighbor
takes the cell's heat and the cell the neighbor's); lost (shared, less a stated amount). `hot` makes heat:
what catches fire starts at least that hot.

### Fire, as tuned by looking

Fire was tuned in pictures of scenes stepped natively and on the page in Chromium. What it does now:

- **A forest** of trees a cell or two apart, lit at one end, burns across as a front: flames climb each
  trunk (about 8 cells a second), crowns catch from their neighbors, trunks burn down, ash gathers on the
  ground and a plume of smoke rises. The test forest of 25 trees burns through and is out after about
  5,000 steps; 600 steps in, 94% of its wood is still there.
- **A gap**: fire always crosses two cells of air between columns of wood, now and then three, never
  seven. It crosses by heat through the air and by flames wavering onto the other side, nothing else.
- **A candle**, a stub of wood three wide lit at the top, burns down steadily from its top to a small heap
  of ash, in about 600 steps for a stub 3 wide and 45 tall. The top never comes back up.
- **Oil** on water burns as a front from where it is lit to the far end and leaves the water. A flame
  touching oil always lights it.
- **Water** puts fire out with steam, and burning wood back to wood.
- **A flame with nothing to burn** goes out in 35 steps (the test allows 20 to 80): it never dies at
  once and never burns on.

Choices made by looking: wood lights at 90 (at 130 the brush's fire could not light it); flames cool by 4
(at 6 they died before reaching a neighbor); burning wood goes to smoke twice as often as to ash (all ash
buried the forest floor); air conducts 12 (at 8 fire crossed two cells only, at 16 lava hardened in the
air); lava conducts 8 (at 24 a pour sprayed by the brush was a third stone before it settled, and
hardened in a few seconds); lava hardens only at rest (falling drops had hardened in the air and hung
there as stone).

### Stage 1's choices, reconsidered

- **Sand rests near 35 degrees**, measured 35.3 for three seeds (real sand rests near 34). A grain that
  has just landed on a step, with the slope going on below the far side of it, rolls on over it; a sliding
  grain keeps a little speed so that where it stops counts as landing. Grains at rest never roll, so a
  heap still comes to rest and sleeping stays exact. The heap is steeper near its top and gentler at its
  foot, more like a real heap than stage 1's even triangle. Rolling by chance less often gives angles
  between (40 degrees at 200 in 256).
- **Water no longer appears at the far shore.** Looked at in a wide lake with a pour at one end, the
  levelling did teleport: a new layer appeared in blocks at the far end while the mound stood at the pour.
  Now open places equally low are ranked by how far they are from the body's highest top, so the new layer
  spreads out from the pour as a front, about six cells a step. The column of the top is known only after
  the body is found, so a body with something to move is found twice; one at rest, once. A pressure pass
  was not needed. It costs a lake with a pour 0.18 ms a step against 0.12.
- **Gases**: steam still gathers level under a ceiling, briefly now, since it cools and rains; smoke does
  not level at all but rises, drifts and thins, since a cloud of smoke levelled every step through a forest
  fire would cost a whole flood fill of the cloud. Filling a space evenly was not tried: steam rains and
  smoke thins long before it would show.
- **Two liquids side by side come to rest.** A liquid now spreads sideways only into air or a gas, not
  into a lighter liquid: water with oil resting on it had traded places with oil five cells along, for ever.
  A heavier liquid still gets under a lighter one by falling, sliding and levelling.
- **The margin up and down comes from the table** (`deepest`): wet dirt looks three cells under its side,
  so a change wakes three rows up and down, where stage 1 woke two. The checkerboard of four phases still
  holds: a chunk's reads, writes and marks stay within the chunks beside it.

### Speed

Measured on four cores (`taskset -c 0-3`), a world of 1024 by 576, the mean step and the slowest. Stage 1
was run again beside stage 2 in the same minutes, as the machine was shared.

| World | Stage 1, native | Stage 2, native | Stage 2, Chromium, SIMD | Stage 2, Chromium, no SIMD |
|---|---|---|---|---|
| A forest fire across the whole world, every tree lit at its foot, first 1200 steps | | 5.9 ms (10.2) | 6.7 ms (9.1) | 6.9 ms (9.3) |
| The whole world sprinkled half full of falling sand, first 120 steps | 2.07 ms (7.3) | 2.32 ms (10.7) | 2.53 ms (12.5) | 2.78 ms (13.2) |
| A dam of water 512 wide and 476 high let go, first 300 steps | 4.6 ms (6.4) | 6.0 ms (7.2) | 6.7 ms (7.5) | 7.2 ms (8.3) |
| A settled world with sand poured in one place | 0.041 ms (0.07) | 0.047 ms (0.08) | 0.065 ms (0.2) | 0.068 ms (0.2) |
| The same, with water poured into its lake | 0.113 ms (0.25) | 0.185 ms (0.37) | 0.23 ms (0.5) | 0.235 ms (0.5) |
| The same, untouched | 0.016 ms (0.07) | 0.020 ms (0.08) | 0.032 ms (0.2) | 0.033 ms (0.2) |

The forest fire, the plan's third world, keeps 143 of 144 chunks awake and burning, and holds sixty steps a
second in the browser with room to spare: 6.7 ms of the 16.7 a step allows. Stage 1's own browser numbers
were 2.41, 5.6, 0.058, 0.14 and 0.021 ms for the other five, in a run of its own. Why the others are
slower: every moving cell is now checked for a reaction (water checks two temperature bands, which a calm
band precomputed per material, 13 to 79 for water, skips almost at once), the dam's water cools and is
checked as it falls, and a lake with a pour is found twice. The heat pass costs nothing where everything is
at one temperature. It was first a pass over every awake cell into a second array and back, which cost
falling sand 0.7 ms a step; working rows top down in place, with the old row kept, and keeping heat's own
rectangles, brought that to nothing.

The module is 78.5 KiB with SIMD and 79.6 KiB without (stage 1: 41.3 and 40.7), under its limit of 128.

### Accuracy, tested

In `sand/tests/reactions.rs` unless said; each prints what it measured.

- **Every count changes only as the lines that happened say**: three busy worlds of every material, for
  3,000 steps each, and a world stirred with 60 strokes of everything (`accuracy.rs`). Materials that do not
  react at room temperature (sand, water, stone, oil) are kept exactly, with no line happening.
- **Heat is kept exactly where nothing makes or takes it**: a world full to the brim (no air to cool) of
  water, ice, lava, stone and sand, 2,000 steps, the same total every step, with melting, freezing and lava
  hardening in it. **Heat never increases in a closed box with no source** (water, lava, ice, steam, smoke,
  sand and acid in a sealed stone box): every step's total is at most the last, and the air carries some
  away.
- **Lava poured into water** makes a crust of stone and steam: every cell of lava ends lava or stone,
  every cell of water water, steam or ice; of 166 cells of lava, 46 hardened by meeting water, the rest by
  cooling against the crust, with up to 19 cells of steam at once.
- **Ice in warm water** (70) melts: 137 cells gone in 186 steps, the water from 70 to 56.
- **Ice holds in still air and melts near lava without touching it**: a wall of ice three cells from a
  pool of lava is half gone in 637 steps; a wall in still air keeps 136 of its 144 cells after 36,000
  steps (ten minutes), since the air around it cools and shields it.
- **A sealed stone box of water heated from below by lava boils, and the box holds**: of 1,197 cells of
  water, up to 513 are steam at once; nothing of it is ever outside the box, and water, steam and ice
  always add up.
- **Oil floats on water and burns on top of it**: poured oil ends over the water, never under it; lit at
  one end, 1,063 of 1,083 cells burn, no flame is ever inside the water, and the water stays (3,738 of
  3,743 cells, the rest boiled off).
- **Acid on stone eats a pit and is used up**: 378 cells of acid eat 378 cells of stone in a pit 9 deep,
  and none is left after 452 steps.
- **Wet dirt holds a steeper slope than dry** (71.5 degrees against 63.4) **and dries beside lava**: a heap
  of wet dirt with lava against its foot has 19 cells dried; water poured on dirt soaks into it where it
  meets it, a cell for a cell, and the rest lies on top as on wet ground.
- **A flame with nothing to burn goes out within 80 steps**: in 35, for three seeds.
- **A forest lit at one end burns across and goes out**; **fire jumps a gap of two cells and not one of
  seven**; **a candle lit at the top burns down**, its top only ever coming down.
- **A world that has burnt out and cooled goes to sleep** (wood, lava, water, ice and fire: asleep after
  about 2,300 steps) and stays still.
- **Sleeping hides no heat and no reaction**: a burning forest beside lava, ice, water, oil and acid gives
  the same cells to the byte with sleeping on and off, in both orders, every step for 1,500 steps; and the
  busy world of every material does too (`accuracy.rs`).
- **Steam rises, gathers level under a lid, and rains back down as it cools** (`accuracy.rs`); a sealed
  box of steam keeps it as steam or water. **Two liquids side by side come to rest.**
- **The same strokes give the same world to the byte** natively and in both builds: the fingerprint world
  now pours sand, water, dirt, steam, wood, oil, lava, ice, smoke, fire and acid, so heat and the
  reactions are in it; taken again because every rule changed.

Looked at on the page in headless Chromium with real drags, photographed over time, and natively in
pictures of the same scenes while tuning: a candle burning down to ash; a row of trees lit at the foot of
the first (on the page, drawn with crowns three cells apart on a slant, the first burns and the fire stops,
as the gap rule says; drawn a cell apart, as in the tests, it burns across); a lava pool beside a wall of
ice, glowing, crusting from its edges and hardening over some seconds while the ice holds; water poured on
lava, crusting it and lying on the stone; acid on a floor of stone slabs eating down through them and
running out; steam rising as a column that rains back, smoke rising and thinning; sand heaped at its new
angle; and a wide lake poured into at one end, the new layer flowing out from the pour. Lava poured as a
spray lands as a blob, its foot and sides hardening into jagged stone against the cold floor while its top
stays molten. On the page in headless Chromium the world steps at about half speed, as that browser draws
in software.

### What stage 3 can rely on

- Every material the brush should offer has `paint: true`; the page reads the table (`materials()` in
  `grains.ts`), so the twelve buttons come from it. Wet dirt, burning wood and ash are made by reactions
  and not offered. Kind 6 is fire; `fillOf` pours it at 45 in 100 like the other things that move.
- The page draws bytes 0 and 1 as before. Fire and lava set their shade from their temperature each visit
  (burning wood with a flicker), so they are brighter the hotter they are and a change of shade is drawn as
  a changed row. Glow can read byte 2, the temperature, straight from the same texture: a flame is 60 to
  230, lava 100 to 250, burning wood about 200. A change of temperature alone is not reported in
  `changed_from` and `changed_to`; a glow drawn from byte 2 will want it to be.
- `awake()` counts a chunk whose heat is still spreading, so the page keeps stepping while anything is
  warming or cooling, and rests once the world is even and still.
- A new material is a line in `MATERIALS`; what it does is lines in `REACTIONS` (kept together by
  material, which a test checks), and the count test follows from the lines with no change to it.
- Pride sand is a powder like sand: give it `roll` to rest near 35 degrees, or not to keep 45.

## Built: stage 3

### The page

- **The canvas fills the mini's frame**, the world fitted in whole pixels. **A cell is 2 CSS pixels**,
  rounded to whole device pixels (`CELL` in `grains.ts`): at 1440 by 900 the frame is 746 CSS pixels and
  the world 373 by 280; on a phone at three device pixels to a CSS pixel, 6 a cell and about 174 across;
  on a tablet at two, 4 a cell. Chosen by looking: at one CSS pixel a cell (stage 1) a grain could hardly
  be seen; at three a desktop world felt cramped. A smaller world steps faster than the measured
  1024 by 576.
- **The row of materials**: one swatch for each material the table offers (`paintable`), a square of
  seven by seven grains of it colored as the grid colors them (`swatchColor`, the shader's sums in
  TypeScript), in a 44 pixel target. Powders, liquids, solids, gases, fire (`inRow`), then erase, a dashed
  square of air. The chosen one has the accent round it. Fourteen in a row on a desktop or tablet, two
  rows of seven on a phone. A name for each as its tooltip and for screen readers, with its key.
- **Keys**, while the mini has the keyboard, as Mote's own: a letter of each name (`KEYS`): S sand, D dirt,
  P pride sand, W water, I oil, L lava, A acid, T stone, O wood, C ice, M steam, K smoke, F fire, E erase;
  the brackets size the brush; Space (or Enter) pauses. The wheel sizes the brush too, only while the
  mini has the keyboard, so it never stops the page scrolling past.
- **The brush**: a size of 0 to 24 cells either side, by a slider, the brackets or the wheel; its outline
  drawn at the pointer inside the canvas (a circle, or the flag the flag brush will lay), for a mouse while
  it hovers and for a finger while it pours. A drag pours a line with no gaps. A press held still pours as
  long as it is held.
- **How hard each is poured** (`fillOf`): moving, 45 in 100; solids laid solid; lava solid, so it lands
  molten and not as drops that each harden alone (it had made porous crusts and stone towers). Held
  still, a powder pours about three grains a step whatever the brush's size: a held brush refills the
  cells that fell out of it, about four rows a step, and at 45 in 100 that is several times what a heap's
  slopes carry away, so sand stacked up under the brush into a pillar (see weak spots).
- **Pause, step, clear**, the world resting by itself as before. **Clear is undone once**: the button
  says "undo clear" until the next stroke and puts the world back as it was, temperatures and all (a copy
  of the cells, written back and `rewritten(0)`). Undoing a stroke was not built: the world moves on under
  a stroke, so it would mean putting back everything since, which is a different thing.
- **Touch**: a finger pours and the page does not scroll (`touch-action: none` on the canvas, checked with
  real touch events at 390 by 800 and 1024 by 768: the page moved by 0). Only the first finger pours; a
  second does nothing (`isPrimary`).
- **Glow** is drawn in Mote's grid and only there: nothing outside the mini changes. Nothing decorative
  moves by itself: what moves is the world, which runs only when the visitor has touched the mini under
  reduced motion, as Mote does for every mini.

### Pride sand and the flags

- **Pride sand** (material 18) is one line of `MATERIALS`, sand in every number but its shade, which is a
  stripe's color times 4 (64 colors), with a slight shade of its own in the lowest two bits. The step never
  sets it (`glow` 3), so a grain keeps its stripe wherever it goes. No reaction names sand or pride sand,
  and the count tests include it: its count never changes but by the brush.
- **The flags** (`flags.ts`): rainbow (six stripes), trans and lesbian in the colors the site draws them in
  beside its name (`.flag.trans`, `.flag.lesbian` in `base.css`, a test holds them equal), bisexual (2:1:2,
  written as five stripes), pansexual, nonbinary. 28 stripe colors of the 64. They are laid out as a third
  row of the drawing's palette.
- **Pouring in stripes** (`paint_striped`): which stripe by where a cell lies across the line, the first
  on its upper side (its left when it goes straight up or down). A moving line lays only the cells it has
  newly reached and lays them solid, so each part of the ribbon is laid once and falls whole: poured
  again as it fell, as a plain brush is, the stripes mixed to confetti. Held still, the stripes are side by
  side across the brush and fall as a curtain, after the pointer has stayed in one cell for 0.2 s (before
  that, the curtain mixed into a slow stroke). Looked at: a quick stroke lands as a low ribbon of
  readable layers; a slow one as a flatter ribbon, still layered; a held pour as a cone striped from
  side to side.
- **The flag brush** (`flag`): a whole flag, two high to three wide, 8 cells high for the smallest brush
  to 104 for the largest (`flagSize`), laid once a press into the empty cells under the pointer. It falls
  as a block and settles as a stepped heap with every stripe in order, the top one on top.

### Glow, light and soft gases

In `src/mote/cells.ts`, from what the texture already carries. The palette's second row's fourth byte says
how a material is drawn (`DRAW_STRIPED`, `DRAW_LIGHT`, `DRAW_SOFT` in `materials.rs`): fire, lava and
burning wood give light; steam and smoke are soft. Each frame that anything changed:

1. **Gather** at half the grid's size into two pictures: the light of each two by two cells (the cell's
   own color times its brightness from byte 2, nothing up to 70, the most at 240, eased) and the soft
   cells' color.
2. **Blur** both across, then down: four samples each way, each pair of texels read as one between them,
   a bell of spread 2.6 half-texels, about twelve cells.
3. **Draw** the cells sharp; a soft cell at 0.7 of its color (`SOFT_SHARP`, it was 0.4) over its blurred haze; the light added over
   everything, kept a color the page can blend (as opaque as it is bright).

A single hot cell gives little light, as it is averaged over four; a mass of fire or lava glows round
itself. Nothing cold glows. A draw with no new rows leaves the canvas as it is.

### The world in a link

`worlds.ts`. The bytes: a version, width and height, the striped material's number, then runs of tokens
(a material, or a stripe past 64) each with its length in LEB128. Squeezed by the browser's
`CompressionStream("deflate-raw")` (every current browser has it; without it the bytes go plain, marked
"p"), in base64 with - and _, after `#world=` in the address, so nothing is sent to a server. Temperatures
and shades are not kept: an opened world is made as the brush makes it (`rewritten(1)`). A world of 300 by
180 with everything in it, part settled, took under 16,000 characters; the page's world with a floor, a
flag and a pool took 491. Over `LINK_MOST`, 16,000 characters, "copy link to this world" saves it as a file
(`world.sand`, the same text) instead, opened by dropping it on the mini or with "open a world". An opened
world is made at its own size, fitted in whole pixels, and paused. The fragment is taken away at the first
stroke after it is opened, and a link pasted into the same page opens.

Opening is bounded: text past 4,000,000 characters, a size past 1024 by 576, runs that do not cover the
world exactly, a token with no meaning, a run longer than three bytes, all are refused quietly, and
unsqueezing stops at the most a world can take (about 2.4 MB), so 20 MB of squeezed zeros is refused in
well under two seconds. The engine checks every cell again (`rewritten`).

### The engine, for the page

- `paint_striped`, `flag` and `rewritten` (README.md).
- **A flame touching wood lights it** (48 in 1024 a step). Fire poured under a beam had warmed it only to
  about 80, short of the 90 it lights at, as a flame cools as it rises, so nothing a visitor poured under
  wood caught. Fire still crosses a gap of two cells and not seven, and the candle and forest tests hold.
  The fingerprint was taken again.

### Speed

The step is unchanged (pride sand is a line of the table; no rule changed but a reaction line). The
drawing, in headless Chromium, which draws in software (SwiftShader), on a forest of 24 trees burning across
the world with lava, at 1440 by 900, timed by reading a pixel back after each draw call so each pass's
time is its own:

| Device pixels to a CSS pixel | A frame's work | Of it, drawing | Gather, blur across, blur down, final | The rest (the step) |
|---|---|---|---|---|
| 1 | 9.6 to 10.7 ms (90%: 12.5) | 7.2 to 8.4 ms | 1.4, 1.1, 1.0, 4.0 ms | 2.3 ms |
| 2 | 22 ms (90%: 24) | 18.5 ms | 1.4, 1.1, 0.9, 15.4 ms | 2.7 ms |

At one device pixel a CSS pixel it holds sixty frames a second in software; at two, the final pass,
which grows with the canvas's pixels, takes it to about 40 frames a second there. The glow's own passes are at half the
grid's size and cost about 3.5 ms in software whatever the screen, much of it the forced read back. A
graphics card does any of these in a small part of a millisecond; measuring on one is left to stage 4.

### Tests

`cargo test` in `sand/`: 32 unit tests (pride sand is sand but for its shade; stripes laid either way and
held still; a flag's stripes; pride sand keeps every stripe as it falls and piles; written cells made
workable), 13 accuracy (pride sand in the stirred and kept-exactly worlds), 15 reactions, 1 fingerprint.
`bun test src/minis src/mote`: grains (the row's order and keys, fill, flag size, swatch colors, world
size, fingerprint), flags (the site's colors), worlds (to text and back to the byte through the engine,
squeezed and not; rubbish and a bomb refused), cells (stripes; light round a hot block and none round a
cold cell; the blur's weights).

Looked at in headless Chromium at 1440 by 900 and by finger at 390 by 800 and 1024 by 768: every
material poured; each flag poured both ways and laid whole; a wooden frame and a forest lit; lava poured
into water; clear and undo clear; a link copied and opened in a fresh page, paused, the same; hostile
links refused with no error.

### What stage 4 can rely on

- The page reads everything from the table: a new material appears in the row by its kind; give it a
  letter in `KEYS`. A new flag is a line in `FLAGS` (64 stripe colors in all).
- The page writes cells itself only through `rewritten`; workers must keep that call's meaning.
- `CELL` sets the world's size; the cells are drawn by `cells.ts`, which needs only the bytes and the
  palette, so moving heat to the graphics card can use the same texture.
- The link's format has a version byte; a change to materials' numbers needs a new version.

### To confirm with the owner

- The six flags, their order, and nonbinary's dark stripe, which is near the ground's color.
- The keys, a letter of each name, with oil I, wood O, ice C, steam M and smoke K.
- A cell of 2 CSS pixels.
- A flame touching wood lighting it, a change to stage 2's fire.
- Held pours of powder at about three grains a step; lava poured solid. (Changed after stage 3: see below.)
- Undo of clear only, not of a stroke.
- Links up to 16,000 characters, then a file.

## Built after stage 3: how sand and lava move, and flags as poured sand

The owner asked for three things after stage 3: sand that comes down promptly from a column or a steep
face, lava that pools rather than building a pillar, and pride sand's flags that look like sand poured in
layers rather than perfect stripes. The first two were each written as a failing test first.

### How powder moves now

Two artifacts made a pillar slow, found by watching one come down cell by cell. In each row the edge grain
slid out and its neighbor slid into the cell just left, so whole rows shifted a cell sideways together and
the pillar rocked from side to side; and once that was stopped, the face drained as a falling curtain, all
the mass leaving through one point at each foot, because a heap's surface carried a grain a step on each
side. The rules now:

- **A crowded column spills.** A grain of powder already moving, with powder pressing on it, whose
  support has gone this step but only one cell (so it can follow only one), goes to a side as a resting
  cell whose support has gone does, rather than following it down. It is found inside `drop`, where how far
  a grain can fall is already known; as a separate test it cost falling sand 8 to 10%. It spills only into
  open air, not into a cell its neighbor has just left, so a block of grains landing together keeps its
  order. Grains falling freely, as a stream from the brush, are farther apart and fall as a stream.
- **A moving grain slides on.** A grain already moving slides down a slope as far as its speed allows (up
  to its `fall`), gathering speed, so a heap's sides carry away more of what lands on it (`slide_down`).
- **Sand rolls off a slope steeper than about 37 degrees**, at rest or not: when the ground `ROLL_ALONG`
  (4) cells along is that many lower (`roll_off`). A slope of three in four holds, 45 does not, so a heap
  built quickly at 45 settles to sand's own angle and then stays still. It looks four cells along and three
  down; `widest` and `deepest` count it, so a change wakes as far as it looks.
- **Sand's landing roll** is 220 in 256 (it was 255), which with the rule above rests sand near 35 degrees.

Measured, a pillar 18 wide and 60 tall stood on the floor at once (1080 grains), three seeds:

| | Before | After |
|---|---|---|
| Sand: no column over 34 (as low as a heap of it at 45 degrees) | 237 to 241 steps | 28 to 36 |
| Sand: at rest | 308 to 315 steps | 139 to 145 |
| Sand: its angle at rest | 37.1 degrees | 34.3 to 34.7 |
| Dirt: no column over 48 | 192 steps | 49 |
| Dirt: at rest | 271 steps | 81 to 83 |
| Sand poured from a point (the angle test) | 35.3 degrees | 35.0 to 35.3 |
| Dirt poured from a point | 63.4 to 63.8 degrees | 61.1 to 61.6 |
| Wet dirt poured from a point | 71.5 degrees | 68.4 to 68.6 |

Dirt and wet dirt are a little gentler because they slide on too; both stay inside their tests. The test
`a_pillar_of_powder_comes_down_to_a_heap_at_its_angle_promptly_and_stays_there` holds the pillar to a heap
within 60 steps, at rest within 400, at its angle, and still afterwards (nothing creeps for 300 steps).

Tried and dropped, by measuring each: a grain at rest not starting into a cell just left (needed until the
spill existed, then not); a chance for a resting grain to start sliding (no faster); pushing a grain with
powder over it sideways out of a steep face (no faster, and steepened heaps to 42 degrees); a falling
grain's speed being the distance it fell (slower, and changed water); toppling only beside a cliff three
cells deep (weaker); fast slides only for grains pressed from above (slower). With the fast parts alone,
heaps rested at 38 to 40 degrees: grains glide down a 45 degree face and build it from the foot, so the old
35 degrees, which came from grains meeting partway down and rolling, needed a rule of its own.

**The held pour.** A brush held still now pours about ten grains of powder a step whatever its size
(`HELD` in `grains.ts`; it was three, so that sand would not stack into a pillar), 45 in 100 at most. Poured
from a point at about 5, 7, 9 and 11 grains a step for ten seconds, the heap stood as a cone each time, its
peak 56, 71, 89 and 105 cells high; at 16 a step it stood as a column under the brush. Ten was chosen by
looking at it on the page.

### Lava pools

Watching a held pour showed why it built a tower: the stream from the brush thins into separate drops as
each cell speeds up, and a drop with air on all four sides cooled from 250 to its hardening point in about
eight steps, so drops landed already cold and hardened where they landed; and lava creeping only 96 steps
in 256, two cells at most, piled into a mound whose sides hardened into walls that rose with it. Now:

- **A falling cell passes heat at a quarter of its rate** (`conducts` in `heat.rs`), since it meets each
  cell of air only for a moment and a cell of air here holds as much heat as a cell of lava. Both cells of a
  side see the same rate, so heat is still kept. A stream of lava lands hot.
- **Lava levels through its body, but thickly.** The table's `level` is now a number: 0 does not level, 1
  levels until flat (water, oil, acid, steam), and more rests with the surface that many cells less one
  uneven. Lava is 8. It spreads under its own weight, so new lava lands in molten lava, but stops while
  still several cells deep. Levelled flat, it spread one cell thin and froze against the floor: twice as
  much stone as lava.
- **Lava passes heat at half its old rate** (conduct 4, was 8), so a body stays molten inside while its
  open edges harden.
- **A held pour of lava** is about nine cells a step (`HELD`); drawn along a line it is still laid solid, so
  it lands as a blob. Poured solid when held, it now drained from under the brush as fast as the brush could
  refill and flooded the world.

The test `lava_poured_in_one_place_makes_a_molten_pool_with_a_crust_and_not_a_pillar` pours about eleven
cells a step from high up for 600 steps onto the bottom edge: before, a tower 93 cells high, 322 cells of
lava and 1,150 of stone; now 28 to 32 high, about 4,700 lava and 450 stone. Left alone, the share of its lava
with air beside it falls from about a tenth to none by the time half has hardened (a crust all round a
molten inside), and it is all stone after 3,400 to 4,100 steps.

Tried and dropped: lava pressed by liquid above moving every step regardless of its pace (a dome of lava
stood under the pour, 51 high, as the levelling never takes a cell that moved from a body's top); stone
beside lava melting back at 200 or more (it never happened: a body's lava averaged 135 to 145); lava at
conduct 6 or 8 with levelling (taller and more stone).

Stage 2's tests all hold, some numbers moving inside them: lava poured into water, 185 cells of lava, 72
hardened by water (was 166 and 46), steam at most 31 (was 19); a wall of ice beside lava half gone in 597
steps (was 637); the boiling box at most 426 cells of steam (was 513); the burnt-out world asleep after 2,342
steps (was about 2,300).

### Speed

Measured on four cores (`taskset -c 0-3`), a world of 1024 by 576, the mean step, before and after, in the
same minutes. Native numbers are from the quieter of two runs; the machine was shared and runs moved by up
to a fifth.

| World | Native | Chromium, SIMD | Chromium, no SIMD |
|---|---|---|---|
| Forest fire, first 1200 steps | 8.00 to 8.07 ms | 9.67 to 9.76 ms | 9.43 to 9.75 ms |
| Falling sand, first 120 steps | 2.41 to 2.36 ms | 2.83 to 2.65 ms | 2.80 to 3.14 ms |
| Dam of water let go, first 300 steps | 5.94 to 5.83 ms | 7.61 to 6.91 ms | 7.47 to 7.78 ms |
| Settled, sand poured in one place | 0.048 to 0.076 ms | 0.070 to 0.101 ms | 0.068 to 0.110 ms |
| Settled, water poured into the lake | 0.176 to 0.172 ms | 0.258 to 0.227 ms | 0.239 to 0.243 ms |
| Settled, untouched | 0.020 to 0.021 ms | 0.035 to 0.033 ms | 0.033 to 0.035 ms |

All the same within the runs' noise but the settled world with sand poured into it, which costs a few
hundredths of a millisecond more because more grains move as the new heap settles to its angle (the
number of cells that change in falling sand is the same, 11.33 million in 120 steps against 11.32). Timed
alone, best of seven, falling sand is within 2 to 5% of before.

### Flags as poured sand

- **A whole flag** (`flag`) is laid as sand is layered in a jar: each edge between two stripes wanders
  smoothly along the flag (`wandering`: a height chosen by chance every 12 columns, eased between) by up to
  a quarter of a stripe and never more than two rows, so a stripe is thicker in one place than another;
  each grain's edge is moved by up to 0.6 of a row more by chance, so the stripes meet grainily; and a grain
  near an edge strays across it 9 times in 256 (`STRAY`). Every stripe stays in order, since no edge moves
  more than a quarter of a stripe. All of it comes from the world's seed and the press's stroke, so the same
  press lays the same flag.
- **Poured stripes** (`paint_striped`) meet grainily and stray the same way across the ribbon.
- **Each grain has a shade.** A stripe's lowest two bits are a step of lightness, toward black for the two
  darker steps and toward white for the two lighter, by up to the shade range's red (pride sand's is 40 in
  255): white can only darken and nonbinary's near black only lighten, and each stripe still reads as its
  own color. In the shader (`cells.ts`) and in `swatchColor`. The trans and lesbian colors in the palette
  are still the site's own, as `flags.test.ts` holds.
- **Links.** The format keeps material and stripe and no shades, as before; an opened world is made with
  `rewritten(1)`, which already gives each striped grain its step by chance from the engine's seed, so it
  does not open flat. The format and its version byte are unchanged. `worlds.test.ts` holds that an opened
  flag has all four steps, each about as often.
- **Tests**: a flag 120 by 80 has every stripe in every column, in order but for strays never more than a
  stripe, each stripe within about a tenth of its share, edges that wander by two rows or more, strays under
  one in a hundred; the same press lays the same cells and another world does not; a flag too small to
  wander keeps its order. A striped stroke's middle rows are certain and its edges grainy.
- **Looked at** in headless Chromium at 1440 by 1500 and at 390 by 1400 with three device pixels a CSS
  pixel, all six flags laid whole on the floor and poured, just laid and settled. Laid whole, a flag now
  slumps into a mound of curved layers within a second, since sand comes down promptly: every stripe in
  order, but no longer standing as a rectangle. Poured stripes dropped from mid-height land mixed, as they
  did before (the stage 3 engine, given the same strokes, lands them the same). The share picture was made
  again with the same strokes: the trans and lesbian flags as layered heaps, a rainbow ribbon between.

### To confirm with the owner

- A flag laid whole slumping into a layered mound rather than standing as a block.
- Sand at about 35 degrees and dirt now about 61 (was 63), wet dirt about 68 (was 71.5).
- Held pours of ten grains a step, and of nine cells of lava; lava drawn along a line still laid solid.
- Lava that spreads as a thick body and crusts, at half its old rate of passing heat; a trickle of lava
  (two or three cells a step) still mostly freezes as it lands.
- The grain shade's strength (40 in 255) and how far edges wander and grains stray.

## Stage 4: workers and the graphics card, measured

The plan was to move what spreads (heat, and whatever else measures well) onto workers or the graphics
card, keeping each only if it measured faster, and to measure first. Nothing was put into the page; what
was tried and its numbers follow.

**Where a step's time goes**, natively on four cores, with the step's three parts timed in a scratch copy
of the crate:

| World | Step | Cells moving and reacting | Levelling | Heat |
|---|---|---|---|---|
| Forest fire, 373 by 280 (a desktop's page) | 2.21 ms | 1.07 ms (49%) | 0.06 ms | 1.07 ms (49%) |
| Falling sand, 373 by 280 | 0.24 ms | 0.22 ms (93%) | 0.01 ms | 0.004 ms |
| Dam of water, 373 by 280 | 0.68 ms | 0.47 ms (70%) | 0.20 ms | 0.001 ms |
| Lava poured in one place, 373 by 280 | 0.20 ms | 0.06 ms (32%) | 0.03 ms | 0.10 ms (52%) |
| Forest fire, 1024 by 576 | 8.08 ms | 4.13 ms (51%) | 0.28 ms | 3.67 ms (45%) |
| Dam of water, 1024 by 576 | 5.98 ms | 4.61 ms (77%) | 1.36 ms | 0.01 ms |

Heat matters only where things burn or lava cools, and is then about half a step.

**What the browser charges**, measured with `scripts/sand-spread.ts` in headless Chromium on four cores,
which draws in software (SwiftShader):

- A barrier among four workers sharing memory (the page served isolated, with the two headers): about
  4 to 5 microseconds. Workers are cheap to keep in step.
- The whole grid sent to the graphics card, run through one pass the size of the heat pass and read back:
  1.0 to 1.1 ms at 373 by 280 (0.34 of it the reading back) and 5.5 to 5.8 ms at 1024 by 576 (1.8 to 2.6
  reading back). A step of the forest fire in the built engine is 2.46 ms at 373 by 280, so its heat pass is
  about 1.2 ms; at 1024 by 576, 8.9 ms and about 4.

**Heat on the graphics card: not kept.** In software the round trip alone, with a trivial pass, costs as
much as the heat pass it would replace at the page's size, and more at the largest. The real pass would
cost more: the rounding chance belongs to each side and comes from a 64-bit hash, which WebGL 2's 32-bit
integers would have to build from halves to stay the same to the bit; the cells that could still carry heat
would have to be read back too, to keep sleeping exact; and the graphics card would work the whole grid
every step where the engine works only the awake rectangles (a still world's heat costs nothing now). On a
real graphics card the pass would be far cheaper but the reading back still waits for it each step; that
could not be measured here. `bun scripts/sand-spread.ts --serve` serves the same page to open in a browser
with one.

**Heat on workers: faster in the engine, not put into the page.** The heat pass was split into bands of
rows of equal work (the awake cells of each row added up), each band working its rows in place from copies
of the rows at its edges made first, its wakes gathered and applied after. Natively, with four threads
started every step, it gives the same cells to the bit as one thread, and:

| World | Heat, one thread | Heat, four | Step, one | Step, four |
|---|---|---|---|---|
| Forest fire, 373 by 280 | 1.10 ms | 0.57 ms | 2.24 ms | 1.73 ms |
| Lava poured, 373 by 280 | 0.110 ms | 0.064 ms | 0.209 ms | 0.168 ms |
| Forest fire, 1024 by 576 | 3.70 ms | 2.05 ms | 8.07 ms | 6.46 ms |

(Bands of equal rows did worse: the empty sky's bands sat idle while the fire's worked.) In the browser it
would save about half a millisecond of the busiest scene's 2.5 ms step, on a page that already steps sixty
times a second and whose frame is mostly drawing (about 8 ms in software at one device pixel a CSS pixel).
To get it, the module would have to share its memory with workers, which needs the core library rebuilt
with atomics: on this machine's stable Rust that builds only through the compiler's escape hatch for its
own development (`RUSTC_BOOTSTRAP=1` with `-Z build-std`), tried and working, but a build the site would
then depend on. The sand page would need the two isolation headers, as mdQuire's pages have, which limit
what it may load; and the engine would have to step in a worker, since the page's own thread may not wait
on a barrier, with the drawing reading shared memory. Those costs were judged not worth half a millisecond
the visitor would not see; the experiment's code was not kept.

**The cells' moving on workers: not tried.** It is the larger part (half the forest fire's step, nine
tenths of falling sand's), and the checkerboard of four phases already gives the world a split among
workers would give (`set_order(1)`, tested). It needs the same shared memory, headers and worker as above,
and the step's marks on neighboring chunks, its counts of reactions and its changed rows kept apart for
each worker and merged after each phase. If it scaled as the heat did, the forest fire at the page's size
would step in about 1.2 ms rather than 2.2. Changing the page to the four phases changes the world it makes,
so the fingerprint would be taken again.

**What is plain from it**: on the machine measured the step is not what holds the page back; the drawing
in software is (stage 3's table). A phone, with a smaller world, steps faster still. If the step ever does
hold it back, the order to try is the cells' moving on workers, then heat on workers, each with the build
and the headers above; heat on the graphics card last.

## Stages

1. The engine and its tests: the grid, chunks and sleeping, powders, liquids and gases, with sand, water,
   stone and dirt. Drawn plainly. Speed measured. Built 14 November 2026, with steam as the gas.
2. Heat and reactions: fire, wood, oil, lava, ice, steam, smoke, acid, with the table and the conservation
   tests. Built 14 November 2026, with wet dirt, burning wood and ash besides.
3. The page: the materials row, brushes, pride sand and the flag brush, links, touch and keys, glow. Built
   14 and 15 November 2026.
4. Workers and the graphics card for what spreads, each kept only if it measures faster. Measured after
   the movement, lava and flags were reworked: heat on the graphics card does not win in software; heat on
   workers is nearly twice as fast in the engine but was not put into the page, for the build and headers
   it needs against half a millisecond nobody would see. Nothing kept but the measuring script.

## Open

- Its name.
- Whether worlds wrap at the edges, are walled, or let things fall out of the bottom. Walled for now;
  open edges are built as a setting.
- Wind, gravity that can be turned, and a way to shake the world.
- Living things and things that explode, chosen against for the first version.
- To confirm from stage 1: dirt at about 63 degrees; a cell of one CSS pixel (in whole device pixels) so
  that a desktop gets near the plan's 1024 by 576, which makes grains small; pouring at 45 cells in 100.
- To confirm from stage 2: sand heaps near 35 degrees, steeper at the top than the foot; a lake rising
  from the pour outward; steam that gathers under a ceiling and rains, smoke that drifts and thins; ice
  that holds in still air for minutes but melts in water and near lava; fire that crosses two cells of air
  and not more than three; how fast fire climbs (8 cells a second), a candle burns (45 cells in 10 s) and a
  forest burns (25 trees in under a minute and a half); burning wood leaving a third of itself as ash; lava that
  hardens where it lands, so a spray of lava drops makes a crust of stone where each drop lands; water on
  dirt soaking only the top layer; air that cools itself toward room temperature (it keeps a long fire from
  warming the whole world, but makes a sealed box of air lose heat too); acid that eats only stone, wood and
  dirt (sand, ice and ash hold it).

## How to run and test

```sh
bun run wasm                          # builds sand.wasm and sand-scalar.wasm with the Walker's modules
cd sand && cargo test                 # the rules and every accuracy test, in about five seconds
cd sand && cargo test -- --nocapture  # the same, printing what each scene measured
bun test src/minis/grains.test.ts     # the built modules: fingerprint, sleeping, counts, materials
bun test src/mote/cells.test.ts       # the grid drawn in headless Chromium, stripes and light
bun test src/minis/worlds.test.ts src/minis/flags.test.ts   # links and flags
cd sand && cargo run --release --example speed               # the speed natively
cd sand && cargo run --release --example speed --features scalar   # without the hand-written SIMD
cd sand && cargo run --release --example film -- water out.ppm    # frames of a scene side by side, as a picture
bun scripts/sand-speed.ts             # the speed in headless Chromium, both builds
bun scripts/sand-spread.ts            # what workers and the graphics card would cost (--serve for a real browser)
```

The page itself is a draft: `bun run dev` shows it at `/minis/sand/`, as does a build with
`SHOW_DRAFTS=1`.

## Known weak spots

- The levelling pass looks at a whole body while any part of it is awake, so a large lake with a small
  pour into it costs the lake's size each step, twice since stage 2 (0.185 ms (0.37) natively for the
  test's lake).
- Heat stops spreading once neighbors are within 2 of each other, so a warm region at rest can still slope
  by up to 2 a cell; a long body of still water can end some degrees warmer at one end than the other.
- Heat is one byte, so its scale is coarse: room is 40, water boils at 80, lava is 250. A material made
  hotter than 255 cannot be.
- Lava hardens within a few steps where it meets cold ground or water, so a little lava poured onto a
  wide cold floor mostly makes stone at once; a pool cools from its edges and stays molten inside for some
  minutes.
- Wet dirt dries only where it is hot and touches air, or where lava presses on it; dirt under a lake
  soaks only its top layer, as water does not pass through wet dirt.
- Oil catches only where flames touch it or its own heat reaches 85 with air beside it: fire dragged
  with two rows of air between it and a lake does not light it, as heat in this world goes up and not
  down. The last thin layer of a slick on water, cooled by the water, may not catch.
- A world sprinkled everywhere with single drops makes the first steps slow while the pass looks at each
  drop as a body (the slowest step of a sprinkled world of water is about 16 ms natively).
- Sand poured faster than about twelve grains a step from one point still stands as a column under the
  brush while it pours (it comes down within a second once the pour stops); the held pour is ten.
- A flag laid whole slumps into a mound within a second, its stripes curved but in order; it no longer
  stands as a block, as sand no longer does.
- A trickle of lava, two or three cells a step, still mostly hardens as it lands: thin flows freeze. A
  body of lava levels while any of it is awake, and cooling keeps it awake for a minute or so, so a large
  pool costs a search of its cells every step until it has hardened.
- A cell falling through the air passes heat at a quarter of its rate, whatever it is: falling water and
  sand warm and cool more slowly in flight too (at room temperature this changes nothing).
- The light and haze are worked out over the part of the world the stage shows and 96 cells round it;
  light from a fire farther off than that does not reach into the view.
- With the view far out, a pixel draws at most four by four cells together; farther out than a quarter
  of a pixel a cell (a stage under 600 CSS pixels wide showing the whole large world), some cells are
  passed over, and a thread one cell wide may flicker.
- With no WebGL 2 the page says so and draws nothing.

## Reworked after the owner's play

The owner found fire did not really work and the mini quite broken; a tester then played it by hand on the
page and counted grains (the counts below are from those scenes, stepped natively one step a frame on the
same strokes, a world of 358 by 278, and checked on the page). What changed, a commit each:

- **Flames live.** A flame was made at 230 but passed heat at 32, so it gave its heat to the air in a few
  steps: one flame alone lived 6 to 9 steps, and a dragged line of 757 flames was 7 flames 16 steps later.
  Fire now passes heat at 2 and cools 2 a step, wavers to a side an eighth of the time each way (it was a
  quarter), and turns to smoke as it dies 40 times in 1024 a step (it was 160). One flame lives 24 to 37
  steps, about 32 on average, rising about 31 cells, and a third end as smoke. Burning wood gives off
  flames 128 times in 1024 a step (it was 256), as each lives four times as long.
- **A flame touching wood lights it** 192 times in 1024 a step (it was 48). A wooden house with fire drawn
  three cells from its wall had nothing burnt in 45 seconds; it now burns down to ash in about 40.
  A flame lives long enough to drift: fire now crosses gaps of up to about nine cells between burning
  columns (eleven now and then, thirteen in none of six seeds), and the test holds that a firebreak of
  fifteen is not crossed where it held seven.
- **Oil burns as a moving fire.** A flame touching oil turned it into one short flame every time, so a
  lake of 5,684 cells either never caught or went up in one flash (half gone 81 steps after fire touched
  it). Oil now becomes burning oil (material 19, not offered): a liquid that keeps itself at 185 and gives
  off flames into the air beside it, 160 times in 1024 a step, burning away in about two seconds a cell
  (6 in 1024 a step to nothing, 2 to smoke). A flame lights the oil it touches 96 times in 1024 a step,
  and burning oil's heat lights the oil beside it that has air above. The same lake lit at one end burns
  as a front: 151 cells gone after 5 seconds, 741 after 10, half after 19. Fire dragged with two rows of
  air between it and the surface still does not light it (heat here goes up, not down). Burning oil on
  water boils some of the water under it: the test's slick of 1,083 cells on 3,743 of water leaves about
  330 of oil, the last layer cooled by the water, and 3,200 of water.
- **Fire stays bounded**: held on stone, sand and dirt for two seconds, none of them changes; poured into
  water, it is out and every cell of water is still water or steam.
- **The ice beside lava** (`ice_holds_in_still_air...`) melts to about half in 1,500 steps and then slows as
  the lava crusts; how near half it comes moves by a cell or two with any change to the chances, so the
  test now holds two fifths. Lava poured three cells from an ice column of 302 cells leaves 34 of it; the
  tester's pour, 25 cells away, crusted before it reached the ice and left 239.
- **Lava sinks in water and hisses.** Lava poured into a cup of water hardened at once into a raft of
  stone resting on the water (858 cells of stone over water, steam at most 81). Water now hardens the
  lava it touches 64 times in 1024 a step (it was 640), into rock (material 20, not offered): stone in
  colour and weight, but loose, a powder that sinks and piles. Lava that cools beside water hardens into
  rock too, and lava hardens on its own only where it rests on something that holds it up (a solid, a
  powder or a liquid at least as heavy), so lava sinking through water no longer hardens hanging in it.
  The same pour now sinks, makes steam up to 317 cells at once, and leaves 607 rock heaped on the floor
  of the cup and 24 cells of stone with water somewhere under them.
- **A bubble rises.** Steam or smoke under a liquid rises through it a cell a step, and water no longer
  spreads sideways into a bubble with liquid over it: water beside a bubble had pushed it from side to
  side for ever, so steam made under water stayed there. Water boiling over lava now bubbles up and
  condenses under the lid (the sealed box boiled 1,879 cells' worth, with at most 25 steam at once,
  where steam had gathered under the water in a layer of up to 426).
- **Ash and flames no longer dam water.** A heap of burnt wood's ash held water 7 to 11 rows higher on
  one side for good, as no liquid could enter a cell of powder. A falling or sliding liquid now takes the
  place of a powder lighter than 80 (only ash; sand and dirt are far heavier, so powders still never pass
  each other), water pressed from above pushes aside ash with nothing over it, and water beside a grain
  of ash with liquid over it leaves it to rise. The levelling pass carries a liquid into flames as into
  air. Water poured beside the tester's heap now stands at row 271 on both sides with no ash under water,
  where it stood at 265 on one side and never reached the other. Water poured on a burning block still
  leaves embers burning where the water beside them boils away as fast as it comes (31 after 20 seconds).
- **Steam poured with the brush reaches a roof.** Made at 120 and passing heat at 12, it cooled to 56 and
  rained within a second and a half: 2,432 cells under a roof were all water 90 steps later, none ever
  under the roof. It is now made at 160 and passes heat at 2. The same pour reaches the roof at once
  (1,021 cells in the rows under it), 3,069 are still steam after 90 steps, and it rains over about
  fifteen seconds. Steam boiled from water is made at 60 as before, and boils and condenses as it did.
- **Grains twice as fine each way, four times as many.** A cell is now one CSS pixel (`CELL` in
  `grains.ts`), rounded to whole device pixels as before: at 1288 by 828 the world is 717 by 513 cells
  (367,821) where it was 358 by 256 (91,648). Measured on the page in headless Chromium with a busy
  world (a lake over a fifth of the world, a forest burning across the left half, sand held pouring into
  the lake): one CSS pixel a cell, a step takes 8.9 to 11.2 ms on the page's thread, and the page steps
  41 to 60 times a second while drawing 14 to 27 frames a second; two CSS pixels, 3.1 ms, 60 steps and
  48 to 55 frames; two thirds of a CSS pixel (three times as fine, 1076 by 769 at 1.5 device pixels a
  CSS pixel, past `MOST`), 12.8 ms, 34 to 37 steps and 11 to 12 frames. So one CSS pixel a cell. The
  frames are the software drawing of headless Chromium; the step is inside its budget. The brush's
  slider is in the first page's cells and pours `FINER` (2) times as many cells either side; a held pour
  is 40 grains of powder and 36 of lava a step (ten and nine, times four); the flag brush lays a block
  twice as many cells high. A world opened from a link or file made at the old size opens at its own
  size, drawn at two device pixels a cell in the middle of the canvas, as any smaller world does.
  Things fall, spread and burn the same number of cells a step, so on the screen they move half as far
  in a second as before.
- **Flames for the finer grains**: fire passes heat at 1 (it was 2), so one flame lives 35 to 54 steps,
  about 48, and rises about 47 cells, as tall on the screen as about 23 of the old cells.
- **No stone left hanging.** On the page, a poured stream of lava stood as a column above the water as
  it sank, and its outside hardened into a shell of stone on lava that then sank away, leaving 435
  cells of stone standing on the water. Lava now hardens into stone only where a solid holds it up; on
  loose ground (a powder, rock, or molten lava) it hardens into rock, which is lighter than lava (190), so
  a crust of it floats on a pool, and falls when what held it up is gone. The test pool still crusts from
  its open edges first and hardens through in 4,000 to 5,100 steps. The owner's scene (sand hills, water
  between, lava poured from above at the left) ends with 2,536 cells of rock heaped on the slope under
  the water and none of stone, where the old page left 769 of stone as a raft on the water. A burning
  cell of oil creeps into the oil beside it 24 times in 1024 a step, so a slick keeps burning where a
  hole has opened in its top, and a flame touching oil lights it 192 times in 1024 (it was 96), as a
  flame touches the surface only for the step it passes.
- **Smoke and steam can be seen.** Smoke was (70, 68, 72) at 170 of 255, drawn at 0.4 of that over the
  dark ground (about (16, 10, 26)): a faint smudge. Steam drawn the same way came out darker than stone,
  so a wisp of it rising from lava over water read as grey grains of rock floating. Smoke is now
  (150, 140, 166) at 235, steam (238, 244, 255) at 240, and a soft cell is drawn at 0.7 of its color.
  By a test's sum (brightness over the ground, as drawn) smoke stands 85 over the ground where it stood
  26, and steam is 167 against stone's 121, where it was 95.
- **Keys work wherever the keyboard is in the mini.** They were heard only on the canvas, so after a
  swatch was clicked F, the brackets and Space did nothing (Space pressed the swatch again). They are now
  heard on the whole mini (`keyAction` in `grains.ts`): a letter picks, the brackets size the brush, and
  Space pauses from a swatch or button rather than pressing it; in a box of text nothing is taken. On the
  tester's steps (click water, then F, ], ], Space) the page now has fire chosen, the brush at 6 and the
  world paused, where it had water, 4 and nothing.
- **The phone's 10 pixels were the test's.** A downward finger drag moved the page by 10 pixels only the
  first time: the test's browser turns touch on at the first finger, which makes the page's
  `(pointer: coarse)` rules apply then and there (the site's name gains its finger padding, 9.6 pixels),
  and the browser keeps the view where it was by scrolling. A second drag moves the page by 0. On a phone
  those rules apply from the start; nothing in the mini was changed for it.

## Reworked toward a livelier world: how things fall and flow

Asked for on 17 November 2026: the mini is to feel alive and dramatic, as Noita does, and what was weird
about how water and the rest fell is to be put right. Filmed on the page before anything was changed (a
brush held over a stone shelf, a frame every quarter second), water came down as a slow woven lattice the
brush's width, stood on the shelf as a mound sixty cells high, and left it in threads one cell wide with
clouds of drops hanging beside them; sand stood as a spire under the brush. Three causes, and what was
done about each:

- **Speeds were those of grains twice the size.** When a cell became one CSS pixel, a cell still fell
  four cells a step at most and a liquid looked five cells to a side, so everything moved half as fast
  on the screen. A cell's last byte now gives four bits to its clock and four to its speed (it was six
  and two; the clock runs to 15): a falling cell gathers a cell a step up to its material's `fall`, ten
  for sand, dirt and water, twelve for rock, nine for oil, six for lava, two for ash. A grain sliding
  down a heap goes at most four cells a step however fast it came (`SLIDE_MOST`), which is what keeps
  the heaps' angles: sand at 34.7 degrees and dirt at 56 to 57 in the tests, as before.
- **A poured grain began at rest.** The brush made cells with no speed, and a cell at rest whose
  support has just gone steps aside before it follows it down (the rule that lets the face of a heap
  flow out), so a pour stepped sideways as it left the brush and kept that weave all the way down. What
  falls now leaves the brush already falling, each grain at a speed of its own from one to three, so a
  pour is a ragged stream. A stripe's grains all leave at one speed, so a ribbon of pride sand still
  falls whole. A liquid that steps off an edge, or slides down to a side, is falling too.
- **A liquid went one cell down a slope in a step.** It slid one cell diagonally where it could, and
  only on the level did it look farther, so under a pour water heaped at 45 degrees as sand does. A
  liquid that cannot fall straight now runs (`runs` in `world.rs`): through the open cell beside it
  and into the one under that where the ground falls away, else along the level, up to its `spread`
  cells along in one step (twelve for water, ten for oil and acid, three for lava), stopping where it
  could fall straight down. A cell at the surface runs only where that takes it lower, so a level
  surface is still; one with something on it runs as far as it can. And a liquid in a crowded falling
  column (what was under it has only just gone, by one cell) is left to run to a side rather than
  follow it down, as a grain of powder in a pillar already was.

A brush held still now pours a set number of cells a step (`HELD` and `fillOf` in `grains.ts`): what it
pours has left the brush by the next step, so it fills the share of its whole disc that is that many
cells, 40 grains of powder, 36 cells of lava, and for another liquid two cells for each cell of the
brush's width. The engine fills by whole cells in 100, so the scene carries what a large brush's share
leaves over to its next step. Filling 45 in 100 of whatever had fallen out of the brush, as before,
would now pour several times as much, since the brush empties at once.

The same film afterward: water falls as a stream of drops, spreads flat over the shelf as it lands,
pours off both edges, runs out level along the floor, and the shelf is dry about a second after the
pour stops. Sand falls as a stream and makes a heap with no spire. Lava runs off the shelf as a thick
liquid and leaves a low mound on it.

`sand/examples/film.rs` is that film without the page: `cargo run --release --example film -- water
out.ppm` steps a scene and writes twelve frames of it side by side (`water`, `sand`, `lava`, `oil`, and
`lake`: two hills, a lake, a wooden house alight and lava poured in).

What changed for the tests: the fingerprint was taken again; a grain's fall is held to its new speeds;
the oil test lights its fire at the oil's surface, the slick now being thicker; and the lava pool's
test allows a core of lava sealed deep inside the rock it made, under one part in twenty of what was
poured, since heat that differs by no more than two between neighbors does not move (a weak spot
already listed) and the pool, spreading wider and lying deeper, now keeps one.

## Reworked toward a livelier world: fire, lava and water that look the part

Played on the page on 17 November 2026 with the new movement, a burning house showed a line of orange
one grain wide along the wood and a few dots rising, lava poured into a lake stood in it as a flat
orange egg, and water was one flat blue. What was changed, in the engine and in how Mote draws the grid:

- **A fire has a body.** A flame still hot (180 or more) spreads into the air beside it 160 times in
  1024 a step, the new flame made at 150, so flames from one place swell and are drawn out into tongues;
  a flame rises one to three cells a step by chance (`fall` 3; it was one), and now and then, once in 96
  steps while it is over 150, leaps three to seven cells up and up to three aside as a spark. Burning
  wood gives off flames 320 times in 1024 a step (it was 128) and burning oil the same (it was 160). One
  flame poured alone, with what it spreads into, is 2.1 flames, lives 24 to 37 steps and rises about 60
  cells; a little over a quarter end as smoke. Smoke rises two cells a step and thins twice as fast (24
  in 1024), so a fire has a column over it that does not fill the world.
- **Wood burns through.** Burning wood chars the wood it touches 12 times in 1024 a step, air or no air,
  and burns away two and a half times as fast (to smoke 10 and to ash 5 in 1024), so a beam thirteen
  cells thick is gone in seconds, not most of a minute. The forest of the test, lit at one end, is out
  after 2,579 steps (43 seconds) with a third of it left as ash.
- **A flame is drawn soft as well as bright** (`DRAW_LIGHT | DRAW_SOFT`): it adds to the haze that smoke
  and steam are spread by, two and a half times as much as they do, so flames a few cells apart are one
  body of fire and not a scatter of dots. Its color runs from yellow at 230 through orange to red as it
  dies.
- **A wide halo.** The light of fire and lava, already gathered at half the grid's size and blurred, is
  blurred once more at an eighth of the grid's size and added again (`HALO` in `cells.ts`): the near
  glow reaches about twelve cells, the halo about sixty, faintly, on air and grains alike.
- **Lava shows its heat.** Its color runs from a dark red-brown as it nears hardening (100) to a bright
  orange as poured (250), where it had only gone from orange to a lighter orange, so a pool is bright at
  its middle and dark at its crusting edges, and with its light and halo a pour is the brightest thing
  in the world. Poured lava is kept a deeper orange than sand: the test that keeps every two materials'
  colors apart now takes a material that gives light at the color it is made at.
- **Water splashes and foams.** A liquid that lands at five cells a step or more throws half its cells
  up, as high as they were fast at most and up to three aside, to fall back (`SPLASH_FROM`). Water is
  drawn paler the faster it is falling (`DRAW_SPRAY`, the speed in a cell's fourth byte): a stream, a
  waterfall and a splash are pale spray, and still water is the deep blue it was. What pours over an
  edge leaves at a speed of its own, one to three, so it comes apart into drops.

Measured natively on the full world of the speed example (1024 by 576, a forest lit all along): about
13 ms a step on a busy machine against about 21 at the commit before, the forest now burning out
sooner; falling sand 2.4 ms, water falling and levelling 4.7 ms.

## A world larger than the stage

Asked for on 17 November 2026: a bigger scene, for more sand; of the ways offered, both a large world
with a view that is moved and zoomed, and a word that grows the stage to fill the window.

- **The world is 2,400 by 1,200 cells** (2.88 million; `WORLD` in `grains.ts`), and 1,200 by 900 where
  the stage is under 600 CSS pixels wide, as on a phone. It was the stage's own size, 748 by 423 at
  1288 by 828. A mini shown small in a list still makes a world no larger than it is shown. Only what
  moves costs time, as before: chunks at rest sleep.
- **The stage is a view** (`View` in `grains.ts`: the cell at the middle of the canvas and how many of
  the canvas's pixels a cell is drawn; `keptView`, `worldAt`, `viewWith`, `zoomStops`, `nextStop`, each
  held by a test). A new world is seen from its floor, in the middle, a CSS pixel to a cell. The view
  stops at 8, 6, 4, 3, 2, 1, a half and a quarter of a CSS pixel a cell, down to the zoom that shows the
  whole world and no further, and is kept to the world: the stage never shows past an edge it need not,
  and where it does (the whole world, lower than the stage) a thin rule runs along the world's edges.
- **Moving and zooming.** The mouse's right or middle button takes hold of the world and drags it; two
  fingers move it and, drawn apart or together, zoom it, coming to rest at the nearest stop; the arrow
  keys move it for as long as they are held, 720 CSS pixels a second. Control with the wheel (as a
  trackpad's pinch is told) goes a stop nearer or farther for each notch, toward the pointer; plus and
  minus do the same from the middle, and Home shows the whole world. A change of zoom glides, 0.18 s,
  the point under the pointer kept there; at once for someone who asked for reduced motion. The plain
  wheel still sizes the brush, and only while the mini has the keyboard, so the page scrolls past it.
  W, A, S and D are not used for moving, as they are in the marble run: here they pick water, acid,
  sand and dirt.
- **Pouring is as it was**: the main button, a pen or the first finger. A second finger stops the
  pour. A brush held down stays under its pointer while the arrows move the world under it.
- **The column** has a group "view": zoom in, zoom out, see it all (each faint and out of reach where
  it cannot go further) and fill the window. So that the whole column is still in the first screen at
  1288 by 828 (it ends at 807 of 828), the materials are two rows of seven, close set, beside the stage
  (a phone keeps its fingertip targets), the brush's size is one line under them and no longer a group
  of its own, and the column's lines are a little closer than the Walker's.
- **Fill the window** grows the stage, from where it is, over the whole window, the column still beside
  it (986 by 803 of view at 1288 by 828, 2.5 times the stage in the page), in 0.26 s; "back to the
  page" or Escape brings it back to its place, which an empty box of its size keeps meanwhile so the
  page under it does not move. The world is the same world: only the view grows.
- **Drawing** (`cells.ts`): a grid may be placed anywhere and at any size of cell. Nearer than a pixel
  a cell, each cell is whole pixels; farther, the cells a pixel covers (up to four by four) are drawn
  together, their colors averaged, so a thin stream is a faint line. The light and haze are worked out
  only over the part the canvas shows and 96 cells round it. The engine marks which bands of 64 rows
  changed (`band_changed`), and the page sends only those to the graphics card, each run of them
  together: in a world this size a pour at the top and a fire at the bottom are two bands, not every
  row between.
- **A world in a link or a file** may now be as large as this one (`MOST_CELLS`), a run of one material
  up to four bytes long, and a file's text up to twelve million letters. A world opened from a link is
  shown whole. The floor of stone drawn under the stage is gone: the stage is a view, and the world's
  own floor is its lowest row.

## More of the world: snow, salt, mud, glass, clouds and lightning

Asked for on 17 November 2026. Six more materials the brush pours, and two the reactions make:

- **Snow** (N): a light, cold powder that falls a cell or two a step and drifts to a side as it falls
  (`drift`, a new column of the table: for a powder, how likely a falling grain is to go down to a side;
  ash drifts too, less), lies in heaps, floats on water, and melts to water at 28, cell for cell. It
  passes almost no heat (2), and none while falling, so a snowfall lies as snow in air at room
  temperature for a good while: after ten seconds on the ground nearly all of it still is.
- **Salt** (X): a pink powder that dissolves in the water it touches (the water becomes brine and the
  salt is gone into it), and melts the ice and snow it touches into brine. **Brine** is water with
  salt in it, heavier than water, so it lies under it; it never freezes; boiled, it leaves its salt
  and its water goes up as steam. Salt under brine does not dissolve further.
- **Mud** (U): a thick, heavy liquid: it creeps (48 in 256 a step, two cells along) and rests in a low
  mound (2,428 cells poured in one place lie 18 high and 200 wide after half a minute), and dries to
  wet dirt, giving off steam, when it is hot. Dirt under water still only soaks: it does not turn to
  mud by itself, so a bank of dirt still holds a lake.
- **Glass** (G): a clear solid. Lava fuses the sand it lies against to glass, now and then (24 in
  1024 a step: 96 cells under the test's pour), and lightning fuses the sand it strikes. Pride sand
  fuses as sand does.
- **Cloud** (Y): a gas that hovers where it is put (`drift` on a gas: it does not rise, and now and
  then moves a cell to a side) and rains itself away: a cell of it, 6 times in 1024 a step where it has
  air beside it, becomes a drop of water. Cloud and rain together are always what the cloud was. Steam
  and smoke rise through it.
- **Lightning** (H): a new kind of cell, a bolt. It runs down through the air 24 cells a step, a cell
  aside one time in four so that it is jagged, leaving a flash of light three cells wide that fades in
  four steps; a gas or flame in its way changes places with it. Where it reaches wood or oil it sets
  it alight, a cell a step for about six steps; water it boils; ice and snow it melts; and where it
  reaches sand it runs on into it and leaves a vein of glass three to six grains long. From 226 cells
  up it has wood alight in eleven steps, and nothing of the bolt or its light is left afterward. The
  brush pours it as one bolt at the pointer whatever its size, a new one each step while it is held.
  Clouds do not strike by themselves.

Their keys are a letter of the name where one was free; every letter of salt and of cloud was
another's, so salt is X and cloud Y. The row is now three rows of seven beside the stage, and the
column still ends inside the first screen at 1288 by 828 (at 823 of 828). Their colors were chosen to
be at least 0.085 from every other in OKLab, as the test asks; snow and steam, both white, are left
out of it, one being a powder that falls and lies and the other a soft gas that rises.

## A line, a box, a fill, and undo

Asked for on 17 November 2026.

- **How the brush draws** is chosen under its size, as round dots with their words, as Blocks' kinds
  are: free (as before), line (a straight line from the press to where the pointer is let go), box (the
  four sides of a box between the two), and fill. A line or a box is shown as a thin outline while it
  is drawn, and is laid in the material and thickness of the brush when the pointer is let go.
- **Fill** (`flood` in the engine, held by a test) fills the closed space pressed in, every empty cell
  joined to it by its sides, each laid at rest; with erase chosen it takes away the whole body of one
  material pressed on. A space of more than 200,000 cells is one that is not closed: nothing is changed,
  and the stage says "not closed" (or "nothing there", for erasing air) beside where it was pressed, for
  two and a half seconds.
- **Undo and redo.** Before each stroke, fill or clear the world is kept, as a link keeps a world (its
  materials and stripes in runs, not their heat or shades), up to twenty back; undo (Control Z, or the
  word) puts the last one back and redo (Control Shift Z or Control Y) the one undone. Putting a world
  back makes each cell as the brush makes it: lava is hot again, and what was burning is not. A new
  stroke forgets what was undone. "clear" is undone as any stroke is; the word that became "undo clear"
  is gone.
- **The column scrolls** where it is longer than the stage is high, never the page: what is used most
  comes first (materials, the brush and how it draws, then "world": pause, step, clear, undo, redo, then
  "view"), and the two ways of taking a world out of the page or bringing one in are under "share",
  below. A soft fade at the column's foot shows that more lies below. On a phone the column is under
  the stage and as long as it is.
- **The scene's own drawing lies over the cells.** The brush's outline had never been seen: the canvas
  it is drawn on lay under the cells' canvas, which is solid. It is now marked to lie over it
  (`mote-over`, as the marble run's is), and with it the world's edge rule, the word about a fill, and
  the soft shade at the stage's edges.

## Forces: gravity that turns, a shake, and wind

Asked for on 17 November 2026. Three words and a pair under "forces" in the column, below "view".

- **Gravity turns a quarter at each press**: down, left, up, right, and the word says which. The rules
  know only down, so the engine turns the whole world instead (`turn`: the cell at (x, y) goes to
  (y, width - 1 - x), in a world as wide as it was high, everything at rest and awake) and the page
  draws it turned back (`turn` of a grid's `Place` in `cells.ts`, `keptCell` and `seenCell`), so what
  is seen stays where it was and falls the new way. The pointer, a line, a box and a fill are all
  given to the engine among the cells as it keeps them. A turn forgets what could be undone. A link or
  a file holds the world as it is seen, and it falls down again when opened. In a world 2,400 wide,
  what falls to the left falls far: "see it all" is the view for it.
- **Shake** throws up every grain of powder and cell of liquid that has open air over it, by chance,
  up to three cells, before each of twenty steps (`shake`), while the stage trembles for the same third
  of a second (not for someone who asked for less motion): a heap standing with upright sides ends
  lower and wider, no grain made or lost, and a lake slops. It is undone as a stroke is.
- **Wind is painted.** With "wind: on" the brush paints wind and not a material: the blocks of a field
  of the engine's, sixteen cells a side, that a stroke reaches blow the way the stroke was drawn (a
  line and a box paint it too, a box round its four sides), and a brush held still stills the air
  under it; "still the wind" stills it all, and is faint while the air is still. While the word is on,
  each block in view that has a wind shows a short stroke the way it blows, with a dot at its head;
  nothing of it is drawn otherwise. What is in the air is carried along as it falls, the lighter the
  farther, up to four cells a step: let go 100 cells up in a wind across, sand lands some ten cells
  along and snow more than seventy. Flames lean with it, smoke, steam and a cloud go with it, and a
  wind painted upward holds up or lifts what is as light as snow or ash. Grains at rest are not moved.
  The winds turn with the world when gravity is turned, and are not kept in a link or undone.

## Sound

Asked for on 17 November 2026. Off until it is asked for, by the word Mote gives every mini that has
sound ("sound: off", under the world's words), and kept as it was left between visits. While it is off
nothing is made at all, not so much as the browser's audio.

- **What is heard is what is happening.** The engine counts, as it works its lines, how many times
  steam was made by two things meeting (lava, a flame or lightning in water) and how many flames were
  made (`heard`); the page reads the two counts each frame and follows how many of each there are a
  step. Steam gives a hiss, as loud as it gets at eight a step, which is what lava poured into a lake
  comes to; flames give a low roar and a crackle of short knocks at chance pitches, as loud as they get
  at eighty a step, a wooden house well alight. Water boiling by itself, with nothing meeting it, makes
  no hiss.
- **The brush is heard as it pours**: grains high, a liquid lower, lava lowest. Painting wind is a
  soft rush while the brush moves. Lightning is a crack and a low note falling away, not oftener than
  four times a second; a shake is a knock and a short low note.
- **Nothing sounds by itself.** The hiss, the roar, the pour and the rush are each a bed of noise
  (`sound.bed` in Mote): noise going round through a filter, at a volume that is nothing until it is
  fed, and that dies away a fifth of a second after it was last fed. The page feeds them each frame it
  steps the world, so a world paused or come to rest, a tab put away or the sound switched off is
  silent within a quarter of a second with nothing having to be told.
- Measured in the browser, with the sound taken on its way out: no audio made while it is off; pouring
  water 0.04 of full scale (as the root of the mean square), sand 0.06, lava into water 0.10 with its
  loudest moment at 0.35, a block of wood alight 0.05; silent 0.7 seconds after the brush is let go and
  0.9 after a pause.

The engine's module is 121.5 KiB of the 128 it is held to (`scripts/wasm.ts`).

## Reworked after the owner's play of 17 November: falling, levelling and caving in

The owner played the page the day it went live and sent pictures. What was reported: water drawn with
a large brush hung in the air as a pale cloud and slid about in flat sheets, stood on a pool as shelves
and tall spikes, and took seconds to settle; a hole dug in the middle of a big pile of sand did not
cave in as sand does; a pour began oddly; fire could not be put to things; clouds rained themselves
away at once; and the page lagged badly. The scenes were made again in `examples/film.rs` (`flood`,
`dig`, `start-<material>-<radius>`) and looked at frame by frame before any rule was changed, and
after each change.

**What was wrong, each a rule added on 17 November for speed or for a pillar's sake:**

- A cell whose support had only just moved stepped to a side and did not fall. In a cloud of drops
  nearly every cell is in that state, so drawn water shuffled sideways and barely fell.
- A liquid ran along the level into a place left that same step, so a whole row followed its end out,
  cell after cell, one way on one step and back on the next: the sheets.
- A cell that came down onto a slower one took it for ground and stopped in the air, and then had to
  start again from rest. A pour backed up into a slow column: the spire under a held brush.
- A grain sliding off a face kept sliding through open air, as far as it could, and landed far off;
  and only the foot of a column gave anything up, one grain a step, while all the rest of it dropped
  a cell into the gap.
- A held brush trickled forty grains or a width or two of water a step whatever its size, as specks
  over its whole disc, while a brush moved by a hair laid 45 cells in 100 of everything it passed.

**The rules now** (`fall`, `drop`, `runs`, `levels`, `slides`, `slide_down` in `world.rs`):

- **What can fall, falls.** Nothing goes to a side while the way down is open.
- **Held up by something still falling, a cell waits** behind it and keeps its speed. Water that comes
  down onto something at rest is at rest there and then; one in four that land fast keep their speed a
  step and splash a cell or two (half of them, as high as they were fast, had stood up from a pool as a
  fringe of spikes).
- **A liquid at the surface** runs only where that takes it lower, and along the level only into
  places not left that step.
- **A liquid under its own kind finds its level** (`levels`): it does not move itself. It looks along
  its row, through its own kind, for an open place within 64 cells (air, a gas, a flame, a lighter
  liquid, ash), and the cell at the top of what lies on it goes there. So every cell of a column
  passes on a cell in the same step, a heap sinks from its top and widens at every height at once, and
  what it can carry away goes as the square of that reach. The look costs seven cells deep in a body:
  it first looks 1, 2, 4 cells away and so on, and only where one of those is not its own kind does it
  go through every cell between, so nothing is reached through a wall. A block of water 60 wide and
  100 deep let go at one end of a floor 300 long is level to a cell in 18 steps and asleep in 19; a
  column one cell wide and 60 high stood on a pool is gone in under 15. Brine spreads out under water
  by the same rule, and lava slumps at its own pace.
- **Sand squeezes past sand.** A grain may slide down past another grain or a drop, by chance one
  step in two, where before the cell beside it had to be open; between two corners of what stands
  nothing squeezes. A grain at rest whose support has just gone holds for a step as often as not, so
  the grain beside it can take the gap first. A hollow therefore does not rise through sand whole,
  under a plug of sand with upright sides, but spreads as it rises, as loosened sand; the ground over
  a hole of radius 36 dug 150 cells down dips over 147 columns and comes to rest with no step over a
  cell. Where there is open air beside it, a grain whose support has gone steps out into that, so a
  pillar's face comes away along its whole height: a pillar 18 wide and 60 high is a heap in 33 steps
  (49 before).
- **A grain landing on a heap runs on down its side** in that step, up to 48 cells while there is
  slope under it (sand; dirt as before), and stops sliding where the ground falls away. A heap takes a
  pour as fast as it comes and stands as a cone. Sand still rests at 35 degrees and dirt at 62.
- **Pouring** (`fillOf` in `grains.ts`, the engine's `pour`): a press, and a brush drawn along, lay
  the brush's own shape, a liquid whole and a powder 45 cells in 100. Held still, a liquid goes on
  being laid whole, which pours a stream as wide as the brush since what was laid has fallen out of it
  by the next step, and a powder comes at two grains a step for each cell of the brush's width. What
  is poured leaves the brush at three to five cells a step.
- **Fire lights what it is laid on**: under the fire brush, half of what could burn becomes what a
  flame beside it would make of it, at each stroke (`light` in `react.rs`). Before, the brush filled
  only empty cells, so fire laid on a block of wood did nothing.
- **A cloud rains a sixth as fast.**
- **Spray** is drawn only where falling water is loose: a drop with air round it is pale, the edge of a
  falling body is flecked, and the inside of one is the color of water (`cells.ts`).

**A sleeping world and a waking one are no longer the same to the byte** where a liquid finds its
level, since that reaches farther than a change wakes. The two tests that hold them equal turn it off
(`levelling`, `set_levelling`); what levelling does in a world that sleeps is held by tests of its own.

**Tests**: three new in `tests/accuracy.rs` (water let go finds its level and sleeps; a column one cell
wide does not stand on a pool; a hole dug deep in sand caves in as a funnel), and the fingerprint taken
again, natively and in the page's built modules. Changed on purpose: a poured grain's first speed; the
core of lava that may stay molten sealed in rock (a tenth, was a twentieth: the pool lies lower and
wider now).

**The pass that joins vessels runs one step in eight for liquids** (`level.rs`). It walks every cell of
a body near any change, so a lake with a drop falling into it was walked whole every step: most of a
busy step. A liquid in the open levels cell by cell now, so the pass is left with what that cannot do,
two vessels joined under a wall, and a quarter as often does it with four times the cells a pass. What
has changed since it last ran is kept for each chunk (`due`), and a chunk it is owed in counts as
awake, so a world does not go to sleep a cell out of level. For gases it runs every step as before:
they have no rule of their own that gathers them under a lid, and it is this pass that carries a body
of steam up as fast as it rises (tried at one step in two, half as much steam left the brush and a
fifth as much gathered under a lid before it cooled; working each gas cell one step in two was tried
too and taken out for the same reason). Measured in the page's built engine, in the page's world of
2,400 by 1,200, with the largest brush of water dragged over heaps of sand for three seconds, 227,000
cells of water: a step while pouring 4.5 ms where it was 6.8, settling 2.7 where it was 5.4, and after
that 0.9 where it was 3.7.

**The engine and its drawing run in a worker** (`sand-core.ts`, `sand-worker.ts`). The owner's point
was that the rest of the site should not lag because Sand does. The engine stepped on the page's own
thread, and sent its changed rows to the graphics card from there, so a step of 15 ms or an upload of
megabytes held up scrolling and every button. Now the world, the stepping, the grid that draws it, the
brush held still and the worlds kept for undo are one module, the core, that touches nothing of a page
and is driven only by messages. The scene hands its lower canvas over (`transferControlToOffscreen`)
and runs the core in a worker; the cells go from the engine's memory to the graphics card inside the
worker and are never copied between threads. The scene keeps what is the page's: the pointer, the
view, the column, the brush's outline and the wind's marks on the upper canvas, and sound. It tells the
core each stroke as it is made, where the grid is placed, and what a held brush goes on doing; and it
asks for one frame at a time with the time gone by, waiting for the answer before asking again, so a
world too busy to keep up runs slower and never falls behind in a queue. Each answer carries what the
world is doing (how much is awake, what would be heard, how many worlds can be undone), which is what
the column's words, the sound and the stage's rest go by. A world, a turn of gravity and an opened
link are the core's to make, and the scene's view follows when it says they are made. The small world
in a list of minis, and any browser that cannot hand a canvas to a worker, run the same core on the
page's thread; `?thread=page` in the address does so on purpose, to measure.

Measured in headless Chromium, the largest brush of water dragged back and forth for four seconds: the
time between two frames of the page was 16.7 ms every time with the core in a worker (the longest 16.8),
and 83 ms typically, 117 at worst, with it on the page's thread. That browser draws in software, which
is far slower than a graphics card, so the second figure flatters the worker; but the first is the
point: nothing the world does is felt by the page.

**Tried and not kept for gases**: a cloud of 100,000 cells of steam takes about 15 ms a step, 4.5 of
it moving the cells, 3.7 the pass that gathers a gas under a lid and 5.5 heat. Working each gas cell
one step in two, and that pass one step in two, both made steam cool before it could rise; laying a
gas a third as thick made it rain out within a second, since its cells no longer keep each other warm.
A lighter roll in the heat pass and fewer cells weighed in the gas pass were kept and were worth
little. So a very large cloud still makes the world run slow, but in the worker it no longer makes the
page slow with it.

**A fire is drawn as one body** (`FLAME` in `cells.ts`). The owner's word for the fire was that it was
bad, and looked at near it was a spray of single orange cells with grey grains of smoke over it: every
flame was drawn as a cell of its own color with a faint haze round it. The fire burns as it did; only
its drawing changed. Each flame is gathered, by how hot it is, into the fourth number of the light's
half-sized picture, and blurred with the light; where the cells are drawn, that field is read at each
place and a little below it (toward the ground as the cells are kept, since a flame reaches upward)
and colored by its strength: deep red at the fringe, through orange and gold, to near white at the
heart. A flame's own cell is still drawn, faintly, as a fleck in the body, and over a grain the body
shows at four tenths, so burning wood is seen through its flames. A brush of fire held in the air is a
tapering flame with a white heart; a wooden wall alight has tongues up both its sides.

**Smoke, steam and cloud are soft bodies.** A soft cell is drawn itself at 0.3 of its color (0.7
before, which read as grains), and the haze gathered from soft cells is brought up where it is thin,
as 1 - e^(-4.5 x), so that a few cells of smoke far apart are a wisp and a thick cloud is no more solid
than it was. Flames no longer add to the haze.

**The small world in the list pours by itself** (`SHOW` in `sand.ts`): sand, water, pride sand and lava
in turn, each for a few seconds from a place that sways a little, then a while of nothing before it
is cleared and begins again, as Blocks' small pile drops a piece now and then. Until then the card was
an empty box, since a world shows nothing until something is poured into it.

## The look, as chosen

Three palettes, three kinds of light, water with and without depth, and four stages were shown as
pictures from the page; one of each was chosen and built, and the rest left out (no switch remains).

### Colors: dusk

The natural hues kept, softened and leaned toward the site's violet (its colors are oklch, in
`src/data/theme.ts`): sand (227, 198, 147), water (58, 132, 202), stone a cool grey (102, 104, 117), dirt
a red brown (126, 76, 56), wood a tan (171, 124, 60), oil a plum (102, 44, 107), smoke a pale violet
grey (177, 164, 194), steam near white (236, 238, 249), ice (146, 223, 242), acid (152, 227, 107), wet
dirt (75, 44, 33), ash a warm grey (152, 146, 133), rock a dark slate (69, 78, 91). Fire, lava, burning
wood and burning oil keep how far their shade moves with heat, so a flame still runs from red to yellow.
Each pair of materials is at least 0.085 apart in OKLab (a test holds it; two that both give light are
left out, as their shade is their heat): the closest are wood and ash at 0.090, then stone and rock,
stone and dirt. Stone and smoke, water and stone, dirt and wood, oil and either, were each looked at
side by side, touching, on the page. Smoke and steam still pass their brightness test: smoke stands
well over the ground, steam well over stone.

### Light and depth

- **Light falls on the grains near fire and lava and glows more strongly in the air round them**: the
  blurred light is added over a grain as before, and over empty air `GLOW_AIR` (1.2) times more
  (`cells.ts`).
- **Water has depth** (`DRAW_DEEP`, a fourth way of drawing in the palette, given to water): its top cell
  is drawn 1.3 times as light, and each cell below darker by 0.03 for each cell of water over it, up to
  twelve (`DEPTH` in `cells.ts`), so a lake is light at its surface and deep blue below.
- On the page's busy world (a lake, a forest burning, a pour) in headless Chromium, with the look on:
  26 to 38 frames a second and 60 steps a second, a step 7.2 to 7.6 ms. The light and depth cost no
  measurable frames against the look before (the passes that blur the light run for smoke and steam
  anyway; depth reads up to twelve cells above each cell of water).
- At one CSS pixel a cell a flame is a single bright grain, so a fire reads as many sparks rising in
  columns more than as solid tongues; the rules were not changed for it.

### The stage

- **The world on the site's ground, rounded at its edges, on a floor**, in a frame of the panel's color:
  the canvas that takes the pointer is rounded (it shaded its edges inward until 24 November 2026, when the
  owner found that glow to be slop and it was taken out), and has a
  band of stone under it (`--floor`) that the world rests on; the cells' canvas is laid exactly under it
  by the scene (`fit` in `sand.ts`).
- **The materials and controls in a column beside the stage**, in the Walker's grid, type, spacing and
  rules: "materials" (the swatches, five a row, and the flags opening under them for pride sand),
  "brush" (its size), "world" (pause, step and clear on one line, then copy link to this world, then open
  a world). The mini is wider than the text, as the generalist is, up to 66rem.
- At 1288 by 828 the stage with its floor ends at 797 pixels and the column at 824, with every material
  in it: all in the first screen. The world there is 748 by 423 cells. Under 46rem the column goes under
  the stage; at 390 by 800 the world is 324 by 464, and a finger pours with the page still (`touch-action:
  none`).

## Lag reported on 18 November, and what was measured

The owner found Sand laggy, and water worse, on the night of 17 to 18 November 2026. It was measured the
same night on the owner's machine and card (an RTX 3070 Ti), in a headless Chromium given the real card
(`--enable-gpu --ignore-gpu-blocklist --use-angle=gl-egl`; without those the test browser draws in
software and tells nothing about speed):

- The engine alone, with the biggest water brush held still for ten seconds in the 2400 by 1200 world:
  about 4 ms a step, worst about 10, so a second's sixty steps take about 0.27 s. Settled within seven
  seconds of letting go.
- The page itself, worker and drawing and all, the same brush held for eight seconds: sixty frames a
  second from the worker and from the page, with the gap between frames 16.7 ms at the median and 17 ms
  at the 95th.
- The same in software drawing: about twenty frames a second while there is water. So a browser that has
  lost the card would show exactly what was reported.

The machine, when the lag was seen, had a load average of 17 on sixteen threads and 22 GB in swap, with
the browser's own memory mostly swapped out: eight cores were encoding video for another page of the
site, long test runs had been going through the day, and other work was compiling. Nothing in Sand was
changed. If lag is reported again, measure the machine first (`uptime`, `free -h`), then the page with the
card as above, and only then the engine.

## Water pressed into the air (24 November 2026)

The owner found that water jumped sideways, hung, piled, and would not settle, and that Sand grew laggy
quickly. Filmed (`cargo run --release --example film -- water`), water pouring off a shelf fell as long flat
dashes up to forty cells wide. The levelling pass (`levels` in `world.rs`) moved the top of a pool to the
nearest open place along its row without asking whether anything was under that place, so a pool on a shelf
pressed rows of water out into the air past the shelf's edge, and each row fell together. Now a place over a
drop is taken only from a cell held up by something: the edge of a pool still pours over the edge of what
holds it, as a stream down its side, and a cell already out in the air is not part of the pool. Lava poured in
one place stands a few cells higher where its stream lands (39 and 44 cells, from 35 and 36), still a flat
pool over the floor. The fingerprint was taken again.

The same day the owner sent a picture of water on a sand slope standing out over the air as a wedge, and
said it was still slow. Filmed (`film -- slope`), each row of the pool pushed one cell past its end every
step, over the air under the face, where it held up the falling cell of the row above: a 45° overhang that
grew a cell a step, held up by nothing. Three changes:

- A place over a drop is taken by levelling only from a cell that rests on what holds, not on air or more
  liquid: the foot of a pool pours over an edge, no row above it is pressed out.
- Where levelling finds nowhere to put a cell, a face of a pool with open air beside it and under that
  spills down and out, as the top of a pool runs off. A slab no longer stands with upright sides on a shelf
  or drains a cell at a time.
- A drop whose way down was only opened this step, by the one under it going, with open air beside it and
  under that, goes down past the side at its speed. A column or a clump comes apart as it falls instead of
  creeping down a cell a step behind its foot.

A column one cell wide standing on a pool now sinks into it in about 17 steps (the test allows 20, a third of a
second; it allowed 15 when the pool pressed water into the air at every height).

On lag, measured natively (`examples/lag.rs`, the page's world of 2,400 by 1,200 with the largest brush of
water held for a minute): a step stays near 2 ms with 757,000 cells of water, and the water is flat to a row
and asleep five seconds after the brush is let go. The engine's own speed test puts a forest fire on a world a
fifth that size at 8.5 ms a step (29 ms at its slowest), so fire, heat and reactions are what cost, and are
next. The machine was at a load of about 28 with 24 GB in swap while this was measured, as on 18 November.

### Lag, 24 November 2026

- **The cause the owner felt.** The page took up to four steps in a frame to catch up when a frame came
  late. A forest on fire over the page's world takes about 10.6 ms a step in the built engine (11.1 natively:
  5.2 spreading heat, 4.7 moving and reacting, 1.2 levelling), so one late frame brought three or four steps,
  which made the next frame later still, and the picture and the brush slowed to a crawl within seconds.
  Stepping now keeps to a budget (`STEP_BUDGET` in `sand-core.ts`, 9 ms): the first step of a frame always,
  more only while they fit, the rest of the time let go. A busy world runs a little slower and stays smooth.
- **Falling water** was made three times as dear (8.7 ms a step on the speed test's world, from 2.7) by a rule
  added that day that let a drop go past the side whenever its way down had just opened; it now applies only to
  a drop in a queue, and the cost is back at 2.1 to 2.9 ms.
- **The heat pass** works every cell of each chunk's warm rectangle; in a forest fire 617,000 cells a step, five
  in six of them with nothing to pass on. Spans per row within each column of chunks, in place of the
  rectangle, gave the same cells to the byte but saved only about 5% of the time in that fire (most of its rows
  are warm all along) and took the engine past its 128 KiB, so they were not kept. What would cut the pass
  further is a cheaper test for a stretch of quiet cells, or the pass run on fewer cells by a coarser grid of
  what is warm.

