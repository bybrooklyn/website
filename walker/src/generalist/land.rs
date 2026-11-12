//! A world's pieces built into what the physics and the eyes need: ground (straight pieces, as the
//! Walker's, with risers for steps, ledges and the sides of gaps), static blocks (floating
//! platforms), hazards (water and spikes, which end a run), and the things that are bodies: loose
//! boxes, platforms that go to and fro, and see-saws.
//!
//! A `Land` is built a piece at a time, as far ahead as asked, so a world has no end. Before a piece
//! is laid it is checked (`check::piece_possible`), and a piece that a body of the creature's reach
//! could not cross is made easier until it can be, or replaced by level ground. So every world can be
//! crossed from its start to as far as it has been made.
//!
//! Units are metres with y up. The creature starts at x = 0 on level ground at height 0.

use alloc::vec::Vec;

use super::check::{self, REACH, Reach};
use super::recipe::{Kind, Piece, Plan, Recipe};
use crate::math::{Vec2, sqrt};
use crate::physics::Segment;

/// The level ground the creature starts on, from behind it to a little ahead of it.
pub const START_BEHIND: f32 = 12.0;
pub const START_AHEAD: f32 = 4.0;
/// How deep the sides of a gap go. Below them is nothing: falling in is the end of a run.
pub const PIT: f32 = 2.0;
/// How long each step of a stair is.
pub const TREAD: f32 = 0.8;
/// A floating platform's width and thickness.
pub const STONE: f32 = 1.0;
pub const STONE_THICK: f32 = 0.25;
/// How deep a pool is, and how far below the ground its water stands.
pub const WATER_DEPTH: f32 = 0.6;
pub const WATER_LOW: f32 = 0.12;
/// How tall spikes are.
pub const SPIKE_HEIGHT: f32 = 0.12;
/// A moving platform's half width and half height, and the room it leaves at each side of its gap.
pub const MOVER_HALF: Vec2 = Vec2::new(0.6, 0.1);
pub const MOVER_CLEAR: f32 = 0.12;
/// A see-saw plank's half thickness, and its pivot's radius.
pub const PLANK: f32 = 0.05;
pub const PIVOT: f32 = 0.06;

/// A static box, by its lowest and highest corners.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Block {
    pub low: Vec2,
    pub high: Vec2,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Hazard {
    Water,
    Spikes,
}

/// A place that ends a run when any part of the creature is in it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Zone {
    pub low: Vec2,
    pub high: Vec2,
    pub hazard: Hazard,
}

/// A loose box, by where its middle starts and half its size.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Loose {
    pub centre: Vec2,
    pub half: f32,
}

/// A platform that goes to and fro along a line, by where its middle is at the left end, how far it
/// goes, and its top speed. It is at the left at time 0 and eases to the right and back, as a
/// pendulum swings.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mover {
    pub left: Vec2,
    pub travel: f32,
    pub speed: f32,
}

impl Mover {
    /// How far right of `left` its middle is at a time, in seconds.
    pub fn along(&self, seconds: f32) -> f32 {
        let omega = 2.0 * self.speed / self.travel;
        0.5 * self.travel * (1.0 - crate::math::sin_cos(omega * seconds).1)
    }
}

/// A see-saw, by its pivot and the plank's half length. Its left end starts on the ground.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Seesaw {
    pub pivot: Vec2,
    pub half: f32,
    /// The height of the ground under it.
    pub ground: f32,
}

impl Seesaw {
    /// The plank's angle when its left end rests on the ground.
    pub fn resting(&self) -> f32 {
        let rise = (self.pivot.y - self.ground - PLANK) / self.half;
        crate::math::atan2(rise, sqrt((1.0 - rise * rise).max(0.0)))
    }
}

/// Everything built from a world's pieces, each list in order along the way.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Geometry {
    pub ground: Vec<Segment>,
    pub blocks: Vec<Block>,
    pub hazards: Vec<Zone>,
    pub loose: Vec<Loose>,
    pub movers: Vec<Mover>,
    pub seesaws: Vec<Seesaw>,
}

/// Builds one piece starting at `at` (where the way is, and its height), into `into`, and returns
/// where the way is after it and the level ground that follows.
pub fn build(piece: &Piece, at: Vec2, into: &mut Geometry) -> Vec2 {
    let Piece { kind, a, b, run } = *piece;
    let (x, y) = (at.x, at.y);
    let mut line = |x1: f32, y1: f32, x2: f32, y2: f32| into.ground.push(Segment { a: Vec2::new(x1, y1), b: Vec2::new(x2, y2) });
    // a riser is solid on the higher side whichever way it is laid, from where the way is to where it goes
    let end = match kind {
        Kind::Flat => {
            line(x, y, x + a, y);
            Vec2::new(x + a, y)
        }
        Kind::Slope => {
            line(x, y, x + a, y + b);
            Vec2::new(x + a, y + b)
        }
        Kind::Gap => {
            line(x, y, x, y - PIT);
            line(x + a, y + b - PIT, x + a, y + b);
            Vec2::new(x + a, y + b)
        }
        Kind::Stairs => {
            let mut at = Vec2::new(x, y);
            for _ in 0..a as u32 {
                line(at.x, at.y, at.x, at.y + b);
                line(at.x, at.y + b, at.x + TREAD, at.y + b);
                at = Vec2::new(at.x + TREAD, at.y + b);
            }
            at
        }
        Kind::Ledge => {
            line(x, y, x, y + a);
            Vec2::new(x, y + a)
        }
        Kind::Drop => {
            line(x, y, x, y - a);
            Vec2::new(x, y - a)
        }
        Kind::Platforms => {
            let wide = 3.0 * a + 2.0 * STONE;
            line(x, y, x, y - PIT);
            line(x + wide, y - PIT, x + wide, y);
            for k in 0..2 {
                let left = x + a + k as f32 * (a + STONE);
                into.blocks.push(Block { low: Vec2::new(left, y + b - STONE_THICK), high: Vec2::new(left + STONE, y + b) });
            }
            Vec2::new(x + wide, y)
        }
        Kind::Water => {
            line(x, y, x, y - WATER_DEPTH);
            line(x, y - WATER_DEPTH, x + a, y - WATER_DEPTH);
            line(x + a, y - WATER_DEPTH, x + a, y);
            into.hazards.push(Zone { low: Vec2::new(x, y - WATER_DEPTH), high: Vec2::new(x + a, y - WATER_LOW), hazard: Hazard::Water });
            Vec2::new(x + a, y)
        }
        Kind::Spikes => {
            line(x, y, x + a, y);
            into.hazards.push(Zone { low: Vec2::new(x, y), high: Vec2::new(x + a, y + SPIKE_HEIGHT), hazard: Hazard::Spikes });
            Vec2::new(x + a, y)
        }
        Kind::Box => {
            let long = 1.0 + 2.0 * a;
            line(x, y, x + long, y);
            into.loose.push(Loose { centre: Vec2::new(x + 0.5 + a, y + a), half: a });
            Vec2::new(x + long, y)
        }
        Kind::BoxLedge => {
            let long = 0.8 + 2.0 * b + 1.6;
            line(x, y, x + long, y);
            line(x + long, y, x + long, y + a);
            into.loose.push(Loose { centre: Vec2::new(x + 0.8 + b, y + b), half: b });
            Vec2::new(x + long, y + a)
        }
        Kind::Mover => {
            line(x, y, x, y - PIT);
            line(x + a, y - PIT, x + a, y);
            let travel = a - 2.0 * (MOVER_CLEAR + MOVER_HALF.x);
            into.movers.push(Mover { left: Vec2::new(x + MOVER_CLEAR + MOVER_HALF.x, y - MOVER_HALF.y), travel, speed: b });
            Vec2::new(x + a, y)
        }
        Kind::Seesaw => {
            let long = 2.0 * a + 1.0;
            line(x, y, x + long, y);
            into.seesaws.push(Seesaw { pivot: Vec2::new(x + 0.5 + a, y + b), half: a, ground: y });
            Vec2::new(x + long, y)
        }
    };
    into.ground.push(Segment { a: end, b: Vec2::new(end.x + run, end.y) });
    Vec2::new(end.x + run, end.y)
}

/// A world, built as far as it has been asked for.
#[derive(Clone, Debug)]
pub struct Land {
    pub geometry: Geometry,
    /// The pieces laid so far, after any were made easier, and where each starts.
    pub pieces: Vec<Piece>,
    pub starts: Vec<Vec2>,
    /// Where the way is after the last piece, and its height.
    pub reached: Vec2,
    /// How many times a piece had to be made easier to be crossed, and how many were given up and
    /// laid as level ground instead.
    pub eased: u32,
    pub replaced: u32,
    /// Where pieces come from: a recipe's plan, or a list given whole, after which the way is level.
    plan: Option<Plan>,
    given: Vec<Piece>,
    /// The reach pieces are checked against, or none, to lay them as given.
    reach: Option<Reach>,
}

impl Land {
    /// A world planned from a recipe, built to `until` metres.
    pub fn new(recipe: Recipe, until: f32) -> Land {
        let mut land = Land::empty(Some(Plan::new(recipe)), Vec::new());
        land.extend(until);
        land
    }

    /// A world from a list of pieces, then level ground, built to `until` metres.
    pub fn from_pieces(pieces: &[Piece], until: f32) -> Land {
        let mut given: Vec<Piece> = pieces.iter().map(|piece| piece.sane()).collect();
        given.reverse();
        let mut land = Land::empty(None, given);
        land.extend(until);
        land
    }

    /// A world from a list of pieces laid exactly as given, crossable or not, then level ground: for
    /// measuring what the body can do.
    pub fn from_pieces_unchecked(pieces: &[Piece], until: f32) -> Land {
        let mut given: Vec<Piece> = pieces.iter().map(|piece| piece.sane()).collect();
        given.reverse();
        let mut land = Land::empty(None, given);
        land.reach = None;
        land.extend(until);
        land
    }

    fn empty(plan: Option<Plan>, given: Vec<Piece>) -> Land {
        let mut geometry = Geometry::default();
        geometry.ground.push(Segment { a: Vec2::new(-START_BEHIND, 0.0), b: Vec2::new(START_AHEAD, 0.0) });
        Land { geometry, pieces: Vec::new(), starts: Vec::new(), reached: Vec2::new(START_AHEAD, 0.0), eased: 0, replaced: 0, plan, given, reach: Some(REACH) }
    }

    /// Lays pieces until the way reaches at least `until` metres.
    pub fn extend(&mut self, until: f32) {
        while self.reached.x < until {
            let wanted = match (&mut self.plan, self.given.pop()) {
                (_, Some(piece)) => piece,
                (Some(plan), None) => plan.next(),
                (None, None) => Piece::new(Kind::Flat, 10.0, 0.0, 0.5),
            };
            let piece = self.crossable(wanted);
            self.starts.push(self.reached);
            self.pieces.push(piece);
            self.reached = build(&piece, self.reached, &mut self.geometry);
        }
    }

    /// The piece, or the piece made easier until a body of the creature's reach can cross it, or
    /// level ground if it never can be.
    fn crossable(&mut self, mut piece: Piece) -> Piece {
        let Some(reach) = self.reach else { return piece };
        for _ in 0..10 {
            if check::piece_possible(&piece, &reach) {
                return piece;
            }
            piece = piece.easier();
            self.eased += 1;
        }
        self.replaced += 1;
        Piece::new(Kind::Flat, 3.0, 0.0, piece.run)
    }

    /// The piece that the way is in at x, if any has been laid there.
    pub fn piece_at(&self, x: f32) -> Option<usize> {
        let after = self.starts.partition_point(|start| start.x <= x);
        (after > 0 && x < self.reached.x).then(|| after - 1)
    }
}
