//! What the generalist's world is held to: the same recipe makes the same world to the bit, every
//! world can be crossed by a body of the creature's reach, one that cannot is put right, the switches
//! do what they say, and difficulty means the sizes the table gives.

use alloc::vec::Vec;

use super::check::{self, REACH, Reach};
use super::land::{Geometry, Land};
use super::recipe::{BOXES, GROUND, HAZARDS, Kind, MOVING, Piece, Plan, Recipe, Table};
use crate::math::Vec2;

fn recipe(seed: u32, difficulty: f32) -> Recipe {
    Recipe { seed, difficulty, amounts: [1.0; 4] }
}

/// Every number of a world's geometry, as bits, in order.
fn bits(geometry: &Geometry) -> Vec<u32> {
    let mut out = Vec::new();
    let mut put = |values: &[f32]| out.extend(values.iter().map(|v| v.to_bits()));
    for s in &geometry.ground {
        put(&[s.a.x, s.a.y, s.b.x, s.b.y]);
    }
    for b in &geometry.blocks {
        put(&[b.low.x, b.low.y, b.high.x, b.high.y]);
    }
    for z in &geometry.hazards {
        put(&[z.low.x, z.low.y, z.high.x, z.high.y, z.hazard as u32 as f32]);
    }
    for l in &geometry.loose {
        put(&[l.centre.x, l.centre.y, l.half]);
    }
    for m in &geometry.movers {
        put(&[m.left.x, m.left.y, m.travel, m.speed]);
    }
    for s in &geometry.seesaws {
        put(&[s.pivot.x, s.pivot.y, s.half, s.ground]);
    }
    out
}

#[test]
fn the_same_recipe_makes_the_same_world_to_the_bit_however_far_at_a_time_it_is_made() {
    for seed in [0, 1, 7, 123_456_789, u32::MAX] {
        let whole = Land::new(recipe(seed, 0.6), 300.0);
        let mut bit = Land::new(recipe(seed, 0.6), 10.0);
        for until in (20..=300).step_by(17) {
            bit.extend(until as f32);
        }
        bit.extend(300.0);
        assert_eq!(bits(&whole.geometry), bits(&bit.geometry), "seed {seed}");
        assert_eq!(whole.pieces, bit.pieces);
        assert_ne!(bits(&whole.geometry), bits(&Land::new(recipe(seed.wrapping_add(1), 0.6), 300.0).geometry), "seeds one apart give other worlds");
    }
}

#[test]
fn a_world_given_as_its_pieces_is_the_world_its_recipe_made() {
    let made = Land::new(recipe(42, 0.5), 200.0);
    let numbers: Vec<[f32; 4]> = made.pieces.iter().map(Piece::numbers).collect();
    let pieces: Vec<Piece> = numbers.iter().map(|n| Piece::from_numbers(*n).unwrap()).collect();
    let given = Land::from_pieces(&pieces, made.reached.x);
    assert_eq!(bits(&made.geometry), bits(&given.geometry));
    assert!(Piece::from_numbers([99.0, 1.0, 1.0, 1.0]).is_none());
    assert!(Piece::from_numbers([2.0, f32::NAN, 1.0, 1.0]).is_none());
    assert!(Piece::from_numbers([2.5, 1.0, 1.0, 1.0]).is_none());
}

#[test]
fn every_world_of_thousands_at_every_difficulty_can_be_crossed_by_the_creatures_reach() {
    let mut eased = 0;
    let mut replaced = 0;
    let mut pieces = 0;
    for tenth in 0..=10 {
        let difficulty = tenth as f32 / 10.0;
        for seed in 0..400u32 {
            // all of everything, and a mix of amounts drawn from the seed
            let amounts = if seed % 2 == 0 { [1.0; 4] } else { [0, 1, 2, 3].map(|k| ((seed.wrapping_mul(2_654_435_761) >> (8 * k)) & 0xff) as f32 / 255.0) };
            let land = Land::new(Recipe { seed, difficulty, amounts }, 150.0);
            assert!(check::possible(&land.geometry, -5.0, land.reached.x - 0.3, &REACH), "seed {seed} at {difficulty} cannot be crossed: {:?}", land.pieces);
            eased += land.eased;
            replaced += land.replaced;
            pieces += land.pieces.len();
        }
    }
    std::println!("{pieces} pieces laid, {eased} times one was made easier, {replaced} given up for level ground");
    // the table keeps nearly every piece within reach, so repairs are rare
    assert!((eased as usize) < pieces / 20, "{eased} repairs in {pieces} pieces");
    assert_eq!(replaced, 0);
}

#[test]
fn the_checker_finds_what_cannot_be_crossed_and_the_land_puts_it_right() {
    let reach = REACH;
    for piece in [Piece::new(Kind::Gap, 3.0, 0.0, 2.0), Piece::new(Kind::Ledge, 0.9, 0.0, 2.0), Piece::new(Kind::Water, 2.5, 0.0, 2.0), Piece::new(Kind::Spikes, 2.0, 0.0, 2.0), Piece::new(Kind::Platforms, 2.0, 0.4, 2.0), Piece::new(Kind::BoxLedge, 1.4, 0.2, 2.0), Piece::new(Kind::Gap, 1.2, 0.6, 2.0)] {
        assert!(!check::piece_possible(&piece, &reach), "{piece:?} should not be crossable");
        let land = Land::from_pieces(&[piece], 40.0);
        assert!(land.eased > 0 && land.replaced == 0, "{piece:?} was made easier");
        assert_eq!(land.pieces[0].kind, piece.kind);
        assert!(check::possible(&land.geometry, -5.0, land.reached.x - 0.3, &reach));
    }
    // and what can be crossed is left alone
    for piece in [Piece::new(Kind::Gap, 0.6, 0.0, 2.0), Piece::new(Kind::Ledge, 0.2, 0.0, 2.0), Piece::new(Kind::BoxLedge, 0.38, 0.1, 2.0), Piece::new(Kind::Mover, 4.5, 1.0, 2.0), Piece::new(Kind::Seesaw, 1.5, 0.35, 2.0), Piece::new(Kind::Drop, 1.2, 0.0, 2.0)] {
        assert!(check::piece_possible(&piece, &reach), "{piece:?} should be crossable");
    }
    // a shorter reach finds less crossable
    let short = Reach { step: 0.1, climb: 0.2, leap: 0.8 };
    assert!(!check::piece_possible(&Piece::new(Kind::Gap, 1.0, 0.0, 2.0), &short));
    assert!(!check::piece_possible(&Piece::new(Kind::Ledge, 0.3, 0.0, 2.0), &short));
    // a world with a gap no jump crosses is not possible, and with a moving platform over it, it is
    let mut geometry = Geometry::default();
    let mut at = super::land::build(&Piece::new(Kind::Flat, 5.0, 0.0, 1.0), Vec2::new(-5.0, 0.0), &mut geometry);
    at = super::land::build(&Piece::new(Kind::Gap, 4.0, 0.0, 3.0), at, &mut geometry);
    assert!(!check::possible(&geometry, -4.0, at.x - 0.5, &reach));
    let mut geometry = Geometry::default();
    let mut at = super::land::build(&Piece::new(Kind::Flat, 5.0, 0.0, 1.0), Vec2::new(-5.0, 0.0), &mut geometry);
    at = super::land::build(&Piece::new(Kind::Mover, 4.0, 0.5, 3.0), at, &mut geometry);
    assert!(check::possible(&geometry, -4.0, at.x - 0.5, &reach));
}

#[test]
fn a_switch_at_zero_leaves_its_kind_out_and_all_at_zero_is_level_ground() {
    for (group, kinds) in [(GROUND, &[Kind::Slope, Kind::Gap, Kind::Stairs, Kind::Ledge, Kind::Drop, Kind::Platforms][..]), (HAZARDS, &[Kind::Water, Kind::Spikes][..]), (BOXES, &[Kind::Box, Kind::BoxLedge][..]), (MOVING, &[Kind::Mover, Kind::Seesaw][..])] {
        let mut amounts = [1.0; 4];
        amounts[group] = 0.0;
        let mut alone = [0.0; 4];
        alone[group] = 1.0;
        for seed in 0..50 {
            let without = Land::new(Recipe { seed, difficulty: 0.5, amounts }, 200.0);
            assert!(without.pieces.iter().all(|p| !kinds.contains(&p.kind)));
            let only = Land::new(Recipe { seed, difficulty: 0.5, amounts: alone }, 200.0);
            assert!(only.pieces.iter().all(|p| p.kind == Kind::Flat || kinds.contains(&p.kind)));
            assert!(only.pieces.iter().any(|p| kinds.contains(&p.kind)));
        }
    }
    let level = Land::new(Recipe { seed: 3, difficulty: 1.0, amounts: [0.0; 4] }, 300.0);
    assert!(level.pieces.iter().all(|p| p.kind == Kind::Flat));
    assert!(level.geometry.ground.iter().all(|s| s.a.y == 0.0 && s.b.y == 0.0));
    // and a larger amount means more of its kind
    let count = |amount: f32| (0..100).map(|seed| Land::new(Recipe { seed, difficulty: 0.5, amounts: [amount, 0.0, 0.0, 0.0] }, 200.0).pieces.iter().filter(|p| p.kind != Kind::Flat).count()).sum::<usize>();
    assert!(count(1.0) > count(0.3) && count(0.3) > count(0.05));
}

/// The widest, tallest or deepest of one kind of piece over many worlds at a difficulty, and the
/// average.
fn sizes(difficulty: f32, kind: Kind, size: fn(&Piece) -> f32) -> (f32, f32) {
    let mut most: f32 = 0.0;
    let (mut sum, mut count) = (0.0, 0);
    for seed in 0..300 {
        let mut plan = Plan::new(recipe(seed, difficulty));
        for _ in 0..40 {
            let piece = plan.piece();
            if piece.kind == kind {
                most = most.max(size(&piece));
                sum += size(&piece);
                count += 1;
            }
        }
    }
    (most, sum / count.max(1) as f32)
}

/// A kind of piece, the size of one that the table limits, and the table's limit at a difficulty.
type Check = (Kind, fn(&Piece) -> f32, fn(f32) -> f32);

#[test]
fn difficulty_means_the_sizes_in_the_table() {
    let checks: [Check; 8] = [
        (Kind::Gap, |p| p.a, Table::gap),
        (Kind::Stairs, |p| p.b.abs(), Table::stair),
        (Kind::Ledge, |p| p.a, Table::ledge),
        (Kind::Drop, |p| p.a, Table::drop),
        (Kind::Platforms, |p| p.a, Table::platform_gap),
        (Kind::Water, |p| p.a, Table::water),
        (Kind::Spikes, |p| p.a, Table::spikes),
        (Kind::BoxLedge, |p| p.a, Table::box_ledge),
    ];
    for (kind, size, table) in checks {
        let mut last_mean = 0.0;
        for difficulty in [0.0, 0.25, 0.5, 0.75, 1.0] {
            let (most, mean) = sizes(difficulty, kind, size);
            let hardest = table(difficulty);
            assert!(most <= hardest * 1.0001 && most > hardest * 0.97, "{kind:?} at {difficulty}: the hardest drawn is {most}, the table says {hardest}");
            assert!(mean > hardest * 0.75 && mean < hardest * 0.85, "{kind:?} at {difficulty}: the average is {mean} of {hardest}");
            assert!(mean > last_mean, "{kind:?} gets harder with difficulty");
            last_mean = mean;
        }
    }
    // and things come closer together: more of them in every ten metres, everything switched on
    let per_ten = |d: f32| (0..100).map(|seed| Land::new(recipe(seed, d), 400.0).pieces.iter().filter(|p| p.kind != Kind::Flat).count()).sum::<usize>() as f32 / 100.0 / 40.0;
    let mut last = 0.0;
    for d in [0.0, 0.25, 0.5, 0.75, 1.0] {
        let now = per_ten(d);
        std::println!("difficulty {d}: {now:.2} things in every 10 m");
        assert!(now > last);
        last = now;
    }
    assert!(per_ten(1.0) > 1.4 * per_ten(0.0));
}
