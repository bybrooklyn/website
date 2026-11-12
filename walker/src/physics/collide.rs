//! Where two outlines touch, or are about to. The answer is a direction from the first to the second
//! and up to two points, each with how far apart the two surfaces are there (less than zero when they
//! overlap). Points a little apart are kept too, so the solver can stop a fast body before it goes
//! in rather than push it out after.
//!
//! The method is Box2D's, by Erin Catto: find the side of either outline that separates them most,
//! then cut the facing side of the other to its length. Where two corners are nearest each other,
//! the direction runs between them instead.

use super::shape::Outline;
use crate::math::{Vec2, clamp};

/// How close two surfaces must come before they are treated as touching, in metres.
pub const AHEAD: f32 = 0.02;
/// The overlap the solver leaves alone, so that resting things do not flicker in and out of contact.
pub const SLOP: f32 = 0.005;

#[derive(Clone, Copy, Debug, Default)]
pub struct Touch {
    /// The point midway between the two surfaces.
    pub point: Vec2,
    pub separation: f32,
    /// Which corners and sides made this point, so the same point can be found again next step.
    pub id: u32,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Manifold {
    pub normal: Vec2,
    pub points: [Touch; 2],
    pub count: usize,
}

impl Manifold {
    fn push(&mut self, point: Vec2, separation: f32, id: u32) {
        if separation <= AHEAD && self.count < 2 {
            self.points[self.count] = Touch { point, separation, id };
            self.count += 1;
        }
    }
}

fn next(i: usize, count: usize) -> usize {
    if i + 1 == count { 0 } else { i + 1 }
}

fn id(a: usize, b: usize) -> u32 {
    ((a as u32) << 8) | b as u32
}

/// Where two placed outlines touch.
pub fn collide(a: &Outline, b: &Outline) -> Manifold {
    if b.count == 1 {
        collide_round(a, b.corners[0], b.radius)
    } else if a.count == 1 {
        let mut manifold = collide_round(b, a.corners[0], a.radius);
        manifold.normal = -manifold.normal;
        manifold
    } else {
        collide_outlines(a, b)
    }
}

/// The nearest point of an outline's core to a point: the direction from the core to the point, the
/// distance along it (less than zero inside), and the nearest point of the core itself.
pub fn nearest_to(a: &Outline, center: Vec2) -> (Vec2, f32, Vec2) {
    if a.count == 1 {
        let gap = center - a.corners[0];
        let distance = gap.length();
        let normal = if distance > 1e-6 { gap * (1.0 / distance) } else { Vec2::new(0.0, 1.0) };
        return (normal, distance, a.corners[0]);
    }
    // the side the point is furthest out from
    let mut best = 0;
    let mut most = f32::MIN;
    for i in 0..a.count {
        let out = a.normals[i].dot(center - a.corners[i]);
        if out > most {
            most = out;
            best = i;
        }
    }
    let v1 = a.corners[best];
    let v2 = a.corners[next(best, a.count)];
    if most > 0.0 && (center - v1).dot(v2 - v1) < 0.0 {
        let gap = center - v1;
        (gap.normalized(), gap.length(), v1)
    } else if most > 0.0 && (center - v2).dot(v1 - v2) < 0.0 {
        let gap = center - v2;
        (gap.normalized(), gap.length(), v2)
    } else {
        let normal = a.normals[best];
        (normal, most, center - normal * most)
    }
}

/// An outline against a circle.
fn collide_round(a: &Outline, center: Vec2, radius: f32) -> Manifold {
    let mut manifold = Manifold::default();
    let reach = a.radius + radius;
    let (normal, distance, near) = nearest_to(a, center);
    if distance > reach + AHEAD {
        return manifold;
    }
    manifold.normal = normal;
    // midway between the outline's surface and the circle's
    let on_a = near + normal * a.radius;
    let on_b = center - normal * radius;
    manifold.push(on_a.lerp(on_b, 0.5), distance - reach, 0);
    manifold
}

/// The side of `one` that `two` lies furthest out from, and how far out.
fn furthest_side(one: &Outline, two: &Outline) -> (usize, f32) {
    let mut best = 0;
    let mut most = f32::MIN;
    for i in 0..one.count {
        let normal = one.normals[i];
        let corner = one.corners[i];
        let mut least = f32::MAX;
        for j in 0..two.count {
            least = least.min(normal.dot(two.corners[j] - corner));
        }
        if least > most {
            most = least;
            best = i;
        }
    }
    (best, most)
}

/// The side of `outline` that faces most against `direction`.
fn facing_side(outline: &Outline, direction: Vec2) -> usize {
    let mut best = 0;
    let mut least = f32::MAX;
    for i in 0..outline.count {
        let along = direction.dot(outline.normals[i]);
        if along < least {
            least = along;
            best = i;
        }
    }
    best
}

/// The nearest points of the lines p1 to p2 and q1 to q2, as fractions along each.
pub fn nearest_on_lines(p1: Vec2, p2: Vec2, q1: Vec2, q2: Vec2) -> (f32, f32) {
    let d1 = p2 - p1;
    let d2 = q2 - q1;
    let r = p1 - q1;
    let dd1 = d1.dot(d1);
    let dd2 = d2.dot(d2);
    let rd1 = r.dot(d1);
    let rd2 = r.dot(d2);
    let tiny = 1e-12;
    let fraction = |x: f32| clamp(x, 0.0, 1.0);
    if dd1 < tiny || dd2 < tiny {
        if dd1 >= tiny {
            return (fraction(-rd1 / dd1), 0.0);
        }
        if dd2 >= tiny {
            return (0.0, fraction(rd2 / dd2));
        }
        return (0.0, 0.0);
    }
    let d12 = d1.dot(d2);
    let denominator = dd1 * dd2 - d12 * d12;
    let mut f1 = if denominator != 0.0 { fraction((d12 * rd2 - rd1 * dd2) / denominator) } else { 0.0 };
    let mut f2 = (d12 * f1 + rd2) / dd2;
    if f2 < 0.0 {
        f2 = 0.0;
        f1 = fraction(-rd1 / dd1);
    } else if f2 > 1.0 {
        f2 = 1.0;
        f1 = fraction((d12 - rd1) / dd1);
    }
    (f1, f2)
}

/// Two outlines of two or more corners each.
fn collide_outlines(a: &Outline, b: &Outline) -> Manifold {
    let (mut side_a, apart_a) = furthest_side(a, b);
    let (mut side_b, apart_b) = furthest_side(b, a);
    let reach = a.radius + b.radius;
    if apart_a > reach + AHEAD || apart_b > reach + AHEAD {
        return Manifold::default();
    }
    // the side to cut against belongs to whichever outline separates them more, with a slight
    // preference for the first so that the choice does not flip between steps
    let flip = apart_b > apart_a + 0.1 * SLOP;
    if flip {
        side_a = facing_side(a, b.normals[side_b]);
    } else {
        side_b = facing_side(b, a.normals[side_a]);
    }

    if apart_a.max(apart_b) > 0.1 * SLOP {
        // the cores are apart, so the nearest points may be two corners rather than along a side
        let a1 = side_a;
        let a2 = next(side_a, a.count);
        let b1 = side_b;
        let b2 = next(side_b, b.count);
        let (fa, fb) = nearest_on_lines(a.corners[a1], a.corners[a2], b.corners[b1], b.corners[b2]);
        let corner_a = if fa == 0.0 { Some(a1) } else if fa == 1.0 { Some(a2) } else { None };
        let corner_b = if fb == 0.0 { Some(b1) } else if fb == 1.0 { Some(b2) } else { None };
        if let (Some(i), Some(j)) = (corner_a, corner_b) {
            let gap = b.corners[j] - a.corners[i];
            let distance = gap.length();
            let mut manifold = Manifold::default();
            if distance > reach + AHEAD || distance < 1e-6 {
                return manifold;
            }
            let normal = gap * (1.0 / distance);
            manifold.normal = normal;
            let on_a = a.corners[i] + normal * a.radius;
            let on_b = b.corners[j] - normal * b.radius;
            manifold.push(on_a.lerp(on_b, 0.5), distance - reach, id(i, j));
            return manifold;
        }
    }
    cut(a, b, side_a, side_b, flip)
}

/// Cuts the facing side of one outline to the length of the other's side, giving up to two points.
fn cut(a: &Outline, b: &Outline, side_a: usize, side_b: usize, flip: bool) -> Manifold {
    let (one, two, i11, i21) = if flip { (b, a, side_b, side_a) } else { (a, b, side_a, side_b) };
    let i12 = next(i11, one.count);
    let i22 = next(i21, two.count);
    let normal = one.normals[i11];
    let v11 = one.corners[i11];
    let v12 = one.corners[i12];
    let v21 = two.corners[i21];
    let v22 = two.corners[i22];
    let tangent = normal.left();
    let lower1 = 0.0;
    let upper1 = (v12 - v11).dot(tangent);
    // the facing side runs the other way round, so its first corner is the upper one
    let upper2 = (v21 - v11).dot(tangent);
    let lower2 = (v22 - v11).dot(tangent);
    let span = upper2 - lower2;
    let low = if lower2 < lower1 && span > f32::EPSILON { v22.lerp(v21, (lower1 - lower2) / span) } else { v22 };
    let high = if upper2 > upper1 && span > f32::EPSILON { v22.lerp(v21, (upper1 - lower2) / span) } else { v21 };
    let apart_low = (low - v11).dot(normal);
    let apart_high = (high - v11).dot(normal);
    let low = low + normal * (0.5 * (one.radius - two.radius - apart_low));
    let high = high + normal * (0.5 * (one.radius - two.radius - apart_high));
    let reach = one.radius + two.radius;
    let mut manifold = Manifold::default();
    if flip {
        manifold.normal = -normal;
        manifold.push(high, apart_high - reach, id(i21, i12) | 0x10000);
        manifold.push(low, apart_low - reach, id(i22, i11) | 0x10000);
    } else {
        manifold.normal = normal;
        manifold.push(low, apart_low - reach, id(i11, i22));
        manifold.push(high, apart_high - reach, id(i12, i21));
    }
    manifold
}
