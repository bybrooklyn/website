//! Casting a ray: from a point, in a direction, how far until it meets the ground, a static block or
//! a body, and which. The ground and the blocks are sorted by where they start, so only those whose
//! span the ray crosses are looked at, found by a binary search; bodies are few and each is passed
//! over at once unless the ray crosses its box. This is what the generalist's eyes are made of, and
//! it runs for every creature at every step, so it is kept quick.

use super::{Body, World};
use crate::math::Vec2;

/// What a ray met: a piece of ground, a static block or a body, by its number.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Struck {
    Ground(u32),
    Block(u32),
    Body(u32),
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hit {
    /// How far along the ray, in metres.
    pub distance: f32,
    pub struck: Struck,
}

/// How far along the ray from `from` in `toward` (of length one) it meets the line from `a` to `b`.
pub fn ray_line(from: Vec2, toward: Vec2, a: Vec2, b: Vec2) -> Option<f32> {
    let along = b - a;
    let across = toward.cross(along);
    if across == 0.0 {
        return None;
    }
    let to_a = a - from;
    let t = to_a.cross(along) / across;
    let u = to_a.cross(toward) / across;
    (t >= 0.0 && (0.0..=1.0).contains(&u)).then_some(t)
}

/// How far along the ray it meets a box given by its lowest and highest corners, 0 if it starts in it.
pub fn ray_box(from: Vec2, toward: Vec2, low: Vec2, high: Vec2) -> Option<f32> {
    let mut enter = 0.0f32;
    let mut leave = f32::MAX;
    for (start, step, low, high) in [(from.x, toward.x, low.x, high.x), (from.y, toward.y, low.y, high.y)] {
        if step == 0.0 {
            if start < low || start > high {
                return None;
            }
            continue;
        }
        let (a, b) = ((low - start) / step, (high - start) / step);
        let (near, far) = if a < b { (a, b) } else { (b, a) };
        enter = enter.max(near);
        leave = leave.min(far);
        if enter > leave {
            return None;
        }
    }
    Some(enter)
}

/// How far along the ray it meets a body's surface: a circle, a capsule (its two round ends and its
/// two sides) or a box.
pub fn ray_body(from: Vec2, toward: Vec2, body: &Body) -> Option<f32> {
    let outline = body.placed();
    let circle = |centre: Vec2, radius: f32| {
        let to = centre - from;
        let along = to.dot(toward);
        let miss = to.length_squared() - along * along;
        let inside = radius * radius - miss;
        if inside < 0.0 {
            return None;
        }
        let t = along - crate::math::sqrt(inside);
        if t >= 0.0 { Some(t) } else if along + crate::math::sqrt(inside) >= 0.0 { Some(0.0) } else { None }
    };
    match outline.count {
        1 => circle(outline.corners[0], outline.radius),
        2 => {
            let (a, b) = (outline.corners[0], outline.corners[1]);
            let side = outline.normals[0] * outline.radius;
            [circle(a, outline.radius), circle(b, outline.radius), ray_line(from, toward, a + side, b + side), ray_line(from, toward, a - side, b - side)].into_iter().flatten().reduce(f32::min)
        }
        _ => {
            // clipped against each side in turn, as a convex outline is
            let mut enter = 0.0f32;
            let mut leave = f32::MAX;
            for i in 0..outline.count {
                let normal = outline.normals[i];
                let gap = normal.dot(outline.corners[i] - from);
                let closing = normal.dot(toward);
                if closing == 0.0 {
                    if gap < 0.0 {
                        return None;
                    }
                } else if closing < 0.0 {
                    enter = enter.max(gap / closing);
                } else {
                    leave = leave.min(gap / closing);
                }
                if enter > leave {
                    return None;
                }
            }
            Some(enter)
        }
    }
}

impl World {
    /// The nearest thing a ray from `from` in `toward` (of length one) meets within `range`, passing
    /// through bodies of group `skip` (a creature's own parts) if it is not 0.
    pub fn cast(&self, from: Vec2, toward: Vec2, range: f32, skip: u32) -> Option<Hit> {
        let end = from + toward * range;
        let (left, right) = (from.x.min(end.x), from.x.max(end.x));
        let (low, high) = (from.y.min(end.y), from.y.max(end.y));
        let mut best: Option<Hit> = None;
        let mut nearest = range;
        let mut keep = |t: Option<f32>, struck: Struck| {
            if let Some(t) = t.filter(|&t| t <= nearest) {
                nearest = t;
                best = Some(Hit { distance: t, struck });
            }
        };
        let ground = &self.ground;
        let start = ground.pieces.partition_point(|piece| piece.a.x < left - ground.widest);
        for (index, piece) in ground.pieces.iter().enumerate().skip(start) {
            if piece.a.x > right {
                break;
            }
            if piece.b.x < left || piece.a.y.min(piece.b.y) > high || piece.a.y.max(piece.b.y) < low {
                continue;
            }
            keep(ray_line(from, toward, piece.a, piece.b), Struck::Ground(index as u32));
        }
        let start = ground.blocks.partition_point(|block| block.1.x < left - ground.widest_block);
        for (index, (_, block_low, block_high)) in ground.blocks.iter().enumerate().skip(start) {
            if block_low.x > right {
                break;
            }
            if block_high.x < left || block_low.y > high || block_high.y < low {
                continue;
            }
            keep(ray_box(from, toward, *block_low, *block_high), Struck::Block(index as u32));
        }
        for (index, body) in self.bodies.iter().enumerate() {
            if skip != 0 && body.group == skip {
                continue;
            }
            let (body_low, body_high) = body.placed().bounds(0.0);
            if body_low.x > right || body_high.x < left || body_low.y > high || body_high.y < low {
                continue;
            }
            keep(ray_body(from, toward, body), Struck::Body(index as u32));
        }
        best
    }

    /// The same as `cast`, looking at every piece, block and body there is: slow, to hold the quick
    /// way to its answer.
    pub fn cast_slowly(&self, from: Vec2, toward: Vec2, range: f32, skip: u32) -> Option<Hit> {
        let mut best: Option<Hit> = None;
        let mut keep = |t: Option<f32>, struck: Struck| {
            if let Some(t) = t.filter(|&t| t <= range && best.is_none_or(|best| t <= best.distance)) {
                best = Some(Hit { distance: t, struck });
            }
        };
        for (index, piece) in self.ground.pieces.iter().enumerate() {
            keep(ray_line(from, toward, piece.a, piece.b), Struck::Ground(index as u32));
        }
        for (index, (_, low, high)) in self.ground.blocks.iter().enumerate() {
            keep(ray_box(from, toward, *low, *high), Struck::Block(index as u32));
        }
        for (index, body) in self.bodies.iter().enumerate().filter(|(_, body)| skip == 0 || body.group != skip) {
            keep(ray_body(from, toward, body), Struck::Body(index as u32));
        }
        best
    }
}
