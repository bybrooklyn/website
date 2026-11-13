//! What a world is made from. A world is described two ways, one made from the other:
//!
//! - a `Recipe`: six numbers, a seed, a difficulty from 0 to 1, and an amount from 0 (switched off)
//!   to 1 of each of four kinds of thing. A link carries these.
//! - a list of `Piece`s, each four numbers, laid one after another along the way: a kind, two sizes
//!   and the level ground that follows it. A recipe is planned into pieces (`Plan`), one at a time,
//!   for as far as anyone goes. A teacher that changes worlds will change these.
//!
//! Planning uses only plus, times and a seeded random generator, so the same recipe gives the same
//! pieces to the bit, natively and in every browser. What difficulty means is the `Table`, the
//! hardest each kind of piece can be at a difficulty; a piece is drawn at 60 to 100 percent of it.

use crate::learn::Random;

/// The four kinds of thing a world can have, as the page offers them.
pub const GROUND: usize = 0;
pub const HAZARDS: usize = 1;
pub const BOXES: usize = 2;
pub const MOVING: usize = 3;

/// How much level ground a planned stretch of nothing in particular weighs against each kind of
/// thing at its full amount: at amounts of 1 a piece is level ground 0.3 times in 4.3, so about 93
/// pieces in 100 are something.
const LEVEL_WEIGHT: f32 = 0.3;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Recipe {
    pub seed: u32,
    /// From 0, easy, to 1, as hard as the creature can do.
    pub difficulty: f32,
    /// How much of each kind of thing, from 0 (none) to 1: platforms, ledges, drops, stairs and gaps
    /// (`GROUND`), hazards (`HAZARDS`), things to push (`BOXES`) and things that move (`MOVING`).
    pub amounts: [f32; 4],
}

impl Recipe {
    /// The same recipe with every number kept within its range, and anything not a number made 0.
    pub fn clamped(self) -> Recipe {
        let unit = |x: f32| if x.is_nan() { 0.0 } else { x.clamp(0.0, 1.0) };
        Recipe { seed: self.seed, difficulty: unit(self.difficulty), amounts: self.amounts.map(unit) }
    }
}

/// What a piece is. The number of each is what a list of pieces carries.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// Level ground `a` metres long.
    Flat = 0,
    /// Ground `a` metres long rising `b` metres (falling if `b` is less than 0).
    Slope = 1,
    /// A gap `a` metres wide with no bottom, its far side `b` metres higher than its near side.
    Gap = 2,
    /// `a` steps (a whole number), each rising `b` metres (falling if less than 0), each `TREAD` long.
    Stairs = 3,
    /// A ledge `a` metres high to climb.
    Ledge = 4,
    /// A drop `a` metres down.
    Drop = 5,
    /// A gap with no bottom, crossed on two floating platforms, `a` metres apart and from each side,
    /// their tops `b` metres above the near side.
    Platforms = 6,
    /// A pool of water `a` metres wide, sunk into the ground.
    Water = 7,
    /// Spikes along the ground, `a` metres wide.
    Spikes = 8,
    /// A loose box to push or climb, `a` metres to each side of its middle.
    Box = 9,
    /// A ledge `a` metres high, too high to climb alone, with a loose box of half size `b` before it
    /// to push to its foot and climb on.
    BoxLedge = 10,
    /// A gap with no bottom `a` metres wide, with a platform going to and fro across it at up to `b`
    /// metres a second.
    Mover = 11,
    /// A see-saw: a plank `a` metres to each side of a pivot `b` metres up, one end on the ground.
    Seesaw = 12,
}

impl Kind {
    pub const ALL: [Kind; 13] = [Kind::Flat, Kind::Slope, Kind::Gap, Kind::Stairs, Kind::Ledge, Kind::Drop, Kind::Platforms, Kind::Water, Kind::Spikes, Kind::Box, Kind::BoxLedge, Kind::Mover, Kind::Seesaw];

    pub fn from_number(number: u32) -> Option<Kind> {
        Kind::ALL.get(number as usize).copied()
    }

    /// The kind of thing it is, as the page's switches have them, or None for level ground.
    pub fn group(self) -> Option<usize> {
        match self {
            Kind::Flat => None,
            Kind::Slope | Kind::Gap | Kind::Stairs | Kind::Ledge | Kind::Drop | Kind::Platforms => Some(GROUND),
            Kind::Water | Kind::Spikes => Some(HAZARDS),
            Kind::Box | Kind::BoxLedge => Some(BOXES),
            Kind::Mover | Kind::Seesaw => Some(MOVING),
        }
    }
}

/// One piece of a world: its kind, its two sizes (what each means is with `Kind`), and how much level
/// ground follows it before the next, in metres.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Piece {
    pub kind: Kind,
    pub a: f32,
    pub b: f32,
    pub run: f32,
}

impl Piece {
    pub const fn new(kind: Kind, a: f32, b: f32, run: f32) -> Piece {
        Piece { kind, a, b, run }
    }

    /// The piece as four numbers, its kind first, as a list of pieces is carried.
    pub fn numbers(&self) -> [f32; 4] {
        [self.kind as u32 as f32, self.a, self.b, self.run]
    }

    /// A piece back from four numbers, or None if the kind is not one, or a size is not a number.
    pub fn from_numbers(numbers: [f32; 4]) -> Option<Piece> {
        let kind = Kind::from_number(numbers[0] as u32)?;
        if numbers.iter().any(|x| !x.is_finite()) || numbers[0] < 0.0 || numbers[0] != (numbers[0] as u32) as f32 {
            return None;
        }
        Some(Piece::new(kind, numbers[1], numbers[2], numbers[3].clamp(0.5, 50.0)).sane())
    }

    /// The piece with its sizes kept to what can be built at all: nothing negative that cannot be,
    /// nothing absurdly large. Whether it can be crossed is for the checker to say.
    pub fn sane(self) -> Piece {
        let Piece { kind, a, b, run } = self;
        let (a, b) = match kind {
            Kind::Flat => (a.clamp(0.5, 50.0), 0.0),
            Kind::Slope => (a.clamp(1.0, 20.0), b.clamp(-0.6 * a.clamp(1.0, 20.0), 0.6 * a.clamp(1.0, 20.0))),
            Kind::Gap => (a.clamp(0.1, 4.0), b.clamp(-1.0, 1.0)),
            Kind::Stairs => ((a as u32).clamp(1, 8) as f32, b.clamp(-0.4, 0.4)),
            Kind::Ledge => (a.clamp(0.02, 1.5), 0.0),
            Kind::Drop => (a.clamp(0.02, 3.0), 0.0),
            Kind::Platforms => (a.clamp(0.1, 3.0), b.clamp(-0.5, 1.0)),
            Kind::Water | Kind::Spikes => (a.clamp(0.1, 4.0), 0.0),
            Kind::Box => (a.clamp(0.08, 0.4), 0.0),
            Kind::BoxLedge => (a.clamp(0.1, 1.5), b.clamp(0.08, 0.4)),
            Kind::Mover => (a.clamp(1.8, 6.0), b.clamp(0.1, 2.0)),
            Kind::Seesaw => (a.clamp(0.8, 2.5), b.clamp(0.1, 0.6)),
        };
        Piece { kind, a, b, run: run.clamp(0.5, 50.0) }
    }

    /// The piece made easier, for one that could not be crossed: its hard size brought down by a
    /// fifth toward the easiest.
    pub fn easier(self) -> Piece {
        let Piece { kind, a, b, run } = self;
        let piece = match kind {
            Kind::Flat => self,
            Kind::Slope => Piece { b: b * 0.8, ..self },
            Kind::Gap => Piece { a: a * 0.8, b: b * 0.8, ..self },
            Kind::Stairs => Piece { b: b * 0.8, ..self },
            Kind::Ledge | Kind::Drop | Kind::Water | Kind::Spikes => Piece { a: a * 0.8, ..self },
            Kind::Platforms => Piece { a: a * 0.8, b: b * 0.8, ..self },
            Kind::Box => self,
            Kind::BoxLedge => Piece { a: a * 0.85, b: b * 0.85, ..self },
            Kind::Mover => Piece { a: a * 0.85, ..self },
            Kind::Seesaw => Piece { b: b * 0.8, ..self },
        };
        Piece { run, ..piece }.sane()
    }
}

/// What difficulty means: the hardest each kind of piece is at a difficulty from 0 to 1. Each is a
/// straight line from its value at 0 to its value at 1. README.md gives the table.
pub struct Table;

impl Table {
    /// The widest gap, in metres.
    pub fn gap(d: f32) -> f32 {
        lerp(0.2, 0.6, d)
    }
    /// The most the far side of a gap is above or below the near side.
    pub fn gap_rise(d: f32) -> f32 {
        lerp(0.0, 0.08, d)
    }
    /// The tallest step of a stair.
    pub fn stair(d: f32) -> f32 {
        lerp(0.04, 0.12, d)
    }
    /// The most steps in a stair.
    pub fn stairs(d: f32) -> f32 {
        lerp(2.0, 6.0, d)
    }
    /// The highest ledge to climb with nothing to stand on.
    pub fn ledge(d: f32) -> f32 {
        lerp(0.08, 0.2, d)
    }
    /// The deepest drop.
    pub fn drop(d: f32) -> f32 {
        lerp(0.3, 1.2, d)
    }
    /// The steepest slope, as rise over run.
    pub fn slope(d: f32) -> f32 {
        lerp(0.08, 0.4, d)
    }
    /// How far apart floating platforms are, and the most they are above the ground before them.
    pub fn platform_gap(d: f32) -> f32 {
        lerp(0.25, 0.55, d)
    }
    pub fn platform_height(d: f32) -> f32 {
        lerp(0.03, 0.12, d)
    }
    /// The widest pool of water and the widest spikes.
    pub fn water(d: f32) -> f32 {
        lerp(0.25, 0.6, d)
    }
    pub fn spikes(d: f32) -> f32 {
        lerp(0.2, 0.55, d)
    }
    /// The biggest loose box, as half its size.
    pub fn box_half(d: f32) -> f32 {
        lerp(0.08, 0.1, d)
    }
    /// The highest ledge with a box before it.
    pub fn box_ledge(d: f32) -> f32 {
        lerp(0.25, 0.38, d)
    }
    /// The widest gap a moving platform crosses, and its fastest speed.
    pub fn mover(d: f32) -> f32 {
        lerp(2.0, 4.5, d)
    }
    pub fn mover_speed(d: f32) -> f32 {
        lerp(0.4, 1.0, d)
    }
    /// The highest pivot of a see-saw.
    pub fn seesaw(d: f32) -> f32 {
        lerp(0.12, 0.35, d)
    }
    /// The level ground after each piece, in metres: shorter is harder, as things come closer
    /// together. Drawn at 70 to 130 percent of this.
    pub fn run(d: f32) -> f32 {
        lerp(4.0, 1.6, d)
    }
}

fn lerp(low: f32, high: f32, t: f32) -> f32 {
    low + (high - low) * t
}

/// Plans a recipe into pieces, one at a time, for as far as anyone goes. The first piece follows
/// the start, level ground from behind the creature to a little ahead of it.
#[derive(Clone, Debug)]
pub struct Plan {
    pub recipe: Recipe,
    random: Random,
    /// The height the way is at, from the start, so a long run of ups or downs turns back.
    level: f32,
}

impl Plan {
    pub fn new(recipe: Recipe) -> Plan {
        let recipe = recipe.clamped();
        // the seed spread over all 64 bits, so seeds that differ by one give unrelated worlds
        let random = Random::new((recipe.seed as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15) ^ 0x6765_6e65_7261_6c69);
        Plan { recipe, random, level: 0.0 }
    }

    /// The next piece.
    pub fn piece(&mut self) -> Piece {
        let Recipe { difficulty: d, amounts, .. } = self.recipe;
        // pick a kind of thing by the amounts, against a fixed weight of level ground, then a piece
        // of that kind evenly
        let total = LEVEL_WEIGHT + amounts.iter().sum::<f32>();
        let mut pick = self.random.unit() * total - LEVEL_WEIGHT;
        let mut group = None;
        for (k, &amount) in amounts.iter().enumerate() {
            if pick >= 0.0 && pick < amount {
                group = Some(k);
                break;
            }
            pick -= amount;
        }
        let run = Table::run(d) * (0.7 + 0.6 * self.random.unit());
        let r = self.random.unit();
        // a piece is drawn at 60 to 100 percent of the hardest its kind is at this difficulty
        let hard = 0.6 + 0.4 * self.random.unit();
        let up_or_down = self.random.unit();
        let piece = match group {
            None => Piece::new(Kind::Flat, 2.0 + 4.0 * r, 0.0, run),
            Some(GROUND) => {
                // ups and downs lean back toward the start's height, so the way does not climb for ever
                let up = up_or_down < 0.5 - 0.15 * (self.level / 2.0).clamp(-1.0, 1.0);
                let sign = if up { 1.0 } else { -1.0 };
                match (r * 6.0) as u32 {
                    0 => {
                        let long = 2.0 + 3.0 * self.random.unit();
                        Piece::new(Kind::Slope, long, sign * long * Table::slope(d) * hard, run)
                    }
                    1 => Piece::new(Kind::Gap, Table::gap(d) * hard, sign * Table::gap_rise(d) * self.random.unit(), run),
                    2 => Piece::new(Kind::Stairs, (Table::stairs(d) * (0.5 + 0.5 * self.random.unit()) + 0.5) as u32 as f32, sign * Table::stair(d) * hard, run),
                    3 => Piece::new(Kind::Ledge, Table::ledge(d) * hard, 0.0, run),
                    4 => Piece::new(Kind::Drop, Table::drop(d) * hard, 0.0, run),
                    _ => Piece::new(Kind::Platforms, Table::platform_gap(d) * hard, Table::platform_height(d) * (self.random.unit() * 1.5 - 0.5), run),
                }
            }
            Some(HAZARDS) => {
                if r < 0.5 {
                    Piece::new(Kind::Water, Table::water(d) * hard, 0.0, run)
                } else {
                    Piece::new(Kind::Spikes, Table::spikes(d) * hard, 0.0, run)
                }
            }
            Some(BOXES) => {
                let half = Table::box_half(d) * (0.8 + 0.2 * self.random.unit());
                if r < 0.5 { Piece::new(Kind::Box, half, 0.0, run) } else { Piece::new(Kind::BoxLedge, Table::box_ledge(d) * hard, half, run) }
            }
            _ => {
                if r < 0.5 {
                    Piece::new(Kind::Mover, Table::mover(d) * hard, Table::mover_speed(d) * hard, run)
                } else {
                    Piece::new(Kind::Seesaw, 1.2 + 0.6 * self.random.unit(), Table::seesaw(d) * hard, run)
                }
            }
        }
        .sane();
        self.level += rise(&piece);
        piece
    }
}

/// How much higher the way is after a piece than before it.
pub fn rise(piece: &Piece) -> f32 {
    match piece.kind {
        Kind::Slope => piece.b,
        Kind::Gap => piece.b,
        Kind::Stairs => piece.a * piece.b,
        Kind::Ledge | Kind::BoxLedge => piece.a,
        Kind::Drop => -piece.a,
        _ => 0.0,
    }
}
