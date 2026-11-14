# sand

The engine of the sand mini: a grid of cells, each of one material, that fall, flow and rise by simple
rules, carry heat, and change into each other by a table of reactions. It is written in Rust and built into a plain WebAssembly module, `public/wasm/sand.wasm`, with
no bindings generator and no imports. The page calls functions that take and return numbers, and reads
the cells straight out of the module's memory. The plan it follows is `docs/sand.md`.

- `src/materials.rs`: every material, one line each (its kind, density, how it slides and spreads, how
  it holds and makes heat, its colors), and the reactions table: what a cell becomes alone or beside a
  neighbor, at what temperature, by what chance, and where the heat goes.
- `src/world.rs`: the grid, the chunks and their sleeping, the step, and the brush.
- `src/react.rs`: the step reading the reactions table, and counting each line that happens.
- `src/heat.rs`: heat spread to neighbors after each step, kept to the unit and the same in any order.
- `src/level.rs`: water carried through a connected body so that joined vessels reach one level.
- `src/api.rs`: the functions the page calls, listed below.
- `src/memory.rs`: the module's own memory allocator, in the browser (the Walker's, copied).

## Building and testing

```sh
bun run wasm                          # builds sand.wasm and sand-scalar.wasm into public/wasm/, with the Walker's
cargo test                            # in sand/: the rules, every accuracy test and every reaction
bun test src/minis/grains.test.ts     # the built modules, from the page's side
cargo run --release --example speed   # how long a step takes on a full world
cargo run --release --example speed --features scalar   # the same without the SIMD that skips empty cells
bun scripts/sand-speed.ts             # the same worlds in the built module in headless Chromium
```

`bun run wasm` builds the module twice, with WebAssembly SIMD as `sand.wasm` and without as
`sand-scalar.wasm`, for a browser too old for SIMD. Both give the same cells to the byte, and the same
as the native build: `tests/unchanged.rs` and `src/minis/grains.test.ts` hold all three to one
fingerprint. It fails if either is over 128 KiB; they are about 79 KiB.

## A cell

Four bytes, one u32: the material; a shade, chosen by chance when the cell is made (for fire and lava,
set by its temperature; for pride sand, its stripe's color times 4, with a slight shade in the lowest two bits); its temperature, 0 to 255 with room temperature 40; and the clock of the step
the cell last moved or changed in (six bits) with its falling speed (two bits). An empty cell is air:
material 0, with a temperature. The world has a border of 8 cells all
round, wall or void by the setting for the edges.

## The functions

One world per module instance.

| Function | What it does |
|---|---|
| `create(width, height, seed_low, seed_high)` | A new, empty, walled world; 1, or 0 for a side outside 1 to 4096. Memory grows only here. |
| `step(count)` | Moves the world on. |
| `paint(material, x0, y0, x1, y1, radius, fill, replace)` | A line of a material between two cells with no gaps, each cell filled by a chance of `fill` in 100. Material 0 erases. Only empty cells are filled unless `replace` is 1. |
| `paint_striped(material, x0, y0, x1, y1, radius, fill, first, count)` | As `paint`, into empty cells, each cell's shade a stripe: `count` stripes of colors numbered from `first`, side by side along the line. For pride sand. |
| `flag(material, x, y, wide, high, first, count)` | A block `wide` by `high` with its top left at (x, y), into the empty cells there, in `count` level stripes: a whole flag. |
| `rewritten(fresh)` | The page wrote cells into memory itself: unknown numbers and edges become air, clocks are cleared, and the world wakes. With `fresh` 1, each cell is also made as the brush makes it (its material's temperature, a shade by chance, a stripe kept). |
| `clear()` | Empties the world. |
| `cells()`, `stride()`, `border()`, `width()`, `height()` | Where the cells are (the border's top left), cells to a row, the border's width, and the world's size. |
| `awake()` | How many chunks will be worked through next step, by the rules or the heat pass: 0 when nothing moves or warms. |
| `changed_from()`, `changed_to()`, `forget_changed()` | The rows changed since the page last drew (-1 when none), and that it has drawn them. |
| `set_sleeping(on)` | 0 reaches every cell every step: the same world, more slowly. For tests. |
| `set_order(phases)` | 1 works through chunks in a checkerboard of four phases instead of row by row. |
| `set_edges(open)` | 1 lets what moves past an edge be gone; 0, as it starts, walls it in. |
| `count(material)`, `fingerprint(part)`, `steps()` | How many cells of a material; half of an FNV-1a hash of every cell (0 low, 1 high); steps taken. |
| `material_count()`, `name(m)`, `name_length(m)`, `paintable(m)`, `kind(m)` | The table: names as UTF-8 in memory, whether the brush offers it, and its kind (0 empty, 1 solid, 2 powder, 3 liquid, 4 gas, 5 void, 6 fire). |
| `palette()` | 2048 bytes of colors: 256 RGBA, then 256 shade ranges, each with how the material is drawn in its fourth byte (1 its shade picks a stripe's color, 2 it gives light, 4 it is drawn softly). |
