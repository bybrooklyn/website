//! Keeping touching things from going into each other, and the friction between them. Each point of
//! contact pushes the two bodies apart along the contact's direction, never pulls, and rubs them
//! along it no harder than friction allows. The push is soft, a stiff damped spring rather than a
//! wall, which is what lets a stack or a standing figure settle instead of buzzing.

use super::collide::Manifold;
use super::{Body, Soft};
use crate::math::{Vec2, clamp};

/// The fastest a body is pushed out of an overlap, in metres a second, so deep overlaps undo gently.
const PUSH_SPEED: f32 = 3.0;
/// Below this closing speed, in metres a second, nothing bounces, so resting things stay at rest.
const BOUNCE_SPEED: f32 = 1.0;

/// Marks the second body of a contact with the ground, which does not move.
pub const GROUND: u32 = u32::MAX;
/// Marks a contact with the ground whose `segment` is the number of a static block, not a piece.
pub const BLOCK: u32 = 0x4000_0000;

#[derive(Clone, Copy, Debug, Default)]
pub struct Point {
    /// Where the point is from each body's middle, in the world's directions, when it was found.
    pub from_a: Vec2,
    pub from_b: Vec2,
    /// The same, in each body's own frame, to follow the point as the bodies turn.
    pub local_a: Vec2,
    pub local_b: Vec2,
    pub separation: f32,
    pub normal_impulse: f32,
    pub tangent_impulse: f32,
    pub most_impulse: f32,
    pub normal_mass: f32,
    pub tangent_mass: f32,
    /// The closing speed when the point was found, for bouncing.
    pub closing: f32,
    pub id: u32,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Contact {
    pub a: u32,
    /// A body, or GROUND, with `segment` saying which piece.
    pub b: u32,
    pub segment: u32,
    pub normal: Vec2,
    pub friction: f32,
    pub restitution: f32,
    pub points: [Point; 2],
    pub count: usize,
}

impl Contact {
    /// What identifies the pair from one step to the next.
    pub fn key(&self) -> u64 {
        ((self.a as u64) << 32) | if self.b == GROUND { 0x8000_0000 | self.segment as u64 } else { self.b as u64 }
    }
}

/// What the solver needs of one side of a contact or joint: how fast it moves, and how easily.
#[derive(Clone, Copy)]
pub(crate) struct Motion {
    pub velocity: Vec2,
    pub spin: f32,
    pub inverse_mass: f32,
    pub inverse_inertia: f32,
}

pub(crate) fn motion(bodies: &[Body], index: u32) -> Motion {
    match bodies.get(index as usize) {
        Some(body) => Motion { velocity: body.velocity, spin: body.spin, inverse_mass: body.inverse_mass, inverse_inertia: body.inverse_inertia },
        None => Motion { velocity: Vec2::ZERO, spin: 0.0, inverse_mass: 0.0, inverse_inertia: 0.0 },
    }
}

pub(crate) fn keep(bodies: &mut [Body], index: u32, motion: Motion) {
    if let Some(body) = bodies.get_mut(index as usize) {
        if body.inverse_mass > 0.0 {
            body.velocity = motion.velocity;
            body.spin = motion.spin;
        }
    }
}

/// Fills in a new contact from where two bodies touch.
pub fn begin(bodies: &[Body], a: u32, b: u32, segment: u32, manifold: &Manifold) -> Contact {
    let body_a = &bodies[a as usize];
    let (position_b, rotation_b, friction_b, restitution_b) = match bodies.get(b as usize) {
        Some(body) => (body.position, body.rotation, body.friction, body.restitution),
        None => (Vec2::ZERO, crate::math::Rotation::NONE, body_a.friction, 0.0),
    };
    let mut contact = Contact {
        a,
        b,
        segment,
        normal: manifold.normal,
        // the rougher and bouncier of the two surfaces would let a single sticky body grip anything,
        // so friction is their geometric mean and bounce the larger, as most engines do
        friction: crate::math::sqrt(body_a.friction * friction_b),
        restitution: body_a.restitution.max(restitution_b),
        count: manifold.count,
        ..Default::default()
    };
    for i in 0..manifold.count {
        let touch = manifold.points[i];
        let from_a = touch.point - body_a.position;
        let from_b = touch.point - position_b;
        contact.points[i] = Point {
            from_a,
            from_b,
            local_a: body_a.rotation.undo(from_a),
            local_b: rotation_b.undo(from_b),
            separation: touch.separation,
            id: touch.id,
            ..Default::default()
        };
    }
    contact
}

/// Works out the masses each point pushes against, once a step.
pub fn prepare(bodies: &[Body], contact: &mut Contact) {
    let one = motion(bodies, contact.a);
    let two = motion(bodies, contact.b);
    let normal = contact.normal;
    let tangent = normal.right();
    let base = one.inverse_mass + two.inverse_mass;
    for point in &mut contact.points[..contact.count] {
        let (ra, rb) = (point.from_a, point.from_b);
        let rna = ra.cross(normal);
        let rnb = rb.cross(normal);
        let k = base + one.inverse_inertia * rna * rna + two.inverse_inertia * rnb * rnb;
        point.normal_mass = if k > 0.0 { 1.0 / k } else { 0.0 };
        let rta = ra.cross(tangent);
        let rtb = rb.cross(tangent);
        let k = base + one.inverse_inertia * rta * rta + two.inverse_inertia * rtb * rtb;
        point.tangent_mass = if k > 0.0 { 1.0 / k } else { 0.0 };
        let closing = (two.velocity + rb.spun(two.spin)) - (one.velocity + ra.spun(one.spin));
        point.closing = normal.dot(closing);
    }
}

fn apply(one: &mut Motion, two: &mut Motion, ra: Vec2, rb: Vec2, impulse: Vec2) {
    one.velocity -= impulse * one.inverse_mass;
    one.spin -= one.inverse_inertia * ra.cross(impulse);
    two.velocity += impulse * two.inverse_mass;
    two.spin += two.inverse_inertia * rb.cross(impulse);
}

/// Applies last time's pushes again at the start of a substep, so the solver starts near the answer.
pub fn warm_start(bodies: &mut [Body], contact: &Contact) {
    let mut one = motion(bodies, contact.a);
    let mut two = motion(bodies, contact.b);
    let tangent = contact.normal.right();
    for point in &contact.points[..contact.count] {
        let impulse = contact.normal * point.normal_impulse + tangent * point.tangent_impulse;
        apply(&mut one, &mut two, point.from_a, point.from_b, impulse);
    }
    keep(bodies, contact.a, one);
    keep(bodies, contact.b, two);
}

/// One pass over a contact. With `push` the points also close what overlap there is; without it, the
/// pass only takes out the speed that pushing added, so nothing flies apart.
pub fn solve(bodies: &mut [Body], contact: &mut Contact, soft: Soft, inverse_h: f32, push: bool) {
    let mut one = motion(bodies, contact.a);
    let mut two = motion(bodies, contact.b);
    let (position_a, rotation_a) = (bodies[contact.a as usize].position, bodies[contact.a as usize].rotation);
    let (position_b, rotation_b) = match bodies.get(contact.b as usize) {
        Some(body) => (body.position, body.rotation),
        None => (Vec2::ZERO, crate::math::Rotation::NONE),
    };
    let normal = contact.normal;
    for point in &mut contact.points[..contact.count] {
        let (ra, rb) = (point.from_a, point.from_b);
        // how far apart the surfaces are now, followed from where they were as the bodies move
        let at_a = position_a + rotation_a.apply(point.local_a);
        let at_b = position_b + rotation_b.apply(point.local_b);
        let separation = normal.dot(at_b - at_a) + point.separation;
        let (bias, mass_scale, impulse_scale) = if separation > 0.0 {
            // apart still: allow just the speed that closes the gap within this substep
            (separation * inverse_h, 1.0, 0.0)
        } else if push {
            ((soft.bias_rate * separation).max(-PUSH_SPEED), soft.mass_scale, soft.impulse_scale)
        } else {
            (0.0, 1.0, 0.0)
        };
        let closing = normal.dot((two.velocity + rb.spun(two.spin)) - (one.velocity + ra.spun(one.spin)));
        let impulse = -point.normal_mass * mass_scale * (closing + bias) - impulse_scale * point.normal_impulse;
        let total = (point.normal_impulse + impulse).max(0.0);
        let impulse = total - point.normal_impulse;
        point.normal_impulse = total;
        point.most_impulse = point.most_impulse.max(total);
        apply(&mut one, &mut two, ra, rb, normal * impulse);
    }
    let tangent = normal.right();
    for point in &mut contact.points[..contact.count] {
        let (ra, rb) = (point.from_a, point.from_b);
        let sliding = tangent.dot((two.velocity + rb.spun(two.spin)) - (one.velocity + ra.spun(one.spin)));
        let limit = contact.friction * point.normal_impulse;
        let total = clamp(point.tangent_impulse - point.tangent_mass * sliding, -limit, limit);
        let impulse = total - point.tangent_impulse;
        point.tangent_impulse = total;
        apply(&mut one, &mut two, ra, rb, tangent * impulse);
    }
    keep(bodies, contact.a, one);
    keep(bodies, contact.b, two);
}

/// After the substeps, makes points that hit hard enough bounce.
pub fn bounce(bodies: &mut [Body], contact: &mut Contact) {
    if contact.restitution == 0.0 {
        return;
    }
    let mut one = motion(bodies, contact.a);
    let mut two = motion(bodies, contact.b);
    let normal = contact.normal;
    for point in &mut contact.points[..contact.count] {
        if point.closing > -BOUNCE_SPEED || point.most_impulse == 0.0 {
            continue;
        }
        let (ra, rb) = (point.from_a, point.from_b);
        let closing = normal.dot((two.velocity + rb.spun(two.spin)) - (one.velocity + ra.spun(one.spin)));
        let impulse = -point.normal_mass * (closing + contact.restitution * point.closing);
        let total = (point.normal_impulse + impulse).max(0.0);
        let impulse = total - point.normal_impulse;
        point.normal_impulse = total;
        apply(&mut one, &mut two, ra, rb, normal * impulse);
    }
    keep(bodies, contact.a, one);
    keep(bodies, contact.b, two);
}
