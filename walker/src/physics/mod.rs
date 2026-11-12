//! A small 2D physics engine for rigid bodies: circles, capsules and boxes, a ground made of straight
//! pieces, and hinges between bodies with limits and motors. It is written for the walking mini but
//! knows nothing about walking, so other minis can use it.
//!
//! The world moves in fixed steps of 1/60 s, each cut into substeps. In a substep every body falls a
//! little, the hinges and contacts each correct the bodies' speeds, the bodies move, and a second,
//! gentler pass takes out the speed the corrections added. This is Erin Catto's "soft step" from
//! Box2D 3. Pushes found in one step are applied again at the start of the next (warm starting), which
//! is what lets a jointed figure stand still. Everything happens in a fixed order with no clock and
//! no randomness, so a world stepped from the same start always ends in the same place, to the bit.
//!
//! Units are metres, kilograms and seconds, with y up and angles anticlockwise in radians.

pub mod cast;
pub mod collide;
pub mod contact;
pub mod joint;
pub mod shape;

#[cfg(not(feature = "creature"))]
pub mod api;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod world_tests;

use alloc::rc::Rc;
use alloc::vec::Vec;

use crate::math::{Rotation, Vec2, clamp};
use collide::{AHEAD, collide};
use contact::{BLOCK, Contact, GROUND};
pub use joint::Joint;
use joint::Pose;
use shape::{Outline, Shape};

/// How deep the ground is under each piece, in metres. Ground is solid on the right of each piece,
/// going from its first end to its second: below it, for pieces that run left to right.
pub const DEPTH: f32 = 1.0;

/// The length of one step, in seconds.
pub const STEP: f32 = 1.0 / 60.0;
/// The most steps one call to `advance` takes, so a page that was hidden for a while does not freeze
/// catching up.
const MOST_STEPS: u32 = 8;
/// Speed limits, in metres and radians a second, past which a body is surely broken, not moving.
const FASTEST: f32 = 100.0;
const FASTEST_SPIN: f32 = 60.0;

#[derive(Clone, Copy, Debug)]
pub struct Body {
    pub position: Vec2,
    pub rotation: Rotation,
    pub velocity: Vec2,
    /// Anticlockwise, in radians a second.
    pub spin: f32,
    pub shape: Shape,
    pub mass: f32,
    /// Zero for a body that never moves.
    pub inverse_mass: f32,
    pub inverse_inertia: f32,
    pub friction: f32,
    pub restitution: f32,
    /// Bodies in the same group, other than group 0, pass through each other, as the parts of one
    /// creature do.
    pub group: u32,
    /// How quickly the body's speed and spin die away by themselves, per second.
    pub damping: f32,
    pub spin_damping: f32,
    /// Whether the body rested on the ground, or on a body that never moves, in the last step.
    pub touching: bool,
    /// A body moved by its velocity and by nothing else, as a moving platform is: it carries what
    /// stands on it and is not pushed back. Its mass is zero, and whatever drives it sets its
    /// velocity before each step.
    pub kinematic: bool,
    outline: Outline,
}

impl Body {
    /// A body of the given shape and density, in kilograms a square metre. A density of zero makes a
    /// body that never moves.
    pub fn new(shape: Shape, position: Vec2, angle: f32, density: f32) -> Body {
        let mut body = Body {
            position,
            rotation: Rotation::from_angle(angle),
            velocity: Vec2::ZERO,
            spin: 0.0,
            shape,
            mass: 0.0,
            inverse_mass: 0.0,
            inverse_inertia: 0.0,
            friction: 0.6,
            restitution: 0.0,
            group: 0,
            damping: 0.0,
            spin_damping: 0.0,
            touching: false,
            kinematic: false,
            outline: shape.outline(),
        };
        body.set_mass(density * shape.area());
        body
    }

    /// Sets the mass in kilograms, and the inertia from it and the shape.
    pub fn set_mass(&mut self, mass: f32) {
        self.mass = mass;
        if mass > 0.0 {
            self.inverse_mass = 1.0 / mass;
            self.inverse_inertia = 1.0 / self.shape.inertia(mass);
        } else {
            self.inverse_mass = 0.0;
            self.inverse_inertia = 0.0;
        }
    }

    pub fn angle(&self) -> f32 {
        self.rotation.angle()
    }

    pub fn moves(&self) -> bool {
        self.inverse_mass > 0.0
    }

    /// The velocity of a point fixed to the body.
    pub fn velocity_at(&self, point: Vec2) -> Vec2 {
        self.velocity + (point - self.position).spun(self.spin)
    }

    /// The body's outline where it is now.
    pub fn placed(&self) -> Outline {
        self.outline.placed(self.position, self.rotation)
    }

    /// A sudden push at a point, in newton seconds, as from a hand or a hit.
    pub fn push(&mut self, at: Vec2, impulse: Vec2) {
        self.velocity += impulse * self.inverse_mass;
        self.spin += self.inverse_inertia * (at - self.position).cross(impulse);
    }

    /// How far a point is from the body's surface, less than zero inside it.
    pub fn distance_to(&self, point: Vec2) -> f32 {
        let outline = self.placed();
        collide::nearest_to(&outline, point).1 - outline.radius
    }
}

/// A straight piece of ground, solid for `DEPTH` below it. A piece that stands straight up, a riser,
/// is solid on its right going from `a` to `b`: from bottom to top for a step up.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Segment {
    pub a: Vec2,
    pub b: Vec2,
}

/// How soft a constraint is: the speed it closes a gap at, per metre of gap, and how much of a full
/// correction each pass makes. Worked out from a spring's frequency and damping, as Box2D does.
#[derive(Clone, Copy, Debug, Default)]
pub struct Soft {
    pub bias_rate: f32,
    pub mass_scale: f32,
    pub impulse_scale: f32,
}

impl Soft {
    pub fn new(hertz: f32, damping: f32, h: f32) -> Soft {
        let omega = 2.0 * crate::math::PI * hertz;
        let a1 = 2.0 * damping + h * omega;
        let a2 = h * omega * a1;
        let a3 = 1.0 / (1.0 + a2);
        Soft { bias_rate: omega / a1, mass_scale: a2 * a3, impulse_scale: a3 }
    }
}

/// The ground: its pieces, sorted by where each starts on the left, each piece's solid slab and the
/// box around it, worked out once rather than at every step, and the widest piece, to know how far
/// left of a body to start looking. Every world copied from another shares the other's ground, so a
/// generation of runs on the same course makes it once.
///
/// It holds static blocks too: boxes that never move, with tops, sides and undersides, as floating
/// platforms have. They are sorted the same way, each with its outline and its box, with the widest.
#[derive(Clone, Debug, Default)]
struct Ground {
    pieces: Vec<Segment>,
    slabs: Vec<(Outline, Vec2, Vec2)>,
    widest: f32,
    blocks: Vec<(Outline, Vec2, Vec2)>,
    widest_block: f32,
}

impl Ground {
    /// Works out every piece's slab and its box again.
    fn settle(&mut self) {
        self.slabs.clear();
        self.slabs.extend(self.pieces.iter().map(|piece| {
            let slab = Outline::slab(piece.a, piece.b, DEPTH);
            let (low, high) = slab.bounds(0.0);
            (slab, low, high)
        }));
    }
}

/// The length of a substep and how stiff contacts and hinges are in it, worked out once a step.
#[derive(Clone, Copy, Debug, Default)]
struct Stiffness {
    h: f32,
    inverse_h: f32,
    soft: Soft,
    hard: Soft,
    hinge: Soft,
}

#[derive(Clone, Debug, Default)]
pub struct World {
    pub bodies: Vec<Body>,
    pub joints: Vec<Joint>,
    pub gravity: Vec2,
    pub substeps: u32,
    /// The ground, shared by every copy of a world until one of them changes it.
    ground: Rc<Ground>,
    contacts: Vec<Contact>,
    last: Vec<Contact>,
    placed: Vec<Outline>,
    /// Each joint's pose where the bodies are now, worked out afresh whenever they move.
    poses: Vec<Pose>,
    /// How stiff contacts and hinges are in this step's substeps.
    stiffness: Stiffness,
    leftover: f32,
    /// Steps taken since the world was made.
    pub steps: u32,
    /// A clock for whatever drives the bodies to keep its own time by, in turns; the physics leaves
    /// it alone, and copies it with the rest.
    pub clock: f32,
}

impl World {
    pub fn new() -> World {
        World { gravity: Vec2::new(0.0, -10.0), substeps: 4, ..Default::default() }
    }

    /// Makes this world the same as another, reusing the memory it has. Training runs thousands of
    /// copies of one start, and this keeps that from allocating.
    pub fn copy_from(&mut self, other: &World) {
        fn copy<T: Copy>(into: &mut Vec<T>, from: &[T]) {
            into.clear();
            into.extend_from_slice(from);
        }
        copy(&mut self.bodies, &other.bodies);
        copy(&mut self.joints, &other.joints);
        if !Rc::ptr_eq(&self.ground, &other.ground) {
            self.ground = other.ground.clone();
        }
        copy(&mut self.contacts, &other.contacts);
        copy(&mut self.last, &other.last);
        self.placed.clear();
        self.gravity = other.gravity;
        self.substeps = other.substeps;
        self.leftover = other.leftover;
        self.steps = other.steps;
        self.clock = other.clock;
    }

    pub fn add_body(&mut self, body: Body) -> u32 {
        self.bodies.push(body);
        self.bodies.len() as u32 - 1
    }

    pub fn add_joint(&mut self, joint: Joint) -> u32 {
        self.joints.push(joint);
        self.joints.len() as u32 - 1
    }

    pub fn ground(&self) -> &[Segment] {
        &self.ground.pieces
    }

    /// Replaces the ground. The pieces may come in any order and need not join up.
    pub fn set_ground(&mut self, pieces: &[Segment]) {
        let ground = Rc::make_mut(&mut self.ground);
        ground.pieces.clear();
        for piece in pieces {
            // each piece runs left to right, so the sort and the search below need only its first end
            let piece = if piece.a.x <= piece.b.x { *piece } else { Segment { a: piece.b, b: piece.a } };
            ground.pieces.push(piece);
        }
        // sorted by inserting each piece in its place, which keeps pieces that start together in the
        // order given and needs no sorting code from the library
        let list = &mut ground.pieces;
        for i in 1..list.len() {
            let mut j = i;
            while j > 0 && list[j - 1].a.x > list[j].a.x {
                list.swap(j - 1, j);
                j -= 1;
            }
        }
        ground.widest = ground.pieces.iter().fold(0.0, |widest, piece| widest.max(piece.b.x - piece.a.x));
        ground.settle();
        self.last.clear();
    }

    /// Adds pieces of ground, for ground made ahead of a walker as it goes. Pieces further on than
    /// all the ground there is stay at the end, so the pieces already there keep their places.
    pub fn extend_ground(&mut self, pieces: &[Segment]) {
        let ground = Rc::make_mut(&mut self.ground);
        let list = &mut ground.pieces;
        for piece in pieces {
            let piece = if piece.a.x <= piece.b.x { *piece } else { Segment { a: piece.b, b: piece.a } };
            list.push(piece);
            let mut j = list.len() - 1;
            while j > 0 && list[j - 1].a.x > list[j].a.x {
                list.swap(j - 1, j);
                j -= 1;
            }
            ground.widest = ground.widest.max(piece.b.x - piece.a.x);
        }
        ground.settle();
    }

    /// Adds static blocks, each by its lowest and highest corners. Like ground they may come in any
    /// order, and blocks further on than all there are stay at the end, so those already there keep
    /// their places.
    pub fn add_blocks(&mut self, blocks: &[(Vec2, Vec2)]) {
        let ground = Rc::make_mut(&mut self.ground);
        for &(low, high) in blocks {
            let half = (high - low) * 0.5;
            let outline = Shape::Box { half_width: half.x, half_height: half.y }.outline().placed(low + half, Rotation::NONE);
            ground.blocks.push((outline, low, high));
            let list = &mut ground.blocks;
            let mut j = list.len() - 1;
            while j > 0 && list[j - 1].1.x > list[j].1.x {
                list.swap(j - 1, j);
                j -= 1;
            }
            ground.widest_block = ground.widest_block.max(high.x - low.x);
        }
    }

    /// The static blocks, each as its lowest and highest corners, in order of where each starts.
    pub fn blocks(&self) -> impl Iterator<Item = (Vec2, Vec2)> + '_ {
        self.ground.blocks.iter().map(|&(_, low, high)| (low, high))
    }

    /// Drops the pieces of ground and the blocks that end before x, for what is left behind. The
    /// contacts carried over to the next step are told the new places of the pieces they touch, so
    /// nothing loses its warm start.
    pub fn drop_ground_before(&mut self, x: f32) -> usize {
        let gone = self.ground.pieces.iter().take_while(|piece| piece.b.x < x).count();
        let blocks_gone = self.ground.blocks.iter().take_while(|block| block.2.x < x).count();
        if gone > 0 || blocks_gone > 0 {
            let ground = Rc::make_mut(&mut self.ground);
            ground.pieces.drain(..gone);
            ground.slabs.drain(..gone);
            ground.blocks.drain(..blocks_gone);
            for contact in self.contacts.iter_mut().filter(|contact| contact.b == GROUND) {
                contact.segment = if contact.segment & BLOCK != 0 { BLOCK | (contact.segment & !BLOCK).saturating_sub(blocks_gone as u32) } else { contact.segment.saturating_sub(gone as u32) };
            }
        }
        gone
    }

    /// Takes a body out of the world. The bodies after it move down a place, and the joints and
    /// contacts that name them are told so; the joints and contacts of the body taken out go with it.
    /// So a thing left far behind can be taken away without disturbing anything still going on.
    pub fn remove_body(&mut self, index: u32) {
        if index as usize >= self.bodies.len() {
            return;
        }
        self.bodies.remove(index as usize);
        let moved = |k: u32| if k > index && k != GROUND { k - 1 } else { k };
        self.joints.retain(|joint| joint.a != index && joint.b != index);
        for joint in &mut self.joints {
            joint.a = moved(joint.a);
            joint.b = moved(joint.b);
        }
        for list in [&mut self.contacts, &mut self.last] {
            list.retain(|contact| contact.a != index && contact.b != index);
            for contact in list.iter_mut() {
                contact.a = moved(contact.a);
                contact.b = moved(contact.b);
            }
        }
    }

    /// Moves everything `dx` to the left, to keep a walker that has gone far near the origin, where
    /// an f32 is finest. Shifting by a power of two near where things are loses nothing.
    pub fn shift(&mut self, dx: f32) {
        for body in &mut self.bodies {
            body.position.x -= dx;
        }
        let ground = Rc::make_mut(&mut self.ground);
        for piece in &mut ground.pieces {
            piece.a.x -= dx;
            piece.b.x -= dx;
        }
        // the slabs are worked out again from the moved pieces, as they always were at each step
        ground.settle();
        let left = Vec2::new(dx, 0.0);
        for (outline, low, high) in &mut ground.blocks {
            *low -= left;
            *high -= left;
            for corner in &mut outline.corners[..outline.count] {
                *corner -= left;
            }
        }
    }

    /// The height of the highest ground straight below or above x, if there is any there.
    pub fn ground_height(&self, x: f32) -> Option<f32> {
        let mut height: Option<f32> = None;
        for piece in self.ground_near(x, x) {
            if piece.a.x <= x && x <= piece.b.x {
                let span = piece.b.x - piece.a.x;
                let y = if span > 1e-6 { piece.a.y + (piece.b.y - piece.a.y) * (x - piece.a.x) / span } else { piece.a.y.max(piece.b.y) };
                height = Some(height.map_or(y, |h| h.max(y)));
            }
        }
        height
    }

    /// The pieces of ground that might reach between x = left and x = right.
    fn ground_near(&self, left: f32, right: f32) -> impl Iterator<Item = &Segment> {
        let ground = &self.ground;
        let start = ground.pieces.partition_point(|piece| piece.a.x < left - ground.widest);
        ground.pieces[start..].iter().take_while(move |piece| piece.a.x <= right).filter(move |piece| piece.b.x >= left)
    }

    /// Moves the world on by `seconds` of time, in whole steps, keeping what is left over for next
    /// time. Returns the number of steps taken.
    pub fn advance(&mut self, seconds: f32) -> u32 {
        self.leftover += seconds;
        let mut taken = 0;
        while self.leftover >= STEP && taken < MOST_STEPS {
            self.step();
            self.leftover -= STEP;
            taken += 1;
        }
        if taken == MOST_STEPS {
            self.leftover = 0.0;
        }
        taken
    }

    /// Moves the world on by one step of 1/60 s.
    pub fn step(&mut self) {
        World::step_together(core::slice::from_mut(self));
    }

    /// Moves several worlds on by one step each, as `step` would one at a time and to the same bit,
    /// but in lockstep: the hinges of one world are solved between those of the next, so the
    /// processor works on several worlds' chains of sums at once instead of waiting on one. The
    /// worlds share nothing, so how many go together never changes what happens in any of them.
    pub fn step_together(worlds: &mut [World]) {
        for world in worlds.iter_mut() {
            world.begin_step();
        }
        let substeps = worlds.iter().map(|world| world.substeps.max(1)).max().unwrap_or(0);
        let joints = worlds.iter().map(|world| world.joints.len()).max().unwrap_or(0);
        for substep in 0..substeps {
            let going = |world: &World| substep < world.substeps.max(1);
            for world in worlds.iter_mut().filter(|world| going(world)) {
                world.forces();
            }
            for joint in 0..joints {
                for world in worlds.iter_mut().filter(|world| going(world) && joint < world.joints.len()) {
                    world.solve_joint(joint, true);
                }
            }
            for world in worlds.iter_mut().filter(|world| going(world)) {
                world.solve_contacts(true);
                world.integrate();
            }
            for joint in 0..joints {
                for world in worlds.iter_mut().filter(|world| going(world) && joint < world.joints.len()) {
                    world.solve_joint(joint, false);
                }
            }
            for world in worlds.iter_mut().filter(|world| going(world)) {
                world.solve_contacts(false);
            }
        }
        for world in worlds.iter_mut() {
            let bodies = &mut world.bodies;
            for contact in &mut world.contacts {
                contact::bounce(bodies, contact);
            }
            world.steps += 1;
        }
    }

    /// The start of a step: what touches, how stiff things are, and the masses and poses the passes
    /// will need.
    fn begin_step(&mut self) {
        let h = STEP / self.substeps.max(1) as f32;
        let inverse_h = 1.0 / h;
        self.find_contacts();
        // contacts as stiff as a quarter of the substep rate allows, hinges twice as stiff, and
        // contacts against what never moves stiffer too, since only one side gives
        let contact_hertz = (0.25 * inverse_h).min(30.0);
        self.stiffness = Stiffness { h, inverse_h, soft: Soft::new(contact_hertz, 10.0, h), hard: Soft::new(2.0 * contact_hertz, 10.0, h), hinge: Soft::new(2.0 * contact_hertz, 2.0, h) };
        let bodies = &mut self.bodies;
        for contact in &mut self.contacts {
            contact::prepare(bodies, contact);
        }
        for joint in &mut self.joints {
            joint.prepare(bodies);
        }
        self.pose();
    }

    /// Works out every joint's pose where the bodies are. Poses change only when the bodies move,
    /// so one working out serves the gentle pass of one substep and the pushing pass of the next.
    fn pose(&mut self) {
        self.poses.clear();
        self.poses.extend(self.joints.iter().map(|joint| joint.pose(&self.bodies)));
    }

    /// Gravity and damping, then last step's pushes applied again.
    fn forces(&mut self) {
        let h = self.stiffness.h;
        let bodies = &mut self.bodies;
        for body in bodies.iter_mut().filter(|body| body.moves()) {
            body.velocity += self.gravity * h;
            body.velocity = body.velocity * (1.0 / (1.0 + h * body.damping));
            body.spin *= 1.0 / (1.0 + h * body.spin_damping);
            let speed = body.velocity.length();
            if speed > FASTEST {
                body.velocity = body.velocity * (FASTEST / speed);
            }
            body.spin = clamp(body.spin, -FASTEST_SPIN, FASTEST_SPIN);
        }
        for (joint, pose) in self.joints.iter().zip(&self.poses) {
            joint.warm_start(bodies, pose);
        }
        for contact in &self.contacts {
            contact::warm_start(bodies, contact);
        }
    }

    fn solve_joint(&mut self, index: usize, push: bool) {
        let Stiffness { h, hinge, .. } = self.stiffness;
        self.joints[index].solve(&mut self.bodies, &self.poses[index], hinge, h, push);
    }

    fn solve_contacts(&mut self, push: bool) {
        let Stiffness { inverse_h, soft, hard, .. } = self.stiffness;
        let bodies = &mut self.bodies;
        for contact in &mut self.contacts {
            let fixed = contact.b == GROUND || !bodies[contact.a as usize].moves() || !bodies[contact.b as usize].moves();
            contact::solve(bodies, contact, if fixed { hard } else { soft }, inverse_h, push);
        }
    }

    /// Moves the bodies at the speeds they now have, and works out the joints' poses again.
    fn integrate(&mut self) {
        let h = self.stiffness.h;
        for body in self.bodies.iter_mut().filter(|body| body.moves() || body.kinematic) {
            body.position += body.velocity * h;
            body.rotation = body.rotation.turned(h * body.spin);
        }
        self.pose();
    }

    /// Finds every pair that touches or is about to, and carries over last step's pushes for points
    /// found again.
    pub fn find_contacts(&mut self) {
        core::mem::swap(&mut self.contacts, &mut self.last);
        self.contacts.clear();
        self.placed.clear();
        for body in &mut self.bodies {
            self.placed.push(body.placed());
            body.touching = false;
        }
        let count = self.bodies.len();
        for a in 0..count {
            let (low_a, high_a) = self.placed[a].bounds(AHEAD);
            for b in a + 1..count {
                let (one, two) = (&self.bodies[a], &self.bodies[b]);
                if !one.moves() && !two.moves() || one.group != 0 && one.group == two.group || self.joined(a as u32, b as u32) {
                    continue;
                }
                let (low_b, high_b) = self.placed[b].bounds(0.0);
                if low_a.x > high_b.x || low_b.x > high_a.x || low_a.y > high_b.y || low_b.y > high_a.y {
                    continue;
                }
                let manifold = collide(&self.placed[a], &self.placed[b]);
                if manifold.count > 0 {
                    let contact = contact::begin(&self.bodies, a as u32, b as u32, 0, &manifold);
                    self.keep_contact(contact);
                }
            }
            if !self.bodies[a].moves() {
                continue;
            }
            // a slab can reach DEPTH to either side of its piece, under a riser
            // a second handle on the shared ground, so contacts can be kept while it is read
            let ground = Rc::clone(&self.ground);
            let start = ground.pieces.partition_point(|piece| piece.a.x < low_a.x - ground.widest - DEPTH);
            for index in start..ground.pieces.len() {
                let piece = ground.pieces[index];
                if piece.a.x - DEPTH > high_a.x {
                    break;
                }
                let (slab, low, high) = &ground.slabs[index];
                if high.x < low_a.x || low.x > high_a.x || low.y > high_a.y || high.y < low_a.y {
                    continue;
                }
                let manifold = collide(&self.placed[a], slab);
                if manifold.count > 0 {
                    let contact = contact::begin(&self.bodies, a as u32, GROUND, index as u32, &manifold);
                    self.keep_contact(contact);
                }
            }
            // and the static blocks, found the same way
            let start = ground.blocks.partition_point(|block| block.1.x < low_a.x - ground.widest_block);
            for index in start..ground.blocks.len() {
                let (block, low, high) = &ground.blocks[index];
                if low.x > high_a.x {
                    break;
                }
                if high.x < low_a.x || low.y > high_a.y || high.y < low_a.y {
                    continue;
                }
                let manifold = collide(&self.placed[a], block);
                if manifold.count > 0 {
                    let contact = contact::begin(&self.bodies, a as u32, GROUND, BLOCK | index as u32, &manifold);
                    self.keep_contact(contact);
                }
            }
        }
    }

    fn joined(&self, a: u32, b: u32) -> bool {
        self.joints.iter().any(|joint| joint.a == a && joint.b == b || joint.a == b && joint.b == a)
    }

    fn keep_contact(&mut self, mut contact: Contact) {
        let key = contact.key();
        if let Ok(found) = self.last.binary_search_by_key(&key, |old| old.key()) {
            let old = &self.last[found];
            for point in &mut contact.points[..contact.count] {
                if let Some(same) = old.points[..old.count].iter().find(|old| old.id == point.id) {
                    point.normal_impulse = same.normal_impulse;
                    point.tangent_impulse = same.tangent_impulse;
                }
            }
        }
        if contact.points[..contact.count].iter().any(|point| point.separation < 2.0 * collide::SLOP) {
            let fixed = contact.b == GROUND || !self.bodies[contact.b as usize].moves();
            let a_fixed = !self.bodies[contact.a as usize].moves();
            if fixed {
                self.bodies[contact.a as usize].touching = true;
            }
            if a_fixed && contact.b != GROUND {
                self.bodies[contact.b as usize].touching = true;
            }
        }
        self.contacts.push(contact);
    }

    /// The body nearest a point, and how far it is from the body's surface.
    pub fn nearest_body(&self, point: Vec2) -> Option<(u32, f32)> {
        let mut nearest: Option<(u32, f32)> = None;
        for (index, body) in self.bodies.iter().enumerate() {
            let distance = body.distance_to(point);
            if nearest.is_none_or(|(_, best)| distance < best) {
                nearest = Some((index as u32, distance));
            }
        }
        nearest
    }
}
