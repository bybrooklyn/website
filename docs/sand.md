# A sand simulator

A mini: a grid of grains, each of one material, that fall, flow, burn and react with each other. A plan
dated 13 November 2026. Nothing is built.

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

## Stages

1. The engine and its tests: the grid, chunks and sleeping, powders, liquids and gases, with sand, water,
   stone and dirt. Drawn plainly. Speed measured.
2. Heat and reactions: fire, wood, oil, lava, ice, steam, smoke, acid, with the table and the conservation
   tests.
3. The page: the materials row, brushes, pride sand and the flag brush, links, touch and keys, glow.
4. Workers and the graphics card for what spreads, each kept only if it measures faster.

## Open

- Its name.
- Whether worlds wrap at the edges, are walled, or let things fall out of the bottom.
- Wind, gravity that can be turned, and a way to shake the world.
- Living things and things that explode, chosen against for the first version.
- Whether it shares its engine crate with the Walker or has one of its own.
