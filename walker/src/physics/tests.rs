//! What the physics is held to: things dropped come to rest and stay, stacks stand, a hinge keeps its
//! length, and the same start always gives the same end. Run with `cargo test` in `walker/`.

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

#[test]
fn a_dropped_box_comes_to_rest_on_the_ground_and_stays() {
    let mut world = World::new();
    flat(&mut world);
    world.add_body(Body::new(Shape::Box { half_width: 0.5, half_height: 0.25 }, Vec2::new(0.0, 2.0), 0.3, 1.0));
    run(&mut world, 3.0);
    let resting = world.bodies[0];
    run(&mut world, 5.0);
    let body = world.bodies[0];
    assert!((body.position.y - 0.25).abs() < 0.01, "rests on its long side at 0.25, is at {}", body.position.y);
    assert!(body.angle().abs() < 0.01);
    assert!((body.position - resting.position).length() < 0.001, "moved {} while resting", (body.position - resting.position).length());
    assert!(body.velocity.length() < 0.01 && body.spin.abs() < 0.01);
    assert!(body.touching);
}

#[test]
fn a_ball_and_a_capsule_rest_on_a_slope_with_friction_and_a_ball_bounces() {
    let mut world = World::new();
    world.set_ground(&[Segment { a: Vec2::new(-10.0, 1.0), b: Vec2::new(10.0, -1.0) }]);
    let mut capsule = Body::new(Shape::Capsule { half: 0.3, radius: 0.1 }, Vec2::new(0.0, 0.5), -0.1, 1.0);
    capsule.friction = 0.9;
    world.add_body(capsule);
    let mut ball = Body::new(Shape::Circle { radius: 0.2 }, Vec2::new(5.0, 3.0), 0.0, 1.0);
    ball.restitution = 0.8;
    world.add_body(ball);
    let mut highest_after_bounce = f32::MIN;
    let mut came_down = false;
    for _ in 0..240 {
        world.step();
        let y = world.bodies[1].position.y;
        if world.bodies[1].velocity.y > 0.0 && world.bodies[1].touching {
            came_down = true;
        }
        if came_down {
            highest_after_bounce = highest_after_bounce.max(y);
        }
    }
    let capsule = world.bodies[0];
    assert!(capsule.velocity.length() < 0.01, "the capsule slides at {}", capsule.velocity.length());
    assert!(came_down && highest_after_bounce > 1.5, "the ball bounced to {highest_after_bounce}");
}

#[test]
fn a_stack_of_three_boxes_stands_for_ten_seconds() {
    let mut world = World::new();
    flat(&mut world);
    for level in 0..3 {
        world.add_body(Body::new(Shape::Box { half_width: 0.4, half_height: 0.4 }, Vec2::new(0.0, 0.4 + 0.8 * level as f32 + 0.01 * level as f32), 0.0, 1.0));
    }
    run(&mut world, 10.0);
    for (level, body) in world.bodies.iter().enumerate() {
        let expected = 0.4 + 0.8 * level as f32;
        assert!(body.position.x.abs() < 0.01, "box {level} slid to x {}", body.position.x);
        assert!((body.position.y - expected).abs() < 0.02, "box {level} at {} not {expected}", body.position.y);
        assert!(body.angle().abs() < 0.01, "box {level} leans {}", body.angle());
        assert!(body.velocity.length() < 0.01);
    }
}

#[test]
fn a_pendulum_on_a_hinge_keeps_its_length() {
    let mut world = World::new();
    let anchor = world.add_body(Body::new(Shape::Circle { radius: 0.05 }, Vec2::new(0.0, 3.0), 0.0, 0.0));
    let bob = world.add_body(Body::new(Shape::Circle { radius: 0.2 }, Vec2::new(1.5, 3.0), 0.0, 5.0));
    world.add_joint(Joint::new(&world.bodies, anchor, bob, Vec2::new(0.0, 3.0)));
    let mut lowest = f32::MAX;
    let mut worst: f32 = 0.0;
    for _ in 0..600 {
        world.step();
        let length = (world.bodies[1].position - world.bodies[0].position).length();
        worst = worst.max((length - 1.5).abs());
        lowest = lowest.min(world.bodies[1].position.y);
    }
    assert!(worst < 0.005, "the length strayed by {worst}");
    assert!((lowest - 1.5).abs() < 0.02, "swung down to {lowest}");
}

#[test]
fn a_hinge_holds_its_limits_and_its_motor_turns_it() {
    let mut world = World::new();
    let base = world.add_body(Body::new(Shape::Box { half_width: 0.2, half_height: 0.2 }, Vec2::new(0.0, 3.0), 0.0, 0.0));
    let arm = world.add_body(Body::new(Shape::Capsule { half: 0.5, radius: 0.05 }, Vec2::new(0.5, 3.0), 0.0, 2.0));
    let mut joint = Joint::new(&world.bodies, base, arm, Vec2::new(0.0, 3.0));
    joint.limited = true;
    joint.lower = -0.5;
    joint.upper = 0.5;
    world.add_joint(joint);
    run(&mut world, 3.0);
    let angle = world.joints[0].angle(&world.bodies);
    assert!((angle + 0.5).abs() < 0.02, "hangs at the lower limit, at {angle}");
    world.joints[0].speed = 1.0;
    world.joints[0].torque = 10.0;
    run(&mut world, 3.0);
    let angle = world.joints[0].angle(&world.bodies);
    assert!((angle - 0.5).abs() < 0.02, "the motor lifts it to the upper limit, at {angle}");
}

#[test]
fn the_same_world_stepped_twice_from_the_same_start_ends_identical() {
    let build = || {
        let mut world = World::new();
        world.set_ground(&[Segment { a: Vec2::new(-5.0, 0.0), b: Vec2::new(0.0, 0.3) }, Segment { a: Vec2::new(0.0, 0.3), b: Vec2::new(5.0, -0.2) }]);
        for i in 0..6 {
            let shape = match i % 3 {
                0 => Shape::Circle { radius: 0.2 },
                1 => Shape::Capsule { half: 0.3, radius: 0.1 },
                _ => Shape::Box { half_width: 0.3, half_height: 0.2 },
            };
            world.add_body(Body::new(shape, Vec2::new(-1.0 + 0.37 * i as f32, 1.0 + 0.6 * i as f32), 0.4 * i as f32, 1.0));
        }
        let joint = Joint::new(&world.bodies, 0, 1, Vec2::new(-0.8, 1.3));
        world.add_joint(joint);
        world
    };
    let mut one = build();
    let mut two = build();
    run(&mut one, 6.0);
    run(&mut two, 6.0);
    for (a, b) in one.bodies.iter().zip(&two.bodies) {
        assert_eq!(a.position.x.to_bits(), b.position.x.to_bits());
        assert_eq!(a.position.y.to_bits(), b.position.y.to_bits());
        assert_eq!(a.rotation.cos.to_bits(), b.rotation.cos.to_bits());
        assert_eq!(a.spin.to_bits(), b.spin.to_bits());
    }
}

#[test]
fn a_resting_box_stays_at_rest_when_the_world_is_moved_back_and_its_ground_is_trimmed() {
    let mut world = World::new();
    world.set_ground(&[Segment { a: Vec2::new(600.0, 0.0), b: Vec2::new(650.0, 0.0) }, Segment { a: Vec2::new(650.0, 0.0), b: Vec2::new(760.0, 0.0) }]);
    world.add_body(Body::new(Shape::Box { half_width: 0.5, half_height: 0.25 }, Vec2::new(700.0, 0.4), 0.0, 1.0));
    run(&mut world, 3.0);
    let before = world.bodies[0];
    world.shift(512.0);
    assert_eq!(world.bodies[0].position.x, before.position.x - 512.0, "a power of two near the numbers moves them exactly");
    // the piece behind goes, and the piece it rests on moves to the front of the list
    assert_eq!(world.drop_ground_before(140.0), 1);
    world.extend_ground(&[Segment { a: Vec2::new(248.0, 0.0), b: Vec2::new(300.0, 0.1) }]);
    run(&mut world, 3.0);
    let after = world.bodies[0];
    assert!((after.position.x - (before.position.x - 512.0)).abs() < 1e-3, "slid {}", after.position.x - (before.position.x - 512.0));
    assert!((after.position.y - before.position.y).abs() < 1e-4 && after.velocity.length() < 1e-3);
    assert_eq!(world.ground().len(), 2);
}

#[test]
fn time_that_is_not_a_number_or_less_than_none_is_refused_and_the_world_goes_on() {
    let mut world = World::new();
    flat(&mut world);
    world.add_body(Body::new(Shape::Circle { radius: 0.1 }, Vec2::new(0.0, 2.0), 0.0, 1.0));
    for bad in [f32::NAN, f32::NEG_INFINITY, -1e30, -0.5] {
        assert_eq!(world.advance(bad), 0, "{bad} takes no step");
        assert_eq!(world.advance(STEP), 1, "and after {bad} a step's time still takes a step");
    }
    // a huge or endless time takes the most steps one call allows, and nothing is owed after it
    assert_eq!(world.advance(f32::INFINITY), MOST_STEPS);
    assert_eq!(world.advance(1e30), MOST_STEPS);
    assert_eq!(world.advance(0.0), 0);
    assert_eq!(world.advance(STEP), 1);
    assert!(world.bodies[0].position.y.is_finite());
}

#[test]
fn a_push_that_is_not_a_number_is_ignored_and_the_body_stays_whole() {
    let mut world = World::new();
    flat(&mut world);
    world.add_body(Body::new(Shape::Box { half_width: 0.2, half_height: 0.2 }, Vec2::new(0.0, 0.5), 0.0, 1.0));
    let before = world.bodies[0];
    for (at, impulse) in [(Vec2::new(0.0, 0.5), Vec2::new(f32::NAN, 0.0)), (Vec2::new(0.0, 0.5), Vec2::new(0.0, f32::INFINITY)), (Vec2::new(f32::NAN, 0.5), Vec2::new(1.0, 0.0))] {
        world.bodies[0].push(at, impulse);
        assert_eq!(world.bodies[0].velocity.x.to_bits(), before.velocity.x.to_bits());
        assert_eq!(world.bodies[0].spin.to_bits(), before.spin.to_bits());
    }
    run(&mut world, 0.5);
    assert!(world.bodies[0].position.x.is_finite() && world.bodies[0].position.y.is_finite());
    // a finite push still pushes
    world.bodies[0].push(Vec2::new(0.0, 0.3), Vec2::new(1.0, 0.0));
    assert!(world.bodies[0].velocity.x > 0.5);
}
