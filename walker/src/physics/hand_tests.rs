//! What the hand (`Hand`) is held to: it lifts what it holds to near where it is, a heavy thing lagging
//! behind a light one; its force never passes its cap; a thing dragged fast into something thin stops
//! there rather than passing through, where the same thing thrown at that speed goes through
//! (`world_tests`, the known limit); what is let go keeps going no faster than it may; and a body taken
//! out from under it, or before it, leaves it holding the right thing or nothing.

use super::shape::Shape;
use super::*;

const STIFF: f32 = 1500.0;
const DAMPED: f32 = 0.7;
const MOST: f32 = 400.0;

fn flat(world: &mut World) {
    world.set_ground(&[Segment { a: Vec2::new(-50.0, 0.0), b: Vec2::new(50.0, 0.0) }]);
}

fn square(half: f32, at: Vec2, density: f32) -> Body {
    Body::new(Shape::Box { half_width: half, half_height: half }, at, 0.0, density)
}

#[test]
fn a_held_box_hangs_just_under_the_hand_by_its_weight_over_the_springs_stiffness() {
    let mut world = World::new();
    flat(&mut world);
    let index = world.add_body(square(0.2, Vec2::new(0.0, 0.2), 30.0));
    let mass = world.bodies[0].mass;
    world.hold(index, Vec2::new(0.0, 0.2), STIFF, DAMPED, MOST, 4.0);
    world.hand.as_mut().unwrap().goal = Vec2::new(0.5, 1.2);
    for _ in 0..180 {
        world.step();
    }
    let box_at = world.bodies[0].position;
    let sag = mass * 10.0 / STIFF;
    assert!((box_at.x - 0.5).abs() < 0.01, "level with the hand, at {box_at:?}");
    assert!((box_at.y - (1.2 - sag)).abs() < 0.01, "hangs {sag} m under it, at {box_at:?}");
    assert!(world.bodies[0].velocity.length() < 0.01, "and still");
}

#[test]
fn a_heavy_box_lags_behind_a_moving_hand_further_than_a_light_one() {
    let lag = |density: f32| {
        let mut world = World::new();
        flat(&mut world);
        world.add_body(square(0.2, Vec2::new(0.0, 1.0), density));
        world.gravity = Vec2::ZERO;
        world.hold(0, Vec2::new(0.0, 1.0), STIFF, DAMPED, MOST, 3.0);
        world.hand.as_mut().unwrap().goal = Vec2::new(10.0, 1.0);
        let mut most: f32 = 0.0;
        for _ in 0..90 {
            world.step();
            let hand = world.hand.unwrap();
            most = most.max(hand.at.x - world.bodies[0].position.x);
        }
        most
    };
    let (light, heavy) = (lag(10.0), lag(250.0));
    assert!(light < 0.05, "a 1.6 kg box keeps within {light} m of the hand");
    assert!(heavy > 2.0 * light && heavy > 0.1, "a 40 kg one lags {heavy} m");
}

#[test]
fn the_hands_force_never_passes_its_cap_and_it_cannot_lift_what_weighs_more() {
    let mut world = World::new();
    flat(&mut world);
    // 75 kg, nearly twice what the cap can hold up
    world.add_body(square(0.5, Vec2::new(0.0, 0.5), 75.0));
    world.hold(0, Vec2::new(0.0, 0.5), STIFF, DAMPED, MOST, 4.0);
    world.hand.as_mut().unwrap().goal = Vec2::new(0.0, 3.0);
    let h = STEP / world.substeps as f32;
    for _ in 0..120 {
        world.step();
        assert!(world.hand.unwrap().force(h).length() <= MOST * 1.0001);
    }
    assert!(world.bodies[0].position.y < 0.52, "it stays on the ground, at {}", world.bodies[0].position.y);
}

/// A little box held by a hand that goes as fast as `speed`, dragged down from 1.8 m to under a block
/// 5 cm thick at 1 m, from a start at each of 32 points in a step: how many times it ends under it.
fn dragged_through(speed: f32) -> usize {
    (0..32)
        .filter(|k| {
            let mut world = World::new();
            world.set_ground(&[Segment { a: Vec2::new(-50.0, -20.0), b: Vec2::new(50.0, -20.0) }]);
            world.add_blocks(&[(Vec2::new(-1.0, 0.95), Vec2::new(1.0, 1.0))]);
            let at = Vec2::new(0.0, 1.8 + *k as f32 / 32.0 * speed * STEP);
            world.add_body(Body::new(Shape::Box { half_width: 0.1, half_height: 0.1 }, at, 0.0, 30.0));
            world.hold(0, at, STIFF, DAMPED, MOST, speed);
            world.hand.as_mut().unwrap().goal = Vec2::new(0.0, -3.0);
            for _ in 0..90 {
                world.step();
            }
            world.bodies[0].position.y < 0.95
        })
        .count()
}

#[test]
fn a_box_dragged_fast_onto_a_thin_block_stops_on_it_where_one_thrown_as_fast_goes_through() {
    // the same box thrown at 10 m/s goes through from some starts (world_tests, the known limit)
    for speed in [4.0, 10.0, 20.0] {
        assert_eq!(dragged_through(speed), 0, "dragged at {speed} m/s");
    }
}

#[test]
fn what_is_let_go_keeps_going_no_faster_than_it_may_and_its_group_with_it() {
    let mut world = World::new();
    world.gravity = Vec2::ZERO;
    let mut one = square(0.1, Vec2::new(0.0, 1.0), 30.0);
    let mut two = square(0.1, Vec2::new(0.5, 1.0), 30.0);
    let other = square(0.1, Vec2::new(3.0, 1.0), 30.0);
    (one.group, two.group) = (4, 4);
    (one.velocity, two.velocity) = (Vec2::new(8.0, 0.0), Vec2::new(6.0, 0.0));
    world.add_body(one);
    world.add_body(two);
    let mut other = other;
    other.velocity = Vec2::new(9.0, 0.0);
    world.add_body(other);
    world.hold(0, Vec2::new(0.0, 1.0), STIFF, DAMPED, MOST, 4.0);
    assert!(world.let_go(2.0).is_some());
    assert!((world.bodies[0].velocity.x - 2.0).abs() < 1e-5);
    assert!((world.bodies[1].velocity.x - 1.5).abs() < 1e-5, "its group slowed by the same share");
    assert_eq!(world.bodies[2].velocity.x, 9.0, "and nothing else");
    assert!(world.hand.is_none() && world.let_go(2.0).is_none());
}

#[test]
fn a_body_taken_out_leaves_the_hand_holding_the_right_thing_or_nothing() {
    let mut world = World::new();
    flat(&mut world);
    for k in 0..3 {
        world.add_body(square(0.1, Vec2::new(k as f32, 0.1), 30.0));
    }
    world.hold(2, Vec2::new(2.0, 0.1), STIFF, DAMPED, MOST, 4.0);
    world.remove_body(0);
    assert_eq!(world.hand.unwrap().body, 1, "the box it held is now the second");
    world.remove_body(1);
    assert!(world.hand.is_none(), "and with it gone, it holds nothing");
    // a body that never moves cannot be held
    world.add_body(square(0.1, Vec2::new(5.0, 0.1), 0.0));
    world.hold(1, Vec2::new(5.0, 0.1), STIFF, DAMPED, MOST, 4.0);
    assert!(world.hand.is_none());
}
