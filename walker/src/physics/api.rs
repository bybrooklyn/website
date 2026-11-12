//! The physics alone, as a module of its own for the page: build a world of bodies, ground and
//! hinges, step it, and read where everything is. It is built only without the `walker` feature
//! (`cargo build --no-default-features`), to measure and use the physics by itself. README.md lists
//! each function.

use alloc::vec::Vec;

use super::shape::Shape;
use super::{Body, Joint, Segment, World};
use crate::Shared;
use crate::math::Vec2;

struct Physics {
    world: World,
    ground: Vec<Segment>,
    /// Six numbers for each body: x, y, angle, kind, and the two sizes.
    drawn: Vec<f32>,
}

static PHYSICS: Shared<Option<Physics>> = Shared::new(None);

fn physics() -> &'static mut Physics {
    PHYSICS.get().get_or_insert_with(|| Physics { world: World::new(), ground: Vec::new(), drawn: Vec::new() })
}

/// Empties the world and sets its gravity, in metres a second squared.
#[unsafe(no_mangle)]
pub extern "C" fn physics_reset(gravity_x: f32, gravity_y: f32) {
    let physics = physics();
    physics.world = World::new();
    physics.world.gravity = Vec2::new(gravity_x, gravity_y);
    physics.ground.clear();
}

/// Adds a body and returns its number. Kind 0 is a circle (a: radius), 1 a capsule (a: half length,
/// b: radius), 2 a box (a: half width, b: half height). A density of zero makes it never move.
#[unsafe(no_mangle)]
pub extern "C" fn physics_body(kind: u32, a: f32, b: f32, x: f32, y: f32, angle: f32, density: f32, friction: f32, restitution: f32, group: u32) -> u32 {
    let mut body = Body::new(Shape::from_kind(kind, a, b), Vec2::new(x, y), angle, density);
    body.friction = friction;
    body.restitution = restitution;
    body.group = group;
    physics().world.add_body(body)
}

/// Adds a straight piece of ground from (x1, y1) to (x2, y2).
#[unsafe(no_mangle)]
pub extern "C" fn physics_segment(x1: f32, y1: f32, x2: f32, y2: f32) {
    let physics = physics();
    physics.ground.push(Segment { a: Vec2::new(x1, y1), b: Vec2::new(x2, y2) });
    physics.world.set_ground(&physics.ground);
}

/// Joins two bodies with a hinge at (x, y) and returns its number. The angle is kept between lower
/// and upper unless lower is greater than upper. The motor starts off.
#[unsafe(no_mangle)]
pub extern "C" fn physics_joint(a: u32, b: u32, x: f32, y: f32, lower: f32, upper: f32) -> u32 {
    let world = &mut physics().world;
    let count = world.bodies.len() as u32;
    if a >= count || b >= count || a == b {
        return u32::MAX;
    }
    let mut joint = Joint::new(&world.bodies, a, b, Vec2::new(x, y));
    joint.limited = lower <= upper;
    joint.lower = lower;
    joint.upper = upper;
    world.add_joint(joint)
}

/// Sets a hinge's motor: the speed it turns at, in radians a second, with at most `torque` newton
/// metres. A torque of zero turns the motor off.
#[unsafe(no_mangle)]
pub extern "C" fn physics_motor(joint: u32, speed: f32, torque: f32) {
    if let Some(joint) = physics().world.joints.get_mut(joint as usize) {
        joint.speed = speed;
        joint.torque = torque;
    }
}

/// The angle of a hinge, in radians from where it started.
#[unsafe(no_mangle)]
pub extern "C" fn physics_joint_angle(joint: u32) -> f32 {
    let world = &physics().world;
    world.joints.get(joint as usize).map_or(0.0, |joint| joint.angle(&world.bodies))
}

/// Gives a body a sudden push at the point (x, y), in newton seconds.
#[unsafe(no_mangle)]
pub extern "C" fn physics_push(body: u32, x: f32, y: f32, impulse_x: f32, impulse_y: f32) {
    if let Some(body) = physics().world.bodies.get_mut(body as usize) {
        body.push(Vec2::new(x, y), Vec2::new(impulse_x, impulse_y));
    }
}

/// Moves the world on by `seconds`, in whole steps of 1/60 s, and returns how many were taken.
#[unsafe(no_mangle)]
pub extern "C" fn physics_step(seconds: f32) -> u32 {
    physics().world.advance(seconds)
}

/// The number of bodies.
#[unsafe(no_mangle)]
pub extern "C" fn physics_body_count() -> u32 {
    physics().world.bodies.len() as u32
}

/// Where every body is, as six f32 for each: x, y, angle, kind, and the two size numbers. The
/// pointer is into the module's memory and is good until the next call.
#[unsafe(no_mangle)]
pub extern "C" fn physics_bodies() -> *const f32 {
    let physics = physics();
    physics.drawn.clear();
    for body in &physics.world.bodies {
        let (a, b) = body.shape.size();
        physics.drawn.extend_from_slice(&[body.position.x, body.position.y, body.angle(), body.shape.kind() as f32, a, b]);
    }
    physics.drawn.as_ptr()
}
