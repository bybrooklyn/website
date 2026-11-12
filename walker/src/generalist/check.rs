//! Proof that a world can be crossed: that a body of the creature's reach, which can step up so high,
//! jump up so high and leap so far, can get from the start to the end.
//!
//! The world is seen as surfaces to stand on: ground that is not too steep, the tops of floating
//! platforms, the top of a loose box anywhere it can be pushed along level ground, a moving
//! platform anywhere along its way (the creature can wait for it), and a see-saw tipped either way.
//! Hazards are cut out of the surfaces under them. Then a surface can be reached from another if the
//! two touch, or if a jump of the creature's reach gets from the nearest point of one to the nearest
//! point of the other. A jump that can rise `climb` and go `leap` on the level goes, from a launch at
//! a steady pace, `leap / 2 * (1 + sqrt(1 - rise / climb))` to land `rise` higher (or lower, for a
//! negative rise): the reach of a thrown stone. The world can be crossed if a chain of such moves goes
//! from the surface under the start to a surface at the end.
//!
//! It is generous in two ways, both kept small by the pieces' own sizes: a jump is not checked for
//! hitting anything above it on the way, and a loose box is not counted as in the way, since every
//! box is low enough to climb over.

use alloc::vec::Vec;

use super::land::{Geometry, MOVER_HALF, PLANK, Seesaw, build};
use super::recipe::Piece;
use crate::math::{Vec2, sqrt};

/// What the creature can do, in metres: the highest step it walks up, the highest ledge it can get
/// on to by jumping, and the furthest it leaps over level ground. Measured on the body in
/// `generalist::body`, whose tests hold it to doing at least this much.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Reach {
    pub step: f32,
    pub climb: f32,
    pub leap: f32,
}

pub const REACH: Reach = Reach { step: 0.12, climb: 0.22, leap: 0.7 };

/// Ground steeper than this, as rise over run, cannot be walked on.
pub const STEEPEST: f32 = 0.7;

/// Something to stand on, a straight line from left to right.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Surface {
    pub left: Vec2,
    pub right: Vec2,
}

impl Surface {
    fn height(&self, x: f32) -> f32 {
        let span = self.right.x - self.left.x;
        if span < 1e-6 { self.left.y.max(self.right.y) } else { self.left.y + (self.right.y - self.left.y) * (x - self.left.x) / span }
    }
}

impl Reach {
    /// Whether a jump goes `across` metres to land `rise` metres higher.
    pub fn jumps(&self, across: f32, rise: f32) -> bool {
        if across <= 0.05 && rise <= self.step {
            return true;
        }
        if rise > self.climb {
            return false;
        }
        across <= 0.5 * self.leap * (1.0 + sqrt(1.0 - rise / self.climb))
    }
}

/// Every surface to stand on in a world, in no order.
pub fn surfaces(geometry: &Geometry) -> Vec<Surface> {
    let mut found = Vec::new();
    for piece in &geometry.ground {
        let (left, right) = if piece.a.x <= piece.b.x { (piece.a, piece.b) } else { (piece.b, piece.a) };
        let span = right.x - left.x;
        if span > 1e-4 && (right.y - left.y).abs() <= STEEPEST * span {
            found.push(Surface { left, right });
        }
    }
    for block in &geometry.blocks {
        found.push(Surface { left: Vec2::new(block.low.x, block.high.y), right: block.high });
    }
    for loose in &geometry.loose {
        // pushed along the level ground it rests on, to where that ends
        let floor = loose.centre.y - loose.half;
        let mut stop = loose.centre.x + loose.half;
        loop {
            let further = found.iter().filter(|s| s.left.x <= stop + 0.01 && s.right.x > stop + 0.01 && (s.left.y - floor).abs() < 0.01 && (s.right.y - floor).abs() < 0.01).map(|s| s.right.x).fold(stop, f32::max);
            if further <= stop + 0.01 {
                break;
            }
            stop = further;
        }
        let top = loose.centre.y + loose.half;
        found.push(Surface { left: Vec2::new(loose.centre.x - loose.half, top), right: Vec2::new(stop, top) });
    }
    for mover in &geometry.movers {
        let top = mover.left.y + MOVER_HALF.y;
        found.push(Surface { left: Vec2::new(mover.left.x - MOVER_HALF.x, top), right: Vec2::new(mover.left.x + mover.travel + MOVER_HALF.x, top) });
    }
    for seesaw in &geometry.seesaws {
        let Seesaw { pivot, half, ground } = *seesaw;
        let (low, high) = (ground + 2.0 * PLANK, pivot.y + PLANK);
        found.push(Surface { left: Vec2::new(pivot.x - half, low), right: Vec2::new(pivot.x, high) });
        found.push(Surface { left: Vec2::new(pivot.x, high), right: Vec2::new(pivot.x + half, low) });
    }
    // hazards cut out what is under them
    for zone in &geometry.hazards {
        let mut kept = Vec::new();
        for surface in found.drain(..) {
            let covered = surface.right.x > zone.low.x && surface.left.x < zone.high.x && {
                let y = surface.height(zone.low.x.max(surface.left.x).min(surface.right.x));
                y >= zone.low.y - 0.05 && y <= zone.high.y + 0.05
            };
            if !covered {
                kept.push(surface);
                continue;
            }
            if surface.left.x < zone.low.x {
                kept.push(Surface { left: surface.left, right: Vec2::new(zone.low.x, surface.height(zone.low.x)) });
            }
            if surface.right.x > zone.high.x {
                kept.push(Surface { left: Vec2::new(zone.high.x, surface.height(zone.high.x)), right: surface.right });
            }
        }
        found = kept;
    }
    found
}

/// Whether a body of this reach can get from the surface under x = `from` to any surface reaching
/// x = `to`.
pub fn possible(geometry: &Geometry, from: f32, to: f32, reach: &Reach) -> bool {
    let mut list = surfaces(geometry);
    // sorted by where each starts, so only near neighbours are looked at
    for i in 1..list.len() {
        let mut j = i;
        while j > 0 && list[j - 1].left.x > list[j].left.x {
            list.swap(j - 1, j);
            j -= 1;
        }
    }
    let widest = list.iter().fold(0.0f32, |widest, s| widest.max(s.right.x - s.left.x));
    let furthest = reach.leap * 2.0;
    let mut reached = alloc::vec![false; list.len()];
    let mut todo: Vec<usize> = Vec::new();
    // the start: the highest surface under it that is no higher than the start's ground
    if let Some(start) = (0..list.len()).filter(|&i| list[i].left.x <= from && list[i].right.x >= from && list[i].height(from) <= 0.05).max_by(|&i, &j| list[i].height(from).total_cmp(&list[j].height(from))) {
        reached[start] = true;
        todo.push(start);
    }
    while let Some(i) = todo.pop() {
        let here = list[i];
        if here.right.x >= to {
            return true;
        }
        let first = list.partition_point(|s| s.left.x < here.left.x - widest - furthest);
        for j in first..list.len() {
            let there = list[j];
            if there.left.x > here.right.x + furthest {
                break;
            }
            if reached[j] || there.right.x < here.left.x - furthest {
                continue;
            }
            // the nearest points of the two: across a gap between them, or, where one is over the
            // other, the end of the overlap that needs the smallest rise
            let (across, rise) = if there.left.x >= here.right.x {
                (there.left.x - here.right.x, there.left.y - here.right.y)
            } else if there.right.x <= here.left.x {
                (here.left.x - there.right.x, there.right.y - here.left.y)
            } else {
                let (a, b) = (here.left.x.max(there.left.x), here.right.x.min(there.right.x));
                (0.0, (there.height(a) - here.height(a)).min(there.height(b) - here.height(b)))
            };
            if reach.jumps(across, rise) {
                reached[j] = true;
                todo.push(j);
            }
        }
    }
    false
}

/// Whether a body of this reach can cross one piece, laid alone with level ground before it.
pub fn piece_possible(piece: &Piece, reach: &Reach) -> bool {
    let mut geometry = Geometry::default();
    geometry.ground.push(crate::physics::Segment { a: Vec2::new(-3.0, 0.0), b: Vec2::ZERO });
    let end = build(piece, Vec2::ZERO, &mut geometry);
    possible(&geometry, -2.0, end.x - 0.2, reach)
}
