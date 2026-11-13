//! What the physics added for the generalist's world is held to: static blocks are solid on every
//! side, boxes stacked on them stand still, a body that moves by itself carries what rests on it
//! without sliding, bodies can be taken out without disturbing the rest, and blocks left behind can
//! be dropped without changing anything still going on; and where a fast body can pass through a
//! block, a known limit kept as it is. Run with `cargo test` in `walker/`.

use super::shape::Shape;
use super::*;

fn flat(world: &mut World) {
    world.set_ground(&[Segment { a: Vec2::new(-50.0, 0.0), b: Vec2::new(50.0, 0.0) }]);
}

fn run(world: &mut World, seconds: f32) {
    for _ in 0..(seconds * 60.0) as u32 {
        world.step();
    }
}

fn square(half: f32, at: Vec2) -> Body {
    Body::new(Shape::Box { half_width: half, half_height: half }, at, 0.0, 30.0)
}

#[test]
fn a_static_block_holds_up_what_lands_on_it_and_stops_what_hits_its_side_and_underside() {
    let mut world = World::new();
    flat(&mut world);
    world.add_blocks(&[(Vec2::new(-1.0, 1.0), Vec2::new(1.0, 1.25))]);
    // on top
    world.add_body(square(0.15, Vec2::new(0.0, 2.0)));
    // thrown at its side, low enough to hit it
    let mut side = square(0.1, Vec2::new(-3.0, 1.12));
    side.velocity = Vec2::new(6.0, 0.0);
    side.group = 1;
    world.add_body(side);
    // thrown up from under it
    let mut under = Body::new(Shape::Circle { radius: 0.1 }, Vec2::new(0.5, 0.3), 0.0, 1.0);
    under.velocity = Vec2::new(0.0, 6.0);
    world.add_body(under);
    let mut highest_under: f32 = 0.0;
    let mut furthest_side: f32 = -10.0;
    for _ in 0..300 {
        world.step();
        highest_under = highest_under.max(world.bodies[2].position.y + 0.1);
        if world.bodies[1].position.y > 1.0 - 0.1 {
            furthest_side = furthest_side.max(world.bodies[1].position.x + 0.1);
        }
    }
    let top = world.bodies[0];
    assert!((top.position.y - 1.4).abs() < 0.01, "rests on the block's top at 1.4, is at {}", top.position.y);
    assert!(top.velocity.length() < 0.01 && top.touching);
    assert!(highest_under < 1.0 + 0.05, "what was thrown up went to {highest_under}, through the underside at 1.0");
    assert!(furthest_side < -1.0 + 0.02, "what was thrown at the side reached {furthest_side}, past the side at -1.0");
    assert!(world.bodies[2].position.y < 0.2, "and it fell back to the ground");
}

#[test]
fn a_stack_of_boxes_on_a_block_and_on_the_ground_stays_still() {
    let mut world = World::new();
    flat(&mut world);
    world.add_blocks(&[(Vec2::new(2.0, 0.6), Vec2::new(4.0, 0.8))]);
    for k in 0..3 {
        world.add_body(square(0.15, Vec2::new(0.0, 0.16 + 0.31 * k as f32)));
        world.add_body(square(0.15, Vec2::new(3.0, 0.96 + 0.31 * k as f32)));
    }
    run(&mut world, 3.0);
    let settled: Vec<Vec2> = world.bodies.iter().map(|body| body.position).collect();
    run(&mut world, 10.0);
    for (body, before) in world.bodies.iter().zip(&settled) {
        assert!((body.position - *before).length() < 0.001, "a box moved {} while the stack stood: {:?} from {:?}", (body.position - *before).length(), body.position, before);
        assert!(body.angle().abs() < 0.01 && body.velocity.length() < 0.01);
    }
    assert!((world.bodies[5].position.y - (0.8 + 0.15 + 2.0 * 0.3)).abs() < 0.02, "the stack on the block is three boxes high");
}

#[test]
fn a_body_that_moves_by_itself_carries_a_box_on_it_without_sliding() {
    let mut world = World::new();
    flat(&mut world);
    let mut platform = Body::new(Shape::Box { half_width: 0.6, half_height: 0.1 }, Vec2::new(0.0, 1.0), 0.0, 0.0);
    platform.kinematic = true;
    platform.friction = 0.9;
    world.add_body(platform);
    world.add_body(square(0.15, Vec2::new(0.1, 1.26)));
    run(&mut world, 1.0);
    let offset = world.bodies[1].position.x - world.bodies[0].position.x;
    let mut most: f32 = 0.0;
    // to and fro, a metre each way, gently, as a moving platform goes
    for step in 0..600u32 {
        let t = (step + 1) as f32 * STEP;
        let target = 1.0 - crate::math::sin_cos(1.2 * t).1;
        world.bodies[0].velocity = Vec2::new((target - world.bodies[0].position.x) / STEP, 0.0);
        world.step();
        most = most.max((world.bodies[1].position.x - world.bodies[0].position.x - offset).abs());
        assert!((world.bodies[0].position.x - target).abs() < 1e-4, "the platform keeps to its way");
        assert!((world.bodies[0].position.y - 1.0).abs() < 1e-6, "and is not pushed down");
    }
    assert!(most < 0.01, "the box slid {most} m on the platform");
    assert!(world.bodies[1].touching);
}

#[test]
fn a_body_taken_out_leaves_the_rest_going_on_exactly_as_before() {
    // two worlds alike but for a box far away in one; once it is taken out, the two go on the same
    let make = |extra: bool| {
        let mut world = World::new();
        flat(&mut world);
        if extra {
            world.add_body(square(0.2, Vec2::new(-30.0, 0.2)));
        }
        let a = world.add_body(Body::new(Shape::Box { half_width: 0.3, half_height: 0.1 }, Vec2::new(0.0, 2.0), 0.0, 1.0));
        let b = world.add_body(Body::new(Shape::Capsule { half: 0.3, radius: 0.05 }, Vec2::new(0.3, 1.7), -1.0, 1.0));
        let joint = Joint::new(&world.bodies, a, b, Vec2::new(0.3, 2.0));
        world.add_joint(joint);
        world.add_body(square(0.15, Vec2::new(1.5, 0.15)));
        world
    };
    let mut with = make(true);
    let mut without = make(false);
    run(&mut with, 1.0);
    run(&mut without, 1.0);
    with.remove_body(0);
    assert_eq!(with.bodies.len(), without.bodies.len());
    assert_eq!((with.joints[0].a, with.joints[0].b), (0, 1));
    for _ in 0..180 {
        with.step();
        without.step();
    }
    for (one, two) in with.bodies.iter().zip(&without.bodies) {
        assert_eq!((one.position.x.to_bits(), one.position.y.to_bits()), (two.position.x.to_bits(), two.position.y.to_bits()));
    }
}

#[test]
fn blocks_left_behind_are_dropped_without_changing_what_rests_on_the_others() {
    let make = |behind: bool| {
        let mut world = World::new();
        flat(&mut world);
        let mut blocks = alloc::vec![(Vec2::new(0.0, 0.5), Vec2::new(1.0, 0.7))];
        if behind {
            blocks.push((Vec2::new(-20.0, 0.5), Vec2::new(-19.0, 0.7)));
        }
        world.add_blocks(&blocks);
        world.add_body(square(0.15, Vec2::new(0.5, 1.0)));
        world
    };
    let mut with = make(true);
    let mut without = make(false);
    assert_eq!(with.blocks().next().unwrap().0.x, -20.0, "blocks are kept in order");
    run(&mut with, 1.0);
    run(&mut without, 1.0);
    with.drop_ground_before(-10.0);
    assert_eq!(with.blocks().count(), 1);
    for _ in 0..120 {
        with.step();
        without.step();
    }
    assert_eq!(with.bodies[0].position.y.to_bits(), without.bodies[0].position.y.to_bits());
    // and moved back with the rest, it still rests on its block
    with.shift(-512.0);
    run(&mut with, 2.0);
    assert!((with.bodies[0].position.y - 0.85).abs() < 0.01 && with.bodies[0].velocity.length() < 0.01);
    assert_eq!(with.blocks().next().unwrap().0.x, 512.0);
}

/// Of 32 drops of a body at `speed` onto a block `thick` thick with its top at y = 1, or onto the
/// ground at y = 0 if `thick` is 0, each starting a little higher, so that between them they cover
/// every place the body can be at the start of a step: how many end below it.
fn drops_through(shape: Shape, angle: f32, thick: f32, speed: f32) -> usize {
    (0..32)
        .filter(|k| {
            let mut world = World::new();
            let top = if thick > 0.0 { 1.0 } else { 0.0 };
            if thick > 0.0 {
                world.set_ground(&[Segment { a: Vec2::new(-50.0, -20.0), b: Vec2::new(50.0, -20.0) }]);
                world.add_blocks(&[(Vec2::new(-1.0, 1.0 - thick), Vec2::new(1.0, 1.0))]);
            } else {
                world.set_ground(&[Segment { a: Vec2::new(-50.0, 0.0), b: Vec2::new(50.0, 0.0) }]);
            }
            let mut body = Body::new(shape, Vec2::new(0.0, top + 0.8 + *k as f32 / 32.0 * speed * STEP), angle, 1.0);
            body.velocity = Vec2::new(0.0, -speed);
            world.add_body(body);
            run(&mut world, 1.5);
            world.bodies[0].position.y < top - thick.max(DEPTH * 0.5)
        })
        .count()
}

/// A known limit, kept as it is: contacts are found only between surfaces within `AHEAD` of each
/// other at the start of a step, with no sweep, so a body that moves far enough in one step can pass
/// through a block, or even the ground. Changing that would change every result the engine gives, so
/// this test holds the present behaviour, to show where the limit is.
///
/// The generalist's floating platforms, the only blocks either mini makes, are 0.25 m thick. Of the
/// creatures' own parts, at the angles they stand at, the first to go through one does so falling
/// at 16.25 m/s (a two-legged creature's thigh, at the worst place to start a step); through the
/// ground, a metre deep, small parts go from about 40 m/s. The fastest any body of the Walker or the
/// generalist was measured going in real runs was 8.6 m/s, and a creature in those worlds cannot fall
/// far enough to reach 16 m/s (it would take a fall of over 13 m).
#[test]
fn known_limit_a_body_fast_enough_can_pass_through_a_static_block() {
    let little_box = Shape::Box { half_width: 0.1, half_height: 0.1 };
    let thigh = Shape::Capsule { half: 0.21, radius: 0.06 };
    let upright = -core::f32::consts::FRAC_PI_2;
    // a little box onto a block 5 cm thick: held at 5 m/s, through at 10 m/s from some starts
    assert_eq!(drops_through(little_box, 0.0, 0.05, 5.0), 0);
    assert!(drops_through(little_box, 0.0, 0.05, 10.0) > 0);
    // an upright thigh onto a platform as thick as the generalist's: held at the fastest speed seen
    // in real runs and at twice it, through at 30 m/s from some starts
    assert_eq!(drops_through(thigh, upright, 0.25, 8.6), 0);
    assert_eq!(drops_through(thigh, upright, 0.25, 17.2), 0);
    assert!(drops_through(thigh, upright, 0.25, 30.0) > 0);
    // a small ball onto the ground: held at 30 m/s, through at the speed limit from some starts
    let ball = Shape::Circle { radius: 0.05 };
    assert_eq!(drops_through(ball, 0.0, 0.0, 30.0), 0);
    assert!(drops_through(ball, 0.0, 0.0, FASTEST) > 0);
}
