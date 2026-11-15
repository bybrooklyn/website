//! The teacher: worlds bred to stay at the edge of what the creature can do (stage 4 of the plan, after
//! ACCEL: Parker-Holder and others, 2022, and before it POET and PAIRED), small enough to run in the
//! browser beside practice.
//!
//! It keeps a few world settings (`changes::Setting`: how much of each change, how often things change
//! and are dropped, how rough the land). Each practice run is in a world of one of them, drawn evenly,
//! and when the run ends the teacher is told whether the creature came through it, lasting its time
//! without falling or stalling. A setting's score is how near the edge it is: `4 p (1 - p)` for the
//! share `p` of its last runs it came through, so one it always comes through and one it never does
//! both score nothing, and one it comes through half the time scores 1; and, so that settings all too
//! easy or all too hard are still told apart, a little more for the harder of two too easy and for the
//! easier of two too hard. Every so many runs the two lowest are replaced by changed copies of better
//! ones. It starts with settings that ask little, and asks more as the creature can do more.

use alloc::vec::Vec;

use super::changes::Setting;
use crate::learn::Random;

/// How many settings it keeps, how many of each one's last runs it scores by, the fewest a setting must
/// have been tried before it is judged, how many runs between breedings, how many are replaced at each,
/// and how far a gene moves when it changes.
pub const KEPT: usize = 8;
const SCORED_BY: usize = 32;
const FEWEST: usize = 8;
const BREED_EVERY: u32 = 64;
const REPLACED: usize = 2;
const CHANGE: f32 = 0.15;

/// A setting the teacher keeps, and whether the creature came through each of its last runs.
#[derive(Clone, Debug)]
pub struct Member {
    pub setting: Setting,
    through: Vec<bool>,
}

impl Member {
    /// The share of its last runs the creature came through, if it has been tried at all.
    pub fn share(&self) -> Option<f32> {
        (!self.through.is_empty()).then(|| self.through.iter().filter(|&&t| t).count() as f32 / self.through.len() as f32)
    }

    /// How near the edge it is (above), once tried often enough to say.
    pub fn score(&self) -> Option<f32> {
        if self.through.len() < FEWEST {
            return None;
        }
        let p = self.share()?;
        Some(4.0 * p * (1.0 - p) + 0.2 * (p - 0.5) * (self.setting.amount() - 0.5))
    }
}

#[derive(Clone, Debug)]
pub struct Teacher {
    pub members: Vec<Member>,
    random: Random,
    since: u32,
    /// How many times it has bred.
    pub bred: u32,
}

impl Teacher {
    /// A teacher whose first settings ask little: every number from 0 to 0.3, the land a little easier
    /// than asked to as asked. Seeded, so practice is the same every time.
    pub fn new(seed: u64) -> Teacher {
        let mut random = Random::new(seed ^ 0x7465_6163_6865_7200);
        let members = (0..KEPT)
            .map(|_| {
                let mut genes = [0.0; 9];
                for gene in &mut genes[..8] {
                    *gene = 0.3 * random.unit();
                }
                genes[8] = 0.3 + 0.2 * random.unit();
                Member { setting: Setting::from_genes(genes), through: Vec::new() }
            })
            .collect();
        Teacher { members, random, since: 0, bred: 0 }
    }

    /// Which setting the next run is in: any, evenly.
    pub fn draw(&mut self) -> usize {
        self.random.below(self.members.len())
    }

    pub fn setting(&self, which: usize) -> Setting {
        self.members[which].setting
    }

    /// Takes in how a run in setting `which` went, and breeds when it is time.
    pub fn tell(&mut self, which: usize, came_through: bool) {
        let Some(member) = self.members.get_mut(which) else { return };
        if member.through.len() == SCORED_BY {
            member.through.remove(0);
        }
        member.through.push(came_through);
        self.since += 1;
        if self.since >= BREED_EVERY && self.members.iter().all(|member| member.through.len() >= FEWEST) {
            self.breed();
        }
    }

    /// The lowest scored settings replaced by changed copies of better ones, each picked as the better of
    /// two drawn from the rest.
    fn breed(&mut self) {
        self.since = 0;
        self.bred += 1;
        let mut order: Vec<usize> = (0..self.members.len()).collect();
        let scores: Vec<f32> = self.members.iter().map(|member| member.score().unwrap_or(0.0)).collect();
        let score = |k: usize| scores[k];
        // lowest first; ties by place, so the order is the same every time
        order.sort_by(|&a, &b| score(a).partial_cmp(&score(b)).unwrap_or(core::cmp::Ordering::Equal).then(a.cmp(&b)));
        let (low, rest) = order.split_at(REPLACED);
        for &replaced in low {
            let (a, b) = (rest[self.random.below(rest.len())], rest[self.random.below(rest.len())]);
            let parent = if score(a) >= score(b) { a } else { b };
            let mut genes = self.members[parent].setting.genes();
            for gene in &mut genes {
                if self.random.unit() < 0.5 {
                    // a step of a bell curve's size, from the sum of three draws
                    let step = (self.random.unit() + self.random.unit() + self.random.unit() - 1.5) * 2.0;
                    *gene += CHANGE * step;
                }
            }
            self.members[replaced] = Member { setting: Setting::from_genes(genes), through: Vec::new() };
        }
    }

    /// How much its settings ask on average (`Setting::amount`), and the share of runs the creature
    /// comes through over all of them, for a reader.
    pub fn standing(&self) -> (f32, f32) {
        let amount = self.members.iter().map(|member| member.setting.amount()).sum::<f32>() / self.members.len() as f32;
        let shares: Vec<f32> = self.members.iter().filter_map(Member::share).collect();
        (amount, shares.iter().sum::<f32>() / shares.len().max(1) as f32)
    }
}
