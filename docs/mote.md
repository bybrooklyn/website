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
| `stage.ts` | The canvas, a loop in fixed steps of 1/120 s, mouse, fingers and keys (several pointers by id, and the wheel, for a scene that asks), the page's colours, a panel for buttons, a little kept between visits, the address. Runs only while seen and stops when the scene rests. |
| `flat.ts` | 2D physics: boxes, balls, bars and shapes, walls, pins, rods, ropes, a motor, a hand to grab with. |
| `space.ts` | 3D physics: solids that fall, tumble and hit each other and fixed slabs, each turning by its own inertia tensor; balls that roll; islands that sleep together; for a marble run's moving parts, solids on a hinge, driven solids and fixed solids of any shape, met by balls only. |
| `track.ts` | Fixed track for balls, worked out by formula: sections swept along curves and helices, and profiles turned into funnels. |
| `grid.ts` | The broad phase both physics use: which pairs of bodies are near enough to be worth a closer look. |
| `gl.ts` | 3D drawing on WebGL 2: depth, a sun with shadows, sky light, numbers on faces, floating words, glow; and parts with a pattern drawn by the shader (oak, glass, glass marbles, metal, a skin, a cloth) under a lamp, with shadows that soften with distance and where things touch, many of a kind in one call. |
| `cells.ts` | A grid of cells drawn in whole pixels on WebGL 2: four bytes a cell read straight from where they are kept into one texture, colored from a palette and a shade, only changed rows sent. The sand mini draws with it. |
| `solids.ts` | The shapes of dice and other solids, drawn on a 2D canvas where WebGL 2 is missing. |
| `sound.ts` | Knocks, notes and strikes (wood, glass, metal, a chime bar, a bell, a drum) made by the browser with no files, through a bus with a limit on voices and a limiter; silent until turned on. |

## Built

All of the above. The physics in `flat.ts` and `space.ts` follows the soft step method Erin Catto described
for Box2D 3. Mote began on 10 Nov 2026 on forked libraries (planck, cannon and three) and by 11 Nov had
none: what was needed was written into it.

### Sleep in 2D

A body in `flat.ts` sleeps once it has been still for half a second, together with everything it
touches or is joined to, or not at all. Still is slower than 3 pixels a second, or, since 17 Nov 2026,
within a pixel of one place however fast: a pile squeezed together can tremble by a seventh of a pixel
for ever, and the tremble's speed passes 3 pixels a second for a step now and then, which by speed
alone kept the whole pile awake and its stage stepping. The speed rule already let a body travel a
pixel and a half in the half second, so nothing that was awake to be seen moving sleeps now. Held by a
test of a block knocked to and fro in one place at 20 pixels a second, which sleeps, and one kept going
one way at that speed, which does not; and by six piles of Blocks, four of which never slept before.

### Towers that rocked

Until 17 Nov 2026 a free-standing tower of blocks in `flat.ts` could rock for ever. A tower of six
40-pixel blocks on a fixed floor, its top pushed at 40 pixels a second, swayed 1.9 pixels at the top in
the first second and still 1.75 pixels twenty seconds on. Towers of seven to nine never stopped, and
from eight up the sway grew. In Blocks it showed in 2 of 300 piles squeezed from 800 pixels wide to
300, where a tower swayed four pixels at up to 60 pixels a second, so the pile never slept.

The cause was two things in the soft contacts, each at the edge of what a part of a step can carry.

- An edge resting on an edge has two points, solved together. Each point was given its own give, but
  how much a push at one is felt at the other was given none. The spring was then stiffer for the edge
  rocking than for it sinking: for a square block a fifth stiffer, past the limit of a quarter of the
  rate the parts are solved at. Now that cross term gives as well, so both ways are as stiff as tuned.
- Contacts between two moving blocks were at that limit already, 120 cycles a second with four parts.
  A stack rocks as one, and at the limit its rocking was not damped. Contacts between two bodies with
  edges are now at 100 (`EDGED`). Contacts with a ball, and with anything fixed, are as before.

What showed it, on the tower of six. Solving the two points one after the other in the first pass,
lowering the stiffness between blocks to 110, or lowering the damping ratio from 10 to 1 each let it
stop within two seconds. A higher damping ratio, more friction, or two parts a step instead of four
made it worse. How fast an overlap is undone made no difference. With no warm start the tower fell, and
with no second pass it flew apart, so neither of those feeds it.

After the change the tower of six stops within a second, towers of seven to nine within one to four
seconds, and 0 of 600 squeezed piles of Blocks fail to come to rest in thirty seconds. Either change
alone left 1 or 3 of the 600. Plinko has only balls, so its drops replay exactly as before; Blocks and
the crowded heap in `pairs.test.ts` end elsewhere. Held by a test of a nudged tower of six, which must
be still within two seconds and standing where it stood.

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

## For the marble run's stage 2

Added on 14 November 2026 for the marble run's pieces and snapping ([marbles](marbles.md)). Nothing that was
there draws or steps differently: Blocks, Dice, Plinko and Rolling were photographed before and after (Dice
and Rolling the same to the pixel; Blocks and Plinko show chance), and `pairs.test.ts` and `replay.test.ts`
hold as before.

- **How far the eye sees.** `view.range`, `[near, far]` in the scene's units, 0.5 to 120 unless set. The
  marble run sets 2 to 4000 and draws in centimetres at full size. `gl.test.ts` checks that a cube 300 units
  off is unseen by default and seen with a longer range.
- **Several pointers.** A scene that has `down(hand)` is told of every pointer by its id through `down`,
  `slide` and `up(hand, cancelled)`, with which button pressed it and whether Shift, Alt or Control was held,
  and is not given `press`, `move` and `release`; the canvas's own menu is kept away so the other button can
  drag. `wheel(x, y, by, pinch)` is the wheel, or a trackpad's pinch, and keeps the page from scrolling. So
  two fingers can pan and pinch. Scenes without them are as before.
- **Ends joined by hand, kept.** A swept piece has `kept`, the ends joined by hand (`along.joined`, or set
  later by a scene that knows which pieces meet). Each time pieces come or go, `join` starts again from those
  and finds the rest, so an end whose neighbour was taken away is open again (it used only to add joins).
  The marble run sets `kept` for pieces that meet end against end, made the other way round, and for a
  piece's own lengths where a groove becomes a tube, which Mote does not join as their sections differ.

Found on the way, and left as they are:

- An end of track left open costs a marble crossing it about a sixth of its speed, even where the two
  surfaces are one (149 cm/s down to 124): only joined ends are seamless.
- A ball rocking across a groove only a little wider than itself loses its rocking: a marble of 0.8 in a
  groove of 1.1 rocks in 0.08 s and lost two fifths of that motion's energy each second, where theory loses
  none; in a groove of 1.5 none is lost. The marble run's groove is 1.5. A ball entering a turn loses speed
  the same way as it is thrown up the wall and rocks, more the faster it comes.

## For the marble run's stage 4

Nothing in Mote changed for bending ([marbles](marbles.md)): a `Path` is anything with a point and its
first and second change at each place along it, and `local` for all three at once, so the marble run's
bent pieces are paths of its own (`displaced` in `pieces.ts`, a made path moved by a smooth bend, worked
out by adding, taking away, multiplying and dividing only) that `sweep` carries a section along and a
ball meets as it meets a curve or a helix. Every
other mini steps as before: the branch left `src/mote/` alone, and `bun test src/mote` passes unchanged. A
bent run gives the same race in Chromium as in Bun, to the bit (`table.test.ts`).

## For the marble run's stage 5

Added on 14 November 2026 for the marble run's moving and sounding pieces ([marbles](marbles.md)). Every
other mini steps exactly as before: a script ran Blocks (900 steps with a throw), Plinko's board, the dice
tower, a heap of 120 solids, Rolling, and each of the marble run's three earlier made runs (a table racing
marbles for 25 s, and its ghost), from the code before this stage and from the code after, and hashed
every number's bits: all the same. The new parts are touched only by a scene that makes them; where a
shared line had to change, it computes exactly what it did for every solid that is none of them (a
`give` that is 1 / mass for a free solid keeps the sum `a.im + b.im + ...` in its order, so it rounds the
same). `pairs.test.ts` and `replay.test.ts` pass unchanged.

- **Solids on a hinge.** `space.hinge(parts, through, axis, { low, high, spring, rest, friction })`: shapes
  that bulge, held on one fixed line and turning about it together, as one. It is kept in reduced form: the
  angle and its speed, each solid's place and turn worked out from the angle every part of a step by the
  sine and cosine of `track.ts`, so nothing drifts off the line. How hard it is to turn is each solid's
  tensor about its middle along the line, and its mass times its distance from the line squared. A push on
  any of its solids turns the hinge by the push's turning about the line; gravity on each solid, the
  spring and the friction are given after the speed a ball strikes at is measured (a light flap pressed up
  under a marble is then not taken to strike it anew every part). Its stops are one-sided limits on the
  angle solved as contacts are, closing exactly the gap there is and putting an overlap right softly, their
  pushes kept from step to step, so a seesaw resting on its stop under marbles is still. Its solids sleep
  only together, as one island with what rests on them. `space.turnTo` puts one at an angle; `knocked` is told
  when one strikes a stop, and how fast.
- **Driven solids.** `space.driven(mesh, at, move)`: `move(dt)` says where the solid is to be at the end
  of each step; it goes there at the speed that takes, ends the step exactly there, pushes what it meets as
  if it weighed everything and is pushed by nothing. While it moves it wakes any marble asleep in its way.
- **Fixed solids of any shape**: `space.fixed(mesh, at, stuff, q)`, a bell or a drum.
- All three meet balls only and pass through every other solid and the track, and are made and measured
  with square roots alone (not `Math.hypot`, which the dice keep), so a scene with them is the same to the
  bit everywhere.
- **Held to arithmetic** (`parts.test.ts`): a plate on a hinge swings with a pendulum's period, 2 pi
  root(I / m g d), to a tenth of a percent, and keeps its swing to 1%; a beam with a spring settles where
  the spring's push and a marble's weight balance, to a tenth of a percent (it first came out 1.7% off: the
  bearing friction was dividing the spring's push too, now fixed); a seesaw on its stop under a marble is
  still to a ten thousandth of a radian, falls asleep with it, and wakes and tips when a heavier marble drops
  on its other arm; a driven plate carries a marble up at its own speed, within 5%, never more than a
  fortieth of a millimetre into it or off it; no marble fired at a wheel of 3 mm arms turning 40 rad/s, from
  100 to 1,020 cm/s, nor at a 2 mm plate driven at it, from 200 to 1,300 cm/s, ends inside one or beyond it;
  a scene of a seesaw, a wheel and a lift gives the same numbers run twice and in Chromium as in Bun.
- **Beds** (`sound.ts`): `sound.bed(pitch, q)` gives noise that lasts (water hissing, a fire, grains
  pouring), and `bedOf(...)` builds one into any audio context. Two seconds of white noise go round
  through a band about the pitch, at a volume that is nothing until `feed(loud, pitch)` is called;
  each feeding brings the volume toward `loud` in a twenty-fifth of a second and sets it to die away a
  fifth of a second later, which the next feeding puts off. A scene feeds its beds every frame, so
  one that stops (paused, at rest, its tab hidden, the sound switched off) falls silent by itself.
  Nothing is made for a bed that has not yet sounded. Held by a test rendered in the browser's offline
  audio: a fed bed sounds, louder for more and higher for a higher pitch, and one left alone is less
  than a two-hundredth as loud a second later.
- **Strikes** (`sound.ts`): `sound.strike(kind, hard, pitch)`, and `voice(...)`, which builds one into any
  audio context, so the same code is heard live and rendered to a file. Each is plain sine waves, each
  with a volume that rises at once (in 0.4 to 3 ms) and falls away as e to the minus time over its own
  time, and a little filtered white noise for the moment of the hit:
  - wood: noise through a band about 2.4 kHz (Q 3) falling to a third in 11 ms, over a wave at 1,250 Hz
    (12 ms) and one at 2.48 times it (8 ms): a short dry click, heard for about a tenth of a second;
  - glass: waves at 3,950 Hz (22 ms) and 1.55 times it (13 ms), and a tick of noise about 6.5 kHz;
  - metal: four inharmonic waves at 1,800 Hz and 1.51, 2.36 and 3.12 times it, falling in 120, 85, 55 and
    35 ms: a short ring;
  - chime bar: the waves of a bar free at both ends, 1, 2.756 and 5.404 times its note, falling in 0.55 s
    (longer for a lower note, as (784 / f) to the 0.35), 0.12 s and 0.04 s, the upper two louder for a harder
    strike, and a tick of noise at 4.2 kHz for the mallet: a clear note that rings and dies away;
  - bell: a small bell's waves about a prime of 1,047 Hz, a hum an octave below, a minor third, a fifth, the
    nominal an octave up (loudest) and 2.5, 2.67 and 3 times it, falling in 0.12 to 0.7 s: bright;
  - drum: a wave at 150 Hz falling from 1.25 to 0.62 of it in 90 ms, with one at 1.59 times it, and dull
    noise through a low pass at 700 Hz: a soft thud;
  - harder is louder by the hardness to the power 0.7, from 15% of full, and a touch higher (12% for wood
    and glass, 5% for metal, 4% for a drum) or, for a tuned bar, brighter rather than higher, so it stays
    in tune.
- **Never clipping.** Every strike goes through one bus: a volume of 0.6, then a limiter (threshold -9 dB,
  ratio 20, attack 2 ms, release 150 ms). At most fourteen strikes sound at once: a new one past that
  takes the place of the quietest sounding now (by how loud it began and how far its longest wave has
  fallen), which is faded out in 10 ms, unless the new one would be the quietest itself, when it is left
  out; and at most six clicks of wood or glass start in any 30 ms. Rendered in Chromium, a hundred
  marbles' worth of strikes, three a frame for three seconds, peak at 0.82 of full scale and render in 0.61 s.

## For the marble run's stage 6

Added on 14 November 2026 for the marble run's look ([marbles](marbles.md)): patterns, in `gl.ts`. A
scene that asks for none sets up and draws exactly as before: the program for patterns is made only when
a part with a pattern is first added, and the old program's passes are untouched. Checked by drawing four
scenes (a cube with numbers, a ball, a slab, a see-through ball, a sign; then shining, a lit mark, the
shade, a longer range) through the `gl.ts` from before this stage and the one after, in headless Chromium
in software and on the graphics card, and comparing every pixel's bytes: the same. And by photographing
Dice, Rolling, Plinko and Blocks from a build before and a build after (below).

- **A part with a pattern.** `look.pattern` names what it is made of: `"wood"` (oak), `"glass"`,
  `"marble"`, `"metal"`, `"brushed"` (metal with fine streaks), `"skin"` (a drum's, on oak), `"cloth"` (a
  table's, with a grid, `look.grid` from 0 to 1 and `look.cell`). The pattern is worked out by the shader
  from each corner's place in it, `mesh.grain` (a place for each point; left out, the point's own place),
  so oak's grain runs along whatever the scene makes its first place: the marble run gives how far along
  a piece, so the grain bends with a bent piece. A part's `seed` makes it unlike others of its look (a
  piece of oak its own heart and tone; a marble its kind and the turn of its ribbon) and its `tints` are
  three colors of its own (a marble's ribbon or stripe). `look.rim`, a color and a strength, lights its
  edges, for a state. Such a part may be given another look with a pattern (`part.look`).
- **Oak**: rings about the heart of a log off to one side and below, its axis leaning a little, distorted
  by smooth noise at two sizes, so they show as long arches on the faces and as rings on a cut end; the late
  wood closing each ring darker, the early wood's pores as short dark streaks, the rays as pale flecks
  across the rings, a fibre along the grain; each piece warmer or paler by its seed. Every detail finer
  than a pixel fades to its average (by how fast it changes across the pixel), so nothing shimmers far
  off. Oiled: a soft Fresnel sheen.
- **Glass**: Fresnel (0.04 face on), the room reflected; a box's edges drawn where two of its places in
  the pattern (from -1 to 1 across it) are near their ends, a pixel and a half wide.
- **A marble**: the eye and the sun are taken into the marble's own place in the vertex shader, so what is
  inside turns with it. Clear (seed 0 to 1): the ray into the glass is bent by refraction (1.5) and met with
  three vanes through the middle, each a narrow leaf twisted up the marble (found again at the twist
  where it is met), lit by the side that faces the sun; the glass is see-through face on and darker and
  more reflecting toward its edge, with a little of the ribbon's color gathered opposite the lamp.
  Opaque (1 to 2): its color with a wavy stripe and a thin one, under a clear coat. Steel (2 to 3): a
  mirror of the room. Each holds the lamp as a sharp highlight.
- **Metal**: the room reflected in its color, a sharp highlight; brushed, a broad streaked sheen and a
  sharper one.
- **The room** a polished part reflects: dark, a little lighter above, with the lamp a bright warm disc
  (`view.lamp.size`, its angular size) and a glow about it.
- **The lamp**: `view.lamp` gives the sun's, the sky's and the ground's colors for patterned parts, the
  lamp's size, and `pool`, a place and radius where it lights most, falling to 0.3 beyond. Lit in linear
  light, then a gentle shoulder (the ACES curve fitted by Narkowicz) so a highlight goes to white.
- **Shadows** from the sun's map, looked up a texel and a half out from the face on the side toward the sun
  (a mesh's faces may be wound either way, so its own normal may point in), each look compared with the
  face's own plane where it looks (the change of its depth across the map, from the screen's derivatives),
  so that a wide soft edge does not shade the face itself. Full: what casts the shadow is searched for over
  1.6 cm (eight looks at the map read as depths, through a second sampler on the same texture), and the
  edge is as wide as how far behind it the face is times the lamp's size, from 1.2 to 14 texels, averaged
  over twelve looks on a disc turned by the pixel. Plain: four looks a texel and a half out.
- **Where things touch**: a second map from straight above (1024 square), of how high the highest thing is
  everywhere. A face looks at eight places round it (0.7 and 1.8 cm off): each that is higher by `over`
  hides as much of the sky as `over^2 / (over^2 + reach^2)`, fading with `e^(-over / 2.5)` so that only what
  lies close above counts. It darkens the sky's light, and half the sun's. A part with `look.touches`
  false is left out of the map.
- **Bloom**: `view.bloom`; what is brighter than white of a highlight on a marble, metal or glass goes into
  the small picture of what shines, which is blurred and added as before. Only those patterns are drawn in
  it (a highlight behind wood may glow a little through it).
- **Many in one call**: patterned parts are gathered by shape and look and drawn instanced, each part's
  place, seed and tints in one shared buffer; see-through ones sorted furthest first, marbles (keeping their
  depth) before glass (not). The depth passes draw them the same way.
- **`view.quality`**: `"full"`, or `"plain"` (no search for what casts a shadow, no map from above, no
  bloom, the ribbon not bent). **`view.counts`**: the last picture's draw calls in all, its triangles, and
  the calls of each pass (the sun's shadow, the map from above, the bloom, the eye's). **`view.patterns`**:
  false where the program could not be made; parts with a pattern are then drawn by the old program in
  their color.
- **Held** (`gl.test.ts`): oak is warm and its color changes five times as much across its grain as along
  it; a block's shadow falls on the cloth away from the lamp; a clear, an opaque and a steel marble each show
  as themselves; sixty more marbles of one shape and look add triangles and no calls, in every pass; the
  plain look leaves out the map from above and the bloom.
- **Measured** on the marble run ([marbles](marbles.md)): 147 calls a picture for a hundred marbles on a
  run of 22 pieces with every moving part, 2.2 ms with the graphics card's work on an RTX 3070 Ti; in
  software 280 ms for a small run, where the old look took about 50.

Dice, Rolling, Plinko and Blocks, photographed in headless Chromium from the drafts build before this
stage and the one after, the same way (the page opened, 1.5 s, or 3 for Rolling, the canvas photographed),
in software and on the graphics card: Dice the same to the pixel both ways, Rolling the same in software.
Rolling on the card, Plinko and Blocks differed, as they differ from themselves: the build before,
photographed twice, differed the same way (they move by the time the frames come, or by chance; Blocks
does not draw with `gl.ts` at all). The drawing itself is shown the same by the comparison above.

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
  beyond the `?debug` step time; text input.
- **For the marble run, later:** ball against a solid of faces is soft, so a moving part (a seesaw, a gate)
  is met as slabs are, not exactly (stiffer, as a fixed slab is); only balls meet track. A hinge has one
  line; a part on two hinges, or a chain of solids joined to each other, would want joints between solids.
- **For the 3D side:** smooth shading across faces, a shadow under each solid, pictures drawn onto faces,
  loading a simple model from a file, a wireframe view, dice that hit each other corner to corner rather
  than as balls, a camera that can be moved.
- **A repository of its own**, if anyone else wants to use it.
- scriptc (which compiles TypeScript to native programs and WASI modules) was looked at: it does not draw to
  a browser canvas, so it is no use for minis; it could matter for a desktop build later.

## How to run and test

```sh
bun test src/mote     # flat, space, balls, track, parts, sound, grid, pairs, replay, crowd, gl and the rest
```

`gl.test.ts` draws a scene in headless Chromium and reads its pixels. `replay.test.ts` checks that a scene
run twice ends the same and that a step is fast enough, and runs a marble race in Bun and in Chromium.
`balls.test.ts` and `track.test.ts` hold balls and track to the arithmetic of a rolling ball, and
`parts.test.ts` the hinges and driven solids to theirs; `sound.test.ts` renders the strikes in Chromium. `grid.test.ts` checks the broad phase against a
loop over every pair, and `pairs.test.ts` the minis' scenes with it and without, to the bit. `crowd.test.ts`
prints step times for 100 to 5,000 bodies and takes about forty seconds; run it on its own with
`bun test src/mote/crowd.test.ts` when measuring.

## Known weak spots

- In 2D, a tower of nine blocks that is nudged takes up to four seconds to stop swaying, where a real
  one would stop sooner or fall. Taller ones were not measured. See "Towers that rocked" above.
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
