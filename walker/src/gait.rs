//! How natural a walker's run looks, in numbers, for the tests to hold it to. A run is watched step
//! by step and summed up: how much of it the body is carried upright and high, how often the feet
//! take turns as a walk or a trot has them, how regular the strides are, how far it went, and how
//! hard it worked.

use alloc::vec::Vec;

use crate::body::Creature;
use crate::physics::{STEP, World};

/// The body counts as carried well when it leans less than this, in radians, and stands higher than
/// this share of the height it was built at.
pub const UPRIGHT: f32 = 0.35;
pub const HIGH: f32 = 0.7;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Gait {
    /// The share of the run with the body upright and high.
    pub upright: f32,
    /// Two legs: the share with exactly one foot down. Four legs: the share with one diagonal pair
    /// down and the other pair up (a trot). One leg: the share with the foot down.
    pub turns: f32,
    /// How much the time between one foot's landings varies, as its spread over its mean: 0 is a
    /// metronome. Over 1 when there are too few landings to say.
    pub variation: f32,
    /// Landings of the first foot in the run.
    pub strides: usize,
    pub distance: f32,
    /// Motor work per second, in watts.
    pub effort: f32,
    /// The share of the run with anything but a foot on the ground.
    pub dragging: f32,
}

/// Whether the body is carried upright and high.
pub fn carried(creature: &Creature, world: &World) -> bool {
    let torso = &world.bodies[creature.torso as usize];
    let height = world.ground_height(torso.position.x).map_or(0.0, |ground| torso.position.y - ground);
    let lean = torso.angle();
    lean < UPRIGHT && lean > -UPRIGHT && height > HIGH * creature.stand
}

/// Whether the feet are taking turns: for two legs exactly one foot is down, and for four one
/// diagonal pair is down and the other up, as in a trot. One leg has nothing to take turns with, so
/// it hops in time: its foot down in the second half of each stride and up in the first.
pub fn taking_turns(creature: &Creature, world: &World) -> bool {
    let down = |leg: usize| world.bodies[creature.legs[leg].lower as usize].touching;
    match creature.legs.len() {
        1 => {
            let (s, _) = crate::math::sin_cos(2.0 * crate::math::PI * creature.phase(world));
            down(0) == (s < 0.0)
        }
        2 => down(0) != down(1),
        _ => (down(0) && down(3) && !down(1) && !down(2)) || (down(1) && down(2) && !down(0) && !down(3)),
    }
}

/// How many feet are sliding along the ground rather than planted, faster than 0.3 m/s.
pub fn sliding(creature: &Creature, world: &World) -> usize {
    creature
        .legs
        .iter()
        .filter(|leg| {
            let foot = &world.bodies[leg.lower as usize];
            foot.touching && (foot.velocity.x > 0.3 || foot.velocity.x < -0.3)
        })
        .count()
}

/// Collects a run, step by step.
#[derive(Clone, Debug, Default)]
pub struct Watch {
    steps: usize,
    upright: usize,
    turns: usize,
    dragging: usize,
    work: f32,
    /// The step of each landing of the first foot, and how long it has been in the air.
    landings: Vec<usize>,
    lifted: usize,
}

impl Watch {
    pub fn after_step(&mut self, creature: &Creature, world: &World) {
        self.steps += 1;
        self.work += creature.effort(world);
        let torso = &world.bodies[creature.torso as usize];
        if carried(creature, world) {
            self.upright += 1;
        }
        if taking_turns(creature, world) {
            self.turns += 1;
        }
        let down: Vec<bool> = creature.legs.iter().map(|leg| world.bodies[leg.lower as usize].touching).collect();
        if torso.touching || creature.legs.iter().any(|leg| world.bodies[leg.upper as usize].touching) {
            self.dragging += 1;
        }
        // a landing counts after the foot has been up a few steps, so a bounce is not a stride
        if down[0] {
            if self.lifted >= 4 {
                self.landings.push(self.steps);
            }
            self.lifted = 0;
        } else {
            self.lifted += 1;
        }
    }

    pub fn gait(&self, creature: &Creature, world: &World) -> Gait {
        let steps = self.steps.max(1) as f32;
        let periods: Vec<f32> = self.landings.windows(2).map(|pair| (pair[1] - pair[0]) as f32).collect();
        let variation = if periods.len() < 3 {
            9.0
        } else {
            let mean = periods.iter().sum::<f32>() / periods.len() as f32;
            let spread = crate::math::sqrt(periods.iter().map(|p| (p - mean) * (p - mean)).sum::<f32>() / periods.len() as f32);
            spread / mean
        };
        Gait {
            upright: self.upright as f32 / steps,
            turns: self.turns as f32 / steps,
            variation,
            strides: self.landings.len(),
            distance: creature.distance(world),
            effort: self.work / (steps * STEP),
            dragging: self.dragging as f32 / steps,
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::body::Description;
    use crate::learn::{Settings, Trainer, flat_ground};

    /// Trains for two hundred generations with a fixed seed and watches the best run.
    fn trained(legs: u32) -> super::Gait {
        let mut trainer = Trainer::new(Description { legs }, Settings::default(), &flat_ground(), 1).unwrap();
        while trainer.generation < 200 {
            trainer.train(64);
        }
        let best = trainer.best.clone();
        let gait = trainer.watch(&best);
        std::println!("{legs} legs: {gait:?}");
        gait
    }

    // Before the legs moved in strides, the same training gave: two legs upright 0.13 of the run,
    // one foot down 0.50, strides varying 0.33, 15.9 m; four legs upright 0.91, trotting 0.02,
    // strides varying 0.40, 29.6 m; one leg upright 0.03, dragging a knee 0.48 of the run.

    #[test]
    fn two_legs_learn_to_walk_upright_with_their_feet_taking_turns_in_a_steady_stride() {
        let gait = trained(2);
        assert!(gait.upright > 0.6 && gait.turns > 0.45 && gait.variation < 0.2, "{gait:?}");
        assert!(gait.distance > 6.0 && gait.dragging < 0.02, "{gait:?}");
    }

    #[test]
    fn four_legs_learn_to_walk_upright_in_a_steady_stride_without_dragging() {
        let gait = trained(4);
        assert!(gait.upright > 0.8 && gait.variation < 0.5 && gait.turns > 0.05, "{gait:?}");
        assert!(gait.distance > 10.0 && gait.dragging < 0.05, "{gait:?}");
    }

    #[test]
    fn one_leg_stays_up_more_than_it_did_though_it_does_not_yet_hop() {
        let gait = trained(1);
        assert!(gait.upright > 0.4 && gait.dragging < 0.3, "{gait:?}");
    }
}
