//! Learning to walk, by evolution. A generation is a population of brains. Each one is put in charge
//! of its own copy of the same creature on the same ground for a few seconds and scored by its goal
//! (`Goal`). The best few go on unchanged, and the rest of the next generation are their children: a
//! mix of two parents' weights, nudged at random here and there.
//!
//! A run is judged step by step (`Judge`), the same way in training and in the show, so the page can
//! play the best brain's run again exactly as it was scored and know when it ended.
//!
//! Training goes in slices (`train`), each a few runs long, so the page can draw between them. The
//! randomness comes from a generator of its own with a seed, so the same seed learns the same way.

use alloc::vec;
use alloc::vec::Vec;

use crate::body::{Creature, Description};
use crate::brain::{Brain, Layout};
use crate::math::{Vec2, clamp, sqrt};
use crate::physics::{STEP, Segment, World};

/// What each second of body on the ground costs, in metres of score, and each second of a knee on it.
const DOWN_COST: f32 = 1.0;
const KNEE_COST: f32 = 1.0;
/// What each second on its feet earns, going far or fast, in metres of score.
const UP_REWARD: f32 = 0.25;
/// What each second in the air going forward earns for the goals other than jumping, in metres of
/// score: a small push toward the hops a one-legged walker needs to get anywhere.
const AIR_REWARD: f32 = 0.5;
/// What each joule of motor work costs, in metres of score.
const WORK_COST: f32 = 0.0002;
/// How a walker moves counts too, for every goal, so that what it learns looks like walking. Each
/// second with the body carried upright and high earns this much, each second with its feet taking
/// turns this much, each second of a foot sliding along the ground costs this much, and so does each
/// sudden change in what the brain asks of the legs.
const CARRIED_REWARD: f32 = 0.5;
const TURNS_REWARD: f32 = 0.4;
const SLIDE_COST: f32 = 0.5;
const JERK_COST: f32 = 0.002;
/// A run ends once the body has lain on the ground this long, in seconds. The creature has fallen,
/// and watching it lie there teaches nothing.
const DOWN_LIMIT: f32 = 1.0;
/// What a run that ends in a fall costs besides, in metres of score. More than a dive forward gains,
/// so a walker learns first to stay up, and only then to go.
const FALL_COST: f32 = 3.0;

/// What a walker is rewarded for.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Goal {
    /// Go as far as it can in ten seconds.
    Far,
    /// Go as far as it can in four seconds.
    Fast,
    /// Go forward with the body held as high and upright as it stood.
    Tall,
    /// Go forward, with time in the air going forward, without putting a foot down in a gap.
    Jump,
    /// Get as far along the obstacle course as it can in twenty seconds.
    Course,
    /// Go as far as it can with a ball on its back, without dropping it.
    Carry,
}

impl Goal {
    /// The goal for each number the page uses: 0 far, 1 fast, 2 tall, 3 jump, 4 the course, 5 carry.
    pub fn from_number(number: u32) -> Goal {
        match number {
            1 => Goal::Fast,
            2 => Goal::Tall,
            3 => Goal::Jump,
            4 => Goal::Course,
            5 => Goal::Carry,
            _ => Goal::Far,
        }
    }

    /// How long a run lasts, in seconds.
    pub fn seconds(self) -> f32 {
        match self {
            Goal::Fast => 4.0,
            Goal::Course => 20.0,
            _ => 10.0,
        }
    }
}

/// Watches one run step by step: what it cost, whether it is over, and at the end its score.
#[derive(Clone, Copy, Debug)]
pub struct Judge {
    pub goal: Goal,
    pub steps: u32,
    pub most_steps: u32,
    pub seconds_down: f32,
    pub seconds_kneeling: f32,
    pub seconds_flying: f32,
    /// How tall the body was held, added up over the steps.
    pub tallness: f32,
    pub work: f32,
    pub seconds_carried: f32,
    pub seconds_turns: f32,
    pub seconds_sliding: f32,
    /// How much the brain's outputs changed from step to step, added up.
    pub jerk: f32,
    last: [f32; 24],
    pub in_gap: bool,
    /// Whether the ball was dropped, carrying.
    pub dropped: bool,
    /// How far a run goes before it is finished, in metres; infinite for a run of the goal's time.
    pub length: f32,
    /// Whether the run reached its length.
    pub finished: bool,
    /// A run with no end but a fall, as the page shows an endless walk.
    pub endless: bool,
    /// Where the body was at the last look, for a run that has stopped getting anywhere.
    checked: f32,
    pub stalled: bool,
    /// Whether a run that stops getting anywhere ends, as a live attempt does.
    pub impatient: bool,
    pub over: bool,
}

/// The slowest pace a run of a set length allows, in metres a second: a run of 10 m may take 25 s.
const SLOWEST: f32 = 0.4;
/// A run ends if the body has gone less than this far in the last this many steps (four seconds).
const STALL_DISTANCE: f32 = 0.2;
const STALL_STEPS: u32 = 240;
/// The shortest run a walker with no set length is trained on, in seconds.
const ENDLESS_SECONDS: f32 = 10.0;
/// What stopping costs a jumper, in metres of score: more than putting a foot in a gap does.
const STALL_COST: f32 = 2.0;
/// What each second left over earns a run that reached its length, in metres of score.
const EARLY_REWARD: f32 = 1.0;

impl Judge {
    /// A judge for runs of `seconds`, or, if `length` is finite, runs that end when the body has gone
    /// that far, with as long as the slowest pace allows (and no less than `seconds`).
    pub fn new(goal: Goal, seconds: f32, length: f32) -> Judge {
        let seconds = if length.is_finite() { (length / SLOWEST).max(seconds).min(120.0) } else { seconds };
        Judge {
            goal,
            steps: 0,
            most_steps: (seconds / STEP) as u32,
            seconds_down: 0.0,
            seconds_kneeling: 0.0,
            seconds_flying: 0.0,
            tallness: 0.0,
            work: 0.0,
            seconds_carried: 0.0,
            seconds_turns: 0.0,
            seconds_sliding: 0.0,
            jerk: 0.0,
            last: [0.0; 24],
            in_gap: false,
            dropped: false,
            length,
            finished: false,
            endless: false,
            checked: 0.0,
            stalled: false,
            // a jumper that stops at the edge of a gap has not jumped: its run ends there, and that costs
            impatient: goal == Goal::Jump,
            over: false,
        }
    }

    /// Takes in a step just taken. Returns true once the run is over: its time is up, the body has
    /// lain down too long, or, jumping, a foot went down in a gap.
    pub fn after_step(&mut self, creature: &Creature, world: &World, outputs: &[f32]) -> bool {
        self.steps += 1;
        for (last, &now) in self.last.iter_mut().zip(outputs) {
            if self.steps > 1 {
                self.jerk += if now > *last { now - *last } else { *last - now };
            }
            *last = now;
        }
        // the manner of moving counts only while going forward, so marching on the spot earns nothing
        let going = clamp(world.bodies[creature.torso as usize].velocity.x / 0.6, 0.0, 1.0);
        if crate::gait::carried(creature, world) {
            self.seconds_carried += STEP * going;
        }
        if crate::gait::taking_turns(creature, world) {
            self.seconds_turns += STEP * going;
        }
        self.seconds_sliding += STEP * crate::gait::sliding(creature, world) as f32;
        self.work += creature.effort(world);
        self.seconds_kneeling += STEP * creature.kneeling(world) as f32;
        self.tallness += creature.tallness(world);
        // time in the air counts only while going forward, so hopping on the spot is not a jump
        if creature.flying(world) && world.bodies[creature.torso as usize].velocity.x > 0.5 {
            self.seconds_flying += STEP;
        }
        if creature.fallen(world) {
            self.seconds_down += STEP;
        }
        if self.goal == Goal::Jump && creature.in_gap(world) {
            self.in_gap = true;
        }
        if self.goal == Goal::Carry && creature.dropped(world) {
            self.dropped = true;
        }
        if creature.distance(world) >= self.length {
            self.finished = true;
        }
        // live, every few seconds: an attempt that has gone almost nowhere since the last look is over,
        // so a walker standing still does not take a long run's time while someone watches
        if self.impatient && self.steps % STALL_STEPS == 0 {
            let at = creature.distance(world);
            self.stalled = at - self.checked < STALL_DISTANCE;
            self.checked = at;
        }
        let fell = self.seconds_down >= DOWN_LIMIT || self.in_gap || self.dropped || self.stalled;
        self.over = fell || !self.endless && (self.steps >= self.most_steps || self.finished);
        self.over
    }

    /// The score of the run so far, with how far it went.
    pub fn outcome(&self, creature: &Creature, world: &World) -> Outcome {
        let distance = creature.distance(world);
        let fell = if self.seconds_down >= DOWN_LIMIT { FALL_COST } else { 0.0 };
        // twitching costs every goal, a jumper's too; the rest of the manner of moving does not count
        // against a leap
        let manner = if self.goal == Goal::Jump { 0.0 } else { CARRIED_REWARD * self.seconds_carried + TURNS_REWARD * self.seconds_turns - SLIDE_COST * self.seconds_sliding } - JERK_COST * self.jerk;
        let costs = fell + DOWN_COST * self.seconds_down + KNEE_COST * self.seconds_kneeling + WORK_COST * self.work - manner;
        let tall = self.tallness / self.steps.max(1) as f32;
        let early = if self.finished { EARLY_REWARD * (self.most_steps - self.steps.min(self.most_steps)) as f32 * STEP } else { 0.0 };
        let distance = distance.min(self.length);
        let score = match self.goal {
            // a little for every second on its feet, so that a dive forward and a fall is not the easy answer
            Goal::Far | Goal::Fast | Goal::Course => distance + UP_REWARD * (self.steps as f32 * STEP - self.seconds_down) + AIR_REWARD * self.seconds_flying,
            // standing tall and still scores a little; tall and going forward scores most
            Goal::Tall => distance * (0.2 + 0.8 * tall) + 2.0 * tall + AIR_REWARD * self.seconds_flying,
            Goal::Jump => 1.5 * distance + self.seconds_flying - if self.in_gap { 1.0 } else { 0.0 } - if self.stalled { STALL_COST } else { 0.0 },
            // distance only while carrying: a dropped ball ends the run and costs as a fall does
            Goal::Carry => distance + UP_REWARD * (self.steps as f32 * STEP - self.seconds_down) - if self.dropped { FALL_COST } else { 0.0 },
        } + early - costs;
        Outcome { score, distance, seconds_down: self.seconds_down, work: self.work }
    }
}

/// A seeded random number generator, SplitMix64. Small, quick and good enough for evolution.
#[derive(Clone, Debug)]
pub struct Random(u64);

impl Random {
    pub fn new(seed: u64) -> Random {
        Random(seed)
    }

    pub fn bits(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e37_79b9_7f4a_7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// A number from 0 up to but not including 1.
    pub fn unit(&mut self) -> f32 {
        (self.bits() >> 40) as f32 / (1u64 << 24) as f32
    }

    /// A whole number from 0 up to but not including `below`.
    pub fn below(&mut self, below: usize) -> usize {
        (((self.bits() >> 32) * below as u64) >> 32) as usize
    }

    /// A number from a bell curve around 0 with a spread of 1, near enough, as the sum of four even
    /// draws.
    pub fn bell(&mut self) -> f32 {
        (self.unit() + self.unit() + self.unit() + self.unit() - 2.0) * sqrt(3.0)
    }
}

/// How one run went.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Outcome {
    pub score: f32,
    pub distance: f32,
    pub seconds_down: f32,
    pub work: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct Settings {
    pub population: usize,
    pub goal: Goal,
    /// How long each run lasts; the goal's own time when zero.
    pub seconds: f32,
    /// How far each run goes, in metres, or infinite for runs of the goal's own time.
    pub length: f32,
    /// Neurons in each hidden layer of the brain, one to four layers, and how many memories.
    pub hidden: usize,
    pub layers: usize,
    pub memory: usize,
    /// How many of the best go on unchanged.
    pub keep: usize,
    /// The chance that a weight is nudged in a child, and how far.
    pub nudge_chance: f32,
    pub nudge_size: f32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { population: 32, goal: Goal::Far, seconds: 0.0, length: f32::INFINITY, hidden: crate::brain::HIDDEN, layers: 1, memory: 0, keep: 4, nudge_chance: 0.1, nudge_size: 0.3 }
    }
}

/// One walker learning live, by climbing: each attempt is the best so far with every weight nudged a
/// little, and it is kept only if it scores better, by the same score a generation uses. The nudges
/// start small, grow after a success and shrink after a failure, so that about one attempt in five
/// does better (Rechenberg's one-fifth rule). It starts from a calm brain, every weight zero, whose
/// legs keep the rhythm and no more, so the first attempt already steps.
#[derive(Clone, Debug)]
pub struct Climber {
    pub best: Vec<f32>,
    pub best_score: f32,
    /// The furthest any kept attempt went, which only ever grows.
    pub furthest: f32,
    /// The attempt now walking, counting from 1.
    pub attempt: u32,
    /// How large a nudge is.
    pub step: f32,
    random: Random,
}

impl Climber {
    /// A climber starting from a calm brain of this layout, its outputs held at the body's stride.
    pub fn new(layout: Layout, description: Description, seed: u64) -> Climber {
        let mut best = vec![0.0; layout.weights()];
        // with every other weight zero, an output is tanh of its bias, so each bias is the stride's
        // value run back through tanh
        let first = layout.weights() - layout.outputs - layout.memory;
        for (k, &value) in description.stride().iter().enumerate().take(layout.outputs) {
            let value = value.clamp(-0.95, 0.95);
            best[first + k] = 0.5 * crate::math::ln((1.0 + value) / (1.0 - value));
        }
        Climber { best, best_score: f32::NEG_INFINITY, furthest: 0.0, attempt: 1, step: 0.3, random: Random::new(seed ^ 0x5eed) }
    }

    /// The first attempt is the calm brain itself; after that, a nudged copy of the best.
    pub fn next(&mut self) -> Vec<f32> {
        let mut child = self.best.clone();
        if self.best_score == f32::NEG_INFINITY {
            return child;
        }
        for weight in &mut child {
            if self.random.unit() < 0.3 {
                *weight += self.step * self.random.bell();
            }
        }
        child
    }

    /// Takes in how an attempt went, keeps it if it did better, and moves on to the next.
    pub fn report(&mut self, weights: &[f32], outcome: Outcome) {
        if outcome.score > self.best_score {
            let first = self.best_score == f32::NEG_INFINITY;
            self.best.copy_from_slice(weights);
            self.best_score = outcome.score;
            self.furthest = self.furthest.max(outcome.distance);
            if !first {
                self.step = (self.step * 1.5).min(1.0);
            }
        } else {
            self.step = (self.step * 0.9).max(0.02);
        }
        self.attempt += 1;
    }
}

pub struct Trainer {
    pub description: Description,
    pub settings: Settings,
    pub layout: Layout,
    /// The world every run starts from, and the creature in it.
    pub start: World,
    pub creature: Creature,
    /// Every brain's weights, one after another.
    pub population: Vec<f32>,
    pub scores: Vec<f32>,
    /// How far each one went, alongside its score.
    pub distances: Vec<f32>,
    pub scored: Vec<bool>,
    /// Generations finished.
    pub generation: u32,
    pub best: Vec<f32>,
    pub best_score: f32,
    /// How far the best so far went.
    pub best_distance: f32,
    /// The best and the average score of each finished generation.
    pub history_best: Vec<f32>,
    pub history_mean: Vec<f32>,
    /// Steps of physics run so far, in every run, to measure how fast training goes.
    pub steps: u64,
    random: Random,
    world: World,
    brain: Brain,
    senses: Vec<f32>,
}

/// Flat ground from far behind the start to far ahead of it.
pub fn flat_ground() -> Vec<Segment> {
    vec![Segment { a: Vec2::new(-20.0, 0.0), b: Vec2::new(1000.0, 0.0) }]
}

impl Trainer {
    pub fn new(description: Description, settings: Settings, ground: &[Segment], seed: u64) -> Option<Trainer> {
        let population = settings.population.max(2);
        // with no set length the walk on screen is endless, so no run is shorter than ten seconds: a walker
        // scored on four seconds would be seen going on untrained, rearing and falling over
        let goal_seconds = if settings.length.is_finite() { settings.goal.seconds() } else { settings.goal.seconds().max(ENDLESS_SECONDS) };
        let seconds = if settings.seconds > 0.0 { settings.seconds } else { goal_seconds };
        let settings = Settings { population, seconds, keep: settings.keep.min(population - 1), ..settings };
        let description = Description { carry: settings.goal == Goal::Carry, leap: settings.goal == Goal::Jump, ..description };
        let mut start = World::new();
        start.set_ground(ground);
        let creature = Creature::build(&mut start, description)?;
        let layout = Layout::sized(description.senses(), description.outputs(), settings.hidden, settings.layers, settings.memory);
        let settings = Settings { hidden: layout.hidden, layers: layout.layers, memory: layout.memory, ..settings };
        let mut random = Random::new(seed);
        let count = layout.weights();
        // first weights about as large as keeps each neuron's sum near its useful range
        let scales = layout.scales();
        let population = (0..settings.population).flat_map(|_| scales.iter().map(|scale| (random.unit() * 2.0 - 1.0) * scale).collect::<Vec<f32>>()).collect();
        Some(Trainer {
            description,
            settings,
            layout,
            world: start.clone(),
            start,
            creature,
            population,
            scores: vec![0.0; settings.population],
            distances: vec![0.0; settings.population],
            scored: vec![false; settings.population],
            generation: 0,
            best: vec![0.0; count],
            best_score: f32::NEG_INFINITY,
            best_distance: 0.0,
            history_best: Vec::new(),
            history_mean: Vec::new(),
            steps: 0,
            random,
            brain: Brain::new(layout),
            senses: vec![0.0; description.senses()],
        })
    }

    pub fn weights(&self, index: usize) -> &[f32] {
        let count = self.layout.weights();
        &self.population[index * count..(index + 1) * count]
    }

    /// A judge for a run of this trainer's goal and length.
    pub fn judge(&self) -> Judge {
        Judge::new(self.settings.goal, self.settings.seconds, self.settings.length)
    }

    /// Runs one brain from the start and scores it.
    pub fn run(&mut self, weights: &[f32]) -> Outcome {
        self.world.copy_from(&self.start);
        self.brain.forget();
        let creature = &self.creature;
        let mut judge = self.judge();
        loop {
            creature.sense(&self.world, &mut self.senses);
            self.brain.think(weights, &self.senses);
            creature.drive(&mut self.world, &self.brain.outputs);
            self.world.step();
            if judge.after_step(creature, &self.world, &self.brain.outputs) {
                break;
            }
        }
        self.steps += judge.steps as u64;
        judge.outcome(creature, &self.world)
    }

    /// Runs one brain from the start, as `run` does, and says how natural its run looked.
    pub fn watch(&mut self, weights: &[f32]) -> crate::gait::Gait {
        self.world.copy_from(&self.start);
        self.brain.forget();
        let creature = &self.creature;
        let mut judge = self.judge();
        let mut watch = crate::gait::Watch::default();
        loop {
            creature.sense(&self.world, &mut self.senses);
            self.brain.think(weights, &self.senses);
            creature.drive(&mut self.world, &self.brain.outputs);
            self.world.step();
            watch.after_step(creature, &self.world);
            if judge.after_step(creature, &self.world, &self.brain.outputs) {
                break;
            }
        }
        watch.gait(creature, &self.world)
    }

    fn run_member(&mut self, index: usize) {
        let weights = self.weights(index).to_vec();
        let outcome = self.run(&weights);
        self.scores[index] = outcome.score;
        self.distances[index] = outcome.distance;
        self.scored[index] = true;
    }

    /// Does up to `runs` runs of training and returns the number of generations finished. A finished
    /// generation breeds the next straight away.
    pub fn train(&mut self, runs: u32) -> u32 {
        for _ in 0..runs {
            match self.scored.iter().position(|scored| !scored) {
                Some(index) => self.run_member(index),
                None => self.breed(),
            }
            if self.scored.iter().all(|scored| *scored) {
                self.breed();
            }
        }
        self.generation
    }

    /// The order of the population from best to worst. Equal scores keep their places, so the order
    /// never depends on anything but the scores.
    fn ranking(&self) -> Vec<usize> {
        let mut order: Vec<usize> = (0..self.settings.population).collect();
        for i in 1..order.len() {
            let mut j = i;
            while j > 0 && self.scores[order[j - 1]] < self.scores[order[j]] {
                order.swap(j - 1, j);
                j -= 1;
            }
        }
        order
    }

    /// The better of three brains picked at random, as a parent.
    fn pick(&mut self) -> usize {
        let mut best = self.random.below(self.settings.population);
        for _ in 0..2 {
            let other = self.random.below(self.settings.population);
            if self.scores[other] > self.scores[best] {
                best = other;
            }
        }
        best
    }

    /// Runs one brain from the start as `run` does and gives back the judge that watched it, for what it
    /// counted along the way.
    pub fn judge_of(&mut self, weights: &[f32]) -> Judge {
        self.world.copy_from(&self.start);
        self.brain.forget();
        let creature = &self.creature;
        let mut judge = self.judge();
        loop {
            creature.sense(&self.world, &mut self.senses);
            self.brain.think(weights, &self.senses);
            creature.drive(&mut self.world, &self.brain.outputs);
            self.world.step();
            if judge.after_step(creature, &self.world, &self.brain.outputs) {
                break;
            }
        }
        judge
    }

    /// Runs one brain from the start under a judge of the caller's, as a live attempt is judged.
    pub fn run_judged(&mut self, weights: &[f32], mut judge: Judge) -> Outcome {
        self.world.copy_from(&self.start);
        self.brain.forget();
        let creature = &self.creature;
        loop {
            creature.sense(&self.world, &mut self.senses);
            self.brain.think(weights, &self.senses);
            creature.drive(&mut self.world, &self.brain.outputs);
            self.world.step();
            if judge.after_step(creature, &self.world, &self.brain.outputs) {
                break;
            }
        }
        judge.outcome(creature, &self.world)
    }

    /// A child of one brain: each weight nudged at random with the usual chance, and at least one.
    pub fn mutate(&mut self, parent: &[f32]) -> Vec<f32> {
        let mut child = parent.to_vec();
        let mut nudged = false;
        for weight in &mut child {
            if self.random.unit() < self.settings.nudge_chance {
                *weight += self.settings.nudge_size * self.random.bell();
                nudged = true;
            }
        }
        if !nudged && !child.is_empty() {
            let at = self.random.below(child.len());
            child[at] += self.settings.nudge_size * self.random.bell();
        }
        child
    }

    /// Scores the generation and makes the next one from it.
    fn breed(&mut self) {
        let order = self.ranking();
        let count = self.layout.weights();
        let top = order[0];
        let mean = self.scores.iter().sum::<f32>() / self.scores.len() as f32;
        self.history_best.push(self.scores[top]);
        self.history_mean.push(mean);
        if self.scores[top] > self.best_score {
            self.best_score = self.scores[top];
            self.best_distance = self.distances[top];
            self.best.copy_from_slice(&self.population[top * count..(top + 1) * count]);
        }

        let mut next = Vec::with_capacity(self.population.len());
        let mut scores = vec![0.0; self.settings.population];
        let mut distances = vec![0.0; self.settings.population];
        let mut scored = vec![false; self.settings.population];
        for (rank, &index) in order.iter().take(self.settings.keep).enumerate() {
            next.extend_from_slice(self.weights(index));
            scores[rank] = self.scores[index];
            distances[rank] = self.distances[index];
            scored[rank] = true;
        }
        for _ in self.settings.keep..self.settings.population {
            let mother = self.pick();
            let father = if self.random.unit() < 0.5 { Some(self.pick()) } else { None };
            for i in 0..count {
                let parent = match father {
                    Some(father) if self.random.bits() & 1 == 1 => father,
                    _ => mother,
                };
                let mut weight = self.population[parent * count + i];
                if self.random.unit() < self.settings.nudge_chance {
                    weight += self.settings.nudge_size * self.random.bell();
                }
                next.push(weight);
            }
        }
        self.population = next;
        self.scores = scores;
        self.distances = distances;
        self.scored = scored;
        self.generation += 1;
    }

    /// Puts the creature on new ground. Every score so far was earned on the old ground, so the
    /// generation is run again, and the best brain is scored afresh.
    pub fn set_ground(&mut self, ground: &[Segment]) {
        let mut start = World::new();
        start.set_ground(ground);
        if let Some(creature) = Creature::build(&mut start, self.description) {
            self.start = start;
            self.creature = creature;
        }
        self.scored.iter_mut().for_each(|scored| *scored = false);
        if self.best_score > f32::NEG_INFINITY {
            let best = self.best.clone();
            let outcome = self.run(&best);
            self.best_score = outcome.score;
            self.best_distance = outcome.distance;
        }
    }

    /// Takes in a brain from outside, from a shared link: it becomes the best so far and joins the
    /// population in place of the first member.
    pub fn load(&mut self, weights: &[f32]) -> bool {
        let count = self.layout.weights();
        if weights.len() != count || weights.iter().any(|w| !w.is_finite()) {
            return false;
        }
        self.best.copy_from_slice(weights);
        let outcome = self.run(weights);
        self.best_score = outcome.score;
        self.best_distance = outcome.distance;
        self.population[..count].copy_from_slice(weights);
        self.scored[0] = false;
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_same_seed_learns_the_same_way() {
        let settings = Settings { population: 6, seconds: 2.0, ..Settings::default() };
        let mut one = Trainer::new(Description { legs: 2, carry: false, leap: false }, settings, &flat_ground(), 7).unwrap();
        let mut two = Trainer::new(Description { legs: 2, carry: false, leap: false }, settings, &flat_ground(), 7).unwrap();
        one.train(20);
        for _ in 0..10 {
            two.train(2);
        }
        assert_eq!(one.generation, 8);
        assert_eq!(one.best.iter().map(|w| w.to_bits()).collect::<Vec<_>>(), two.best.iter().map(|w| w.to_bits()).collect::<Vec<_>>());
        assert_eq!(one.history_best, two.history_best);
    }

    #[test]
    fn a_two_legged_walker_learns_to_go_clearly_further_than_its_first_generation() {
        let settings = Settings::default();
        let mut trainer = Trainer::new(Description { legs: 2, carry: false, leap: false }, settings, &flat_ground(), 1).unwrap();
        let generations = 30;
        let started = std::time::Instant::now();
        trainer.train(settings.population as u32);
        let first = trainer.best.clone();
        let one_generation = started.elapsed();
        while trainer.generation < generations {
            trainer.train(settings.population as u32);
        }
        let first = trainer.run(&first);
        let best = trainer.best.clone();
        let last = trainer.run(&best);
        std::println!("one generation of {} took {:?}", settings.population, one_generation);
        std::println!("generation 0 best: {first:?}");
        std::println!("after {generations} generations: {last:?}");
        std::println!("best score by generation: {:?}", trainer.history_best);
        assert!(last.distance > first.distance + 2.0 && last.distance > 2.0 * first.distance, "went {} after, {} at first", last.distance, first.distance);
        assert!(last.seconds_down == 0.0, "the torso stays up");
    }

    /// Level ground with gaps of 0.4 m every 3 m after the start, for jumping.
    fn gappy() -> Vec<Segment> {
        let mut ground = vec![Segment { a: Vec2::new(-20.0, 0.0), b: Vec2::new(3.0, 0.0) }];
        let mut x = 3.4;
        while x < 200.0 {
            ground.push(Segment { a: Vec2::new(x, 0.0), b: Vec2::new(x + 3.0, 0.0) });
            x += 3.4;
        }
        ground
    }

    /// Trains a two-legged walker for a goal and returns the best score of the first generation and
    /// of the last.
    fn learns(goal: Goal, ground: &[Segment], generations: u32) -> (Outcome, Outcome) {
        let settings = Settings { goal, ..Settings::default() };
        let mut trainer = Trainer::new(Description { legs: 2, carry: false, leap: false }, settings, ground, 3).unwrap();
        trainer.train(settings.population as u32);
        let first = trainer.best.clone();
        while trainer.generation < generations {
            trainer.train(settings.population as u32);
        }
        let first = trainer.run(&first);
        let best = trainer.best.clone();
        let last = trainer.run(&best);
        std::println!("{goal:?}: generation 0 best {first:?}; after {generations} generations {last:?}");
        (first, last)
    }

    #[test]
    fn every_goal_is_learned_better_over_the_generations() {
        let (first, last) = learns(Goal::Fast, &flat_ground(), 40);
        assert!(last.score > first.score + 1.0 && last.distance > 2.0, "fast: {} then {}", first.score, last.score);
        let (first, last) = learns(Goal::Tall, &flat_ground(), 25);
        assert!(last.score > first.score + 1.0, "tall: {} then {}", first.score, last.score);
        let (first, last) = learns(Goal::Jump, &gappy(), 200);
        // the first gap crossed, at 3 m, and no fall: the body down for less than a tenth of a second
        assert!(last.score > first.score + 1.0 && last.distance > 3.5 && last.seconds_down < 0.1, "jump: {} then {}, {} m", first.score, last.score, last.distance);
    }

    #[test]
    fn one_walker_live_gets_past_five_metres_within_sixty_attempts() {
        for legs in [2, 4] {
            let mut trainer = Trainer::new(Description { legs, carry: false, leap: false }, Settings::default(), &flat_ground(), 9).unwrap();
            let mut climber = Climber::new(trainer.layout, trainer.description, 9);
            let mut furthest = Vec::new();
            while climber.attempt <= 60 {
                let child = climber.next();
                let mut judge = trainer.judge();
                judge.impatient = true;
                let outcome = trainer.run_judged(&child, judge);
                climber.report(&child, outcome);
                furthest.push(climber.furthest);
            }
            std::println!("{legs} legs live: furthest after attempts 1, 10, 20, 40, 60: {:.1} {:.1} {:.1} {:.1} {:.1}", furthest[0], furthest[9], furthest[19], furthest[39], furthest[59]);
            assert!(furthest.windows(2).all(|pair| pair[1] >= pair[0]), "the furthest never goes down");
            assert!(climber.furthest > 5.0, "{legs} legs went {} m in 60 attempts", climber.furthest);
        }
    }

    /// How much the brain's outputs change in a step, on average for each output.
    fn twitch(trainer: &mut Trainer, weights: &[f32]) -> f32 {
        let judge = trainer.judge_of(weights);
        judge.jerk / (judge.steps.max(1) as f32 * trainer.layout.outputs as f32)
    }

    // Measured before the fix, a four-legged walker with an own brain of four layers of 64 and eight
    // memories, going fast, changed each output by 0.36 a step at generation 0 (flipping it nearly
    // end to end) and 0.19 after 50 generations; a medium brain, 0.04 and 0.10. After it, a medium
    // brain changes each output by about 0.01 at generation 0 and 0.07 once trained; the largest own
    // brain, trained, two-legged, 0.12 going far and 0.13 going fast, against the 0.17 a muscle allows.
    const CALM_AT_FIRST: f32 = 0.03;
    const CALM_TRAINED: f32 = 0.15;

    #[test]
    fn no_brain_of_any_size_twitches_on_any_goal_first_or_trained() {
        let sizes = [("small", 8, 1, 0), ("medium", 16, 2, 4), ("large", 32, 3, 8), ("own", 64, 4, 8)];
        let goals = [Goal::Far, Goal::Fast, Goal::Tall, Goal::Jump, Goal::Course, Goal::Carry];
        for (name, hidden, layers, memory) in sizes {
            for goal in goals {
                let settings = Settings { goal, hidden, layers, memory, ..Settings::default() };
                let mut trainer = Trainer::new(Description { legs: 2, carry: false, leap: false }, settings, &flat_ground(), 2).unwrap();
                let first = trainer.weights(0).to_vec();
                let at_first = twitch(&mut trainer, &first);
                assert!(at_first < CALM_AT_FIRST, "{name}, {goal:?}: generation 0 twitches {at_first}");
                if goal == Goal::Far || goal == Goal::Fast {
                    while trainer.generation < 50 {
                        trainer.train(64);
                    }
                    let best = trainer.best.clone();
                    let trained = twitch(&mut trainer, &best);
                    assert!(trained < CALM_TRAINED, "{name}, {goal:?}: trained twitches {trained}");
                }
            }
        }
    }

    #[test]
    fn the_owners_walker_four_legs_a_brain_of_four_layers_of_64_going_fast_is_calm_and_learns() {
        let settings = Settings { goal: Goal::Fast, hidden: 64, layers: 4, memory: 8, ..Settings::default() };
        let mut trainer = Trainer::new(Description { legs: 4, carry: false, leap: false }, settings, &flat_ground(), 3).unwrap();
        let first = trainer.weights(0).to_vec();
        let at_first = twitch(&mut trainer, &first);
        trainer.train(32);
        let first_best = trainer.best_score;
        while trainer.generation < 50 {
            trainer.train(64);
        }
        let best = trainer.best.clone();
        let trained = twitch(&mut trainer, &best);
        std::println!("four legs, own 64x4, memory 8, fast: twitch {at_first:.4} at first, {trained:.4} after 50; best {first_best:.1} then {:.1}", trainer.best_score);
        assert!(at_first < CALM_AT_FIRST && trained < CALM_TRAINED);
        assert!(trainer.best_score > first_best + 2.0, "the large brain still learns");
    }

    #[test]
    fn a_bigger_brain_of_two_layers_learns_too() {
        let settings = Settings { hidden: 24, layers: 2, ..Settings::default() };
        let mut trainer = Trainer::new(Description { legs: 4, carry: false, leap: false }, settings, &flat_ground(), 5).unwrap();
        assert_eq!(trainer.layout.weights(), 24 * 30 + 24 * 25 + 24 * 25);
        assert_eq!(trainer.layout.memory, 0);
        trainer.train(32);
        let first = trainer.best_score;
        while trainer.generation < 20 {
            trainer.train(32);
        }
        std::println!("four legs, two layers of 24: generation 0 best {first}, after 20 generations {}", trainer.best_score);
        assert!(trainer.best_score > first + 1.0);
    }

    /// A short obstacle course as the page makes one: level ground, then hills, then steps, then gaps.
    fn course() -> Vec<Segment> {
        let mut ground = vec![Segment { a: Vec2::new(-20.0, 0.0), b: Vec2::new(15.0, 0.0) }];
        let mut x = 15.0;
        let mut y = 0.0;
        // gentle hills
        while x < 45.0 {
            let next = 0.25 * crate::math::sin_cos((x + 0.5 - 15.0) * 0.6).0;
            ground.push(Segment { a: Vec2::new(x, y), b: Vec2::new(x + 0.5, next) });
            x += 0.5;
            y = next;
        }
        // steps up
        while x < 75.0 {
            ground.push(Segment { a: Vec2::new(x, y), b: Vec2::new(x, y + 0.08) });
            y += 0.08;
            ground.push(Segment { a: Vec2::new(x, y), b: Vec2::new(x + 2.5, y) });
            x += 2.5;
        }
        // gaps
        while x < 300.0 {
            ground.push(Segment { a: Vec2::new(x + 0.25, y), b: Vec2::new(x + 3.5, y) });
            x += 3.5;
        }
        ground
    }

    /// Trains for a goal and returns the best of the first generation and of the last.
    fn learns_on(goal: Goal, legs: u32, ground: &[Segment], generations: u32) -> (Outcome, Outcome) {
        let settings = Settings { goal, ..Settings::default() };
        let mut trainer = Trainer::new(Description { legs, carry: false, leap: false }, settings, ground, 4).unwrap();
        trainer.train(settings.population as u32);
        let first = trainer.best.clone();
        while trainer.generation < generations {
            trainer.train(settings.population as u32);
        }
        let first = trainer.run(&first);
        let best = trainer.best.clone();
        let last = trainer.run(&best);
        std::println!("{goal:?}, {legs} legs: generation 0 best {first:?}; after {generations} generations {last:?}");
        (first, last)
    }

    #[test]
    fn the_obstacle_course_is_learned_further_over_the_generations() {
        let (first, last) = learns_on(Goal::Course, 4, &course(), 60);
        assert!(last.score > first.score + 3.0 && last.distance > first.distance + 3.0, "course: {first:?} then {last:?}");
    }

    #[test]
    fn carrying_a_ball_is_learned_further_over_the_generations_without_dropping_it() {
        let (first, last) = learns_on(Goal::Carry, 2, &flat_ground(), 60);
        assert!(last.score > first.score + 3.0 && last.distance > first.distance + 2.0, "carry: {first:?} then {last:?}");
    }

    #[test]
    fn a_ball_on_the_back_stays_there_while_the_walker_stands_and_falls_off_when_it_tips() {
        for legs in [1, 2, 4] {
            let settings = Settings { goal: Goal::Carry, ..Settings::default() };
            let mut trainer = Trainer::new(Description { legs, carry: false, leap: false }, settings, &flat_ground(), 1).unwrap();
            assert_eq!(trainer.description.senses(), Description { legs, carry: false, leap: false }.senses() + 2);
            let creature = trainer.creature.clone();
            let mut world = trainer.start.clone();
            for _ in 0..120 {
                creature.hold(&mut world);
                world.step();
            }
            assert!(!creature.dropped(&world), "{legs} legs: the ball fell off a walker standing still");
            // tipped well over, the ball rolls off
            let torso = creature.torso as usize;
            let at = world.bodies[torso].position + Vec2::new(0.0, 0.3);
            world.bodies[torso].push(at, Vec2::new(-40.0, 0.0));
            let dropped = (0..240).any(|_| {
                world.step();
                creature.dropped(&world)
            });
            assert!(dropped || legs == 4, "{legs} legs: a hard shove did not drop the ball");
            let _ = &mut trainer;
        }
    }
}
