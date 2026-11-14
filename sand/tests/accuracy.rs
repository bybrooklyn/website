//! What the engine is held to: the same start gives the same world, nothing appears or vanishes but
//! by the lines of the reactions table, sand piles at its angle, water finds one level in joined
//! vessels, the heavier sinks, a sealed box stays sealed, sleeping chunks hide no work, and nothing
//! drifts to one side. Heat and the reactions themselves are held to their rules in `reactions.rs`.

mod common;

use common::{busy, by_the_lines, counts, fill, picture, run};
use sand::materials::{DIRT, EMPTY, MATERIALS, OIL, SAND, STEAM, STONE, WATER};
use sand::world::{Edges, Order, World};

/// The rows from the top at which each column's highest cell of `of` is, in the columns asked.
fn tops(world: &World, of: u8, columns: impl Iterator<Item = i32>) -> Vec<i32> {
    columns.map(|x| (0..world.height).find(|&y| world.at(x, y) == of).unwrap_or(world.height)).collect()
}

#[test]
fn the_same_seed_and_strokes_give_the_same_world_and_another_seed_does_not() {
    let (mut a, _) = busy(5, 25);
    let (mut b, _) = busy(5, 25);
    run(&mut a, 300);
    run(&mut b, 300);
    assert_eq!(a.cells, b.cells);
    let (mut c, _) = busy(6, 25);
    run(&mut c, 300);
    assert_ne!(a.fingerprint(), c.fingerprint());
}

#[test]
fn every_count_changes_only_as_the_lines_that_happened_say() {
    for seed in [11, 12, 13] {
        let (mut world, _) = busy(seed, 10);
        let (before, fired) = (counts(&world), world.fired.clone());
        for k in 0..30 {
            run(&mut world, 100);
            assert_eq!(counts(&world), by_the_lines(&before, &fired, &world), "seed {seed}, after {} steps", (k + 1) * 100);
        }
        assert!(world.fired.iter().sum::<u64>() > 1000, "the busy world reacts");
    }
    // and while it is still being stirred: only the strokes and the lines change the counts
    let mut world = World::new(160, 120, 2);
    world.paint(STONE, 10, 110, 150, 110, 2, 100, false);
    let pour = [SAND, WATER, DIRT, STEAM, sand::materials::WOOD, OIL, sand::materials::LAVA, sand::materials::ICE, sand::materials::FIRE, sand::materials::ACID, sand::materials::PRIDE];
    for k in 0..60 {
        let material = pour[k % pour.len()];
        world.paint(material, 30 + (k as i32 * 37) % 100, 10, 40 + (k as i32 * 53) % 90, 30, 4, fill(material), false);
        let (poured, fired) = (counts(&world), world.fired.clone());
        run(&mut world, 40);
        assert_eq!(counts(&world), by_the_lines(&poured, &fired, &world), "after stroke {k}");
    }
}

#[test]
fn materials_that_do_not_react_at_room_temperature_are_kept_exactly() {
    let mut world = World::new(160, 120, 2);
    world.paint(STONE, 10, 110, 150, 110, 2, 100, false);
    for k in 0..60 {
        let material = [SAND, WATER, STONE, OIL, sand::materials::PRIDE][k % 5];
        world.paint(material, 30 + (k as i32 * 37) % 100, 10, 40 + (k as i32 * 53) % 90, 30, 4, fill(material), false);
        let poured = counts(&world);
        run(&mut world, 40);
        assert_eq!(counts(&world), poured, "after stroke {k}");
    }
    assert_eq!(world.fired.iter().sum::<u64>(), 0);
}

fn pile(of: u8, seed: u64) -> (f64, World) {
    let mut world = World::new(240, 120, seed);
    for _ in 0..900 {
        world.paint(of, 120, 2, 120, 2, 1, 100, false);
        run(&mut world, 1);
    }
    run(&mut world, 600);
    let heights: Vec<i32> = (0..240).map(|x| (0..120).find(|&y| world.at(x, y) == of).map_or(0, |y| 120 - y)).collect();
    let peak = *heights.iter().max().unwrap();
    let left = heights.iter().position(|&h| h > 0).unwrap() as i32;
    let right = heights.iter().rposition(|&h| h > 0).unwrap() as i32;
    (peak as f64 / ((right - left + 1) as f64 / 2.0), world)
}

#[test]
fn sand_piles_at_about_35_degrees_and_dirt_holds_a_steeper_slope() {
    for seed in [1, 2, 3] {
        let (slope, world) = pile(SAND, seed);
        let angle = slope.atan().to_degrees();
        println!("seed {seed}: sand at {angle:.1} degrees");
        assert!((32.0..=38.0).contains(&angle), "sand at {angle:.1} degrees\n{}", picture(&world, 60, 40, 180, 119));
        let (slope, world) = pile(DIRT, seed);
        let angle = slope.atan().to_degrees();
        println!("seed {seed}: dirt at {angle:.1} degrees");
        assert!((58.0..=65.0).contains(&angle), "dirt at {angle:.1} degrees\n{}", picture(&world, 60, 20, 180, 119));
    }
}

#[test]
fn a_pillar_of_powder_comes_down_to_a_heap_at_its_angle_promptly_and_stays_there() {
    // a pillar 18 wide and 60 tall stood on the floor all at once: 1080 grains. As low as a heap of
    // them at 45 degrees (sand) or at 63 (dirt) is no column over 34 or 48 high.
    for (of, low, angles, within) in [(SAND, 34, 32.0..=38.0, 60), (DIRT, 48, 56.0..=65.0, 60)] {
        for seed in [1, 2, 3] {
            let mut world = World::new(240, 100, seed);
            for y in 40..100 {
                world.paint(of, 111, y, 128, y, 0, 100, false);
            }
            let peak = |w: &World| (0..240).map(|x| (0..100).find(|&y| w.at(x, y) == of).map_or(0, |y| 100 - y)).max().unwrap();
            let mut heap = None;
            let mut still = None;
            for k in 0..1000 {
                world.step();
                if heap.is_none() && peak(&world) <= low {
                    heap = Some(k + 1);
                }
                if world.awake() == 0 {
                    still = Some(k + 1);
                    break;
                }
            }
            let heights: Vec<i32> = (0..240).map(|x| (0..100).find(|&y| world.at(x, y) == of).map_or(0, |y| 100 - y)).collect();
            let left = heights.iter().position(|&h| h > 0).unwrap() as i32;
            let right = heights.iter().rposition(|&h| h > 0).unwrap() as i32;
            let angle = (peak(&world) as f64 / ((right - left + 1) as f64 / 2.0)).atan().to_degrees();
            println!("{} seed {seed}: a heap after {heap:?} steps, still after {still:?}, at {angle:.1} degrees", MATERIALS[of as usize].name);
            assert!(heap.is_some_and(|k| k <= within), "a heap within {within} steps\n{}", picture(&world, 60, 30, 180, 99));
            assert!(still.is_some_and(|k| k <= 400), "and comes to rest");
            assert!(angles.contains(&angle), "at its angle, not flatter: {angle:.1}\n{}", picture(&world, 60, 30, 180, 99));
            assert_eq!(world.count(of), 18 * 60);
            // and once still it stays so: nothing creeps (every cell's material, shade and heat; the
            // clock a cell last moved in is set back to nothing now and then)
            let rested: Vec<u32> = world.cells.iter().map(|c| c & 0x00ff_ffff).collect();
            run(&mut world, 300);
            assert!(world.cells.iter().map(|c| c & 0x00ff_ffff).eq(rested), "it creeps");
        }
    }
}

/// Two vessels of stone joined at the bottom by a pipe, the left one filled with water.
fn joined_vessels(seed: u64) -> World {
    let mut world = World::new(120, 100, seed);
    // floor, the outer walls, and the wall between with a gap at its foot
    world.paint(STONE, 10, 95, 110, 95, 0, 100, false);
    world.paint(STONE, 10, 20, 10, 95, 0, 100, false);
    world.paint(STONE, 110, 20, 110, 95, 0, 100, false);
    world.paint(STONE, 60, 20, 60, 90, 0, 100, false);
    // the left vessel full of water to row 40
    for y in 40..95 {
        world.paint(WATER, 11, y, 59, y, 0, 100, false);
    }
    world
}

#[test]
fn water_in_two_joined_vessels_reaches_one_level_within_250_steps() {
    for seed in [1, 2, 3] {
        let mut world = joined_vessels(seed);
        let water = world.count(WATER);
        // about 190 steps, measured
        run(&mut world, 250);
        let left = tops(&world, WATER, 11..60);
        let right = tops(&world, WATER, 61..110);
        let all: Vec<i32> = left.iter().chain(right.iter()).copied().collect();
        let (high, low) = (*all.iter().min().unwrap(), *all.iter().max().unwrap());
        assert!(low - high <= 1, "levels from row {high} to {low}\n{}", picture(&world, 8, 30, 112, 97));
        assert_eq!(world.count(WATER), water);
        // at rest, and still: it has stopped moving and does not flicker
        run(&mut world, 200);
        let still = world.fingerprint();
        run(&mut world, 50);
        assert_eq!(world.fingerprint(), still, "still moving\n{}", picture(&world, 8, 30, 112, 97));
        assert_eq!(world.awake(), 0);
    }
}

#[test]
fn a_puddle_spreads_flat_and_comes_to_rest() {
    let mut world = World::new(200, 60, 4);
    world.paint(WATER, 100, 20, 100, 20, 12, 100, false);
    run(&mut world, 1500);
    let heights: Vec<i32> = (0..200).map(|x| (0..60).filter(|&y| world.at(x, y) == WATER).count() as i32).collect();
    let (most, least) = (*heights.iter().max().unwrap(), *heights.iter().min().unwrap());
    assert!(most - least <= 1, "{heights:?}");
    assert_eq!(world.awake(), 0);
}

#[test]
fn the_heavier_sinks_through_the_lighter_and_water_rests_on_nothing_lighter() {
    // in a box: oil at the bottom, water over it, sand over that
    let mut world = World::new(80, 80, 9);
    world.paint(STONE, 10, 75, 70, 75, 0, 100, false);
    world.paint(STONE, 10, 10, 10, 75, 0, 100, false);
    world.paint(STONE, 70, 10, 70, 75, 0, 100, false);
    for y in 60..75 {
        world.paint(OIL, 11, y, 69, y, 0, 100, false);
    }
    for y in 45..60 {
        world.paint(WATER, 11, y, 69, y, 0, 100, false);
    }
    for y in 35..45 {
        world.paint(SAND, 11, y, 69, y, 0, 100, false);
    }
    let before = counts(&world);
    run(&mut world, 2000);
    assert_eq!(counts(&world), before);
    let density = |m: u8| MATERIALS[m as usize].density;
    for y in 10..75 {
        for x in 11..70 {
            let (here, under) = (world.at(x, y), world.at(x, y + 1));
            let movable = |m: u8| m == WATER || m == OIL || m == EMPTY;
            if (here == SAND || here == WATER) && movable(under) {
                assert!(density(under) >= density(here), "{here} over {under} at {x},{y}\n{}", picture(&world, 8, 8, 72, 77));
            }
        }
    }
    // sand at the bottom, then water, with the oil floating on it
    assert_eq!(world.at(40, 74), SAND);
    let water_top = (10..75).find(|&y| world.at(40, y) == WATER).unwrap();
    let sand_top = (10..75).find(|&y| world.at(40, y) == SAND).unwrap();
    let oil_top = (10..75).find(|&y| world.at(40, y) == OIL).unwrap();
    assert!(oil_top < water_top && water_top < sand_top);
    assert!((water_top..75).all(|y| world.at(40, y) != OIL), "no oil under the water\n{}", picture(&world, 8, 8, 72, 77));
    // and two liquids side by side come to rest, not trading places for ever
    assert_eq!(world.awake(), 0, "still moving\n{}", picture(&world, 8, 8, 72, 77));
}

#[test]
fn a_sealed_box_of_steam_keeps_it_as_steam_or_water_even_with_walls_that_touch_only_at_corners() {
    let mut world = World::new(100, 100, 3);
    // a diamond of stone one cell thick, its sides touching only at their corners
    world.paint(STONE, 50, 10, 85, 45, 0, 100, false);
    world.paint(STONE, 85, 45, 50, 80, 0, 100, false);
    world.paint(STONE, 50, 80, 15, 45, 0, 100, false);
    world.paint(STONE, 15, 45, 50, 10, 0, 100, false);
    let inside = |x: i32, y: i32| (x - 50).abs() + (y - 45).abs() < 35;
    for y in 30..70 {
        for x in 30..70 {
            if inside(x, y) && world.at(x, y) == EMPTY {
                world.paint(STEAM, x, y, x, y, 0, 70, false);
            }
        }
    }
    // it cools and rains, and nothing of it leaves the box
    let steam = world.count(STEAM);
    assert!(steam > 600);
    run(&mut world, 3000);
    assert_eq!(world.count(STEAM) + world.count(WATER) + world.count(sand::materials::ICE), steam);
    assert!(world.count(WATER) > 0, "the steam has cooled to water");
    for y in 0..100 {
        for x in 0..100 {
            if matches!(world.at(x, y), STEAM | WATER) {
                assert!(inside(x, y), "steam got out at {x},{y}\n{}", picture(&world, 0, 0, 99, 99));
            }
        }
    }
    // and water in a cup with sides of corners does not leak either
    let mut world = World::new(100, 100, 3);
    world.paint(STONE, 15, 45, 50, 80, 0, 100, false);
    world.paint(STONE, 50, 80, 85, 45, 0, 100, false);
    for y in 50..76 {
        world.paint(WATER, 51 - (80 - y), y, 49 + (80 - y), y, 0, 100, false);
    }
    let water = world.count(WATER);
    run(&mut world, 2000);
    assert_eq!(world.count(WATER), water);
    for y in 0..100 {
        for x in 0..100 {
            if world.at(x, y) == WATER {
                assert!((x - 50).abs() < 80 - y, "water got out at {x},{y}\n{}", picture(&world, 0, 30, 99, 99));
            }
        }
    }
}

#[test]
fn steam_rises_gathers_level_under_a_lid_and_rains_back_down_as_it_cools() {
    let mut world = World::new(160, 100, 5);
    world.paint(STONE, 10, 90, 150, 90, 0, 100, false);
    world.paint(STONE, 10, 20, 150, 20, 0, 100, false);
    world.paint(STONE, 10, 20, 10, 90, 0, 100, false);
    world.paint(STONE, 150, 20, 150, 90, 0, 100, false);
    // poured in one heap at the bottom, off to one side, in a world hot enough that it stays steam
    // for a while (about 120 steps to gather, measured, and about 330 before it starts to rain)
    world.paint(STEAM, 40, 75, 40, 75, 12, 100, false);
    common::heat_area(&mut world, 0, 0, 159, 99, 250);
    let steam = world.count(STEAM);
    run(&mut world, 200);
    assert_eq!(world.count(STEAM), steam);
    // gathered at the top, its underside level to a cell
    let depths: Vec<i32> = (11..150).map(|x| (21..90).filter(|&y| world.at(x, y) == STEAM).count() as i32).collect();
    let (most, least) = (*depths.iter().max().unwrap(), *depths.iter().min().unwrap());
    assert!(most - least <= 1, "{depths:?}\n{}", picture(&world, 8, 18, 152, 92));
    assert!((11..150).all(|x| world.at(x, 21) == STEAM));
    // then it cools to water, which lies level on the floor of the box and comes to rest
    run(&mut world, 3000);
    assert_eq!(world.count(STEAM) + world.count(WATER), steam);
    assert_eq!(world.count(STEAM), 0);
    let heights: Vec<i32> = (11..150).map(|x| (21..90).filter(|&y| world.at(x, y) == WATER).count() as i32).collect();
    assert!(heights.iter().max().unwrap() - heights.iter().min().unwrap() <= 1, "{heights:?}");
    assert_eq!(world.awake(), 0);
}

#[test]
fn sleeping_chunks_never_hide_work_in_either_order() {
    for order in [Order::Rows, Order::Phases] {
        for seed in [21, 22] {
            let (mut awake, strokes) = busy(seed, 0);
            let (mut asleep, _) = busy(seed, 0);
            awake.sleeping = false;
            awake.order = order;
            asleep.order = order;
            for k in 0..900 {
                awake.step();
                asleep.step();
                if k % 150 == 75 {
                    // more strokes while it runs, the same into both
                    let (m, x0, y0, x1, y1, r) = strokes[k % strokes.len()];
                    awake.paint(m, x0, y0, x1, y1, r, fill(m), false);
                    asleep.paint(m, x0, y0, x1, y1, r, fill(m), false);
                }
                assert!(awake.cells == asleep.cells, "{order:?}, seed {seed}: apart at step {}", k + 1);
            }
        }
    }
}

#[test]
fn a_symmetric_pour_stays_symmetric_on_average() {
    // sand and water poured in the middle of a box: how far right of the middle the mass ends,
    // over many seeds, is near nothing
    for of in [SAND, WATER] {
        let mut offsets = vec![];
        for seed in 0..40 {
            let mut world = World::new(121, 80, seed);
            for _ in 0..300 {
                world.paint(of, 60, 2, 60, 2, 1, 100, false);
                run(&mut world, 1);
            }
            run(&mut world, 200);
            let (mut sum, mut n) = (0i64, 0i64);
            for y in 0..80 {
                for x in 0..121 {
                    if world.at(x, y) == of {
                        sum += (x - 60) as i64;
                        n += 1;
                    }
                }
            }
            offsets.push(sum as f64 / n as f64);
        }
        let mean = offsets.iter().sum::<f64>() / offsets.len() as f64;
        let spread = (offsets.iter().map(|o| (o - mean).powi(2)).sum::<f64>() / (offsets.len() - 1) as f64).sqrt();
        let error = spread / (offsets.len() as f64).sqrt();
        assert!(mean.abs() < 3.0 * error + 0.05, "material {of}: off by {mean:.3} cells, spread {spread:.3}");
    }
}

#[test]
fn an_open_world_lets_things_fall_out() {
    let mut world = World::new(60, 40, 1);
    world.set_edges(Edges::Open);
    world.paint(SAND, 30, 5, 30, 5, 4, 100, false);
    world.paint(WATER, 10, 5, 10, 5, 3, 100, false);
    world.paint(STEAM, 50, 30, 50, 30, 3, 100, false);
    run(&mut world, 200);
    assert_eq!(world.count(SAND) + world.count(WATER) + world.count(STEAM), 0);
    assert_eq!(world.awake(), 0);
}

#[test]
fn a_settled_world_costs_nothing_until_touched() {
    let mut world = World::new(256, 128, 1);
    for x in (10..250).step_by(30) {
        world.paint(SAND, x, 10, x, 10, 8, 100, false);
    }
    world.paint(WATER, 128, 40, 128, 40, 10, 100, false);
    run(&mut world, 1500);
    assert_eq!(world.awake(), 0, "\n{}", picture(&world, 0, 60, 255, 127));
    world.paint(SAND, 40, 20, 40, 20, 2, 100, false);
    assert!(world.awake() <= 2);
}
