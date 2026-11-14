# A sand simulator

A mini: a grid of grains, each of one material, that fall, flow, burn and react with each other. A plan
dated 13 November 2026. Stage 1, the engine and its tests, was built on 14 November 2026, and stage 2,
heat and reactions, the same day; the mini is a draft at `/minis/sand/`, not listed.

## Where the code is

- `sand/`: the engine, a Rust crate of its own built to WebAssembly. `sand/README.md` lists every function
  the page calls. `materials.rs` is the table of materials and the table of reactions, `world.rs` the
  grid, chunks, step and brush, `react.rs` the step's reading of the reactions, `heat.rs` the pass that
  spreads heat, `level.rs` the pass that levels water and steam through a connected body.
- `sand/tests/`: `accuracy.rs` (movement, counts, sleeping), `reactions.rs` (heat and every reaction the
  plan names), `unchanged.rs` (the fingerprint), and `common/` what they share.
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
| steam | gas | 4 | 12 | 120 | levels under a ceiling; stores 28; airy |
| wood | solid | 255 | 24 | 40 | |
| oil | liquid | 80 | 16 | 40 | levels; floats on water |
| lava | liquid | 200 | 8 | 250 | creeps (moves sideways 96 steps in 256); hardens where it rests; shade follows heat |
| ice | solid | 255 | 32 | 0 | |
| smoke | gas | 3 | 10 | 90 | does not level: rises, drifts and thins; airy |
| fire | fire (new kind) | 1 | 32 | 230 | rises and wavers; cools 4 a step; shade follows heat; airy |
| acid | liquid | 110 | 28 | 40 | levels; sinks under water |
| wet dirt | powder | 170 | 12 | 40 | slides at about 72 degrees; stores 8; not offered to the brush |
| ember (burning wood) | solid | 255 | 20 | 200 | warms 16 a step up to 200; shade flickers with heat; not offered |
| ash | powder | 40 | 6 | 40 | floats; airy; not offered |

Fire is a new kind: each step it moves up, or up and to a side by chance (a quarter of the time each
way), so a flame wavers; when it cannot rise it moves to a side now and then. It never levels. A falling
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
| wood | lava | any | burning wood | as it was | 64 | kept |
| oil | anything airy | 85 or more | fire | as it was | 512 | the flame starts at 230 or more |
| oil | lava | any | fire | as it was | 256 | the flame starts at 230 or more |
| lava, at rest | alone | 100 or less | stone | | always | kept |
| lava | water | any | stone | steam | 640 | shared |
| ice | alone | 28 or more | water | | always | kept (stores 8) |
| smoke | alone | any | air | | 12 | kept |
| fire | alone | 60 or less | air | | always | kept |
| fire | alone | 90 or less | smoke | | 160 | kept |
| fire | water | any | air | steam | 640 | shared |
| fire | oil | any | as it was | fire | always | the flame starts at 230 or more |
| acid | stone | any | smoke | air | 24 | kept |
| acid | wood | any | smoke | air | 32 | kept |
| acid | dirt | any | smoke | air | 40 | kept |
| acid | wet dirt | any | smoke | air | 40 | kept |
| wet dirt | air | 78 or more | dirt | steam | 256 | carried (the steam takes the dirt's heat) |
| wet dirt | lava | any | dirt | stone | 128 | shared, less 90 that escapes |
| burning wood | water | any | wood | steam | 512 | shared |
| burning wood | alone | any | smoke | | 4 | kept |
| burning wood | alone | any | ash | | 2 | kept |
| burning wood | air | any | as it was | fire | 256 | the flame starts at 230 or more |

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

## Stages

1. The engine and its tests: the grid, chunks and sleeping, powders, liquids and gases, with sand, water,
   stone and dirt. Drawn plainly. Speed measured. Built 14 November 2026, with steam as the gas.
2. Heat and reactions: fire, wood, oil, lava, ice, steam, smoke, acid, with the table and the conservation
   tests. Built 14 November 2026, with wet dirt, burning wood and ash besides.
3. The page: the materials row, brushes, pride sand and the flag brush, links, touch and keys, glow.
4. Workers and the graphics card for what spreads, each kept only if it measures faster.

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
bun test src/mote/cells.test.ts       # the grid drawn in headless Chromium
cd sand && cargo run --release --example speed               # the speed natively
cd sand && cargo run --release --example speed --features scalar   # without the hand-written SIMD
bun scripts/sand-speed.ts             # the speed in headless Chromium, both builds
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
- A flame lights any oil it touches, every time, so a slick goes up in one front; a
  slower burn would need a chance on that line.
- A world sprinkled everywhere with single drops makes the first steps slow while the pass looks at each
  drop as a body (the slowest step of a sprinkled world of water is about 16 ms natively).
- Touch was checked by the canvas's `touch-action` and Mote's pointer events, not by a real touch drag.
- The world is made once, for the size the mini has when it loads; a resize keeps it and fits it again in
  whole pixels, cutting its edges if the canvas has grown smaller than it.
- With no WebGL 2 the page says so and draws nothing.
