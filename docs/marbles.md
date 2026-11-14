# A marble run

A mini: build a marble run in three dimensions and watch marbles go down it. A plan dated 13 November
2026. Stage 1, what Mote needed, and stage 2, pieces and snapping, were built on 14 November 2026
(below). The mini is a draft, Marbles, at `/minis/marbles/`.

## Decided

- **What it is for**: powerful, a pleasure to build with and to watch. Deeply satisfying is the measure:
  marbles that roll truly, pieces that click, sounds that are right, a run that can be watched for a long
  time.
- **Assembly: snap, then bend.** A box of pieces whose ends click together; then any piece can be bent,
  stretched or tilted with its joints staying joined.
- **A full editor in three dimensions**: a free camera (orbit, pan, zoom, and views from the top, front and
  side); handles to move, turn and scale a piece along one axis, with snapping to a grid and to angles;
  undo without limit, copy and paste, several pieces selected and moved together, a section mirrored, a
  section saved as a piece of one's own; and building while it runs, with a ghost marble showing the path
  before real ones are let go.
- **Made for touch as well as a desk**: tablets and touchscreen laptops first, a mouse and keyboard as
  well.
- **Moving parts**: lifts and chain hoists that carry marbles back to the top, seesaws, spinners, switches
  that alternate, trapdoors, one marble setting off another.
- **Sound**: marbles click on wood and ring on metal, and chimes or xylophone bars placed in the run make
  a tune as marbles strike them.
- **A camera that rides along** with one marble, or watches from a fixed place.
- **Races and sharing**: several marbles dropped to see which wins; a run shared as a link or a file; a
  few made runs to start from.
- **The look: wood and glass.** Warm wooden track, glass marbles that catch the light, soft shadows, as a
  real set on a table.

## The design

### Pieces and joints

- A piece is a path through space with a cross-section swept along it (a gutter, a tube, a pair of rails)
  and a joint at each end. A joint has a place, a direction and an up, and two joints of the same kind
  snap when brought near: the piece being placed turns and moves to fit, with a click and a small settle.
- The box: straights of several lengths, curves, slopes and drops, an S bend, a spiral, a funnel, a loop,
  a jump with a catcher, a splitter and a joiner, a start hopper and a finish tray, supports and pillars.
  Moving pieces: a lift, a chain hoist, a seesaw, a spinner, an alternating switch, a trapdoor, a gate
  that a marble opens. Sounding pieces: chime bars tuned to notes, a bell, a drum.
- Bending: a piece's path is a curve with a few control points. Dragging a point bends it; the ends stay
  on their joints, and the pieces joined to it follow or resist as chosen (a joint can be pinned). Limits
  keep a bend buildable: no kink tighter than a marble can take, shown as the piece turning a warning
  color before the limit.
- Supports are made by themselves under track that needs them and can be moved or taken away.
- Checks while building, shown and never enforced: a slope too shallow to roll, a gap, a turn too tight
  for the speed a marble will have there.

### The physics

On Mote's 3D physics, which must first gain what a marble run needs (looked into as part of the work on
Mote's broad phase and inertia; see [mote](mote.md)):

- A ball rolling on a track with true rolling and spin: it speeds up down a slope as a rolling ball does,
  which is slower than a sliding one, and keeps its spin through a jump.
- Track as collision shapes of its own, a swept section and not thousands of triangles, so that a marble
  rolls smoothly with no bumps at the joins.
- A fast marble never passes through a thin rail.
- Marbles at rest sleep. Hundreds of marbles at once at 120 steps a second is the aim.
- The same run gives the same race every time: fixed steps, and no chance in the physics. Races are fair
  and can be replayed.

### The editor

- One finger or the left button orbits; two fingers or the right button pan; pinch or the wheel zooms.
  A tap selects; a long press or a right click opens the piece's menu. Everything reachable by touch has a
  target at least a fingertip wide, and nothing needs a hover.
- A piece is placed by dragging it from the box into the scene, where it follows the finger on the ground
  or at the height of what is under it, and snaps to open joints as it passes them.
- Handles on the selected piece: arrows to move, rings to turn, and its control points to bend. Snapping
  to a grid and to angles is on by default and held off with a key or a second finger.
- The box of pieces, the tools, and play, pause and reset sit round the edge and fold away. Keys for
  everything on a desk.
- Undo covers every change. A run is saved in the browser as it is built.

### Watching

- Let go one marble, a stream, or a race of several in the flags' colors.
- Cameras: free, riding with a marble, a fixed spot, and a slow tour of the run by itself only when asked.
- Sound made by Mote's own sound code: each strike's loudness and pitch from the speed and the material.
- The look, drawn by Mote: wood with grain, glass marbles with a highlight and a refraction that is faked
  cheaply, soft shadows under everything.

### Sharing

- A run is a list of pieces with their places and bends, small enough for a link when short and saved as
  a file when long. A link opens the run ready to play.

## Stages

1. Mote: rolling, track shapes, fast marbles against thin rails, sleeping. Tests against the arithmetic of
   a ball rolling down a slope and round a loop. **Built** (see below).
2. Pieces and snapping: the box, joints, placing by drag, supports, and marbles rolling down a run built
   from fixed pieces. **Built** (see below).
3. The editor: camera, handles, selection, undo, copy and groups, touch throughout, building while it
   runs with the ghost marble.
4. Bending, with its limits and warnings.
5. Moving parts and sound.
6. The look: wood, glass, shadows.
7. Cameras, races, sharing, and the runs to start from.

## Stage 1, built

On 14 November 2026, in Mote (`src/mote/space.ts`, `src/mote/track.ts`; [mote](mote.md) has the detail).
A draft page, Rolling (`src/minis/rolling.ts` on `src/minis/course.ts`), shows it: a ramp, a loop, a
banked spiral, a funnel and a tray, marbles let go one after another. It is a draft, seen in `bun run dev`
and in a build with `SHOW_DRAFTS=1`, and is no part of the mini to come.

**Held to theory, by test.** A marble on a slope rolls at 5/7 of g sin(slope) to within half a percent and
slides as friction says where it cannot hold the roll; one rocking across a gutter keeps the period of a
rolling ball to 0.01%; one let go into a loop stays on from 2.71 loop radii and comes off from 2.66 (theory
2.70); on two rails it rolls slower, as rolling on a smaller circle says, to 0.2%; smooth in a funnel it
keeps its turning about the axis to one part in ten thousand and its energy to 0.2%; with a rolling cost it
circles down and drops through the hole; pieces that meet are one surface to it; a 0.5 mm rod stops it at
up to 1,500 cm/s from any side (a metre's drop gives 340 cm/s); twelve marbles racing end the same to the
bit twice over and in Chromium as in Bun.

**What stage 2 can rely on.**

```ts
import { MARBLE, marbleSpace, turn } from "../mote/space";
import { curve, gutter, helix, sweep, turned } from "../mote/track";

const space = marbleSpace();                     // centimetres, real gravity, islands that sleep
const path = curve([[0, 30, 0], [40, 22, 0], [70, 18, 25]], { start: [1, -0.2, 0] });
const piece = sweep(path, gutter(1.6, Math.PI, 0.25), { level: true, bank: [0, -0.2, 0] });
space.track(piece, { friction: 0.5, bounce: 0.4, roll: 0.003 });
const marble = space.ball(0.8, [1, 29.4, 0], MARBLE);
space.step(dt);                                  // fixed steps of 1/240 s inside
view.add(piece.mesh(), look);                    // gl.ts draws the piece from the same numbers
part.at = marble.p; part.turn = turn(marble);
```

- A piece is a path and a section. Paths: `curve(points, { start, end })` (a smooth curve through the
  points, its end directions held if given: the joints), `line`, `helix` (a spiral, or with a level axis a
  loop; its `facing` is the twist that keeps a section facing the axis). Sections: `gutter`, `vee`, `bed`,
  `tube`, `rails`, or any list of lines and arcs with a thickness. `turned(at, profile, thick)` is a funnel
  or a bowl.
- A piece's ends are `piece.ends[0]` and `[1]`: a place, the way along, up and across, which is what a
  joint is. Two pieces whose ends meet with the same section, facing on the same way and up the same way,
  are joined by Mote itself and are one surface to a marble. A bank that changes along a piece starts and
  ends where its neighbours are, or the join is a step.
- `along`: `up` (the start's up, or the up to stay level to), `level` (for anything that is not a loop),
  `bank` (radians, leaning the up to the right; a left turn leans left, so its bank is less than none),
  `twist` (a corkscrew), `joined` (by hand), `step` (chunk length).
- Pieces can be added and taken away (`space.remove`) while it runs; the table of chunks is made again.
- Same input, same race, on any machine: keep to track, balls and level slabs. A slab turned by `angled`
  uses the browser's own sine and may differ in its last bit between browsers. Bodies are solved in the
  order they were added; add racers in a fixed order.

**How many.** At 120 steps a second (one frame of 1/120 s is two steps of the solver), in headless
Chromium on four cores of this computer: 200 marbles rolling in a gutter take 2.6 ms a frame, 400 take
6.6 ms; 200 circling a funnel and jostling 3.4 ms; 400 heaped in a tray 4.6 ms awake and 0.1 ms asleep.
Bun is slower than Chromium by about half again. So a few hundred marbles at once, with room left to draw.

**For stage 2 to know.**

- A marble's scale is real: radius 0.8 cm, real gravity. A metre's drop is 340 cm/s. Slower, toy-like
  gravity would be a choice of look, not of physics.
- A fast marble in an unbanked tight spiral climbs the outer wall until friction cannot hold its roll and
  slips; bank turns into their curve, as real track is.
- Ball against ball and ball against a solid of faces are soft, as the dice are; ball against track is
  exact. A heavy solid resting on marbles sinks in by up to a twelfth of a marble's radius.
- Only balls meet track. A moving part that is not a ball (a seesaw, a gate) is a solid of faces, met by
  balls as slabs are.

## Stage 2, built

On 14 November 2026: the draft mini Marbles (`src/minis/marbles.ts`, `src/content/minis/marbles.mdx`), on
`pieces.ts` (the box), `run.ts` (a run as data), `table.ts` (the run as Mote's physics), `supports.ts`
(pillars), `checks.ts` (the marks), `orbit.ts` (the camera) and `runs.ts` (made runs), each with its
test. Rolling is left as it was.

**The grid.** A cell is 8 cm square and a level 2 cm high, the height of a block of track. Track runs along
the middle of a row of cells; a joint is in the middle of a cell's edge, at a whole level, pointing along
the ground, its up straight up. So any joint meets any other exactly, and two pieces meet only by
coinciding. A piece's place is the corner of its first cell (whole cells), the level of its first joint,
quarter turns about that corner, and whether it is mirrored.

**The section.** A groove of 1.5 cm radius cut in a block 4.4 cm across and 2 cm high; a marble of radius
0.8 sits 0.7 below the groove's middle line and shows 1 mm above the block. A marble meets the groove, the
block's top either side and its sides. Not a tighter groove: at 1.1 cm a marble rocking from side to side
lost two fifths of its rocking each second in Mote's steps, where theory loses none; at 1.5 none is lost.
The loop, the drop and the funnel's neck are tubes whose floor is the groove's circle.

**The box** (19 entries, all on the grid): the hopper; straights of 1, 2 and 3 cells; tight curves (4 cm
radius) and wide curves (12 cm) a quarter turn, left and right; turns back (a half turn, 4 cm) left and
right; a gentle slope (a level down over 2 cells) and a steep one (2 levels over 2 cells), each level at both
ends; a drop (4 levels, through a tube); S bends (a cell aside over 2 cells) left and right; a spiral (2 turns
of 8 cm radius, 6 levels down, on a post with arms, in 3 cells by 3); a funnel (in 3 by 3, a chute in, a bowl,
a neck that turns the marbles out level 8 levels lower); a loop (4.5 cm radius, a glass tube, out a cell
aside); and the tray (2 cells by 3, its floor 3 levels below its joint). Left and right are the same piece
mirrored. A piece's own numbers are kept (a straight's length, a curve's radius and quarters, a slope's
length and drop, a spiral's turns and drop), so stage 4 can change them; the box offers these few.
Curves are banked into their turn as far as a marble at 60 cm/s leans, at most 0.35 rad, easing to none
at their ends, so that every piece meets every other upright. A round groove banked is the same circle,
so the bank changes only where its rim is.

**Snapping.** A piece carried looks at every open joint of the run and every one of its own joints, and
for each pair the quarter turn and place that puts them face to face (`snaps` in `run.ts`), leaving out
those that overlap or go below the ground. Of those, it takes the one whose middle would be nearest the
pointer on the screen, if within 40 pixels (60 for a finger), and keeps it until the pointer is half as far
again away, so that it does not flicker. A snap clicks and the piece eases there in 0.09 s (none with
reduced motion). Carried over nothing, it rides at the height of the open end nearest the pointer; over a
piece, at the height of that piece's nearest joint. Let go where it fits, it is placed; where it does not,
it shows red and goes back where it came from (or, new, goes away); over the box, it is taken away. A piece
pressed in the box goes at the open end chosen (the last placed, or the piece last pressed), the first way
round that fits, flying there from the box.

**Overlap.** Each piece takes up cells, each from one level to another: its block and the room a marble
rolls in above it, worked out from its own track, every centimetre. Two pieces overlap if they share a cell
at heights that cross. Track two levels above other track fits; one level does not.

**Pillars.** One under every joint off the ground (two pieces that meet share it), and under the spiral's
post, the funnel's legs, the tray's feet and the hopper's box, 2 cm square, standing on the ground, made again
whenever the run changes. One that would pass through another piece or the room above one is not made, so
nothing is ever in a marble's way; a piece then hangs from its joints. They are slabs a falling marble hits.

**Marbles.** Each hopper holds a marble at its mouth; let go (a press, Space, or a stream every 0.6 s), it
rolls, and the next comes out of the box in 0.3 s. Marbles fall off open ends, land on the table (rougher,
so they stop), sleep at rest; past 240 the oldest goes, one in a tray first; one that falls off the table
goes. Pieces can be placed, moved and taken away while marbles roll: a piece taken away takes its track and
wakes what rested on it, which falls.

**Marks** (shown, never enforced): a small amber square at an open end that is not a tray's; a piece tinted
amber where a marble will stop, or a turn it will come at faster than 160 cm/s (the fastest any turn of the
box was measured to carry one; what throws it out is the jolt where a turn begins, so the radius matters
less than it seems). Speeds are guessed along the run from each hopper by energy, less a rolling cost, a cost
where a turn begins or ends, and what a tube or the loop keeps, fitted to marbles on the made runs and held
by test to within a third of them. Not marked: a loop come at too slowly; a marble got round from 133 cm/s
after a gentle slope and failed from 151 after steep ones, so the guess would mislead.

**Controls.** Touch first. One finger on a piece carries it; on the table it turns the view; two fingers
pan, pinch and twist it. A press on a piece chooses it, for turn, mirror, raise, lower and take away in the
panel, each a word a fingertip wide. The mouse: the main button as a finger, the other button or Shift to
pan, the wheel (or a trackpad's pinch) to zoom. Keys, with the run focused: comma and full stop choose a
piece; the arrows (or WASD) lift it and move it a cell the way the view looks, Q and E a level; R turns, F
mirrors, Enter puts it down, Escape puts it back, Delete takes it away; Space lets a marble go, P pauses,
Home fits the run, plus and minus zoom, Shift with the arrows turns and tips the view. The box's pictures
are buttons, so Tab reaches them and Enter puts that piece at the open end. "Fit the run" frames it all.

**The camera.** Turned about the upright, tipped over 0.12 to 1.45 rad, 18 to 900 cm off; `gl.ts` now sees
2 to 4000 cm for this scene (`view.range`), every other mini as before.

**The run as text.** `v1`, then each piece after a dot: its family letter, then its numbers between
underscores (its own numbers, the corner across and along, the level, the quarter turns with 4 added when
mirrored). A long straight one cell across at level 6 turned once is `s2_1_0_6_1`. Families: `h` hopper,
`s` straight, `c` curve, `d` slope, `v` drop, `z` S bend, `x` spiral, `f` funnel, `l` loop, `t` tray. Letters,
digits, `-`, `.` and `_` only, so it goes in an address unchanged; about 12 characters a piece; a run in
another version is not read. The run is kept in the browser as it is built.

**Made runs** (`runs.ts`): a first run (8 pieces), every kind of piece (15), twenty pieces. Each carries
every marble let go to its tray, where they sleep, and has nothing marked; the same run gives the same race
to the bit.

**Measured.** Built by real drags from the box in headless Chromium: 13 pieces with the mouse at 1440 by
900, and with one finger at 1024 by 768 and 390 by 800, every piece snapped, nothing marked, every marble
let go reached the tray. Near a joint the track pushes a marble at 1.0 to 1.1 g in the middle, as inside a
piece; the hardest pushes are landings (the drop's tube, the funnel, the tray) and an S of two tight curves
taken fast. With 100 marbles on the twenty piece run (about 15 rolling and the rest heaped in the tray),
the physics takes 1.6 to 1.9 ms a frame of 1/120 s and handing the drawing over 0.3 ms, on four cores; the
drawing itself is on the graphics card and was not measured (headless Chromium draws in software). Blocks,
Dice, Plinko and Rolling draw as before: Dice and Rolling the same to the pixel.

**What stage 3, the editor, can rely on.**

- The model is plain data and pure functions: `Placed { id, kind, place }`, `jointsOf`, `links`, `open`,
  `neighbours`, `fit`, `snaps`, `overlaps`, `fits`, `write`, `read`. Joints are never stored; moving a piece
  parts it. Undo can be a list of runs as text.
- `table.set(run)` rebuilds only what changed, by id, and keeps marbles rolling; it marks joined ends by hand
  whichever way round the pieces were made, and joins a piece's own lengths where a groove becomes a tube.
- The scene keeps one carried piece at a time; a selection of several, handles, the long press menu and undo
  are stage 3's. Turning a placed piece turns it about the corner nearest its middle; at a joint, turning
  should rather cycle the ways it fits there (`snaps` gives them).
- The pointer and keys go through `stage.ts`'s `down`, `slide`, `up` and `wheel`, with the pointer's id,
  button and keys held.
- Two fingers were checked only in tests of the arithmetic (`orbit.test.ts`): the browser driver has one
  finger. The second finger's pan, pinch and twist want checking on a real tablet.

**For stage 3 to know.**

- Any end of track left open where a marble crosses costs it about a sixth of its speed, even where the
  surfaces are one; ends that meet must be joined (Mote joins those of one section; the table the rest).
- A marble entering a turn loses speed as it is thrown up the wall and rocks; fast into a tight turn, much.
  Runs that drop a long way between turns throw marbles out.
- The loop needs about 2.7 times its radius of drop in theory and more in practice, and how the marble
  arrives matters: after steep slopes it rocks and does not get round.
- The funnel's hole leaves 1.5 cm clear of its axis for a marble of 0.8; at 1.1 marbles arriving together
  jammed there and fell asleep.

## Open

- Its name.
- Two fingers on a real tablet: whether pan, pinch and twist together feel right, and whether a finger
  should turn a piece being carried.
- Whether a touch on a piece should choose it or carry it at once; for now a press chooses and a drag carries.
- Whether marbles can be of different sizes and weights.
- How large a run may be before the page slows, and what is said then.
- Whether a run can be exported for printing in three dimensions.
- Whether there are goals (get a marble into the tray using only these pieces) as well as free building.
