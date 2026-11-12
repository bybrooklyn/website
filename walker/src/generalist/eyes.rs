//! What the creature sees: a fan of rays from its eye, each saying how near the first thing it meets
//! is and what kind of thing that is. Rays first, a picture later, as the owner chose.
//!
//! There are sixteen rays, held level with the world whatever the body does, as an animal holds its
//! head steady. Eleven look down ahead, aimed so that on level ground they land every 0.35 m from
//! 0.3 m to 3.8 m in front of an eye a metre up: close enough together that a gap or a pool as narrow
//! as the narrowest in a world falls between two of them by the time it is a hop away, and far enough
//! ahead to see it coming a few strides off. Five look up and ahead, level, then at 15, 35, 60 and 90
//! degrees, for walls, ledges, boxes and the platforms overhead. Each sees 6 m.
//!
//! For the brain each ray is six numbers: how near what it meets is (1 touching, 0 nothing within
//! 6 m), and then 1 or 0 for whether it is the edge of a drop (ground or a platform within 0.3 m of
//! where it ends over a gap or a drop), a box, a hazard, a moving thing (a moving platform or a
//! see-saw), or food (always 0 until there is food). Ground is what is near with none of these.
//!
//! `picture` lays the ground for a picture of what it sees instead, a strip of greyscale pixels from
//! the same world, as a creature in a flat world would see. Nothing uses it yet.

use super::stage::{Stage, Thing};
use crate::math::{Vec2, sin_cos};
use crate::physics::cast::Struck;

/// How many rays, how far each sees, and how many numbers each gives the brain.
pub const RAYS: usize = 16;
pub const RANGE: f32 = 6.0;
pub const PER_RAY: usize = 6;
/// How near the end of a surface a ray must land to see the edge of a drop, in metres, and how much
/// lower the ground beyond must be to be a drop rather than a step.
const EDGE: f32 = 0.3;
const DROP: f32 = 0.12;
const DEGREE: f32 = crate::math::PI / 180.0;

/// What a ray met.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Seen {
    Nothing,
    Ground,
    Edge,
    Box,
    Hazard,
    Moving,
    Food,
}

impl Seen {
    /// The number the page is given for each: 0 nothing, 1 ground, 2 an edge, 3 a box, 4 a hazard,
    /// 5 a moving thing, 6 food.
    pub fn number(self) -> u32 {
        self as u32
    }

    /// How bright it is in a picture, from 0 to 1.
    fn shade(self) -> f32 {
        match self {
            Seen::Nothing => 0.0,
            Seen::Edge => 0.3,
            Seen::Ground => 0.55,
            Seen::Moving => 0.75,
            Seen::Box => 0.85,
            Seen::Hazard | Seen::Food => 1.0,
        }
    }
}

/// The direction of each ray, from straight ahead turning up (anticlockwise), in radians.
pub fn angles() -> [f32; RAYS] {
    let mut angles = [0.0; RAYS];
    for (k, angle) in angles.iter_mut().take(11).enumerate() {
        let ahead = 0.3 + 0.35 * k as f32;
        *angle = -crate::math::atan2(1.0, ahead);
    }
    let up = [0.0f32, 15.0, 35.0, 60.0, 90.0];
    for (k, degrees) in up.iter().enumerate() {
        angles[11 + k] = degrees * DEGREE;
    }
    angles
}

/// Where the eye is: at the front of the body, a little above its middle, where the page draws it.
pub fn eye(stage: &Stage, torso: u32) -> Vec2 {
    let body = &stage.world.bodies[torso as usize];
    let (half_width, half_height) = body.shape.size();
    let front = if half_width > 0.4 { 0.78 } else { 0.5 };
    body.position + body.rotation.apply(Vec2::new(half_width * front, half_height * 0.3))
}

/// What one ray from `from` at `angle` meets: how far, and what kind of thing.
pub fn look(stage: &Stage, from: Vec2, angle: f32, skip: u32) -> (f32, Seen) {
    let (s, c) = sin_cos(angle);
    let toward = Vec2::new(c, s);
    let world = &stage.world;
    let mut distance = RANGE;
    let mut seen = Seen::Nothing;
    if let Some(hit) = world.cast(from, toward, RANGE, skip) {
        distance = hit.distance;
        let at = from + toward * hit.distance;
        seen = match hit.struck {
            Struck::Ground(index) => {
                let piece = world.ground()[index as usize];
                if is_edge(stage, at, piece.a.x.min(piece.b.x), piece.a.x.max(piece.b.x), at.y) { Seen::Edge } else { Seen::Ground }
            }
            Struck::Block(index) => {
                let (low, high) = world.blocks().nth(index as usize).unwrap_or((at, at));
                if at.y >= high.y - 0.01 && is_edge(stage, at, low.x, high.x, high.y) { Seen::Edge } else { Seen::Ground }
            }
            Struck::Body(index) => match stage.made.iter().find(|made| made.body == index || made.thing == Thing::Seesaw && made.body + 1 == index) {
                Some(made) if made.thing == Thing::Loose => Seen::Box,
                Some(_) => Seen::Moving,
                None => Seen::Ground,
            },
        };
    }
    // hazards are not solid, so they are looked for along the ray as far as it got
    let land = &stage.land;
    let end = from + toward * distance;
    let (left, right) = (from.x.min(end.x) + stage.origin, from.x.max(end.x) + stage.origin);
    let zones = &land.geometry.hazards;
    let first = zones.partition_point(|zone| zone.high.x < left);
    for zone in zones[first..].iter().take_while(|zone| zone.low.x <= right) {
        let shift = Vec2::new(stage.origin, 0.0);
        if let Some(t) = crate::physics::cast::ray_box(from, toward, zone.low - shift, zone.high - shift).filter(|&t| t < distance) {
            distance = t;
            seen = Seen::Hazard;
        }
    }
    (distance, seen)
}

/// Whether a ray landing at `at` on a surface from `left` to `right` at `height` is at the edge of a
/// drop: near an end of it, beyond which there is nothing to stand on, or only something lower.
fn is_edge(stage: &Stage, at: Vec2, left: f32, right: f32, height: f32) -> bool {
    let world = &stage.world;
    let beyond = |x: f32| world.ground_height(x).is_none_or(|ground| ground < height - DROP) && !world.blocks().any(|(low, high)| low.x <= x && x <= high.x && high.y >= height - DROP && high.y <= height + DROP);
    // a riser is not a surface to land on
    if right - left < 1e-4 {
        return false;
    }
    (right - at.x < EDGE && beyond(right + 0.05)) || (at.x - left < EDGE && beyond(left - 0.05))
}

/// What the creature with this torso sees, written into `into`: `RAYS * PER_RAY` numbers, ray after
/// ray, as the brain takes them. Gives back each ray's distance and kind too, for drawing.
pub fn see(stage: &Stage, torso: u32, skip: u32, into: &mut [f32], seen: &mut [(f32, Seen); RAYS]) {
    let from = eye(stage, torso);
    for (k, angle) in angles().iter().enumerate() {
        let (distance, what) = look(stage, from, *angle, skip);
        seen[k] = (distance, what);
        let out = &mut into[k * PER_RAY..(k + 1) * PER_RAY];
        out[0] = if what == Seen::Nothing { 0.0 } else { 1.0 - distance / RANGE };
        for (slot, kind) in [Seen::Edge, Seen::Box, Seen::Hazard, Seen::Moving, Seen::Food].iter().enumerate() {
            out[1 + slot] = if what == *kind { 1.0 } else { 0.0 };
        }
    }
}

/// A picture of what the creature sees, from the same world: `into.len()` greyscale pixels from 0 to 1,
/// each a ray from the eye, evenly from 80 degrees down to 60 degrees up, lit by what it meets and
/// dimmer the further off that is. The strip a creature in a flat world would see with one eye.
pub fn picture(stage: &Stage, torso: u32, skip: u32, into: &mut [f32]) {
    let from = eye(stage, torso);
    let count = into.len().max(2);
    let (low, high) = (-80.0 * DEGREE, 60.0 * DEGREE);
    for (k, pixel) in into.iter_mut().enumerate() {
        let angle = low + (high - low) * k as f32 / (count - 1) as f32;
        let (distance, what) = look(stage, from, angle, skip);
        *pixel = what.shade() * (1.0 - 0.7 * distance / RANGE);
    }
}
