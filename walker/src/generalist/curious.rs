//! Curiosity: something for reaching places and seeing things it has not before, in this run. Stage 2
//! of the plan (`docs/generalist-plan.md`).
//!
//! Two counts, kept in small tables keyed by a cell of the world: where its body has been (half a metre
//! along the way, whatever its height, since counting heights paid for bounding up into new ones), and
//! what its rays have met (cells a quarter of a metre square, and what kind of thing was there). Coming into a place it has been n times before is worth 1 / (1 + n) squared; so is
//! seeing a cell, at each decision, that it has seen n times before. So the first time is worth 1 and
//! what has been seen many times is worth almost nothing, and the sum over any cell, however often it
//! comes back to it, is under 1.7: spinning on the spot, stepping to and fro or staring earns a little
//! once and then nothing. What a unit is worth is set in `practice::Shaping` (`place`, `sight`).
//!
//! It also keeps the columns of the world its rays have met, a quarter of a metre wide, for the share of
//! the world it has seen, a measure.

use alloc::vec;
use alloc::vec::Vec;

use crate::math::Vec2;

/// How big a place is, and a cell of what is seen, in metres.
pub const PLACE: f32 = 0.5;
const CELL: f32 = 0.25;

/// A count for each key, in a table that doubles when it is getting full. Keys are never 0.
#[derive(Clone, Debug, PartialEq)]
pub struct Counts {
    keys: Vec<u32>,
    counts: Vec<u16>,
    pub used: usize,
}

impl Counts {
    pub fn new(room: usize) -> Counts {
        let room = room.next_power_of_two().max(16);
        Counts { keys: vec![0; room], counts: vec![0; room], used: 0 }
    }

    fn slot(&self, key: u32) -> usize {
        let mask = self.keys.len() - 1;
        let mut at = (key.wrapping_mul(0x9e37_79b1) >> 7) as usize & mask;
        while self.keys[at] != 0 && self.keys[at] != key {
            at = (at + 1) & mask;
        }
        at
    }

    /// Counts the key once more, and gives how many times it was counted before.
    pub fn bump(&mut self, key: u32) -> u16 {
        if 4 * (self.used + 1) > 3 * self.keys.len() {
            let (keys, counts) = (core::mem::take(&mut self.keys), core::mem::take(&mut self.counts));
            *self = Counts { keys: vec![0; 2 * keys.len()], counts: vec![0; 2 * keys.len()], used: 0 };
            for (key, count) in keys.into_iter().zip(counts).filter(|(key, _)| *key != 0) {
                let at = self.slot(key);
                self.keys[at] = key;
                self.counts[at] = count;
                self.used += 1;
            }
        }
        let at = self.slot(key);
        if self.keys[at] == 0 {
            self.keys[at] = key;
            self.used += 1;
        }
        let before = self.counts[at];
        self.counts[at] = before.saturating_add(1);
        before
    }
}

/// A cell of the world, and what was in it (0 to 7), as a key: never 0.
fn key(at: Vec2, size: f32, kind: u32) -> u32 {
    let (x, y) = ((at.x / size) as i32 - i32::from(at.x < 0.0), (at.y / size) as i32 - i32::from(at.y < 0.0));
    (((x as u32) & 0x7_ffff) << 13 | ((y as u32) & 0x3ff) << 3 | kind) ^ 0x8000_0000
}

/// What is worth having been first.
fn worth(before: u16) -> f32 {
    let n = 1.0 + before as f32;
    1.0 / (n * n)
}

#[derive(Clone, Debug, PartialEq)]
pub struct Curiosity {
    places: Counts,
    seen: Counts,
    columns: Counts,
    last: u32,
    /// What seeing new things at the last look was worth, in units, to be paid with the decision that
    /// led to it (`practice::Worlds`), and what coming into new places was worth since it was last paid.
    pub sight: f32,
    pub place: f32,
    /// How much coming into new places may still be paid now, for a creature asked to go about rather
    /// than race (`practice::Shaping::pace`): it fills at the pace's worth of places a second, and a
    /// place reached quicker than that is worth nothing more, as progress is.
    pub allowance: f32,
    /// The leftmost and rightmost its eye has been, for the share of the world it has seen.
    pub span: (f32, f32),
}

impl Default for Curiosity {
    fn default() -> Curiosity {
        Curiosity { places: Counts::new(256), seen: Counts::new(1024), columns: Counts::new(256), last: 0, sight: 0.0, place: 0.0, allowance: 0.0, span: (f32::MAX, f32::MIN) }
    }
}

impl Curiosity {
    /// After each step: its body at `at`, in metres from the start. Coming into a place is worth
    /// something, more if it is new; staying in one is worth nothing.
    pub fn been(&mut self, at: Vec2) {
        let here = key(Vec2::new(at.x, 0.0), PLACE, 7);
        if here != self.last {
            let before = self.places.bump(here);
            // the place it starts in is where it is, not somewhere it came to
            if self.last != 0 {
                self.place += worth(before);
            }
            self.last = here;
        }
    }

    /// At each look: its eye at `eye` and what each ray met, where, and of what kind (0 for nothing),
    /// in metres from the start.
    pub fn saw(&mut self, eye: Vec2, hits: impl Iterator<Item = (Vec2, u32)>) {
        self.span = (self.span.0.min(eye.x), self.span.1.max(eye.x));
        let mut sight = 0.0;
        for (at, kind) in hits.filter(|&(_, kind)| kind != 0) {
            sight += worth(self.seen.bump(key(at, CELL, kind)));
            self.columns.bump(key(Vec2::new(at.x, 0.0), CELL, 0));
        }
        self.sight = sight;
    }

    /// How many places it has been to, and how many cells of the world it has seen.
    pub fn counts(&self) -> (usize, usize) {
        (self.places.used, self.seen.used)
    }

    /// The share of the world around where it has been that its rays have met: columns a quarter of a
    /// metre wide, from 6 m behind the leftmost its eye has been to 6 m ahead of the rightmost.
    pub fn share_seen(&self) -> f32 {
        if self.span.0 > self.span.1 {
            return 0.0;
        }
        let columns = (self.span.1 - self.span.0 + 12.0) / CELL;
        (self.columns.used as f32 / columns).min(1.0)
    }
}
