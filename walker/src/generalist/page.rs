//! Everything the generalist's page reaches, as one value: evolution learning in a world, a show of
//! the best brain so far walking it in real time (to draw, push, pick up and drop), the world's ground,
//! platforms and hazards to draw, and many creatures stepped together for a learner. `api` hands each
//! of these to the page as a plain exported function; this holds the work, so it is tested natively.
//!
//! Positions given to and from the page are in metres from the start, whatever the physics has been
//! moved back by.

use alloc::rc::Rc;
use alloc::vec;
use alloc::vec::Vec;

use super::envs::{Envs, Run, SECONDS};
use super::evolve::Evolution;
use super::eyes::{self, RAYS};
use super::land::Hazard;
use super::recipe::Recipe;
use super::stage::Thing;
use crate::brain::Brain;
use crate::math::Vec2;
use crate::physics::STEP;

/// How hard a held creature is drawn toward the hand, per second, and the fastest it goes.
const HOLD_PULL: f32 = 12.0;
const HOLD_FASTEST: f32 = 6.0;
/// The most steps one call to `show_step` takes, so a page hidden a while does not freeze catching up.
const MOST_STEPS: u32 = 8;

pub struct Page {
    pub recipe: Recipe,
    pub legs: u32,
    pub seconds: f32,
    pub evolution: Evolution,
    /// The show: where it starts, the run now going, and the brain driving it.
    start: Run,
    pub show: Run,
    brain: Brain,
    senses: Vec<f32>,
    leftover: f32,
    pub held: Option<Vec2>,
    /// Lists the page reads, kept here between calls.
    pub out: Vec<f32>,
    pub weights_room: Vec<f32>,
    pub evaluate_room: Vec<f32>,
    pub evaluated: Vec<f32>,
    pub envs: Option<Stepped>,
}

/// Creatures stepped together for a learner, and the lists they read from and write into.
pub struct Stepped {
    pub envs: Envs,
    pub observations: Vec<f32>,
    pub actions: Vec<f32>,
    pub rewards: Vec<f32>,
    pub done: Vec<f32>,
}

impl Page {
    /// Evolution in the recipe's world for a creature of `legs` legs, brains of `layers` layers of
    /// `hidden` neurons and `memory` memories, `population` to a generation, runs of `seconds` (the
    /// usual 30 if 0 or less), first brains drawn from `seed`. None if the legs are not 2 or 4.
    #[allow(clippy::too_many_arguments)]
    pub fn new(recipe: Recipe, legs: u32, population: usize, hidden: usize, layers: usize, memory: usize, seconds: f32, seed: u64) -> Option<Page> {
        let recipe = recipe.clamped();
        let seconds = if seconds > 0.0 { seconds.min(120.0) } else { SECONDS };
        let evolution = Evolution::new(recipe, legs, population.clamp(5, 500), hidden.clamp(2, 64), layers.clamp(1, 4), memory.min(16), seconds, seed)?;
        let land = Rc::new(super::land::Land::new(recipe, super::envs::MADE));
        let start = Run::new(land, legs, seconds)?;
        let layout = evolution.layout;
        let mut page = Page { recipe, legs, seconds, brain: Brain::new(layout), senses: vec![0.0; layout.inputs], show: start.clone(), start, evolution, leftover: 0.0, held: None, out: Vec::new(), weights_room: vec![0.0; layout.weights()], evaluate_room: Vec::new(), evaluated: Vec::new(), envs: None };
        page.show_reset();
        Some(page)
    }

    /// Starts the show from the start with the best brain so far, or the first of the first
    /// generation before any is finished. Unpushed, it plays the very run the brain was scored on.
    pub fn show_reset(&mut self) {
        let weights = if self.evolution.best_score > f32::NEG_INFINITY { self.evolution.best.clone() } else { self.evolution.weights(0).to_vec() };
        self.brain.load(&weights);
        self.show.copy_from(&self.start);
        self.show.sense(&mut self.senses);
        self.leftover = 0.0;
    }

    /// Moves the show on by `seconds` in whole steps, the brain deciding before each. Returns the
    /// steps taken.
    pub fn show_step(&mut self, seconds: f32) -> u32 {
        self.leftover += seconds;
        let mut taken = 0;
        while self.leftover >= STEP && taken < MOST_STEPS && (!self.show.judge.over() || self.held.is_some()) {
            self.brain.think(&self.senses);
            let actions = self.brain.outputs.clone();
            self.show.before_step(&actions);
            if let Some(hand) = self.held {
                let world = &mut self.show.stage.world;
                let torso = &mut world.bodies[self.show.body.creature.torso as usize];
                let mut pull = (hand - Vec2::new(self.show.stage.origin, 0.0) - torso.position) * HOLD_PULL;
                let speed = pull.length();
                if speed > HOLD_FASTEST {
                    pull = pull * (HOLD_FASTEST / speed);
                }
                torso.velocity = pull;
                torso.spin *= 0.8;
            }
            self.show.stage.world.step();
            // while it is held its run does not go on being judged, so it is not ended in the air
            if self.held.is_none() {
                self.show.judge.after_step(&self.show.stage, &self.show.body, &actions);
            }
            self.show.sense(&mut self.senses);
            self.leftover -= STEP;
            taken += 1;
        }
        if taken == MOST_STEPS || self.show.judge.over() {
            self.leftover = 0.0;
        }
        taken
    }

    /// The body or box nearest a point, pushed there with an impulse in newton seconds.
    pub fn show_push(&mut self, at: Vec2, impulse: Vec2) -> i32 {
        let world = &mut self.show.stage.world;
        let at = at - Vec2::new(self.show.stage.origin, 0.0);
        match world.nearest_body(at) {
            Some((index, _)) if world.bodies[index as usize].moves() => {
                world.bodies[index as usize].push(at, impulse);
                index as i32
            }
            _ => -1,
        }
    }

    /// The show's bodies, six numbers each as the Walker's are (x, y, angle, kind, two sizes): the
    /// creature's, its torso first and then each leg's upper and lower part.
    pub fn bodies(&mut self) -> &[f32] {
        self.out.clear();
        let creature = &self.show.body.creature;
        let world = &self.show.stage.world;
        let parts = core::iter::once(creature.torso).chain(creature.legs.iter().flat_map(|leg| [leg.upper, leg.lower]));
        for part in parts {
            let body = &world.bodies[part as usize];
            let (a, b) = body.shape.size();
            self.out.extend_from_slice(&[body.position.x + self.show.stage.origin, body.position.y, body.angle(), body.shape.kind() as f32, a, b]);
        }
        &self.out
    }

    /// The things made in the show's world, six numbers each: what it is (0 a box, 1 a moving
    /// platform, 2 a see-saw's plank), x, y, angle, half width, half height.
    pub fn things(&mut self) -> &[f32] {
        self.out.clear();
        let world = &self.show.stage.world;
        for made in &self.show.stage.made {
            let body = &world.bodies[made.body as usize];
            let (a, b) = body.shape.size();
            let kind = match made.thing {
                Thing::Loose => 0.0,
                Thing::Mover => 1.0,
                Thing::Seesaw => 2.0,
            };
            self.out.extend_from_slice(&[kind, body.position.x + self.show.stage.origin, body.position.y, body.angle(), a, b]);
        }
        &self.out
    }

    /// Where the show's eye is, then two numbers for each ray: how far it saw, and what (`Seen`).
    pub fn rays(&mut self) -> &[f32] {
        self.out.clear();
        let eye = eyes::eye(&self.show.stage, self.show.body.creature.torso);
        self.out.extend_from_slice(&[eye.x + self.show.stage.origin, eye.y]);
        for (distance, seen) in self.show.seen {
            self.out.extend_from_slice(&[distance, seen.number() as f32]);
        }
        &self.out
    }

    /// The direction of each ray, in radians from straight ahead, turning up.
    pub fn ray_angles(&mut self) -> &[f32] {
        self.out.clear();
        self.out.extend_from_slice(&eyes::angles());
        &self.out
    }

    /// The show's world made at least to `until` metres, and its ground, as four numbers a piece
    /// (x1, y1, x2, y2), from piece `from` on.
    pub fn ground(&mut self, until: f32, from: usize) -> &[f32] {
        self.extend(until);
        self.out.clear();
        for piece in self.show.stage.land.geometry.ground.iter().skip(from) {
            self.out.extend_from_slice(&[piece.a.x, piece.a.y, piece.b.x, piece.b.y]);
        }
        &self.out
    }

    /// The show's floating platforms, four numbers each (lowest x and y, highest x and y), and its
    /// hazards, five each (the same, and 0 for water or 1 for spikes), from the numbers given on.
    pub fn blocks(&mut self, from: usize) -> &[f32] {
        self.out.clear();
        for block in self.show.stage.land.geometry.blocks.iter().skip(from) {
            self.out.extend_from_slice(&[block.low.x, block.low.y, block.high.x, block.high.y]);
        }
        &self.out
    }

    pub fn hazards(&mut self, from: usize) -> &[f32] {
        self.out.clear();
        for zone in self.show.stage.land.geometry.hazards.iter().skip(from) {
            let kind = if zone.hazard == Hazard::Water { 0.0 } else { 1.0 };
            self.out.extend_from_slice(&[zone.low.x, zone.low.y, zone.high.x, zone.high.y, kind]);
        }
        &self.out
    }

    /// Makes the show's world (and the start it goes back to) at least to `until` metres.
    fn extend(&mut self, until: f32) {
        if self.show.stage.land.reached.x < until {
            let land = Rc::make_mut(&mut self.show.stage.land);
            land.extend(until);
            // the start shares the longer world, so a show started again does not make it again
            self.start.stage.land = self.show.stage.land.clone();
        }
    }

    /// A picture of what the show's creature sees, `count` greyscale pixels.
    pub fn picture(&mut self, count: usize) -> &[f32] {
        self.out.clear();
        self.out.resize(count.clamp(2, 1024), 0.0);
        let torso = self.show.body.creature.torso;
        let group = self.show.stage.world.bodies[torso as usize].group;
        eyes::picture(&self.show.stage, torso, group, &mut self.out);
        &self.out
    }

    /// Makes `count` creatures to step together for a learner, each in the world of the recipe's seed
    /// plus its number, or all in the recipe's own world if `alike`.
    pub fn envs_create(&mut self, count: usize, alike: bool) -> usize {
        let count = count.clamp(1, 4096);
        self.envs = Envs::new(self.recipe, self.legs, count, self.seconds, alike).map(|mut envs| {
            let (senses, wide) = (envs.senses(), envs.actions());
            let mut observations = vec![0.0; count * senses];
            envs.observe(&mut observations);
            Stepped { envs, observations, actions: vec![0.0; count * wide], rewards: vec![0.0; count], done: vec![0.0; count] }
        });
        self.envs.as_ref().map_or(0, |stepped| stepped.envs.len())
    }

    /// Steps the learner's creatures `steps` times by the actions written for them. Returns the steps
    /// taken by all of them together.
    pub fn envs_step(&mut self, steps: usize) -> usize {
        let Some(stepped) = &mut self.envs else { return 0 };
        let before = stepped.envs.steps;
        for _ in 0..steps.min(100_000) {
            stepped.envs.step(&stepped.actions, &mut stepped.observations, &mut stepped.rewards, &mut stepped.done);
        }
        (stepped.envs.steps - before) as usize
    }

    /// How many numbers a creature senses, and how many actions it takes.
    pub fn senses(&self) -> usize {
        self.start.senses()
    }

    pub fn actions(&self) -> usize {
        self.start.body.actions()
    }

    /// How many rays it has.
    pub fn rays_length(&self) -> usize {
        RAYS
    }
}
