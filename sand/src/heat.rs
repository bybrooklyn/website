//! How heat spreads: after the cells have moved, each cell in an awake rectangle takes heat from or
//! gives it to its four neighbors, and each material warms or cools itself as its line in
//! `MATERIALS` says.
//!
//! Across each side between two cells, heat flows from the hotter to the colder: the difference
//! times the slower of the two conductors, over 256. What is left over after the whole units is
//! rounded up by chance in proportion to it, so that a small difference still carries heat on
//! average and a body of water warms all through, not just where it touches. The chance belongs to
//! the side (the world's seed, the step and where the side is), so both cells work out the same
//! flow across the side they share, one gaining exactly what the other loses: heat is kept to the
//! unit. Every cell reads only temperatures from before the pass and its result is written back
//! after all are found, so the order cells are reached in changes nothing.
//!
//! A cell falling through the air passes heat at a quarter of its rate: it meets each cell of air
//! for only a moment, and in a world where a cell of air holds as much heat as a cell of lava, a
//! stream of lava poured from high up would otherwise land cold, as drops that each harden alone.
//!
//! Between two cells that can flow (air, a liquid, a gas, a flame) heat goes up twice as fast as
//! across and down half as fast: hot air and smoke carry heat upward. A cell's four sides together
//! pass at most about half of the difference a step, so nothing overshoots. Two cells within
//! `STILL` of each other pass nothing, which is what lets a world come to rest: a warm world sleeps
//! once every side is within that of even.
//!
//! Sleeping stays exact because a cell with any side that could carry heat this step, whether by
//! chance it did or not, or that changed its own temperature, wakes itself and its neighbors for the
//! next step; a side whose two cells did not change cannot start to carry heat.

use crate::materials::WARMTH;
use crate::world::{BORDER, CHUNK, World, chance, material, temperature};

/// The largest difference across a side that carries no heat.
pub const STILL: i32 = 2;

/// The heat that crosses one side, into a cell at `t` from a neighbor at `n`, at `k` in 256, the
/// part of a unit left over rounded up when `roll` (0 to 255) is below it. The same side seen from
/// the neighbor, with the same roll, gives the same heat the other way.
#[inline(always)]
fn across(t: i32, n: i32, k: i32, roll: u32) -> i32 {
    let d = n - t;
    if d.abs() <= STILL {
        return 0;
    }
    let units = (d.abs() * k + roll as i32) >> 8;
    if d > 0 { units } else { -units }
}

/// How readily heat passes through a cell: its material's `conduct`, or a quarter of it while the
/// cell is falling, since it meets each cell of air it passes only for a moment. Both cells of a
/// side see the same, so heat is still kept.
#[inline(always)]
fn conducts(cell: u32) -> i32 {
    let c = WARMTH[material(cell) as usize].conduct;
    if cell >> 30 != 0 { c >> 2 } else { c }
}

impl World {
    /// Spreads heat for one step through every awake rectangle, and wakes for the next step what
    /// could change.
    pub(crate) fn heat(&mut self) {
        let s = self.stride;
        let b = BORDER as i32;
        let (seed, steps) = (self.seed ^ 0x4ea7, self.steps);
        // a side is known by the cell left of it or above it, and which of the two it is
        let roll = |side: usize| chance(seed, steps, side) >> 24;
        // Rows are worked from the top down and written as they go. Each row's cells as they were
        // are kept first, and the row above's too, so every cell reads only temperatures from
        // before the pass: the row below has not been reached yet.
        let mut rows = core::mem::take(&mut self.rows);
        let (mut above, mut here) = rows.split_at_mut(s);
        // the stretch of the row above that was kept, as places in a row; empty to begin with
        let (mut kept_from, mut kept_to) = (1usize, 0usize);
        for y in 0..self.height {
            let cy = y / CHUNK;
            let (mut lo, mut hi) = (i32::MAX, i32::MIN);
            for cx in 0..self.across {
                let rect = self.chunks[(cy * self.across + cx) as usize].warm_now;
                if rect.has_row(y) {
                    lo = lo.min(rect.x0);
                    hi = hi.max(rect.x1);
                }
            }
            if lo > hi {
                (kept_from, kept_to) = (1, 0);
                continue;
            }
            let start = self.index(0, y) - b as usize;
            let (from, to) = ((lo - 1 + b) as usize, (hi + 1 + b) as usize);
            here[from..=to].copy_from_slice(&self.cells[start + from..=start + to]);
            for cx in 0..self.across {
                let rect = self.chunks[(cy * self.across + cx) as usize].warm_now;
                if !rect.has_row(y) {
                    continue;
                }
                let (mut changed_from, mut changed_to) = (i32::MAX, i32::MIN);
                for x in rect.x0..=rect.x1 {
                    let place = (x + b) as usize;
                    let at = start + place;
                    let cell = here[place];
                    let t = temperature(cell) as i32;
                    let w = WARMTH[material(cell) as usize];
                    let own = if w.warms > 0 && t < w.toward {
                        w.warms.min(w.toward - t)
                    } else if w.warms < 0 && t > w.toward {
                        w.warms.max(w.toward - t)
                    } else {
                        0
                    };
                    let up = if (kept_from..=kept_to).contains(&place) { above[place] } else { self.cells[at - s] };
                    let (left, right, down) = (here[place - 1], here[place + 1], self.cells[at + s]);
                    let (tl, tr, tu, td) = (temperature(left) as i32, temperature(right) as i32, temperature(up) as i32, temperature(down) as i32);
                    let near = |n: i32| (n - t).abs() <= STILL;
                    let mut flow = 0;
                    let mut could = false;
                    if w.conduct != 0 && !(near(tl) && near(tr) && near(tu) && near(td)) {
                        for (tn, n, side) in [(tl, left, (at - 1) * 2), (tr, right, at * 2)] {
                            let c = conducts(cell).min(conducts(n));
                            if c > 0 && !near(tn) {
                                flow += across(t, tn, c, roll(side));
                                could = true;
                            }
                        }
                        // above, this cell is the lower of the two; below, the upper
                        for (tn, n, side, lower_is_here) in [(tu, up, (at - s) * 2 + 1, true), (td, down, at * 2 + 1, false)] {
                            let nw = WARMTH[material(n) as usize];
                            let mut c = conducts(cell).min(conducts(n));
                            if c > 0 && !near(tn) {
                                if w.flows && nw.flows {
                                    let lower_hotter = if lower_is_here { t > tn } else { tn > t };
                                    c = if lower_hotter { (c * 2).min(32) } else { c / 2 };
                                }
                                flow += across(t, tn, c, roll(side));
                                could = true;
                            }
                        }
                    }
                    let next = (t + flow + own).clamp(0, 255);
                    if next != t {
                        self.cells[at] = (cell & 0xff00_ffff) | (next as u32) << 16;
                    }
                    if could || own != 0 {
                        changed_from = changed_from.min(x);
                        changed_to = changed_to.max(x);
                    }
                }
                if changed_from <= changed_to {
                    self.wake(changed_from - 1, y - 1, changed_to + 1, y + 1);
                }
            }
            (kept_from, kept_to) = (from, to);
            core::mem::swap(&mut above, &mut here);
        }
        self.rows = rows;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::materials::{STONE, WATER};

    #[test]
    fn a_side_carries_the_same_heat_seen_from_either_cell() {
        for (t, n, k) in [(40, 250, 10), (250, 40, 10), (13, 10, 32), (10, 13, 32), (0, 255, 32), (100, 93, 32)] {
            for roll in [0, 1, 100, 200, 255] {
                assert_eq!(across(t, n, k, roll), -across(n, t, k, roll));
            }
        }
        // a difference of two moves nothing; of three, a unit now and then
        assert!((0..256).all(|roll| across(40, 42, 32, roll) == 0));
        let moved: i32 = (0..256).map(|roll| across(40, 43, 32, roll)).sum();
        assert_eq!(moved, 96, "on average three eighths of a unit");
    }

    #[test]
    fn heat_spreads_through_stone_and_none_is_made_or_lost() {
        // a world all of stone: air cools itself, stone does not
        let mut world = World::new(40, 30, 1);
        for y in 0..30 {
            world.paint(STONE, 0, y, 39, y, 0, 100, false);
        }
        for y in 13..18 {
            for x in 18..23 {
                world.set_temperature(x, y, 250);
            }
        }
        let before = world.heat_total();
        for _ in 0..300 {
            world.step();
            assert_eq!(world.heat_total(), before);
        }
        assert!(world.temperature_at(20, 15) < 150, "{}", world.temperature_at(20, 15));
        assert!(world.temperature_at(28, 15) > 45, "{}", world.temperature_at(28, 15));
    }

    #[test]
    fn a_warm_world_comes_to_rest() {
        let mut world = World::new(130, 70, 2);
        for y in 40..70 {
            world.paint(WATER, 0, y, 129, y, 0, 100, false);
        }
        for y in 30..40 {
            world.paint(STONE, 60, y, 70, y, 0, 100, false);
        }
        for y in 30..40 {
            for x in 60..=70 {
                world.set_temperature(x, y, 200);
            }
        }
        for _ in 0..20000 {
            world.step();
            if world.awake() == 0 {
                break;
            }
        }
        assert_eq!(world.awake(), 0, "still spreading after 20000 steps");
        let water: Vec<u8> = (0..130).flat_map(|x| (40..70).map(move |y| (x, y))).map(|(x, y)| world.temperature_at(x, y)).collect();
        assert!(water.iter().any(|&t| t > 42), "the water took the stone's heat");
    }

    #[test]
    fn hot_air_carries_heat_up_faster_than_down() {
        let mut world = World::new(21, 41, 3);
        world.set_temperature(10, 20, 250);
        for _ in 0..6 {
            world.step();
        }
        assert!(world.temperature_at(10, 18) > world.temperature_at(10, 22), "{} above, {} below", world.temperature_at(10, 18), world.temperature_at(10, 22));
    }

    #[test]
    fn air_cools_itself_to_room_temperature_and_no_further() {
        let mut world = World::new(10, 10, 4);
        world.set_temperature(5, 5, 90);
        world.set_temperature(2, 2, 10);
        for _ in 0..400 {
            world.step();
        }
        assert!((0..10).all(|x| (0..10).all(|y| world.temperature_at(x, y) <= 42)));
        assert!((0..10).any(|x| (0..10).any(|y| world.temperature_at(x, y) < 40)), "cold air is not warmed by it");
    }
}
