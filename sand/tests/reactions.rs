//! Heat and the reactions held to what they should do: lava in water makes a crust of stone and
//! steam, ice in warm water melts and cools it, a sealed box of water boils over lava and holds, oil
//! floats and burns on water, acid eats a pit and is used up, wet dirt holds a steeper slope and
//! dries by lava, fire with nothing to burn goes out, a forest burns across, a candle burns down,
//! heat is kept, and a world that has burnt out and cooled goes to sleep. Each prints what it
//! measured (`cargo test -- --nocapture`).

mod common;

use common::{by_the_lines, counts, heat_area, picture, run};
use sand::materials::{ACID, ASH, DIRT, EMBER, FIRE, ICE, LAVA, OIL, ROOM, SAND, SMOKE, STEAM, STONE, WATER, WET_DIRT, WOOD};
use sand::world::World;

/// A stone basin from x0 to x1, its floor at row `floor`, its walls up to row `top`, two cells thick.
fn basin(world: &mut World, x0: i32, x1: i32, top: i32, floor: i32) {
    world.paint(STONE, x0, floor, x1, floor, 1, 100, false);
    world.paint(STONE, x0, top, x0, floor, 1, 100, false);
    world.paint(STONE, x1, top, x1, floor, 1, 100, false);
}

/// Fills rows y0 to y1 between x0 and x1 with a material, where empty.
fn fill_rows(world: &mut World, of: u8, x0: i32, x1: i32, y0: i32, y1: i32) {
    for y in y0..=y1 {
        world.paint(of, x0, y, x1, y, 0, 100, false);
    }
}

/// The mean temperature of every cell of a material.
fn mean_temperature(world: &World, of: u8) -> f64 {
    let (mut sum, mut n) = (0.0, 0.0);
    for y in 0..world.height {
        for x in 0..world.width {
            if world.at(x, y) == of {
                sum += world.temperature_at(x, y) as f64;
                n += 1.0;
            }
        }
    }
    if n == 0.0 { 0.0 } else { sum / n }
}

#[test]
fn lava_poured_into_water_makes_a_stone_crust_and_steam_and_the_counts_add_up() {
    let mut world = World::new(160, 100, 4);
    basin(&mut world, 10, 150, 50, 95);
    fill_rows(&mut world, WATER, 12, 148, 60, 93);
    let (stone, water) = (world.count(STONE) as i64, world.count(WATER) as i64);
    let mut lava = 0;
    let mut most_steam = 0;
    for _ in 0..60 {
        let before = world.count(LAVA);
        world.paint(LAVA, 80, 52, 80, 52, 3, 60, false);
        lava += (world.count(LAVA) - before) as i64;
        world.step();
        most_steam = most_steam.max(world.count(STEAM));
    }
    let (before, fired) = (counts(&world), world.fired.clone());
    let mut lava_on_water = 0;
    for _ in 0..1500 {
        world.step();
        most_steam = most_steam.max(world.count(STEAM));
        lava_on_water = world.fired.iter().zip(sand::materials::REACTIONS).filter(|(_, line)| line.a == LAVA && line.b == WATER).map(|(n, _)| *n).sum::<u64>();
    }
    let made = world.count(STONE) as i64 - stone;
    println!("lava poured {lava}, stone made {made} ({lava_on_water} by water), lava left {}, steam at most {most_steam}, water {} of {water}", world.count(LAVA), world.count(WATER));
    // every cell of lava is lava or stone; every cell of water is water, steam or ice
    assert_eq!(world.count(LAVA) as i64 + made, lava);
    assert_eq!((world.count(WATER) + world.count(STEAM) + world.count(ICE)) as i64, water);
    assert_eq!(counts(&world), by_the_lines(&before, &fired, &world));
    assert!(made > lava / 3, "a crust of stone forms\n{}", picture(&world, 8, 15, 152, 97));
    assert!(lava_on_water > 0 && most_steam >= 5, "the water boils where the lava meets it");
}

#[test]
fn ice_in_warm_water_melts_and_the_water_cools() {
    let mut world = World::new(120, 80, 5);
    basin(&mut world, 10, 110, 30, 75);
    fill_rows(&mut world, WATER, 12, 108, 40, 73);
    heat_area(&mut world, 12, 40, 108, 73, 70);
    world.paint(ICE, 60, 55, 60, 55, 6, 100, true);
    let ice = world.count(ICE);
    let warm = mean_temperature(&world, WATER);
    let mut melted_at = None;
    for k in 0..2000 {
        world.step();
        if world.count(ICE) == 0 && melted_at.is_none() {
            melted_at = Some(k + 1);
        }
    }
    let cooled = mean_temperature(&world, WATER);
    println!("ice {ice} cells melted after {melted_at:?} steps; water from {warm:.1} to {cooled:.1}");
    assert!(melted_at.is_some_and(|k| k < 1000), "the ice melts\n{}", picture(&world, 8, 28, 112, 77));
    assert!(cooled < warm - 4.0, "the water is cooler for it");
}

#[test]
fn ice_holds_in_still_air_and_melts_near_lava_without_touching_it() {
    let mut world = World::new(140, 80, 6);
    world.paint(STONE, 0, 75, 139, 79, 2, 100, false);
    // two walls of ice, the second three cells from a pool of lava
    fill_rows(&mut world, ICE, 20, 25, 50, 73);
    fill_rows(&mut world, ICE, 80, 85, 50, 73);
    world.paint(STONE, 89, 60, 89, 74, 0, 100, false);
    world.paint(STONE, 130, 60, 130, 74, 0, 100, false);
    fill_rows(&mut world, LAVA, 90, 129, 60, 73);
    let left = |w: &World, x0: i32| (x0..x0 + 6).flat_map(|x| (40..75).map(move |y| (x, y))).filter(|&(x, y)| w.at(x, y) == ICE).count();
    let whole = left(&world, 20);
    let mut near_half = None;
    for k in 0..1500 {
        world.step();
        if near_half.is_none() && left(&world, 80) <= whole / 2 {
            near_half = Some(k + 1);
        }
    }
    // the air around ice in still air cools, and keeps it a long while; most of it is there after
    // ten minutes
    let near_gone = left(&world, 80);
    run(&mut world, 36000 - 1500);
    let cold = left(&world, 20);
    println!("of {whole} cells of ice: beside the lava half melted after {near_half:?} steps and {near_gone} were left after 1500; in still air {cold} after 36000");
    assert!(near_half.is_some_and(|k| k < 1000), "ice near lava melts\n{}", picture(&world, 60, 40, 135, 77));
    assert!(cold > whole * 3 / 4, "ice in still air holds");
}

#[test]
fn a_sealed_stone_box_of_water_heated_from_below_by_lava_boils_and_the_box_holds() {
    let mut world = World::new(120, 120, 7);
    // a basin of lava, and on it a sealed box of stone half full of water
    basin(&mut world, 10, 110, 60, 115);
    fill_rows(&mut world, LAVA, 12, 108, 90, 113);
    for y in [40, 88] {
        world.paint(STONE, 30, y, 90, y, 1, 100, true);
    }
    world.paint(STONE, 30, 40, 30, 88, 1, 100, true);
    world.paint(STONE, 90, 40, 90, 88, 1, 100, true);
    fill_rows(&mut world, WATER, 32, 88, 66, 86);
    let water = world.count(WATER);
    let inside = |x: i32, y: i32| (32..=88).contains(&x) && (42..=86).contains(&y);
    let mut most_steam = 0;
    for _ in 0..3000 {
        world.step();
        most_steam = most_steam.max(world.count(STEAM));
        assert_eq!(world.count(WATER) + world.count(STEAM) + world.count(ICE), water);
    }
    for y in 0..120 {
        for x in 0..120 {
            if matches!(world.at(x, y), WATER | STEAM) {
                assert!(inside(x, y), "out of the box at {x},{y}\n{}", picture(&world, 0, 30, 119, 119));
            }
        }
    }
    println!("water {water}: steam at most {most_steam}, at the end {} steam and {} water", world.count(STEAM), world.count(WATER));
    assert!(most_steam > water / 4, "the water boils\n{}", picture(&world, 0, 30, 119, 119));
}

#[test]
fn oil_floats_on_water_and_burns_on_top_of_it() {
    let mut world = World::new(240, 100, 8);
    basin(&mut world, 20, 220, 60, 95);
    fill_rows(&mut world, WATER, 22, 218, 75, 93);
    // oil poured in falls through the air and floats
    for _ in 0..80 {
        world.paint(OIL, 120, 20, 120, 20, 4, 60, false);
        world.step();
    }
    run(&mut world, 400);
    let oil = world.count(OIL);
    let water_top = |w: &World| (0..100).find(|&y| w.at(120, y) == WATER).unwrap();
    let surface = water_top(&world);
    assert!((0..surface).any(|y| world.at(120, y) == OIL) && (surface..95).all(|y| world.at(120, y) != OIL), "oil floats\n{}", picture(&world, 18, 60, 222, 97));
    // lit at one end
    let water = world.count(WATER);
    let mut burning_over_water = 0;
    for k in 0..900 {
        if k < 20 {
            world.paint(FIRE, 26, surface - 6, 26, surface - 6, 2, 60, false);
        }
        world.step();
        let fires_low = (1..239).flat_map(|x| (1..95).map(move |y| (x, y))).filter(|&(x, y)| world.at(x, y) == FIRE && [(0, -1), (-1, 0), (1, 0)].iter().all(|&(dx, dy)| world.at(x + dx, y + dy) == WATER)).count();
        assert_eq!(fires_low, 0, "nothing burns under the water, step {k}, surface {surface}\n{}", picture(&world, 18, surface - 8, 222, 95));
        if world.count(FIRE) > 0 {
            burning_over_water += 1;
        }
    }
    println!("oil {oil}: {} left after burning; water {} of {water}; fire seen for {burning_over_water} steps", world.count(OIL), world.count(WATER));
    assert!(world.count(OIL) < oil / 20, "the oil burns away\n{}", picture(&world, 18, 60, 222, 97));
    assert!(world.count(WATER) + world.count(STEAM) + world.count(ICE) == water, "the water stays");
    assert!(world.count(WATER) > water * 9 / 10);
}

#[test]
fn acid_poured_on_stone_eats_a_pit_and_is_used_up() {
    let mut world = World::new(160, 100, 9);
    fill_rows(&mut world, STONE, 0, 159, 60, 99);
    let stone = world.count(STONE);
    let mut acid = 0;
    for _ in 0..40 {
        let before = world.count(ACID);
        world.paint(ACID, 80, 10, 80, 10, 3, 60, false);
        acid += world.count(ACID) - before;
        world.step();
    }
    let mut gone_at = None;
    for k in 0..3000 {
        world.step();
        if world.count(ACID) == 0 && gone_at.is_none() {
            gone_at = Some(k + 1);
        }
    }
    let eaten = stone - world.count(STONE);
    let deepest = (0..160).map(|x| (60..100).take_while(|&y| world.at(x, y) != STONE).count()).max().unwrap();
    println!("acid {acid}: ate {eaten} stone, gone after {gone_at:?} steps, the pit {deepest} deep");
    assert_eq!(world.count(ACID), 0, "used up\n{}", picture(&world, 40, 50, 120, 99));
    assert_eq!(eaten, acid, "a cell of stone for a cell of acid");
    assert!(deepest >= 4, "a pit\n{}", picture(&world, 40, 50, 120, 99));
}

/// Pours a material onto a flat floor from one point until a pile stands, and gives the pile's
/// slope in degrees.
fn pile(of: u8, seed: u64) -> f64 {
    let mut world = World::new(240, 120, seed);
    for _ in 0..900 {
        world.paint(of, 120, 2, 120, 2, 1, 100, false);
        world.step();
    }
    run(&mut world, 600);
    let heights: Vec<i32> = (0..240).map(|x| (0..120).find(|&y| world.at(x, y) == of).map_or(0, |y| 120 - y)).collect();
    let peak = *heights.iter().max().unwrap();
    let left = heights.iter().position(|&h| h > 0).unwrap() as i32;
    let right = heights.iter().rposition(|&h| h > 0).unwrap() as i32;
    (peak as f64 / ((right - left + 1) as f64 / 2.0)).atan().to_degrees()
}

#[test]
fn wet_dirt_holds_a_steeper_slope_than_dry_and_dries_beside_lava() {
    for seed in [1, 2] {
        let (dry, wet) = (pile(DIRT, seed), pile(WET_DIRT, seed));
        println!("dirt piles at {dry:.1} degrees, wet dirt at {wet:.1}");
        assert!(wet > dry + 5.0);
    }
    // water poured on dirt soaks in, a cell of water to a cell of dirt
    let mut world = World::new(120, 80, 3);
    world.paint(STONE, 0, 75, 119, 79, 2, 100, false);
    fill_rows(&mut world, DIRT, 20, 100, 60, 73);
    let dirt = world.count(DIRT);
    let mut water = 0;
    for _ in 0..30 {
        let before = world.count(WATER);
        world.paint(WATER, 60, 40, 60, 40, 3, 50, false);
        water += world.count(WATER) - before;
        world.step();
    }
    run(&mut world, 1500);
    let wet = world.count(WET_DIRT);
    println!("water {water} poured on dirt: {wet} wet dirt, {} water left", world.count(WATER));
    assert!(wet > 50, "the dirt soaks up water where it meets it\n{}", picture(&world, 10, 40, 110, 77));
    assert_eq!((wet + world.count(WATER), wet + world.count(DIRT)), (water, dirt));
    // a heap of wet dirt with lava against its foot dries where the lava presses on it
    let mut world = World::new(160, 80, 4);
    world.paint(STONE, 0, 75, 159, 79, 2, 100, false);
    for y in 35..74 {
        let half = y - 35;
        world.paint(WET_DIRT, 60 - half, y, 60 + half, y, 0, 100, false);
    }
    fill_rows(&mut world, LAVA, 61, 150, 55, 73);
    world.paint(STONE, 152, 50, 152, 74, 1, 100, false);
    let wet = world.count(WET_DIRT);
    let (before, fired) = (counts(&world), world.fired.clone());
    let mut steam = 0;
    for _ in 0..2000 {
        world.step();
        steam = steam.max(world.count(STEAM));
    }
    let dried = world.count(DIRT);
    println!("wet dirt {wet}: {dried} dried beside the lava; steam at most {steam}");
    assert!(dried >= 10, "it dries beside the lava\n{}", picture(&world, 0, 30, 159, 77));
    assert_eq!(counts(&world), by_the_lines(&before, &fired, &world));
}

#[test]
fn fire_with_nothing_to_burn_goes_out_within_80_steps() {
    for seed in [1, 2, 3] {
        let mut world = World::new(100, 100, seed);
        world.paint(FIRE, 50, 80, 50, 80, 8, 100, false);
        let mut out_at = None;
        for k in 0..200 {
            world.step();
            if world.count(FIRE) == 0 && out_at.is_none() {
                out_at = Some(k + 1);
            }
        }
        println!("seed {seed}: fire out after {out_at:?} steps");
        assert!(out_at.is_some_and(|k| (20..=80).contains(&k)), "it neither dies at once nor burns on");
    }
}

/// A forest: a floor of dirt and a row of trees, each a trunk and a round crown, their crowns a
/// cell or so apart.
fn forest(seed: u64) -> World {
    let mut world = World::new(240, 135, seed);
    world.paint(DIRT, 0, 130, 239, 134, 3, 100, false);
    for (k, x) in (10..232).step_by(9).enumerate() {
        let top = 88 + ((k * 7) % 5) as i32 * 2;
        world.paint(WOOD, x, top, x, 128, 1, 100, false);
        world.paint(WOOD, x, top, x, top, 4, 100, false);
    }
    world
}

#[test]
fn a_forest_lit_at_one_end_burns_across_and_goes_out() {
    let mut world = forest(7);
    let wood = world.count(WOOD);
    let last = |w: &World| (226..240).flat_map(|x| (80..129).map(move |y| (x, y))).filter(|&(x, y)| w.at(x, y) == WOOD).count();
    let last_before = last(&world);
    let mut early = 0;
    let mut out_at = None;
    for k in 0..15000 {
        if k < 40 {
            world.paint(FIRE, 7, 124, 7, 124, 3, 45, false);
        }
        world.step();
        if k == 600 {
            early = world.count(WOOD);
        }
        if k > 100 && out_at.is_none() && world.count(FIRE) + world.count(EMBER) == 0 {
            out_at = Some(k + 1);
        }
    }
    println!("wood {wood}: {early} after 600 steps, {} at the end; the last tree {} of {last_before}; out after {out_at:?} steps; ash {}", world.count(WOOD), last(&world), world.count(ASH));
    assert!(early > wood * 8 / 10, "it does not all go up at once");
    assert!(last(&world) < last_before / 4, "the fire reaches the far end\n{}", picture(&world, 0, 70, 239, 134));
    assert!(out_at.is_some(), "and goes out");
}

#[test]
fn fire_jumps_a_gap_of_two_cells_by_heat_and_not_one_of_seven() {
    for seed in [1, 2, 3] {
        let mut world = World::new(160, 100, seed);
        world.paint(STONE, 0, 95, 159, 99, 2, 100, false);
        // columns three wide: the second two cells from the first, the third seven from the second (a
        // gap of three is crossed now and then: once in these three seeds, measured)
        for x in [40, 45, 55] {
            world.paint(WOOD, x, 40, x, 93, 1, 100, false);
        }
        let left = |w: &World, x: i32| (x - 1..=x + 1).flat_map(|x| (40..94).map(move |y| (x, y))).filter(|&(x, y)| w.at(x, y) == WOOD).count();
        let whole = left(&world, 55);
        for k in 0..4000 {
            if k < 40 {
                world.paint(FIRE, 37, 91, 37, 91, 1, 45, false);
            }
            world.step();
        }
        println!("seed {seed}: wood left in the three columns {} {} {}", left(&world, 40), left(&world, 45), left(&world, 55));
        assert_eq!(left(&world, 45), 0, "across two cells\n{}", picture(&world, 30, 30, 70, 97));
        assert_eq!(left(&world, 55), whole, "not across seven");
    }
}

#[test]
fn a_candle_lit_at_the_top_burns_down() {
    let mut world = World::new(100, 100, 3);
    world.paint(STONE, 20, 95, 80, 95, 1, 100, false);
    world.paint(WOOD, 50, 50, 50, 93, 1, 100, false);
    let wood = world.count(WOOD);
    let top = |w: &World| (0..100).find(|&y| w.at(50, y) == WOOD || w.at(50, y) == EMBER).unwrap_or(100);
    let mut tops = vec![];
    for k in 0..3000 {
        if k < 40 {
            world.paint(FIRE, 50, 47, 50, 47, 1, 45, false);
        }
        world.step();
        if k % 200 == 199 {
            tops.push(top(&world));
        }
    }
    println!("a candle of {wood}: its top over time {tops:?}");
    // the top comes down steadily, it never comes back up, and it burns for a good while
    assert!(tops.windows(2).all(|w| w[1] >= w[0]));
    assert!(tops[0] < 60 && tops[1] < 70, "it burns slowly: {tops:?}");
    assert_eq!(world.count(WOOD) + world.count(EMBER), 0, "and burns away");
}

#[test]
fn heat_is_kept_exactly_where_nothing_makes_or_takes_it() {
    // a world full to the brim, so no air cools: water, ice, lava, stone and sand, at many temperatures
    let mut world = World::new(90, 60, 11);
    let rows = [STONE, WATER, ICE, SAND, LAVA, WATER, STONE, STONE, WATER, SAND];
    for (k, &of) in rows.iter().enumerate() {
        fill_rows(&mut world, of, 0, 89, k as i32 * 6, k as i32 * 6 + 5);
    }
    let before = world.heat_total();
    for k in 0..2000 {
        world.step();
        assert_eq!(world.heat_total(), before, "after {} steps", k + 1);
    }
    assert!(world.fired.iter().sum::<u64>() > 100, "melting, freezing, boiling and lava in water happened");
}

#[test]
fn heat_never_increases_in_a_closed_box_with_no_source() {
    let mut world = World::new(120, 90, 12);
    basin(&mut world, 5, 115, 10, 85);
    world.paint(STONE, 5, 10, 115, 10, 1, 100, false);
    fill_rows(&mut world, WATER, 7, 60, 60, 83);
    fill_rows(&mut world, LAVA, 70, 113, 70, 83);
    world.paint(ICE, 30, 40, 40, 50, 0, 100, false);
    world.paint(STEAM, 90, 30, 90, 30, 6, 100, false);
    world.paint(SMOKE, 60, 30, 60, 30, 6, 100, false);
    world.paint(SAND, 20, 20, 20, 20, 4, 100, false);
    world.paint(ACID, 100, 20, 100, 20, 3, 100, false);
    let mut last = world.heat_total();
    let first = last;
    for k in 0..3000 {
        world.step();
        let now = world.heat_total();
        assert!(now <= last, "heat rose from {last} to {now} at step {}", k + 1);
        last = now;
    }
    println!("heat from {first} to {last}");
    assert!(last < first, "the air has carried some away");
}

#[test]
fn a_world_that_has_burnt_out_and_cooled_goes_to_sleep() {
    let mut world = World::new(200, 120, 13);
    world.paint(STONE, 0, 115, 199, 119, 2, 100, false);
    world.paint(WOOD, 40, 80, 40, 113, 2, 100, false);
    fill_rows(&mut world, LAVA, 100, 140, 105, 113);
    world.paint(WATER, 170, 100, 170, 100, 6, 100, false);
    world.paint(ICE, 70, 105, 74, 113, 0, 100, false);
    world.paint(FIRE, 40, 76, 40, 76, 2, 100, false);
    let mut asleep_at = None;
    for k in 0..20000 {
        world.step();
        if world.awake() == 0 {
            asleep_at = Some(k + 1);
            break;
        }
    }
    println!("asleep after {asleep_at:?} steps; wood {} lava {} stone {}", world.count(WOOD), world.count(LAVA), world.count(STONE));
    assert!(asleep_at.is_some());
    // and stays so: nothing changes over many more steps
    let still = world.fingerprint();
    run(&mut world, 200);
    assert_eq!(world.fingerprint(), still);
    assert_eq!(ROOM, 40);
}

#[test]
fn sleeping_hides_no_heat_and_no_reaction_in_either_order() {
    // a small forest burning beside lava, ice, water, oil and acid, stepped with sleeping off and on
    let make = || {
        let mut world = forest(31);
        fill_rows(&mut world, LAVA, 150, 200, 120, 128);
        world.paint(ICE, 120, 100, 126, 128, 0, 100, true);
        world.paint(WATER, 60, 40, 60, 40, 6, 100, false);
        world.paint(OIL, 200, 60, 200, 60, 5, 100, false);
        world.paint(ACID, 100, 50, 100, 50, 3, 100, false);
        world
    };
    for order in [sand::world::Order::Rows, sand::world::Order::Phases] {
        let (mut awake, mut asleep) = (make(), make());
        awake.sleeping = false;
        awake.order = order;
        asleep.order = order;
        for k in 0..1500 {
            if k < 40 {
                for w in [&mut awake, &mut asleep] {
                    w.paint(FIRE, 7, 124, 7, 124, 3, 45, false);
                }
            }
            awake.step();
            asleep.step();
            assert!(awake.cells == asleep.cells, "{order:?}: apart at step {}", k + 1);
        }
        assert!(asleep.fired.iter().sum::<u64>() > 1000);
    }
}

