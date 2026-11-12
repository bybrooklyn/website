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
use crate::math::{Vec2, sqrt};
use crate::physics::{STEP, Segment, World};

/// What each second of body on the ground costs, in metres of score, and each second of a knee on it.
const DOWN_COST: f32 = 1.0;
const KNEE_COST: f32 = 0.3;
/// What each joule of motor work costs, in metres of score.
const WORK_COST: f32 = 0.00005;
/// A run ends once the body has lain on the ground this long, in seconds. The creature has fallen,
/// and watching it lie there teaches nothing.
const DOWN_LIMIT: f32 = 1.0;

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
}

impl Goal {
    /// The goal for each number the page uses: 0 far, 1 fast, 2 tall, 3 jump.
    pub fn from_number(number: u32) -> Goal {
        match number {
            1 => Goal::Fast,
            2 => Goal::Tall,
            3 => Goal::Jump,
            _ => Goal::Far,
        }
    }

    /// How long a run lasts, in seconds.
    pub fn seconds(self) -> f32 {
        match self {
            Goal::Fast => 4.0,
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
    pub in_gap: bool,
    pub over: bool,
}

impl Judge {
    pub fn new(goal: Goal, seconds: f32) -> Judge {
        Judge { goal, steps: 0, most_steps: (seconds / STEP) as u32, seconds_down: 0.0, seconds_kneeling: 0.0, seconds_flying: 0.0, tallness: 0.0, work: 0.0, in_gap: false, over: false }
    }

    /// Takes in a step just taken. Returns true once the run is over: its time is up, the body has
    /// lain down too long, or, jumping, a foot went down in a gap.
    pub fn after_step(&mut self, creature: &Creature, world: &World) -> bool {
        self.steps += 1;
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
        self.over = self.steps >= self.most_steps || self.seconds_down >= DOWN_LIMIT || self.in_gap;
        self.over
    }

    /// The score of the run so far, with how far it went.
    pub fn outcome(&self, creature: &Creature, world: &World) -> Outcome {
        let distance = creature.distance(world);
        let costs = DOWN_COST * self.seconds_down + KNEE_COST * self.seconds_kneeling + WORK_COST * self.work;
        let tall = self.tallness / self.most_steps.max(1) as f32;
        let score = match self.goal {
            Goal::Far | Goal::Fast => distance,
            // standing tall and still scores a little; tall and going forward scores most
            Goal::Tall => distance * (0.2 + 0.8 * tall) + 2.0 * tall,
            Goal::Jump => 1.5 * distance + self.seconds_flying - if self.in_gap { 1.0 } else { 0.0 },
        } - costs;
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
    /// Neurons in each hidden layer of the brain, and one or two layers.
    pub hidden: usize,
    pub layers: usize,
    /// How many of the best go on unchanged.
    pub keep: usize,
    /// The chance that a weight is nudged in a child, and how far.
    pub nudge_chance: f32,
    pub nudge_size: f32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { population: 32, goal: Goal::Far, seconds: 0.0, hidden: crate::brain::HIDDEN, layers: 1, keep: 4, nudge_chance: 0.1, nudge_size: 0.3 }
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
        let seconds = if settings.seconds > 0.0 { settings.seconds } else { settings.goal.seconds() };
        let settings = Settings { population, seconds, keep: settings.keep.min(population - 1), ..settings };
        let mut start = World::new();
        start.set_ground(ground);
        let creature = Creature::build(&mut start, description)?;
        let layout = Layout::sized(description.senses(), description.joints(), settings.hidden, settings.layers);
        let settings = Settings { hidden: layout.hidden, layers: layout.layers, ..settings };
        let mut random = Random::new(seed);
        let count = layout.weights();
        // first weights about as large as keeps each neuron's sum near its useful range
        let spread = 2.0 / sqrt(layout.inputs as f32);
        let population = (0..settings.population * count).map(|_| (random.unit() * 2.0 - 1.0) * spread).collect();
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
        Judge::new(self.settings.goal, self.settings.seconds)
    }

    /// Runs one brain from the start and scores it.
    pub fn run(&mut self, weights: &[f32]) -> Outcome {
        self.world.copy_from(&self.start);
        let creature = &self.creature;
        let mut judge = Judge::new(self.settings.goal, self.settings.seconds);
        loop {
            creature.sense(&self.world, &mut self.senses);
            self.brain.think(weights, &self.senses);
            creature.drive(&mut self.world, &self.brain.outputs);
            self.world.step();
            if judge.after_step(creature, &self.world) {
                break;
            }
        }
        judge.outcome(creature, &self.world)
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
        let mut one = Trainer::new(Description { legs: 2 }, settings, &flat_ground(), 7).unwrap();
        let mut two = Trainer::new(Description { legs: 2 }, settings, &flat_ground(), 7).unwrap();
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
        let mut trainer = Trainer::new(Description { legs: 2 }, settings, &flat_ground(), 1).unwrap();
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
        let mut trainer = Trainer::new(Description { legs: 2 }, settings, ground, 3).unwrap();
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
        let (first, last) = learns(Goal::Fast, &flat_ground(), 25);
        assert!(last.score > first.score + 1.0 && last.distance > 2.0, "fast: {} then {}", first.score, last.score);
        let (first, last) = learns(Goal::Tall, &flat_ground(), 25);
        assert!(last.score > first.score + 1.0, "tall: {} then {}", first.score, last.score);
        let (first, last) = learns(Goal::Jump, &gappy(), 40);
        assert!(last.score > first.score + 1.0 && last.distance > 3.5, "jump: {} then {}, {} m", first.score, last.score, last.distance);
    }

    #[test]
    fn a_bigger_brain_of_two_layers_learns_too() {
        let settings = Settings { hidden: 24, layers: 2, ..Settings::default() };
        let mut trainer = Trainer::new(Description { legs: 4 }, settings, &flat_ground(), 5).unwrap();
        assert_eq!(trainer.layout.weights(), 24 * 30 + 24 * 25 + 8 * 25);
        trainer.train(32);
        let first = trainer.best_score;
        while trainer.generation < 20 {
            trainer.train(32);
        }
        std::println!("four legs, two layers of 24: generation 0 best {first}, after 20 generations {}", trainer.best_score);
        assert!(trainer.best_score > first + 1.0);
    }
}
