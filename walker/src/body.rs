//! The creature: a rounded body with one, two or four legs, each leg an upper and a lower part,
//! joined at the hip and the knee by hinges with motors, and a foot at the end of the lower part. It
//! says what it feels (`sense`) and moves its joints toward where the brain asks (`drive`).
//!
//! One leg is a hopper with a big foot. Two is a biped, its legs from the middle of a round body.
//! Four is an animal: a longer body with a front pair and a back pair. Seen from the side, the two
//! legs at one hip are a near leg and a far leg; they pass through each other and through the body,
//! as limbs drawn on paper do. The front is toward +x, where the eyes are drawn.
//!
//! A joint is driven toward a target angle, as a muscle pulls toward a pose: the motor turns at a
//! speed in proportion to how far off the angle is, up to a top speed and a top torque.

use alloc::vec::Vec;

use crate::math::{PI, Vec2, clamp, sin_cos};
use crate::physics::shape::Shape;
use crate::physics::{Body, Joint, STEP, World};

/// What a creature is built from.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Description {
    /// 1, 2 or 4.
    pub legs: u32,
    /// Whether a parcel rests on its back, to be carried.
    pub carry: bool,
    /// Whether its brain may quicken or slow the legs' rhythm, as a jumper needs to time its leaps.
    pub leap: bool,
}

impl Description {
    pub fn valid(&self) -> bool {
        matches!(self.legs, 1 | 2 | 4)
    }

    pub fn joints(&self) -> usize {
        2 * self.legs as usize
    }

    /// How many numbers `sense` gives: five for the body, two for each joint, one for each foot, two
    /// for the ground ahead, two for the rhythm's clock, and two for where the parcel is, if it
    /// carries one.
    pub fn senses(&self) -> usize {
        5 + 2 * self.joints() + self.legs as usize + 2 + 2 + if self.carry { 2 } else { 0 }
    }

    /// How many numbers the brain gives `drive`: three for each joint, which shape its swing, and, for
    /// a jumper with two or four legs, one that quickens or slows the rhythm.
    pub fn outputs(&self) -> usize {
        3 * self.joints() + usize::from(self.leap && self.legs > 1)
    }

    /// A stride to start from: steady values for the brain's outputs that make the legs walk with no
    /// feedback at all, measured once and written here. For four legs they are the average outputs of
    /// the best walker of a long training run, and walk 8.5 m in ten seconds; for two legs, whose
    /// average falls over, the best of four thousand strides tried at random, which walks 8.4 m. A
    /// brain that learns live starts here, so its first attempt already steps.
    pub fn stride(&self) -> &'static [f32] {
        match self.legs {
            2 => &[0.6, 0.88, 0.11, 0.39, 0.16, -0.02, -0.16, 0.81, 0.65, 0.62, -0.47, -0.75],
            4 => &[-0.2, 0.94, 0.49, 0.52, -0.6, -0.21, 0.29, -0.48, -0.03, 0.15, 0.16, -0.08, 0.81, 0.28, 0.42, -0.4, 0.18, -0.23, 0.28, 0.14, 0.18, -0.41, 0.6, -0.41],
            _ => &[],
        }
    }

    /// The rhythm the legs keep: how many strides a second, and where in the stride each leg starts,
    /// as a share of a turn. Two legs take turns; four trot, each diagonal pair together.
    pub fn rhythm(&self) -> (f32, &'static [f32]) {
        match self.legs {
            1 => (1.8, &[0.0]),
            2 => (1.2, &[0.0, 0.5]),
            _ => (1.6, &[0.0, 0.5, 0.5, 0.0]),
        }
    }

    /// The shape of the body and legs for this many legs.
    pub fn build(&self) -> Build {
        match self.legs {
            1 => Build { half_width: 0.26, half_height: 0.24, mass: 4.0, upper: 0.4, lower: 0.4, upper_radius: 0.065, foot: 0.075, hips: &[0.0], swing: &[0.15], knee: -0.3, leg_mass: 0.35, steadiness: 6.0, hip_drop: 0.0 },
            2 => Build { half_width: 0.27, half_height: 0.22, mass: 6.0, upper: 0.42, lower: 0.42, upper_radius: 0.06, foot: 0.05, hips: &[0.0, 0.0], swing: &[0.4, -0.1], knee: -0.3, leg_mass: 1.0, steadiness: 1.0, hip_drop: 0.55 },
            _ => Build { half_width: 0.5, half_height: 0.15, mass: 8.0, upper: 0.36, lower: 0.36, upper_radius: 0.055, foot: 0.045, hips: &[-0.36, -0.36, 0.36, 0.36], swing: &[0.4, -0.1, 0.4, -0.1], knee: -0.3, leg_mass: 1.0, steadiness: 1.0, hip_drop: 0.55 },
        }
    }
}

/// The proportions of a creature, in metres and kilograms.
#[derive(Clone, Copy, Debug)]
pub struct Build {
    pub half_width: f32,
    pub half_height: f32,
    pub mass: f32,
    /// The lengths of the upper and lower parts of a leg, from joint to joint and knee to foot.
    pub upper: f32,
    pub lower: f32,
    pub upper_radius: f32,
    /// The lower part's radius, which is the round of the foot that meets the ground.
    pub foot: f32,
    /// Where each hip is along the body, how far each leg swings forward to start, and the knees' bend.
    /// A leg swung forward 0.4 and one back 0.1, both knees bent 0.3, put their feet level and as far
    /// in front of the hip as behind it, so the stance is square.
    pub hips: &'static [f32],
    pub swing: &'static [f32],
    pub knee: f32,
    /// How heavy the legs are, as a share of a walker's: a hopper's leg is light, so swinging it in
    /// the air barely turns the body.
    pub leg_mass: f32,
    /// How much harder the body is to tip than a plain block of its size would be.
    pub steadiness: f32,
    /// How far below the body's middle the hips are, as a share of its half height. A hopper's hip
    /// is at its middle, so a push along its leg goes through its weight and does not tip it.
    pub hip_drop: f32,
}

const UPPER_MASS: f32 = 1.2;
const LOWER_MASS: f32 = 0.8;
/// A hip swings the leg from a little behind straight down to well in front, a knee bends backward.
const HIP_LIMITS: (f32, f32) = (-1.0, 1.3);
const KNEE_LIMITS: (f32, f32) = (-2.0, 0.0);
/// Newton metres. Enough to hold the body up in a deep crouch, not enough to throw it.
const HIP_TORQUE: f32 = 60.0;
const KNEE_TORQUE: f32 = 50.0;
/// How fast a joint turns for each radian it is from its target, and its top speed.
const GAIN: f32 = 12.0;
const TOP_SPEED: f32 = 8.0;
/// Where each joint swings about, and how far it may swing to each side, in radians. The hip swings
/// about a little in front of straight down, the knee about a gentle bend; neither may be sent past
/// what a leg does when it walks.
const HIP_SWING: (f32, f32, f32) = (0.1, 0.6, 0.6);
const KNEE_SWING: (f32, f32, f32) = (-0.6, 0.5, 0.6);
/// How much further a jumper's joints may swing than a walker's.
const LEAP_REACH: f32 = 1.6;
/// How firmly a hopper on the ground turns its body back toward upright, for each radian of tilt.
const HOP_LEAN: f32 = 3.0;
/// How much of its torque a hopper's hip uses while its foot is down.
const HOP_STANCE_GRIP: f32 = 0.15;
/// The parcel a carrier has on its back: a small box, which slides where a ball would roll away, its
/// half width and half height in metres, and its mass in kilograms.
const LOAD_HALF_WIDTH: f32 = 0.11;
const LOAD_RADIUS: f32 = 0.07;
const LOAD_MASS: f32 = 0.6;
/// The radius of each rim of a carrier's cupped back, in metres.
const RIM: f32 = 0.04;

/// Where the brain feels the ground ahead of the body, in metres.
const AHEAD: [f32; 2] = [0.6, 1.2];

#[derive(Clone, Copy, Debug)]
pub struct Leg {
    pub upper: u32,
    pub lower: u32,
}

#[derive(Clone, Debug)]
pub struct Creature {
    pub description: Description,
    pub torso: u32,
    pub legs: Vec<Leg>,
    /// The joints in order: the first leg's hip and knee, then the second's, and so on.
    pub joints: Vec<u32>,
    /// The angle each joint started at, which `hold` keeps.
    pub pose: Vec<f32>,
    pub start: Vec2,
    /// How high the body stood above the ground at the start.
    pub stand: f32,
    /// The parcel on its back, if it carries one.
    pub load: Option<u32>,
}

impl Creature {
    /// Builds the creature standing on the world's ground near x = 0, its feet just touching.
    pub fn build(world: &mut World, description: Description) -> Option<Creature> {
        if !description.valid() {
            return None;
        }
        let build = description.build();
        let legs = description.legs as usize;
        let group = world.bodies.len() as u32 + 1;

        // first laid out with the hips at height zero, low in the body, then lifted onto the ground
        let mut parts: Vec<Body> = Vec::new();
        let mut torso = Body::new(Shape::Box { half_width: build.half_width, half_height: build.half_height }, Vec2::new(0.0, build.half_height * build.hip_drop), 0.0, 1.0);
        torso.set_mass(build.mass);
        // a hopper carries its weight spread out, as a pogo rider holds the bar wide, so it is slow to tip
        torso.inverse_inertia /= build.steadiness;
        parts.push(torso);
        let mut hinges: Vec<(usize, usize, Vec2, (f32, f32), f32)> = Vec::new();
        for leg in 0..legs {
            let hip = Vec2::new(build.hips[leg], 0.0);
            let swing = build.swing[leg];
            // a leg straight down points at -pi/2; a hip angle swings the foot forward
            let down = |angle: f32| {
                let (s, c) = sin_cos(angle);
                Vec2::new(s, -c)
            };
            let along = down(swing);
            let knee_at = hip + along * build.upper;
            let mut upper = Body::new(Shape::Capsule { half: build.upper / 2.0, radius: build.upper_radius }, hip + along * (build.upper / 2.0), swing - PI / 2.0, 1.0);
            upper.set_mass(UPPER_MASS * build.leg_mass);
            let below = down(swing + build.knee);
            let mut lower = Body::new(Shape::Capsule { half: build.lower / 2.0, radius: build.foot }, knee_at + below * (build.lower / 2.0), swing + build.knee - PI / 2.0, 1.0);
            lower.set_mass(LOWER_MASS * build.leg_mass);
            lower.friction = 1.0;
            parts.push(upper);
            parts.push(lower);
            let index = parts.len();
            hinges.push((0, index - 2, hip, HIP_LIMITS, swing));
            hinges.push((index - 2, index - 1, knee_at, KNEE_LIMITS, build.knee));
        }

        // lift it so the lowest point of every part clears the ground under it
        let mut lift = f32::MIN;
        for part in &parts {
            let (low, high) = part.placed().bounds(0.0);
            for x in [low.x, 0.5 * (low.x + high.x), high.x] {
                let ground = world.ground_height(x).unwrap_or(0.0);
                lift = lift.max(ground - low.y);
            }
        }
        let lift = Vec2::new(0.0, lift + 0.005);

        let first = world.bodies.len() as u32;
        for mut part in parts {
            part.position += lift;
            part.group = group;
            part.spin_damping = 0.5;
            world.add_body(part);
        }
        let mut joints = Vec::new();
        let mut pose = Vec::new();
        for (a, b, at, (lower, upper), angle) in hinges {
            let (a, b) = (first + a as u32, first + b as u32);
            let mut joint = Joint::new(&world.bodies, a, b, at + lift);
            // the angle counts from the leg straight, whatever pose it was built in
            let straight = if a == first { crate::math::Rotation::from_angle(-PI / 2.0) } else { crate::math::Rotation::NONE };
            joint.rest = straight;
            joint.limited = true;
            joint.lower = lower;
            joint.upper = upper;
            joints.push(world.add_joint(joint));
            pose.push(angle);
        }
        let legs = (0..legs as u32).map(|leg| Leg { upper: first + 1 + 2 * leg, lower: first + 2 + 2 * leg }).collect();
        let start = world.bodies[first as usize].position;
        let stand = start.y - world.ground_height(start.x).unwrap_or(0.0);
        // a carrier's back is cupped: a small rim at each end, held to the body by a hinge that may not
        // turn, so a parcel slides between them rather than off
        if description.carry {
            let torso = world.bodies[first as usize];
            for side in [-1.0, 1.0] {
                let at = torso.position + Vec2::new(side * (build.half_width - RIM), build.half_height + RIM * 0.5);
                let mut rim = Body::new(Shape::Circle { radius: RIM }, at, 0.0, 1.0);
                rim.set_mass(0.05);
                rim.group = group;
                let index = world.add_body(rim);
                let mut joint = Joint::new(&world.bodies, first, index, at);
                joint.limited = true;
                world.add_joint(joint);
            }
        }
        // the parcel sits on the middle of its back; it is not one of the creature's parts, so the two touch
        let load = description.carry.then(|| {
            let mut ball = Body::new(Shape::Box { half_width: LOAD_HALF_WIDTH, half_height: LOAD_RADIUS }, Vec2::new(start.x, start.y + build.half_height + LOAD_RADIUS + 0.002), 0.0, 1.0);
            ball.set_mass(LOAD_MASS);
            ball.friction = 1.0;
            ball.spin_damping = 2.0;
            world.add_body(ball)
        });
        let creature = Creature { description, torso: first, legs, joints, pose, start, stand, load };
        creature.hold(world);
        Some(creature)
    }

    /// What the creature feels, written into `into`, which is `description.senses()` long. In order:
    /// the body's angle, its spin, its height above the ground, its speed forward and up; each joint's
    /// angle and speed; whether each foot is on the ground; how much higher the ground is 0.6 m and
    /// 1.2 m ahead than under the body; and a clock's sine and cosine. Each is scaled to be about one
    /// at most.
    pub fn sense(&self, world: &World, into: &mut [f32]) {
        let torso = &world.bodies[self.torso as usize];
        let under = world.ground_height(torso.position.x);
        let height = under.map_or(2.0, |ground| torso.position.y - ground);
        into[0] = torso.angle();
        into[1] = 0.2 * torso.spin;
        into[2] = clamp(height, 0.0, 2.0);
        into[3] = 0.25 * torso.velocity.x;
        into[4] = 0.25 * torso.velocity.y;
        let mut at = 5;
        for &joint in &self.joints {
            let joint = &world.joints[joint as usize];
            into[at] = joint.angle(&world.bodies);
            into[at + 1] = 0.1 * joint.angular_speed(&world.bodies);
            at += 2;
        }
        for leg in &self.legs {
            into[at] = if world.bodies[leg.lower as usize].touching { 1.0 } else { 0.0 };
            at += 1;
        }
        // a gap ahead feels like ground a metre down
        let level = under.unwrap_or(torso.position.y - self.stand);
        for ahead in AHEAD {
            let there = world.ground_height(torso.position.x + ahead).map_or(-1.0, |ground| clamp(ground - level, -1.0, 1.0));
            into[at] = there;
            at += 1;
        }
        let (s, c) = sin_cos(2.0 * PI * self.phase(world));
        into[at] = s;
        into[at + 1] = c;
        // where the parcel is from the middle of the back, in the body's own frame, by its size
        if let Some(load) = self.load {
            let build = self.description.build();
            let from = torso.rotation.undo(world.bodies[load as usize].position - torso.position);
            into[at + 2] = clamp(from.x / build.half_width, -2.0, 2.0);
            into[at + 3] = clamp((from.y - build.half_height - LOAD_RADIUS) / build.half_height, -2.0, 2.0);
        }
    }

    /// Whether the parcel has been dropped: fallen below the middle of the body, or off past its end.
    pub fn dropped(&self, world: &World) -> bool {
        let Some(load) = self.load else { return false };
        let torso = &world.bodies[self.torso as usize];
        let from = torso.rotation.undo(world.bodies[load as usize].position - torso.position);
        let build = self.description.build();
        from.y < 0.0 || from.x > build.half_width + 0.3 || from.x < -build.half_width - 0.3
    }

    /// Where the rhythm is, in turns since the start.
    pub fn phase(&self, world: &World) -> f32 {
        // a jumper's rhythm keeps its own clock, since it can be quickened or slowed; any other goes
        // at a steady pace from the start
        if self.description.outputs() > 3 * self.joints.len() { world.clock } else { self.description.rhythm().0 * STEP * world.steps as f32 }
    }

    /// Sets each joint's motor to follow a swing the brain shapes. Each joint swings like a pendulum
    /// in time with the rhythm, starting where its leg's place in the stride says; for each joint the
    /// brain gives three numbers from -1 to 1: where the swing is centred, how wide it is, and how far
    /// it is shifted in the stride. So the legs move in strides whatever the brain does, and evolution
    /// shapes the strides rather than inventing them.
    pub fn drive(&self, world: &mut World, outputs: &[f32]) {
        if self.legs.len() == 1 {
            return self.hop(world, outputs);
        }
        // the rhythm goes at half to one and a half times its pace, as the brain asks: slowed, a stride
        // can be timed to step over a gap rather than into it
        let (pace, starts) = self.description.rhythm();
        let leaping = self.description.outputs() > 3 * self.joints.len();
        if leaping {
            world.clock += STEP * pace * (1.0 + 0.5 * clamp(outputs[3 * self.joints.len()], -1.0, 1.0));
        }
        let phase = self.phase(world);
        for (i, &index) in self.joints.iter().enumerate() {
            let (centre, reach, widest) = if i % 2 == 0 { HIP_SWING } else { KNEE_SWING };
            // a jumper may swing further either way, to reach across a gap or gather itself for a leap
            let (reach, widest) = if leaping { (reach * LEAP_REACH, widest * LEAP_REACH) } else { (reach, widest) };
            let [middle, width, shift] = [0, 1, 2].map(|k| clamp(outputs[3 * i + k], -1.0, 1.0));
            let (s, _) = sin_cos(2.0 * PI * (phase + starts[i / 2]) + PI * shift);
            let joint = &world.joints[index as usize];
            let target = clamp(centre + reach * middle + widest * 0.5 * (width + 1.0) * s, joint.lower, joint.upper);
            self.aim(world, i, target);
        }
    }

    /// Drives a one-legged walker as a pogo stick is ridden. In the air the leg is folded to land and
    /// its foot put ahead of the body by as much as its speed needs, more if it is going faster than
    /// it wants to and less if slower, so that the next landing brakes or pushes it toward the speed
    /// it wants. On the ground the leg straightens to throw it up again, and the hip turns the body
    /// back toward upright, as a rider leans. So it hops whatever the brain does, and evolution
    /// shapes the hops: the brain's six numbers set the speed it wants, how hard the foot placement
    /// answers to speed, a trim to where the foot goes, how far the leg straightens and folds, and
    /// how firmly the body is held upright.
    fn hop(&self, world: &mut World, outputs: &[f32]) {
        let o = |k: usize| clamp(outputs[k], -1.0, 1.0);
        let torso = world.bodies[self.torso as usize];
        let leg = self.legs[0];
        let tilt = torso.angle();
        let hip = world.joints[self.joints[0] as usize].angle(&world.bodies);
        let knee = world.joints[self.joints[1] as usize].angle(&world.bodies);
        let grounded = world.bodies[leg.lower as usize].touching;
        let (hip_target, knee_target) = if grounded {
            // on the ground: give while the body still comes down, then straighten hard to throw it
            // up; and turn the body back toward upright, as a rider leans
            let lean = HOP_LEAN * (1.0 + 0.5 * o(5));
            let thrust = if torso.velocity.y < 0.0 { knee.min(-0.9 + 0.4 * o(4)) } else { -0.05 - 0.15 * (o(3) + 1.0) };
            // the line from hip to foot is what must stay put as the knee straightens, not the thigh,
            // or the push would spin the body; the knee's next step is allowed for as well
            let knee_speed = world.joints[self.joints[1] as usize].angular_speed(&world.bodies);
            let line = hip + 0.5 * knee;
            (line + lean * tilt + 0.1 * lean * torso.spin - 0.5 * (knee + knee_speed * STEP * 2.0), thrust)
        } else {
            // in the air: fold, and put the foot where the landing will set the speed right
            let wanted = 0.8 + 0.4 * o(0);
            let answer = 0.06 + 0.05 * o(1);
            let ahead = torso.velocity.x * 0.12 + answer * (torso.velocity.x - wanted);
            let along = clamp(ahead / (self.description.build().upper + self.description.build().lower), -0.6, 0.6);
            let angle = crate::math::atan2(along, crate::math::sqrt(1.0 - along * along)) + 0.15 * o(2);
            (angle - 0.5 * knee - tilt, -0.9 + 0.4 * o(4))
        };
        let (hip_joint, knee_joint) = (&world.joints[self.joints[0] as usize], &world.joints[self.joints[1] as usize]);
        let (hip_target, knee_target) = (clamp(hip_target, hip_joint.lower, hip_joint.upper), clamp(knee_target, knee_joint.lower, knee_joint.upper));
        self.aim(world, 0, hip_target);
        self.aim(world, 1, knee_target);
        // on the ground the hip is held only lightly: the push goes up the leg and through the body's
        // middle, and a hip held hard would turn it into a spin
        if grounded {
            world.joints[self.joints[0] as usize].torque *= HOP_STANCE_GRIP;
        }
    }

    /// Sets every joint's motor to hold the pose it was built in.
    pub fn hold(&self, world: &mut World) {
        for i in 0..self.joints.len() {
            self.aim(world, i, self.pose[i]);
        }
    }

    fn aim(&self, world: &mut World, i: usize, target: f32) {
        let index = self.joints[i] as usize;
        let angle = world.joints[index].angle(&world.bodies);
        let joint = &mut world.joints[index];
        // a hopper's knee is its spring: it may straighten twice as fast to throw the body up
        let top = if self.legs.len() == 1 && i == 1 { 2.0 * TOP_SPEED } else { TOP_SPEED };
        joint.speed = clamp(GAIN * (target - angle), -top, top);
        // a single leg has to throw the whole body up, so its knee is stronger
        let knee = if self.legs.len() == 1 { 1.8 * KNEE_TORQUE } else { KNEE_TORQUE };
        joint.torque = if i % 2 == 0 { HIP_TORQUE } else { knee };
    }

    /// The work the motors did in the last step, in joules, counting work done braking as well.
    pub fn effort(&self, world: &World) -> f32 {
        let h = STEP / world.substeps.max(1) as f32;
        let mut work = 0.0;
        for &joint in &self.joints {
            let joint = &world.joints[joint as usize];
            let power = joint.motor_torque(h) * joint.angular_speed(&world.bodies);
            work += if power < 0.0 { -power } else { power } * STEP;
        }
        work
    }

    /// How far the body has gone forward since it was built.
    pub fn distance(&self, world: &World) -> f32 {
        world.bodies[self.torso as usize].position.x - self.start.x
    }

    /// Whether the creature is down: its body on the ground, tipped over past about sixty degrees,
    /// or held lower than a third of its standing height. Scooting along on its side or its back is
    /// being down, though the body may not quite touch.
    pub fn fallen(&self, world: &World) -> bool {
        let torso = &world.bodies[self.torso as usize];
        let low = world.ground_height(torso.position.x).is_some_and(|ground| torso.position.y - ground < self.stand / 3.0);
        torso.touching || torso.rotation.cos < 0.5 || low
    }

    /// How many knees are on the ground: crawling, which is allowed but costs.
    pub fn kneeling(&self, world: &World) -> usize {
        self.legs.iter().filter(|leg| world.bodies[leg.upper as usize].touching).count()
    }

    /// Whether nothing of the creature touches anything: in the air.
    pub fn flying(&self, world: &World) -> bool {
        !world.bodies[self.torso as usize].touching && self.legs.iter().all(|leg| !world.bodies[leg.upper as usize].touching && !world.bodies[leg.lower as usize].touching)
    }

    /// Whether a foot is down where there is no ground to stand on: at the bottom or side of a gap.
    pub fn in_gap(&self, world: &World) -> bool {
        self.legs.iter().any(|leg| {
            let foot = &world.bodies[leg.lower as usize];
            foot.touching && world.ground_height(foot.position.x).is_none()
        })
    }

    /// How tall the body is held now, from 0 (low or tipped over) to 1 (as high as it stood, upright).
    pub fn tallness(&self, world: &World) -> f32 {
        let torso = &world.bodies[self.torso as usize];
        let Some(ground) = world.ground_height(torso.position.x) else { return 0.0 };
        let high = clamp((torso.position.y - ground - 0.5 * self.stand) / (0.5 * self.stand), 0.0, 1.0);
        high * torso.rotation.cos.max(0.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics::Segment;

    fn flat() -> World {
        let mut world = World::new();
        world.set_ground(&[Segment { a: Vec2::new(-50.0, 0.0), b: Vec2::new(50.0, 0.0) }]);
        world
    }

    #[test]
    fn a_two_legged_body_with_its_motors_holding_stands_for_five_seconds() {
        let mut world = flat();
        let creature = Creature::build(&mut world, Description { legs: 2, carry: false, leap: false }).unwrap();
        let start = world.bodies[creature.torso as usize].position;
        let mut settled = start;
        let mut senses = alloc::vec![0.0; creature.description.senses()];
        for step in 0..300 {
            creature.hold(&mut world);
            world.step();
            if step == 60 {
                settled = world.bodies[creature.torso as usize].position;
            }
            creature.sense(&world, &mut senses);
            assert!(senses.iter().all(|value| value.is_finite()));
        }
        let torso = world.bodies[creature.torso as usize];
        assert!(!creature.fallen(&world), "the torso is on the ground");
        assert!((torso.position.x - start.x).abs() < 0.02, "drifted {} sideways", torso.position.x - start.x);
        assert!((torso.position - settled).length() < 0.002, "still moving after settling: {}", (torso.position - settled).length());
        assert!(torso.angle().abs() < 0.02, "leans {}", torso.angle());
        assert!(torso.position.y > 0.8, "sank to {}", torso.position.y);
        assert!(torso.velocity.length() < 0.01 && torso.spin.abs() < 0.01);
        for (i, &joint) in creature.joints.iter().enumerate() {
            let angle = world.joints[joint as usize].angle(&world.bodies);
            assert!((angle - creature.pose[i]).abs() < 0.05, "joint {i} at {angle}, not {}", creature.pose[i]);
        }
        assert!(creature.legs.iter().all(|leg| world.bodies[leg.lower as usize].touching), "both feet are down");
        assert!(creature.tallness(&world) > 0.95, "stands as tall as it was built");
        assert!(!creature.flying(&world) && !creature.in_gap(&world) && creature.kneeling(&world) == 0);
    }

    #[test]
    fn a_four_legged_body_stands_and_a_one_legged_body_is_built() {
        let mut world = flat();
        let creature = Creature::build(&mut world, Description { legs: 4, carry: false, leap: false }).unwrap();
        for _ in 0..300 {
            creature.hold(&mut world);
            world.step();
        }
        assert!(!creature.fallen(&world));
        assert!(world.bodies[creature.torso as usize].velocity.length() < 0.01);
        assert_eq!(creature.description.senses(), 29);
        let mut world = flat();
        assert!(Creature::build(&mut world, Description { legs: 1, carry: false, leap: false }).is_some());
        assert!(Creature::build(&mut world, Description { legs: 3, carry: false, leap: false }).is_none());
    }

    #[test]
    fn no_foot_sinks_into_the_ground_under_a_heavy_landing() {
        // dropped from half a metre up, every foot comes to rest on the ground, not in it
        for legs in [1, 2, 4] {
            let mut world = flat();
            let creature = Creature::build(&mut world, Description { legs, carry: false, leap: false }).unwrap();
            for body in &mut world.bodies {
                body.position.y += 0.5;
            }
            let mut deepest: f32 = 0.0;
            for _ in 0..240 {
                creature.hold(&mut world);
                world.step();
                for leg in &creature.legs {
                    let foot = &world.bodies[leg.lower as usize];
                    let lowest = foot.placed().bounds(0.0).0.y;
                    deepest = deepest.min(lowest);
                }
            }
            assert!(deepest > -0.02, "{legs} legs: a foot went {deepest} m into the ground");
        }
    }
}
