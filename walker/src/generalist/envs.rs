//! Many creatures in many worlds, stepped together, for a learner: each step takes an action for every
//! creature, moves them all on by one step in lockstep (`World::step_together`), and writes into the
//! caller's lists what each now senses, the reward it earned in that step, and whether its run ended.
//! A run that ends starts again from its world's start at once, and what it sensed is then the new
//! run's first. Evolution runs its brains through this too (`evolve`), so a run is the same run
//! whoever chooses its actions.
//!
//! Creature i lives in the world of the recipe's seed plus i (or the recipe's own world, for all of
//! them alike), so what happens to it depends on that seed and its actions alone, never on how many
//! others are stepped beside it.
//!
//! The reward (`Judge`): each metre further than it has been before earns 1, so a run's progress adds
//! up to the furthest it got; a hazard or a fall into a gap costs 3 and ends the run; each change in
//! the actions from one step to the next costs 0.002 for its size, as the Walker's twitching does. A
//! run also ends after its time, after its body has been down for a second, or once it has gone no
//! further for five seconds.

use alloc::rc::Rc;
use alloc::vec;
use alloc::vec::Vec;

use super::body::Body;
use super::eyes::{self, PER_RAY, RAYS, Seen};
use super::land::Land;
use super::recipe::Recipe;
use super::stage::Stage;
use crate::physics::{STEP, World};

/// What falling into a hazard or a gap costs, and what each unit of change in the actions costs.
pub const HAZARD_COST: f32 = 3.0;
pub const TWITCH_COST: f32 = 0.002;
/// How long a run lasts at most, in seconds, unless asked otherwise.
pub const SECONDS: f32 = 30.0;
/// A run ends once the body has been down this long, or has got no further than this in this long.
const DOWN_LIMIT: f32 = 1.0;
const STALL_DISTANCE: f32 = 0.2;
const STALL_SECONDS: f32 = 5.0;
/// How far a world is made for runs: further than any run of the longest time can go.
pub const MADE: f32 = 260.0;

/// How a run ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum End {
    Going,
    Time,
    Down,
    Stalled,
    Hazard,
    Fell,
}

/// Watches one run step by step: how far it has got, what it has cost, and whether it is over.
#[derive(Clone, Copy, Debug)]
pub struct Judge {
    pub steps: u32,
    pub most_steps: u32,
    /// The furthest the body has been, from the start, and where it was when it last got further.
    pub furthest: f32,
    stall_mark: f32,
    stall_steps: u32,
    pub seconds_down: f32,
    pub twitch: f32,
    last: [f32; 32],
    pub end: End,
    pub score: f32,
}

impl Judge {
    pub fn new(seconds: f32) -> Judge {
        Judge { steps: 0, most_steps: (seconds / STEP) as u32, furthest: 0.0, stall_mark: 0.0, stall_steps: 0, seconds_down: 0.0, twitch: 0.0, last: [0.0; 32], end: End::Going, score: 0.0 }
    }

    /// Takes in a step just taken with these actions, and gives back the reward it earned.
    pub fn after_step(&mut self, stage: &Stage, body: &Body, actions: &[f32]) -> f32 {
        self.steps += 1;
        let mut reward = 0.0;
        let mut twitch = 0.0;
        for (last, &now) in self.last.iter_mut().zip(actions) {
            if self.steps > 1 {
                twitch += if now > *last { now - *last } else { *last - now };
            }
            *last = now;
        }
        self.twitch += twitch;
        reward -= TWITCH_COST * twitch;
        let world = &stage.world;
        let torso = &world.bodies[body.creature.torso as usize];
        let along = torso.position.x + stage.origin - body.creature.start.x;
        if along > self.furthest {
            reward += along - self.furthest;
            self.furthest = along;
        }
        self.seconds_down = if body.creature.fallen(world) { self.seconds_down + STEP } else { 0.0 };
        self.stall_steps += 1;
        if self.furthest > self.stall_mark + STALL_DISTANCE {
            self.stall_mark = self.furthest;
            self.stall_steps = 0;
        }
        let hazard = body.creature.legs.iter().flat_map(|leg| [leg.upper, leg.lower]).chain([body.creature.torso]).any(|part| {
            let (low, high) = world.bodies[part as usize].placed().bounds(0.0);
            stage.hazard(low, high).is_some()
        });
        self.end = if hazard {
            End::Hazard
        } else if torso.position.y < stage.floor(torso.position.x) - 0.5 {
            End::Fell
        } else if self.seconds_down >= DOWN_LIMIT {
            End::Down
        } else if self.stall_steps as f32 * STEP >= STALL_SECONDS {
            End::Stalled
        } else if self.steps >= self.most_steps {
            End::Time
        } else {
            End::Going
        };
        if matches!(self.end, End::Hazard | End::Fell) {
            reward -= HAZARD_COST;
        }
        self.score += reward;
        reward
    }

    pub fn over(&self) -> bool {
        self.end != End::Going
    }
}

/// One creature in one world, from its start.
#[derive(Clone, Debug)]
pub struct Run {
    pub stage: Stage,
    pub body: Body,
    pub judge: Judge,
    /// What each ray saw at the last look, for drawing.
    pub seen: [(f32, Seen); RAYS],
    /// Each foot's speed up (less than 0 falling) after the last step, and whether it was down, so a
    /// landing's speed can be charged for (`practice::Shaping::impact`).
    pub feet: [(f32, bool); 4],
}

impl Run {
    /// A creature of `legs` legs at the start of a land.
    pub fn new(land: Rc<Land>, legs: u32, seconds: f32) -> Option<Run> {
        let mut stage = Stage::new(land);
        let body = Body::build(&mut stage.world, legs)?;
        stage.keep(stage.world.bodies[body.creature.torso as usize].position.x);
        Some(Run { stage, body, judge: Judge::new(seconds), seen: [(0.0, Seen::Nothing); RAYS], feet: [(0.0, true); 4] })
    }

    /// Makes this run the same as another, reusing its memory.
    pub fn copy_from(&mut self, other: &Run) {
        self.stage.copy_from(&other.stage);
        self.body.clone_from(&other.body);
        self.judge = other.judge;
        self.seen = other.seen;
        self.feet = other.feet;
    }

    /// How many numbers it senses: the rays, then what it feels of itself.
    pub fn senses(&self) -> usize {
        RAYS * PER_RAY + self.body.feelings()
    }

    /// What it senses now, written into `into`.
    pub fn sense(&mut self, into: &mut [f32]) {
        let torso = self.body.creature.torso;
        let group = self.stage.world.bodies[torso as usize].group;
        let (rays, feelings) = into.split_at_mut(RAYS * PER_RAY);
        eyes::see(&self.stage, torso, group, rays, &mut self.seen);
        self.body.feel(&self.stage.world, feelings);
    }

    /// What comes before a step: the world kept around the creature, and its joints set by the actions.
    pub fn before_step(&mut self, actions: &[f32]) {
        let x = self.stage.world.bodies[self.body.creature.torso as usize].position.x;
        self.stage.keep(x);
        self.body.drive(&mut self.stage.world, actions);
    }

    /// How far it has gone from the start.
    pub fn distance(&self) -> f32 {
        self.stage.world.bodies[self.body.creature.torso as usize].position.x + self.stage.origin - self.body.creature.start.x
    }
}

pub struct Envs {
    /// Each creature's start, and the run it is on now.
    pub starts: Vec<Run>,
    pub runs: Vec<Run>,
    /// Worlds swapped in and out of the runs so they can be stepped together in one list.
    spare: Vec<World>,
    /// The score each run had when it last ended.
    pub finished: Vec<f32>,
    pub distances: Vec<f32>,
    /// Steps taken, by all the creatures together.
    pub steps: u64,
}

impl Envs {
    /// `count` creatures of `legs` legs, creature i in the world of the recipe's seed plus i, or all in
    /// the recipe's own world if `alike`, each run lasting at most `seconds`.
    pub fn new(recipe: Recipe, legs: u32, count: usize, seconds: f32, alike: bool) -> Option<Envs> {
        let mut starts = Vec::with_capacity(count);
        let mut shared: Option<Rc<Land>> = None;
        for i in 0..count {
            let land = if alike {
                shared.get_or_insert_with(|| Rc::new(Land::new(recipe, MADE))).clone()
            } else {
                Rc::new(Land::new(Recipe { seed: recipe.seed.wrapping_add(i as u32), ..recipe }, MADE))
            };
            starts.push(Run::new(land, legs, seconds)?);
        }
        let runs = starts.clone();
        Some(Envs { spare: (0..count).map(|_| World::new()).collect(), starts, runs, finished: vec![0.0; count], distances: vec![0.0; count], steps: 0 })
    }

    pub fn len(&self) -> usize {
        self.runs.len()
    }

    pub fn is_empty(&self) -> bool {
        self.runs.is_empty()
    }

    /// How many numbers each creature senses, and how many actions it takes.
    pub fn senses(&self) -> usize {
        self.starts.first().map_or(0, Run::senses)
    }

    pub fn actions(&self) -> usize {
        self.starts.first().map_or(0, |run| run.body.actions())
    }

    /// Starts creature i's run again from its start.
    pub fn restart(&mut self, i: usize) {
        let (starts, runs) = (&self.starts, &mut self.runs);
        runs[i].copy_from(&starts[i]);
    }

    /// What every creature senses now, `senses()` numbers each, one after another.
    pub fn observe(&mut self, observations: &mut [f32]) {
        let senses = self.senses();
        for (run, into) in self.runs.iter_mut().zip(observations.chunks_exact_mut(senses)) {
            run.sense(into);
        }
    }

    /// One step of every creature. `actions` holds
    /// `actions()` numbers for each creature; what each senses after it goes into `observations`, its
    /// reward into `rewards`, and 1 into `done` if its run ended (and has started again), else 0.
    pub fn step(&mut self, actions: &[f32], observations: &mut [f32], rewards: &mut [f32], done: &mut [f32]) {
        let (wide, senses) = (self.actions(), self.senses());
        let count = self.runs.len();
        for (run, actions) in self.runs.iter_mut().zip(actions.chunks_exact(wide)) {
            run.before_step(actions);
        }
        for (run, spare) in self.runs.iter_mut().zip(self.spare.iter_mut()) {
            core::mem::swap(&mut run.stage.world, spare);
        }
        World::step_together(&mut self.spare);
        for (run, spare) in self.runs.iter_mut().zip(self.spare.iter_mut()) {
            core::mem::swap(&mut run.stage.world, spare);
        }
        self.steps += count as u64;
        for i in 0..count {
            let run = &mut self.runs[i];
            rewards[i] = run.judge.after_step(&run.stage, &run.body, &actions[i * wide..(i + 1) * wide]);
            let over = run.judge.over();
            done[i] = if over { 1.0 } else { 0.0 };
            if over {
                self.finished[i] = run.judge.score;
                self.distances[i] = run.judge.furthest;
                self.restart(i);
            }
            self.runs[i].sense(&mut observations[i * senses..(i + 1) * senses]);
        }
    }
}
