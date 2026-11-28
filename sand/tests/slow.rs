//! Slow motion: a step taken in four parts, what falls moving its share of the way in each.
use sand::materials::{SAND, STONE, WATER};
use sand::world::{World, material};

/// How many calls to `step` a grain dropped from the top takes to land, and the most calls in a row
/// over which it did not move while still in the air.
fn landing(parts: u32, of: u8) -> (usize, usize) {
    let mut world = World::new(64, 300, 3);
    world.paint(STONE, 0, 299, 63, 299, 0, 100, false);
    world.parts_next = parts;
    world.paint(of, 32, 0, 32, 0, 0, 100, false);
    let (mut row, mut held, mut most) = (0, 0, 0);
    for call in 1..4000 {
        world.step();
        let now = (0..300).find(|&y| material(world.get(32, y)) == of).unwrap_or(row);
        if now == 298 {
            return (call, most);
        }
        if now == row { held += 1; most = most.max(held); } else { held = 0; }
        row = now;
    }
    panic!("never landed");
}

#[test]
fn a_slowed_grain_takes_four_times_as_long_and_moves_in_every_part_once_it_is_falling() {
    for of in [SAND, WATER] {
        let (whole, _) = landing(1, of);
        let (slowed, held) = landing(4, of);
        assert!(slowed >= whole * 4 - 4 && slowed <= whole * 4 + 4, "{whole} whole steps, {slowed} parts");
        // standing still at the start until its speed lets it move a cell a part
        assert!(held <= 4, "held for {held} parts at most");
    }
}
