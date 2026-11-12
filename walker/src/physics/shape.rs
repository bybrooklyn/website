//! The shapes a body can have: a circle, a capsule (a line with a round end at each side, like a limb)
//! and a box. For finding where things touch, every shape is seen the same way, as a convex outline of
//! one, two or four corners grown outward by a radius (`Outline`). A circle is one corner grown, a
//! capsule two, a box four grown by nothing, and a piece of ground two grown by nothing.

use crate::math::{PI, Rotation, Vec2};

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Shape {
    Circle { radius: f32 },
    /// Lies along the body's own x axis, `half` to each side of the middle before the round ends.
    Capsule { half: f32, radius: f32 },
    Box { half_width: f32, half_height: f32 },
}

impl Shape {
    /// The number the page is given for each kind: 0 a circle, 1 a capsule, 2 a box.
    pub fn kind(&self) -> u32 {
        match self {
            Shape::Circle { .. } => 0,
            Shape::Capsule { .. } => 1,
            Shape::Box { .. } => 2,
        }
    }

    /// The two numbers that size it: a circle's radius and 0, a capsule's half length and radius, a
    /// box's half width and half height.
    pub fn size(&self) -> (f32, f32) {
        match *self {
            Shape::Circle { radius } => (radius, 0.0),
            Shape::Capsule { half, radius } => (half, radius),
            Shape::Box { half_width, half_height } => (half_width, half_height),
        }
    }

    /// Builds a shape from its kind and size numbers, as the page gives them.
    pub fn from_kind(kind: u32, a: f32, b: f32) -> Shape {
        match kind {
            0 => Shape::Circle { radius: a },
            1 => Shape::Capsule { half: a, radius: b },
            _ => Shape::Box { half_width: a, half_height: b },
        }
    }

    pub fn area(&self) -> f32 {
        match *self {
            Shape::Circle { radius } => PI * radius * radius,
            Shape::Capsule { half, radius } => 4.0 * half * radius + PI * radius * radius,
            Shape::Box { half_width, half_height } => 4.0 * half_width * half_height,
        }
    }

    /// How hard the shape is to spin about its middle, for a given mass.
    pub fn inertia(&self, mass: f32) -> f32 {
        match *self {
            Shape::Circle { radius } => 0.5 * mass * radius * radius,
            Shape::Capsule { half, radius } => {
                // counted as a box the length of the whole capsule, which is close enough for a limb
                let length = 2.0 * (half + radius);
                mass * (length * length + 4.0 * radius * radius) / 12.0
            }
            Shape::Box { half_width, half_height } => mass * (half_width * half_width + half_height * half_height) / 3.0,
        }
    }

    /// The outline in the body's own frame.
    pub fn outline(&self) -> Outline {
        match *self {
            Shape::Circle { radius } => Outline::point(Vec2::ZERO, radius),
            Shape::Capsule { half, radius } => Outline::line(Vec2::new(-half, 0.0), Vec2::new(half, 0.0), radius),
            Shape::Box { half_width: w, half_height: h } => Outline {
                corners: [Vec2::new(-w, -h), Vec2::new(w, -h), Vec2::new(w, h), Vec2::new(-w, h)],
                normals: [Vec2::new(0.0, -1.0), Vec2::new(1.0, 0.0), Vec2::new(0.0, 1.0), Vec2::new(-1.0, 0.0)],
                count: 4,
                radius: 0.0,
            },
        }
    }
}

/// A convex outline: up to four corners going round anticlockwise, the outward direction of each
/// side (side i runs from corner i to corner i + 1), and a radius it is grown by.
#[derive(Clone, Copy, Debug, Default)]
pub struct Outline {
    pub corners: [Vec2; 4],
    pub normals: [Vec2; 4],
    pub count: usize,
    pub radius: f32,
}

impl Outline {
    pub fn point(at: Vec2, radius: f32) -> Outline {
        Outline { corners: [at; 4], normals: [Vec2::ZERO; 4], count: 1, radius }
    }

    /// A line from `a` to `b`, seen as a flat outline with two sides facing opposite ways.
    pub fn line(a: Vec2, b: Vec2, radius: f32) -> Outline {
        let normal = (b - a).normalized().right();
        Outline { corners: [a, b, a, b], normals: [normal, -normal, normal, -normal], count: 2, radius }
    }

    /// The outline moved to where a body is.
    pub fn placed(&self, position: Vec2, rotation: Rotation) -> Outline {
        let mut placed = *self;
        for i in 0..self.count {
            placed.corners[i] = position + rotation.apply(self.corners[i]);
            placed.normals[i] = rotation.apply(self.normals[i]);
        }
        placed
    }

    /// The box around it, as (lowest corner, highest corner), grown by `margin` as well.
    pub fn bounds(&self, margin: f32) -> (Vec2, Vec2) {
        let mut low = self.corners[0];
        let mut high = self.corners[0];
        for corner in &self.corners[1..self.count] {
            low = Vec2::new(low.x.min(corner.x), low.y.min(corner.y));
            high = Vec2::new(high.x.max(corner.x), high.y.max(corner.y));
        }
        let grow = self.radius + margin;
        (low - Vec2::new(grow, grow), high + Vec2::new(grow, grow))
    }
}
