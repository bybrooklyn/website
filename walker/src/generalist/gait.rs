//! How a creature moves, in numbers, so that "it looks alive" can be measured rather than guessed at
//! from a filmstrip. A run is watched step by step (`Watch`), and many runs are summed into one
//! `Gait`: how much of the time its belly or a knee is on the ground, how much it is in the air with
//! nothing ahead to clear, how high and how level its body is carried, whether its feet take turns,
//! and how regular its strides are.
//!
//! Walking, for this creature, is held to `Gait::walks`: the thresholds are written there.

use alloc::vec;
use alloc::vec::Vec;

use crate::body::Creature;
use crate::math::sqrt;
use crate::physics::{STEP, World};

/// A foot's landing counts once it has been off the ground this many steps, so a foot that chatters
/// on the ground is not a stride.
const LIFTED: u32 = 3;

/// One run watched step by step.
#[derive(Clone, Debug, Default)]
pub struct Watch {
    pub steps: u64,
    /// Steps with the body touching anything, with a knee (a leg's upper part) touching, and with
    /// either.
    pub belly: u64,
    pub knees: u64,
    pub low: u64,
    /// Steps in the air with nothing ahead to clear (counted by the caller, who knows what the eyes
    /// saw).
    pub idle_air: u64,
    /// The body's height over the ground under it, as a share of the height it stood at, and its
    /// angle (0 upright), summed and summed squared, over the steps with ground under it.
    pub measured: u64,
    pub height: f64,
    pub height_squares: f64,
    pub pitch: f64,
    pub pitch_squares: f64,
    /// For the first two feet: steps each was down, and steps both were.
    pub down: [u64; 2],
    pub both: u64,
    /// For every foot: its landings, how long it has been up, and the gaps between its landings in
    /// steps (summed and summed squared).
    pub landings: Vec<u64>,
    lifted: Vec<u32>,
    last: Vec<u64>,
    pub gaps: Vec<(u64, f64, f64)>,
}

impl Watch {
    /// Takes in a step just taken; `idle` is whether it was in the air with nothing ahead to clear.
    pub fn after_step(&mut self, creature: &Creature, world: &World, idle: bool) {
        let legs = creature.legs.len();
        if self.landings.len() != legs {
            self.landings = vec![0; legs];
            self.lifted = vec![0; legs];
            self.last = vec![0; legs];
            self.gaps = vec![(0, 0.0, 0.0); legs];
        }
        self.steps += 1;
        let torso = &world.bodies[creature.torso as usize];
        let knee = creature.legs.iter().any(|leg| world.bodies[leg.upper as usize].touching);
        self.belly += u64::from(torso.touching);
        self.knees += u64::from(knee);
        self.low += u64::from(torso.touching || knee);
        self.idle_air += u64::from(idle);
        if let Some(ground) = world.ground_height(torso.position.x) {
            let height = ((torso.position.y - ground) / creature.stand) as f64;
            let pitch = torso.angle() as f64;
            self.measured += 1;
            self.height += height;
            self.height_squares += height * height;
            self.pitch += pitch;
            self.pitch_squares += pitch * pitch;
        }
        for (k, leg) in creature.legs.iter().enumerate() {
            let down = world.bodies[leg.lower as usize].touching;
            if k < 2 {
                self.down[k] += u64::from(down);
            }
            if down {
                if self.lifted[k] >= LIFTED {
                    if self.landings[k] > 0 {
                        let gap = (self.steps - self.last[k]) as f64;
                        let (count, sum, squares) = &mut self.gaps[k];
                        *count += 1;
                        *sum += gap;
                        *squares += gap * gap;
                    }
                    self.landings[k] += 1;
                    self.last[k] = self.steps;
                }
                self.lifted[k] = 0;
            } else {
                self.lifted[k] = self.lifted[k].saturating_add(1);
            }
        }
        if legs >= 2 {
            let (a, b) = (world.bodies[creature.legs[0].lower as usize].touching, world.bodies[creature.legs[1].lower as usize].touching);
            self.both += u64::from(a && b);
        }
    }
}

/// Many runs summed up. Each share is of all the steps of all the runs together.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Gait {
    /// The share of the time with the body or a knee on the ground, and with the body alone.
    pub low: f32,
    pub belly: f32,
    /// The share of the time in the air with nothing ahead to clear.
    pub idle_air: f32,
    /// The body's height over the ground, as a share of the height it stood at: its mean and spread.
    pub height: f32,
    pub height_spread: f32,
    /// The body's angle, in radians, 0 upright: its mean and spread.
    pub pitch: f32,
    pub pitch_spread: f32,
    /// How the first two feet's being down goes together, from -1 (always one down when the other is
    /// up: taking turns) to 1 (always together: hopping on both, or standing).
    pub together: f32,
    /// Landings of each foot a second, on average over the feet.
    pub cadence: f32,
    /// The fewest landings of any foot over the most, 1 when every foot steps as often as the others
    /// and 0 when one never does.
    pub balance: f32,
    /// How much the time between one foot's landings varies, its spread over its mean, averaged over
    /// the feet: 0 is a metronome.
    pub variation: f32,
}

impl Gait {
    pub fn of(watches: &[Watch]) -> Gait {
        let mut total = Watch::default();
        let legs = watches.iter().map(|watch| watch.landings.len()).max().unwrap_or(0);
        total.landings = vec![0; legs];
        total.gaps = vec![(0, 0.0, 0.0); legs];
        for watch in watches {
            total.steps += watch.steps;
            total.belly += watch.belly;
            total.knees += watch.knees;
            total.low += watch.low;
            total.idle_air += watch.idle_air;
            total.measured += watch.measured;
            total.height += watch.height;
            total.height_squares += watch.height_squares;
            total.pitch += watch.pitch;
            total.pitch_squares += watch.pitch_squares;
            total.both += watch.both;
            for k in 0..2 {
                total.down[k] += watch.down[k];
            }
            for (k, (&landed, gap)) in watch.landings.iter().zip(&watch.gaps).enumerate() {
                total.landings[k] += landed;
                total.gaps[k].0 += gap.0;
                total.gaps[k].1 += gap.1;
                total.gaps[k].2 += gap.2;
            }
        }
        let steps = total.steps.max(1) as f64;
        let share = |count: u64| (count as f64 / steps) as f32;
        let spread = |sum: f64, squares: f64, count: u64| {
            let n = count.max(1) as f64;
            let mean = sum / n;
            (mean as f32, sqrt((squares / n - mean * mean).max(0.0) as f32))
        };
        let (height, height_spread) = spread(total.height, total.height_squares, total.measured);
        let (pitch, pitch_spread) = spread(total.pitch, total.pitch_squares, total.measured);
        // the correlation of two lists of 0 and 1, from how often each is 1 and how often both are
        let (a, b, both) = (total.down[0] as f64 / steps, total.down[1] as f64 / steps, total.both as f64 / steps);
        let apart = (a * (1.0 - a) * b * (1.0 - b)).max(0.0);
        let together = if apart > 1e-9 { ((both - a * b) / sqrt(apart as f32) as f64) as f32 } else { 0.0 };
        let most = total.landings.iter().copied().max().unwrap_or(0);
        let fewest = total.landings.iter().copied().min().unwrap_or(0);
        let seconds = steps * STEP as f64;
        let variations: Vec<f32> = total.gaps.iter().filter(|gap| gap.0 >= 3).map(|&(count, sum, squares)| {
            let (mean, spread) = spread(sum, squares, count);
            spread / mean.max(1.0)
        }).collect();
        Gait {
            low: share(total.low),
            belly: share(total.belly),
            idle_air: share(total.idle_air),
            height,
            height_spread,
            pitch,
            pitch_spread,
            together,
            cadence: (total.landings.iter().sum::<u64>() as f64 / legs.max(1) as f64 / seconds) as f32,
            balance: if most > 0 { fewest as f32 / most as f32 } else { 0.0 },
            variation: if variations.len() == legs && legs > 0 { variations.iter().sum::<f32>() / legs as f32 } else { 9.0 },
        }
    }

    /// Whether it walks or runs on its feet, as this project means it: the body and knees off the
    /// ground nearly all the time (under 5 percent), in the air with nothing to clear under 10
    /// percent of the time, the body carried at least 0.75 of the height it stood at, the two legs
    /// taking turns (their being down correlated below -0.2, which only two legs are held to, since
    /// four may trot, bound or gallop) and every foot stepping (the fewest landings at least 0.7 of
    /// the most), at strides regular to within a spread of 0.35 of their length, and the body held
    /// upright: its lean under 0.35 radians on average (the Walker's `gait::UPRIGHT`), and rocking by
    /// less than that.
    pub fn walks(&self, legs: usize) -> bool {
        let upright = self.pitch.abs() < 0.35 && self.pitch_spread < 0.35;
        self.low < 0.05 && self.idle_air < 0.1 && self.height >= 0.75 && upright && (legs != 2 || self.together < -0.2) && self.balance >= 0.7 && self.variation < 0.35
    }
}
