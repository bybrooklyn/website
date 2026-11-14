# A marble run

A mini: build a marble run in three dimensions and watch marbles go down it. A plan dated 13 November
2026. Stage 1, what Mote needed, stage 2, pieces and snapping, stage 3, the editor, and stage 4,
bending, were all built on 14 November 2026 (below). The mini is a draft, Marbles, at `/minis/marbles/`.

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
  on their joints, and what is joined to it never moves (stage 4 chose this over pieces that follow or
  resist). Limits keep a bend buildable: no kink tighter than a marble can take, shown as the piece
  turning a warning color before the limit.
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
   runs with the ghost marble. **Built**, waiting to be looked at (see below).
4. Bending, with its limits and warnings. **Built**, waiting to be looked at (see below).
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

## Stage 3, built

On 14 November 2026, in the draft Marbles: `marbles.ts` rewritten on new files, each with its test:
`edit.ts` (groups moved, turned, mirrored, fitted and resized, as data), `history.ts` (undo),
`ghost.ts` (the ghost marble), `handles.ts` (the handles' arithmetic and shapes), and `toolbar.ts` (the
icons and the bar, wiring only). `orbit.ts` gained the views straight on and the narrow lens; `table.ts`
a table whose hoppers stay empty, where each hopper's marble waits and which piece a point is in.
`scripts/browser.ts` gained several fingers at once (`fingers`) and modifiers on `click` and `drag`, each
with a test. Mote itself is unchanged; every other mini steps as before.

**Choosing.** A tap or click chooses a piece, shown by a lift in tone toward the accent. Shift with a
click, a long press of a finger (0.45 s, with a small buzz where the device has one), or a tap with the
select tool on adds it or takes it out again. A box is drawn round many by Control with a drag on the
table, by a long press on the table and then a drag, or by a drag with the select tool on (B); what
has its middle inside is chosen. Control and A chooses all, J (or the strip's chain) everything joined
to what is chosen, comma and full stop the piece before and after; a tap on the table or Escape chooses
nothing. One finger on the table still turns the view, so the box never fights orbiting.

**Handles**, drawn over everything in the scene and one size on the screen at any distance (an arrow
74 pixels, the ring 54 across from its middle): an arrow along each axis, red across, green up, blue
along; a ring about the upright in the accent; and, on one chosen piece that can be resized, a knob
past its far end. A handle is taken by its outer part and head, from a fingertip (24 pixels) or the
mouse (13) away, and only once the press moves; over a chosen piece only a press on the handle itself
takes it, so what is chosen can still be carried where the handles cross it. The arrows move by whole
cells and the green one by levels, the pointer's nearest point on the axis, so the pieces stay under it;
the ring turns by quarters about the corner nearest the middle; one piece hanging from one joint goes
round the ways it fits there instead (`snaps`), so it stays joined. While dragged, only that handle
shows; joints part and rejoin as pieces pass open ends, with stage 2's click; let go where it does not
fit, it goes back. The ring's angle is kept to quarters by `turnedBy`; finer angles for bending would
change only that rounding and `Place.turn`, which is whole quarters today.

**Resizing.** The knob changes the piece's own numbers, its first joint staying where it is, to the
form whose far joint is nearest the pointer (`resized`): a straight 1 to 6 cells; a slope 1 to 6 cells
along and 1 to 8 levels down; a curve tight or wide (a quarter or a turn back); an S bend 2 to 4 cells
along and 1 or 2 aside; a drop 3 to 10 levels; a spiral's drop, at least three levels a turn. A slope, a
drop and a spiral are dragged in the upright plane along them, the rest on the level of their end. The
hopper, the tray, the funnel and the loop have no size.

**Carrying.** A drag on a chosen piece carries everything chosen; on another piece, that piece alone.
Pieces carried leave the table at once, so marbles on them fall (they do not ride). A group snaps when
one of its open joints comes within 40 pixels (60 for a finger) of an open joint, every way being worked
out once when it is lifted (`groupSnaps`); one piece snaps by its middle, as in stage 2. The arrows (or
WASD) lift what is chosen and move it a cell the way the view looks, Q and E or Alt with up and down a
level; Enter puts it down, Escape puts it back.

**Undo** keeps every state of the run as its text, from the first; a step is the run's text after any
change (place, move, turn, resize, mirror, take away, paste, load, clear), never two the same running.
The steps are kept in the browser with the run (the newest that fit in a million characters, all of them
in memory) and carry on after a reload if the run kept is the one they end at. Putting a run back keeps
the numbers of the pieces it shares with the run before (`matched`), so only what changed is rebuilt and
marbles on the rest roll on. Control and Z, Control with Shift and Z or Y, and two buttons. Tested over
a thousand random changes, undos and redos; in the browser, by mouse and by finger, undoing 21 to 23
steps back to an empty table and redoing them gave the run's text the same to the character.

**Copy, paste, mirror and pieces of one's own.** Copy keeps what is chosen as a run's text moved so
its middle is at the corner (`asOwn`), and puts it on the system's clipboard too, so a section can go
from one browser to another. Pasted with Control and V while the pointer is over the run, it follows
the mouse and snaps by any open joint, and a click puts it down; from the bar's paste button, or with
nothing under the pointer, it goes at the open end like a piece pressed in the box, the way marbles
flow first. Control and D duplicates, Control and X cuts. Mirror flips what is chosen left for right:
across the line along its one joint to the rest if it has exactly one, so it stays joined and turns the
other way (a curve to the right becomes one to the left), otherwise across the upright line through its
middle as the view sees it. The arithmetic: a piece's own mirror reflects it across the row of its
first joint, half a cell from its corner; reflecting the world across z = k instead turns its turns the
other way (t becomes -t) and leaves its corner where the reflection of the corner is, less a cell turned
by -t, so k must be on a cell's edge or through its middle (`mirrored`); the test holds every joint and
box of every made run to its reflection. Straights, slopes, drops, the hopper and the tray are the same
mirrored and stay unmirrored in the text. The strip's box with a plus keeps what is chosen as a piece of
one's own, named in a line that takes its place; it is kept in the browser, shown in the box after the
made pieces with a picture drawn by the scene's code, placed like any piece (pressed, or dragged up),
and taken out of the box by the cross in its corner.

**The ghost marble.** A marble from each hopper, let go together as the real ones are, followed on a
table of its own (`makeTable({ filled: false })`) with the run as it is now, and, while pieces are
carried and fit where they are, as it would be with them there. It works a few milliseconds a frame
(2.5 while something is carried, 6 otherwise) and the path grows as it is found; it starts again
whenever the run it would run on changes. Shown as a thin thread along the top of the marble's way and
a faint marble going along it at a marble's speed, resting a moment at the end. It ends where the
marble comes to rest in a tray, stops (slower than 1.5 cm/s for 0.6 s, or asleep), leaves the track and
lands on the table, or after 40 s. A marble's last piece is the one it is touching, not one it flies
over (in the air its speed changes by gravity alone). Following a lone marble of the twenty piece run to
its tray is about 1,540 steps of 1/120 s at 0.17 ms each in Bun, 250 ms in all (Chromium is about a
third faster), with 5 ms to build its table the first time and 4 to start again; so at the budget the
whole way is found in about half a second at 60 frames a second when nothing is carried, and about a
second while something is, the thread growing meanwhile. It never touches the real table; the test holds a real race beside it the same to the bit.

**The marks and the ghost agree** because the marks are now the ghost's: the piece where it stops is
tinted as too level, the piece it leaves the track from as thrown off; the open ends keep stage 2's
small squares from `checks.ts`, which are exact. The guesses by energy in `checks.ts` are no longer
shown: they disagreed with the physics now and then (a run of four long straights stops a marble a
piece further on than they say; a run too steep for a tight curve threw the marble from the tray's
chute, not the curve). The test holds the ghost to falling from the piece marked open, stopping within
a piece of where the guess says, and being thrown off a run too steep. The line of words under the
scene is gone.

**The camera.** Orbit, pan and zoom as before; views from above, the front and the side, turned to with
a short eased turn (0.45 s) the short way round, from the little axes in the canvas's top right corner
(a dot for each axis, coloured as the arrows, the near ones over the far ones, the view it is in
ringed; pressed, the view looks from there; the hollow ends look from the back and the left), or 7, 1
and 3. Views straight on use a narrow lens (5 degrees, the eye further back by as much, so what is
looked at keeps its size), all but a drawing without depth, which lines pieces up as a plan does;
turning the view by hand eases back to the usual lens, and 5 switches it. From above, the far side of
the table is up the picture. The fit button fits the run, or what is chosen when something is
(Home and Shift with Home).

**The panel.** The box stays a strip of pictures. The tools are one raised surface of icon buttons in
three groups parted by thin rules, drawn in mdQuire's line style with a tooltip naming the key: select,
undo, redo, paste; let a marble go, a stream, pause, clear the marbles; fit, sound, keys, runs to start
from. 2.5rem square, 2.75rem where the pointer is a finger; on a phone each group is a row. What acts
on what is chosen is a strip that grows out of the selection's edge, above it and its handles or under
them where there is no room: turn, mirror, what is joined, copy, duplicate, keep as one's own, take
away. The keys (a plain list) and the runs to start from (with an empty table and choosing every piece)
open as folds under the bar, growing from their button. The canvas never lets the page scroll under a
finger.

**Measured**, by `scripts/browser.ts` in headless Chromium, built and served from `dist`. With the
mouse at 1440 by 900: a hopper dragged up from the box and raised 22 levels by its green arrow, fourteen
pieces pressed in after it, nothing marked, the ghost in the tray; a second hopper dragged out and
raised; five pieces chosen by Shift and clicks and carried as one until their open end snapped to the
new hopper; three copied, pasted following the mouse to an open end and put down with a click; mirrored
by the strip; a straight pressed in at the end and dragged by its knob from 1 cell to 3; all undone back
to the empty table and all redone, the text the same; three kept as "hairpin" and put in twice from the
box; the ghost changing from arriving to falling while the tray was carried off; each view from the
little axes. By finger at 1024 by 768 and 390 by 800, the same, with the select tool and a long press
for choosing, the strip and the bar for copy, paste, mirror and keeping, the bar for undo, and two
fingers: spreading them three times as far brought the view three times nearer, moving them together
panned, turning them by 0.6 rad turned the view by 0.6. At 390 the handles cover a small selection, so
it was fitted first (the fit button) and then carried. The page did not scroll under a finger and was
never wider than the window. Every key in the keys list was pressed and did what it says.

With 100 marbles on the twenty piece run (70 in the tray) and ten pieces carried round by the mouse for
four seconds, on four cores: the physics 1.9 ms a step, the ghost 2.1 ms a frame, everything the scene
does in a frame 3.2 ms on average and 7.5 at most. The drawing itself is done by headless Chromium in
software, at about ten frames a second for the whole page whatever the scene does, so frame times on a
real screen were not measured.

**Choices to confirm.**

- Marbles on a carried piece fall; they do not ride it.
- The fit button fits what is chosen when something is, and the run otherwise; its icon says which.
- Handles take a press only once it moves, and over a chosen piece only on the handle itself.
- A long press adds to the choice; on the table it starts a box. Taps with the select tool add too.
- The ghost is always shown, faintly, and its marks replace the guesses by energy.
- A paste by Control and V follows the mouse; from the button it goes at the open end.
- The little axes in the corner, without letters; the narrow lens in views straight on, by itself.
- Pieces of one's own are named when kept; they are removed by a cross in the box.
- The strip covers what is behind it, as mdQuire's does; it keeps clear of the handles only.

**What stage 4, bending, can rely on.**

- The run is still `Placed[]` with quarter turns; every edit is a `Move` (quarters, cells, levels) or a
  new kind (`resized`), and goes through `groupFits`, `changed()` and a step of undo. A bend will be a
  new number in the kind or the place, written in the text (which will need `v2`), and undo, copy and
  pieces of one's own carry it with no more work.
- Handles: `handles.ts` gives places on the screen, which one a pointer takes, and distances along an
  axis; control points for bending can be one more kind of handle, drawn and taken the same way.
- The ghost runs on whatever `table.set` builds, so a bent piece is in it as soon as the table makes
  it; its marks are where bending limits will show.
- A piece's shape is cached by its key; a bent piece needs its bend in the key.

**For stage 4 to know.**

- A drag of a chosen piece and a drag of a handle start the same; only the handle's outer part takes
  a press, and only when it moves. Control points will need room of their own on the screen.
- The little axes and the strip are drawn over the canvas; their places are worked out each frame.
- The keys are nearly all taken (the list in the keys panel); bending will want few.

## Stage 4, built

On 14 November 2026, in the draft Marbles: the bend in `pieces.ts` (what it is, its limits), `run.ts` (the
text's `v2`, overlap by room), `edit.ts` (mirror, resize, pieces of one's own and undo carry a bend),
`handles.ts` (points as handles, how a drag moves one, snapping; the handles standing off), `history.ts`
(presses of a key as one step), `toolbar.ts` (two icons, the bar that stacks) and `marbles.ts` (the
editor), each with its test. Mote is unchanged: nothing in `src/mote/` was touched, so every other mini
steps exactly as before (`bun test src/mote`, its replay and pair tests among them, passes unchanged).

**Left over from stage 3.**

- *The tray by finger.* It could be taken all along. The stage 3 runs measured where the canvas was before
  their first finger, and the browser driver turns touch on at the first finger: the page then matches
  `(pointer: coarse)`, which pads the site's header links and moves the canvas down 9.6 pixels, so every
  press by finger landed that much above where it was aimed, and a far small piece such as the tray was
  missed. A phone is coarse from the start, so this was the test's and not the page's. The runs now turn
  touch on before measuring. Shown at 1024 by 768 and 390 by 800 by real touches: each of the first run's
  eight pieces chosen by a tap and carried by a drag, the tray too, and the ghost going from arriving to
  falling while the tray was held off the end, and back to arriving when it was put back.
- *Handles on a small selection.* They stand off from it by its size on the screen (`standOff`): the
  arrows start and the ring runs outside the pieces' reach, up to a fifth of the picture; a larger
  selection is stood off no further, and its handles cross it. A press on the body of a chosen piece now
  always carries it and never a handle. A finger's press up to 12 pixels off a piece still takes it (the
  nearest piece under a ring of points round the press), so a far piece is as easy to touch as a near one.
- *The phone panel.* Under 30rem the stray rule was already gone, but between about 480 and 620 pixels the
  groups still wrapped with a rule at a row's start. The bar now measures whether its groups fit in one
  row (`stacking`) and otherwise stacks them, one to a row, lined up at the left, with no rules, the bar as
  wide as its rows.
- *Found on the way:* two names left unused in the scene's overlay, tidied. Not changed, as they are as
  meant: undo gives a piece whose bend or place changed a new number (only what changed is rebuilt), and
  the fit button fits what is chosen when something is.

**What a bend is.** A few whole numbers in the piece's kind (`kind.bend`), so in its key and its text:
for each of its points, the millimetres it is moved up and aside (to the right looking along the piece),
as the piece is designed before it is mirrored. A straight, a slope and an S bend have one point if a cell
long, two up to three cells, three beyond; a tight quarter curve one, a wide half turn three, the others
two. The spiral, the drop, the loop, the funnel, the hopper and the tray do not bend. The bend fades in
from each end over half the piece by the smoothest step (10x^3 - 15x^4 + 6x^5), whose first and second
change are naught at both its ends, times the curve of least degree that makes it pass through each
point's move (`displaced`). So the track passes through every point, a point dragged carries the track
under it, and at the joints the track is where it was, pointing as it did and curving as it did: a marble
crosses a joint of a bent piece as of a made one. Two points moved alike bow the track a little more
between them, as a rod held at both ends does. Fading in only as far as the first point instead gave a
straight of two cells 8 mm before it was too tight; over half the piece it goes 28 mm, one of three cells
72, of six 113, a wide curve 39, a slope of three cells 57, an S bend of three 76. A tight curve and a
straight of one cell are stiff (2 and 8 mm): they are too short to bend more and stay as gentle as the
box's own curves. Only + - * / are used, so a bent run is the same to the bit everywhere.

**Joined ends stay put.** Bending a piece never moves its ends: the bend changes only the path between
them, and nothing joined to it moves. Joints stay on the grid, so every joint still meets its neighbor
exactly, every rule of snapping, overlap, mirroring and undo holds unchanged, and a person can tell what
will move: the piece under the finger, and nothing else. A piece is made longer or shorter by its knob as
before, and keeps its bend where it can (`rebent`: the bend read at the new points from the old, else the
piece as made).

**Limits, and how each shows.** A bend is checked as it is made (`brokenBy`, then `fits`):

| Limit | What it is | Near it | At it |
|---|---|---|---|
| Too tight | a radius under 3.5 cm anywhere (or tighter than the piece was made) | warm from 4.5 cm | the point stops where it can still be built; the piece turns red while held there, with a low knock |
| Too steep | a slope over 55 degrees (or steeper than made, for a steep slope resized) | warm from 45 degrees | as above |
| Crossing itself | two places 10 cm apart along it within a block of each other | | as above |
| Crossing another piece | their boxes of room cross (cells alone are not enough for a bent piece) | | as above |
| Leaving the table, or the ground | a cell past the edge, or a block below level 0 | | as above |

A warm piece (warned) is warm even while chosen, with a small warm mark lying on its top where it is
nearest a limit. The ghost marble runs on the bend as it is dragged, so its marks show what the bend does
to a marble: a hump a marble cannot climb is marked where the marble stops, one it is thrown from where
it leaves. The keys refuse a press that would pass a limit, with the small shake.

**Bending in the editor.** With one piece that bends chosen, K or the strip's bend button shows its points,
small accent balls on the track, as its only handles; the arrows, ring and knob go while it is bent. A
point is taken from a fingertip and a quarter (30 pixels for a finger, 16 for the mouse), even over the
piece, which in bending is what a press near a point means; elsewhere on the piece a drag still carries
it. A point dragged moves in the plane of up and aside where the view sees both (`freedomOf`), and stays
under the pointer: measured, within 0.16 pixels by mouse and by finger. Seen from straight above it moves
only aside, from along the piece's way aside only up, decided when the drag begins. It snaps, each way on
its own, to straight, to a whole level, and to its partner's numbers alike or aside the other way (a
symmetric bow, or an S), from 8 pixels with the mouse and 12 with a finger, with a soft click; Alt, or a
second finger held down, lets it go free. Let go, it is one step of undo. A tap on a point picks it for the
keys: the arrows (or WASD, Q and E) move it 5 mm aside and up, aside as the screen sees it, comma and full
stop pick the point before and after, Delete straightens it, and Escape, Enter or K ends bending; presses
on one point are one step of undo (`replaced`). The strip's straighten button makes the piece as made. The
strip keeps out of the way while a point is dragged. Choosing anything else ends bending.

**The physics.** A run of long pieces bent gently, down, aside and both, against the same run unbent, one
marble at 240 steps a second (`table.test.ts`): the track's push near a joint 1.53 g bent against 1.18 g
unbent, near a bent piece's points 1.82 g, at most 2.0 g anywhere but the tray (a curve bent down and in),
against 1.47 g unbent; the push changing by at most 0.28 g from one step to the next, against 0.24 g. The
test holds them under 2.5 g and 0.4 g a step. A bent run gives the same race every time and in Chromium
as in Bun, to the bit (the test compares every number's bits). Two things a bend does that are true to a
real marble and not faults: a marble fast over a crest whose radius is under its speed squared over g
leaves the track for a moment and lands with a jolt (a made run does the same at the start of a turn, 4.1
g once), and a groove that wiggles aside every 12 to 16 cm makes a marble near 60 cm/s rock ever higher,
since a marble rocks across the groove about every 0.2 s, until it rides out; the ghost marks both. Banking
a bent piece more finely (every 2 or 3 cm rather than 6) did not calm the rocking, so the bank is worked
out as for made pieces.

**The text.** `v2`: a bent piece goes on with `b` and its numbers, each point up then aside
(`s3_-6_-1_17_2b0_0_-36_0`); a piece as made is written as before. Every `v1` run is read, the made runs
and kept pieces of one's own among them; undo steps kept in the browser in `v1` are read again in `v2` on
load, so they still end at the run kept.

**Finer turns** are left for later: a turn finer than a quarter would put a piece's far joint off the
grid, where it would meet nothing exactly, and bending gives the curves a run needs while keeping every
joint on the grid. The ring still turns by quarters (`turnedBy`).

**Measured**, by `scripts/browser.ts` in headless Chromium, built with `SHOW_DRAFTS=1` and served from
`.drafts-build`. One script, by mouse at 1440 by 900 and by finger at 1024 by 768 and 390 by 800: an empty
table from the runs to start from; a hopper pressed in the box and raised 19 levels by its green arrow;
ten pieces pressed in after it (long straight, steep slope, longer straight, wide curve, longer straight,
steep slope, S bend, longer straight, steep slope, tray), the ghost in the tray; five pieces bent by
dragging a point, the bend button by the strip (and K by mouse), each one buildable; a point dragged far
up, stopped by the tightness limit and held there red; by mouse, the keys: a point picked with full stop,
moved by five presses as one step of undo, straightened by Delete, put back by undo, bending ended by
Escape; the humped piece straightened by the strip; marbles streamed for six seconds, every one of 11 (by
mouse) and 12 (by finger) reaching the tray, the ghost arriving; undone all the way back to the run the
page began with (20 or 21 steps, by Control and Z, or by the bar's button by finger) and redone all the
way forward, the text the same to the character; three pieces from the first bent one chosen (Shift and
clicks, or the select tool and taps), copied and pasted at the open end by the strip and the bar, bends
and all, and mirrored (F, or the strip), still bent; the page loaded again and the run found as it was, to
the character, undo carrying on; and the made `v1` run with every kind of piece opened, written as `v2`,
its ghost in the tray. No error on the page in any of the three.

With 100 marbles on the twenty piece run (most heaped in the tray, the stream still going) and its long
straight bent by the mouse back and forth for four seconds: the physics 1.2 ms a frame, the ghost 2.3 ms,
handing the drawing over 0.3 ms, everything the scene does in a frame 3.2 ms on average and 4.9 at most;
a move of a point, everything it does (the shape, the limits, the table, the drawing), 1.3 ms on average
and 6.6 at most, when it searches for where a limit stops it. Before this stage's change the ghost worked
its larger budget while a point was dragged, and a frame took 6.5 ms. Headless Chromium draws in software
at about ten frames a second whatever the scene does, and the driver's moves came about ten a second, so
the drawing's own time on a graphics card, and how a drag feels at a real screen's rate, were not
measured.

**Choices to confirm.**

- Ends always stay put; nothing joined to a bent piece moves, and there is no pinning to choose.
- Which pieces bend (straights, curves, slopes, S bends) and how many points each has; short pieces are
  stiff.
- The limits: a radius of 3.5 cm, 55 degrees, warned from 4.5 cm and 45 degrees.
- Bending as a mode (K, or the strip's button) in which the points are the only handles, rather than
  points shown beside the arrows and ring.
- Points taken over the piece itself while bending; a tap on a point picks it for the keys.
- What a point snaps to (straight, whole levels, its partner alike or against) and that Alt or a second
  finger lets it go free.
- The run changes as a point is dragged, so marbles roll on the bend as it is made.
- The handles standing off from a small selection, and a press on a chosen piece always carrying it.
- No finer turns than quarters for now.

**What the next stages can rely on, and should know** (moving parts and sound, then the look of wood and
glass).

- A piece's shape is `shapeOf(kind)`, bend and all; its path is `pathOf(length)`, a Mote `Path` (bent ones
  are the run's own `displaced`, which Mote takes like any other). `pointsIn` gives a piece's points in the
  world and `strainOf` how hard it is bent and where.
- A bent piece is drawn as a block along its path every 0.7 cm, like a made curve; a straight bent is no
  longer drawn as one long box. Wood grain should follow the path's frame (`sweep(...).frame(t)`), which
  carries the bank, so that it bends with the piece.
- While a point is dragged a new shape and a new mesh are made at every millimetre and sent to the
  graphics card; shapes are kept up to 3,000 and drawings up to 400, the oldest let go. A look that costs
  more to make per piece should be made once the drag ends, or more cheaply while it goes.
- The warning is shown by mixing colors (warm, red when held at a limit) and a flat mark; with wood and
  glass it wants a way of its own that still reads on wood.
- Shapes and strains are cached by key, and a kind whose bend is all naught has no `bend` at all
  (`withBend`), so the same piece always has one key.

## Open

- Its name.
- Two fingers on a real tablet: whether pan, pinch and twist together feel right, and whether a finger
  should turn a piece being carried.
- Whether a touch on a piece should choose it or carry it at once; for now a press chooses and a drag carries.
- How dragging a point feels at a real screen's rate and under a real finger (measured only in headless
  Chromium, about ten moves a second).
- Whether the ends of a bent piece should ever move, carrying what is joined to it (stage 4 keeps them on
  the grid always), and whether turns finer than quarters are wanted at all.
- Whether marbles can be of different sizes and weights.
- How large a run may be before the page slows, and what is said then.
- Whether a run can be exported for printing in three dimensions.
- Whether there are goals (get a marble into the tray using only these pieces) as well as free building.
