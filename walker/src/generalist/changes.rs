//! A world that changes while it lives: stage 4 of the plan (`docs/generalist-plan.md`). Nothing cruel
//! is done to the creature; the world changes around it, and it meets the changes as they come.
//!
//! What can change (`Conditions`): the ground's grip (from ice to sticky), how much it bounces, how soft
//! it is (`World::give`: feet sink into it), gravity, a wind (a push along the way on everything that
//! moves, felt by the body as a lean of its jolt), and the light, from day to night: in the dark it
//! sees less far (`sight`), so touch, hearing and memory matter more. Each has a rest, the world as it
//! always was, and the page's controls say where each is.
//!
//! In practice they change by stretches (`Changes::before_step`, from a `Setting`): now and then one of
//! them moves to a new value, or back to its rest, and stays there a while; light, wind and gravity ease
//! to theirs, the ground changes at once. And things are dropped near it, a box or a piece of food,
//! mostly in front of it. How much of each, how often, and how rough its world is, is the setting: drawn
//! evenly at random for each run, or bred by the teacher (`teacher`) to stay at the edge of what it can
//! do. On the page nothing changes by itself unless the visitor switches the changing world on.
//!
//! It also hears (`Run::hear`): a box or a piece of food landing makes a sound it feels from either
//! side, louder the nearer and the heavier, fading over a second, so it can know that something landed
//! behind it without seeing it.

use super::envs::Run;
use crate::learn::Random;
use crate::math::{Vec2, clamp};
use crate::physics::STEP;

/// The world's conditions: the ground's grip (as a share of the grip its feet and body have of their
/// own: feet 1, body and thighs 0.6), how much the ground bounces (restitution), how soft it is (0 to 1), gravity in g, the wind as a push along the way
/// in metres a second squared (more than 0 from behind it), and the light from 0 (night) to 1 (day).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Conditions {
    pub grip: f32,
    pub bounce: f32,
    pub soft: f32,
    pub gravity: f32,
    pub wind: f32,
    pub light: f32,
}

impl Conditions {
    /// The world as it always was: every part's own grip, no bounce, firm ground, 10 m/s² down, no
    /// wind, day.
    pub const REST: Conditions = Conditions { grip: 1.0, bounce: 0.0, soft: 0.0, gravity: 1.0, wind: 0.0, light: 1.0 };
    /// Ground like ice and ground that is sticky, as grips.
    pub const ICE: f32 = 0.06;
    pub const STICKY: f32 = 2.5;
    /// The most the ground bounces, gravity's least and most in g, and the strongest wind.
    pub const BOUNCIEST: f32 = 0.75;
    pub const LIGHTEST: f32 = 0.5;
    pub const HEAVIEST: f32 = 1.6;
    pub const STRONGEST: f32 = 6.0;

    /// Kept within what each can be.
    pub fn clamped(self) -> Conditions {
        Conditions {
            grip: clamp(self.grip, Conditions::ICE, Conditions::STICKY),
            bounce: clamp(self.bounce, 0.0, Conditions::BOUNCIEST),
            soft: clamp(self.soft, 0.0, 1.0),
            gravity: clamp(self.gravity, Conditions::LIGHTEST, Conditions::HEAVIEST),
            wind: clamp(self.wind, -Conditions::STRONGEST, Conditions::STRONGEST),
            light: clamp(self.light, 0.0, 1.0),
        }
    }

    /// The same, as a list of six in the order `Setting::amounts` keeps them.
    pub fn list(self) -> [f32; 6] {
        [self.grip, self.bounce, self.soft, self.gravity, self.wind, self.light]
    }

    pub fn from_list(list: [f32; 6]) -> Conditions {
        Conditions { grip: list[0], bounce: list[1], soft: list[2], gravity: list[3], wind: list[4], light: list[5] }
    }
}

/// How far the creature sees in this light, in metres: all of `eyes::RANGE` by day, a quarter of it at
/// night. Never nothing: it is not blinded, only in the dark.
pub fn sight(light: f32) -> f32 {
    super::eyes::RANGE * (0.25 + 0.75 * clamp(light, 0.0, 1.0))
}

/// What one world's changes are like, each from 0 to 1: how much each condition may change (in the
/// order of `Conditions::list`), how often a change comes, how often things are dropped near it, and how
/// rough its land is beside the kind asked for (0.5 as asked). The teacher breeds these.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Setting {
    pub amounts: [f32; 6],
    pub often: f32,
    pub drops: f32,
    pub rough: f32,
}

impl Setting {
    /// Nothing changes, nothing is dropped, the land as asked.
    pub const STILL: Setting = Setting { amounts: [0.0; 6], often: 0.0, drops: 0.0, rough: 0.5 };
    /// What held-out worlds are measured with when they change: some of everything.
    pub const TEST: Setting = Setting { amounts: [0.6; 6], often: 0.5, drops: 0.5, rough: 0.5 };

    /// A setting drawn evenly at random, every number from 0 to 1.
    pub fn drawn(random: &mut Random) -> Setting {
        let mut amounts = [0.0; 6];
        for amount in &mut amounts {
            *amount = random.unit();
        }
        Setting { amounts, often: random.unit(), drops: random.unit(), rough: random.unit() }
    }

    /// Its numbers as one list of nine, for breeding and for the page: the six amounts, how often, drops, rough.
    pub fn genes(&self) -> [f32; 9] {
        let a = self.amounts;
        [a[0], a[1], a[2], a[3], a[4], a[5], self.often, self.drops, self.rough]
    }

    pub fn from_genes(genes: [f32; 9]) -> Setting {
        let g = genes.map(|x| clamp(x, 0.0, 1.0));
        Setting { amounts: [g[0], g[1], g[2], g[3], g[4], g[5]], often: g[6], drops: g[7], rough: g[8] }
    }

    /// How much of everything it asks, from 0 to 1: the mean of its numbers but rough's.
    pub fn amount(&self) -> f32 {
        (self.amounts.iter().sum::<f32>() + self.often + self.drops) / 8.0
    }

    /// The difficulty of a land of this setting, for a kind of world asked at `difficulty`.
    pub fn difficulty(&self, difficulty: f32) -> f32 {
        clamp(difficulty + 0.4 * (self.rough - 0.5), 0.0, 1.0)
    }
}

/// Seconds between changes, at the least often and the most often, and between drops.
const CHANGE_SECONDS: [f32; 2] = [14.0, 3.0];
const DROP_SECONDS: [f32; 2] = [30.0, 4.0];
/// The share of changes that go back to the rest, and of drops that are food rather than a box, and of
/// boxes dropped in front of it rather than behind.
const BACK: f32 = 0.25;
const FOOD_DROPS: f32 = 0.3;
const IN_FRONT: f32 = 0.7;
/// How much of the way to where it is going the light, the wind and gravity go each step: the light in
/// about two seconds, the wind in about one, gravity in half of one.
const EASE: [f32; 3] = [0.03, 0.06, 0.12];

/// A world's changes: its conditions now and where they are going, and, in a world that changes by
/// itself, its setting and when the next change and the next drop come.
#[derive(Clone, Debug)]
pub struct Changes {
    pub now: Conditions,
    pub aim: Conditions,
    pub setting: Option<Setting>,
    random: Random,
    next_change: u32,
    next_drop: u32,
    /// The step of its run at which the world last changed (a change began), for the page, which draws
    /// what in the brain has changed since.
    pub changed: u32,
    /// How many times it has changed in this run.
    pub changes: u32,
}

impl Changes {
    /// A world at these conditions that changes only when told to.
    pub fn still(now: Conditions) -> Changes {
        Changes { now, aim: now, setting: None, random: Random::new(0), next_change: u32::MAX, next_drop: u32::MAX, changed: 0, changes: 0 }
    }

    /// A world that starts at rest and changes by itself as this setting has it, seeded by its world.
    pub fn of(setting: Setting, seed: u32) -> Changes {
        let mut changes = Changes::still(Conditions::REST);
        changes.set_going(Some(setting), seed);
        changes
    }

    /// Starts it changing by itself as this setting has it from the step `now` (or stops it, with none),
    /// keeping its conditions as they are.
    pub fn set_going(&mut self, setting: Option<Setting>, seed: u32) {
        self.setting = setting;
        self.random = Random::new(seed as u64 ^ 0x6368_616e_6765_0000);
        (self.next_change, self.next_drop) = (u32::MAX, u32::MAX);
        if let Some(setting) = setting {
            self.next_change = self.gap(CHANGE_SECONDS, setting.often);
            if setting.drops > 0.0 {
                self.next_drop = self.gap(DROP_SECONDS, setting.drops);
            }
        }
    }

    /// Steps until the next of something that comes between `seconds` apart, the first at none and the
    /// second at all, drawn about that.
    fn gap(&mut self, seconds: [f32; 2], how: f32) -> u32 {
        let mean = seconds[0] + (seconds[1] - seconds[0]) * clamp(how, 0.0, 1.0);
        ((0.5 + self.random.unit()) * mean / STEP) as u32
    }

    /// Sets where the conditions are going, as the visitor does: the ground at once, the rest eased.
    pub fn aim_at(&mut self, aim: Conditions, step: u32) {
        let aim = aim.clamped();
        if aim != self.aim {
            self.changed = step;
            self.changes += 1;
        }
        self.aim = aim;
        (self.now.grip, self.now.bounce, self.now.soft) = (aim.grip, aim.bounce, aim.soft);
    }

    /// One change, drawn from the setting: one condition, chosen by how much each may change, moves to a
    /// new value as far from its rest as its amount allows, or back to its rest.
    fn change(&mut self, setting: Setting, step: u32) {
        let total: f32 = setting.amounts.iter().sum();
        if total < 1e-3 {
            return;
        }
        let mut pick = self.random.unit() * total;
        let mut which = 0;
        for (k, &amount) in setting.amounts.iter().enumerate() {
            which = k;
            if pick < amount {
                break;
            }
            pick -= amount;
        }
        let (back, how, side) = (self.random.unit() < BACK, setting.amounts[which] * self.random.unit(), self.random.unit() < 0.5);
        let rest = Conditions::REST.list();
        let mut aim = self.aim.list();
        aim[which] = if back {
            rest[which]
        } else {
            match which {
                0 => {
                    let far = if side { Conditions::ICE } else { Conditions::STICKY };
                    rest[0] + (far - rest[0]) * how
                }
                1 => Conditions::BOUNCIEST * how,
                2 => how,
                3 => {
                    let far = if side { Conditions::HEAVIEST } else { Conditions::LIGHTEST };
                    1.0 + (far - 1.0) * how
                }
                4 => {
                    let way = if side { 1.0 } else { -1.0 };
                    way * Conditions::STRONGEST * how
                }
                _ => 1.0 - how,
            }
        };
        self.aim_at(Conditions::from_list(aim), step);
    }

    /// Before each step of a run: a change or a drop if one is due, the conditions eased toward where
    /// they are going, and put into its world.
    pub fn before_step(&mut self, run: &mut Run) {
        let step = run.judge.steps;
        if let Some(setting) = self.setting {
            if step >= self.next_change {
                self.change(setting, step);
                self.next_change = step + self.gap(CHANGE_SECONDS, setting.often).max(1);
            }
            if step >= self.next_drop {
                drop_near(run, &mut self.random);
                self.next_drop = step + self.gap(DROP_SECONDS, setting.drops).max(1);
            }
        }
        let ease = |now: &mut f32, aim: f32, by: f32| *now += (aim - *now) * by;
        ease(&mut self.now.light, self.aim.light, EASE[0]);
        ease(&mut self.now.wind, self.aim.wind, EASE[1]);
        ease(&mut self.now.gravity, self.aim.gravity, EASE[2]);
        put(self.now, run);
    }
}

/// The grip a foot (a leg's lower part) and every other part of the creature has of its own
/// (`body::Creature::build`).
const FOOT_GRIP: f32 = 1.0;
const BODY_GRIP: f32 = 0.6;

/// Puts conditions into a run's world: its parts' grip and bounce (the ground's own, `physics::contact`,
/// are each body's), how soft the ground is, and gravity and the wind.
pub fn put(conditions: Conditions, run: &mut Run) {
    let creature = &run.body.creature;
    let world = &mut run.stage.world;
    for (part, own) in core::iter::once((creature.torso, BODY_GRIP)).chain(creature.legs.iter().flat_map(|leg| [(leg.upper, BODY_GRIP), (leg.lower, FOOT_GRIP)])) {
        let body = &mut world.bodies[part as usize];
        body.friction = own * conditions.grip;
        body.restitution = conditions.bounce;
    }
    world.give = conditions.soft;
    world.gravity = Vec2::new(conditions.wind, -10.0 * conditions.gravity);
}

/// Drops something near the creature, as the world does now and then: a box, mostly in front of it, or a
/// piece of food, either side, from a little above, where there is ground and no hazard under it.
fn drop_near(run: &mut Run, random: &mut Random) {
    let torso = run.stage.world.bodies[run.body.creature.torso as usize].position;
    let food = random.unit() < FOOD_DROPS && run.stage.feeds;
    let ahead = random.unit() < if food { 0.5 } else { IN_FRONT };
    let x = torso.x + if ahead { 1.0 } else { -1.0 } * (1.2 + 1.8 * random.unit());
    let size = 0.12 + 0.08 * random.unit();
    let Some(ground) = run.stage.world.ground_height(x) else { return };
    let at = Vec2::new(x, ground + 1.2);
    if run.stage.hazard(at - Vec2::new(0.3, 1.5), at + Vec2::new(0.3, 0.0)).is_some() {
        return;
    }
    if food {
        run.stage.drop_food(at);
    } else {
        run.stage.place_box(at, size);
    }
}

/// How many numbers it senses of a changing world, after touch, for a body that hears (`Body::hears`):
/// a landing heard ahead of it and behind it, the light, and how surprised it was by what it saw
/// (`expect`), which its brain writes in, since only the brain can be surprised.
pub const SENSES: usize = 4;

/// How loud a landing this far off is, for a thing of this loudness at a metre: fainter with distance.
pub fn loudness(distance: f32, loud: f32) -> f32 {
    clamp(loud * 2.0 / (1.0 + distance.abs()), 0.0, 1.0)
}

/// How much of what it heard is still heard after a step: it fades over about a second.
pub const HEARD_FADE: f32 = 0.96;
/// How loud a piece of food landing is beside a box, and how fast a box must have been falling, in
/// metres a second, to be heard landing.
pub const FOOD_LOUD: f32 = 0.6;
pub const THUD: f32 = 1.5;
