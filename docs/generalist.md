# The generalist

A draft mini at `/minis/generalist/`: a creature that sees, learns and gets about a generated world by
itself, in the visitor's browser. It is a second mini on the Walker's Rust engine (`walker.md`), with its own
module, and the start of a longer piece of work toward a creature that learns general ways of moving and
doing things, all written from scratch in that engine. An article about it is planned.

## Where the code is

- `walker/src/generalist/`: the engine side, behind the crate's `generalist` feature. `walker/README.md`,
  section "The generalist", is the full reference, with every measurement.
- `public/wasm/generalist.wasm` (and its scalar twin): the built module, 494 KiB with SIMD.
- `src/minis/generalist.ts`: the page's scene; `src/minis/roaming.ts`: what the page and its workers share;
  `src/scripts/generalist-worker.ts` (evolution) and `src/scripts/generalist-practice.ts` (practice).
- `src/content/minis/generalist.mdx`: the mini's words. It is marked `draft: true`.
- `design/generalist/LITERATURE.md`: the literature search behind the plans below, with what is new and what
  is already published.

## Built

- **Worlds** from a recipe of six numbers: a seed (a word or a number), a difficulty, and how much of each
  of four kinds of thing (ground features, hazards, boxes to push, things that move). The recipe is in the
  address, so a world is a link. Every piece laid is checked to be crossable by the creature's reach.
- **The body**: the Walker's two- and four-legged creatures, with a hop for evolution.
- **Sight**: sixteen rays from its eye, held level, each saying how near the first thing is and what kind
  it is (food among them). Practice's creatures turn their eye: the rays are a fan round where it looks,
  close together in the middle and far apart at the edges, and where to look is one of its actions. A
  greyscale picture strip from the same world is made and tested but given to no brain yet.
- **Learning by evolution**, as the Walker's, and **learning by practice**: proximal policy optimisation
  written from scratch, with its own network and hand-written backward pass. Practice runs in up to four
  workers in the browser, every run in a fresh world of the visitor's kind, measured on held-out worlds.
  Practice has no hop.
- **How it moves** is shaped by costs: on the motors' work, on time in the air with nothing ahead to clear,
  and on a fall. For two legs, posture terms (a run ends at the first touch of the body; costs for a knee
  down and for leaning; a bonus for being carried tall), a cost on how hard a foot lands, progress paid up
  to 1 m/s and no faster, and a cost for a run that gets nowhere. Two legs no longer sense the legs'
  rhythm, and the reward for exactly one foot down is gone (13 November 2026).
- **The page**: a wide mini, the world on the left and a column on the right: the controls folded at its
  top, then the brain drawn live from the first second with the eye's neuron ringed, what it senses (each
  ray, touch on its body and feet, held, the jolt) and its energy as a bar, then a chart of how far it
  gets. Its body glows with its energy, food is a plain dot, a dashed line goes from its eye to where it
  looks, and a tap on nothing drops food. Nothing is narrated: the reward words over it are gone. The page
  opens on practice: a creature that knows nothing,
  learning from the first second; nothing trained is shipped. What is learned is kept in the browser, one
  learner for each body, and taken up again next visit; a new world goes on with it, a new body takes up
  its own or starts afresh, and the page says which; "start over" forgets it.
- **Touching it** (13 November 2026, stage 1 of the plan): a press takes hold of the creature by the part
  pressed, or of a box, a moving platform or a see-saw, with a hand that is a spring with a damper and a
  cap on its force (`walker/src/physics`, `Hand`): what is held hangs and swings, a heavy thing lags, and
  nothing dragged passes through anything. The pointer is a hand over what can be taken; a finger drags
  without the page scrolling; Space takes hold and lets go and the arrows move the hand. A moving platform
  taken is a heavy thing while held and stays where it is let go of. Practice's creatures feel touch: how
  hard things press on the body and each foot, a hand holding them, and the jolt the body feels. While
  held, nothing is paid but effort and nothing but time ends a run.
- **It wants things** (14 November 2026, stage 2 of the plan): energy that the motors' work and being
  awake spend, and eating and resting restore; tired, its muscles weaken, and nothing ends a run for
  hunger. Food is laid with the land and now and then appears near it. It is paid for the fall in its
  discomfort (so eating pays more when hungry), for new places and new things seen (curiosity, which
  pays a bounded sum for anything it comes back to), and still for progress. One practice run in five is
  play: energy held full, no food, no progress paid. `walker/README.md`, "It wants things", has every
  term and number.
- **The brain that was discussed** (14 November 2026, stage 3 of the plan): a pool of neurons between the
  two plain layers of 64, each reading a few others: memory neurons with a gate and a time constant of their
  own, whose reads are plastic (a fast weight on each, changed during a run by a Hebbian rule whose rate and
  decay are learned); rhythms whose pace the brain sets; and moods that turn groups of the plain neurons up
  or down, reading first what it feels of its energy and touch. Learned back through windows of a second.
  The page starts with 32 memory neurons, 4 rhythms and 4 moods reading 16 each (168 neurons), and three
  sliders (memory up to 128, rhythm up to 16, connections 4 to 32) reshape it keeping what was learned. The
  brain is drawn by kind, and a press on a neuron shows all it listens to. `walker/README.md`, "The brain
  that was discussed", has every number.
- **A world that changes while it lives** (15 November 2026, stage 4 of the plan): the ground's grip
  (from ice to sticky, as a share of the creature's own), how it bounces and how soft it is (feet sink into
  it, `physics::World::give`), gravity, a wind (a push along the way) and the light are conditions of the
  world (`changes.rs`); in practice they change by stretches as a setting has it, and boxes and food are
  dropped near the creature. At night it sees a quarter as far. It hears a box or food land, ahead of it or
  behind, fainter with distance. A predictor of what it will see next (`expect.rs`, 50 weights shared by the
  rays) is learned beside the policy; its surprise is a sense and, above what it is used to, a small reward.
  The teacher (`teacher.rs`) breeds eight world settings toward runs it comes through half the time. On the
  page the folded controls set the ground, gravity, the wind and the light (each resting where the world
  always was), let the world change by itself (off unless switched on), and choose whether a tap drops food
  or a box; the changes are drawn, the brain's thickened lines count from the last change, and its surprise
  is a trace. `walker/README.md`, "A world that changes while it lives", has every number.
- **The risky bet** (15 November 2026, stage 5 of the plan): a pool whose memory neurons add and cut their
  connections while it lives (`wiring.rs`). Each of a memory neuron's 16 places holds a connection or not; a
  rule of seven numbers joins the empty place where the two neurons have been most active together and cuts
  the connection that carries least, every half second, moved by surprise and eating and readier to cut when
  short of energy. Each connection costs energy from the body (a whole brain as much as being awake), so a
  hungry brain thins. The rule was found by evolution (`examples/rule.rs`), each candidate practising from
  scratch; the page carries its seven numbers. It measured no better than stage 4's brain on anything, and
  does not recover its pace within a change. On the page a switch under "brain", off as it opens, turns it
  on, and the brain's picture shows connections growing and drawing back and what they cost.
  `walker/README.md`, "The risky bet", has every number.
- **Measures**: a gait measure that says whether a run counts as walking, printed three ways (in the
  held-out worlds as a whole, which is the test; on open ground in them; on level ground); a comparison of evolution and
  practice on the same compute (practice goes three to six times as far through unseen worlds for about
  half the motors' work); a test of practising on easy worlds first, which gained nothing by the end.

## Decided, not yet built

The order of work: speed, then the world and the rays, then practice, then the teacher, then curiosity and
needs, then the small vision encoder and the picture experiment. The first three are done.

**The constraint: nothing cruel is done to the creature.** No broken legs and no blinding. Adaptation is
shown by changing the world while it lives: the ground (slippery, sticky, bouncy, soft), gravity and wind,
day and night (it sees less far in the dark), and things dropped in front of it (a box, a wall, food, a gap).

**What moves it.** Both curiosity (a reward for reaching and seeing what it has not before) and needs
(energy that runs down, food to find). Out of energy it gets tired and recovers: muscles weaken, it slows,
and connections it cannot pay for go quiet until it eats. It never dies of hunger. It rests to recover; the
means to practise in imagination (a world model) are there from the start, and whether and how it uses them
is left for it to find.

**How it moves.** No rule about how to move: costs on wasted effort and on leaving the ground when there is
nothing to clear. The reward for one foot down was a rule of that kind and is gone; so is the steady
rhythm two legs used to sense, a beat to step to.

**Sight.** Rays first; a picture later, as its own experiment. A very small vision encoder, made in the Rust
engine, is shipped as a base to learn on, since sight is slow to learn. It is trained once on the owner's
machine, on pictures the world generator draws; the run is to be agreed with the owner before it starts,
since it uses the processor for a while. Nothing else is trained ahead.

**Where it learns.** Only in the visitor's browser, so it must learn fast and efficiently. The graphics card
for the brain's arithmetic (WebGPU) and buffers handed over without copying are to be added and measured
(SIMD is in already). Shared memory between workers would need the page isolated by two headers, as
mdQuire's pages are; that is to be agreed before it is added for this page.

**The teacher.** A teacher that evolves worlds to stay at the edge of what the creature can do, after ACCEL.

**The brain.** A cap on the number of neurons, with growth and change going mostly into connections.
Kinds of neuron wanted: rhythm neurons the brain conducts; connections that change during a run by a
learned rule; neurons with their own memory and timing; mood neurons that turn the rest up or down; and
kinds of neuron the model builds itself. A visitor shapes the brain with a few sliders within limits (how
much memory, how much rhythm, how many connections it may afford), and the brain is laid out from them.
Changing its shape keeps what it can: existing neurons and connections keep their learning, new ones start
blank.

**The risky bet, then the safe base.** First: a brain of a fixed number of neurons that adds and cuts
connections while it lives, each paid for in energy from the food it finds, the rule for adding and cutting
having three or four numbers found by evolution while practice trains the weights. Then, if that works:
neurons whose whole rule is an evolved program with practice inside. The safe base, all four parts: memory,
rhythm and mood neurons; self-adjusting connections, shown by changing the world; curiosity, food and energy;
the teacher.

**Culture.** Each new creature watches the last one's best runs, then practises. It was arrived at
independently and is also published (Cook, Lu, Hughes, Leibo and Foerster, NeurIPS 2024); the article says
both, with the paper named.

**Senses.** Eyes it moves, sharp in the middle (a neuron for looking around); touch on the feet, body and
arms; hearing or smell (things give off a signal that fades with distance).

**Doing.** Find food and stay alive; use things (push a box to a ledge, ride a platform, press a switch);
play (stretches with no task, rewarded for trying new things); meet another one.

**Two creatures.** Rivals for the same food and helpers with things one cannot do alone, with no rule about
which. They can communicate by a voice of a few tones, fainter with distance, and by seeing each other's
bodies. The page draws the calls, plays them as soft sounds, and writes a plain guess at what a call tends to
mean, marked as a guess.

**Saving.** A creature downloads as a small file and loads again.

**The page.** It opens on a newborn falling over. The brain is drawn live beside the world from the first
second: no narration, no marked firsts, no speed-up control. World on the left, a column on the right with
the controls folding open from its top, then the brain, the senses and the energy.

**The article.** Numbers are kept from the start. First a short story of building it (how a walking toy
turned into this, what broke, what surprised), then a technical write-up kept simple: methods, numbers,
comparisons and the commands to rerun them. Claims are narrow and honest: each says what was searched, and
everything else is known methods rebuilt from scratch, compared fairly, playable in a tab. Already known and
not to be claimed: hard 2D parkour was reported open in 2021; training walkers in a browser has been done
(rlsim, rl-forge, on TensorFlow.js); comparing evolution with reinforcement learning in general is
well-trodden.

## Open

- **Stage 5, for her to say** (15 November 2026). Whether the growing brain stays on the page behind its
  switch (off as it opens) or is taken out: it measured no better than stage 4's brain, but it is something
  a visitor can watch, connections growing and drawing back with what they cost, and the code is small and
  behind one setting. Its price: a whole brain costs as much energy as being awake (a quarter of all its
  energy a minute); on the page a hungry creature thinned to about a quarter of its places, and with
  connections free the learners had more energy and went as far. Whether the switch should be remembered
  between visits (it is not). The words under the brain ("134 connections, 7% a minute").
- **Stage 5, still open.** Neurons whose whole rule is an evolved program were not started, since the plan
  makes them depend on the growing brain working. Evolution of the rule was too noisy to tell rules apart
  in three million steps on one seed a generation; a search that is to find anything needs several seeds a
  candidate, or longer practice, which is hours of the machine. The page's switch shows connections change
  but not why they help, since they do not measurably help. The surprise and eating the rule reads move it
  little in the rule found.
- **The page text, after stage 5,** would need to say: that a switch under "brain" lets its memory neurons
  add and cut connections as it lives, each paid for from its energy, and that the brain then shows them
  growing and drawing back and what they cost; and, for the article, that this was the risky bet and it
  did not measurably help.

- **Stage 4, for her to say** (15 November 2026). Whether practice keeps the teacher or settings drawn evenly:
  for two legs, on the same steps, neither learned faster or went further; for four legs settings drawn
  evenly went further and steadier (30.7 ± 3.7 m against 21.9 ± 11.8, one taught seed of four standing still,
  28.3 m without it). The teacher is the default (`Way::of`, `Changing::Taught`) because the plan asks for it
  and it shows worlds asking more as the creature can do more; `Changing::Even` is one word away, and the
  view here is that four legs at least would do better with it. Whether surprise should be paid 3 a unit
  rather than 1: two legs went further (15.6 m against 13.2) and looked as much, but bounded more. What the teacher scores by: coming through a run
  (lasting its time without falling or stalling), at which two legs succeed about a quarter of the time in
  any setting, so its settings drift more than they are chosen. The wind's strength: a wind from ahead at
  4 m/s² stops two legs and most fall (0.7 to 0.8 of runs), so it may be too strong for the page's slider
  at 6. Whether surprise should be paid at all: paid at 1 a unit it is a small share of the reward; at 0
  (a sense only) and at 3 the eye and the distance are in `walker/README.md`. The page's changing world
  (`page::CHANGING`, some of everything every eight seconds or so) and whether the controls of the world
  should be remembered between visits (they are not: the page opens on the world at rest).
- **Stage 4, still open.** It never turns for food it heard land behind it, though it hears it (0.4 loud)
  and has the memory to keep it. It does not look up when night falls or the wind rises; it looks at a box
  that just landed ahead about a quarter of the time (three seeds in four; a tenth before). The plastic
  connections are not shown to adapt better than a plain network or a creature that never practised
  changes. A teacher's settings are not kept with the learner: a learner taken back starts its teacher again.
- **The page text, after stage 4,** would need to say: that the ground, gravity, a wind and the light can be
  changed while it walks, under "as it lives" in the controls, and the world let change by itself; that at
  night it sees only what its own eye reaches; that it hears things land; that a tap can drop a box; and that
  the brain shows a trace of its surprise and the connections changed since the world last changed.

- **Stage 3, for her to say** (14 November 2026). The page's brain (32 memory neurons, 4 rhythms, 4 moods,
  16 reads each) and the caps (128, 16, 32 reads), set by speed in the browser. Four legs paying for a run
  that stalls, as two legs do (without it, with a pool, two seeds in four stood still; with it the pool goes
  about as far as the plain network under the same cost, less far than the plain network without it). Four
  legs on the page starting each run full rather than carrying their energy (carried, they spent four fifths
  of their time with less than a tenth). Practice using every core up to four at "all it has" and all but
  one at "normal" (three on a four-core machine, where it used two). Learners kept before the pool are taken
  up as plain networks and grown, not forgotten (store version 5). The second plain layer's lines from the
  first are not drawn, so the pool's into it can be seen. The ground going slippery is in the engine
  (`Way::slip`) and not used in practice, since practising with it gained nothing. Whether four legs should stop sensing
  the outside rhythm: with a pool and no clock they went as far and more steadily (28.4 ± 4.3 m against
  27.2 ± 9.2), so a conducted rhythm can take its place; the plain network without it was not measured.
- **Stage 3, still open.** It does not turn for food behind it, with or without memory. Its eye looks at
  things more in the page at two minutes (0.54 to 0.71 of the time near food) but goes back to its feet by
  ten, and natively does no better than an eye at rest: the predictor of what it will see next, with
  surprise as the reason to look, is the next thing to try. The plastic connections did not adapt within a
  run to a ground gone slippery; the pool with them did worse than without. The pool makes two legs bound
  more (in the air for nothing 0.11 of the time against 0.03).
- **The page text, after stage 3,** would need to say: that the brain has kinds of neuron (memory, rhythm,
  mood) beside plain ones, drawn so, and that a press on a neuron shows what it listens to; that three
  sliders under "brain" set how much memory, how much rhythm and how many connections, and that changing
  them keeps what was learned; and that four legs start each run with full energy while two legs keep one
  life.
- **Stage 2, for her to say** (14 November 2026). Whether to keep paying progress: paid only for eating
  and curiosity, both bodies stood still at the start, so progress is still paid and the creature goes on
  because it is paid to, stopping to rest and eat. Whether one run in five as play is right (it made two
  legs walk more cleanly, two in five did about as well). Whether the reward words should stay gone, as
  "no narration" says. Whether a tired creature should be let lie down to rest (two legs' runs still end
  at the first touch of the body, so they rest standing or crouched). Whether food that appears behind it
  should stay, since it has not learned to turn for it. The eye does not yet look at things (it is on the
  nearest thing twice as often as chance, but less often than an eye left looking down ahead would be).
- **The strict walking test as the bar for shipping: decided** (14 November 2026). It is not the bar; it
  stays measured and printed, and the Generalist is judged by watching and by the numbers kept for the
  article. What led to it: after stage 2 the view here was that it should not be the bar: no seed of either body walks by it in the held-out worlds as a whole, before or after, and
  the page's two-legged learner, which walked by it at two minutes in stage 1, no longer does (it leans and
  leaves the ground with nothing to clear 0.13 of the time). What a visitor reads as alive is whether it
  wants something and does something about it; the test stays measured and printed, beside the open and
  level views, as a measure of the gait rather than a gate.

- **Touch, for her to say** (13 November 2026). Two legs practise with a visitor every 8 s who lifts,
  nudges and shoves; four legs feel touch but practise with none, since with one they went less far and
  learned nothing measurable. Whether four legs should have one anyway, and whether 8 s is right, are
  hers. Two legs learned to come through a box dropped or slid into them and a nudge, but not to land
  when let go from a height or by a foot; in the page's own learner the reactions are weaker than in the
  native runs. A moving platform taken by the hand stays level while held and floats where it is let go
  of, as the floating platforms do; whether it should fall instead is hers. The creature on show is never
  learned from, so playing with it changes nothing that is learned.
- **The page text** needs to say, once it is reviewed: that the creature and the boxes and platforms can
  be picked up and moved with the pointer or a finger, or with Space and the arrows; that it feels being
  touched and learns what to do about it by practice, with nothing telling it how; and that a new world
  goes on with what it learned while a new body starts again or takes up its own.

- **The reward for one foot down is gone** (13 November 2026). Without it and with nothing else changed, the
  feet stopped taking turns; it turned out the rhythm in the senses was what made two legs run, and with
  that taken away and progress paid only up to 1 m/s, they take turns without the reward.
- **Which choices to keep, for her to say.** Progress paid up to 1 m/s is a choice of task (go about, do
  not race), not of gait, but it is what made running pointless. The cost on leaning is a posture term,
  as the knee and carried-tall terms were. The cost on a hard landing is a cost. Taking the rhythm out of
  two legs' senses removes a hint; four legs still sense it.
- **Whether the gait test should count what it does at things in its way.** Two legs now walk by the test
  on level ground (three seeds in four) and on open ground in the held-out worlds (two or three in four),
  but not in those worlds as a whole: the strides there vary by 0.4 to 0.55 against 0.35, because waiting
  at a moving platform or stepping short at an edge counts as a stride. The test is unchanged; the open
  view is offered beside it.
- **The page text** (`src/content/minis/generalist.mdx`) still says it learns by evolution and that better
  learning comes next; its controls line was changed and has not been reviewed. Since stage 2 its line
  under the mini says the world and the body are set under the picture, which is no longer so (they fold
  open at the top of the column), and it says nothing of energy, food, the eye, or dropping food with a tap.
- **Whether the page opens on practice or on evolution.** It opens on practice today.
- **Two legs walk on open ground, not yet through a whole world by the test.** No high kick or split now:
  a foot always down, upright, about 1 m/s (walker/README.md, "How two legs came to walk", has every
  number). They go two thirds as far through held-out worlds as before (15 m against 25 in 30 s), since
  they are asked for 1 m/s and slow at things. Four legs trot and bound, as before, to the bit.

## How to run and test

```sh
bun run wasm                                            # builds generalist.wasm with the Walker's module
cd walker && cargo test                                 # both minis; tests/unchanged.rs holds the Walker as it was
bun test src/minis/generalist.test.ts                   # the built module against the native engine, to the bit
cd walker && cargo run --release --example practice     # practice, with its learning curve
cd walker && sh examples/compare.sh                     # evolution against practice (about an hour and a half)
cd walker && cargo run --release --example touched -- legs=2 seed=1 steps=20000000   # whether being touched changes what it does, and helps
cd walker && cargo run --release --example compare -- legs=2 memory=32 rhythm=4 mood=4 reads=16 save=keep/pool   # practice with a pool, keeping the learner
cd walker && cargo run --release --example watch -- kept=keep/pool-20000000 legs=2   # through the page's show: one life, food behind and ahead, the ground going slippery
cd walker && cargo run --release --example brain_cost -- updates=20   # practice's speed for each size of brain
cd walker && cargo run --release --example compare -- legs=2 difficulty=0.2 amounts=0.6,0.4,0.4,0.4 memory=32 rhythm=4 mood=4 reads=16 changing=1 save=keep/even   # practice in worlds drawn evenly (2 the teacher's, 0 still), measured still and changing
cd walker && cargo run --release --example adapt -- kept=keep/even-20000000 legs=2   # the world changed at ten seconds into 200 held-out worlds: pace kept, recovery, falls
cd walker && cargo run --release --example rule -- legs=2 generations=8 population=8 steps=3000000   # the growing brain's rule, by evolution (about 17 minutes on four cores)
cd walker && cargo run --release --example compare -- legs=2 difficulty=0.2 amounts=0.6,0.4,0.4,0.4 memory=32 rhythm=4 mood=4 reads=16 grow=1 save=keep/grow   # the growing brain (rule= and price= for others)
```

## Known weak spots

- Four legs do not walk with a foot always down; they trot and bound. Two legs mostly do now, but one seed
  in four still rocks or leans past the test's limits, and costs that hold the body stiller (on spin,
  bobbing, or a lean cost of 2) leave some learners creeping or limping.
- How far it gets in the one world on show swings from run to run, since a policy better on average can be
  worse at the first thing in that world.
- A learner is about 24,000 numbers and does not fit in a link, so a link carries the world and not the brain.
- Practice uses four workers at most; with more, each has too few creatures and learns less per step. It
  uses what the machine has up to that (all but one core at normal effort).
- Rhythm neurons, mirroring and memory neurons were tried and taken out again in the gait work (the commit
  `walker/README.md` names for them, `61c47e5`, is kept by the tag `gait-trials`): rhythms that drove the legs
  open loop, and memory written by actions with no gradient through time. Stage 3's are built differently:
  rhythms are neurons the rest may read or ignore, and memory is learned back through time.
- Practising with a pool is slower per step in the browser: the page's brain practises at about 63
  percent of the plain network's speed, the largest the sliders allow at about a quarter.
- The engine is 507 KiB with SIMD, 5 KiB under the 512 KiB limit (494 before stage 5, 451 before stage 4, 331
  before the pool). Stage 5's first build was over it; writing a few things once rather than at every use
  brought it back, and anything more for the page will need the same care or a decision on the limit.
- Centred actions and a curriculum are in the code and unused, and so are the trial knobs of the gait work
  (shorter hips, costs on spin, bobbing, joint speed and torque, easing, the top pace's other values).
