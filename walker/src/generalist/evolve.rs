//! Learning by evolution, as the Walker learns: a generation of brains, each put in charge of the
//! creature from the same start in the same world and scored by how far it got (the sum of its run's
//! rewards, `envs::Judge`); the best four go on unchanged, and each of the rest is a child of the
//! better of three picked at random, half the time mixed with a second, each weight nudged by about
//! 0.3 one time in ten. The same seed learns the same way, whoever runs the runs: a generation's runs
//! can be handed out (`evaluate`) and their scores handed back (`record`) in any order.
//!
//! Runs go four at a time through `Envs`, the same stepping a learner that chooses actions uses.

use alloc::vec;
use alloc::vec::Vec;

use super::envs::Envs;
use super::recipe::Recipe;
use crate::brain::{Brain, Layout};
use crate::learn::Random;

/// How many runs go side by side.
pub const LANES: usize = 4;

pub struct Evolution {
    pub layout: Layout,
    pub size: usize,
    /// Every brain's weights, one after another, and how each did.
    pub population: Vec<f32>,
    pub scores: Vec<f32>,
    pub distances: Vec<f32>,
    pub scored: Vec<bool>,
    pub generation: u32,
    pub best: Vec<f32>,
    pub best_score: f32,
    pub best_distance: f32,
    /// The best score, the average score and the furthest distance of each finished generation.
    pub history_best: Vec<f32>,
    pub history_mean: Vec<f32>,
    pub history_distance: Vec<f32>,
    /// Steps run in all, by every run.
    pub steps: u64,
    random: Random,
    lanes: Envs,
    brains: Vec<Brain>,
    observations: Vec<f32>,
    actions: Vec<f32>,
    rewards: Vec<f32>,
    done: Vec<f32>,
}

/// How many go on unchanged, and how often and how far a weight is nudged.
const KEEP: usize = 4;
const NUDGE_CHANCE: f32 = 0.1;
const NUDGE_SIZE: f32 = 0.3;

impl Evolution {
    /// A first generation of `size` brains of the given shape, drawn at random from `seed`, for a
    /// creature of `legs` legs in the recipe's world, each run lasting at most `seconds`.
    pub fn new(recipe: Recipe, legs: u32, size: usize, hidden: usize, layers: usize, memory: usize, seconds: f32, seed: u64) -> Option<Evolution> {
        let lanes = Envs::new(recipe, legs, LANES, seconds, true)?;
        let layout = Layout::sized(lanes.senses(), lanes.actions(), hidden, layers, memory);
        let size = size.max(KEEP + 1);
        let mut random = Random::new(seed);
        let scales = layout.scales();
        let population = (0..size).flat_map(|_| scales.iter().map(|scale| (random.unit() * 2.0 - 1.0) * scale).collect::<Vec<f32>>()).collect();
        let (senses, wide) = (lanes.senses(), lanes.actions());
        Some(Evolution {
            layout,
            size,
            population,
            scores: vec![0.0; size],
            distances: vec![0.0; size],
            scored: vec![false; size],
            generation: 0,
            best: vec![0.0; layout.weights()],
            best_score: f32::NEG_INFINITY,
            best_distance: 0.0,
            history_best: Vec::new(),
            history_mean: Vec::new(),
            history_distance: Vec::new(),
            steps: 0,
            random,
            brains: (0..LANES).map(|_| Brain::new(layout)).collect(),
            observations: vec![0.0; LANES * senses],
            actions: vec![0.0; LANES * wide],
            rewards: vec![0.0; LANES],
            done: vec![0.0; LANES],
            lanes,
        })
    }

    pub fn weights(&self, index: usize) -> &[f32] {
        let count = self.layout.weights();
        &self.population[index * count..(index + 1) * count]
    }

    /// Runs `count` brains, the k-th given by `weights(k)`, and tells `done` the score and distance
    /// of each as it ends.
    fn run(&mut self, count: usize, weights: impl Fn(&Evolution, usize) -> Vec<f32>, mut done: impl FnMut(usize, f32, f32)) {
        let (senses, wide) = (self.lanes.senses(), self.lanes.actions());
        let mut which: [Option<usize>; LANES] = [None; LANES];
        let mut next = 0;
        loop {
            // every free lane takes the next brain, from the start
            for lane in 0..LANES {
                if which[lane].is_none() && next < count {
                    let brain = weights(self, next);
                    self.lanes.restart(lane);
                    self.brains[lane].load(&brain);
                    self.lanes.runs[lane].sense(&mut self.observations[lane * senses..(lane + 1) * senses]);
                    which[lane] = Some(next);
                    next += 1;
                }
            }
            if which.iter().all(Option::is_none) {
                break;
            }
            for lane in 0..LANES {
                let actions = &mut self.actions[lane * wide..(lane + 1) * wide];
                if which[lane].is_some() {
                    self.brains[lane].think(&self.observations[lane * senses..(lane + 1) * senses]);
                    actions.copy_from_slice(&self.brains[lane].outputs);
                } else {
                    actions.fill(0.0);
                }
            }
            let before = self.lanes.steps;
            self.lanes.step(&self.actions, &mut self.observations, &mut self.rewards, &mut self.done);
            let running = which.iter().filter(|w| w.is_some()).count() as u64;
            self.steps += (self.lanes.steps - before) / LANES as u64 * running;
            for lane in 0..LANES {
                if let Some(k) = which[lane].filter(|_| self.done[lane] == 1.0) {
                    done(k, self.lanes.finished[lane], self.lanes.distances[lane]);
                    which[lane] = None;
                }
            }
        }
    }

    /// Does up to `runs` runs of training and returns the number of generations finished.
    pub fn train(&mut self, runs: usize) -> u32 {
        let mut left = runs;
        while left > 0 {
            let todo: Vec<usize> = (0..self.size).filter(|&i| !self.scored[i]).take(left).collect();
            if todo.is_empty() {
                self.breed();
                continue;
            }
            left -= todo.len();
            let count = self.layout.weights();
            let mut found = vec![(0.0, 0.0); todo.len()];
            let list = todo.clone();
            self.run(todo.len(), |me, k| me.population[list[k] * count..(list[k] + 1) * count].to_vec(), |k, score, distance| found[k] = (score, distance));
            for (k, &i) in todo.iter().enumerate() {
                self.record(i, found[k].0, found[k].1);
            }
        }
        self.generation
    }

    /// Runs brains given from outside, one after another in `brains`, and writes each one's score and
    /// distance into `into`, two numbers a brain.
    pub fn evaluate(&mut self, brains: &[f32], into: &mut [f32]) {
        let count = self.layout.weights();
        let list = brains.to_vec();
        self.run(brains.len() / count, |_, k| list[k * count..(k + 1) * count].to_vec(), |k, score, distance| {
            into[2 * k] = score;
            into[2 * k + 1] = distance;
        });
    }

    /// Takes in how a member of this generation did; once all have, the next generation is bred.
    pub fn record(&mut self, index: usize, score: f32, distance: f32) {
        if index >= self.size || self.scored[index] {
            return;
        }
        self.scores[index] = score;
        self.distances[index] = distance;
        self.scored[index] = true;
        if self.scored.iter().all(|scored| *scored) {
            self.breed();
        }
    }

    /// The better of three picked at random.
    fn pick(&mut self) -> usize {
        let mut best = self.random.below(self.size);
        for _ in 0..2 {
            let other = self.random.below(self.size);
            if self.scores[other] > self.scores[best] {
                best = other;
            }
        }
        best
    }

    fn breed(&mut self) {
        // best to worst, equal scores keeping their places
        let mut order: Vec<usize> = (0..self.size).collect();
        for i in 1..order.len() {
            let mut j = i;
            while j > 0 && self.scores[order[j - 1]] < self.scores[order[j]] {
                order.swap(j - 1, j);
                j -= 1;
            }
        }
        let count = self.layout.weights();
        let top = order[0];
        self.history_best.push(self.scores[top]);
        self.history_mean.push(self.scores.iter().sum::<f32>() / self.size as f32);
        self.history_distance.push(self.distances.iter().fold(0.0, |a: f32, &b| a.max(b)));
        if self.scores[top] > self.best_score {
            self.best_score = self.scores[top];
            self.best_distance = self.distances[top];
            self.best.copy_from_slice(&self.population[top * count..(top + 1) * count]);
        }
        let mut next = Vec::with_capacity(self.population.len());
        let (mut scores, mut distances, mut scored) = (vec![0.0; self.size], vec![0.0; self.size], vec![false; self.size]);
        for (rank, &index) in order.iter().take(KEEP).enumerate() {
            next.extend_from_slice(self.weights(index));
            scores[rank] = self.scores[index];
            distances[rank] = self.distances[index];
            scored[rank] = true;
        }
        for _ in KEEP..self.size {
            let mother = self.pick();
            let father = if self.random.unit() < 0.5 { Some(self.pick()) } else { None };
            for i in 0..count {
                let parent = match father {
                    Some(father) if self.random.bits() & 1 == 1 => father,
                    _ => mother,
                };
                let mut weight = self.population[parent * count + i];
                if self.random.unit() < NUDGE_CHANCE {
                    weight += NUDGE_SIZE * self.random.bell();
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

    /// Takes in a brain from outside: it becomes the best so far, scored afresh, and joins the
    /// population in place of the first member.
    pub fn load(&mut self, weights: &[f32]) -> bool {
        let count = self.layout.weights();
        if weights.len() != count || weights.iter().any(|w| !w.is_finite()) {
            return false;
        }
        let mut found = [0.0; 2];
        self.evaluate(weights, &mut found);
        self.best.copy_from_slice(weights);
        self.best_score = found[0];
        self.best_distance = found[1];
        self.population[..count].copy_from_slice(weights);
        self.scored[0] = false;
        true
    }
}
