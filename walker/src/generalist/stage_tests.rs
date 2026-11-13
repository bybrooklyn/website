//! What a stage is held to: the world around the creature is laid ahead and dropped behind as it
//! goes, however far, with its things made and taken away and everything moved back past 512 m; a
//! creature riding a moving platform does not slide; a see-saw tips; hazards are found; and the same
//! start steps the same way to the bit.

use alloc::rc::Rc;
use alloc::vec::Vec;

use super::land::{Hazard, Land, MOVER_HALF, Mover, PIVOT, PLANK};
use super::recipe::{Kind, Piece, Recipe};
use super::stage::{REBASE, Stage, Thing};
use crate::body::{Creature, Description};
use crate::math::Vec2;
use crate::physics::shape::Shape;
use crate::physics::{Body, STEP, Segment};

fn everything(seed: u32, difficulty: f32) -> Rc<Land> {
    Rc::new(Land::new(Recipe { seed, difficulty, amounts: [1.0; 4] }, 100.0))
}

#[test]
fn the_world_is_laid_ahead_and_dropped_behind_however_far_the_creature_goes() {
    let mut stage = Stage::new(everything(5, 0.5));
    let mut most_bodies = 0;
    let mut most_ground = 0;
    let mut made = [0usize; 3];
    // a stand-in for the creature, carried along by hand, two metres a step
    let mut along = 0.0f32;
    while along < 1500.0 {
        let x = along - stage.origin;
        let x = x - stage.keep(x);
        for thing in &stage.made {
            let k = match thing.thing {
                Thing::Loose => 0,
                Thing::Mover => 1,
                Thing::Seesaw => 2,
            };
            made[k] = made[k].max(thing.index + 1);
        }
        stage.world.step();
        most_bodies = most_bodies.max(stage.world.bodies.len());
        most_ground = most_ground.max(stage.world.ground().len());
        // nothing kept is far behind, and the ground starts not far behind
        assert!(stage.world.ground()[0].b.x > x - 100.0, "at {along}: the ground starts at {:?}", stage.world.ground()[0]);
        along += 2.0;
    }
    let land = &stage.land;
    assert_eq!(stage.origin, 2.0 * REBASE, "moved back twice by 1500 m");
    assert!(land.reached.x >= 1500.0, "the land was made as far as it was needed");
    assert!(most_bodies < 30, "{most_bodies} bodies at once");
    assert!(most_ground < 250, "{most_ground} pieces of ground at once");
    let behind = |at: f32| land.geometry.loose.iter().filter(|l| l.centre.x < at).count();
    assert!(made[0] >= behind(1500.0 - 20.0), "every box along the way was made");
    assert!(made[1] > 10 && made[2] > 10);
}

/// Holds every body the stage believes it made to being there and of the sort it thinks, and the
/// world to holding nothing else: `before` bodies of the creature's, then each thing's own.
fn check_owned(stage: &Stage, before: usize, world: u32, along: f32) {
    let at = (world, along);
    let geometry = &stage.land.geometry;
    let bodies = &stage.world.bodies;
    let mut alive = before;
    for made in &stage.made {
        let body = made.body as usize;
        assert!(body >= before && body < bodies.len(), "world and metre {at:?}: {made:?} points past the world's {} bodies", bodies.len());
        match made.thing {
            Thing::Loose => {
                let half = geometry.loose[made.index].half;
                assert_eq!(bodies[body].shape, Shape::Box { half_width: half, half_height: half }, "world and metre {at:?}: {made:?} is not its box");
                alive += 1;
            }
            Thing::Mover => {
                assert_eq!(bodies[body].shape, Shape::Box { half_width: MOVER_HALF.x, half_height: MOVER_HALF.y }, "world and metre {at:?}: {made:?} is not a moving platform");
                assert!(bodies[body].kinematic, "world and metre {at:?}: {made:?} is not kinematic");
                alive += 1;
            }
            Thing::Seesaw => {
                let half = geometry.seesaws[made.index].half;
                assert_eq!(bodies[body].shape, Shape::Box { half_width: half, half_height: PLANK }, "world and metre {at:?}: {made:?} is not its plank");
                assert_eq!(bodies.get(body + 1).map(|pivot| pivot.shape), Some(Shape::Circle { radius: PIVOT }), "world and metre {at:?}: {made:?} has no pivot after its plank");
                alive += 2;
            }
        }
    }
    assert_eq!(bodies.len(), alive, "world and metre {at:?}: the world holds bodies the stage does not know of");
    let seesaws = stage.made.iter().filter(|made| made.thing == Thing::Seesaw).count();
    assert_eq!(stage.world.joints.len(), seesaws, "world and metre {at:?}: one hinge for each see-saw and no other");
}

#[test]
fn every_body_the_stage_made_is_there_and_is_what_it_thinks_and_nothing_is_left_behind() {
    let mut seesaws = 0;
    for world in 0..200u32 {
        // the page's own recipe for half the worlds, everything at 1 for the rest, at every difficulty
        let difficulty = (world % 10) as f32 / 9.0;
        let amounts = if world % 2 == 0 { [0.6, 0.4, 0.4, 0.4] } else { [1.0; 4] };
        let mut stage = Stage::new(Rc::new(Land::new(Recipe { seed: world + 1, difficulty, amounts }, 100.0)));
        // a stand-in for the creature: one body made first, as the creature's are
        let creature = stage.world.add_body(Body::new(Shape::Circle { radius: 0.2 }, Vec2::new(0.0, 30.0), 0.0, 0.0)) as usize;
        let mut along = 0.0f32;
        while along < 200.0 {
            let x = along - stage.origin;
            stage.keep(x);
            check_owned(&stage, creature + 1, world, along);
            stage.world.step();
            along += 0.25;
        }
        seesaws += stage.land.geometry.seesaws.iter().filter(|seesaw| seesaw.pivot.x < 180.0).count();
    }
    assert!(seesaws > 200, "the worlds walked hold see-saws to take away ({seesaws})");
}

#[test]
fn a_creature_standing_on_a_moving_platform_rides_it_without_sliding() {
    for legs in [2, 4] {
        let mut stage = Stage::new(Rc::new(Land::from_pieces(&[], 50.0)));
        let world = &mut stage.world;
        // built standing at a height of one metre, then the ground taken away from under it and a
        // moving platform put there instead
        world.set_ground(&[Segment { a: Vec2::new(-2.0, 1.0), b: Vec2::new(2.0, 1.0) }]);
        let creature = Creature::build(world, Description { legs, carry: false, leap: false }).unwrap();
        world.set_ground(&[Segment { a: Vec2::new(-50.0, -5.0), b: Vec2::new(50.0, -5.0) }]);
        let mover = Mover { left: Vec2::new(0.0, 0.9), travel: 3.0, speed: 0.8 };
        let mut platform = Body::new(Shape::Box { half_width: 0.8, half_height: 0.1 }, mover.left, 0.0, 0.0);
        platform.kinematic = true;
        platform.friction = 0.9;
        let index = world.add_body(platform);
        let torso = creature.torso as usize;
        let start = world.bodies[torso].position.x - world.bodies[index as usize].position.x;
        let mut most: f32 = 0.0;
        for step in 0..600u32 {
            let target = mover.left.x + mover.along((step + 1) as f32 * STEP);
            world.bodies[index as usize].velocity = Vec2::new((target - world.bodies[index as usize].position.x) / STEP, 0.0);
            creature.hold(world);
            world.step();
            most = most.max((world.bodies[torso].position.x - world.bodies[index as usize].position.x - start).abs());
        }
        assert!(!creature.fallen(world), "{legs} legs: fell off");
        assert!(most < 0.03, "{legs} legs: slid {most} m on the platform");
    }
}

#[test]
fn a_see_saw_tips_when_its_high_end_is_weighed_down() {
    let land = Rc::new(Land::from_pieces(&[Piece::new(Kind::Flat, 1.0, 0.0, 1.0), Piece::new(Kind::Seesaw, 1.5, 0.4, 5.0)], 30.0));
    let mut stage = Stage::new(land);
    stage.keep(0.0);
    let made = stage.made.iter().find(|made| made.thing == Thing::Seesaw).copied().unwrap();
    let seesaw = stage.land.geometry.seesaws[0];
    for _ in 0..60 {
        stage.keep(0.0);
        stage.world.step();
    }
    let resting = stage.world.bodies[made.body as usize].angle();
    assert!((resting - seesaw.resting()).abs() < 0.03, "rests with its left end down: {resting}");
    // a heavy box dropped on its high right end
    let high = seesaw.pivot + Vec2::new(seesaw.half - 0.2, 0.6);
    stage.world.add_body(Body::new(Shape::Box { half_width: 0.2, half_height: 0.2 }, high, 0.0, 200.0));
    for _ in 0..180 {
        stage.keep(0.0);
        stage.world.step();
    }
    let tipped = stage.world.bodies[made.body as usize].angle();
    assert!(tipped < -0.15, "tipped the other way, to {tipped}");
}

#[test]
fn hazards_are_found_where_they_are_and_nowhere_else() {
    let land = Rc::new(Land::from_pieces(&[Piece::new(Kind::Water, 1.0, 0.0, 3.0), Piece::new(Kind::Spikes, 1.0, 0.0, 3.0)], 30.0));
    let stage = Stage::new(land);
    let water = stage.land.geometry.hazards[0];
    let spikes = stage.land.geometry.hazards[1];
    let small = Vec2::new(0.05, 0.05);
    let middle = |low: Vec2, high: Vec2| (low + high) * 0.5;
    assert_eq!(stage.hazard(middle(water.low, water.high) - small, middle(water.low, water.high) + small), Some(Hazard::Water));
    assert_eq!(stage.hazard(middle(spikes.low, spikes.high) - small, middle(spikes.low, spikes.high) + small), Some(Hazard::Spikes));
    assert_eq!(stage.hazard(Vec2::new(0.0, 0.0), Vec2::new(0.5, 1.0)), None);
    // above the water, clear of it, is not in it
    let over = middle(water.low, water.high) + Vec2::new(0.0, 1.0);
    assert_eq!(stage.hazard(over - small, over + small), None);
}

#[test]
fn the_same_stage_stepped_twice_from_the_same_start_ends_identical_to_the_bit() {
    let run = || {
        let mut stage = Stage::new(everything(9, 0.7));
        let creature = Creature::build(&mut stage.world, Description { legs: 2, carry: false, leap: false }).unwrap();
        let mut copy = stage.clone();
        copy.copy_from(&stage);
        let mut out = Vec::new();
        for step in 0..1200u32 {
            let torso = copy.world.bodies[creature.torso as usize].position.x;
            copy.keep(torso);
            creature.hold(&mut copy.world);
            // a shove forward now and then, so it gets somewhere among the things
            if step % 90 == 0 {
                let at = copy.world.bodies[creature.torso as usize].position;
                copy.world.bodies[creature.torso as usize].push(at, Vec2::new(25.0, 10.0));
            }
            copy.world.step();
            out.extend(copy.world.bodies.iter().map(|body| body.position.x.to_bits()));
        }
        out
    };
    assert_eq!(run(), run());
}
