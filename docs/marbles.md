# A marble run

A mini: build a marble run in three dimensions and watch marbles go down it. A plan dated 13 November
2026. Stage 1, what Mote needed, was built on 14 November 2026 (below); nothing of the mini itself is.

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
   from fixed pieces.
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

## Open

- Its name.
- Whether marbles can be of different sizes and weights.
- How large a run may be before the page slows, and what is said then.
- Whether a run can be exported for printing in three dimensions.
- Whether there are goals (get a marble into the tray using only these pieces) as well as free building.
