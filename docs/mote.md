# Mote

A small engine for tiny demos and games in the browser, in TypeScript, so that each mini does not write its
own loop, canvas and input again. Every mini on the site runs on it except the Walker and the generalist,
whose engine is the Rust crate in `walker/`; the sand mini's engine is the Rust crate in `sand/`, drawn through Mote. It has a project page at `/projects/mote/` and a logo, a speck
in a beam of light.

## Where the code is

`src/mote/`. Its own `README.md` there says what each file gives and how to write and add a mini. It is
under the MIT license in that folder (`src/mote/LICENSE`), plainer than the rest of the site's code.

| File | What it is |
|---|---|
| `stage.ts` | The canvas, a loop in fixed steps of 1/120 s, mouse and keys, the page's colours, a panel for buttons, a little kept between visits, the address. Runs only while seen and stops when the scene rests. |
| `flat.ts` | 2D physics: boxes, balls, bars and shapes, walls, pins, rods, ropes, a motor, a hand to grab with. |
| `space.ts` | 3D physics: solids that fall, tumble and hit each other and fixed slabs, each turning by its own inertia tensor; balls that roll; islands that sleep together. |
| `track.ts` | Fixed track for balls, worked out by formula: sections swept along curves and helices, and profiles turned into funnels. |
| `grid.ts` | The broad phase both physics use: which pairs of bodies are near enough to be worth a closer look. |
| `gl.ts` | 3D drawing on WebGL 2: depth, a sun with shadows, sky light, numbers on faces, floating words, glow. |
| `cells.ts` | A grid of cells drawn in whole pixels on WebGL 2: four bytes a cell read straight from where they are kept into one texture, colored from a palette and a shade, only changed rows sent. The sand mini draws with it. |
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

## Balls, track and sleeping islands, for a marble run

Built on 14 November 2026 as stage 1 of the marble run ([marbles](marbles.md)), after the look into what it
would need (the day before: no ball in 3D, twenty-faced stand-ins that stopped on a face on a 7 degree
chute, 50 to 70 of them a frame). Nothing that was there steps differently: `pairs.test.ts` holds Blocks,
Plinko's board, the dice tower and three heaps to the bits they ended at before, and the new parts are off
unless a scene asks for them.

- **A ball.** `space.ball(radius, at, stuff)`: a middle and a radius, met exactly by another ball, and by a
  solid of faces at its nearest face, edge or corner (`nearestOn`). Its inertia tensor is 2/5 m r^2 about
  every axis, so the solver takes it by the one-number path a cube takes. It rolls by Coulomb friction at
  the point it touches: on a slope at 5/7 of g sin(slope) to within half a percent, sliding at
  g (sin - friction cos) where friction cannot hold the roll. `roll` in its stuff is a rolling cost (a turning
  push against the roll, up to that share of how hard it is pressed, so it comes to rest on the flat and
  holds on a slope gentler than it), `twist` a cost of spinning on the spot. A ball's surface does not turn
  with it, so it is not taken to lift as it rolls; it strikes, bounces and is heard by its speed at the
  moment it arrives. `marbleSpace()` is a space in centimetres under real gravity, and `MARBLE` a glass
  marble's stuff on wood.
- **Track.** `track.ts`, met by balls only. A piece is a section swept along a path (`curve` through points,
  its end directions held for joints; `line`; `helix`, for spirals and loops) with a frame carried along it
  untwisted, kept level, banked or twisted, or a profile turned about an upright axis (`turned`, a funnel or a
  bowl). Sections are lines and arcs with a thickness: `gutter`, `vee`, `bed`, `tube`, `rails`. A ball is met
  by the nearest point of the path, the root of one equation found by Newton's method inside short chunks,
  which a fixed table in `grid.ts` (`Kept`, filled once) hands over by where the ball is; then by the nearest
  point of the section in the plane across the path. That is exact where the frame is carried untwisted, and
  a degree or so off square where it twists (round a level spiral), smoothly. Where two pieces meet end to
  end with the same section, facing on the same way and up the same way, Mote joins them itself and a ball
  feels one surface: a gutter cut into eight runs a ball exactly as one piece does. Each piece draws itself
  (`piece.mesh()`) from the same numbers.
- **Landing on the surface.** A ball against track is pushed, each part of a step, square to the surface
  where it is and just enough to land on it at the end of the part (the rule molecular dynamics calls SHAKE).
  Aimed anywhere else, a push leans along the ball's path: aimed where it was at the step's start, a ball
  gained 5% of its energy round a loop; aimed half way round, a funnel took its turning down by 2.5% a
  second. Landed, a smooth ball keeps its energy round a funnel to 0.2% and its turning about the axis to a
  part in ten thousand. Where the surface turns more than a few degrees in one part (a thin rail met fast),
  the ball may only close the gap it has now, and is measured again where it went.
- **Held to theory** (`balls.test.ts`, `track.test.ts`): rolling and sliding on slopes; rolling cost and
  spinning cost at the rates they should; bounce to e^2 of the drop; a ball rocking across a gutter at the
  period of a rolling ball, 2 pi root(7 rho / 5 g), to 0.01%; a loop held from 2.71 loop radii and lost from
  2.66 (theory 2.70); two rails rolled on at 1 / (1 + 2/5 (r / reach)^2), to 0.2%; a funnel kept as above, and
  circled down and through with a rolling cost; a banked spiral run down to within 3% of its drop's energy.
- **Fast marbles and thin rails.** The fastest a metre's drop down a gutter gives is 340 cm/s, 1.4 cm a step.
  Marbles spinning any way fired at a rod half a millimetre thick from every side, squarely and glancing,
  at up to 1,500 cm/s, never get through, at 240 steps a second or at 120. So contacts found ahead are enough,
  and no sweep was written; each marble looks ahead by its own speed, so a slow one costs nothing more.
- **Islands.** `space.islands = true` (on in a marble space): what touches sleeps together, once all of it has
  been still for `nap` seconds, and wakes together when anything moving reaches one of it. While asleep it is
  kept out of the grid, in a table of its own made again only when something falls asleep or wakes, and only
  what moves is set against it. Sixty marbles poured into a tray are all asleep in two seconds; a marble
  rolling slowly down a one degree slope never sleeps and arrives when theory says.
- **The same everywhere.** Balls and track use only + - * /, square roots, and the sine and cosine in
  `track.ts` made from those, never `Math.hypot` or `Math.sin`, whose last bit differs between engines. Twelve
  marbles racing down a ramp, a spiral and into a funnel end the same to the bit run twice, and in Chromium
  as in Bun (`replay.test.ts`). A slab turned by `angled` uses `Math.sin` and so may not.

**How many.** One frame of 1/120 s is two steps of the solver. In milliseconds a frame, on four cores of this
computer (`crowd.test.ts` prints Bun's; Bun's ran between these and half again more as the machine was
busier or quieter):

| Marbles | in a gutter, Chromium | Bun | circling a funnel, Chromium | Bun | heaped in a tray, Chromium | Bun | the heap asleep, Bun |
|---|---|---|---|---|---|---|---|
| 100 | 1.8 | 2.5 | 1.7 | 2.8 | 0.9 | 1.0 | 0.04 |
| 200 | 2.6 | 4.6 | 3.4 | 5.3 | 2.1 | 3.1 | 0.05 |
| 400 | 6.6 | 8.3 | 8.9 | 11.8 | 4.6 | 6.1 | 0.08 |
| 800 | 12.8 | 26 | 22 | 47 | 11.3 | 21 | 0.16 |

So a few hundred marbles at once at 120 frames a second, with room to draw; 400 asleep in a tray cost
0.1 ms. Where the time goes, in a funnel of 200: finding where marbles touch the track about 30%,
measuring each part of the step against it about 30%, the solver about 15%, the broad phase about 6%; the
rest is spread over small vectors made and dropped. Keeping each knot's point and slope, and working out a
curve's point, slope and bend in one go, halved a step in a gutter and took two thirds off one in a funnel.

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
- **For the marble run, later:** ball against a solid of faces is soft, so a moving part (a seesaw, a gate)
  is met as slabs are, not exactly; only balls meet track; `gl.ts` sees no further than 120 units, so a run in
  centimetres is drawn at a tenth of its size (Rolling does) until it has a setting for that.
- **For the 3D side:** smooth shading across faces, a shadow under each solid, pictures drawn onto faces,
  loading a simple model from a file, a wireframe view, dice that hit each other corner to corner rather
  than as balls, a camera that can be moved.
- **A repository of its own**, if anyone else wants to use it.
- scriptc (which compiles TypeScript to native programs and WASI modules) was looked at: it does not draw to
  a browser canvas, so it is no use for minis; it could matter for a desktop build later.

## How to run and test

```sh
bun test src/mote     # flat, space, balls, track, grid, pairs, replay, crowd, gl and the rest
```

`gl.test.ts` draws a scene in headless Chromium and reads its pixels. `replay.test.ts` checks that a scene
run twice ends the same and that a step is fast enough, and runs a marble race in Bun and in Chromium.
`balls.test.ts` and `track.test.ts` hold balls and track to the arithmetic of a rolling ball. `grid.test.ts` checks the broad phase against a
loop over every pair, and `pairs.test.ts` the minis' scenes with it and without, to the bit. `crowd.test.ts`
prints step times for 100 to 5,000 bodies and takes about forty seconds; run it on its own with
`bun test src/mote/crowd.test.ts` when measuring.

## Known weak spots

- In 3D, now and then a die comes to lean on another and the two keep trembling, so the roll is only
  called at the nine second limit: about one roll in two hundred over 900 rolls, as often before the
  inertia tensor as after. `tower.test.ts` lets one roll in forty run that long.
- In 3D the contact code makes many small arrays in every step; the broad phase makes none.
- A fast marble in an unbanked tight spiral climbs the outer wall until friction cannot hold its roll, and
  slips: track should bank into its turns, as real track does. A heavy solid resting on marbles sinks into
  them by up to a twelfth of a marble's radius, as ball against solid is soft.

- `stage.ts`, `solids.ts`, `sound.ts` and `index.ts` have no test beside them; they are on the lint's list
  of files written before the rule, which is not to grow.
- Mote was written before the rule that every exported thing has a sentence above it, and is held to it
  only for what is added.
