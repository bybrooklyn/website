//! What a creature that wants things did about them, counted while it is measured in held-out worlds
//! (`practice::measure`), for the article: how much it ate, how long it rested and whether its energy
//! came back and it went on after, how much of the world it saw, and how often its eye was on the
//! nearest thing worth looking at, beside how often a gaze would be by chance.

use alloc::vec::Vec;

use super::envs::Run;
use super::eyes::{self, GAZE_HIGH, GAZE_LOW, GAZE_REST, RANGE};
use crate::math::{PI, Vec2, atan2};

/// How near the middle of its gaze a thing must be to count as looked at: the middle four rays reach
/// 11 degrees either way.
pub const ON: f32 = 10.0 * PI / 180.0;
/// A rest counts once it lasts this many steps (a second).
const BOUT: u32 = 60;

/// One creature's counts in one held-out run.
#[derive(Clone, Debug, PartialEq)]
pub struct Tally {
    pub steps: u64,
    pub eaten: u32,
    /// Steps spent resting (more than half: `needs::rest`), and the energy it gained over them.
    pub resting: u64,
    pub rest_gain: f64,
    /// Its energy, summed over the steps, and the lowest it went.
    pub energy: f64,
    pub lowest: f32,
    /// Rests of a second or more; of those, how many ended with more energy than they began with, and
    /// how many were followed by its going on a metre or more.
    pub bouts: u32,
    pub recovered: u32,
    pub went_on: u32,
    bout: Option<(u32, f32)>,
    after: Option<f32>,
    last: f32,
    /// Decisions with something worth looking at within sight (food, a box, a moving thing); of those,
    /// how many with its eye on the nearest; the chance of that for a gaze anywhere in its range; and
    /// the share of them a gaze left where an action of 0 puts it would have been on it.
    pub looked: u64,
    pub on: u64,
    pub chance: f64,
    pub resting_on: u64,
    /// The share of the world around where it went that it saw, at the end.
    pub seen: f32,
    /// Where its eye looked at each decision, summed, and its square summed, in radians, and decisions.
    pub gaze: f64,
    pub gaze_squared: f64,
    pub decisions: u64,
}

impl Default for Tally {
    fn default() -> Tally {
        Tally { steps: 0, eaten: 0, resting: 0, rest_gain: 0.0, energy: 0.0, lowest: 1.0, bouts: 0, recovered: 0, went_on: 0, bout: None, after: None, last: -1.0, looked: 0, on: 0, chance: 0.0, resting_on: 0, seen: 0.0, gaze: 0.0, gaze_squared: 0.0, decisions: 0 }
    }
}

/// The smallest turn from angle `b` to angle `a`, in radians, from -pi to pi.
fn apart(a: f32, b: f32) -> f32 {
    let mut d = a - b;
    while d > PI {
        d -= 2.0 * PI;
    }
    while d < -PI {
        d += 2.0 * PI;
    }
    d
}

/// The chance that a gaze drawn evenly from its range is within `ON` of the direction `toward`.
fn chance_on(toward: f32) -> f32 {
    let mut covered = 0.0;
    for turn in [-2.0 * PI, 0.0, 2.0 * PI] {
        let (low, high) = (toward + turn - ON, toward + turn + ON);
        covered += (high.min(GAZE_HIGH) - low.max(GAZE_LOW)).max(0.0);
    }
    covered / (GAZE_HIGH - GAZE_LOW)
}

impl Tally {
    /// After each step of the physics.
    pub fn after_step(&mut self, run: &Run) {
        let Some(needs) = &run.body.needs else { return };
        let x = run.distance();
        self.steps += 1;
        self.eaten = needs.eaten;
        self.energy += needs.energy as f64;
        self.lowest = self.lowest.min(needs.energy);
        if self.last < 0.0 {
            self.last = needs.energy;
        }
        if needs.resting > 0.5 {
            self.resting += 1;
            self.rest_gain += (needs.energy - self.last) as f64;
            self.bout = Some(self.bout.map_or((1, needs.energy), |(steps, from)| (steps + 1, from)));
        } else if let Some((steps, from)) = self.bout.take() {
            if steps >= BOUT {
                self.bouts += 1;
                self.recovered += u32::from(needs.energy > from + 0.02);
                self.after = Some(x);
            }
        }
        if self.after.is_some_and(|from| x > from + 1.0) {
            self.went_on += 1;
            self.after = None;
        }
        self.last = needs.energy;
        if let Some(curiosity) = &run.curiosity {
            self.seen = curiosity.share_seen();
        }
    }

    /// At each decision: whether its eye is on the nearest thing worth looking at.
    pub fn look(&mut self, run: &Run) {
        if !run.body.gazing {
            return;
        }
        let gaze = run.body.gaze as f64;
        (self.gaze, self.gaze_squared, self.decisions) = (self.gaze + gaze, self.gaze_squared + gaze * gaze, self.decisions + 1);
        let stage = &run.stage;
        let eye = eyes::eye(stage, run.body.creature.torso);
        let things = stage.made.iter().map(|made| stage.world.bodies[made.body as usize].position);
        let nearest = stage.food.iter().map(|food| food.at).chain(things).map(|at| (at, (at - eye).length())).filter(|&(_, distance)| distance < RANGE).fold(None, |best: Option<(Vec2, f32)>, each| if best.is_none_or(|best| each.1 < best.1) { Some(each) } else { best });
        let Some((at, _)) = nearest else { return };
        let toward = atan2(at.y - eye.y, at.x - eye.x);
        self.looked += 1;
        self.on += u64::from(apart(toward, run.body.gaze).abs() < ON);
        self.resting_on += u64::from(apart(toward, GAZE_REST).abs() < ON);
        self.chance += chance_on(toward) as f64;
    }
}

/// What a controller's creatures wanted and did, over every held-out run.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Wants {
    /// Pieces of food eaten a minute.
    pub food: f32,
    /// The share of the time resting, and the energy gained for each second of it.
    pub resting: f32,
    pub rest_gain: f32,
    /// Rests of a second or more a minute; the share that ended with more energy, and the share after
    /// which it went on.
    pub bouts: f32,
    pub recovered: f32,
    pub went_on: f32,
    /// Its energy on average, and the lowest it went on average.
    pub energy: f32,
    pub lowest: f32,
    /// The share of decisions with something worth looking at in sight that its eye was on the nearest,
    /// the same for a gaze anywhere in its range by chance, and for a gaze left where it rests.
    pub on: f32,
    pub chance: f32,
    pub resting_on: f32,
    /// The share of the world around where it went that it saw, on average over the runs.
    pub seen: f32,
    /// Where its eye looked, on average, and how widely that varied, in degrees from level ahead.
    pub gaze: f32,
    pub gaze_spread: f32,
}

impl Wants {
    pub fn of(tallies: &[Tally]) -> Wants {
        let steps: u64 = tallies.iter().map(|tally| tally.steps).sum();
        if steps == 0 {
            return Wants::default();
        }
        let minutes = steps as f32 * crate::physics::STEP / 60.0;
        let sum = |f: fn(&Tally) -> f64| tallies.iter().map(f).sum::<f64>() as f32;
        let (bouts, looked) = (sum(|t| t.bouts as f64), sum(|t| t.looked as f64));
        let resting = sum(|t| t.resting as f64);
        let mut wants = Wants {
            food: sum(|t| t.eaten as f64) / minutes,
            resting: resting / steps as f32,
            rest_gain: if resting > 0.0 { sum(|t| t.rest_gain) / (resting * crate::physics::STEP) } else { 0.0 },
            bouts: bouts / minutes,
            recovered: if bouts > 0.0 { sum(|t| t.recovered as f64) / bouts } else { 0.0 },
            went_on: if bouts > 0.0 { sum(|t| t.went_on as f64) / bouts } else { 0.0 },
            energy: sum(|t| t.energy) / steps as f32,
            lowest: sum(|t| t.lowest as f64) / tallies.len() as f32,
            on: if looked > 0.0 { sum(|t| t.on as f64) / looked } else { 0.0 },
            chance: if looked > 0.0 { sum(|t| t.chance) / looked } else { 0.0 },
            resting_on: if looked > 0.0 { sum(|t| t.resting_on as f64) / looked } else { 0.0 },
            seen: sum(|t| t.seen as f64) / tallies.len() as f32,
            gaze: 0.0,
            gaze_spread: 0.0,
        };
        let decisions = sum(|t| t.decisions as f64);
        if decisions > 0.0 {
            let mean = sum(|t| t.gaze) / decisions;
            wants.gaze = mean.to_degrees();
            wants.gaze_spread = crate::math::sqrt((sum(|t| t.gaze_squared) / decisions - mean * mean).max(0.0)).to_degrees();
        }
        wants
    }
}

/// The counts of every run, for `Wants::of`.
pub fn fresh(count: usize) -> Vec<Tally> {
    alloc::vec![Tally::default(); count]
}
