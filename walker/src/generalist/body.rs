//! The generalist's body: the Walker's two- or four-legged creature, a rounded body with eyes and
//! feet, with a hop added so it can jump a gap and get up a ledge, and arms held out for balance.
//!
//! Its legs move as a Walker's do: they keep a rhythm, each joint swinging to it as three of the
//! brain's numbers shape the swing. One number more is the hop. When it goes above a half with a foot
//! on the ground, the creature crouches, slowly enough that its feet stay down, then springs: every
//! knee straightens at once, more than twice as strong and quick as walking allows, while each hip
//! keeps the line from hip to foot where it should be, so the push goes through the body rather than
//! turning it. In the air its legs are held ready to land, leaning against any tip. Then it must land
//! and wait a moment before it can hop again. A frog's hop, decided by the brain and done by the body:
//! so a jump can be learned as one choice rather than found by chance among all the ways of moving
//! every joint.
//!
//! A hop kicks a body over unless it is hard to tip, so the two-legged one holds its arms out wide,
//! as someone on a tightrope does, and the four-legged one carries its weight spread along its back.
//! The arms are stiff, so they are counted as part of the body's weight, making it ten times as hard
//! to tip as a plain block of its size (three times for four legs); the page draws them. How each body
//! holds its legs in a hop was found by trying many ways (`body_tests`), keeping the steadiest that
//! went forward.

use alloc::vec::Vec;

use crate::body::{Creature, Description};
use crate::math::clamp;
use crate::physics::{STEP, World};

/// How long the crouch and the spring each last at most, in seconds, and how long after landing
/// before the next hop can start.
pub const CROUCH: f32 = 0.2;
pub const SPRING: f32 = 0.16;
pub const REST: f32 = 0.5;
/// How bent the knees are in the crouch, in the spring and in the air: less than 0 is bent.
const CROUCH_KNEE: f32 = -1.5;
const SPRING_KNEE: f32 = 0.0;
const AIR_KNEE: f32 = -0.3;
/// How much stronger and quicker the joints are in the spring than in walking, hips and knees alike.
const SPRING_TORQUE: f32 = 2.2;
const SPRING_SPEED: f32 = 22.0;
/// How quickly it crouches, in radians a second: no quicker than it can sink, so its feet stay down.
const CROUCH_SPEED: f32 = 5.0;
/// Newton metres and radians a second, as the Walker's joints have.
const HIP_TORQUE: f32 = 60.0;
const KNEE_TORQUE: f32 = 50.0;
const GAIN: f32 = 12.0;
const TOP_SPEED: f32 = 8.0;

/// How a body hops: how much harder its body is to tip than a plain block of its size; the line from
/// hip to foot in the crouch, the spring and the air, in radians (more than 0 is the foot ahead of the
/// hip); and how far that line turns for each radian the body tips, to push it back upright.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hopping {
    pub steadiness: f32,
    pub crouch: f32,
    pub spring: f32,
    pub air: f32,
    pub lean: f32,
}

impl Hopping {
    pub fn of(legs: u32) -> Hopping {
        if legs == 2 { Hopping { steadiness: 10.0, crouch: 0.2, spring: -0.3, air: 0.0, lean: 2.0 } } else { Hopping { steadiness: 3.0, crouch: -0.2, spring: 0.0, air: 0.3, lean: 2.0 } }
    }
}

/// Where a hop is.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Hop {
    /// Ready to hop when asked, once a foot is down.
    Ready,
    /// Crouching, then springing, with so long left of each.
    Crouch(f32),
    Spring(f32),
    /// Not ready again for so long.
    Resting(f32),
}

#[derive(Clone, Debug)]
pub struct Body {
    pub creature: Creature,
    pub hop: Hop,
    /// How it hops, which a test may change to try others.
    pub hopping: Hopping,
    /// Whether its actions aim each joint straight at an angle, rather than shaping its swing to the
    /// legs' rhythm (for learning by practice, which tries both).
    pub direct: bool,
    /// Aiming directly, how much of the way from where each joint is aimed now to where it is asked
    /// to be aimed it goes in a step of the physics: 1 at once, less to ease there, as a muscle does
    /// rather than a motor. A joint flung at each new angle the instant it is asked throws the body
    /// into the air; eased, it can step.
    pub ease: f32,
    /// Where each joint is aimed now, when aiming directly.
    pub aims: Vec<f32>,
    /// Aiming directly, how strong and how quick the joints are beside the Walker's: everyday
    /// muscles, which hold the body up and step but cannot throw it into the air. The hop keeps its
    /// own strength, so leaving the ground is a choice, made with the hop.
    pub strength: f32,
    /// Whether it feels the legs' rhythm; without, the rhythm's sine and cosine are felt as 0.
    pub clock: bool,
    /// Whether it feels touch (`touch::feel`): pressure on its body and feet, a hand holding it, and
    /// the jolt its body feels. Practice's creatures do; evolution's feel as they always did.
    pub touch: bool,
}

impl Body {
    /// A body of 2 or 4 legs, standing on the world's ground at x = 0.
    pub fn build(world: &mut World, legs: u32) -> Option<Body> {
        if legs != 2 && legs != 4 {
            return None;
        }
        let creature = Creature::build(world, Description { legs, carry: false, leap: false })?;
        let hopping = Hopping::of(legs);
        world.bodies[creature.torso as usize].inverse_inertia /= hopping.steadiness;
        Some(Body { creature, hop: Hop::Ready, hopping, direct: false, ease: 1.0, aims: Vec::new(), strength: 1.0, clock: true, touch: false })
    }

    pub fn legs(&self) -> usize {
        self.creature.legs.len()
    }

    /// How many numbers the brain gives it: three for each joint and one for the hop, or, direct, one
    /// for each joint and one for the hop.
    pub fn actions(&self) -> usize {
        if self.direct { self.creature.joints.len() + 1 } else { self.creature.description.outputs() + 1 }
    }

    /// Whether a foot is on something.
    pub fn footed(&self, world: &World) -> bool {
        self.creature.legs.iter().any(|leg| world.bodies[leg.lower as usize].touching)
    }

    /// Moves the joints as the brain asks, `actions()` numbers from -1 to 1.
    pub fn drive(&mut self, world: &mut World, actions: &[f32]) {
        let walking = self.actions() - 1;
        if self.direct {
            // each action from -1 to 1 is an angle from the joint's lower limit to its upper
            if self.aims.len() != walking {
                self.aims = self.creature.joints.iter().map(|&joint| world.joints[joint as usize].angle(&world.bodies)).collect();
            }
            for (i, &action) in actions.iter().enumerate().take(walking) {
                let joint = &world.joints[self.creature.joints[i] as usize];
                let wanted = joint.lower + 0.5 * (clamp(action, -1.0, 1.0) + 1.0) * (joint.upper - joint.lower);
                self.aims[i] += self.ease * (wanted - self.aims[i]);
                self.creature.aim(world, i, self.aims[i]);
                let joint = &mut world.joints[self.creature.joints[i] as usize];
                joint.torque *= self.strength;
                joint.speed *= self.strength;
            }
        } else {
            self.creature.drive(world, &actions[..walking]);
        }
        self.hop(world, clamp(actions[walking], -1.0, 1.0) > 0.5);
    }

    /// Moves the hop on, starting one if `wanted`, and while it lasts takes the legs over from
    /// whatever set them before.
    pub fn hop(&mut self, world: &mut World, wanted: bool) {
        self.hop = match self.hop {
            Hop::Ready if wanted && self.footed(world) => Hop::Crouch(CROUCH),
            Hop::Crouch(left) if left <= STEP * 0.5 => Hop::Spring(SPRING),
            Hop::Crouch(left) => Hop::Crouch(left - STEP),
            // the spring ends when its time is up, or once the feet have left the ground
            Hop::Spring(left) if left <= STEP * 0.5 || left < SPRING - 2.5 * STEP && !self.footed(world) => Hop::Resting(REST),
            Hop::Spring(left) => Hop::Spring(left - STEP),
            // it rests only once it has landed
            Hop::Resting(left) if left <= STEP * 0.5 => Hop::Ready,
            Hop::Resting(left) => Hop::Resting(if !self.creature.flying(world) { left - STEP } else { left }),
            ready => ready,
        };
        // in the air after a hop the legs are held ready to land, not swung, since swinging them
        // would turn the body; they lean it back upright instead
        let flying = matches!(self.hop, Hop::Resting(_)) && !self.footed(world);
        let (line, knee, strength, grip, top) = match self.hop {
            Hop::Crouch(_) => (self.hopping.crouch, CROUCH_KNEE, 1.0, 1.0, CROUCH_SPEED),
            Hop::Spring(_) => (self.hopping.spring, SPRING_KNEE, SPRING_TORQUE, SPRING_TORQUE, SPRING_SPEED),
            _ if flying => (self.hopping.air, AIR_KNEE, 1.0, 1.0, TOP_SPEED),
            _ => return,
        };
        // the hip is set by the line from hip to foot, not by the thigh, so the push goes through the
        // body rather than turning it; and it leans against any tip of the body, as a hopper does
        let tilt = world.bodies[self.creature.torso as usize].angle();
        for leg in 0..self.legs() {
            let (hip, bend) = (self.creature.joints[2 * leg], self.creature.joints[2 * leg + 1]);
            let (now, turning) = (world.joints[bend as usize].angle(&world.bodies), world.joints[bend as usize].angular_speed(&world.bodies));
            // the hip follows the knee as it moves, not only where it is, or it lags behind a quick
            // spring and the thigh drags the body over
            for (index, target, follow, torque) in [(bend, knee, 0.0, strength * KNEE_TORQUE), (hip, line + self.hopping.lean * tilt - 0.5 * now, -0.5 * turning, grip * HIP_TORQUE)] {
                let angle = world.joints[index as usize].angle(&world.bodies);
                let joint = &mut world.joints[index as usize];
                let target = clamp(target, joint.lower, joint.upper);
                joint.speed = clamp(GAIN * (target - angle) + follow, -top, top);
                joint.torque = torque;
            }
        }
    }

    /// How many numbers it feels of itself (`feel`): its body's angle, spin and speed forward and
    /// up; each joint's angle and speed; each foot on something or not; the rhythm's sine and
    /// cosine; and whether it is hopping and whether it can hop. Then, if it feels touch, what
    /// `touch::feel` writes after these.
    pub fn feelings(&self) -> usize {
        4 + 2 * self.creature.joints.len() + self.legs() + 2 + 2 + if self.touch { super::touch::felt(self.legs()) } else { 0 }
    }

    /// What it feels of itself, written into `into`, `feelings()` long, each about one at most.
    pub fn feel(&self, world: &World, into: &mut [f32]) {
        let torso = &world.bodies[self.creature.torso as usize];
        into[0] = torso.angle();
        into[1] = 0.2 * torso.spin;
        into[2] = 0.25 * torso.velocity.x;
        into[3] = 0.25 * torso.velocity.y;
        let mut at = 4;
        for &joint in &self.creature.joints {
            let joint = &world.joints[joint as usize];
            into[at] = joint.angle(&world.bodies);
            into[at + 1] = 0.1 * joint.angular_speed(&world.bodies);
            at += 2;
        }
        for leg in &self.creature.legs {
            into[at] = if world.bodies[leg.lower as usize].touching { 1.0 } else { 0.0 };
            at += 1;
        }
        let (s, c) = crate::math::sin_cos(2.0 * crate::math::PI * self.creature.phase(world));
        let felt = if self.clock { 1.0 } else { 0.0 };
        into[at] = felt * s;
        into[at + 1] = felt * c;
        into[at + 2] = if matches!(self.hop, Hop::Crouch(_) | Hop::Spring(_)) { 1.0 } else { 0.0 };
        into[at + 3] = if self.hop == Hop::Ready { 1.0 } else { 0.0 };
    }
}
