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
- `src/envs.rs`: many walkers stepped together, for a learner that chooses their actions.
- `src/math.rs`: the module's own sine, square root, logarithm and the rest, the same on every machine.
- `src/memory.rs`: the module's own memory allocator, in the browser.
- `src/api.rs`: the functions the page calls, listed below.

## Building and testing

```sh
bun run wasm          # builds the module, copies it to public/wasm/walker.wasm, checks its size
cargo test            # in walker/: the physics, the body, the brain and the learning
bun test src/minis/walker.test.ts   # the built module, from the page's side
```

`bun run wasm` builds the Walker's module twice, optimised for speed: with WebAssembly SIMD as
`walker.wasm`, and without it as `walker-scalar.wasm`, for a browser too old for SIMD (Safari
before 16.4). The page checks which one the browser can run when it loads. The two give the same
numbers to the bit. It builds the generalist's the same two ways, and the physics alone once, only
to measure it. It fails if any module is over 512 KiB, or if the physics built alone
(`cargo build --no-default-features`) is over 80 KiB. The built modules are committed, so the site
builds without Rust. `cargo test` passes with any of those feature sets: none, `--features walker`
or `--features generalist` (each with `--no-default-features`), and both, the default.

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

A few functions are used today only by the module's own test from the page's side
(`src/minis/walker.test.ts`), which checks through them that the built module behaves as the
native one: `history_length`, `history_best`, `history_mean`, `run_seconds`, `show_score`,
`show_seconds`, `show_fallen`, `live_attempt`, `live_best_score`, `live_stop` and `crowd_stop`,
as well as the `envs_` functions below.

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
- `run_seconds() -> f32` How long a training run lasts: `seconds` if it was given, else the goal's
  own time, 4 s for going fast, 20 s on the course and 10 s for the others, but never less than 10 s
  with no set length. A run of a set length may have longer (see Run length).

### Run length

A run of a set length ends when the body has gone that far, earning 1 for each second it had to
spare, or when it has had as long as a pace of 0.4 m/s allows (and no less than the goal's own
time), but never more than 120 s: a run of 50 m has 120 s rather than 125, and one of 100 m
120 s rather than 250, so a walker slower than 0.83 m/s does not finish it. Its distance counts no further than its length. With no set length, training scores runs
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
a jumper's too, so the legs swing rather than twitch. (Only the first 24 outputs are counted, which
leaves out one: the rhythm output of a jumper with four legs.) Then, by goal:

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
- `body_count() -> u32` The number of bodies: the torso first, then each leg's upper and lower part,
  then, for a carrier, the two rims of its back and the parcel. 3 for one leg, 5 for two, 9 for four,
  and three more for a carrier.
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
  upright. Its six outputs set the speed it wants (0.4 to 1.2 m/s), how much the foot placement
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
  seconds is over. Natively, from seed 9, two legs go 8.4 m on the first attempt and 8.7 m by
  the sixtieth; four legs 7.3 m, then 12.6 m.
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
holds only the physics, with these functions instead (about 40 KiB, 37 before the hand):

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
ground, so with everything at 1 a piece is level ground 0.3 times in 4.3 and about 93 in 100 are
something; then a piece of that kind
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

That reach is a hopping body's, which evolution's is; practice's body has no hop. Walking to the
Walker's stride with no hop, two legs get up and over nothing and four legs walk up 0.12 m and over
0.59 m, and with everything switched on 493 of 500 worlds, at every difficulty, hold a piece beyond
that (`cargo test --release no_hop -- --ignored --nocapture`). Practised policies bound rather than
walk to a stride, and get past such pieces (four legs average 44 m through held-out worlds at
difficulty 0.1), so these pieces are in doubt for practice rather than impossible; how far a body
with no hop can really get is not measured, and the checker still counts on a hop.

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
| rays | 16 times 6 | for each ray, from straight down ahead turning up (for practice's creatures, from the lowest of the fan round where it looks: "It wants things"): how near what it meets is (1 touching, 0 nothing within 6 m), then 1 or 0 for whether it is the edge of a drop (ground or a platform within 0.3 m of where it ends over a gap or something more than 0.12 m lower), a box, a hazard, a moving thing (a moving platform or a see-saw), food (only a creature that eats has food in its world). Ground is what is near with none of these. |
| body | 4 | its angle (0 upright), its spin times 0.2, its speed forward and up, each times 0.25 |
| joints | 2 for each | hip then knee, leg by leg: the angle, and the speed times 0.1 |
| feet | 1 for each | 1 if on something, else 0 |
| rhythm | 2 | the sine and cosine of the legs' rhythm (0 and 0 for two legs practising: "How two legs came to walk") |
| hop | 2 | 1 while it hops, else 0; 1 when it can hop, else 0 |
| energy, ate | 2 | its energy from 0 to 1, and 1 the step it eats, fading by 7 percent a step (practice only: "It wants things") |
| gaze | 1 | where its eye looks, in radians from level ahead, over pi (practice only) |
| touch, body | 1 | how hard everything touching its body presses on it, in its own weights, at most 2 (practice only) |
| touch, feet | 1 for each | the same for each foot: the ground, a box or a platform under it (practice only) |
| held | 1 | 1 while a hand holds any part of it (practice only) |
| jolt | 2 | what its body feels pushing it, across and up, in g: its acceleration less gravity, eased over a few steps (35 percent of the way each step), at most 3 either way; standing still it is 0 and 1, falling 0 and 0, lifted more than 1 up, pushed sideways (practice only) |

So two legs sense 96 + 18 = 114 numbers and four legs 96 + 28 = 124, as evolution's brains do; practice's
creatures sense their energy, having eaten and where they look (3 more) and feel touch as well
(`touch::feel`, "Touching it" below), 6 more for two legs and 8 for four, so 123 and 135.

`eyes::picture` makes, from the same world, the picture the creature would see instead: a strip of
greyscale pixels from 80 degrees down to 60 degrees up, each lit by what its ray meets (a hazard
brightest, then a box, a moving thing, ground, an edge) and dimmer the further off. It is tested and
not yet given to any brain; it is where the picture experiment will start.

### Many creatures for a learner

`generalist::envs::Envs` steps N creatures in N worlds together, for the gradient learner to come:
each step takes every creature's actions, moves them all on in lockstep (`World::step_together`), and
writes into the caller's lists what each senses (the layout above), its reward, and 1 if its run
ended (it has started again at once from its start), else 0. Creature i lives in the world of the
recipe's seed plus i, or all in the recipe's own world; what happens to it depends on that seed and
its actions alone, never on how many are stepped beside it, which a test holds to the bit.

The actions, each -1 to 1: for each joint, hip then knee, leg by leg, the three numbers that shape its
swing to the legs' rhythm (where it is centred, how wide, how far shifted in the stride), as the
Walker's; then the hop, which starts when it goes above 0.5. So 13 for two legs and 25 for four.

The reward: each metre further than the creature has been before earns 1, so a run's rewards add up
to the furthest it got; touching a hazard or falling into a gap costs 3 and ends the run; each change
in the actions from one step to the next costs 0.002 for its size, as twitching costs the Walker. A
run also ends after its time (30 s unless asked), after its body has been down for a second, or once
it has got no further than 0.2 m in five seconds.

Natively, 64 two-legged creatures step about 340,000 times a second together on one core, seeing as
they go (the Walker's, which see nothing, about 790,000). The page's module in Bun's JavaScriptCore
steps them about 250,000 times a second.

`generalist::evolve::Evolution` is the Walker's evolution, unchanged in its rules (32 brains, the best
4 kept, children of the better of three, a weight nudged by about 0.3 one time in ten), scored by the
sum of a run's rewards, its runs going four at a time through `Envs`. A generation's runs can be
handed out and their scores handed back in any order, as the Walker's are.

### How far evolution gets: the baseline

What gradient learning will be measured against. Made with
`cargo run --release --example baseline 400` (`examples/baseline.rs`): the world of seed 1 with
everything at 1, the page's settings (32 brains of two hidden layers of 16 neurons with 4 memories,
runs of up to 30 s), first brains from seed 1, each world and body trained on one core of a Ryzen 7
9700X with other work going on. The distance is the furthest any brain had got through the world by
then, in metres from the start (the first 4 m are the level start); the time is that core's.

| legs | difficulty | after 10 | after 50 | after 100 | after 200 | after 400 | 400 took |
|---|---|---|---|---|---|---|---|
| 2 | 0.1 | 2.9 m | 4.4 m | 4.4 m | 5.5 m | 5.9 m | 24 s |
| 2 | 0.3 | 2.9 m | 4.5 m | 6.3 m | 6.3 m | 6.4 m | 23 s |
| 2 | 0.5 | 2.9 m | 4.3 m | 4.4 m | 4.9 m | 7.0 m | 24 s |
| 2 | 0.8 | 2.9 m | 4.4 m | 4.4 m | 4.7 m | 5.4 m | 23 s |
| 4 | 0.1 | 7.0 m | 13.4 m | 13.4 m | 17.1 m | 17.8 m | 85 s |
| 4 | 0.3 | 12.8 m | 12.8 m | 14.0 m | 15.3 m | 15.9 m | 89 s |
| 4 | 0.5 | 7.9 m | 8.6 m | 8.7 m | 11.6 m | 14.3 m | 82 s |
| 4 | 0.8 | 7.3 m | 8.1 m | 8.4 m | 8.4 m | 8.4 m | 81 s |

Honestly: evolution gets the two-legged creature off the start and over the first thing or two,
then stalls; its brains learn to lunge and hop forward rather than to walk, since a hop that lands
earns at once and a stride that is not yet a stride earns nothing. The four-legged one walks, so it
gets further, and gets less far as the world gets harder: at difficulty 0.8 it stops at the first
hard piece. None got anywhere near the end of a world. Runs that fall end at once, so a generation is
quick (two legs about 17 generations a second on one core; in the page, with eight workers, about
50), and more generations do not help much. In the browser, two minutes of learning on the page with
everything switched on reached 8.0 m in the world "meadow" at difficulty 0.1 and 15.2 m at 0.5, riding
a moving platform over a gap on the way.

### Learning by practice

Gradient learning, written from scratch here: proximal policy optimisation (PPO) over a small
network whose backward pass is written by hand. Three files:

- `src/generalist/net.rs`: layers over flat lists of f32, a batch at a time; tanh, ReLU or nothing;
  the backward pass of each layer; Adam. Weights are kept input by input, each input's row holding
  its weight for every output, so one input times its row adds into sixteen outputs side by side
  (SIMD), and four rows of a batch share a row of weights while it is in registers. Every sum is in
  one fixed order, so the same weights and inputs give the same answer to the bit natively and in
  every browser. Tests hold the gradient to finite differences, for every kind of squash. Adam's
  small number is 1e-5, added outside the square root (the usual is 1e-8): with gradients shortened
  to a length of 0.5 over about 23,000 weights, it damps a weight whose gradient stays under about
  1e-4.
- `src/generalist/ppo.rs`: the learner. A policy gives the middle of a bell curve for each action,
  with one learned spread per action whatever is sensed; a value network guesses the reward to
  come. Generalised advantage estimation; the clipped objective, the value's error and an entropy
  bonus; minibatch epochs; what is sensed rescaled by a running mean and spread, and rewards by the
  running spread of their discounted sums, both kept with the weights; gradients shortened past a
  length; a rate that falls. A run cut short by its time is valued where it was cut, not as if it
  had ended. Every number is in `Settings`. Tested on a point that must reach a mark (it learns to),
  on advantages worked out by hand, and on the same seed learning to the bit. A sense, a running
  number or a gradient that is not finite (a blow-up in the physics) is let go rather than learned
  from.
- `src/generalist/practice.rs`: the worlds it practises in. Every run is in a fresh world of the
  recipe's kind (its seed has the top bit set), so what is learned must hold in any world of that
  kind; it is measured on held-out worlds, seeds 2 to 17, never practised in. World 1 is the one the
  evolution baseline learned in.

How fast the network goes, for a policy of 114 senses, two hidden layers of 64 and 13 actions, over
batches of 512 (`cargo test --release net_speed -- --ignored --nocapture`, one core of a Ryzen 7
9700X): forward 550,000 rows a second with tanh and 1,030,000 with ReLU (tanh's own exact function
is half the cost); forward and backward 390,000 with tanh, 480,000 to 570,000 with ReLU, about 28
to 40 billion operations a second. In the page's engine, in Bun's JavaScriptCore, a network of the
two-legged policy's size (5 actions) runs forward on 750,000 rows a second and forward and backward
on 470,000 (`src/minis/generalist.test.ts` prints it).

### How it moves

Evolution's creature gets about only by hopping. The aim for practice is a creature that finds its own
way of moving, and not that one. So there is no rule for how to move, and there are costs instead. What was
measured, on flat ground and in worlds at difficulty 0.1, two legs unless said (`examples/practice.rs`
prints, beside the learning curve, the share of time spent in the air with nothing ahead to clear and
the motors' work for each metre, while practising and for the policy on show; `trace=1` prints how
the policy moves through a held-out world, a line every tenth of a second):

- **The body can step.** A stepping controller written by hand (`stepping` in
  `src/generalist/practice_tests.rs`: hips swung as sines, knees bent as each leg swings forward, no
  hop) walks the two-legged body 6.3 m in 10 s with a foot always down, at 93 J a metre, and the
  four-legged one 13.8 m at 164 J a metre. Hopping in place of it, the hop asked for whenever it can
  go, gets 2 m before the body goes over, at 180 to 1,100 J a metre for two legs and about 3,000 for
  four. A test holds both bodies to stepping without leaving the ground at less than two thirds of
  hopping's cost. Most hand-written swings do not stay up on two legs (2 of 432 for 10 s): it is a
  hard body to walk without looking where it is going, which a policy does.
- **What practice found with no costs:** it bounds. The policy's actions go to their ends and back,
  so each joint is flung from one end of its range to the other, and the body leaves the ground about
  a quarter of the time with nothing to clear (two legs 18 m in 15 million steps, 174 J a metre; four
  legs gallop 42 m at 330 to 400 J a metre).
- **The hop made it worse.** With the brain's hop (`Body::hop`) taken away, two legs practised as far
  or further (19.5 m against 17.9 m, 154 J a metre against 174), and with the costs below the hop was
  what it gave up on: it lunged, hopped and fell (2 m) where without the hop it went 28 m. So practice
  has no hop: leaving the ground is its legs' own doing, and is charged for.
- **The costs settled on** (`Way::of`): 0.002 for each joule of the motors' work; 2 for each second in
  the air when its eyes show nothing within about a hop ahead to clear (`clear_ahead`: an edge, a box,
  a hazard or a moving thing where its five nearest rays down land, or a wall within a metre); both
  brought in over its first 4 million steps, so it can find how to move before it is charged for how;
  and 3 for a fall that leaves it down, as a fall into a gap or a hazard costs, since without it the
  cheapest thing under the costs was to lunge forward and fall. Two legs have posture terms besides ("How it walks,
  measured", below). The first spread of its actions is
  smaller (0.37 rather than 0.61), which learned further under every cost tried.
- **What did not help:** joints that ease toward the angle asked rather than going at once (`ease`),
  weaker everyday muscles (`strength`: with half strength it stopped leaving the ground but crawled on
  bent legs, 4 to 6 m), a cost on jerky changes of action (`smooth`), the bonus for being up in
  proportion to how tall it stands (`tall`), and stronger costs on the air (3 or 4 a second: it lunges
  and falls). They are still there to be tried from `examples/practice.rs`.
- **Stronger costs on the air, brought in slowly** (`examples/compare.rs` with `air=`, `ramp=` and
  `fall=`, difficulty 0.1, 20 million steps, seeds 1 and 2, against the settled costs' 29 m and 48 m
  with two and four legs, off the ground with nothing to clear 0.24 and 0.18 of the time): air 4
  over 15 million steps gave two legs 16 m at 0.18, four legs 51 m at 0.15; air 3 over 10 million
  with a fall costing 5 gave two legs 19 m at 0.14, four legs 51 m at 0.14 but 250 J a metre against
  210. Two legs leave the ground less but go about two thirds as far, so the settled costs stay.

Honestly, then: the frog's hop is gone, and the four-legged creature uses about two thirds of the
energy for each metre it did with no costs while getting as far, but neither body has found a walk
with a foot always down. Both still bound, leaving the ground about a fifth of the time on plain
ground; the costs make that dearer without making it rare, and costs strong enough to forbid it leave
a learner that gives up before it finds anything cheaper.

### How it walks, measured

"Looks alive" is counted, not guessed from a filmstrip. `generalist::gait` watches every step of
every held-out run and sums them up (`examples/compare.rs` prints them after the distance):

- **low**: the share of the time with the body or a knee touching anything, and **belly**, the body
  alone;
- **air**: the share in the air with nothing ahead to clear, as before;
- **height**: the body's height over the ground under it, as a share of the height it stood at, and
  **pitch**, its angle (0 upright), each a mean and a spread;
- **together**: how the two first feet's being down goes together, from -1 (always one down while
  the other is up: taking turns) to 1 (always together: hopping on both);
- **cadence**, landings of each foot a second; **balance**, the fewest landings of any foot over the
  most; **variation**, the spread of the time between one foot's landings over its mean (0 is a
  metronome). A landing counts after the foot has been up three steps.

It counts as walking (`Gait::walks`) when low is under 0.05, air under 0.10, height at least 0.75,
the lean under 0.35 radians on average and rocking by less than that, every foot stepping (balance at
least 0.7) at strides varying by less than 0.35, and, for two legs, together under -0.2. A test holds
the measures to telling the hand-written stepping controller (low 0, together below -0.2) from hopping.

What was tried, each against the settled way, two legs, difficulty 0.1, 10 million steps, seeds 1
to 3 (distance in the held-out worlds, then its spread over the seeds):

| | distance | air | low | belly | height | pitch spread | together | balance | variation |
|---|---|---|---|---|---|---|---|---|---|
| the settled way (before) | 25.5 ± 3.8 m | 0.21 | 0.07 | 0.03 | 0.79 | 0.61 | -0.14 | 0.71 | 0.53 |
| rhythm neurons: each leg's own phase at a pace it sets, the actions its hip's centre and swing and its knee's centre and lift | 13.3 ± 1.4 m | 0.25 | 0.14 | 0.11 | 0.76 | 1.03 | -0.02 | 0.77 | 0.50 |
| the evolution brain's actions, shaping each joint's swing to the shared rhythm | 12.8 ± 5.6 m | 0.16 | 0.13 | 0.12 | 0.79 | 0.76 | -0.10 | 0.89 | 0.42 |
| actions centred on the standing pose, not the middle of each joint's range | 23.7 ± 2.0 m | 0.16 | 0.06 | 0.02 | 0.81 | 0.62 | -0.17 | 0.79 | 0.46 |
| posture: a run ends at the first touch of its body, 1 for each second of a knee down, 0.5 for each second carried tall | 24.4 ± 7.5 m | 0.21 | 0.01 | 0.00 | 0.86 | 0.28 | -0.16 | 0.69 | 0.60 |
| posture and centred actions | 12.2 ± 6.4 m | 0.08 | 0.00 | 0.00 | 0.90 | 0.34 | -0.18 | 0.79 | 0.68 |
| posture and a mirror loss (Yu, Turk and Liu 2018: a quarter of each minibatch run with the legs swapped, the difference squared) | 15.1 ± 5.2 m | 0.27 | 0.01 | 0.00 | 0.85 | 0.22 | 0.16 | 0.95 | 0.46 |
| posture and 8 memory neurons, each written by an action of its own | 23.2 ± 2.6 m | 0.19 | 0.01 | 0.00 | 0.86 | 0.26 | -0.18 | 0.75 | 0.56 |
| **posture and 0.5 for each second with one foot down going forward** | **22.6 ± 3.7 m** | **0.16** | **0.01** | **0.00** | **0.83** | **0.31** | **-0.26** | **0.86** | **0.53** |
| posture and 1 for each second with one foot down | 20.7 ± 2.8 m | 0.15 | 0.02 | 0.00 | 0.82 | 0.32 | -0.27 | 0.77 | 0.53 |

So two legs practised, until 13 November 2026, with the posture terms and the bonus for one foot down
(the bonus is gone now: "How two legs came to walk", below): the
first touch of its body ends a run once the costs are all in (until then the second it may be down
shrinks to nothing over the first 4 million steps), so belly and knees came off the ground (low 0.07 to
0.01) and the body stopped rocking (its angle's spread 0.61 to 0.31 radians); the bonus, which is the
Walker's own count of feet taking turns, made the feet take turns (together -0.14 to -0.26) and cut the
time in the air for nothing by a quarter. Four legs practise as before: the posture terms took them
from 44.4 ± 3.1 m to 39.8 ± 1.7 m at 10 million steps, and they were not low to begin with (0.08).

Tried and not kept, and taken out of the engine again (they are in the history, commit 61c47e5):

- **Rhythm neurons**, as CPG-RL has them (Bellegarda and Ijspeert 2022), in joint space: each leg
  keeps a phase that goes round at a pace its first action sets (a quarter to one and three quarters
  of the legs' own), the legs starting half a stride apart, each leg's sine and cosine sensed; the
  other four actions set the hip's centre and swing and the knee's centre and how far it lifts as the
  leg swings forward. It went half as far and tumbled (the body's angle spread over a radian): with
  the swing open loop, the policy has no quick way to catch a lean. The evolution brain's rhythm-shaped
  actions did the same.
- **Mirroring**, the cheap help for two legs. First as data: every sample also taken with the legs
  swapped and its old chance worked out from the mirror image. The mirrored samples are far from what
  the policy would have done, their ratios large, and it fell from the start (0.8 m at 5 million
  steps). Then as a loss on how unlike the policy is both ways round: it does what it is told, every
  foot steps as often (balance 0.95), but the cheapest gait the same both ways round was both legs
  together (together 0.16), a hop, and it went less far. The test of it (a policy taught only one way
  round acts right the other way) passed: 0.98 of the time against 0.5 without.
- **Memory neurons**, as external memory written by actions of their own (Peshkin, Meuleau and
  Kaelbling 1999), so PPO trains them with no gradient through time; each memory moved `1 / (2 + 2k)`
  of the way to what was written each decision. A test of a sign shown once and asked for four
  decisions later went from 0 to 1 with them; on the walk they changed nothing.
- **Centred actions** learned faster early (22.6 m against 13.5 m at 5 million steps) and ended level;
  with the posture terms they left the ground less (0.08 of the time) but went half as far.

Each of these had a test of its gradient against finite differences while it was in; the whole loss
of PPO is still held to that (`ppo_tests`).

What was kept then (it was replaced on 13 November 2026, below), against the way before, as the comparison below measures it: 20 million steps, five
seeds, sixteen held-out worlds (`examples/compare.rs`; `knee=0 upright=0 turns=0 down=1` gives the
way before, whose distances come out to the bit as in the table below). Four legs practise as they
did, so theirs are the same runs both ways.

| legs | difficulty | | distance | air | low | belly | height | pitch | together | balance | variation |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 | 0.1 | before | 26.1 ± 4.5 m | 0.21 | 0.09 | 0.02 | 0.76 | 0.40 ± 0.52 | -0.11 | 0.73 | 0.60 |
| 2 | 0.1 | now | 25.6 ± 3.9 m | 0.14 | 0.01 | 0.00 | 0.85 | 0.02 ± 0.34 | -0.29 | 0.78 | 0.52 |
| 2 | 0.8 | before | 10.6 ± 2.2 m | 0.14 | 0.32 | 0.03 | 0.68 | 0.41 ± 0.54 | 0.08 | 0.63 | 0.71 |
| 2 | 0.8 | now | 9.2 ± 2.8 m | 0.08 | 0.03 | 0.00 | 0.79 | 0.01 ± 0.33 | -0.18 | 0.76 | 0.71 |
| 4 | 0.1 | | 44.0 ± 4.7 m | 0.15 | 0.19 | 0.01 | 0.80 | 0.17 ± 0.24 | 0.07 | 0.73 | 0.61 |
| 4 | 0.8 | | 16.4 ± 4.3 m | 0.10 | 0.27 | 0.02 | 0.76 | 0.13 ± 0.30 | 0.17 | 0.32 | 0.81 |

Two legs then carried the body upright (it leaned back 0.4 radians on average before, then not at all)
and higher, belly and knees off the ground, their feet taking turns, in the air for nothing a third
less, as far on easy worlds and a little less far on hard ones. By the thresholds above it does not
yet walk: its strides are irregular (a spread of half their length), it rocks by a third of a radian,
and it is still in the air for nothing a seventh of the time. Four legs, whose knees are often down
(low 0.19), do not walk by them either; they trot and bound. Practice is no slower for it: 118,000 to
124,000 steps a second against 113,000 to 114,000 before (`examples/practice.rs`, two legs, 3 million
steps, one core).

On the page, with that way, in headless Chromium at normal effort in "meadow", 10 of 100 hard, everything on, after
two minutes of practice (49 million steps, 17.6 m on average in practice runs): two legs run on their
feet, the body off the ground and upright, one leg then the other, but each stride is a high kick of
the leg in front, held out nearly level, then a wide split; it looks like a goose step, not yet a
walk. Four legs, the same as before, crouch at the start and leap for the first gap, landing on their
nose before getting their feet under them again.

### How two legs came to walk

The aim: two legs that walk, by the gait measure above, with no rule about how to move, learned in
the visitor's browser in a time a visitor will wait. The way above had two hints in it. The bonus for
exactly one foot down is a rule about how to move, and the senses held the legs' rhythm, a steady
clock (`Body::feel`), which is a hint of the same kind: a beat to step to. And it was paid for every
metre however fast, so the cheapest thing was to run.

**Three views of the gait.** The walk test (`Gait::walks`) is unchanged and is the one that counts.
Beside it, `compare.rs` now prints two more views of the same policy:

- **open**: the same sixteen held-out worlds, watched only while nothing ahead asks for more than
  walking (`clear_ahead` false: no edge, box, hazard or moving thing where its five nearest rays down
  land, no wall within a metre), the time between the landings either side of a stretch left out
  (`Worlds::open_watches`, `Watch::pause`). It is how it walks on open ground, with what it does at
  each thing in its way left out.
- **flat**: level ground with nothing on it (`flat=1`). A recipe with nothing in it lays the same
  ground whatever its seed, so this is one world, sixteen times.

Every trial below was made with `examples/compare.rs` and its `name=value` settings, two legs,
practising in worlds of difficulty 0.1 with everything on, measured in the held-out worlds of that
kind, at 20 million steps, seeds 1 to 3 (1 to 4 where n is 4), four runs at a time on four cores of the
Ryzen 7 9700X with other work going on. The columns are the held-out measures, averaged over the
seeds (the lean is the size of the mean lean, then its spread), then how many seeds walk by the test
in the held-out worlds, on open ground in them, and on level ground. "No hints" is the way above with
the bonus for one foot down taken out and the rhythm felt as 0.

| | n | distance | air | low | height | lean | together | balance | variation | walks: worlds, open, level |
|---|---|---|---|---|---|---|---|---|---|---|
| the way before | 4 | 24.9 ± 4.0 m | 0.12 | 0.01 | 0.85 | 0.16 / 0.34 | -0.35 | 0.80 | 0.44 | 0, 0, 0 of 4 |
| without the bonus for one foot down | 3 | 28.8 ± 3.9 m | 0.20 | 0.01 | 0.83 | 0.23 / 0.26 | -0.12 | 0.75 | 0.52 | 0, -, - of 3 |
| without it, hips that reach 0.7 rad forward, not 1.3 | 3 | 15.1 ± 9.0 m | 0.17 | 0.01 | 0.89 | 0.30 / 0.20 | -0.12 | 0.83 | 0.61 | 0, -, - of 3 |
| without it, 0.5 for each m/s of a foot's landing | 3 | 3.8 ± 2.8 m | 0.15 | 0.03 | 0.91 | 0.16 / 0.30 | -0.18 | 0.48 | 3.27 | 0, -, - of 3 |
| without it, 3e-5 for each N m of torque, squared, a second | 3 | 11.9 ± 8.4 m | 0.15 | 0.01 | 0.86 | 0.22 / 0.20 | 0.01 | 0.56 | 0.86 | 0, -, - of 3 |
| without it, spin 0.05 and bobbing 0.5 a second, squared | 3 | 24.0 ± 9.6 m | 0.19 | 0.01 | 0.79 | 0.26 / 0.26 | -0.04 | 0.74 | 0.53 | 0, -, - of 3 |
| without it, progress paid up to 1 m/s | 3 | 9.9 ± 9.4 m | 0.02 | 0.00 | 0.89 | 0.30 / 0.24 | -0.18 | 0.86 | 0.73 | 0, -, - of 3 |
| without it, progress paid up to 0.7 m/s | 3 | 4.3 ± 2.3 m | 0.00 | 0.00 | 0.95 | 0.45 / 0.10 | -0.15 | 0.57 | 0.89 | 0, -, - of 3 |
| no hints | 3 | 14.2 ± 6.7 m | 0.05 | 0.00 | 0.89 | 0.20 / 0.35 | -0.32 | 0.90 | 0.56 | 0, -, - of 3 |
| no hints, the bonus for one foot down back | 3 | 21.0 ± 0.7 m | 0.16 | 0.01 | 0.88 | 0.08 / 0.36 | -0.27 | 0.71 | 0.48 | 0, -, 0 of 3 |
| no hints, decisions held 8 steps, not 4 | 3 | 10.4 ± 8.8 m | 0.12 | 0.01 | 0.89 | 0.30 / 0.26 | -0.15 | 0.70 | 0.70 | 0, -, 0 of 3 |
| no hints, joints eased 0.3 of the way a step | 3 | 15.1 ± 10.3 m | 0.08 | 0.02 | 0.88 | 0.19 / 0.26 | -0.20 | 0.63 | 0.78 | 0, -, 0 of 3 |
| no hints, hips to 0.9 rad | 3 | 20.1 ± 4.4 m | 0.16 | 0.01 | 0.86 | 0.34 / 0.23 | -0.15 | 0.70 | 0.48 | 0, -, 1 of 3 |
| no hints, landing 0.05 | 3 | 18.8 ± 6.6 m | 0.16 | 0.01 | 0.87 | 0.08 / 0.36 | -0.32 | 0.73 | 0.49 | 0, -, 0 of 3 |
| no hints, spin 0.05 | 3 | 16.5 ± 2.8 m | 0.12 | 0.01 | 0.86 | 0.30 / 0.23 | -0.21 | 0.84 | 0.55 | 0, -, 1 of 3 |
| **no hints, paid up to 1 m/s, 3 for a run that stalls ("pace")** | 4 | 20.1 ± 2.7 m | 0.05 | 0.00 | 0.88 | 0.18 / 0.33 | -0.36 | 0.84 | 0.55 | 0, 1, 0 of 4 |
| no hints, paid up to 1.3 m/s, stalling 3 | 3 | 19.5 ± 0.2 m | 0.08 | 0.01 | 0.86 | 0.23 / 0.31 | -0.36 | 0.85 | 0.52 | 0, -, 0 of 3 |
| pace, paid up to 0.8 m/s | 3 | 6.4 ± 4.3 m | 0.01 | 0.00 | 0.93 | 0.44 / 0.23 | -0.17 | 0.72 | 1.00 | 0, -, 0 of 3 |
| pace, spin 0.01 | 4 | 14.5 ± 6.9 m | 0.05 | 0.00 | 0.88 | 0.29 / 0.27 | -0.34 | 0.82 | 0.60 | 0, 1, 2 of 4 |
| pace, spin 0.02 | 4 | 8.8 ± 2.5 m | 0.01 | 0.00 | 0.89 | 0.50 / 0.26 | -0.32 | 0.93 | 0.62 | 0, 1, 1 of 4 |
| pace, spin 0.05 | 3 | 8.0 ± 6.3 m | 0.02 | 0.00 | 0.91 | 0.38 / 0.13 | -0.15 | 0.50 | 3.51 | 0, -, 1 of 3 |
| pace, spin 0.05, landing 0.05 | 3 | 7.7 ± 5.5 m | 0.02 | 0.00 | 0.89 | 0.50 / 0.24 | -0.21 | 0.95 | 0.49 | 0, -, 0 of 3 |
| pace, bobbing 0.5 | 3 | 4.1 ± 2.4 m | 0.00 | 0.00 | 0.94 | 0.64 / 0.17 | -0.24 | 0.96 | 0.51 | 0, -, 0 of 3 |
| pace, hips to 0.9 rad | 3 | 8.4 ± 5.4 m | 0.02 | 0.00 | 0.90 | 0.11 / 0.23 | -0.23 | 0.67 | 0.87 | 0, -, 2 of 3 |
| pace, 0.002 for each joint's speed, squared | 3 | 15.5 ± 5.0 m | 0.05 | 0.01 | 0.88 | 0.38 / 0.27 | -0.33 | 0.85 | 0.65 | 0, -, 1 of 3 |
| pace, torque 1e-5 | 3 | 15.2 ± 10.2 m | 0.05 | 0.00 | 0.86 | 0.31 / 0.24 | -0.28 | 0.82 | 0.68 | 0, 1, 1 of 3 |
| pace, landing 0.05 | 3 | 16.8 ± 4.2 m | 0.04 | 0.01 | 0.87 | 0.30 / 0.33 | -0.29 | 0.89 | 0.52 | 0, -, 1 of 3 |
| pace, landing 0.1 | 4 | 13.7 ± 3.3 m | 0.04 | 0.00 | 0.88 | 0.20 / 0.40 | -0.34 | 0.90 | 0.41 | 0, 0, 1 of 4 |
| pace, spin 0.01, landing 0.05 | 4 | 9.4 ± 4.2 m | 0.01 | 0.00 | 0.91 | 0.49 / 0.25 | -0.24 | 0.85 | 0.80 | 0, 0, 1 of 4 |
| pace, lean 0.5 a second, squared | 3 | 20.6 ± 1.4 m | 0.06 | 0.00 | 0.84 | 0.12 / 0.33 | -0.34 | 0.77 | 0.54 | 0, 0, 1 of 3 |
| pace, lean 1 | 3 | 16.0 ± 5.5 m | 0.04 | 0.00 | 0.80 | 0.08 / 0.27 | -0.25 | 0.70 | 0.64 | 0, 2, 2 of 3 |
| **pace, lean 1, landing 0.05 (kept)** | 3 | 11.3 ± 4.9 m | 0.04 | 0.00 | 0.83 | 0.16 / 0.25 | -0.30 | 0.75 | 0.54 | 0, 1, 3 of 3 |
| pace, lean 1, bobbing 0.5 | 3 | 11.3 ± 5.1 m | 0.03 | 0.01 | 0.83 | 0.20 / 0.24 | -0.39 | 0.76 | 0.53 | 0, 0, 0 of 3 |
| pace, lean 1, spin 0.02 | 3 | 10.8 ± 7.9 m | 0.04 | 0.00 | 0.87 | 0.09 / 0.21 | -0.25 | 0.71 | 0.80 | 0, 1, 1 of 3 |

A dash is a view not yet printed when that trial was made. Then the likeliest, longer, at 30 million steps, seeds 1 to 4:

| | n | distance | air | low | height | lean | together | balance | variation | walks: worlds, open, level |
|---|---|---|---|---|---|---|---|---|---|---|
| pace, lean 1 | 4 | 11.8 ± 6.2 m | 0.03 | 0.01 | 0.85 | 0.09 / 0.23 | -0.23 | 0.77 | 0.55 | 0, 2, 3 of 4 |
| **pace, lean 1, landing 0.05 (kept)** | 4 | 15.1 ± 7.0 m | 0.03 | 0.00 | 0.84 | 0.17 / 0.27 | -0.38 | 0.89 | 0.45 | 0, 1, 2 of 4 |
| pace, lean 0.5, spin 0.01 | 4 | 14.3 ± 4.5 m | 0.04 | 0.01 | 0.84 | 0.14 / 0.29 | -0.35 | 0.87 | 0.60 | 0, 1, 1 of 4 |

And the kept way in the page's own kind of world ("meadow" as the page opens: 20 of 100 hard,
ground 60, the rest 40), practising and measured there, seeds 1 to 4, beside two that hold the body
stiller (each n seeds, the mark in the first column):

| | n | distance | air | low | height | lean | together | balance | variation | walks: worlds, open, level |
|---|---|---|---|---|---|---|---|---|---|---|
| kept, 10 M | 4 | 13.9 ± 1.7 m | 0.06 | 0.01 | 0.85 | 0.20 / 0.27 | -0.33 | 0.88 | 0.46 | 0, 2, 1 of 4 |
| kept, 20 M | 4 | 16.5 ± 1.7 m | 0.05 | 0.00 | 0.87 | 0.17 / 0.28 | -0.33 | 0.93 | 0.46 | 0, 3, 3 of 4 |
| kept, 30 M | 4 | 14.4 ± 2.2 m | 0.03 | 0.00 | 0.89 | 0.24 / 0.28 | -0.43 | 0.94 | 0.42 | 0, 3, 3 of 4 |
| kept, 40 M | 4 | 16.1 ± 2.8 m | 0.03 | 0.00 | 0.91 | 0.28 / 0.27 | -0.53 | 0.93 | 0.45 | 0, 2, 2 of 4 |
| lean 2, 20 M | 4 | 10.6 ± 6.7 m | 0.02 | 0.00 | 0.85 | 0.12 / 0.15 | -0.24 | 0.63 | 2.61 | 1, 2, 2 of 4 |
| lean 2, 30 M | 4 | 12.3 ± 7.3 m | 0.02 | 0.00 | 0.85 | 0.14 / 0.14 | -0.27 | 0.65 | 2.70 | 0, 2, 2 of 4 |
| lean 1, spin 0.01, 30 M | 4 | 13.1 ± 5.2 m | 0.02 | 0.00 | 0.92 | 0.23 / 0.24 | -0.38 | 0.94 | 0.42 | 0, 2, 3 of 4 |

What each thing did:

- **The bonus for one foot down did what it was for.** Taken out, the feet stop taking turns (together
  -0.35 to -0.12) and it is in the air for nothing a fifth of the time.
- **The rhythm in its senses made it run.** With the rhythm felt as 0 and no bonus, the feet take turns
  as much as with the bonus (-0.32), and it is in the air for nothing a twentieth of the time, against
  a fifth with the rhythm. Put the bonus back with no rhythm, and it leaves the ground as before (0.16).
- **Paid for any speed, it runs.** On level ground every policy paid however fast it went ran at 1.8 to
  2.2 m/s, in the air for nothing 0.19 to 0.28 of its time. Paid only up to 1 m/s (a metre gained
  quicker earns what 1 m/s would have, and nothing more), it stops leaving the ground; but alone it
  learned to stand until the run ended for getting nowhere, since standing still earns the bonus for
  being up and risks nothing. A cost of 3 for a run that stalls, as a fall costs, got it going.
  Paid up to 0.8 or 0.7 m/s, it shuffles and stands even so.
- **On level ground, that already walks in rhythm.** Paid up to 1 m/s with stalling charged, its strides
  vary by a sixth of their length on level ground and a quarter on open ground, against a half in
  the worlds as a whole; it falls short of the test by rocking (its lean's spread about 0.33) and, for
  one seed in four, by leaning further than 0.35 on average.
- **Leaning costs, so it stands up straighter.** 1 a second for the lean squared took the spread to 0.25
  and two or three seeds in four to walking on level ground; 2 took it to 0.14, but of four seeds one
  limped (one foot landing a third as often as the other) and one stood and crept. 1 with a cost of
  0.01 on the body's spin did about as well as the kept way.
- **A landing that stamps costs, so feet are set down.** At 0.05 for each m/s, the feet take turns more
  cleanly (balance 0.97 on level ground) and the strides are steadier; at 0.5 it barely moves.
- **Costs that hold the body still, too strong, end in a creep.** A cost on the body's spin of 0.02 or
  more, on bobbing, on the joints' speed, or a top pace under 1 m/s: on level ground it shuffles,
  leaning far forward or back (0.4 to 0.7 rad), and in the worlds it stops at the first thing in its
  way (4 to 9 m).
- **What made no walk:** shorter hips (0.7 or 0.9 rad forward, a body that cannot kick high: it bounds
  as before with the bonus gone, and with a pace it shuffles), decisions held twice as long, joints
  eased toward what is asked, torque squared. Not tried here: friction, mass and leg length, schedules
  of entropy or rate (the policy is greedy when measured, and its spread was not what was wrong).

**Kept** (`Way::of(2)`): the posture terms there were (knees, carried tall, a run ending at the first
touch of the body), progress paid up to 1 m/s, 3 for a run that stalls, 1 a second for the lean
squared, 0.05 for each m/s of a landing, the rhythm felt as 0 and no bonus for one foot down. Four legs
practise as before, to the bit (the same lines from `compare.rs`, before and after).

**Where it stands.** Natively, on level ground three seeds in four walk by the test at 20 million
steps (in the page, about two minutes at normal effort on four cores, one on the whole machine), and
two to three of four on open ground in held-out worlds of the page's kind: a foot always down, the
body upright, the feet taking turns, strides regular to within a tenth to a quarter of their length,
at about 1 m/s, using 150 J a metre on level ground. **By the test itself, in the held-out worlds as a
whole, no native seed walks**, and only twice did anything walk there: lean 2, one seed in four, at 20
million steps and not at 30, and the page's own learner at two minutes (below). Everything else
passes there: what fails is the strides' variation, 0.40 to 0.55 against 0.35. Where one seed in four
fails on level or open ground, it is by rocking, the lean's spread just over 0.35, or by leaning
further than that on average.

**Whether the test is right there.** It pools every stride of a run, so the time it spends waiting for
a moving platform, or the short steps and the pause before stepping down a drop or up a ledge, count
as strides of a walk that varies. In the held-out worlds at difficulty 0.1 to 0.2 there is something
in its way about every 6 m. On open ground in the same worlds, the same policies' strides vary by
0.23 to 0.29. So the thresholds are kept, the open and level views are printed beside them, and the
test is not passed in the worlds as a whole. A measure of a walk that excuses what it does at things
in its way, the open view, is offered as the measure of the gait, beside the whole; which is to count
is the owner's choice.

**What it cost.** It goes about two thirds as far through held-out worlds (15 to 16 m in 30 s against
25), since it is asked for 1 m/s, the runs last 30 s, and it slows at things in its way and is
charged nothing for being slow; on level ground it walks 30 m in 30 s.

**In the page.** The built site (drafts shown) served locally, the mini opened fresh in headless
Chromium as a visitor finds it ("meadow", 20 of 100 hard, normal effort, four workers), the browser
held to four cores of the Ryzen 7 9700X (`taskset`), other work going on: practice ran at 175,000 to
220,000 steps a second (on the whole machine it is about 340,000). The learner the page kept in the
browser's store was read out at 2, 5 and 10 minutes and measured natively in sixteen held-out worlds of
the page's kind (`compare.rs kept=`; the page's engine learns to the bit as the native one does, so the
measure is of what was learned in the browser):

| practised | steps | distance | air | lean | together | balance | variation | walks: worlds, open, level |
|---|---|---|---|---|---|---|---|---|
| 2 min | 23 M | 15.1 m | 0.04 | 0.21 / 0.34 | -0.46 | 0.91 | 0.34 | yes, no (lean's spread 0.35), yes |
| 5 min | 52 M | 15.2 m | 0.04 | 0.19 / 0.36 | -0.43 | 0.91 | 0.38 | no, no, no (lean's spread 0.36) |
| 10 min | 113 M | 15.5 m | 0.05 | 0.07 / 0.40 | -0.24 | 0.87 | 0.44 | no, no, no (lean's spread 0.37 to 0.41) |

So in the page, from nothing, two legs walk by the test after two minutes, in the worlds as a whole and
on level ground, and only just: the lean's spread is 0.34 against a limit of 0.35. With more practice
it rocks a little more and falls just outside it, while still taking turns with a foot always down. The
page learns from one seed only (the learner's seed is fixed), so this is one learner, beside the four
seeds natively. The page's status line said it got 13 to 15 m in "meadow" and 11 to 16 m on average in
practice runs, all ten minutes.

### Touching it

Stage 1 of the plan (`docs/generalist-plan.md`), 13 November 2026. Picking the creature up flung it or
tangled it, things dragged behaved strangely or went through others, and it took no notice of being
touched. The page set the held body's speed straight at the pointer each step and pushed the nearest
body with impulses as the pointer moved; nothing of it reached the creature's brain.

**The hand.** One hand for everything (`physics::Hand`, `generalist::touch`): a spring with a damper from
the point pressed to where the hand is, solved as a soft constraint as the hinges and contacts are, with
a stiffness of 1,500 N a metre, damping of 0.7, a cap of 400 N on its force, the hand going toward the
pointer at no more than 4 m/s, and what it lets go of keeping on at no more than 3 m/s. So the creature,
about 10 kg, hangs about 7 cm under the hand and swings; a 1.6 kg box keeps within 5 cm of a hand moving
at 3 m/s and a 40 kg one lags over 10 cm; a thing of 75 kg is not lifted at all. A press within 15 cm of a
body's surface takes hold of the nearest: the creature's body or a leg's part (so a leg held is a leg
held), a box, a see-saw's plank, or a moving platform, which leaves its way and is a 15 kg body while
held, kept level, and stays where it is let go of, floating as the platforms do. While anything is held,
it and the rest of its group look for contacts as far ahead as they could go in the step, so a box
dragged at 20 m/s onto a block 5 cm thick stops on it, where without that it went through from 8 of 32
starts at 10 m/s (`physics::hand_tests`). With nothing held, every result is the same to the bit, the
Walker's included.

On the page the pointer is a hand ("grab") over the creature and over things that move, and a closed
hand while holding; a thin line goes from the hand to the point held. A finger drags as the mouse does,
and the page does not scroll while a finger holds something (a touch that takes hold of nothing scrolls
as usual). The keyboard has the same hand: Space or Enter takes hold of what is under it and lets go,
and the arrows move it a quarter of a metre a press, starting at the creature's body. A creature picked
up after its run ended has its run taken up again.

**What a touch does to learning.** The creature on show is never learned from: practice happens in the
workers, in fresh worlds, so a visitor playing with the show changes nothing that is learned, and
practice goes on beside it (on the page, below, its average stayed where it was). While the creature is
held, its run is judged as practice judges it, but nothing is paid but the motors' work and twitching,
nothing is charged for how it hangs, and only its time can end it (`Judge::after_step`, `shaped`);
where it is carried counts as where it has been, so it is not paid for getting there again.

**It notices.** Practice's creatures feel touch (`touch::feel`, the senses table above): the pressure on
their body and on each foot, a hand holding them, and a jolt, what the body feels pushing it as an inner
ear does. Two legs sense 120 numbers and four legs 132. And two legs practise being touched: a visitor
(`touch::Visits`) comes every 8 seconds or so, brought in with the costs over the first 4 million steps,
seeded by each run's world, and does one of five things: lifts it by its body 0.4 to 0.8 m and lets it
go, from there or after setting it down near the ground (35 in 100), lifts it by a foot and lets go (15),
nudges its body 0.35 to 0.5 m to one side for a fifth of a second or so (20), puts a box on the ground
1.3 m away and slides it into it and past at 1 m/s (20), or drops a box from a metre up near it (10). No
rule says what to do about any of it: a fall costs what it always did, and two legs' run ends at the first
touch of the body.

What each did, in the page's kind of world ("meadow", 20 of 100 hard), 20 million steps, distance in
the sixteen held-out worlds with no visitor (`compare.rs` with `touch=` and `visitor=`), each the mean
and spread over the seeds:

| | seeds | 2 legs | 4 legs |
|---|---|---|---|
| before | 1 to 8 | 13.0 ± 5.9 m | 40.4 ± 4.1 m |
| touch felt, no visitor | 1 to 4 / 1 to 8 | 16.2 ± 2.2 m (before, seeds 1 to 4: 16.5 ± 1.7) | 41.4 m (before 40.4) |
| touch felt, a visitor every 4 s | 1 to 4 | 11.3 ± 3.2 m | 31.6 ± 5.9 m |
| touch felt, a visitor every 8 s | 1 to 8 | 14.3 ± 2.3 m | 34.2 ± 9.8 m |
| touch felt, a visitor every 16 s | 1 to 4 | 12.8 ± 4.3 m | 40.1 ± 10.0 m |

Feeling touch costs nothing. A visitor every 4 s costs both bodies a quarter to a third. Every 8 s, two
legs go as far as before and more steadily (two of eight seeds before stalled at 3 to 6 m; none with the
visitor), and four legs go less far, two seeds in eight collapsing to 14 and 26 m with their knees down
twice as often. Every 16 s is no better than 8 for either: the seeds vary more than the visitor does.

Whether being touched changes what it does, and whether what it learned helps (`examples/touched.rs`):
each learner above, at 20 million steps, walks each of the sixteen held-out worlds; at 3, 7 and 11
seconds the run is copied three times: one copy is touched, one is not, and one is touched the same way
but its touch senses are given what the untouched one felt then, so its brain is moved only by what the
touch did to its body. Lift is by the body 0.6 m for a second then let go; set down is lifted 0.3 m and
lowered to where its feet touch; nudge is 0.45 m backward for 0.3 s; shove is a box slid into it from
1.3 m ahead; drop is a box dropped from a metre up 0.9 m ahead. "Actions" is how far its actions over the
second after the touch are from the untouched copy's, then from the numb copy's (the mean size of the
difference, each action from -1 to 1); "fell" is the share of runs ending in a fall within three seconds
of the touch, touched, then numb (untouched, 0.03 to 0.10 for two legs, 0.14 to 0.23 for four). Seeds 1
to 4, 116 to 167 touches each:

| 2 legs | actions, no visitor | actions, visitor every 8 s | fell, no visitor | fell, visitor every 8 s |
|---|---|---|---|---|
| lift | 0.29 / 0.09 | 0.25 / 0.11 | 0.40 / 0.39 | 0.43 / 0.43 |
| set down | 0.28 / 0.16 | 0.26 / 0.15 | 0.26 / 0.32 | 0.23 / 0.32 |
| nudge | 0.25 / 0.16 | 0.23 / 0.15 | 0.49 / 0.52 | **0.39 / 0.55** |
| shove | 0.30 / 0.27 | 0.26 / 0.19 | 0.20 / 0.22 | **0.07 / 0.08** |
| box dropped | 0.68 / 0.11 | 0.40 / 0.11 | 0.66 / 0.73 | **0.28 / 0.26** |

| 4 legs | actions, no visitor | actions, visitor every 8 s | fell, no visitor | fell, visitor every 8 s |
|---|---|---|---|---|
| lift | 0.51 / 0.39 | 0.58 / 0.36 | 0.22 / 0.22 | 0.25 / 0.25 |
| set down | 0.53 / 0.48 | 0.57 / 0.47 | 0.21 / 0.28 | 0.23 / 0.27 |
| nudge | 0.52 / 0.35 | 0.57 / 0.35 | 0.52 / 0.51 | 0.45 / 0.49 |
| shove | 0.52 / 0.50 | 0.57 / 0.51 | 0.18 / 0.15 | 0.22 / 0.12 |
| box dropped | 0.92 / 0.23 | 0.60 / 0.30 | 0.44 / 0.47 | 0.43 / 0.37 |

What that says, plainly:

- **Every touch changes what it does**, by a quarter to nine tenths of an action's range over the next
  second, and much of that is its feeling it: the copy moved the same way but numb acts closer to
  untouched (0.09 to 0.27 of the range for two legs, against 0.23 to 0.68). While held, its legs move
  differently from the untouched copy's by 0.2 to 0.5 of their range: it kicks.
- **Two legs practised with the visitor learned to come through some touches.** A box dropped near it
  ends its run in a fall 0.28 of the time against 0.66 without the visitor; a box slid into it 0.07
  against 0.20; and after a nudge, the copy that feels it falls 0.39 of the time against 0.55 for the
  numb copy, where without the visitor the two are alike (0.49 and 0.52), so that is a reaction to what
  it felt, learned. No rule was written for any of it.
- **It has not learned to land.** Let go from 0.6 m by its body, it falls 0.4 of the time with or without
  the visitor; set down, a quarter. Lifted by a foot and let go, on the page, it falls nearly every time.
- **Four legs gained nothing measurable** from the visitor and went less far with it, so four legs feel
  touch and practise with no visitor (`Way::of`); their reactions are what feeling touch gives a policy
  that never practised being touched: it acts differently, but falls as often as when numb.

**In the page.** The built site (drafts shown) served locally, the mini opened fresh in headless
Chromium (`scripts/browser.ts`, held to four cores with other work going on), two legs in "meadow",
practising from nothing at normal effort (about 160,000 to 230,000 steps a second). At two minutes and at
ten, with the mouse pressed on the creature, carried up 1.6 m over a second, waved, and set down near the
ground (every other time) or let go from there, ten times by its body and ten by a foot; then the world
changed to more boxes and a box slid into it, carried onto its head and dragged away; then more moving
platforms and one taken, carried and put down low just ahead of it; then a finger and the keyboard. Each
touch was watched for 2.5 s afterwards, the creature sampled every tenth of a second, and photographed:

| | took hold | fastest its body went | under the ground | froze | its run ended in a fall |
|---|---|---|---|---|---|
| by the body, 2 min | 10 of 10 | 4.4 m/s | never | never | 2 of 10 (set down, 1 of 5) |
| by the body, 10 min | 10 of 10 | 3.1 m/s | never | never | 2 of 10 (set down, 1 of 5) |
| by a foot, 2 min | 10 of 10 | 2.3 m/s | never | never | 10 of 10 |
| by a foot, 10 min | 10 of 10 | 2.5 m/s | never | never | 10 of 10 |

Held by its body it hangs with its legs reaching down and moving; by a foot it hangs head down. Set down,
it mostly lands on its feet and walks on; let go from 1.6 m it lands and walks on or falls, as the body
falls; let go from a foot it lands on its head every time. A box slid into it pushed it back and it stayed
up; a box carried over its head and let go knocked it down (both times); a box dragged away went, and
nothing passed through anything. A platform put down just ahead stayed there, level, and it stepped onto
it (both times; before platforms were kept level, one taken by its end hung from it and was let go of
standing on end, a wall it stalled against). A finger took hold and the page did not scroll; Space took
hold and four presses of the up arrow lifted it 0.92 m. Changing the world (twice each round) carried the
learner on: its steps went on rising and its average in practice did not fall. That average, every half
minute, read 8.1, 8.1, 8.8, 9.3 m in the first two minutes, then 9.4 to 11.4 m to the end at thirteen
minutes, through every touch; the page's console showed no error. The learner the page kept at twelve
minutes (149 million steps) goes 18.5 m on average through the sixteen held-out worlds (15.5 m for the
page's learner at ten minutes before touch) and 28.9 m on level ground, measured natively (`compare.rs
kept=`). Through `touched.rs` that learner reacts more weakly than the native seeds above: a box slid into
it ends in a fall 0.07 of the time against 0.12 numb, but a dropped box 0.56 against 0.58, a nudge 0.43
against 0.43, a lift 0.52 against 0.57. It is one learner of one seed.

A look, which would need eyes that move, is stage 2, below.

### It wants things

Stage 2 of the plan, 14 November 2026. A small network trained to avoid costs moves like something
avoiding costs: it had nothing it wanted, nothing it noticed and nothing it remembered. Now it has
energy and food to find, curiosity, an eye it turns, and stretches of play. Every part is written here
and runs in the visitor's browser; nothing trained is shipped.

**Energy** (`src/generalist/needs.rs`). A number in the body from 0 to 1. The motors' work spends it,
600 J of work for each kilogram the creature weighs being all of it (two legs weigh 10 kg, four legs
16, and both spend about 15 J a metre for each kilogram walking), so a full two-legged creature walks
about 40 s on nothing; being awake costs a 240th of it a second. Resting gives it back, at most a 30th
a second: still (the body slower than 0.3 m/s), a foot on something, not held, and more the lower it
holds itself (40 percent standing still, all of it crouched half down). Eating a piece of food gives a
fifth. Tired, its muscles weaken: below 0.4 their strength (`Body::drive`, torque and top speed) falls
smoothly, to 35 percent with nothing left. Nothing ends a run for hunger, nothing hurts: the weakness
is the whole of it, and a creature with less than 0.6 that stands still is not ended for getting
nowhere, so it may rest as long as it likes (one with more is, as before). In practice each run starts
with energy drawn evenly from 0.2 to full, so it meets every level; the creature on the page is born full
and keeps its energy from one run to the next.

**Food** is laid with the land (`land.rs`), from a random generator of its own, so every piece of every
world is what it was (a test holds the laid pieces to the plan's): on the level ground after a piece,
two times in five (0.40 a piece over 200 worlds at difficulty 0.3, one every 13 m), more often than not
one somewhere 2 to 9 m behind the start, off the way, and sometimes one 2 to 3.6 m ahead. And now and
then food appears near it (`needs::Appearing`, every 20 s or so), dropped from 0.8 m up 1.5 to 4 m away,
behind it three times in five: a new thing appearing, and food off the way it is going. Food is not a
body: nothing bumps into it, and it is eaten when any part of the creature comes within 4 cm of it. Only
a creature that eats has food in its world, so evolution's runs are as they were, to the bit.

**What it is paid for.** Its discomfort is `(1 - e) + (1 - e)²` at energy `e`, and each step pays 4
times what it fell by (`Shaping::comfort`): eating pays more when hungry (a piece at 0.4 is worth
about 1.6, at 0.9 about 0.4), the motors' work costs more when tired (0.0007 a joule full, 0.0016 at
0.3), beside the 0.002 a joule it always paid. Curiosity (`curious.rs`) pays 0.3 for coming into each
half metre along the way for the first time and 0.02 for each cell of the world (a quarter of a metre
square, and what kind of thing was in it) its rays meet for the first time; coming back to a place or
seeing a cell again pays 1 / (1 + n)² of that, so the sum for any place or cell, however often, is
under 1.7 of it. For two legs a new place reached quicker than 1 m/s is worth only what 1 m/s would
have earned, as progress is. Progress itself is still paid, 1 a metre further than before: dropping it
was tried, below.

**Eyes it moves** (`eyes.rs`). The sixteen rays are now a fan round where it looks, 4 degrees apart in
the middle and 28 at the edges, 180 degrees from edge to edge. Where it looks is one action more, before
the hop: -1 is 80 degrees down, 0 a little down ahead (30 degrees, where the fixed eyes mostly looked),
1 over the top and behind (200 degrees), and the eye turns there no faster than 5 radians a second.
What the costs need to know of the ground ahead (`clear_ahead`) is found by the fixed eyes' own rays, so
where it looks changes nothing it is charged for (a test holds that). Seen food is the sixth number of
a ray, which had been 0 until now.

**Play.** One practice run in five, drawn by its world, is play: its energy held full, no food in its
world, progress not paid, so only curiosity and its own costs apply. It is charged for its effort as if
it were full.

**Senses and actions now.** Two legs sense 123 numbers and four legs 135 (three more: its energy, having
just eaten, which is 1 the step it eats and fades by 7 percent a step, and where its eye looks, over pi),
before touch, which stays last. Two legs act with 6 numbers and four legs with 10: the eye's is the one
before the hop. Every term in play, and what kind of thing it is:

| | what | kind |
|---|---|---|
| rays (16 by 6) | how near, and edge, box, hazard, moving thing, food | a sense |
| body, joints, feet, hop | as before | senses |
| rhythm | four legs only | a sense (a hint: a clock to step to) |
| energy, having eaten, where it looks | new | senses |
| touch on body and feet, held, jolt | as in stage 1 | senses |
| each joint's angle | an action each | actions |
| where to look | new | an action |
| hop | held off | an action it does not have |
| progress, 1 a metre, up to 1 m/s for two legs | as before | a want (the task) |
| eating, the fall in discomfort | new | a want |
| new places, new things seen | new | a want (curiosity) |
| being up, 0.25 a second | as before | a want |
| the motors' work, 0.002 a joule, and the rise in discomfort | the second new | costs |
| in the air with nothing to clear, a fall, a run that stalls, a stamping landing | as before | costs |
| knees down, carried tall, lean, the run ending at the first touch of the body | two legs, as before | rules about how to move (posture terms) |
| weaker muscles when tired | new | a consequence, neither paid nor charged |
| being forgiven for standing still under 0.6 energy | new | a rule about when a run ends |

**What was tried** (`examples/compare.rs` with `needs=`, `gaze=`, `comfort=`, `place=`, `sight=`,
`progress=`, `play=`, `appear=` and `effort=`; worlds of the page's kind, "meadow" as it opens: 20 of 100
hard, ground 60, the rest 40; 20 million steps; seeds 1 to 4; measured in the sixteen held-out worlds of
that kind, each run starting with energy 0.7 and none at play). The columns: distance, in the air for
nothing, the motors' work a metre, food eaten a minute, the share of the time resting, the share of rests
of a second or more after which its energy was higher, the share after which it went on a metre or more,
its energy on average, how often its eye was on the nearest thing worth looking at (food, a box, a moving
thing within 6 m, the middle of its gaze within 10 degrees) against chance (a gaze anywhere in its range)
and against an eye left where an action of 0 puts it, and the share of the world round where it went that
its rays met (`tally.rs`):

| two legs | distance | air | J/m | food /min | resting | recovered | went on | energy | eye on / chance / at rest | seen |
|---|---|---|---|---|---|---|---|---|---|---|
| before (stage 1) | 15.3 ± 2.0 m | 0.05 | 171 | | | | | | | |
| wants, progress paid, curiosity of places not held to the pace ("A") | 14.5 ± 2.8 m | 0.19 | 149 | 7.0 | 0.07 | 0.50 | 0.00 | 0.59 | 0.06 / 0.06 / 0.25 | 0.79 |
| wants, progress not paid, curiosity 0.3 ("B") | 0.03 m | 0.01 | | 1.8 | 0.31 | 0.50 | 0.00 | 0.61 | 0.00 / 0.06 / 0.05 | 0.65 |
| A, curiosity of places held to the pace | 10.8 ± 1.5 m | 0.11 | 181 | 4.9 | 0.16 | 0.92 | 0.19 | 0.56 | 0.11 / 0.06 / 0.27 | 0.74 |
| that, without the 0.002 a joule | 13.9 ± 3.3 m | 0.11 | 233 | 5.6 | 0.10 | 0.75 | 0.12 | 0.46 | 0.08 / 0.06 / 0.26 | 0.78 |
| that, seeing new things paid 0.1, not 0.02 | 7.9 ± 5.3 m | 0.06 | | 4.8 | 0.04 | 0.50 | 0.00 | 0.56 | 0.10 / 0.05 / 0.24 | 0.80 |
| **that, one run in five play (kept)** | **10.8 ± 0.7 m** | **0.03** | **175** | **4.8** | **0.13** | **1.00** | **0.00** | **0.58** | **0.10 / 0.05 / 0.28** | **0.75** |
| that, two runs in five play | 10.9 ± 2.9 m | 0.05 | 207 | 4.8 | 0.10 | 0.75 | 0.33 | 0.57 | 0.17 / 0.05 / 0.25 | 0.73 |
| kept, without the 0.002 a joule | 12.1 ± 0.8 m | 0.07 | 214 | 5.2 | 0.09 | 0.92 | 0.54 | 0.51 | 0.09 / 0.05 / 0.25 | 0.76 |
| progress not paid, curiosity of places 1, seeing 0.05 | 6.0 ± 7.0 m | 0.09 | | 5.1 | 0.09 | 0.61 | 0.00 | 0.53 | 0.03 / 0.05 / 0.19 | 0.77 |
| that, nothing paid for being up or carried tall | 0.02 m | 0.12 | | 5.9 | 0.00 | | | 0.58 | 0.00 / 0.05 / 0.02 | 0.72 |

| four legs | distance | air | J/m | food /min | resting | energy | eye on / chance / at rest | seen |
|---|---|---|---|---|---|---|---|---|
| before (stage 1) | 42.7 ± 3.8 m | 0.19 | 201 | | | | | |
| A, energy 6,000 J whatever the weight | 27.3 ± 1.9 m | 0.11 | 234 | 10.7 | 0.01 | 0.27 | 0.19 / 0.06 / 0.18 | 0.78 |
| B | 0.5 ± 1.0 m | 0.01 | | 3.0 | 0.40 | 0.61 | 0.11 / 0.06 / 0.09 | 0.73 |
| A, held to the pace, 600 J a kilogram | 34.0 ± 3.9 m | 0.15 | 245 | 13.3 | 0.01 | 0.48 | 0.12 / 0.06 / 0.18 | 0.78 |
| that, without the 0.002 a joule | 31.8 ± 4.3 m | 0.15 | 265 | 12.1 | 0.00 | 0.40 | 0.18 / 0.06 / 0.17 | 0.77 |
| **that, one run in five play (kept)** | **35.2 ± 2.4 m** | **0.16** | **247** | **13.0** | **0.00** | **0.45** | **0.16 / 0.06 / 0.18** | **0.78** |
| kept, without the 0.002 a joule | 30.5 ± 0.7 m | 0.15 | 276 | 12.3 | 0.01 | 0.40 | 0.17 / 0.06 / 0.17 | 0.78 |

(Four legs have no pace, so holding curiosity to it changes nothing for them; their rows from "held to
the pace" on are with energy by weight. A blank J/m is a creature that hardly moved.)

What each thing did, plainly:

- **Not paying for progress, it stays where it is.** Paid only for eating and curiosity (B), both bodies
  learned to stand at the start, resting, eating what fell near them: standing earns being up and risks
  no fall. With curiosity three times stronger, one seed in four went on and the rest stood; with nothing
  paid for being up either, two legs went back behind the start, where the ground is level, there is
  food and every place is new, and never forward. So progress stays paid, and the creature goes on
  because it is paid to, and stops when it is tired or there is food.
- **Curiosity not held to the pace made two legs bound again** (in the air for nothing 0.19 of the time
  against 0.05, feet no longer taking turns): new places reached faster earned more. Held to 1 m/s, as
  progress is, it halved that.
- **Play made two legs walk more cleanly**: in the air for nothing 0.03 of the time, less than before
  stage 2, feet taking turns (together -0.32), and two seeds in four walk by the test on open ground.
  Two runs in five did about as well, with its eye more often on things (0.17 against chance 0.05), but
  varied more between seeds. One in five is kept. For four legs it changed little.
- **The separate cost on the motors' work stays.** Without it two legs went a little further but spent a
  fifth more a metre; four legs went less far. Discomfort alone is a weaker cost when it is full.
- **Paying more for seeing new things** left two legs standing about looking, in one seed in four.
- **Four legs ran out**: at 6,000 J whatever their weight, a galloping four-legged creature emptied in
  about 16 s, its energy averaging 0.27 and its knees down a quarter of the time (weak). Energy by weight
  gave them 34 to 35 m.

**What it does now, by the numbers** (the kept way, the bold rows). Two legs eat about five pieces a
minute and rest about an eighth of the time, every rest of a second or more ending with more energy
than it began, its energy averaging 0.58 from a start at 0.7. Its eye is on the nearest thing worth
looking at a tenth of the time, twice chance, but an eye left a little down ahead would be on it more
often (0.28), since food and boxes lie on the ground ahead: it has learned to look where it is going,
round a little, not yet at things. It goes about two thirds as far as before (10.8 m against 15.3 in
30 s), since it stops to rest and to eat, and starts its measured runs part tired. Four legs eat 13
pieces a minute, almost never rest (energy 0.45; they eat as they gallop), their eye on things 0.16 of
the time against chance 0.06 and 0.18 for an eye left at rest, and go 35 m against 43.

Learning curves, native (distance in the held-out worlds, then in the air for nothing):

| | 5 M | 10 M | 20 M |
|---|---|---|---|
| two legs, before | 13.5 m, 0.09 | 14.5 m, 0.07 | 15.3 m, 0.05 |
| two legs, kept | 7.8 m, 0.10 | 9.8 m, 0.05 | 10.8 m, 0.03 |
| four legs, before | 35.1 m, 0.19 | 36.0 m, 0.18 | 42.7 m, 0.19 |
| four legs, kept | 28.1 m, 0.16 | 29.0 m, 0.15 | 35.2 m, 0.16 |

**The strict walking test.** No seed of either body, before or after, walks by it in the held-out worlds
as a whole at 20 million steps in worlds of this kind; two legs' strides vary by 0.5 to 0.8 against the
limit of 0.35, the same failing as before. On open ground two seeds in four walk, kept and before alike.
It was measured, not tuned for.

**Why the numbers are what they are.** Practice runs about as fast as before (5 million steps in 47 s
against 44 natively; 97,000 steps a second in the page's engine in Bun). The module is 331 KiB with SIMD
(321 before).

**In the page.** The built site (drafts shown) served locally and the mini opened fresh in headless
Chromium as a visitor finds it ("meadow", 20 of 100 hard, two legs, normal effort), browser and all held
to four cores of the Ryzen 7 9700X with other work going on: it practised in two workers at 170,000 to
220,000 steps a second. Sampled four times a second throughout, photographed every half second over its
first ten seconds and at each visit; at two minutes and at ten a visitor left it alone 8 s, dropped food
1.5 m ahead of it and then 1.5 m behind, carried a box over and dropped it a metre ahead, and lifted it
by its body and set it down (`page-trial.ts`, kept with the trials, not in the repository).

| | energy (lowest) | resting | its eye on the nearest thing | eaten in a run | where it got |
|---|---|---|---|---|---|
| first minute | 0.60 (0.14) | 0.01 | 0.08 | 1 | 12.5 m |
| first two minutes | 0.42 (0.11) | 0.04 | 0.07 | 1 | 12.5 m |
| two to ten minutes | 0.57 (0.18) | 0.32 | 0.08 | 2 | 13.0 m |
| at 2 min, food dropped ahead / behind | 0.48 / 0.40 | 0 / 0 | 0.14 / 0.00 | ate it / did not turn | |
| at 10 min, food dropped ahead / behind | 0.68 / 0.64 | 0.05 / 0 | 0.36 / 0.00 | ate it / did not turn | |
| at 2 and 10 min, a box dropped ahead; held; set down | | 0.3 to 0.8 after | 0.00 (looking straight down) | | |

The learner the page kept, measured natively in the sixteen held-out worlds (`compare.rs kept=`; the
page's engine learns to the bit as the native one does):

| practised | its own steps | distance | air | food /min | resting | recovered | eye on / chance / at rest | walks: worlds, open, level |
|---|---|---|---|---|---|---|---|---|
| 1.5 min | 9 M | 11.4 m | 0.13 | 3.6 | 0.05 | | 0.06 / 0.06 / 0.23 | no, no, no (in the air for nothing 0.13 to 0.23) |
| 9.5 min | 58 M | 11.8 m | 0.13 | 4.4 | 0.25 | 1.00 | 0.12 / 0.06 / 0.33 | no, no, no (in the air 0.13 to 0.22; strides on level ground vary 0.18) |

What a visitor sees, plainly. **The newborn** stands crouched, its eye line swinging down and up, and
shuffles forward a few centimetres at a time; its first runs end in a fall 2 to 3 m from the start, at 13
and 21 seconds. At 11 seconds it reaches the piece of food 2.6 m ahead and eats it: the bar jumps (0.79 to
0.91) and its body brightens. By 35 seconds it shuffles all the way to the first gap, 12 m on, and stands
at the edge fidgeting while its body dims (0.49 to 0.15 in 15 s), then falls and starts again from the
start, energy carried, dim. That reads as something learning and tiring more than as a machine, though it
falls over less than "a newborn falling over" promises: by the second run it already keeps its feet.
**At two minutes** it
goes forward in a low lean, one leg stretched far back, a short stride with the front foot, eats the food
on its way, and stops at the edge of the first gap (the floating platforms at 12 m), where it stands. Food
dropped in front of it, it steps to and eats (its eye on it 0.14 of the time against 0.10 left alone);
food dropped behind, it never turns for. **At ten minutes** the same lean and stride, steadier; it rests
a third of the time, mostly standing at that gap edge with its body dimmed, and its energy comes back (0.4
to 0.7) and it goes on when its run starts again; food dropped ahead it looks at (0.36 of the time) and
eats; food behind, it still does not turn for. A box dropped in front of it and the hand lifting it: it
looks straight down (the eye at its lowest), not at either. Set down, it stands and rests.

Honestly, then: it eats what is in front of it, tires, rests and gets going again, and a visitor can see
why, from the glow and the bar. It does not look at things: its eye has found that looking down ahead is
useful for walking, and it lowers it further when touched or when something lands near it, which is a
reaction but not a look. It has learned nothing about food it cannot see ahead of it. And it still moves
like a careful machine at the gap, where it stops rather than tries. Two legs no longer walk by the test
in the page: they lean further and leave the ground with nothing to clear 0.13 of the time (0.04 at
stage 1's two minutes), and the page's learner rests and starts tired, so it goes about the same distance
in 30 s as before (11 to 12 m against 15 to 18).

**Four legs in the page**, the same way for two minutes: they gallop from the first minute (21 m through
"meadow" by the end of it), eat what lies on their way, and spend faster than they find: their energy,
carried from run to run on the page, reached nothing within the first minute and stayed near it, so the
four-legged creature on show is a dim, weakened thing scrabbling forward, its knees often down. In
practice its runs start at any level and last 30 s, so it never learned to stop and rest (0.03 of the
time). Its eye is on things a little more than two legs' (0.13 to 0.19, and 0.57 of the moment it was
held up by the hand, looking along the hand's line). That one life on the page empties it is the clearest
thing stage 2 found wrong: either four legs need to learn to rest, which needs runs long enough to
outlast their energy, or the page should not carry energy between runs for them; it is left for her to
say.

### Practice in the browser

On the page, "how it learns" chooses evolution or "by practice", and the page opens on practice: a
creature that knows nothing, learning from the first second, since nothing trained is shipped. Its
brain is drawn live at the top of the column beside the world (`src/generalist/mind.rs`): what it
senses on the left (a dot for each ray of its eye, lit by how near what it meets is, then the body),
its two hidden layers of 64, and what it does, each neuron lit by what it gave and, into each, the
three connections passing it the most just then, as bright as they are beside the strongest in their
layer. Any brain that can say its columns, what each gave and a weight between two neurons
(`mind::Drawn`) is drawn the same way; evolution's is. Practice runs in up to four workers
(`src/scripts/generalist-practice.ts`), each with its own copy of the module and a share of 32
creatures, each run in a fresh world of the visitor's kind. Every update each worker collects a
rollout and goes over it, then one leads: it averages every worker's weights in the workers' order and
sends the average and every worker's running numbers back, so all go on from the same place. Only
plain messages pass, no shared memory. Practice stops when the page is hidden or scrolled away (the
page's drawing sends a beat each second, as for evolution). Every three seconds the page is sent the
policy, and the creature on show is the newest policy acting without drawing, from the start of the
visitor's world, each time its run ends, its actions held between decisions by practice's own rule
(`Way::hold`: each within -1 to 1, and no hop), so what is shown is what was practised; a test holds
the show and practice to the same trajectory, to the bit. Above it, twice a second, small words say what it was just
rewarded and charged for: forward, up, effort, in the air for nothing, fell. The status line says how
long it has practised, how many steps, how far it gets in this world now and on average in practice.
Everything learned is kept in the browser (IndexedDB) every half minute, for that body, and taken up
again on the next visit; "start over" forgets it. A new world for the same body goes on with what was
learned: the leading worker takes its learner out of the engine before the engine is made for the new
world, and puts it back (`carry` in the worker's order), so neither the learner nor its steps start
again, and the page says "A new world. It goes on with what it has learned". A new body (two legs for
four, or back) has a brain of another size: it takes up the learner kept for that body, or starts from
nothing, and the page says which. Evolution starts again at every change, since its brains learn the
one world they are bred in, and says so. What is kept holds the steps practised, so the costs brought
in over the first 4 million steps go on from where they were; a learner kept before that was added, or
of another size, is refused and practice starts afresh. The store was at version 2 once two legs were
asked for a pace (it forgot two-legged learners kept before, which learned for another task); at version 3,
since the creatures feel touch, every learner kept before has too few senses, so opening the store at 3
forgets them all, and learners are kept by body alone from then on, not by kind of world. A two-legged learner's
weights are 23,435 numbers, and all that is kept of it 70,309 (the weights, Adam's two running
averages as long, its updates, Adam's steps and the steps practised), which does not fit in a link, so
a link carries the world and not the brain.

Measured in headless Chromium on this machine (Ryzen 7 9700X, 16 threads, four of them busy with
other work), two legs, the page at 60 frames a second at every effort:

| effort | workers | steps a second | updates a second |
|---|---|---|---|
| gentle | 1, resting as long as it works | 54,000 | 6.5 |
| normal | 4 | 342,000 | 41.7 |
| all it has | 4 | 335,000 | 40.9 |

Normal and all it has are the same here, since practice uses four workers at most: with more, each
has too few creatures and the average of their weights learns less for each step. An update is 8,192
steps of the physics (32 creatures, 64 decisions, 4 steps each). Two minutes of practice at normal
effort is about 40 million steps, ten minutes about 200 million, against 20 million in the comparison
below.

What a visitor sees, at normal effort in the world "meadow" with everything switched on (how far the
policy gets in this world now, and on average in practice runs, from the status line; filmstrips were
taken at 2 and 10 minutes):

| | 1 min | 2 min | 5 min | 10 min |
|---|---|---|---|---|
| 2 legs, 10 of 100 hard | 7.5 m, 14.0 m | 5.2 m, 19.4 m | 10.4 m, 25.7 m | 1.3 m, 27.2 m |
| 2 legs, 50 of 100 hard | 4.7 m, 11.7 m | 5.7 m, 14.6 m | 1.3 m, 14.3 m | 3.5 m, 16.1 m |
| 4 legs, 10 of 100 hard | 44.0 m, 35.0 m | 44.3 m, 34.6 m | 33.2 m, 45.2 m | 44.0 m, 60.7 m |
| 4 legs, 50 of 100 hard | 6.1 m, 26.1 m | 4.1 m, 24.3 m | 27.2 m, 25.6 m | 5.5 m, 30.1 m |

How it moves, plainly. Two legs: after two minutes it runs a few steps crouched, then throws itself
headlong over the first gap and lands on its belly on the moving platform; at 50 of 100 it leaps onto
the platform and rides it, sitting. After ten minutes it goes on its belly and knees, its legs pushing
it along in lunges that leave the ground (the words over it say "in the air for nothing" often), and
in meadow it falls into the first gap, though in practice worlds it averages 27 m. It does not yet look
alive, which is the aim. Four legs: from the first minute a quick scurrying run with its feet
mostly down and short bounds between, 44 m through meadow; after ten minutes a bounding gallop, the
hind legs pushing together, which takes it up small ledges. At 50 of 100 it stalls at a box and rears
up on its hind legs at two minutes, and at ten leaps for the moving platform and tips off it. How far
it gets in the one world on show swings from run to run, since a policy that is better on average can
be worse at the first thing in this world.

### Evolution against practice

The same worlds and the same compute for both: each run learns for 20 million steps of the physics
on one core, in worlds of the recipe's kind with everything switched on, and is measured at 1, 2, 5,
10 and 20 million steps on the same sixteen held-out worlds (seeds 2 to 17), which neither ever
learns in. Evolution learns as the page has it (32 brains of two layers of 16 with 4 memories, in
the one world of seed 1, its rhythm-shaped actions every step, with its hop); practice learns with
the settled `Settings` and `Way` (no hop, the costs above), in a fresh world every run. Five seeds
each, 1 to 5, for brains and worlds alike. The distance is how far it gets on average through the
held-out worlds, then the spread of that over the five seeds (their standard deviation); "air" is
the share of its time off the ground with nothing ahead to clear, and J/m the motors' work for each
metre, both in the held-out worlds at 20 million steps. Made with `sh examples/compare.sh`
(`examples/compare.rs`), four runs at a time on a Ryzen 7 9700X with other work going on: 90 runs,
93 minutes. The same seed learns the same way to the bit, so every number here comes out again.

Each method is measured under the rules it learned under: evolution's runs end as the run's own rule
has it (after a second with the body down), and practice's as its way has it (for two legs, at the
first touch of the body once its costs are all in). Measuring evolution by practice's rule would mark
it down for something it was never bred to avoid. Until 13 November 2026 `compare.rs` measured
evolution through practice's way, so for two legs by practice's stricter rule; the two-legged
evolution rows, run again under evolution's own rule (16 held-out worlds, seeds 1 to 5, 20 million
steps), came out as below to the bit, in distance, air and J/m, since the table was made before two
legs had that rule. By the stricter rule they would have been 0.2 to 0.4 m less (at 20 million steps
4.4, 4.0, 2.2 and 2.0 m, in the air 0.30 to 0.51 of the time).

| legs | difficulty | evolution, 5 M | evolution, 20 M | practice, 5 M | practice, 20 M | 20 M took, evolution / practice | air, evolution / practice | J/m, evolution / practice |
|---|---|---|---|---|---|---|---|---|
| 2 | 0.1 | 4.1 ± 3.3 m | 4.6 ± 3.4 m | 14.8 ± 5.4 m | 26.1 ± 5.0 m | 224 / 184 s | 0.23 / 0.21 | 376 / 161 |
| 2 | 0.3 | 2.5 ± 0.5 m | 4.3 ± 3.3 m | 11.6 ± 3.9 m | 17.2 ± 2.8 m | 226 / 186 s | 0.32 / 0.22 | 298 / 157 |
| 2 | 0.5 | 2.1 ± 0.4 m | 2.5 ± 0.4 m | 9.4 ± 2.6 m | 12.1 ± 3.5 m | 238 / 191 s | 0.34 / 0.17 | 304 / 172 |
| 2 | 0.8 | 2.5 ± 0.4 m | 2.4 ± 0.4 m | 8.2 ± 0.7 m | 10.6 ± 2.5 m | 242 / 190 s | 0.34 / 0.14 | 332 / 184 |
| 4 | 0.1 | 9.3 ± 1.0 m | 10.5 ± 1.4 m | 39.0 ± 3.9 m | 44.0 ± 5.2 m | 324 / 225 s | 0.06 / 0.15 | 405 / 214 |
| 4 | 0.3 | 8.2 ± 2.2 m | 7.8 ± 2.0 m | 23.8 ± 9.0 m | 35.2 ± 15.5 m | 324 / 227 s | 0.07 / 0.15 | 477 / 227 |
| 4 | 0.5 | 6.6 ± 1.8 m | 7.5 ± 1.2 m | 22.7 ± 7.6 m | 28.9 ± 4.1 m | 354 / 229 s | 0.10 / 0.15 | 548 / 253 |
| 4 | 0.8 | 5.1 ± 1.3 m | 5.9 ± 1.1 m | 13.4 ± 1.1 m | 16.4 ± 4.8 m | 366 / 232 s | 0.07 / 0.10 | 557 / 256 |

Practice goes three to six times as far through worlds it has never seen, for the same steps and a
little less time, and uses about half the motors' work for each metre. After 1 million steps the
two are about level (two legs 2 to 4 m against 5 to 6 m; four legs 5 to 9 m against 4 to 7 m); by 5
million practice is far ahead, and evolution gains little after that. Evolution does better in its
own world, seed 1, than in the held-out ones (two legs 7 to 13 m there at 20 million, four legs 12
to 22 m): it learns that world, not worlds like it. Practice never saw seed 1 either, and its
distance there is sometimes above its held-out average and sometimes below.

How each moves, honestly. Evolution's two-legged creature hops and lunges, off the ground a third of
the time with nothing to clear; its four-legged one shuffles with its feet down (air 0.06) but at
twice practice's cost a metre, and stops at the first hard piece. Practice's two-legged creature
leaves the ground about a fifth of the time with nothing to clear, less as the worlds get harder,
and goes low, on its knees and belly, pushing itself along in short lunges; its four-legged one
runs crouched with its feet mostly down and short bounds between (air 0.10 to 0.15), which is the
more alive of the two to watch. Neither has found a walk with a foot always down.

**Does a brain practised on easy worlds do better on hard ones?** Practice that spent its first 10
million steps in worlds of difficulty 0.1 and the next 10 million in 0.8, measured all along in
held-out worlds of 0.8, against practice in 0.8 from the start (the rows above), five seeds each:

| legs | at 10 M, easy only so far | at 10 M, hard from the start | at 20 M, easy then hard | at 20 M, hard from the start |
|---|---|---|---|---|
| 2 | 9.0 ± 1.8 m | 8.1 ± 1.1 m | 10.7 ± 0.7 m | 10.6 ± 2.5 m |
| 4 | 15.2 ± 4.4 m | 15.7 ± 4.9 m | 15.8 ± 5.2 m | 16.4 ± 4.8 m |

What it learns in easy worlds carries over whole: a brain that has never practised in a hard world
does as well in hard ones as a brain that practised only there for as long. But it does no better,
and practising first in easy worlds gains nothing by the end. So the page has no curriculum (one is
in `Practice::with_curriculum`, unused).

### The generalist's functions

In `public/wasm/generalist.wasm` (`src/generalist/api.rs`, the work in `src/generalist/page.rs`). One
creature and its learning per module instance. A function that gives a list gives a pointer, and
`length()` then gives how many f32 it holds; read them as with the Walker's.

- `create(legs, seed, difficulty, ground, hazards, boxes, moving, population, hidden, layers, memory, seconds, brain_seed) -> u32`
  Two or four legs, in the world of the recipe (seed, a difficulty and four amounts from 0 to 1),
  learning by evolution with `population` brains of `layers` hidden layers of `hidden` neurons and
  `memory` memories, runs of `seconds` (30 if 0), first brains drawn from `brain_seed`. Returns the
  number of weights in a brain, or 0.
- Learning, as the Walker's: `train(runs)`, `generation()`, `generation_runs()`, `best_score()`,
  `best_distance()`, `weights_length()`, `population_length()`, `best_weights()`,
  `population_weights()`, `history_best()`, `history_mean()`, `history_distance()` (the furthest of
  each generation), `evaluate_room(count)`, `evaluate(count)`, `evaluated()`, `member_scored(i)`,
  `record(i, score, distance)`, `weights_room()`, `weights_load()`.
- The show, the best brain so far walking the world from the start, playing the very run it was
  scored on unless it is touched: `show_reset()`, `show_step(seconds) -> steps`, `show_over()`,
  `show_end()` (how it ended: 0 going, 1 time, 2 down, 3 stalled, 4 hazard, 5 fell),
  `show_distance()`, `show_furthest()`, `show_score()`, `show_seconds()`,
  `legs_length()`, `show_bodies()` (six f32 a body as the Walker's: the torso, then each leg's upper
  and lower part), `show_things()` (six f32 for each box, moving platform and see-saw plank made: 0, 1
  or 2 for which, x, y, angle, half width, half height), `show_rays()` (the eye's x and y, then for
  each ray its distance and what it saw: 0 nothing, 1 ground, 2 an edge, 3 a box, 4 a hazard, 5 a
  moving thing, 6 food), `ray_angles()` (the moving eye's, where it looks now, for practice's creature),
  `show_food()` (two f32 for each piece of food put out: x, y), `show_needs()` (six f32: energy, or -1 for
  a creature that does not eat, how strong its muscles are, just ate, resting, where its eye looks,
  pieces eaten in this run), `show_senses()` (what it sensed at its last look, as its brain took it),
  `show_drop_food(x, y)` (drops a piece of food there, 1 if it did),
  `show_under(x, y)` (what a press there would take hold of: 0 nothing, 1 the creature, 2 a box, a
  moving platform or a see-saw's plank), `show_grab(x, y)` (takes hold of it with the hand, "Touching
  it"), `show_hand(x, y)` (moves the hand), `show_let_go()`, `show_held()` (five f32: what is held, as
  `show_under` says, where the hand is, and where on the thing it holds). While the creature is held
  its run is judged, but nothing is paid but its effort and nothing but its time ends it. Positions
  are in metres from the start.
- The world to draw: `land_ground(until, from)` (the world made at least to `until` metres; four f32
  for each piece of ground from number `from` on), `land_blocks(from)` (four f32 for each floating
  platform), `land_hazards(from)` (five: the box, then 0 water or 1 spikes), `picture(count)` (what
  the show's creature would see, `count` greyscale pixels).
- For a learner: `envs_create(count, alike)`, `envs_actions()`, `envs_step(steps)`,
  `envs_observations()`, `envs_rewards()`, `envs_done()`, `senses_length()`, `actions_length()`,
  `rays_length()`.

The module is 331 KiB with SIMD, 326 KiB without (320 and 310 before it wanted things, 304 and 296 before touch and the hand, 299 and 291 before two legs were asked for a pace,
with the costs on landing and leaning; 295 and 287 before the posture terms for two legs,
which cost 2.8 KiB, and the bonus for taking turns, 1.2 KiB; the gait measures are left out of it; the Walker's is 131 KiB, the physics alone
37 KiB; what the generalist added to the Walker's own module is 1.3 KiB of physics it does not use,
which the compiler mostly leaves out). Learning by practice costs 94 KiB of that: before it the module
was 190 KiB; the brain's picture costs 11 KiB more. The functions for practice (`practice_create`,
`practice_update`, `practice_local`, `practice_weights`, `practice_shares_room`,
`practice_weights_room`, `practice_finish`, `practice_state`, `practice_running`, `state_room`,
`running_room`, `practice_load`, `policy_load`, `policy_off`, `show_rewards`, `brain_picture` and a
few numbers) are described where they are, in `src/generalist/api.rs`. `src/minis/generalist.test.ts` holds it to the native engine's
fingerprint of three creatures' 600 steps and three generations of evolution, to the bit, with SIMD
and without.

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
- **A hand** (`physics::Hand`, `World::hold`, `World::let_go`), for touching the world (below,
  "Touching it"): a spring with a damper from a point of one body to where the hand is, solved as a
  soft constraint in the pushing pass of each substep, as Box2D's mouse joint is, with a cap on its
  force. It never sets where a body is or how fast it goes. While it holds a body, that body and the
  others of its group look for contacts as far ahead as they could go in the step (`World::reach`:
  `AHEAD` and their speed and spin times a step), so the solver sees a thin thing coming and nothing
  dragged goes through it; with nothing held every body looks `AHEAD`, as before, and every result is
  the same to the bit. And `World::pressed`, how hard everything touching a body pushed on it in the
  last substep, which touch reads. The Walker's module carries the hand without using it: 2.9 KiB
  more (128 to 131 KiB with SIMD).

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
