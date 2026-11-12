//! A hinge between two bodies (a revolute joint): it holds a point of one to a point of the other and
//! lets them turn about it. It can keep the angle between them within limits, and it can have a
//! motor that turns it at a chosen speed with no more than a chosen torque, as a muscle would.

use super::contact::{Motion, keep, motion};
use super::{Body, Soft};
use crate::math::{Rotation, Vec2, clamp, wrap};

#[derive(Clone, Copy, Debug)]
pub struct Joint {
    pub a: u32,
    pub b: u32,
    /// The hinge's point in each body's own frame.
    pub local_a: Vec2,
    pub local_b: Vec2,
    /// The turn of b from a that counts as an angle of zero.
    pub rest: Rotation,
    /// The angle may not go below `lower` or above `upper`, when `limited`.
    pub limited: bool,
    pub lower: f32,
    pub upper: f32,
    /// The motor turns b against a at `speed` radians a second, with up to `torque` newton metres.
    /// A torque of zero is no motor.
    pub speed: f32,
    pub torque: f32,
    linear_impulse: Vec2,
    motor_impulse: f32,
    lower_impulse: f32,
    upper_impulse: f32,
    axial_mass: f32,
}

impl Joint {
    /// A hinge at a point in the world, with the bodies' current angle between them as zero.
    pub fn new(bodies: &[Body], a: u32, b: u32, at: Vec2) -> Joint {
        let one = &bodies[a as usize];
        let two = &bodies[b as usize];
        Joint {
            a,
            b,
            local_a: one.rotation.undo(at - one.position),
            local_b: two.rotation.undo(at - two.position),
            rest: one.rotation.between(two.rotation),
            limited: false,
            lower: 0.0,
            upper: 0.0,
            speed: 0.0,
            torque: 0.0,
            linear_impulse: Vec2::ZERO,
            motor_impulse: 0.0,
            lower_impulse: 0.0,
            upper_impulse: 0.0,
            axial_mass: 0.0,
        }
    }

    /// The angle of b from a, less the angle they started at.
    pub fn angle(&self, bodies: &[Body]) -> f32 {
        let turn = bodies[self.a as usize].rotation.between(bodies[self.b as usize].rotation);
        wrap(self.rest.between(turn).angle())
    }

    /// How fast the angle is changing, in radians a second.
    pub fn angular_speed(&self, bodies: &[Body]) -> f32 {
        bodies[self.b as usize].spin - bodies[self.a as usize].spin
    }

    /// The torque the motor applied over the last substep, in newton metres.
    pub fn motor_torque(&self, h: f32) -> f32 {
        self.motor_impulse / h
    }

    pub(crate) fn prepare(&mut self, bodies: &[Body]) {
        let k = motion(bodies, self.a).inverse_inertia + motion(bodies, self.b).inverse_inertia;
        self.axial_mass = if k > 0.0 { 1.0 / k } else { 0.0 };
        if !self.limited {
            self.lower_impulse = 0.0;
            self.upper_impulse = 0.0;
        }
        if self.torque <= 0.0 {
            self.motor_impulse = 0.0;
        }
    }

    fn arms(&self, bodies: &[Body]) -> (Vec2, Vec2) {
        (bodies[self.a as usize].rotation.apply(self.local_a), bodies[self.b as usize].rotation.apply(self.local_b))
    }

    pub(crate) fn warm_start(&self, bodies: &mut [Body]) {
        let mut one = motion(bodies, self.a);
        let mut two = motion(bodies, self.b);
        let (ra, rb) = self.arms(bodies);
        let axial = self.motor_impulse + self.lower_impulse - self.upper_impulse;
        one.velocity -= self.linear_impulse * one.inverse_mass;
        one.spin -= one.inverse_inertia * (ra.cross(self.linear_impulse) + axial);
        two.velocity += self.linear_impulse * two.inverse_mass;
        two.spin += two.inverse_inertia * (rb.cross(self.linear_impulse) + axial);
        keep(bodies, self.a, one);
        keep(bodies, self.b, two);
    }

    /// One pass over the joint, the same shape as a contact's: with `push` it also closes any gap
    /// that has opened at the hinge or past a limit.
    pub(crate) fn solve(&mut self, bodies: &mut [Body], soft: Soft, h: f32, push: bool) {
        let mut one = motion(bodies, self.a);
        let mut two = motion(bodies, self.b);

        if self.torque > 0.0 {
            let most = h * self.torque;
            let wanted = -self.axial_mass * (two.spin - one.spin - self.speed);
            let total = clamp(self.motor_impulse + wanted, -most, most);
            let impulse = total - self.motor_impulse;
            self.motor_impulse = total;
            one.spin -= one.inverse_inertia * impulse;
            two.spin += two.inverse_inertia * impulse;
        }

        if self.limited {
            let angle = self.angle(bodies);
            // the lower limit pushes the angle up, the upper limit pushes it down
            for (gap, sign) in [(angle - self.lower, 1.0f32), (self.upper - angle, -1.0)] {
                let (bias, mass_scale, impulse_scale) = if gap > 0.0 {
                    (gap / h, 1.0, 0.0)
                } else if push {
                    (soft.bias_rate * gap, soft.mass_scale, soft.impulse_scale)
                } else {
                    (0.0, 1.0, 0.0)
                };
                let accumulated = if sign > 0.0 { &mut self.lower_impulse } else { &mut self.upper_impulse };
                let closing = sign * (two.spin - one.spin);
                let wanted = -self.axial_mass * mass_scale * (closing + bias) - impulse_scale * *accumulated;
                let total = (*accumulated + wanted).max(0.0);
                let impulse = sign * (total - *accumulated);
                *accumulated = total;
                one.spin -= one.inverse_inertia * impulse;
                two.spin += two.inverse_inertia * impulse;
            }
        }

        let (ra, rb) = self.arms(bodies);
        let drift = (two.velocity + rb.spun(two.spin)) - (one.velocity + ra.spun(one.spin));
        let (bias, mass_scale, impulse_scale) = if push {
            let gap = (bodies[self.b as usize].position + rb) - (bodies[self.a as usize].position + ra);
            (gap * soft.bias_rate, soft.mass_scale, soft.impulse_scale)
        } else {
            (Vec2::ZERO, 1.0, 0.0)
        };
        let (ma, mb, ia, ib) = (one.inverse_mass, two.inverse_mass, one.inverse_inertia, two.inverse_inertia);
        let k11 = ma + mb + ra.y * ra.y * ia + rb.y * rb.y * ib;
        let k12 = -ra.y * ra.x * ia - rb.y * rb.x * ib;
        let k22 = ma + mb + ra.x * ra.x * ia + rb.x * rb.x * ib;
        let determinant = k11 * k22 - k12 * k12;
        let determinant = if determinant != 0.0 { 1.0 / determinant } else { 0.0 };
        let rhs = drift + bias;
        let solved = Vec2::new(determinant * (k22 * rhs.x - k12 * rhs.y), determinant * (k11 * rhs.y - k12 * rhs.x));
        let impulse = -solved * mass_scale - self.linear_impulse * impulse_scale;
        self.linear_impulse += impulse;
        push_apart(&mut one, &mut two, ra, rb, impulse);

        keep(bodies, self.a, one);
        keep(bodies, self.b, two);
    }
}

fn push_apart(one: &mut Motion, two: &mut Motion, ra: Vec2, rb: Vec2, impulse: Vec2) {
    one.velocity -= impulse * one.inverse_mass;
    one.spin -= one.inverse_inertia * ra.cross(impulse);
    two.velocity += impulse * two.inverse_mass;
    two.spin += two.inverse_inertia * rb.cross(impulse);
}
