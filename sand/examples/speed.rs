//! How long a step takes on a full world of 1024 by 576: a forest fire, falling sand, water
//! levelling, and a settled world with one small pour. Run with `cargo run --release --example speed`, and with
//! `--features scalar` to see what the SIMD that skips empty cells is worth.

use sand::materials::{DIRT, FIRE, SAND, STONE, WATER, WOOD};
use sand::world::World;
use std::time::Instant;

const WIDE: i32 = 1024;
const HIGH: i32 = 576;

/// Steps `n` times, calling `between` before each, and gives the mean and the slowest step in
/// milliseconds.
fn time(world: &mut World, n: usize, mut between: impl FnMut(&mut World)) -> (f64, f64) {
    let (mut total, mut slowest) = (0.0, 0.0f64);
    for _ in 0..n {
        between(world);
        let start = Instant::now();
        world.step();
        let took = start.elapsed().as_secs_f64() * 1000.0;
        total += took;
        slowest = slowest.max(took);
    }
    (total / n as f64, slowest)
}

/// The whole world sprinkled half full of one material.
fn sprinkled(of: u8) -> World {
    let mut world = World::new(WIDE, HIGH, 1);
    for y in 0..HIGH {
        world.paint(of, 0, y, WIDE - 1, y, 0, 50, false);
    }
    world
}

/// A forest over the whole world: a floor of dirt and trees every 9 cells, each a trunk 3 wide and
/// a round crown, their crowns a cell or so apart, as in the forest of `tests/reactions.rs`.
fn forest() -> World {
    let mut world = World::new(WIDE, HIGH, 1);
    world.paint(DIRT, 0, HIGH - 6, WIDE - 1, HIGH - 1, 3, 100, false);
    for (k, x) in (6..WIDE - 4).step_by(9).enumerate() {
        let top = 220 + ((k * 7) % 5) as i32 * 2;
        world.paint(WOOD, x, top, x, HIGH - 8, 1, 100, false);
        world.paint(WOOD, x, top, x, top, 4, 100, false);
    }
    world
}

/// Hills of sand and dirt, stone ledges and a lake, run until nothing moves.
fn settled() -> World {
    let mut world = World::new(WIDE, HIGH, 1);
    for x in (0..WIDE).step_by(64) {
        world.paint(if x % 128 == 0 { SAND } else { DIRT }, x + 32, HIGH - 60, x + 32, HIGH - 60, 40, 100, false);
    }
    world.paint(STONE, 100, 300, 400, 330, 3, 100, false);
    world.paint(STONE, 600, 250, 900, 240, 3, 100, false);
    world.paint(WATER, 700, 150, 800, 150, 30, 100, false);
    let mut steps = 0;
    while world.awake() > 0 && steps < 20_000 {
        world.step();
        steps += 1;
    }
    println!("  (the settled world came to rest after {steps} steps)");
    world
}

fn main() {
    let report = |name: &str, (mean, slowest): (f64, f64)| println!("{name:<48} {mean:7.3} ms a step, slowest {slowest:7.3} ms, {:6.0} steps a second", 1000.0 / mean);

    // a forest across the whole world, lit all along its foot: every tree burning at once
    let mut fire = forest();
    report("a forest fire lit all along, the first 1200 steps", time(&mut fire, 1200, |w| {
        if w.steps < 40 {
            w.paint(FIRE, 0, HIGH - 14, WIDE - 1, HIGH - 14, 2, 30, false);
        }
    }));
    println!("  awake chunks at the end: {} of {}, wood left {}", fire.awake(), (WIDE / 64) * (HIGH / 64), fire.count(WOOD));


    let mut world = sprinkled(SAND);
    report("falling sand, the first 120 steps", time(&mut world, 120, |_| {}));
    let mut world = sprinkled(SAND);
    world.sleeping = false;
    report("  the same with sleeping off", time(&mut world, 120, |_| {}));

    let mut world = sprinkled(WATER);
    report("water falling and levelling, the first 120 steps", time(&mut world, 120, |_| {}));
    report("  then the next 480 steps", time(&mut world, 480, |_| {}));
    let mut world = sprinkled(WATER);
    world.sleeping = false;
    report("  the first 120 with sleeping off", time(&mut world, 120, |_| {}));

    let mut dam = World::new(WIDE, HIGH, 1);
    for y in 100..HIGH {
        dam.paint(WATER, 0, y, WIDE / 2, y, 0, 100, false);
    }
    report("a dam of water let go, the first 300 steps", time(&mut dam, 300, |_| {}));

    let world = settled();
    let mut pour = world_copy(&world);
    report("settled, sand poured in one place", time(&mut pour, 600, |w| w.paint(SAND, 300, 40, 300, 40, 3, 50, false)));
    println!("  awake chunks at the end: {} of {}", pour.awake(), (WIDE / 64) * (HIGH / 64));
    let mut lake = world_copy(&world);
    report("settled, water poured into the lake", time(&mut lake, 600, |w| w.paint(WATER, 750, 100, 750, 100, 3, 50, false)));
    let mut still = world_copy(&world);
    report("settled, nothing touched", time(&mut still, 600, |_| {}));
}

/// The same world again, cell for cell, after the one step in which a new world looks at every
/// cell once.
fn world_copy(world: &World) -> World {
    let mut copy = World::new(world.width, world.height, 1);
    copy.cells.copy_from_slice(&world.cells);
    copy.step();
    copy
}
