//! What the tests share: stepping a world, counting what is in it, drawing it as text for a failing
//! test to show, the count each material should have by the lines that happened, and a busy world
//! of every material.

#![allow(dead_code)]

use sand::materials::{ACID, ASH, DIRT, EMBER, EMPTY, FIRE, ICE, LAVA, MATERIALS, OIL, REACTIONS, SAND, SMOKE, STEAM, STONE, WATER, WET_DIRT, WOOD, changes};
use sand::world::World;

/// Steps a world `n` times.
pub fn run(world: &mut World, n: usize) {
    for _ in 0..n {
        world.step();
    }
}

/// How many of each material there are.
pub fn counts(world: &World) -> Vec<i64> {
    (0..MATERIALS.len() as u8).map(|m| world.count(m) as i64).collect()
}

/// What the counts should be now, from the counts and the tally of lines at some earlier moment:
/// each line that has happened since uses and makes what it says, and nothing else changes a count.
pub fn by_the_lines(before: &[i64], fired_before: &[u64], world: &World) -> Vec<i64> {
    let mut out = before.to_vec();
    for (k, line) in REACTIONS.iter().enumerate() {
        let times = (world.fired[k] - fired_before[k]) as i64;
        for (m, by) in changes(line) {
            out[m as usize] += by as i64 * times;
        }
    }
    out
}

/// The world as text, a letter a cell, for a failing test to show.
pub fn picture(world: &World, x0: i32, y0: i32, x1: i32, y1: i32) -> String {
    let mut out = String::new();
    for y in y0..=y1 {
        for x in x0..=x1 {
            out.push(match world.at(x, y) {
                EMPTY => '.',
                SAND => 's',
                WATER => '~',
                STONE => '#',
                DIRT => 'd',
                STEAM => '^',
                WOOD => 'w',
                OIL => 'o',
                LAVA => 'L',
                ICE => 'i',
                SMOKE => ':',
                FIRE => 'f',
                ACID => 'a',
                WET_DIRT => 'D',
                EMBER => 'e',
                ASH => ',',
                _ => '?',
            });
        }
        out.push('\n');
    }
    out
}

/// Sets every cell from (x0, y0) to (x1, y1) to temperature `t`.
pub fn heat_area(world: &mut World, x0: i32, y0: i32, x1: i32, y1: i32, t: u8) {
    for y in y0..=y1 {
        for x in x0..=x1 {
            world.set_temperature(x, y, t);
        }
    }
}

/// A stroke of the brush: its material, its two ends and its radius.
pub type Stroke = (u8, i32, i32, i32, i32, i32);

/// How much of a stroke the brush fills: solids are laid solid, the rest poured.
pub fn fill(of: u8) -> u32 {
    if matches!(of, STONE | WOOD | ICE) { 100 } else { 60 }
}

/// A busy world: every material the brush offers poured, laid and erased in strokes chosen from
/// `seed`, into a cup of stone with a diagonal side.
pub fn busy(seed: u64, steps_between: usize) -> (World, Vec<Stroke>) {
    let mut world = World::new(200, 150, seed);
    let mut strokes = vec![];
    let mut state = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    let mut next = |below: i32| {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((state >> 33) % below as u64) as i32
    };
    world.paint(STONE, 20, 140, 180, 140, 1, 100, false);
    world.paint(STONE, 20, 140, 60, 90, 1, 100, false);
    world.paint(STONE, 180, 140, 180, 80, 1, 100, false);
    let all = [SAND, WATER, STONE, DIRT, STEAM, WOOD, OIL, LAVA, ICE, SMOKE, FIRE, ACID, EMPTY];
    for _ in 0..40 {
        let material = all[next(all.len() as i32) as usize];
        let stroke = (material, next(200), next(130), next(200), next(130), next(6));
        strokes.push(stroke);
        world.paint(stroke.0, stroke.1, stroke.2, stroke.3, stroke.4, stroke.5, fill(material), false);
        run(&mut world, steps_between);
    }
    (world, strokes)
}
