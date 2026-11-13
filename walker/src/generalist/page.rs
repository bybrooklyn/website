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
use super::ppo::{Learner, Settings};
use super::practice::{Practice, Way};
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
    /// Learning by practice in this module (a worker's), and the policy the show is driven by when
    /// it shows practice rather than evolution, with the actions it holds between decisions.
    pub practice: Option<Practice>,
    pub policy: Option<Learner>,
    held_actions: Vec<f32>,
    asked: Vec<f32>,
    pub running_out: Vec<f64>,
    pub running_room: Vec<f64>,
    pub state_room: Vec<f32>,
    /// What the show's creature has been rewarded and charged for since the page last asked.
    pub parts: super::practice::Parts,
    /// The weights of evolution's brain on show, to draw it.
    pub shown_weights: Vec<f32>,
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
        let mut page = Page { recipe, legs, seconds, brain: Brain::new(layout), senses: vec![0.0; layout.inputs], show: start.clone(), start, evolution, leftover: 0.0, held: None, out: Vec::new(), weights_room: vec![0.0; layout.weights()], evaluate_room: Vec::new(), evaluated: Vec::new(), envs: None, practice: None, policy: None, held_actions: Vec::new(), asked: Vec::new(), running_out: Vec::new(), running_room: Vec::new(), state_room: Vec::new(), parts: Default::default(), shown_weights: Vec::new() };
        page.show_reset();
        Some(page)
    }

    /// Starts the show from the start with the best brain so far, or the first of the first
    /// generation before any is finished. Unpushed, it plays the very run the brain was scored on.
    pub fn show_reset(&mut self) {
        let weights = if self.evolution.best_score > f32::NEG_INFINITY { self.evolution.best.clone() } else { self.evolution.weights(0).to_vec() };
        self.brain.load(&weights);
        self.shown_weights = weights;
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
            let actions = match &mut self.policy {
                Some(policy) => {
                    // a policy decides every few steps, as it practised, and its actions are held between
                    // by practice's own rule (no hop)
                    let way = Way::of(self.legs);
                    if self.show.judge.steps.is_multiple_of(way.skip) {
                        let mut asked = core::mem::take(&mut self.asked);
                        policy.act(&self.senses, &mut asked);
                        way.hold(&asked, &mut self.held_actions);
                        self.asked = asked;
                    }
                    self.held_actions.clone()
                }
                None => {
                    self.brain.think(&self.senses);
                    self.brain.outputs.clone()
                }
            };
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
                // the policy's run is judged as it practised, so the page can show what it is rewarded and charged for
                if self.policy.is_some() {
                    let parts = super::practice::shaped(&mut self.show, Way::of(self.legs).shaping, &actions);
                    self.parts.run += parts.run;
                    self.parts.up += parts.up + parts.posture;
                    self.parts.effort += parts.effort;
                    self.parts.air += parts.air;
                    self.parts.fall += parts.fall;
                    // a fall into a gap or a hazard is charged in the run's own reward; it is kept with the other falls, to be said as one
                    if matches!(self.show.judge.end, super::envs::End::Hazard | super::envs::End::Fell) {
                        self.parts.run += super::envs::HAZARD_COST;
                        self.parts.fall -= super::envs::HAZARD_COST;
                    }
                } else {
                    self.parts.run += self.show.judge.after_step(&self.show.stage, &self.show.body, &actions);
                }
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

    /// Starts learning by practice here, `count` creatures in fresh worlds of this recipe's kind, the
    /// first weights from `seed` and the worlds' seeds from `stream`. Returns the length of `state`.
    pub fn practice_create(&mut self, count: usize, seed: u64, stream: u32) -> usize {
        self.practice = Practice::new(self.recipe, Way::of(self.legs), Settings::default(), count.clamp(1, 256), seed, stream);
        self.practice.as_ref().map_or(0, |practice| practice.learner.state().len())
    }

    /// The show driven by a policy, in the state and running numbers written into the rooms (weights
    /// alone will do), from the start; or, if they do not fit, by evolution again. Returns 1 if taken.
    pub fn policy_load(&mut self) -> bool {
        let way = Way::of(self.legs);
        let mut start = self.start.clone();
        way.dress(&mut start.body);
        let mut learner = Learner::new(Settings::default(), start.senses(), start.body.actions(), 1, 0);
        if !learner.load(&self.state_room, &self.running_room) {
            self.policy_off();
            return false;
        }
        self.held_actions = vec![0.0; start.body.actions()];
        self.asked = vec![0.0; start.body.actions()];
        self.start = start;
        self.policy = Some(learner);
        self.show_reset();
        true
    }

    /// The show driven by evolution's best brain again.
    pub fn policy_off(&mut self) {
        if self.policy.take().is_some() {
            self.start.body.direct = false;
            self.start.body.ease = 1.0;
            self.start.body.strength = 1.0;
            self.start.body.clock = true;
            self.show_reset();
        }
    }

    /// Room for a learner's state, or a policy's weights, and for its running numbers.
    pub fn rooms(&mut self) -> (usize, usize) {
        let way = Way::of(self.legs);
        let mut body = self.start.body.clone();
        way.dress(&mut body);
        let learner = Learner::new(Settings::default(), self.start.senses(), body.actions(), 1, 0);
        (learner.state().len(), learner.running().len())
    }

    /// The brain driving the show, drawn as it last thought (`mind::picture`): the policy if practice
    /// is on show, else evolution's brain.
    pub fn brain_picture(&mut self) -> &[f32] {
        match &self.policy {
            Some(policy) => super::mind::picture(policy, &self.senses, &mut self.out),
            None => super::mind::picture(&super::mind::Bred { brain: &self.brain, weights: &self.shown_weights }, &self.senses, &mut self.out),
        }
        &self.out
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
