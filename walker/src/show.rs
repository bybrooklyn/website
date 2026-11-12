//! Walkers run in real time for the page to draw. `Show` is one brain in its own world, which a
//! visitor can push, with what it senses and thinks laid out for drawing its brain. `Crowd` is a whole
//! generation at once, each in a world of its own, laid out for drawing.
//!
//! Both start from the same world as training does and are judged the same way (`Judge`), so the
//! best brain's run on the page is the very run it was scored on, step for step, unless someone
//! pushes it. Each stops where its scored run stopped; the page then starts it again.
//!
//! A show can also be endless: it goes on while the walker stays up, on ground the page lays ahead
//! of it (`extend`) and drops behind it, with the whole world moved back now and then so the numbers
//! stay fine (`origin` says how far in all). A better brain can take over at the start of a stride
//! (`swap`) without the walk starting again.

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
    /// How far the world has been moved back, in all, in metres.
    pub origin: f64,
    /// A brain waiting to take over at the start of the next stride.
    pub pending: Option<Vec<f32>>,
    leftover: f32,
}

/// An endless walk moves the world back by this much whenever the walker passes it, in metres. A
/// power of two, so positions near it lose nothing in the move.
const REBASE: f32 = 512.0;
/// Ground further behind the walker than this is dropped, in metres.
const BEHIND: f32 = 40.0;

impl Show {
    pub fn new(start: &World, creature: &Creature, layout: Layout, weights: &[f32], judge: Judge) -> Show {
        let mut show = Show {
            world: start.clone(),
            creature: creature.clone(),
            weights: weights.to_vec(),
            brain: Brain::with(layout, weights),
            senses: vec![0.0; layout.inputs],
            judge,
            drawn: Vec::new(),
            origin: 0.0,
            pending: None,
            leftover: 0.0,
        };
        show.creature.sense(&show.world, &mut show.senses);
        show.brain.think(&show.senses);
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
            let stride = self.creature.phase(&self.world) as u32;
            self.creature.sense(&self.world, &mut self.senses);
            self.brain.think(&self.senses);
            self.creature.drive(&mut self.world, &self.brain.outputs);
            self.world.step();
            self.judge.after_step(&self.creature, &self.world, &self.brain.outputs);
            self.leftover -= STEP;
            taken += 1;
            // a new stride has begun: a better brain waiting takes over here, mid walk
            if self.creature.phase(&self.world) as u32 != stride {
                if let Some(weights) = self.pending.take() {
                    self.brain.load(&weights);
                    self.weights = weights;
                }
            }
            if self.judge.endless {
                self.keep_near();
            }
        }
        if taken == MOST_STEPS || self.judge.over {
            self.leftover = 0.0;
        }
        self.draw();
        taken
    }

    /// Keeps an endless walk near the origin and its ground short: what is far behind is dropped,
    /// and once the walker passes `REBASE` everything moves back by that much.
    fn keep_near(&mut self) {
        let x = self.world.bodies[self.creature.torso as usize].position.x;
        if self.world.steps % 60 == 0 {
            self.world.drop_ground_before(x - BEHIND);
        }
        if x > REBASE {
            self.world.shift(REBASE);
            self.creature.start.x -= REBASE;
            self.origin += REBASE as f64;
        }
    }

    /// Lays more ground for an endless walk. The pieces are given where the page has them, from the
    /// walk's start, and are moved back as the world has been.
    pub fn extend(&mut self, pieces: &[crate::physics::Segment]) {
        let back = self.origin as f32;
        let moved: Vec<crate::physics::Segment> = pieces.iter().map(|piece| crate::physics::Segment { a: Vec2::new(piece.a.x - back, piece.a.y), b: Vec2::new(piece.b.x - back, piece.b.y) }).collect();
        self.world.extend_ground(&moved);
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
    /// Each walker's brain, loaded with its own weights.
    brains: Vec<Brain>,
    senses: Vec<f32>,
    /// Four numbers for each walker: how far it has gone, the height of its body, its angle, and 1
    /// once its run is over.
    pub drawn: Vec<f32>,
    leftover: f32,
}

impl Crowd {
    pub fn new(start: &World, creature: &Creature, layout: Layout, population: &[f32], judge: Judge) -> Crowd {
        let brains: Vec<Brain> = population.chunks_exact(layout.weights()).map(|weights| Brain::with(layout, weights)).collect();
        let count = brains.len();
        let mut crowd = Crowd {
            worlds: vec![start.clone(); count],
            judges: vec![judge; count],
            creature: creature.clone(),
            brains,
            senses: vec![0.0; layout.inputs],
            drawn: Vec::new(),
            leftover: 0.0,
        };
        crowd.draw();
        crowd
    }

    pub fn step(&mut self, seconds: f32) -> u32 {
        self.leftover += seconds;
        let mut taken = 0;
        while self.leftover >= STEP && taken < MOST_STEPS {
            for ((world, judge), brain) in self.worlds.iter_mut().zip(&mut self.judges).zip(&mut self.brains) {
                if judge.over {
                    continue;
                }
                self.creature.sense(world, &mut self.senses);
                brain.think(&self.senses);
                self.creature.drive(world, &brain.outputs);
                world.step();
                judge.after_step(&self.creature, world, &brain.outputs);
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
            let mut trainer = Trainer::new(Description { legs, carry: false, leap: false }, settings, &flat_ground(), 2).unwrap();
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

    #[test]
    fn an_endless_walk_far_from_the_start_is_moved_back_without_a_jolt_and_keeps_its_distance() {
        let ground = [crate::physics::Segment { a: Vec2::new(-20.0, 0.0), b: Vec2::new(2000.0, 0.0) }];
        let trainer = Trainer::new(Description { legs: 4, carry: false, leap: false }, Settings::default(), &ground, 1).unwrap();
        let mut judge = trainer.judge();
        judge.endless = true;
        // the same calm brain twice, once carried 600 m along, as if it had walked there
        let calm = alloc::vec![0.0; trainer.layout.weights()];
        let mut near = Show::new(&trainer.start, &trainer.creature, trainer.layout, &calm, judge);
        let mut show = Show::new(&trainer.start, &trainer.creature, trainer.layout, &calm, judge);
        for body in &mut show.world.bodies {
            body.position.x += 600.0;
        }
        let before = show.creature.distance(&show.world);
        show.step(1.0 / 60.0);
        near.step(1.0 / 60.0);
        assert_eq!(show.origin, 512.0, "moved back once it passed 512 m");
        let torso = show.world.bodies[show.creature.torso as usize];
        assert!(torso.position.x < 100.0);
        assert!((show.creature.distance(&show.world) - before).abs() < 0.05, "the distance carried on across the move");
        // after the move it walks as the one that never went anywhere does, give or take what an f32 at
        // 600 m rounds away before the move
        for _ in 0..120 {
            show.step(1.0 / 60.0);
            near.step(1.0 / 60.0);
        }
        let apart = (show.creature.distance(&show.world) - 600.0) - near.creature.distance(&near.world);
        assert!(apart.abs() < 0.05, "no jolt: {apart} m apart");
    }
}
