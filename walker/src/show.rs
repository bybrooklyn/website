//! Walkers run in real time for the page to draw. `Show` is one brain in its own world, which a
//! visitor can push, with what it senses and thinks laid out for drawing its brain. `Crowd` is a whole
//! generation at once, each in a world of its own, laid out for drawing.
//!
//! Both start from the same world as training does and are judged the same way (`Judge`), so the
//! best brain's run on the page is the very run it was scored on, step for step, unless someone
//! pushes it. Each stops where its scored run stopped; the page then starts it again.

use alloc::vec;
use alloc::vec::Vec;

use crate::body::Creature;
use crate::brain::{Brain, Layout};
use crate::learn::{Judge, Outcome};
use crate::math::Vec2;
use crate::physics::{STEP, World};

/// The most steps one call takes, so a page that was hidden a while does not freeze catching up.
const MOST_STEPS: u32 = 8;

pub struct Show {
    pub world: World,
    pub creature: Creature,
    pub weights: Vec<f32>,
    pub brain: Brain,
    pub senses: Vec<f32>,
    pub judge: Judge,
    /// Six numbers for each body: x, y, angle, kind, and the two size numbers (see `Shape::size`).
    pub drawn: Vec<f32>,
    leftover: f32,
}

impl Show {
    pub fn new(start: &World, creature: &Creature, layout: Layout, weights: &[f32], judge: Judge) -> Show {
        let mut show = Show {
            world: start.clone(),
            creature: creature.clone(),
            weights: weights.to_vec(),
            brain: Brain::new(layout),
            senses: vec![0.0; layout.inputs],
            judge,
            drawn: Vec::new(),
            leftover: 0.0,
        };
        show.creature.sense(&show.world, &mut show.senses);
        show.brain.think(&show.weights, &show.senses);
        // that thought was only to have something to draw: the run itself starts with nothing in memory
        show.brain.forget();
        show.draw();
        show
    }

    /// Moves on by `seconds` in whole steps, the brain thinking before each, and returns the steps.
    /// Once the run is over it stands still.
    pub fn step(&mut self, seconds: f32) -> u32 {
        self.leftover += seconds;
        let mut taken = 0;
        while self.leftover >= STEP && taken < MOST_STEPS && !self.judge.over {
            self.creature.sense(&self.world, &mut self.senses);
            self.brain.think(&self.weights, &self.senses);
            self.creature.drive(&mut self.world, &self.brain.outputs);
            self.world.step();
            self.judge.after_step(&self.creature, &self.world, &self.brain.outputs);
            self.leftover -= STEP;
            taken += 1;
        }
        if taken == MOST_STEPS || self.judge.over {
            self.leftover = 0.0;
        }
        self.draw();
        taken
    }

    /// How the run has gone so far, scored as training scores it.
    pub fn outcome(&self) -> Outcome {
        self.judge.outcome(&self.creature, &self.world)
    }

    /// Pushes the body nearest the point (x, y) at that point, and returns which body it was.
    pub fn push(&mut self, at: Vec2, impulse: Vec2) -> Option<u32> {
        let (index, _) = self.world.nearest_body(at)?;
        self.world.bodies[index as usize].push(at, impulse);
        self.draw();
        Some(index)
    }

    fn draw(&mut self) {
        self.drawn.clear();
        for body in &self.world.bodies {
            let (a, b) = body.shape.size();
            self.drawn.extend_from_slice(&[body.position.x, body.position.y, body.angle(), body.shape.kind() as f32, a, b]);
        }
    }
}

pub struct Crowd {
    pub worlds: Vec<World>,
    pub judges: Vec<Judge>,
    pub creature: Creature,
    /// Every brain's weights, one after another.
    pub weights: Vec<f32>,
    brain: Brain,
    senses: Vec<f32>,
    /// Each walker's memory, kept here between steps, since they share one brain to think with.
    memories: Vec<f32>,
    /// Four numbers for each walker: how far it has gone, the height of its body, its angle, and 1
    /// once its run is over.
    pub drawn: Vec<f32>,
    leftover: f32,
}

impl Crowd {
    pub fn new(start: &World, creature: &Creature, layout: Layout, population: &[f32], judge: Judge) -> Crowd {
        let count = population.len() / layout.weights();
        let mut crowd = Crowd {
            worlds: vec![start.clone(); count],
            judges: vec![judge; count],
            creature: creature.clone(),
            weights: population.to_vec(),
            brain: Brain::new(layout),
            senses: vec![0.0; layout.inputs],
            memories: vec![0.0; count * layout.memory],
            drawn: Vec::new(),
            leftover: 0.0,
        };
        crowd.draw();
        crowd
    }

    pub fn step(&mut self, seconds: f32) -> u32 {
        self.leftover += seconds;
        let count = self.brain.layout.weights();
        let mut taken = 0;
        while self.leftover >= STEP && taken < MOST_STEPS {
            for (i, world) in self.worlds.iter_mut().enumerate() {
                if self.judges[i].over {
                    continue;
                }
                self.creature.sense(world, &mut self.senses);
                let kept = self.brain.layout.memory;
                self.brain.memory.copy_from_slice(&self.memories[i * kept..(i + 1) * kept]);
                self.brain.think(&self.weights[i * count..(i + 1) * count], &self.senses);
                self.memories[i * kept..(i + 1) * kept].copy_from_slice(&self.brain.memory);
                self.creature.drive(world, &self.brain.outputs);
                world.step();
                self.judges[i].after_step(&self.creature, world, &self.brain.outputs);
            }
            self.leftover -= STEP;
            taken += 1;
        }
        if taken == MOST_STEPS {
            self.leftover = 0.0;
        }
        self.draw();
        taken
    }

    fn draw(&mut self) {
        self.drawn.clear();
        for (world, judge) in self.worlds.iter().zip(&self.judges) {
            let torso = &world.bodies[self.creature.torso as usize];
            self.drawn.extend_from_slice(&[self.creature.distance(world), torso.position.y, torso.angle(), if judge.over { 1.0 } else { 0.0 }]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::body::Description;
    use crate::learn::{Goal, Settings, Trainer, flat_ground};

    #[test]
    fn the_show_plays_the_best_run_exactly_as_it_was_scored() {
        for (legs, goal, layers, memory) in [(2, Goal::Far, 1, 0), (4, Goal::Fast, 3, 6), (1, Goal::Tall, 2, 4)] {
            let settings = Settings { goal, layers, memory, ..Settings::default() };
            let mut trainer = Trainer::new(Description { legs }, settings, &flat_ground(), 2).unwrap();
            while trainer.generation < 5 {
                trainer.train(32);
            }
            let mut show = Show::new(&trainer.start, &trainer.creature, trainer.layout, &trainer.best, trainer.judge());
            let mut steps = 0;
            while !show.judge.over {
                steps += show.step(1.0 / 60.0);
            }
            let outcome = show.outcome();
            assert_eq!(outcome.score.to_bits(), trainer.best_score.to_bits(), "{legs} legs, {goal:?}");
            assert_eq!(outcome.distance.to_bits(), trainer.best_distance.to_bits());
            assert_eq!(show.step(1.0), 0, "an ended run stands still");
            assert!(steps > 0);
        }
    }
}
