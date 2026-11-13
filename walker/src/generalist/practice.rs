//! Learning by practice in generated worlds. `Worlds` is the task `ppo` learns from: creatures each in
//! a world made from a recipe, a fresh world for every run (a new seed each time, so what is learned
//! must hold in any world of that kind rather than in one), stepped together in lockstep. A decision
//! holds for a few steps of the physics (`skip`), and its reward is the run's own (each metre further
//! than before, the cost of a hazard or a fall into a gap, the cost of twitching) and a little more
//! (`Shaping`): something for each second up, and a cost on the motors' work.
//!
//! Its actions are the evolution brain's, three for each joint that shape its swing to the legs'
//! rhythm and one for the hop, or, `direct`, one target angle for each joint and the hop.
//!
//! Training worlds have seeds with the top bit set; the held-out worlds a learner is measured on are
//! numbered from 2 (world 1 is the evolution baseline's), so none is ever practised in. `evaluate` runs any controller, a policy or an
//! evolved brain, through the same held-out worlds, so the two are measured alike.

use alloc::rc::Rc;
use alloc::vec;
use alloc::vec::Vec;

use super::envs::{End, Run};
use super::eyes::Seen;
use super::gait::{Gait, Watch};
use super::land::Land;
use super::ppo::{CUT, GOING, Learner, OVER, Settings, Task};
use super::recipe::Recipe;
use crate::physics::{STEP, World};

/// What is added to a run's own reward while practising.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shaping {
    /// For each second the body is up.
    pub alive: f32,
    /// For each joule of work the motors do.
    pub energy: f32,
    /// For each second in the air with nothing ahead to clear (`clear_ahead`), so a hop costs where
    /// the ground does not ask for one.
    pub air: f32,
    /// Whether the bonus for being up is in proportion to how tall it stands (`Creature::tallness`),
    /// so a crouch or a crawl earns less of it than standing.
    pub tall: bool,
    /// For each unit the actions change from one decision to the next, summed over the actions: a
    /// jerk costs, a smooth movement hardly at all.
    pub smooth: f32,
    /// For falling down and staying down (a run that ends with its body down), as a fall into a gap
    /// or a hazard costs.
    pub fall: f32,
    /// For each second of each knee on the ground.
    pub knee: f32,
    /// For each second the body is carried tall and upright, in proportion to how tall
    /// (`Creature::tallness`), beside `alive`, which is the same whatever its height.
    pub upright: f32,
    /// How long the body may be down before its run ends, in seconds (the run's own rule is a
    /// second): less ends a run that drags its body sooner, and 0 ends it at the first touch.
    pub down: f32,
    /// For each second with its feet taking turns while it goes forward (`gait::taking_turns`, as the
    /// Walker counts it: for two legs exactly one foot down), in full from 0.6 m/s.
    pub turns: f32,
    /// The fastest progress paid for, in metres a second (0: any): a metre gained quicker than this
    /// earns only what this pace would have, so going about is asked for and racing is not.
    pub pace: f32,
    /// For each metre a second a foot is coming down at when it lands: a stamp costs, a foot set
    /// down does not.
    pub impact: f32,
    /// For each second of the body's spin, squared (radians a second): rocking costs.
    pub spin: f32,
    /// For each second of the body's speed up or down, squared (metres a second): bobbing costs.
    pub bob: f32,
    /// For each second of each joint's speed, squared (radians a second), summed over the joints.
    pub swing: f32,
    /// For each second of each motor's torque, squared (newton metres), summed over the joints: the
    /// usual stand-in for what a muscle burns, which grows faster than its force.
    pub torque: f32,
    /// For a run that ends because it got nowhere for five seconds, as a fall costs: standing still
    /// is not a way to keep out of trouble.
    pub stall: f32,
    /// For each second of the body's lean, squared (radians from upright): a posture term, as the
    /// knee and upright terms are.
    pub lean: f32,
}

/// The parts of a step's reward, for a reader: the run's own (progress less hazards and twitching),
/// the bonus for being up, the motors' work, and time in the air with nothing to clear.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Parts {
    pub run: f32,
    pub up: f32,
    pub effort: f32,
    pub air: f32,
    pub fall: f32,
    /// The cost of knees on the ground and the bonus for standing tall (with `up` on the page).
    pub posture: f32,
}

/// Whether the creature's eyes, at their last look, show something ahead worth leaving the ground
/// for: an edge, a box, a hazard or a moving thing where the five nearest rays looking down land
/// (within about 1.7 m for an eye a metre up, nearer for a lower one: about a hop), or a wall within
/// a metre of the rays looking level and a little up. Further off, there is time to walk up to it.
pub fn clear_ahead(run: &Run) -> bool {
    run.seen.iter().enumerate().any(|(k, &(distance, seen))| match k {
        0..=4 => matches!(seen, Seen::Edge | Seen::Box | Seen::Hazard | Seen::Moving),
        11 | 12 => seen != Seen::Nothing && distance < 1.0,
        _ => false,
    })
}

/// The shaped reward of a step just taken by `run` with `actions`, in its parts.
pub fn shaped(run: &mut Run, shaping: Shaping, actions: &[f32]) -> Parts {
    let world = &run.stage.world;
    let mut parts = Parts::default();
    let creature = &run.body.creature;
    if shaping.impact != 0.0 {
        for (k, leg) in creature.legs.iter().enumerate() {
            let foot = &world.bodies[leg.lower as usize];
            let (falling, was_down) = run.feet[k];
            if foot.touching && !was_down && falling < 0.0 {
                parts.effort += shaping.impact * falling;
            }
            run.feet[k] = (foot.velocity.y, foot.touching);
        }
    }
    let torso = &world.bodies[creature.torso as usize];
    if shaping.spin != 0.0 {
        parts.effort -= shaping.spin * STEP * torso.spin * torso.spin;
    }
    if shaping.lean != 0.0 {
        let angle = torso.angle();
        parts.posture -= shaping.lean * STEP * angle * angle;
    }
    if shaping.bob != 0.0 {
        parts.effort -= shaping.bob * STEP * torso.velocity.y * torso.velocity.y;
    }
    if shaping.swing != 0.0 || shaping.torque != 0.0 {
        let h = STEP / world.substeps.max(1) as f32;
        for &joint in &creature.joints {
            let joint = &world.joints[joint as usize];
            let (speed, torque) = (joint.angular_speed(&world.bodies), joint.motor_torque(h));
            parts.effort -= STEP * (shaping.swing * speed * speed + shaping.torque * torque * torque);
        }
    }
    if shaping.energy != 0.0 {
        parts.effort -= shaping.energy * run.body.creature.effort(world);
    }
    if shaping.air != 0.0 && run.body.creature.flying(world) && !clear_ahead(run) {
        parts.air = -shaping.air * STEP;
    }
    if shaping.knee != 0.0 {
        parts.posture -= shaping.knee * STEP * run.body.creature.kneeling(world) as f32;
    }
    let before = run.judge.furthest;
    parts.run = run.judge.after_step(&run.stage, &run.body, actions);
    if shaping.pace > 0.0 {
        parts.run -= (run.judge.furthest - before - shaping.pace * STEP).max(0.0);
    }
    if run.judge.end == End::Going && run.judge.seconds_down > 0.0 && run.judge.seconds_down > shaping.down {
        run.judge.end = End::Down;
    }
    if run.judge.end == End::Down {
        parts.fall = -shaping.fall;
    }
    if run.judge.end == End::Stalled && shaping.stall != 0.0 {
        parts.fall = -shaping.stall;
    }
    if run.judge.seconds_down == 0.0 {
        let tallness = if shaping.tall { run.body.creature.tallness(&run.stage.world) } else { 1.0 };
        parts.up = shaping.alive * STEP * tallness;
        if shaping.turns != 0.0 && crate::gait::taking_turns(&run.body.creature, world) {
            let forward = run.stage.world.bodies[run.body.creature.torso as usize].velocity.x / 0.6;
            parts.posture += shaping.turns * STEP * forward.clamp(0.0, 1.0);
        }
        if shaping.upright != 0.0 {
            parts.posture += shaping.upright * STEP * run.body.creature.tallness(&run.stage.world);
        }
    }
    parts
}

/// How a creature practises: its legs, its actions, how many steps of the physics a decision holds
/// for, how long a run lasts at most, and the shaping of its reward.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Way {
    pub legs: u32,
    pub direct: bool,
    pub skip: u32,
    pub seconds: f32,
    pub shaping: Shaping,
    /// Whether it may hop. Without, the hop action is there but does nothing.
    pub hop: bool,
    /// The costs of effort and of time in the air rise from nothing to the full amount over this
    /// many steps of practice (0: full from the start), so it can find how to move before it is
    /// charged for how.
    pub ramp: u64,
    /// How quickly each joint eases to the angle asked of it (`Body::ease`).
    pub ease: f32,
    /// How strong and quick the joints are when aimed directly (`Body::strength`).
    pub strength: f32,
    /// The furthest forward a hip may swing, in radians from the leg straight down (0: the body's
    /// own limit, 1.3): a body that cannot kick high, rather than a rule against kicking.
    pub hip: f32,
    /// Whether it senses the legs' rhythm (the sine and cosine of a steady clock): a clock to step
    /// to, which is a hint about how to move, so it can be taken away.
    pub clock: bool,
}

impl Way {
    /// Gives a body this way's actions.
    pub fn dress(&self, body: &mut super::body::Body) {
        body.direct = self.direct;
        body.ease = self.ease;
        body.strength = self.strength;
        body.clock = self.clock;
    }

    /// Dresses a run's body (`dress`) and sets its hips' reach forward, if this way changes it.
    pub fn dress_run(&self, run: &mut Run) {
        self.dress(&mut run.body);
        if self.hip > 0.0 {
            for joints in run.body.creature.joints.chunks(2) {
                let hip = &mut run.stage.world.joints[joints[0] as usize];
                hip.upper = self.hip;
            }
        }
    }

    /// Takes the actions asked into the actions held for the next decision, as practice and the show
    /// both must, so what is shown is what was practised: each kept within -1 to 1, and the hop held
    /// off if this way has none. Returns how much they changed, summed.
    pub fn hold(&self, asked: &[f32], held: &mut [f32]) -> f32 {
        let mut change = 0.0;
        for (held, &action) in held.iter_mut().zip(asked) {
            let action = action.clamp(-1.0, 1.0);
            change += (action - *held).abs();
            *held = action;
        }
        if !self.hop && let Some(hop) = held.last_mut() {
            *hop = -1.0;
        }
        change
    }

    /// What was settled on; walker/README.md ("How it moves" and "How two legs came to walk") gives
    /// the measurements. Each joint is aimed straight at an angle; no hop, so leaving the ground is its
    /// legs' own doing, and costs: 0.002 for each joule of the motors' work and 2 for each second in
    /// the air with nothing to clear, brought in over its first 4 million steps, and 3 for a fall, as a
    /// fall into a gap costs.
    ///
    /// Two legs are held to their posture as well: 1 for each second of each knee down, 0.5 for each
    /// second carried tall, 1 for each second of the body's lean squared, and a run that ends at the
    /// first touch of its body once the costs are all in (until then it may be down for a second, less
    /// and less). They are asked to go about rather than race: progress is paid up to 1 m/s and no
    /// faster, and a run that gets nowhere for five seconds costs 3, as a fall does. A landing costs
    /// 0.05 for each metre a second the foot comes down at. They sense no rhythm, and nothing rewards
    /// how their feet take turns.
    pub fn of(legs: u32) -> Way {
        let mut shaping = Shaping { alive: 0.25, energy: 0.002, air: 2.0, tall: false, smooth: 0.0, fall: 3.0, knee: 0.0, upright: 0.0, down: 1.0, turns: 0.0, pace: 0.0, impact: 0.0, spin: 0.0, bob: 0.0, swing: 0.0, torque: 0.0, stall: 0.0, lean: 0.0 };
        // two legs went on their belly and knees in lunges without these (README, "How it moves")
        if legs == 2 {
            shaping = Shaping { knee: 1.0, upright: 0.5, down: 0.0, lean: 1.0, pace: 1.0, stall: 3.0, impact: 0.05, ..shaping };
        }
        Way { legs, direct: true, skip: 4, seconds: 30.0, shaping, hop: false, ramp: 4_000_000, ease: 1.0, strength: 1.0, hip: 0.0, clock: legs != 2 }
    }
}

/// How far a world is made when a run starts, in metres; the stage makes more as the creature goes.
const FIRST_MADE: f32 = 30.0;

/// The seed of a practice world: run `run` of creature `creature` of stream `stream`, mixed, with the
/// top bit set so it is never one of the held-out worlds.
pub fn practice_seed(stream: u32, creature: u32, run: u32) -> u32 {
    let mut z = ((stream as u64) << 40) ^ ((creature as u64) << 20) ^ run as u64;
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    ((z ^ (z >> 31)) as u32) | 0x8000_0000
}

/// The held-out worlds, numbered from 2 (world 1 is the one the evolution baseline learned in).
pub fn held_out(count: usize) -> Vec<u32> {
    (2..2 + count as u32).collect()
}

pub struct Worlds {
    pub recipe: Recipe,
    pub way: Way,
    stream: u32,
    pub runs: Vec<Run>,
    spare: Vec<World>,
    going: Vec<bool>,
    active: Vec<usize>,
    made: Vec<u32>,
    /// Whether a run that ends is followed by one in a fresh world (practice), or the creature stops.
    renew: bool,
    held: Vec<f32>,
    senses: usize,
    actions: usize,
    /// How far each run that ended got, since this was last emptied.
    pub finished: Vec<f32>,
    /// Steps of the physics taken, by all the creatures together.
    pub steps: u64,
    /// Runs ended, and of those how many got further than `goal` metres, for a curriculum.
    pub tally: (u32, u32),
    pub goal: f32,
    /// Steps spent in the air with nothing ahead to clear, by all the creatures together: how much it
    /// hops, or leaps, for nothing.
    pub idle_air: u64,
    /// The motors' work, in joules, by all the creatures together.
    pub joules: f64,
    /// How each creature moves, step by step, when measuring.
    pub watches: Option<Vec<Watch>>,
    /// The same, watching only while nothing ahead asks for anything but walking (`clear_ahead`):
    /// how it moves on open ground, with what it does at each thing in its way left out.
    pub open_watches: Option<Vec<Watch>>,
}

impl Worlds {
    /// `count` creatures practising in fresh worlds of the recipe's kind, their seeds from `stream`.
    pub fn new(recipe: Recipe, way: Way, count: usize, stream: u32) -> Option<Worlds> {
        let seeds: Vec<u32> = (0..count as u32).map(|i| practice_seed(stream, i, 0)).collect();
        let mut worlds = Worlds::alone(recipe, way, &seeds)?;
        worlds.renew = true;
        worlds.stream = stream;
        Some(worlds)
    }

    /// One creature in each world of these seeds, each stopping when its run ends.
    pub fn alone(recipe: Recipe, way: Way, seeds: &[u32]) -> Option<Worlds> {
        let runs = seeds.iter().map(|&seed| make(recipe, way, seed)).collect::<Option<Vec<Run>>>()?;
        let (senses, actions) = (runs.first()?.senses(), runs.first()?.body.actions());
        let count = runs.len();
        Some(Worlds { recipe, way, stream: 0, spare: (0..count).map(|_| World::new()).collect(), going: vec![true; count], active: Vec::with_capacity(count), made: vec![0; count], renew: false, held: vec![0.0; count * actions], senses, actions, finished: Vec::new(), steps: 0, tally: (0, 0), goal: f32::INFINITY, idle_air: 0, joules: 0.0, watches: None, open_watches: None, runs })
    }

    /// Whether creature i is still going (only a creature alone can stop).
    pub fn going(&self, i: usize) -> bool {
        self.going[i]
    }

    /// One decision: each going creature takes its actions (kept within -1 to 1) for `skip` steps,
    /// or until its run ends. Rewards and how runs stand are written as `Task::step` says.
    fn advance(&mut self, actions: &[f32], rewards: &mut [f32], ends: &mut [u8], last: &mut [f32]) {
        let (wide, count) = (self.actions, self.runs.len());
        rewards.fill(0.0);
        let smooth = self.way.shaping.smooth;
        for (i, (held, asked)) in self.held.chunks_exact_mut(wide).zip(actions.chunks_exact(wide)).enumerate() {
            let change = self.way.hold(asked, held);
            if smooth != 0.0 && self.runs[i].judge.steps > 0 {
                rewards[i] -= smooth * change;
            }
        }
        ends.fill(GOING);
        if self.renew {
            self.going.fill(true);
        }
        let shaping = self.way.shaping;
        for _ in 0..self.way.skip.max(1) {
            self.active.clear();
            for i in 0..count {
                if self.going[i] {
                    self.runs[i].before_step(&self.held[i * wide..(i + 1) * wide]);
                    self.active.push(i);
                }
            }
            if self.active.is_empty() {
                break;
            }
            for (k, &i) in self.active.iter().enumerate() {
                core::mem::swap(&mut self.runs[i].stage.world, &mut self.spare[k]);
            }
            World::step_together(&mut self.spare[..self.active.len()]);
            self.steps += self.active.len() as u64;
            for (k, &i) in self.active.iter().enumerate() {
                core::mem::swap(&mut self.runs[i].stage.world, &mut self.spare[k]);
            }
            for k in 0..self.active.len() {
                let i = self.active[k];
                let run = &mut self.runs[i];
                let parts = shaped(run, shaping, &self.held[i * wide..(i + 1) * wide]);
                let idle = run.body.creature.flying(&run.stage.world) && !clear_ahead(run);
                self.idle_air += u64::from(idle);
                // the page never measures, so its module is spared the watching
                #[cfg(not(target_arch = "wasm32"))]
                if let Some(watches) = &mut self.watches {
                    watches[i].after_step(&run.body.creature, &run.stage.world, idle);
                }
                #[cfg(not(target_arch = "wasm32"))]
                if let Some(watches) = &mut self.open_watches {
                    if clear_ahead(run) {
                        watches[i].pause();
                    } else {
                        watches[i].after_step(&run.body.creature, &run.stage.world, idle);
                    }
                }
                self.joules += run.body.creature.effort(&run.stage.world) as f64;
                rewards[i] += parts.run + parts.up + parts.effort + parts.air + parts.fall + parts.posture;
                if run.judge.over() {
                    self.going[i] = false;
                    self.finished.push(run.judge.furthest);
                    self.tally.0 += 1;
                    if run.judge.furthest > self.goal {
                        self.tally.1 += 1;
                    }
                    ends[i] = if run.judge.end == End::Time { CUT } else { OVER };
                    if self.renew {
                        if ends[i] == CUT {
                            self.runs[i].sense(&mut last[i * self.senses..(i + 1) * self.senses]);
                        }
                        self.made[i] += 1;
                        let seed = practice_seed(self.stream, i as u32, self.made[i]);
                        if let Some(fresh) = make(self.recipe, self.way, seed) {
                            self.runs[i] = fresh;
                        }
                    }
                }
            }
        }
    }
}

/// A creature at the start of a fresh world of the recipe's kind with this seed.
fn make(recipe: Recipe, way: Way, seed: u32) -> Option<Run> {
    let mut run = Run::new(Rc::new(Land::new(Recipe { seed, ..recipe }, FIRST_MADE)), way.legs, way.seconds)?;
    way.dress_run(&mut run);
    Some(run)
}

impl Task for Worlds {
    fn count(&self) -> usize {
        self.runs.len()
    }

    fn senses(&self) -> usize {
        self.senses
    }

    fn actions(&self) -> usize {
        self.actions
    }

    fn observe(&mut self, into: &mut [f32]) {
        let senses = self.senses;
        for (run, into) in self.runs.iter_mut().zip(into.chunks_exact_mut(senses)) {
            run.sense(into);
        }
    }

    fn step(&mut self, actions: &[f32], into: &mut [f32], rewards: &mut [f32], ends: &mut [u8], last: &mut [f32]) {
        self.advance(actions, rewards, ends, last);
        self.observe(into);
    }
}

/// How far a controller gets through each of these worlds, in metres, in runs of the way's length:
/// `act(i, senses, actions)` decides for creature i, every `skip` steps of the physics.
pub fn evaluate(recipe: Recipe, way: Way, seeds: &[u32], act: impl FnMut(usize, &[f32], &mut [f32])) -> Vec<f32> {
    measure(recipe, way, seeds, act).distances
}

/// How a controller does in held-out worlds: how far it gets in each, the share of its time spent in
/// the air with nothing ahead to clear, and the motors' work for each metre it went.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Measured {
    pub distances: Vec<f32>,
    pub idle_air: f32,
    pub joules_per_metre: f32,
    /// How it moved (`gait`).
    pub gait: Gait,
    /// How it moved on open ground alone (`Worlds::open_watches`).
    pub open_gait: Gait,
}

impl Measured {
    pub fn mean(&self) -> f32 {
        self.distances.iter().sum::<f32>() / self.distances.len().max(1) as f32
    }
}

/// `evaluate`, with how it moved as well as how far.
pub fn measure(recipe: Recipe, way: Way, seeds: &[u32], mut act: impl FnMut(usize, &[f32], &mut [f32])) -> Measured {
    let Some(mut worlds) = Worlds::alone(recipe, way, seeds) else { return Measured::default() };
    worlds.watches = Some(vec![Watch::default(); seeds.len()]);
    worlds.open_watches = Some(vec![Watch::default(); seeds.len()]);
    let (count, senses, wide) = (seeds.len(), worlds.senses, worlds.actions);
    let (mut sensed, mut actions, mut rewards, mut ends, mut last) = (vec![0.0; count * senses], vec![0.0; count * wide], vec![0.0; count], vec![GOING; count], vec![0.0; count * senses]);
    worlds.observe(&mut sensed);
    while (0..count).any(|i| worlds.going[i]) {
        for i in 0..count {
            if worlds.going[i] {
                act(i, &sensed[i * senses..(i + 1) * senses], &mut actions[i * wide..(i + 1) * wide]);
            }
        }
        worlds.step(&actions, &mut sensed, &mut rewards, &mut ends, &mut last);
    }
    let distances: Vec<f32> = worlds.runs.iter().map(|run| run.judge.furthest).collect();
    let metres = distances.iter().sum::<f32>().max(0.01);
    let gait = Gait::of(worlds.watches.as_deref().unwrap_or(&[]));
    let open_gait = Gait::of(worlds.open_watches.as_deref().unwrap_or(&[]));
    Measured { idle_air: worlds.idle_air as f32 / worlds.steps.max(1) as f32, joules_per_metre: (worlds.joules / metres as f64) as f32, distances, gait, open_gait }
}

/// A learner practising in fresh worlds of a recipe's kind: what the page runs, and the native runs
/// behind the README's numbers.
pub struct Practice {
    pub learner: Learner,
    pub worlds: Worlds,
    /// The kind of world it is learning for, which `evaluate` measures in, whatever the curriculum has
    /// it practising in now.
    pub recipe: Recipe,
    pub curriculum: Option<Curriculum>,
    /// The full costs, which `Way::ramp` brings the worlds' up to.
    pub shaping: Shaping,
}

/// A simple curriculum: practice starts in the easiest worlds, and each time most practice runs get
/// further than a goal, the worlds get a step harder, until they are as hard as asked.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Curriculum {
    /// How much harder each step makes the worlds, the share of runs that must reach the goal, the
    /// goal in metres, and the fewest runs to judge by.
    pub step: f32,
    pub share: f32,
    pub goal: f32,
    pub runs: u32,
}

impl Default for Curriculum {
    fn default() -> Curriculum {
        Curriculum { step: 0.1, share: 0.5, goal: 10.0, runs: 64 }
    }
}

impl Practice {
    /// `count` creatures practising in worlds of the recipe's kind (its seed is not used), the
    /// learner's first weights from `seed`, its worlds' seeds from `stream`.
    pub fn new(recipe: Recipe, way: Way, settings: Settings, count: usize, seed: u64, stream: u32) -> Option<Practice> {
        let mut worlds = Worlds::new(recipe, way, count, stream)?;
        let mut learner = Learner::new(settings, worlds.senses, worlds.actions, count, seed);
        learner.begin(&mut worlds);
        Some(Practice { learner, worlds, recipe, curriculum: None, shaping: way.shaping })
    }

    /// The same, practising by a curriculum from the easiest worlds up to the recipe's difficulty.
    pub fn with_curriculum(mut self, curriculum: Curriculum) -> Practice {
        self.worlds.recipe.difficulty = 0.0;
        self.worlds.goal = curriculum.goal;
        self.curriculum = Some(curriculum);
        self
    }

    /// Brings the costs of effort and of time in the air to where `Way::ramp` has them now. Every
    /// update starts with it, whether done alone or shared between workers.
    pub fn ramp(&mut self) {
        let way = &mut self.worlds.way;
        if way.ramp > 0 {
            let along = (self.worlds.steps as f64 / way.ramp as f64).min(1.0) as f32;
            way.shaping.energy = self.shaping.energy * along;
            way.shaping.air = self.shaping.air * along;
            way.shaping.knee = self.shaping.knee * along;
            way.shaping.impact = self.shaping.impact * along;
            way.shaping.spin = self.shaping.spin * along;
            way.shaping.bob = self.shaping.bob * along;
            way.shaping.swing = self.shaping.swing * along;
            way.shaping.torque = self.shaping.torque * along;
            way.shaping.lean = self.shaping.lean * along;
            // the time it may be down shortens from the run's own second to what is asked
            way.shaping.down = 1.0 + (self.shaping.down - 1.0) * along;
        }
    }

    pub fn update(&mut self) {
        self.ramp();
        self.learner.update(&mut self.worlds);
        self.learner.practised = self.worlds.steps;
        let Some(curriculum) = self.curriculum else { return };
        let (ended, reached) = self.worlds.tally;
        if ended >= curriculum.runs {
            if reached as f32 >= curriculum.share * ended as f32 && self.worlds.recipe.difficulty < self.recipe.difficulty {
                self.worlds.recipe.difficulty = (self.worlds.recipe.difficulty + curriculum.step).min(self.recipe.difficulty);
            }
            self.worlds.tally = (0, 0);
        }
    }

    /// Takes back a learner kept with `Learner::state` and `running`, and the steps it had practised,
    /// so its costs go on from where they were rather than coming in again from nothing. False, and
    /// nothing changed, if it does not fit.
    pub fn load(&mut self, state: &[f32], running: &[f64]) -> bool {
        if !self.learner.load(state, running) {
            return false;
        }
        self.worlds.steps = self.learner.practised;
        true
    }

    /// How far the policy gets through each of these worlds, acting without drawing.
    pub fn evaluate(&mut self, seeds: &[u32]) -> Vec<f32> {
        self.measure(seeds).distances
    }

    /// `evaluate`, with how it moved as well as how far.
    pub fn measure(&mut self, seeds: &[u32]) -> Measured {
        let learner = &mut self.learner;
        measure(self.recipe, self.worlds.way, seeds, |_, senses, actions| learner.act(senses, actions))
    }
}
