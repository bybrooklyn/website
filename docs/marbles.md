# A marble run

A mini: build a marble run in three dimensions and watch marbles go down it. A plan dated 13 November
2026. Nothing is built.

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
   a ball rolling down a slope and round a loop.
2. Pieces and snapping: the box, joints, placing by drag, supports, and marbles rolling down a run built
   from fixed pieces.
3. The editor: camera, handles, selection, undo, copy and groups, touch throughout, building while it
   runs with the ghost marble.
4. Bending, with its limits and warnings.
5. Moving parts and sound.
6. The look: wood, glass, shadows.
7. Cameras, races, sharing, and the runs to start from.

## Open

- Its name.
- Whether marbles can be of different sizes and weights.
- How large a run may be before the page slows, and what is said then.
- Whether a run can be exported for printing in three dimensions.
- Whether there are goals (get a marble into the tray using only these pieces) as well as free building.
