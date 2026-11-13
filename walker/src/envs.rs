//! Many walkers stepped together, for a learner other than evolution: one that chooses each walker's
//! actions step by step and learns from the rewards, as a gradient-based learner does. Each `step`
//! takes an action for every walker (what a brain's outputs would be, -1 to 1 each), moves them all
//! on by one step in lockstep (`World::step_together`), and writes into the caller's lists what each
//! now senses, the reward it earned in that step, and whether its run ended. A run that ends starts
//! again from the start at once, and what it sensed is then the new run's first.
//!
//! A run here is the same run as in training: the same start, the same order of sensing, driving,
//! stepping and judging, and the reward of each step is the change in the score training gives, so
//! the rewards of a run add up to its score. Nothing on the page uses this yet.

use alloc::vec;
use alloc::vec::Vec;

use crate::body::Creature;
use crate::learn::{Judge, Trainer};
use crate::physics::World;

pub struct Envs {
    start: World,
    creature: Creature,
    judge: Judge,
    worlds: Vec<World>,
    judges: Vec<Judge>,
    /// Each run's score after its last step, to give the next step's reward as the change in it.
    scores: Vec<f32>,
    /// The score each run had when it last ended, which its rewards add up to.
    pub finished: Vec<f32>,
    /// Steps taken, by all the walkers together.
    pub steps: u64,
}

impl Envs {
    /// `count` walkers set up as a trainer's are: its creature on its ground, judged by its goal.
    pub fn new(trainer: &Trainer, count: usize) -> Envs {
        let judge = trainer.judge();
        let mut envs = Envs {
            start: trainer.start.clone(),
            creature: trainer.creature.clone(),
            judge,
            worlds: vec![trainer.start.clone(); count],
            judges: vec![judge; count],
            scores: vec![0.0; count],
            finished: vec![0.0; count],
            steps: 0,
        };
        for i in 0..count {
            envs.restart(i);
        }
        envs
    }

    pub fn len(&self) -> usize {
        self.worlds.len()
    }

    pub fn is_empty(&self) -> bool {
        self.worlds.is_empty()
    }

    /// How many numbers each walker senses, and how many actions it takes.
    pub fn senses(&self) -> usize {
        self.creature.description.senses()
    }

    pub fn actions(&self) -> usize {
        self.creature.description.outputs()
    }

    fn restart(&mut self, i: usize) {
        self.worlds[i].copy_from(&self.start);
        self.judges[i] = self.judge;
        self.scores[i] = self.judges[i].outcome(&self.creature, &self.worlds[i]).score;
    }

    /// What every walker senses now, `senses` numbers each, one walker after another.
    pub fn observe(&self, observations: &mut [f32]) {
        let senses = self.senses();
        for (world, into) in self.worlds.iter().zip(observations.chunks_exact_mut(senses)) {
            self.creature.sense(world, into);
        }
    }

    /// One step of every walker. `actions` holds `actions()` numbers for each walker; what each
    /// senses after it goes into `observations`, its reward into `rewards`, and 1 into `done` if its
    /// run ended (it has started again), else 0.
    pub fn step(&mut self, actions: &[f32], observations: &mut [f32], rewards: &mut [f32], done: &mut [f32]) {
        let (wide, senses) = (self.actions(), self.senses());
        for (world, actions) in self.worlds.iter_mut().zip(actions.chunks_exact(wide)) {
            self.creature.drive(world, actions);
        }
        World::step_together(&mut self.worlds);
        self.steps += self.worlds.len() as u64;
        for i in 0..self.worlds.len() {
            let action = &actions[i * wide..(i + 1) * wide];
            let over = self.judges[i].after_step(&self.creature, &self.worlds[i], action);
            let score = self.judges[i].outcome(&self.creature, &self.worlds[i]).score;
            rewards[i] = score - self.scores[i];
            self.scores[i] = score;
            done[i] = if over { 1.0 } else { 0.0 };
            if over {
                self.finished[i] = score;
                self.restart(i);
            }
            self.creature.sense(&self.worlds[i], &mut observations[i * senses..(i + 1) * senses]);
        }
    }

    /// `steps` steps of every walker, `policy` choosing the actions from what they sense before each:
    /// thousands of steps in one call, with nothing crossing to the page between them.
    pub fn run(&mut self, steps: usize, observations: &mut [f32], actions: &mut [f32], rewards: &mut [f32], done: &mut [f32], mut policy: impl FnMut(&[f32], &mut [f32], &[f32], &[f32])) {
        for _ in 0..steps {
            policy(observations, actions, rewards, done);
            self.step(actions, observations, rewards, done);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::body::Description;
    use crate::brain::Brain;
    use crate::learn::{Goal, Settings, flat_ground};

    #[test]
    fn a_walker_stepped_among_many_scores_its_run_as_training_does_and_its_rewards_add_up_to_it() {
        for (legs, goal) in [(2, Goal::Far), (4, Goal::Fast), (1, Goal::Tall)] {
            let settings = Settings { goal, hidden: 16, layers: 2, memory: 4, population: 6, ..Settings::default() };
            let mut trainer = Trainer::new(Description { legs, carry: false, leap: false }, settings, &flat_ground(), 4).unwrap();
            let mut envs = Envs::new(&trainer, 6);
            let (senses, wide) = (envs.senses(), envs.actions());
            let mut brains: Vec<Brain> = (0..6).map(|i| Brain::with(trainer.layout, trainer.weights(i))).collect();
            let (mut observations, mut actions, mut rewards, mut done) = (vec![0.0; 6 * senses], vec![0.0; 6 * wide], vec![0.0; 6], vec![0.0; 6]);
            envs.observe(&mut observations);
            let mut summed = [envs.scores.clone(), vec![0.0; 6]].concat();
            let mut ended: Vec<Option<(f32, f32)>> = vec![None; 6];
            while ended.iter().any(Option::is_none) {
                for (i, brain) in brains.iter_mut().enumerate() {
                    brain.think(&observations[i * senses..(i + 1) * senses]);
                    actions[i * wide..(i + 1) * wide].copy_from_slice(&brain.outputs);
                }
                envs.step(&actions, &mut observations, &mut rewards, &mut done);
                for i in 0..6 {
                    if ended[i].is_none() {
                        summed[6 + i] += rewards[i];
                        if done[i] == 1.0 {
                            ended[i] = Some((envs.finished[i], summed[i] + summed[6 + i]));
                        }
                    }
                }
            }
            for (i, end) in ended.iter().enumerate() {
                let (score, added) = end.unwrap();
                let weights = trainer.weights(i).to_vec();
                let trained = trainer.run(&weights);
                assert_eq!(score.to_bits(), trained.score.to_bits(), "{legs} legs, walker {i}");
                assert!((added - score).abs() < 1e-3 * score.abs().max(1.0), "rewards add up to {added}, not {score}");
            }
        }
    }

    // Natively, on the machine this was written on (busy with other work), 64 two-legged walkers held
    // to one stride stepped about 740,000 times a second on one core, and 64 four-legged ones about
    // 400,000. The floors leave room for a machine three times slower.
    const FLOOR_TWO_LEGS: f64 = 200_000.0;
    const FLOOR_FOUR_LEGS: f64 = 110_000.0;

    #[test]
    fn many_walkers_step_at_least_as_many_times_a_second_as_the_floor() {
        for (legs, floor) in [(2, FLOOR_TWO_LEGS), (4, FLOOR_FOUR_LEGS)] {
            let trainer = Trainer::new(Description { legs, carry: false, leap: false }, Settings::default(), &flat_ground(), 1).unwrap();
            let mut envs = Envs::new(&trainer, 64);
            let (senses, wide) = (envs.senses(), envs.actions());
            let stride = trainer.description.stride();
            let (mut observations, mut actions, mut rewards, mut done) = (vec![0.0; 64 * senses], (0..64 * wide).map(|k| stride[k % wide]).collect::<Vec<f32>>(), vec![0.0; 64], vec![0.0; 64]);
            let mut best = 0.0f64;
            for _ in 0..3 {
                let started = std::time::Instant::now();
                let before = envs.steps;
                envs.run(500, &mut observations, &mut actions, &mut rewards, &mut done, |_, _, _, _| {});
                best = best.max((envs.steps - before) as f64 / started.elapsed().as_secs_f64());
            }
            std::println!("{legs} legs: 64 walkers step {best:.0} times a second together");
            assert!(best > floor, "{legs} legs: {best:.0} steps a second, under the floor of {floor}");
        }
    }
}
