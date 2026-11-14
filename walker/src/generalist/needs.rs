//! Needs: energy that runs down, and food to find. Stage 2 of the plan (`docs/generalist-plan.md`).
//!
//! Energy is a number in the body from 0 to 1. The motors' work spends it (`FULL` joules for each
//! kilogram of the creature is all of it, so the heavier four legs carry more),
//! and so does being awake, a little each second; eating restores it, and so, slowly, does resting:
//! staying still, more so low, with a foot on something. Tired, its muscles weaken (`vigour`): below
//! `TIRED` their strength falls smoothly, to `WEAKEST` of what it was with none left. Nothing ends a run
//! for hunger, and nothing hurts: tiredness is the whole of the consequence. It never dies of it.
//!
//! Food is eaten when any part of the creature comes to it (`stage::Stage::food`). Now and then food
//! appears near it, dropped from a little above, ahead or behind, so a new thing turns up to be noticed
//! and some food is off the way it is going (`Appearing`).
//!
//! What it is paid for is worked out in `practice::shaped` from what this keeps: how far it is from
//! comfort before and after each step (`discomfort`, which grows faster as it empties), so eating pays
//! more when hungry, and the motors' work costs more when tired.
//!
//! A run may be play (`Needs::play`): its energy held full and no food put out, so only curiosity and
//! its own costs apply.

use super::envs::Run;
use super::eyes::FOOD_RADIUS;
use crate::learn::Random;
use crate::math::{Vec2, clamp};
use crate::physics::STEP;

/// All of its energy, in joules of the motors' work for each kilogram it weighs: two legs weigh 10 kg
/// and walking at a metre a second costs them about 150 J a metre, so full, they walk about 40 s on
/// nothing; four legs weigh 16 kg and spend about as much for each kilogram.
pub const FULL: f32 = 600.0;
/// What being awake costs, and the most resting restores, each second, as shares of all of it.
pub const AWAKE: f32 = 1.0 / 240.0;
pub const REST: f32 = 1.0 / 30.0;
/// What a piece of food restores.
pub const FOOD: f32 = 0.2;
/// Below this its muscles weaken, down to this share of their strength with nothing left.
pub const TIRED: f32 = 0.4;
pub const WEAKEST: f32 = 0.35;
/// How near a part's surface food's middle must come to be eaten, in metres.
const BITE: f32 = FOOD_RADIUS + 0.04;
/// How quickly the sense of having eaten fades, each step.
const ATE_FADE: f32 = 0.93;
/// Resting: the speed at which the body counts as not still at all, in metres a second, and how much
/// lower than it stands it must be to rest fully, as a share of how tall it stands.
const STILL: f32 = 0.3;
const LOW: f32 = 0.5;

/// How far from comfort it is at an energy: none full, growing faster as it empties.
pub fn discomfort(energy: f32) -> f32 {
    let empty = 1.0 - clamp(energy, 0.0, 1.0);
    empty + empty * empty
}

/// A creature's energy, and what it keeps for its senses and its pay.
#[derive(Clone, Debug)]
pub struct Needs {
    pub energy: f32,
    /// 1 the step it eats, fading after: the sense of having eaten.
    pub ate: f32,
    /// How many pieces it has eaten in this run.
    pub eaten: u32,
    /// How much it rested in the last step, from 0 to 1 (`rest`).
    pub resting: f32,
    /// Whether this run is play: its energy held full and no food put out.
    pub play: bool,
    /// Its discomfort before the last step, after what it spent and rested, and after what it ate.
    pub comfort: [f32; 3],
    /// Food that appears now and then, if it does.
    pub appearing: Option<Appearing>,
    /// All of its energy, in joules (`FULL` for each kilogram).
    pub full: f32,
}

impl Needs {
    pub fn new(energy: f32) -> Needs {
        let d = discomfort(energy);
        Needs { energy: clamp(energy, 0.0, 1.0), ate: 0.0, eaten: 0, resting: 0.0, play: false, comfort: [d; 3], appearing: None, full: 10.0 * FULL }
    }

    /// The same, for this creature: all of its energy is `FULL` for each kilogram it weighs.
    pub fn of(energy: f32, creature: &crate::body::Creature, world: &crate::physics::World) -> Needs {
        let parts = core::iter::once(creature.torso).chain(creature.legs.iter().flat_map(|leg| [leg.upper, leg.lower]));
        let mass: f32 = parts.map(|part| world.bodies[part as usize].mass).sum();
        Needs { full: FULL * mass, ..Needs::new(energy) }
    }

    /// How strong its muscles are, from `WEAKEST` to 1, by how much energy it has.
    pub fn vigour(&self) -> f32 {
        let t = clamp(self.energy / TIRED, 0.0, 1.0);
        WEAKEST + (1.0 - WEAKEST) * t * t * (3.0 - 2.0 * t)
    }
}

/// How much the creature of this run is resting now, from 0 to 1: still, with a foot down, not held,
/// and more so the lower it is held.
pub fn rest(run: &Run) -> f32 {
    let world = &run.stage.world;
    let creature = &run.body.creature;
    if run.held() || !run.body.footed(world) {
        return 0.0;
    }
    let torso = &world.bodies[creature.torso as usize];
    let speed = crate::math::sqrt(torso.velocity.x * torso.velocity.x + torso.velocity.y * torso.velocity.y);
    let still = clamp(1.0 - speed / STILL, 0.0, 1.0);
    let low = clamp((1.0 - creature.tallness(world)) / LOW, 0.0, 1.0);
    still * (0.4 + 0.6 * low)
}

/// After each step of the physics: what the motors did and being awake spend, what resting restores,
/// and any food it reaches is eaten. Its discomfort before and after is kept for its pay.
pub fn after_step(run: &mut Run) {
    let Some(mut needs) = run.body.needs.take() else { return };
    let before = discomfort(needs.energy);
    let spent = run.body.creature.effort(&run.stage.world) / needs.full + AWAKE * STEP;
    needs.resting = if needs.energy < 1.0 { rest(run) } else { 0.0 };
    needs.energy = clamp(needs.energy - spent + REST * STEP * needs.resting, 0.0, 1.0);
    let rested = discomfort(needs.energy);
    needs.ate *= ATE_FADE;
    let eaten = eat(run);
    if eaten > 0 {
        needs.energy = (needs.energy + FOOD * eaten as f32).min(1.0);
        needs.eaten += eaten;
        needs.ate = 1.0;
    }
    needs.comfort = [before, rested, discomfort(needs.energy)];
    if needs.play {
        // play is charged for its effort as if it were full (where discomfort grows by one for each
        // share of energy spent), and is full again after
        needs.comfort = [0.0, spent, spent];
        needs.energy = 1.0;
    }
    run.body.needs = Some(needs);
}

/// Eats every piece of food a part of the creature has come to; returns how many.
fn eat(run: &mut Run) -> u32 {
    let creature = &run.body.creature;
    let world = &run.stage.world;
    // a handful of parts and of pieces near, so both loops are short
    let reaches = |at: Vec2| core::iter::once(creature.torso).chain(creature.legs.iter().flat_map(|leg| [leg.upper, leg.lower])).any(|part| world.bodies[part as usize].distance_to(at) < BITE);
    let mut eaten = 0;
    let mut k = 0;
    while k < run.stage.food.len() {
        if reaches(run.stage.food[k].at) {
            run.stage.food.remove(k);
            eaten += 1;
        } else {
            k += 1;
        }
    }
    eaten
}

/// Food that appears near the creature now and then, as fruit falls: every `every` seconds or so, from
/// a little above the ground 1.5 to 4 m away, behind it more often than ahead. Seeded by its world.
#[derive(Clone, Debug)]
pub struct Appearing {
    random: Random,
    next: u32,
    every: f32,
}

impl Appearing {
    pub fn new(seed: u32, every: f32) -> Appearing {
        let mut random = Random::new(seed as u64 ^ 0x6672_7569_7400_0000);
        let next = ((2.0 + every * random.unit()) / STEP) as u32;
        Appearing { random, next, every }
    }

    /// Before each step: drops food when it is due, where there is ground to land on and no hazard.
    pub fn before_step(&mut self, run: &mut Run) {
        let now = run.stage.world.steps;
        if now < self.next {
            return;
        }
        self.next = now + ((0.5 + self.random.unit()) * self.every / STEP) as u32;
        let torso = run.stage.world.bodies[run.body.creature.torso as usize].position;
        let side = if self.random.unit() < 0.6 { -1.0 } else { 1.0 };
        let x = torso.x + side * (1.5 + 2.5 * self.random.unit());
        let Some(ground) = run.stage.world.ground_height(x) else { return };
        let at = Vec2::new(x, ground + 0.8);
        if run.stage.hazard(at - Vec2::new(0.1, 1.0), at + Vec2::new(0.1, 0.0)).is_none() {
            run.stage.drop_food(at);
        }
    }
}
