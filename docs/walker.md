# Walker

A mini at `/minis/walker/` in which a little creature, seen from the side, learns to walk in the visitor's
browser. Its engine is a Rust crate built to plain WebAssembly: a small 2D physics engine, a body of one,
two or four legs, a small neural network and evolution. The generalist (`generalist.md`) is a second mini on
the same engine.

## Where the code is

- `walker/`: the Rust crate. `walker/README.md` is the full reference: the physics, the body, the brain,
  the goals and their scores, and every function the page calls.
- `public/wasm/walker.wasm` and `walker-scalar.wasm`: the built modules, committed so the site builds
  without Rust.
- `src/minis/walker.ts`: the page's scene; `src/minis/walking.ts`: what the page and its worker share;
  `src/scripts/walker-worker.ts`: training in workers.
- `src/content/minis/walker.mdx`: the mini's words.

## Built

- The physics: circles, capsules and boxes; ground of straight pieces (flat, hilly, stepped, with gaps);
  hinges with limits and motors; fixed steps of 1/60 s solved after Box2D 3's soft step. The same start
  gives the same end to the bit, natively and in every browser, because the module brings its own maths.
- A body of one, two or four legs; a brain of one to four hidden layers with a little memory, offered in
  three sizes by name; legs that keep a rhythm, with the brain shaping each joint's swing to it.
- Goals: go far, go fast, stand tall, jump, the obstacle course, carry a parcel. Every score also counts how
  it moves (upright, feet taking turns, without sliding or twitching).
- Two ways to learn: a generation at a time (evolution, 32 brains, run in workers) or one walker live, each
  attempt a nudged copy of the best, kept if better.
- Runs of a set length or an endless walk on ground laid ahead; pushing the walker; the whole generation at
  once as a crowd; a trained brain shared as a link.
- Speed: batched stepping with WebAssembly SIMD (and a scalar twin for older browsers, giving the same
  numbers), and training spread over workers at an effort the visitor chooses, so it learns many times
  faster without taking over the machine.

## Decided

- Seen from the side, in 2D. The creature is set up by how many legs it has.
- In Rust compiled to WebAssembly, a couple of crates at most, as small as possible: each module under
  512 KiB, the physics alone under 80 KiB (`bun run wasm` fails otherwise).
- Learning is shown three ways: the best so far walking, a whole generation at once, and its brain drawn as
  it decides.
- A visitor can change the ground, push the walker, and save and share a trained walker as a link.
- The controls for the ground run along the bottom and the rest sit in a column at the side. The whole
  mini is to be fluid, good to look at and pleasant to use.
- The Walker stays as it is; the generalist is a second mini beside it, on the same engine.

## Open

- Whether Dice and Blocks should ever move onto this Rust physics engine. A later question.

## How to run and test

```sh
bun run wasm                          # builds both modules into public/wasm/ and checks their sizes
cd walker && cargo test               # the physics, the body, the brain, the learning
bun test src/minis/walker.test.ts     # the built module, from the page's side
cd walker && cargo run --release --example speed   # how fast training goes, and where the time goes
```

## Known weak spots

- One walker per module instance; two walkers need two instances.
- Memory can grow during any call, so a view of the module's memory must be made again after each call.
- A one-legged walker hops as a pogo stick is ridden; it balances only because its body is made much
  harder to tip than a plain block.
