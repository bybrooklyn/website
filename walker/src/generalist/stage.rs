//! A world put into the physics around one creature, and kept there as it goes: the land's ground
//! and floating platforms laid ahead of it and dropped behind it, the things that are bodies (loose
//! boxes, moving platforms, see-saws) made as it comes near them and taken away once they are far
//! behind, the moving platforms driven along their ways, and the whole world moved back whenever the
//! creature passes 512 m, as the Walker's endless walk is, so an f32 stays fine however far it goes.
//!
//! Positions in the land are from the start; positions in the physics are less `origin`.

use alloc::rc::Rc;
use alloc::vec::Vec;

use super::land::{Hazard, Land, MOVER_HALF, PIVOT, PLANK};
use crate::math::Vec2;
use crate::physics::shape::Shape;
use crate::physics::{Body, Joint, STEP, World};

/// The land is laid this far ahead of the creature, a stretch at a time, and dropped once this far
/// behind it. Runs in training seldom go far enough to need more than the first stretch, so their
/// worlds share one ground and never copy it.
pub const AHEAD: f32 = 50.0;
pub const STRETCH: f32 = 30.0;
pub const BEHIND: f32 = 40.0;
/// Things that are bodies are made when the creature comes this near, and taken away this far behind.
pub const NEAR: f32 = 14.0;
pub const GONE: f32 = 16.0;
/// Whenever the creature passes this, everything moves back by it: a power of two, so nothing moves
/// by anything but whole metres, and nothing is lost.
pub const REBASE: f32 = 512.0;
/// The mass of a loose box, in kilograms for each square metre, and of a see-saw's plank.
const BOX_DENSITY: f32 = 30.0;
const PLANK_DENSITY: f32 = 40.0;
/// The mass of a moving platform while a hand holds it, in kilograms: heavy, so it lags the hand.
const MOVER_MASS: f32 = 15.0;
/// How far a see-saw tips either way, in radians.
const TIP: f32 = 0.6;

/// What sort of thing a body made from the land is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Thing {
    Loose,
    Mover,
    Seesaw,
}

/// A thing made from the land: which, its number in the land's list of that sort, and its body (for
/// a see-saw, the plank; its pivot is the body after). A box put down by a visitor is a loose box with
/// no number in the land (`usize::MAX`). A moving platform is `driven` along its way until a hand takes
/// it; then it is a heavy thing like any other while held, and stays where it was let go of.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Made {
    pub thing: Thing,
    pub index: usize,
    pub body: u32,
    pub driven: bool,
}

#[derive(Clone, Debug)]
pub struct Stage {
    pub world: World,
    pub land: Rc<Land>,
    /// How far the physics has been moved back from the land, in metres.
    pub origin: f32,
    /// The things made, in the order they were made.
    pub made: Vec<Made>,
    /// The next loose box, moving platform and see-saw of the land's lists to be made.
    next: [usize; 3],
    /// How far ahead the land's ground and blocks have been laid, in the land's metres, and how
    /// many of each have been laid.
    laid: f32,
    pieces: usize,
    blocks: usize,
}

impl Stage {
    /// The land's start, laid in a new world. The creature is built in it next, before anything else,
    /// so its bodies come first and never change places.
    pub fn new(land: Rc<Land>) -> Stage {
        let mut stage = Stage { world: World::new(), land, origin: 0.0, made: Vec::new(), next: [0; 3], laid: f32::MIN, pieces: 0, blocks: 0 };
        stage.lay(AHEAD);
        stage
    }

    /// Makes this stage the same as another, reusing the memory it has.
    pub fn copy_from(&mut self, other: &Stage) {
        self.world.copy_from(&other.world);
        if !Rc::ptr_eq(&self.land, &other.land) {
            self.land = other.land.clone();
        }
        self.origin = other.origin;
        self.made.clear();
        self.made.extend_from_slice(&other.made);
        self.next = other.next;
        self.laid = other.laid;
        self.pieces = other.pieces;
        self.blocks = other.blocks;
    }

    /// Lays the land's ground and blocks up to `until`, in the land's metres, making more land if it
    /// has not been made that far.
    fn lay(&mut self, until: f32) {
        if self.land.reached.x < until {
            Rc::make_mut(&mut self.land).extend(until);
        }
        let geometry = &self.land.geometry;
        let shift = Vec2::new(self.origin, 0.0);
        let more = geometry.ground[self.pieces..].iter().take_while(|piece| piece.a.x.min(piece.b.x) <= until).count();
        if more > 0 {
            let pieces: Vec<_> = geometry.ground[self.pieces..self.pieces + more].iter().map(|piece| crate::physics::Segment { a: piece.a - shift, b: piece.b - shift }).collect();
            if self.pieces == 0 { self.world.set_ground(&pieces) } else { self.world.extend_ground(&pieces) }
            self.pieces += more;
        }
        let more = geometry.blocks[self.blocks..].iter().take_while(|block| block.low.x <= until).count();
        if more > 0 {
            let blocks: Vec<_> = geometry.blocks[self.blocks..self.blocks + more].iter().map(|block| (block.low - shift, block.high - shift)).collect();
            self.world.add_blocks(&blocks);
            self.blocks += more;
        }
        self.laid = until;
    }

    /// Keeps the world around a creature whose body is at `x` in the physics: lays ahead, drops
    /// behind, makes and takes away things, and moves everything back past 512 m. Called before each
    /// step; returns how far the world was moved back, if it was.
    pub fn keep(&mut self, x: f32) -> f32 {
        let along = x + self.origin;
        if along + AHEAD > self.laid + STRETCH * 0.5 {
            self.lay(along + AHEAD + STRETCH);
            self.world.drop_ground_before(x - BEHIND);
        }
        self.make_near(along);
        self.take_far(x);
        let mut moved = 0.0;
        if x > REBASE {
            self.world.shift(REBASE);
            self.origin += REBASE;
            moved = REBASE;
        }
        self.drive();
        moved
    }

    /// Makes every thing the creature, at `along` in the land, has come near.
    fn make_near(&mut self, along: f32) {
        let land = Rc::clone(&self.land);
        let geometry = &land.geometry;
        while let Some(loose) = geometry.loose.get(self.next[0]).filter(|loose| loose.centre.x - loose.half < along + NEAR) {
            let mut body = Body::new(Shape::Box { half_width: loose.half, half_height: loose.half }, loose.centre - Vec2::new(self.origin, 0.0), 0.0, BOX_DENSITY);
            body.friction = 0.5;
            body.spin_damping = 0.5;
            let index = self.world.add_body(body);
            self.made.push(Made { thing: Thing::Loose, index: self.next[0], body: index, driven: false });
            self.next[0] += 1;
        }
        while let Some(mover) = geometry.movers.get(self.next[1]).filter(|mover| mover.left.x - MOVER_HALF.x < along + NEAR) {
            let at = Vec2::new(mover.left.x + mover.along(self.seconds()) - self.origin, mover.left.y);
            let mut body = Body::new(Shape::Box { half_width: MOVER_HALF.x, half_height: MOVER_HALF.y }, at, 0.0, 0.0);
            body.kinematic = true;
            body.friction = 0.9;
            let index = self.world.add_body(body);
            self.made.push(Made { thing: Thing::Mover, index: self.next[1], body: index, driven: true });
            self.next[1] += 1;
        }
        while let Some(seesaw) = geometry.seesaws.get(self.next[2]).filter(|seesaw| seesaw.pivot.x - seesaw.half < along + NEAR) {
            let pivot = seesaw.pivot - Vec2::new(self.origin, 0.0);
            let mut plank = Body::new(Shape::Box { half_width: seesaw.half, half_height: PLANK }, pivot, seesaw.resting(), PLANK_DENSITY);
            plank.friction = 0.9;
            plank.spin_damping = 1.0;
            // the pivot is a body that never moves, for the plank to hinge on; the two never touch
            let index = self.world.add_body(plank);
            let hub = self.world.add_body(Body::new(Shape::Circle { radius: PIVOT }, pivot, 0.0, 0.0));
            let mut joint = Joint::new(&self.world.bodies, hub, index, pivot);
            joint.limited = true;
            joint.lower = -TIP;
            joint.upper = TIP;
            self.world.add_joint(joint);
            self.made.push(Made { thing: Thing::Seesaw, index: self.next[2], body: index, driven: false });
            self.next[2] += 1;
        }
    }

    /// Takes away things far behind a creature at `x` in the physics.
    fn take_far(&mut self, x: f32) {
        let mut k = 0;
        while k < self.made.len() {
            let made = self.made[k];
            let body = &self.world.bodies[made.body as usize];
            let right = match made.thing {
                Thing::Loose => body.position.x + 0.5,
                Thing::Mover if !made.driven => body.position.x + MOVER_HALF.x,
                Thing::Mover => self.land.geometry.movers[made.index].left.x + self.land.geometry.movers[made.index].travel + MOVER_HALF.x - self.origin,
                Thing::Seesaw => body.position.x + self.land.geometry.seesaws[made.index].half,
            };
            if right > x - GONE {
                k += 1;
                continue;
            }
            // a see-saw's plank, then its pivot, which has slid into the plank's place
            let count = if made.thing == Thing::Seesaw { 2 } else { 1 };
            for _ in 0..count {
                self.world.remove_body(made.body);
            }
            self.made.remove(k);
            for later in &mut self.made {
                if later.body > made.body {
                    later.body -= count;
                }
            }
        }
    }

    /// Sets each moving platform's velocity to bring it to where it is to be at the end of the step.
    fn drive(&mut self) {
        let next = (self.world.steps + 1) as f32 * STEP;
        for made in self.made.iter().filter(|made| made.thing == Thing::Mover && made.driven) {
            let mover = &self.land.geometry.movers[made.index];
            let body = &mut self.world.bodies[made.body as usize];
            let target = mover.left.x + mover.along(next) - self.origin;
            body.velocity = Vec2::new((target - body.position.x) / STEP, 0.0);
        }
    }

    /// Puts a loose box of this half size with its middle at `at` in the physics, as a visitor would,
    /// and returns its body. It is taken away once far behind, as the land's boxes are.
    pub fn place_box(&mut self, at: Vec2, half: f32) -> u32 {
        let mut body = Body::new(Shape::Box { half_width: half, half_height: half }, at, 0.0, BOX_DENSITY);
        body.friction = 0.5;
        body.spin_damping = 0.5;
        let index = self.world.add_body(body);
        self.made.push(Made { thing: Thing::Loose, index: usize::MAX, body: index, driven: false });
        index
    }

    /// Readies a thing to be taken by a hand: a moving platform stops being driven along its way and
    /// becomes a heavy body that falls, collides and is pushed as any other. Anything else is as it was.
    pub fn take(&mut self, body: u32) {
        let world = &self.world;
        if let Some(made) = self.made.iter_mut().find(|made| made.body == body && made.thing == Thing::Mover && world.bodies[body as usize].kinematic) {
            made.driven = false;
            let platform = &mut self.world.bodies[body as usize];
            platform.kinematic = false;
            platform.velocity = Vec2::ZERO;
            platform.set_mass(MOVER_MASS);
        }
    }

    /// After a hand lets go of a thing: a moving platform it held stops where it is and stays there,
    /// as a floating platform does, and is no longer pushed by anything.
    pub fn let_go_of(&mut self, body: u32) {
        if self.made.iter().any(|made| made.body == body && made.thing == Thing::Mover && !made.driven) {
            let platform = &mut self.world.bodies[body as usize];
            platform.set_mass(0.0);
            platform.kinematic = true;
            platform.velocity = Vec2::ZERO;
            platform.spin = 0.0;
        }
    }

    /// The time since the world began, in seconds, which the moving platforms keep to.
    pub fn seconds(&self) -> f32 {
        self.world.steps as f32 * STEP
    }

    /// The hazard a box in the physics, given by its lowest and highest corners, is in, if any.
    pub fn hazard(&self, low: Vec2, high: Vec2) -> Option<Hazard> {
        let zones = &self.land.geometry.hazards;
        let (left, right) = (low.x + self.origin, high.x + self.origin);
        // zones are laid in order along the way and never overlap, so the search can start near
        let start = zones.partition_point(|zone| zone.high.x < left);
        zones[start..].iter().take_while(|zone| zone.low.x <= right).find(|zone| zone.low.y <= high.y && zone.high.y >= low.y).map(|zone| zone.hazard)
    }

    /// The lowest the world goes near x in the physics: falling below this is falling for ever.
    pub fn floor(&self, x: f32) -> f32 {
        let ground = self.world.ground();
        let start = ground.partition_point(|piece| piece.a.x < x - 10.0);
        ground[start..].iter().take_while(|piece| piece.a.x <= x + 10.0).fold(f32::MAX, |low, piece| low.min(piece.a.y).min(piece.b.y))
    }
}
