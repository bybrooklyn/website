//! Touch: a hand that picks the creature up and pushes things into it, and the senses by which it
//! notices.
//!
//! The hand is the physics' own (`physics::Hand`): a spring with a damper to the point held, with a
//! cap on its force, the same for the visitor on the page and for the visitor practice has. The page's
//! hand goes where the pointer goes; practice's (`Visits`) now and then lifts the creature by its body
//! or a leg and lets it go, nudges it, shoves a box into it, or drops one near it, as a visitor would,
//! so that being touched is part of what it practises in and it has reason to learn what to do about
//! it. Nothing here says what it should do: being lifted, dropped and pushed reach its brain as senses,
//! and the costs it already has (a fall, effort) do the rest.
//!
//! What it feels (`feel`), when its body is made to feel touch (`Body::touch`): how hard everything
//! presses on its body and on each foot, in its own weights; whether a hand holds it; and a jolt, the
//! push its body feels as an animal's inner ear does (its acceleration less gravity, in g, eased over a
//! few steps): standing still it is one up, falling it is nothing, lifted it is more than one, pushed
//! it leans sideways.

use super::envs::Run;
use super::stage::Stage;
use crate::body::Creature;
use crate::learn::Random;
use crate::math::Vec2;
use crate::physics::{STEP, World};

/// The hand: the spring's stiffness in newtons a metre, its damping (1 just does not bounce), the most
/// force it gives in newtons, the fastest it goes in metres a second, and the fastest what it lets go
/// of may keep going. The creature weighs about 10 kg, so it hangs about 7 cm under the hand.
pub const STIFFNESS: f32 = 1500.0;
pub const DAMPING: f32 = 0.7;
pub const MOST_FORCE: f32 = 400.0;
pub const FASTEST: f32 = 4.0;
pub const THROW: f32 = 3.0;
/// How much of the way to the jolt of the last step the jolt felt goes, each step.
const JOLT_EASE: f32 = 0.35;
/// The most a pressure, in the creature's weights, and a jolt, in g, are felt as.
const MOST_PRESSED: f32 = 2.0;
const MOST_JOLT: f32 = 3.0;

/// How many numbers it feels of touch, for so many legs: its body, each foot, being held, the jolt.
pub fn felt(legs: usize) -> usize {
    1 + legs + 1 + 2
}

/// Whether a hand holds any part of the creature.
pub fn held(creature: &Creature, world: &World) -> bool {
    let group = world.bodies[creature.torso as usize].group;
    world.hand.is_some_and(|hand| world.bodies[hand.body as usize].group == group)
}

/// The creature's whole weight, in newtons.
fn weight(creature: &Creature, world: &World) -> f32 {
    let parts = core::iter::once(creature.torso).chain(creature.legs.iter().flat_map(|leg| [leg.upper, leg.lower]));
    parts.map(|part| world.bodies[part as usize].mass).sum::<f32>() * -world.gravity.y
}

/// What it feels of touch, written into `into`, `felt(legs)` long: the pressure on its body and on
/// each foot, in its own weights; 1 if held; and the jolt (`Run::jolt`), across and up.
pub fn feel(creature: &Creature, world: &World, jolt: Vec2, into: &mut [f32]) {
    let weight = weight(creature, world).max(1e-3);
    into[0] = (world.pressed(creature.torso) / weight).min(MOST_PRESSED);
    for (k, leg) in creature.legs.iter().enumerate() {
        into[1 + k] = (world.pressed(leg.lower) / weight).min(MOST_PRESSED);
    }
    let at = 1 + creature.legs.len();
    into[at] = if held(creature, world) { 1.0 } else { 0.0 };
    into[at + 1] = jolt.x.clamp(-MOST_JOLT, MOST_JOLT);
    into[at + 2] = jolt.y.clamp(-MOST_JOLT, MOST_JOLT);
}

/// The jolt after a step, from the one before, the body's speed before the step and its speed now.
pub fn jolt(before: Vec2, was: Vec2, now: Vec2, gravity: Vec2) -> Vec2 {
    let felt = ((now - was) * (1.0 / STEP) - gravity) * (1.0 / -gravity.y.min(-1e-3));
    before + (felt - before) * JOLT_EASE
}

/// What practice's visitor does.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Visit {
    /// Lifts it by its body, a little to one side, and lets it go, from where it lifted it to or set
    /// down near the ground first (`down`).
    Lift { down: bool },
    /// Lifts it by one of its feet and lets it go.
    Leg,
    /// Gives its body a short push to one side.
    Nudge,
    /// Puts a box on the ground beside it and slides it into it.
    Shove,
    /// Drops a box from above, near it.
    Drop,
}

/// Practice's visitor, one for each run: when it next comes, and what it is doing. Seeded by the run's
/// world, so practice is the same every time whatever else runs beside it.
#[derive(Clone, Debug)]
pub struct Visits {
    random: Random,
    /// The step of the run the next visit comes at, what the visit now going on is, and the step it
    /// ends at.
    next: u32,
    doing: Option<Visit>,
    until: u32,
    began: u32,
}

/// The first visit comes no sooner than this into a run, in seconds; a lift lasts 0.8 to 2 s, a lift
/// by a foot 0.6 to 1.5 s, a nudge 0.2 to 0.35 s, a shove 2 s, and the hand slides a box at this
/// speed, in metres a second.
const FIRST: f32 = 2.0;
const SHOVE_SPEED: f32 = 1.0;

fn steps(seconds: f32) -> u32 {
    (seconds / STEP) as u32
}

impl Visits {
    pub fn new(seed: u32) -> Visits {
        Visits { random: Random::new(seed as u64 ^ 0x7a11_c0de_0000_0000), next: 0, doing: None, until: 0, began: 0 }
    }

    /// Whether a visit is going on.
    pub fn busy(&self) -> bool {
        self.doing.is_some()
    }

    /// What the visit going on is, if one is.
    pub fn doing(&self) -> Option<Visit> {
        self.doing
    }

    fn between(&mut self, low: f32, high: f32) -> f32 {
        low + (high - low) * self.random.unit()
    }

    /// Before each step of a run: starts a visit when one is due (`every` seconds apart on average, and
    /// each one that is due made only `share` of the time), moves the hand of one going on, and ends it.
    pub fn before_step(&mut self, run: &mut Run, every: f32, share: f32) {
        let now = run.stage.world.steps;
        if self.next == 0 {
            self.next = steps(FIRST + self.between(0.0, every));
        }
        match self.doing {
            None if now >= self.next => {
                self.next = now + steps(self.between(0.5, 1.5) * every);
                if self.random.unit() < share {
                    self.start(run, now);
                }
            }
            None => {}
            Some(visit) => self.go_on(run, visit, now),
        }
    }

    fn start(&mut self, run: &mut Run, now: u32) {
        let creature = &run.body.creature;
        let world = &mut run.stage.world;
        let torso = world.bodies[creature.torso as usize].position;
        let pick = self.random.unit();
        let side = if self.random.unit() < 0.5 { -1.0 } else { 1.0 };
        let (visit, seconds) = if pick < 0.35 {
            let down = self.random.unit() < 0.5;
            world.hold(creature.torso, torso, STIFFNESS, DAMPING, MOST_FORCE, FASTEST);
            let goal = torso + Vec2::new(self.between(-0.2, 0.2), self.between(0.4, 0.8));
            hand_to(world, goal);
            (Visit::Lift { down }, self.between(0.8, 2.0))
        } else if pick < 0.5 {
            let leg = creature.legs[self.random.below(creature.legs.len())];
            let foot = world.bodies[leg.lower as usize].position;
            world.hold(leg.lower, foot, STIFFNESS, DAMPING, MOST_FORCE, FASTEST);
            hand_to(world, foot + Vec2::new(self.between(-0.2, 0.2), self.between(0.5, 0.7)));
            (Visit::Leg, self.between(0.6, 1.5))
        } else if pick < 0.7 {
            world.hold(creature.torso, torso, STIFFNESS, DAMPING, MOST_FORCE, FASTEST);
            hand_to(world, torso + Vec2::new(side * self.between(0.35, 0.5), 0.05));
            (Visit::Nudge, self.between(0.2, 0.35))
        } else if pick < 0.9 {
            let half = self.between(0.12, 0.2);
            let Some(at) = room_for_box(&run.stage, torso.x + side * 1.3, half) else { return };
            let body = run.stage.place_box(at, half);
            let world = &mut run.stage.world;
            world.hold(body, at, STIFFNESS, DAMPING, MOST_FORCE, SHOVE_SPEED);
            // toward the creature and past it, along the ground, at the hand's own slow speed
            hand_to(world, Vec2::new(torso.x - side * 0.6, at.y));
            (Visit::Shove, 2.0)
        } else {
            let half = self.between(0.12, 0.2);
            let Some(at) = room_for_box(&run.stage, torso.x + side * self.between(0.6, 1.2), half) else { return };
            run.stage.place_box(at + Vec2::new(0.0, 1.0), half);
            (Visit::Drop, 0.0)
        };
        if seconds > 0.0 {
            self.doing = Some(visit);
            self.began = now;
            self.until = now + steps(seconds);
        }
    }

    fn go_on(&mut self, run: &mut Run, visit: Visit, now: u32) {
        let world = &mut run.stage.world;
        if world.hand.is_none() {
            // what it held was taken away, far behind
            self.doing = None;
            return;
        }
        if now >= self.until {
            world.let_go(THROW);
            self.doing = None;
            return;
        }
        // a lift that sets it down lowers it, over the last part of the visit, to where its feet are
        // about to touch the ground
        if let Visit::Lift { down: true } = visit {
            let along = (now - self.began) as f32 / (self.until - self.began).max(1) as f32;
            if along > 0.6 {
                let torso = world.bodies[run.body.creature.torso as usize].position;
                if let Some(ground) = world.ground_height(torso.x) {
                    let goal = world.hand.map_or(torso, |hand| hand.goal);
                    hand_to(world, Vec2::new(goal.x, ground + run.body.creature.stand + 0.08));
                }
            }
        }
    }
}

fn hand_to(world: &mut World, goal: Vec2) {
    if let Some(hand) = &mut world.hand {
        hand.goal = goal;
    }
}

/// Where a box of this half size can stand on the ground at x in the physics, if there is level
/// enough ground there with nothing on it: its middle.
fn room_for_box(stage: &Stage, x: f32, half: f32) -> Option<Vec2> {
    let world = &stage.world;
    let (left, middle, right) = (world.ground_height(x - half)?, world.ground_height(x)?, world.ground_height(x + half)?);
    if (left - middle).abs() > 0.05 || (right - middle).abs() > 0.05 {
        return None;
    }
    let at = Vec2::new(x, left.max(middle).max(right) + half + 0.01);
    let clear = world.bodies.iter().all(|body| body.distance_to(at) > half * 1.5);
    let dry = stage.hazard(at - Vec2::new(half, half), at + Vec2::new(half, half)).is_none();
    (clear && dry).then_some(at)
}
