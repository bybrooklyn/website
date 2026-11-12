# walker

The engine of the walking mini: a creature, seen from the side, that learns to walk. It is written
in Rust and built into a plain WebAssembly module, `public/wasm/walker.wasm`, with no bindings
generator and no imports. The page calls functions that take and return numbers, and reads lists
straight out of the module's memory.

- `src/physics/`: a small 2D rigid body engine. Circles, capsules and boxes; ground made of
  straight pieces, so it can be flat, hilly, stepped or have gaps; hinges with limits and motors;
  gravity, friction and bounce. Fixed steps of 1/60 s, four substeps each, solved with Box2D 3's
  soft step and warm starting. The same start always gives the same end, to the bit, natively and
  in every browser, because the module brings its own sine, square root and the rest.
- `src/body.rs`: the creature, built from a number of legs (1, 2 or 4), each with a hip, a knee and
  a foot, on a rounded body.
- `src/brain.rs`: a network of one to four hidden layers with a little memory, its weights one flat
  list of f32.
- `src/gait.rs`: how natural a run looks, in numbers, for the tests.
- `src/learn.rs`: the goals a walker can be rewarded for, the judge that scores a run step by step,
  and evolution with a seeded random generator, run in slices.
- `src/show.rs`: one brain running in real time, and a whole generation at once.
- `src/api.rs`: the functions the page calls, listed below.

## Building and testing

```sh
bun run wasm          # builds the module, copies it to public/wasm/walker.wasm, checks its size
cargo test            # in walker/: the physics, the body, the brain and the learning
bun test src/minis/walker.test.ts   # the built module, from the page's side
```

`bun run wasm` builds the module twice, optimised for speed: with WebAssembly SIMD as
`walker.wasm`, and without it as `walker-scalar.wasm`, for a browser too old for SIMD (Safari
before 16.4). The page checks which one the browser can run when it loads. The two give the same
numbers to the bit. It fails if either is over 512 KiB, or if the physics built alone
(`cargo build --no-default-features`) is over 80 KiB. The built modules are committed, so the site
builds without Rust.

`cargo run --release --example speed` says how fast training goes natively for each number of legs
and each size of brain, and how a run's time divides between the physics, the brain and the rest.

## Reading from memory

Functions that return a list return a pointer, the byte offset of its first f32 in the module's
memory, and another function gives its length. Read it with
`new Float32Array(exports.memory.buffer, pointer, length)`. Memory can grow during any call, which
replaces `memory.buffer`, so make the view again after each call rather than keeping one. A pointer
is good until the next call that changes the same thing. Before `create`, functions return 0, a
null pointer, or minus infinity.

There is one walker per module instance. Two walkers need two instances.

## The walker's functions

All numbers are metres, kilograms, seconds and radians, with y up and angles anticlockwise.

### Making it

- `create(legs: u32, population: u32, seconds: f32, seed: u32, hidden: u32, layers: u32, memory: u32, goal: u32, length: f32) -> u32`
  Makes a new walker on flat ground, replacing any before it. `legs` is 1, 2 or 4. `population` is
  the number of brains in a generation (2 to 1000; 32 is a good choice). `seconds` is how long each
  brain is run when training (the goal's own time if 0 or less, at most 120). `seed` starts the
  random numbers; the same seed learns the same way. `hidden` is the neurons in each hidden layer
  (2 to 64), `layers` the number of hidden layers (1 to 4), and `memory` how many values the brain
  keeps from one step to the next (0 to 16). `goal` is what it is rewarded for:
  0 go far, 1 go fast, 2 stand tall, 3 jump, 4 the obstacle course, 5 carry (see Goals). `length`
  is how far a run goes, in metres (see Run length); 0 or less means runs of the goal's own time in
  training and an endless walk on screen. Returns the number of weights in one brain,
  or 0 if `legs` is not 1, 2 or 4.
- `run_seconds() -> f32` How long a run of the goal's own time lasts: 4 s for going fast, 20 s on the
  course, 10 s for the others.

### Run length

A run of a set length ends when the body has gone that far, earning 1 for each second it had to
spare, or when it has had as long as a pace of 0.4 m/s allows (and no less than the goal's own
time). Its distance counts no further than its length. With no set length, training scores runs
of the goal's own time, but never less than ten seconds, and the walk on screen is endless: it is the same run for those first
seconds, then goes on with the same brain while the walker stays up. So training still compares
brains on runs of one length, and what is seen is where the best of them goes after that.
- `ground_room(pieces: u32) -> *mut f32`
  Room for `pieces` pieces of ground, four f32 each: x1, y1, x2, y2. Write them there, then call
  `ground_set`. The pieces may come in any order and need not join, so gaps are allowed. The
  creature starts at x = 0, its feet on the highest ground there.
- `ground_set(pieces: u32) -> u32`
  Puts the walker on the ground written into `ground_room`. Ground is solid for a metre below each
  piece, so a foot cannot go through it; a piece straight up and down is solid on its right going
  from its first end to its second (bottom to top for a step up). Training carries on, but the current
  generation is run again and the best brain is scored again, on the new ground. The show starts
  again, and so does the crowd if it is running. With 0 pieces the ground is flat again. Returns 1.

### Training

- `train(runs: u32) -> u32`
  Runs up to `runs` brains, each for `seconds` from the same start, and returns the number of
  generations finished. When a generation is finished the next is bred at once. The runs of one
  call go four at a time, side by side, which changes nothing about any of them but lets the
  processor work on several at once; so ask for at least four. One run of 10 s takes about 1 ms.
- `generation() -> u32` The number of generations finished.
- `generation_runs() -> u32` How many brains of the current generation have been scored.
- `best_score() -> f32` The best score so far, minus infinity before the first generation ends.
- `best_distance() -> f32` How far the best brain so far took the torso in its run, in metres.
- `population_length() -> u32` The number of brains in a generation.
- `population_weights() -> *const f32` Every brain of the current generation, one after another,
  `population_length` times `weights_length` f32. A page training in a worker sends these to its own
  module for the crowd.
- `history_length() -> u32` The number of finished generations.
- `history_best() -> *const f32` The best score of each finished generation, `history_length` f32.
- `history_mean() -> *const f32` The average score of each, `history_length` f32.

### Training on several threads

A generation's runs share nothing but their start, so they can be run anywhere, by any number of
helpers, so long as one walker breeds. The page's workers do this: one leads, and hands out shares
of each generation to the others, each its own module made with the same `create` and ground. What
is learned is the same, to the bit, however many helpers there are and whatever order their answers
come in.

- `evaluate_room(count: u32) -> *mut f32` Room for `count` brains, one after another.
- `evaluate(count: u32) -> u32` Runs the brains written there from the start, as training runs
  them, and returns how many it ran. It changes nothing in this walker's own training.
- `evaluated() -> *const f32` Two f32 for each brain the last `evaluate` ran: its score, then how
  far it went.
- `member_scored(index: u32) -> u32` 1 if that member of the current generation has its score (the
  best few carried over have theirs already), else 0.
- `record(index: u32, score: f32, distance: f32) -> u32` Gives a member of the current generation
  the score and distance a helper found for it. Once every member has one, the next generation is
  bred, as `train` would. Returns the number of generations finished.

### Many walkers for a learner that chooses actions

For a learner other than evolution, one that picks each walker's actions step by step and learns
from rewards. Nothing on the page uses these yet. In Rust, `Envs` in `src/envs.rs` does the same
with a policy called between steps, thousands of steps a call.

- `envs_create(count: u32) -> u32` Makes `count` walkers (up to 4096), set up as this walker's
  training is, each at the start. Returns how many.
- `envs_actions() -> *mut f32` Room for each walker's actions, `outputs_length` f32 each, -1 to 1:
  what a brain's outputs would be.
- `envs_step(steps: u32) -> u32` Steps every walker `steps` times by those actions, all in
  lockstep, and returns the steps taken by all of them together.
- `envs_observations() -> *const f32`, `envs_rewards() -> *const f32`, `envs_done() -> *const f32`
  After a step: what each walker senses (`senses_length` f32 each, as `show_senses`), the reward it
  earned in the last step (the change in the score training gives, so a run's rewards add up to its
  score), and 1 for each whose run ended in it, else 0. A run that ends starts again at once.

A run here is the very run training would give the same actions, to the bit.

### Goals

The body is down when it touches the ground, is tipped past sixty degrees, or is held lower than a
third of the height it stood at. Every score is less 1 for each second down, 1 for each second of
each knee on the ground, and 0.0002 for each joule of work the motors did. A run ends once the body
has been down for a second, and a run that ends that way costs 3 more, so a walker learns to stay
up before it learns to go.

How it moves counts as well, for every goal, so that what it learns looks like walking. While it is
going forward (in full from 0.6 m/s, in part below), each second with the body carried upright (a
lean under 0.35 radians) and high (over 0.7 of its standing height) earns 0.5, and each second with
its feet taking turns earns 0.4: for two legs exactly one foot down, for four one diagonal pair
down and the other up, for one leg its foot down in the second half of each stride and up in the
first. Each second of a foot sliding along the ground faster than 0.3 m/s costs 0.5, and each
change in the brain's outputs from one step to the next costs 0.002 for its size, for every goal,
a jumper's too, so the legs swing rather than twitch. Then, by goal:

- **Go far** (0): the distance the body went forward in 10 s, plus 0.25 for each second on its feet
  and 0.5 for each second in the air going forward (which is how a one-legged walker gets anywhere).
- **Go fast** (1): the same, in 4 s.
- **Stand tall** (2): the distance times a number from 0.2 to 1 for how tall the body was held on
  average, plus 2 times that number, plus 0.5 for each second in the air going forward. Tall is as
  high above the ground as the body stood at the start, and upright; half that height or lower
  counts as nothing.
- **Jump** (3): one and a half times the distance, plus each second spent with nothing touching
  anything while going forward faster than 0.5 m/s. A foot put down in a gap (touching, with no
  ground under it) costs 1 and ends the run; stopping (under 0.2 m in four seconds) costs 2 and ends
  it too, so waiting at the edge of a gap is worse than trying. The manner of moving does not count
  for a jumper, since a leap is neither smooth nor upright. A jumper with two or four legs has one
  more output, which quickens or slows its rhythm from half to one and a half times its pace, so a
  stride can be timed to land beyond a gap, and its joints may swing 1.6 times as far.
- **The course** (4): as going far, over 20 s, on the obstacle course the page lays: level ground,
  then hills, steps and gaps, each stretch and each lap harder.
- **Carry** (5): the walker has a parcel (a small box, 0.6 kg) on a back with a rim at each end. The
  distance, plus 0.25 for each second on its feet; the parcel falling below the middle of the body
  or more than 0.3 m past either end is dropping it, which ends the run and costs 3. Two more senses
  say where the parcel is.

How a generation is made: the best 4 go on unchanged (and are not run again). Each of the others
has a parent, the best of three picked at random, and half the time a second parent the same way,
taking each weight from either at random. Each weight then has a one in ten chance of a nudge of
about 0.3.

### Sharing a brain

- `weights_length() -> u32` The number of weights in one brain.
- `best_weights() -> *const f32` The best brain so far, `weights_length` f32. Encode these into a
  link to share a walker.
- `weights_room() -> *mut f32` Room for `weights_length` f32, to write a shared brain into.
- `weights_load() -> u32` Takes in the brain in `weights_room`: it becomes the best so far (and is
  scored), joins the population, and the show starts again with it. Returns 1, or 0 if any weight is
  not a finite number. A brain only fits a walker with the same number of legs.

The weights are, in order, layer by layer from the inputs to the outputs: for each neuron of the
layer its weight for everything coming into it, then that layer's biases. The inputs are the senses
and then the memory; the outputs are the legs' and then the memory's. Memory is fed back in on the
next step and starts at zero at the start of every run, so a run played again is the same run.

A first brain's weights are drawn at random, each layer's no larger than the square root of one
over what comes in to each neuron, so that a wide layer starts near the middle of tanh rather than
pinned at its ends; biases start at up to 0.1, and the weights that make memory at half size, so
memory fed back in does not grow on itself. An output may change by at most 0.17 a step (a full
swing in a fifth of a second), as a muscle can only tighten so fast; this is in the brain, so
training sees it too.

The page offers three sizes by name: small (8 neurons, 1 layer, no memory), medium (16, 2 layers,
4 memories) and large (32, 3 layers, 8 memories). A step of a two-legged walker with a medium
brain takes about 2 microseconds natively, a four-legged one about 3.5, and a brain of four layers
of 64 about doubles that. A large brain has more to learn and gets there slower.

### The show: one walker in real time

- `show_reset()` Starts the show from the start with the best brain so far, or a random one before
  the first generation is finished. The show starts from the same world as training and is judged
  the same way, so, unless it is pushed, it plays the very run the brain was scored on and ends
  where that run ended: its distance and score at the end are the brain's, to the bit.
- `show_over() -> u32` 1 once the run has ended, after which the show stands still until reset. An
  endless show ends only in a fall.
- `show_endless() -> u32` 1 if the show is endless.
- `show_ground_extend(pieces: u32)` Lays `pieces` more pieces of ground, written into
  `ground_room` in metres from the walk's start, ahead of an endless show. Ground more than 40 m
  behind the walker is dropped.
- `show_origin() -> f64` How far an endless show's world has been moved back: whenever the walker
  passes 512 m, everything moves back 512 m, a power of two, so positions there lose nothing, and
  an f32 stays fine however far it walks. Add this to a body's x for where it is from the start.
- `weights_swap() -> u32` Takes in the brain in `weights_room` as `weights_load` does, but an
  endless show goes on: the new brain takes over at the start of the walker's next stride.
- `legs_length() -> u32` and `show_load() -> i32` The number of legs, and the number of the body
  that is the parcel, or -1.
- `show_score() -> f32` The run's score so far.
- `show_step(seconds: f32) -> u32` Moves on by `seconds` in whole steps of 1/60 s, the brain
  deciding before each, and keeps the remainder for next time. Returns the steps taken, at most 8.
- `show_seconds() -> f32` How long the show has been running.
- `show_fallen() -> u32` 1 if the show's walker has its torso on the ground, else 0.
- `show_push(x: f32, y: f32, impulse_x: f32, impulse_y: f32) -> i32` Pushes the body nearest the
  point (x, y), at that point, with an impulse in newton seconds (the walker weighs about 10 kg, so
  20 is a firm shove). Returns the body's number.
- `body_count() -> u32` The number of bodies: the torso first, then each leg's upper and lower part.
  5 for two legs, 9 for four.
- `show_bodies() -> *const f32` Six f32 for each body: x, y, angle, kind (0 circle, 1 capsule,
  2 box), and two sizes: a circle's radius and 0, a capsule's half length (without its round ends)
  and radius, a box's half width and half height. A capsule lies along its own x axis.
- `show_distance() -> f32` How far the torso has gone forward since the start.
- `senses_length() -> u32`, `hidden_length() -> u32`, `layers_length() -> u32`, `outputs_length() -> u32`,
  `memory_length() -> u32` The number of senses, of neurons in each hidden layer, of hidden layers,
  of outputs, and of memories.
- `show_memory() -> *const f32` What the show's brain is keeping for its next step.
- `show_senses() -> *const f32` What the walker sensed before its last step, in this order:
  - the body's angle, in radians, 0 upright;
  - its spin times 0.2;
  - its height above the ground under it, 0 to 2 (2 over a gap);
  - its speed forward and its speed up, each times 0.25;
  - for each joint, hip then knee, leg by leg: its angle and its speed times 0.1;
  - for each foot, 1 if it is on the ground, else 0;
  - how much higher the ground is 0.6 m ahead, and 1.2 m ahead, than under the body, from -1 to 1,
    and -1 over a gap: what a jumper needs to see a step or a gap coming;
  - the sine and cosine of the rhythm the legs keep (see `show_outputs`);
  - carrying, where the parcel is from the middle of the back, along it and above it, in the body's
    own frame, each by the body's size.
- `show_hidden() -> *const f32` What each hidden neuron gave, -1 to 1, layer after layer.
- `show_outputs() -> *const f32` What each output gave, -1 to 1, three for each joint. The legs keep
  a rhythm: 1.8 strides a second for one leg, 1.2 for two (taking turns, half a stride apart), 1.6
  for four (a trot, each diagonal pair together). Each joint swings like a pendulum in time with
  it, and its three outputs shape the swing: where it is centred, how wide it is, and how far it is
  shifted in the stride. A hip swings about 0.1 radians in front of straight down, its centre moved
  up to 0.6 either way and its swing up to 0.6 to each side; a knee swings about a bend of 0.6, its
  centre moved up to 0.5 and its swing up to 0.6. So the legs move in strides whatever the brain does, and
  evolution shapes the strides rather than inventing them. Each target is kept within the joint's
  limits: a hip from -1.0 (back) to 1.3 (forward), a knee from -2.0 (bent back) to 0 (straight).

  One leg hops instead, as a pogo stick is ridden. In the air the leg folds and the foot goes
  ahead of the body by 0.12 s of its speed, plus more or less as it is faster or slower than it
  wants to be; on the ground the leg gives while the body comes down, then straightens hard, while
  the hip, held only lightly so the push does not spin the body, turns the body back toward
  upright. Its six outputs set the speed it wants (0.3 to 1.5 m/s), how much the foot placement
  answers to speed, a trim to where the foot goes, how far the leg straightens and folds, and how
  firmly the body is turned upright. Its leg is light, its hip at the middle of its body, and its
  body six times as hard to tip as a plain block of its size, as a rider holding a pogo stick's bar
  wide is, so it can be balanced at all.
- `show_weights() -> *const f32` The weights the show runs on, to draw the brain's connections.

### One walker, live

- `live_begin() -> u32` Starts learning one walker at a time, with no generations in the
  background: the show is each attempt. It climbs: each attempt is the best so far with about a
  third of its weights nudged, kept only if it scores better, by the same score a generation uses.
  The nudges start at 0.3, grow by half after a success and shrink by a tenth after a failure, so
  that about one attempt in five does better. The first attempt is a calm brain, every weight zero
  but the output biases, which hold the legs at a built-in stride that walks with no feedback (for
  four legs the average outputs of a long run's best walker, for two the best of four thousand
  strides tried at random), so it steps from the start. An attempt that goes under 0.2 m in four
  seconds is over. Natively, from a fixed seed, two legs go 8.4 m on the first attempt and 8.7 m by
  the sixtieth; four legs 7.3 m, then 12.4 m.
- `live_step(seconds: f32) -> u32` Moves the attempt on. When it ends (a fall, a stop, or the end of
  its run) it is kept or not, and the next attempt starts at once. Returns the attempt's number.
- `live_attempt() -> u32`, `live_best_score() -> f32`, `live_best_distance() -> f32`,
  `live_best_weights() -> *const f32` The attempt now walking, the best score so far and its weights,
  and the furthest a kept attempt has gone, which never goes down.
- `live_stop()` Goes back to a generation at a time.

### The crowd: a whole generation at once

- `crowd_reset() -> u32` Starts every brain of the current generation walking from the start, each
  in a world of its own. Returns how many walkers there are.
- `crowd_room(count: u32) -> *mut f32` Room for `count` brains, one after another, to start the crowd
  with a generation from elsewhere (a worker).
- `crowd_start(count: u32) -> u32` Starts the crowd with the brains written into `crowd_room`.
- `crowd_step(seconds: f32) -> u32` Moves them all on, as `show_step` does.
- `crowd_bodies() -> *const f32` Four f32 for each walker: how far it has gone, the height of its
  body, its body's angle, and 1 once its run has ended (else 0). Each is judged as in training and
  stops where its run stopped.
- `crowd_stop()` Stops the crowd and frees its worlds.

## The physics alone

Built with `cargo build --release --target wasm32-unknown-unknown --no-default-features`, the module
holds only the physics, with these functions instead (about 36 KiB):

- `physics_reset(gravity_x: f32, gravity_y: f32)` Empties the world and sets its gravity.
- `physics_body(kind: u32, a: f32, b: f32, x: f32, y: f32, angle: f32, density: f32, friction: f32, restitution: f32, group: u32) -> u32`
  Adds a body and returns its number. `kind` and the sizes `a` and `b` are as in `show_bodies`.
  Density is in kilograms a square metre; 0 makes a body that never moves. Bodies of the same
  `group`, other than 0, pass through each other.
- `physics_segment(x1: f32, y1: f32, x2: f32, y2: f32)` Adds a piece of ground.
- `physics_joint(a: u32, b: u32, x: f32, y: f32, lower: f32, upper: f32) -> u32` Joins two bodies
  with a hinge at (x, y), keeping its angle between `lower` and `upper` unless `lower` is greater.
  Returns its number. Joined bodies do not collide.
- `physics_motor(joint: u32, speed: f32, torque: f32)` Turns the hinge at `speed` with at most
  `torque` newton metres; 0 torque is no motor.
- `physics_joint_angle(joint: u32) -> f32` The hinge's angle from where it started.
- `physics_push(body: u32, x: f32, y: f32, impulse_x: f32, impulse_y: f32)` A sudden push at a
  point.
- `physics_step(seconds: f32) -> u32` Moves on in whole steps of 1/60 s; returns the steps taken.
- `physics_body_count() -> u32` and `physics_bodies() -> *const f32` Six f32 for each body, as in
  `show_bodies`.

## The generalist

A second mini on the same engine: a creature that sees, learns and gets about a generated world by
itself. It is in `src/generalist/`, behind the `generalist` feature, and is built into a module of its
own, `public/wasm/generalist.wasm`, so the Walker's module holds none of it. The physics, the body,
the brain and evolution are shared. `cargo test` runs both; `tests/unchanged.rs` holds the Walker to
learning exactly as it did before the generalist was added, to the bit.

### A world

A world is described two ways, one made from the other.

A **recipe** is six numbers: a seed (a whole number; the page turns a word into one), a difficulty
from 0 to 1, and an amount from 0 (switched off) to 1 of each of four kinds of thing: ground
(platforms, ledges, drops, stairs, gaps and slopes), hazards (water and spikes), things to push
(loose boxes), and things that move (moving platforms and see-saws). A link carries a recipe.

A recipe is planned into a list of **pieces**, laid one after another along the way from the start,
as far as anyone goes. Each piece is four numbers: its kind, two sizes, and the level ground after it
before the next, in metres. A teacher that changes worlds changes these, and a world can be given as
its pieces instead of a recipe (then the way is level after the last). The kinds, and what their two
sizes `a` and `b` are:

| kind | number | a | b |
|------|--------|---|---|
| level ground | 0 | length | |
| slope | 1 | length | rise (less than 0 goes down) |
| gap, no bottom | 2 | width | how much higher the far side is |
| stairs | 3 | how many steps | rise of each (less than 0 goes down); each 0.8 m long |
| ledge | 4 | height | |
| drop | 5 | depth | |
| floating platforms | 6 | gap between them, and from each side | height of their tops above the near side |
| water | 7 | width | |
| spikes | 8 | width | |
| loose box | 9 | half its size | |
| ledge with a box before it | 10 | height | the box's half size |
| moving platform over a gap | 11 | the gap's width | its top speed, m/s |
| see-saw | 12 | the plank's half length | the pivot's height |

The creature starts at x = 0 on level ground from 12 m behind it to 4 m ahead. Gaps go 2 m down
and then there is nothing: falling in ends a run, as touching a hazard does. Floating platforms
are 1 m wide and come in twos. A moving platform is 1.2 m wide, starts at the left of its gap, and
eases across and back. A see-saw's left end starts on the ground.

Planning picks each piece's kind by the amounts, weighed against a fixed 0.3 for a stretch of level
ground, so with everything at 1 about three pieces in four are something; then a piece of that kind
evenly, at 60 to 100 percent of the hardest the table allows. Ups and downs lean back toward the
start's height. Only plus, times and a seeded random generator are used, so the same recipe makes
the same world to the bit, natively and in every browser, however far at a time it is made.

### What difficulty means

The hardest each piece can be, at difficulty d, is a straight line between its value at 0 and at 1:

| | d = 0 | d = 1 |
|---|---|---|
| widest gap | 0.2 m | 0.6 m |
| far side of a gap higher or lower by | 0 | 0.08 m |
| tallest stair step | 0.04 m | 0.12 m |
| most stair steps | 2 | 6 |
| highest ledge | 0.08 m | 0.2 m |
| highest ledge with a box | 0.25 m | 0.38 m |
| deepest drop | 0.3 m | 1.2 m |
| steepest slope, rise over run | 0.08 | 0.4 |
| gap between floating platforms | 0.25 m | 0.55 m |
| floating platforms above the ground | 0.03 m | 0.12 m |
| widest water | 0.25 m | 0.6 m |
| widest spikes | 0.2 m | 0.55 m |
| widest gap a moving platform crosses | 2 m | 4.5 m |
| its top speed | 0.4 m/s | 1 m/s |
| highest see-saw pivot | 0.12 m | 0.35 m |
| level ground after each piece | 4 m | 1.6 m |

So, with everything switched on, there are 1.6 things in every 10 m at difficulty 0 and 2.5 at
difficulty 1. The tests measure each of these over many worlds.

### Every world can be crossed

Before a piece is laid it is checked (`src/generalist/check.rs`): the world is seen as surfaces to
stand on (ground not steeper than 0.7, platform tops, a loose box's top anywhere it can be pushed
along level ground, a moving platform anywhere along its way, a see-saw tipped either way, with
hazards cut out), and one surface can be reached from another if a jump of the creature's reach gets
from the nearest point of one to the nearest point of the other. That reach is a step of 0.12 m, a
climb of 0.22 m and a leap of 0.7 m over level ground, a little under what the body was measured to
do (below); a jump that lands `rise` higher goes `leap / 2 * (1 + sqrt(1 - rise / climb))`, as a
thrown stone does. A piece that cannot be crossed is made easier by a fifth, again and again, and
given up for level ground if it never can be. The tests lay 4,400 worlds of 150 m across every
difficulty and check each whole: every one can be crossed. The table keeps within the reach, so no
planned piece has needed making easier; the checker is there for pieces given whole, by a link or a
teacher.

### The body

The Walker's two- and four-legged creatures, their rounded bodies, eyes and feet as they were, with
a hop (`src/generalist/body.rs`). Its brain gives the Walker's three numbers for each joint, which
shape each joint's swing to the legs' rhythm, and one more, the hop. When that goes above a half with
a foot down, the creature crouches (slowly enough that its feet stay down), then springs: every knee
straightens at once, 2.2 times as strong and nearly three times as quick as walking allows, while each
hip keeps the line from hip to foot where it should be and follows the knee as it moves, so the push
goes through the body rather than turning it. The spring ends when the feet leave the ground; in the
air the legs are held ready to land; after landing it waits half a second before it can hop again.

A hop kicked every body tried head over heels until it was made hard to tip. So the two-legged one
holds short arms out wide, as someone on a tightrope does: they are stiff, so they are counted in its
body, which is ten times as hard to tip as a plain block of its size; the page draws them. The
four-legged one carries its weight spread along its back, three times as hard to tip. How each holds
its legs in a hop was found by trying 540 ways and keeping the steadiest that went forward
(`cargo test --release find_how -- --ignored --nocapture`).

Measured with its legs held to the Walker's built-in stride, or standing, and one hop at the best
moment: two legs hop up a ledge of 0.48 m and over a gap of 0.86 m from standing (its stride no longer
walks with its arms out, so it gets up steps by hopping); four legs walk up 0.24 m and hop over 0.76 m
from a walk. The checker's reach is a little under the lesser of each, and the tests hold both bodies
to doing at least that much.

### What it senses

Rays first, a picture later. Sixteen rays from its eye (at the front of its body, a little above the
middle), held level with the world whatever the body does, as an animal holds its head steady. Eleven
look down ahead, aimed to land every 0.35 m from 0.3 m to 3.8 m in front of an eye a metre up, so a
gap or a pool as narrow as the narrowest falls between two of them by the time it is a hop away; five
look level and up at 15, 35, 60 and 90 degrees, for walls, ledges, boxes and platforms overhead. Each
sees 6 m. A ray is cast through the physics (`World::cast` in `src/physics/cast.rs`): the ground and
the blocks are sorted by where they start, so a binary search finds the few the ray can cross;
bodies are passed over unless the ray crosses their box. Hazards, which are not solid, are found
along the ray as far as it got. A creature in a busy world sees about 930,000 times a second
natively, sixteen rays each, on one core (where casting past everything in its stretch of world would
allow 535,000), and a test holds the quick cast to the slow one's answer, to the bit, over 40,000
rays.

The senses, in the order the brain takes them:

| | numbers | what |
|---|---|---|
| rays | 16 times 6 | for each ray, from straight down ahead turning up: how near what it meets is (1 touching, 0 nothing within 6 m), then 1 or 0 for whether it is the edge of a drop (ground or a platform within 0.3 m of where it ends over a gap or something more than 0.12 m lower), a box, a hazard, a moving thing (a moving platform or a see-saw), food (always 0 for now). Ground is what is near with none of these. |
| body | 4 | its angle (0 upright), its spin times 0.2, its speed forward and up, each times 0.25 |
| joints | 2 for each | hip then knee, leg by leg: the angle, and the speed times 0.1 |
| feet | 1 for each | 1 if on something, else 0 |
| rhythm | 2 | the sine and cosine of the legs' rhythm |
| hop | 2 | 1 while it hops, else 0; 1 when it can hop, else 0 |

So two legs sense 96 + 18 = 114 numbers and four legs 96 + 28 = 124.

`eyes::picture` makes, from the same world, the picture the creature would see instead: a strip of
greyscale pixels from 80 degrees down to 60 degrees up, each lit by what its ray meets (a hazard
brightest, then a box, a moving thing, ground, an edge) and dimmer the further off. It is tested and
not yet given to any brain; it is where the picture experiment will start.

### What the physics gained for it

Only what the world needs, none of it used by the Walker, which learns to the same bit as before:

- **Static blocks** (`World::add_blocks`): boxes that never move, solid on top, sides and underside,
  for floating platforms. They are kept sorted with the ground, found the same way, and dropped
  behind and moved back with it.
- **Bodies that move by themselves** (`Body::kinematic`): moved by the velocity they are given and
  by nothing else, so a moving platform carries what stands on it by friction and is not pushed
  back.
- **Taking a body out** (`World::remove_body`): the joints and contacts that name later bodies are
  told their new places, so taking out a box far behind changes nothing else, to the bit.
- Loose boxes and see-saws needed nothing new: boxes, hinges and limits were there. Hazards are not
  physics: a run ends when any part of the creature's box overlaps one.

`generalist::stage` keeps a world around one creature: the land laid 50 m ahead a stretch at a time
and dropped 40 m behind, boxes, moving platforms and see-saws made 14 m before the creature reaches
them and taken out 16 m after, moving platforms driven along their ways, and everything moved back
by 512 m whenever the creature passes 512 m, as the Walker's endless walk does. Three boxes stacked
on a block or on the ground stand still to the millimetre for ten seconds (four on a narrow support
creep about 3 mm in that time), and a creature holding its pose on a platform going to and fro
moves less than 3 cm on it.

Many Walkers stepped together (`Envs`, 64 at once, one core) ran 750,000 steps a second for two legs
and 415,000 for four before these were added, and 790,000 and 430,000 after: no slower.

## Credit

The soft step solver and the way contacts are found follow Erin Catto's Box2D 3 (MIT), rewritten
here in a much smaller form. The sine and cosine polynomials are musl's.
