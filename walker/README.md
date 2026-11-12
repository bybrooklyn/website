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
- `src/body.rs`: the creature, built from a number of legs (1, 2 or 4), each with a hip and a knee.
- `src/brain.rs`: a network of one hidden layer of 12 neurons, its weights one flat list of f32.
- `src/learn.rs`: evolution with a seeded random generator, run in slices.
- `src/show.rs`: one brain running in real time, and a whole generation at once.
- `src/api.rs`: the functions the page calls, listed below.

## Building and testing

```sh
bun run wasm          # builds the module, copies it to public/wasm/walker.wasm, checks its size
cargo test            # in walker/: the physics, the body, the brain and the learning
bun test src/minis/walker.test.ts   # the built module, from the page's side
```

`bun run wasm` fails if the module is over 512 KiB, or if the physics built alone
(`cargo build --no-default-features`) is over 50 KiB. The built module is committed, so the site
builds without Rust.

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

- `create(legs: u32, population: u32, seconds: f32, seed: u32) -> u32`
  Makes a new walker on flat ground, replacing any before it. `legs` is 1, 2 or 4. `population` is
  the number of brains in a generation (2 to 1000; 32 is a good choice). `seconds` is how long each
  brain is run when training (10 if 0 or less, at most 120). `seed` starts the random numbers; the
  same seed learns the same way. Returns the number of weights in one brain, or 0 if `legs` is not
  1, 2 or 4.
- `ground_room(pieces: u32) -> *mut f32`
  Room for `pieces` pieces of ground, four f32 each: x1, y1, x2, y2. Write them there, then call
  `ground_set`. The pieces may come in any order and need not join, so gaps are allowed. The
  creature starts at x = 0, its feet on the highest ground there.
- `ground_set(pieces: u32) -> u32`
  Puts the walker on the ground written into `ground_room`. Training carries on, but the current
  generation is run again and the best brain is scored again, on the new ground. The show starts
  again, and so does the crowd if it is running. With 0 pieces the ground is flat again. Returns 1.

### Training

- `train(runs: u32) -> u32`
  Runs up to `runs` brains, each for `seconds` from the same start, and returns the number of
  generations finished. When a generation is finished the next is bred at once. One run of 10 s
  takes about 2 ms, so 4 to 8 runs a frame leaves the page responsive.
- `generation() -> u32` The number of generations finished.
- `generation_runs() -> u32` How many brains of the current generation have been scored.
- `best_score() -> f32` The best score so far, minus infinity before the first generation ends.
  A score is the distance the torso went forward, less 1 for each second the torso lay on the
  ground and 0.00005 for each joule of work the motors did. A run ends early once the torso has lain
  down for a second.
- `history_length() -> u32` The number of finished generations.
- `history_best() -> *const f32` The best score of each finished generation, `history_length` f32.
- `history_mean() -> *const f32` The average score of each, `history_length` f32.

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

The weights are, in order: for each hidden neuron its weight for every sense, then the 12 hidden
biases, then for each output its weight for every hidden neuron, then the output biases.

### The show: one walker in real time

- `show_reset()` Starts the show from the start with the best brain so far, or a random one before
  the first generation is finished.
- `show_step(seconds: f32) -> u32` Moves on by `seconds` in whole steps of 1/60 s, the brain
  deciding before each, and keeps the remainder for next time. Returns the steps taken, at most 8.
- `show_push(x: f32, y: f32, impulse_x: f32, impulse_y: f32) -> i32` Pushes the body nearest the
  point (x, y), at that point, with an impulse in newton seconds (the walker weighs about 10 kg, so
  20 is a firm shove). Returns the body's number.
- `body_count() -> u32` The number of bodies: the torso first, then each leg's upper and lower part.
  5 for two legs, 9 for four.
- `show_bodies() -> *const f32` Six f32 for each body: x, y, angle, kind (0 circle, 1 capsule,
  2 box), and two sizes: a circle's radius and 0, a capsule's half length (without its round ends)
  and radius, a box's half width and half height. A capsule lies along its own x axis.
- `show_distance() -> f32` How far the torso has gone forward since the start.
- `senses_length() -> u32`, `hidden_length() -> u32`, `outputs_length() -> u32` The sizes of the
  brain's three layers.
- `show_senses() -> *const f32` What the walker sensed before its last step, in this order: the
  torso's angle; its spin times 0.2; its height above the ground under it (0 to 2, and 2 over a gap);
  its speed forward and up, each times 0.25; for each joint (hip then knee, leg by leg) its angle and
  its speed times 0.1; for each foot 1 if it is on the ground, else 0; and the sine and cosine of a
  clock going round 1.2 times a second.
- `show_hidden() -> *const f32` What each hidden neuron gave, -1 to 1.
- `show_outputs() -> *const f32` What each output gave, -1 to 1: the target for each joint, from
  one end of its range (-1) to the other (1). A hip turns from -1.0 (back) to 1.3 (forward) and a
  knee from -2.0 (bent back) to 0 (straight).
- `show_weights() -> *const f32` The weights the show runs on, to draw the brain's connections.

### The crowd: a whole generation at once

- `crowd_reset() -> u32` Starts every brain of the current generation walking from the start, each
  in a world of its own. Returns how many walkers there are.
- `crowd_step(seconds: f32) -> u32` Moves them all on, as `show_step` does.
- `crowd_bodies() -> *const f32` Walker after walker, `body_count` bodies each, three f32 for each
  body: x, y and angle. The shapes and sizes are the show's.
- `crowd_stop()` Stops the crowd and frees its worlds.

## The physics alone

Built with `cargo build --release --target wasm32-unknown-unknown --no-default-features`, the module
holds only the physics, with these functions instead (about 26 KiB):

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

## Credit

The soft step solver and the way contacts are found follow Erin Catto's Box2D 3 (MIT), rewritten
here in a much smaller form. The sine and cosine polynomials are musl's.
