//! What a cell becomes, by the lines of `REACTIONS`: alone (ice that melts, a flame that dies) or
//! with a neighbor on one of its four sides (lava and water, acid and stone). A cell tries its lines
//! in order when it is visited, before it moves; the first that happens is the one, and a cell that
//! changes does not move in the same step.
//!
//! Sleeping stays exact because every change touches what it changed, and a line that could have
//! happened and by chance did not keeps the cell to be reached again next step. A line depends only
//! on the cell, its four neighbors and the world's counter for chance at that place and step.
//!
//! Every change is counted in `World::fired` by its line, so a test can hold the count of each
//! material to what the lines that happened say it should be.

use crate::materials::{AFLOAT, ALONE, ALWAYS, EMPTY, FIRE, Heat, Kind, LATENT, LINES, OPEN, Props, REACTIONS, SAME, SOLID_GROUND, STEAM, TABLE};
use crate::world::{World, chance, material, temperature, with_state, with_temperature};

/// A number of 0 to 1023 for line `line` from a cell's roll, so each line has a chance of its own.
#[inline(always)]
fn roll_for(roll: u32, line: usize) -> u32 {
    (roll ^ (line as u32).wrapping_mul(0x9e37_79b9)).wrapping_mul(0x85eb_ca6b) >> 22
}

impl World {
    /// What a listener would have heard since the world was made, for the page's sound to follow as
    /// it grows: for `kind` 0 how many times steam was made by two things meeting (lava, a flame or
    /// lightning in water: a hiss), and for any other how many flames were made (a crackle).
    pub fn heard(&self, kind: u32) -> u64 {
        let hiss = |k: usize| REACTIONS[k].b != ALONE && REACTIONS[k].b != EMPTY && (REACTIONS[k].a_becomes == STEAM || REACTIONS[k].b_becomes == STEAM);
        let flame = |k: usize| REACTIONS[k].a_becomes == FIRE || REACTIONS[k].b_becomes == FIRE;
        (0..REACTIONS.len()).filter(|&k| if kind == 0 { hiss(k) } else { flame(k) }).map(|k| self.fired[k]).sum()
    }

    /// Lights the cell at (x, y) as a flame beside it would, at once and not by chance: it becomes
    /// what its line with fire says, at least as hot as that is made. Gives whether it could burn.
    /// For the brush, which lays fire on what is there.
    pub(crate) fn light(&mut self, at: usize, x: i32, y: i32) -> bool {
        let cell = self.cell_at(at);
        let (from, to) = LINES[material(cell) as usize];
        let Some(k) = (from as usize..to as usize).find(|&k| REACTIONS[k].b == FIRE && REACTIONS[k].a_becomes != SAME) else {
            return false;
        };
        let line = &REACTIONS[k];
        self.fired[k] += 1;
        let hot = temperature(cell).max(line.hot).max(crate::materials::MATERIALS[line.a_becomes as usize].made);
        self.cells[at] = with_temperature(with_state((cell & 0xffff_ff00) | line.a_becomes as u32, self.clock, 0), hot);
        self.touch(x, y, x, y);
        self.warmed(x, y, x, y);
        true
    }

    /// Works a cell's shade, if it follows its heat, and its lines. Gives true if the cell changed
    /// into something else, so it does not move this step.
    #[inline]
    pub(crate) fn react(&mut self, at: usize, x: i32, y: i32, cell: u32, p: Props) -> bool {
        let m = material(cell);
        let t = temperature(cell);
        // worked out only when something needs it: most cells visited have no line that can happen
        let mut rolled = None;
        let (seed, steps) = (self.seed ^ 0x7ab1e, self.steps);
        let mut roll = || *rolled.get_or_insert_with(|| chance(seed, steps, at));
        if p.glow != 0 {
            // a flame or lava is brighter the hotter it is; burning wood flickers as well
            let shade = if p.glow == 1 { t as u32 } else { (t as u32 >> 1) + (roll() >> 25) };
            let now = (cell & 0xffff_00ff) | shade.min(255) << 8;
            if now != cell {
                self.cells[at] = now;
                self.touch(x, y, x, y);
            }
        }
        let (start, end) = LINES[m as usize];
        let s = self.stride as isize;
        let sides = [-1, 1, -s, s];
        for (k, line) in REACTIONS.iter().enumerate().take(end as usize).skip(start as usize) {
            if t < line.above || t > line.below || (line.resting && !self.resting(at, cell, p, line.ground)) {
                continue;
            }
            let lucky = line.chance >= ALWAYS || roll_for(roll(), k) < line.chance as u32;
            if line.b == ALONE {
                if lucky {
                    self.change(k, at, x, y, None);
                    return true;
                }
                self.stay(x, y);
                continue;
            }
            // the four sides, from one picked by chance, so no side is favored
            let first = (roll() >> 12) as usize;
            let mut found = None;
            for turn in 0..4 {
                let side = sides[(first + turn) & 3];
                let there = at.wrapping_add_signed(side);
                let n = material(self.cell_at(there));
                if n == line.b || (line.b == OPEN && TABLE[n as usize].airy) {
                    found = Some((there, side));
                    break;
                }
            }
            if let Some((there, side)) = found {
                if lucky {
                    let (bx, by) = match side {
                        -1 => (x - 1, y),
                        1 => (x + 1, y),
                        _ if side < 0 => (x, y - 1),
                        _ => (x, y + 1),
                    };
                    self.change(k, at, x, y, Some((there, bx, by)));
                    return true;
                }
                self.stay(x, y);
            }
        }
        false
    }

    /// Whether a cell is at rest on the `ground` a line asks for (`ANY_GROUND`, `SOLID_GROUND`,
    /// `AFLOAT`): not falling, and over a solid, or over loose ground (a powder, or a liquid at least as
    /// heavy). Lava sinking through water is held up by neither, so it does not harden hanging in it.
    #[inline]
    fn resting(&self, at: usize, cell: u32, p: Props, ground: u8) -> bool {
        let under = TABLE[material(self.cell_at(at + self.stride)) as usize];
        let solid = under.kind == Kind::Solid;
        let afloat = under.kind == Kind::Powder || (under.kind == Kind::Liquid && under.density >= p.density);
        !crate::world::moving(cell) && if ground == SOLID_GROUND { solid } else if ground == AFLOAT { afloat } else { solid || afloat }
    }

    /// Does line `k` to the cell at `at` and, for a line with a neighbor, the neighbor at `there`:
    /// each becomes what the line says, at the temperature its `heat` finds, marked as changed
    /// this step.
    fn change(&mut self, k: usize, at: usize, x: i32, y: i32, there: Option<(usize, i32, i32)>) {
        let line = &REACTIONS[k];
        self.fired[k] += 1;
        let fresh = chance(self.seed ^ 0x5ade, self.steps, at);
        let a = self.cell_at(at);
        let a_to = if line.a_becomes == SAME { material(a) } else { line.a_becomes };
        let latent = |m: u8| LATENT[m as usize] as i32;
        let (ta, tb_and_b) = match there {
            None => (temperature(a) as i32 - (latent(a_to) - latent(material(a))), None),
            Some((there, _, _)) => {
                let b = self.cell_at(there);
                let b_to = if line.b_becomes == SAME { material(b) } else { line.b_becomes };
                let (ta, tb) = match line.heat {
                    Heat::Kept => (temperature(a) as i32 - (latent(a_to) - latent(material(a))), temperature(b) as i32 - (latent(b_to) - latent(material(b)))),
                    Heat::Shared | Heat::Lost(_) => {
                        let lost = if let Heat::Lost(n) = line.heat { n as i32 } else { 0 };
                        // never below nothing: what cannot be lost is not taken
                        let total = (temperature(a) as i32 + temperature(b) as i32 + latent(material(a)) + latent(material(b)) - latent(a_to) - latent(b_to) - lost).max(0);
                        (total >> 1, total - (total >> 1))
                    }
                    Heat::Carried => (temperature(b) as i32 - (latent(a_to) - latent(material(b))), temperature(a) as i32 - (latent(b_to) - latent(material(a)))),
                };
                (ta, Some((tb, b, b_to)))
            }
        };
        // what catches fire is at least this hot: the neighbor if it changes, else the cell
        let neighbor_changes = matches!(tb_and_b, Some((_, b, b_to)) if b_to != material(b));
        let (mut ta, mut tb) = (ta, tb_and_b.map_or(0, |(tb, _, _)| tb));
        if line.hot > 0 {
            if neighbor_changes {
                tb = tb.max(line.hot as i32);
            } else {
                ta = ta.max(line.hot as i32);
            }
        }
        let clock = self.clock;
        let made = |old: u32, to: u8, t: i32, shade: u32| {
            let cell = if to == material(old) { old } else { to as u32 | (shade & 0xff) << 8 };
            with_temperature(with_state(cell, clock, 0), t.clamp(0, 255) as u8)
        };
        self.cells[at] = made(a, a_to, ta, fresh >> 8);
        self.touch(x, y, x, y);
        self.warmed(x, y, x, y);
        if let (Some((there, bx, by)), Some((_, b, b_to))) = (there, tb_and_b) {
            self.cells[there] = made(b, b_to, tb, fresh >> 16);
            self.touch(bx, by, bx, by);
            self.warmed(bx, by, bx, by);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::materials::{ICE, LAVA, MATERIALS, ROCK, STONE, WATER};

    #[test]
    fn each_line_has_a_chance_of_its_own() {
        // two lines rolled from the same cell are not the same number
        let same = (0..1000u32).filter(|&r| roll_for(r.wrapping_mul(2_654_435_761), 3) == roll_for(r.wrapping_mul(2_654_435_761), 4)).count();
        assert!(same < 20, "{same}");
        // and a line's number is even across 0 to 1023
        let low = (0..10_000u32).filter(|&r| roll_for(crate::world::chance(1, 2, r as usize), 0) < 512).count();
        assert!((4800..5200).contains(&low), "{low}");
    }

    #[test]
    fn ice_that_warms_melts_into_cooler_water_and_the_heat_is_kept() {
        let mut world = World::new(8, 8, 1);
        world.paint(ICE, 4, 7, 4, 7, 0, 100, false);
        world.set_temperature(4, 7, 30);
        let before = world.heat_total();
        world.step();
        assert_eq!(world.at(4, 7), WATER);
        // the water is 8 cooler, which it stores as what melting took
        assert_eq!(world.heat_total(), before);
        assert_eq!(world.count(ICE), 0);
    }

    #[test]
    fn lava_beside_water_makes_rock_and_steam_sharing_their_heat() {
        let mut world = World::new(8, 8, 2);
        world.paint(STONE, 0, 7, 7, 7, 0, 100, false);
        let (lava, water) = (world.index(3, 6), world.index(4, 6));
        world.cells[lava] = LAVA as u32 | 250 << 16;
        world.cells[water] = WATER as u32 | 40 << 16;
        let (start, _) = LINES[LAVA as usize];
        let k = (start as usize..REACTIONS.len()).find(|&k| REACTIONS[k].b == WATER).unwrap();
        let before = world.heat_total();
        world.change(k, lava, 3, 6, Some((water, 4, 6)));
        assert_eq!((world.at(3, 6), world.at(4, 6)), (ROCK, STEAM));
        assert_eq!(world.heat_total(), before);
        let (ts, tv) = (world.temperature_at(3, 6) as i32, world.temperature_at(4, 6) as i32);
        assert!((ts - tv).abs() <= 1, "{ts} {tv}");
        assert!(tv > 56, "the steam does not turn straight back to water");
        assert_eq!(world.fired[k], 1);
    }

    #[test]
    fn what_would_be_heard_grows_with_steam_made_by_meeting_and_with_flames_made() {
        let mut world = World::new(60, 40, 4);
        world.paint(STONE, 0, 39, 59, 39, 0, 100, false);
        assert_eq!((world.heard(0), world.heard(1)), (0, 0));
        // lava dropped into water hisses; water boiling by itself, with nothing meeting it, does not
        for y in 30..39 {
            world.paint(WATER, 10, y, 50, y, 0, 100, false);
        }
        world.paint(LAVA, 30, 20, 30, 20, 3, 100, false);
        for _ in 0..120 {
            world.step();
        }
        assert!(world.heard(0) > 5, "{}", world.heard(0));
        assert_eq!(world.heard(1), 0);
        // a flame spreading into the air crackles
        world.paint(crate::materials::FIRE, 30, 5, 30, 5, 2, 100, false);
        for _ in 0..20 {
            world.step();
        }
        assert!(world.heard(1) > 0);
    }

    #[test]
    fn a_line_that_could_happen_and_did_not_keeps_the_cell_awake() {
        // smoke thins by a small chance each step: until it is gone, its chunk never sleeps
        let mut world = World::new(64, 64, 3);
        world.paint(crate::materials::SMOKE, 30, 63, 30, 63, 0, 100, false);
        for _ in 0..40 {
            world.step();
            if world.count(crate::materials::SMOKE) == 0 {
                break;
            }
            assert!(world.awake() > 0);
        }
        let _ = (EMPTY, MATERIALS.len());
    }
}
