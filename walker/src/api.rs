//! What the page calls. Every function takes and gives plain numbers. Lists, such as the bodies to
//! draw or a brain's weights, stay in the module's memory: a function gives a pointer to the first
//! f32, another gives the length, and the page reads them through a Float32Array over
//! `memory.buffer`. Memory can grow during any call, which replaces that buffer, so the page makes
//! its view again after each call rather than keeping one. README.md lists each function.
//!
//! There is one walker per module. A page wanting two instantiates the module twice.

use alloc::vec;
use alloc::vec::Vec;

use crate::Shared;
use crate::body::Description;
use crate::learn::{Climber, Goal, Settings, Trainer, flat_ground};
use crate::math::Vec2;
use crate::physics::Segment;
use crate::show::{Crowd, Show};

struct Walker {
    trainer: Trainer,
    show: Show,
    crowd: Option<Crowd>,
    /// Learning one walker at a time, live, when there is one.
    live: Option<Climber>,
    /// Room the page writes into: ground pieces as four f32 each, and a brain's weights.
    ground_room: Vec<f32>,
    weights_room: Vec<f32>,
    crowd_room: Vec<f32>,
    /// Brains to run for another trainer (`evaluate`), and how each went, a score and a distance.
    evaluate_room: Vec<f32>,
    evaluated: Vec<f32>,
}

static WALKER: Shared<Option<Walker>> = Shared::new(None);

/// A show of a brain from the walker's start: endless when the walker's runs have no set length.
fn show_of(trainer: &Trainer, weights: &[f32]) -> Show {
    let mut judge = trainer.judge();
    judge.endless = !trainer.settings.length.is_finite();
    Show::new(&trainer.start, &trainer.creature, trainer.layout, weights, judge)
}

/// A live attempt: as a show, but over once it stops getting anywhere.
fn attempt_of(trainer: &Trainer, weights: &[f32]) -> Show {
    let mut show = show_of(trainer, weights);
    show.judge.impatient = true;
    show
}

fn walker() -> Option<&'static mut Walker> {
    WALKER.get().as_mut()
}

/// A pointer for the page, or 0 when there is no walker yet.
fn pointer(list: Option<&[f32]>) -> *const f32 {
    list.map_or(core::ptr::null(), |list| list.as_ptr())
}

/// Makes a new walker with `legs` legs (1, 2 or 4) on flat ground, with a population of `population`
/// brains, each run for `seconds` when training (the goal's own time if 0), random numbers from
/// `seed`, brains of `layers` hidden layers (1 to 4) of `hidden` neurons each (2 to 64) and
/// `memory` memories (0 to 16), rewarded for `goal` (see walker/README.md), each run going `length`
/// metres (or, if it is 0 or less, runs of the goal's own time, and an endless show). Returns the
/// number of weights in one brain, or 0 if the description is not one the engine builds.
#[unsafe(no_mangle)]
pub extern "C" fn create(legs: u32, population: u32, seconds: f32, seed: u32, hidden: u32, layers: u32, memory: u32, goal: u32, length: f32) -> u32 {
    let description = Description { legs, carry: false, leap: false };
    let seconds = if seconds > 0.0 { seconds.min(120.0) } else { 0.0 };
    let length = if length > 0.0 { length.min(1000.0) } else { f32::INFINITY };
    let settings = Settings { population: population.clamp(2, 1000) as usize, seconds, length, hidden: hidden as usize, layers: layers as usize, memory: memory as usize, goal: Goal::from_number(goal), ..Settings::default() };
    let Some(trainer) = Trainer::new(description, settings, &flat_ground(), seed as u64) else {
        *WALKER.get() = None;
        return 0;
    };
    let count = trainer.layout.weights();
    let show = show_of(&trainer, trainer.weights(0));
    *WALKER.get() = Some(Walker { trainer, show, crowd: None, live: None, ground_room: Vec::new(), weights_room: vec![0.0; count], crowd_room: Vec::new(), evaluate_room: Vec::new(), evaluated: Vec::new() });
    count as u32
}

/// Room for `pieces` pieces of ground, each four f32: x1, y1, x2, y2. The page writes them there
/// and then calls `ground_set`.
#[unsafe(no_mangle)]
pub extern "C" fn ground_room(pieces: u32) -> *mut f32 {
    match walker() {
        Some(walker) => {
            walker.ground_room.clear();
            walker.ground_room.resize(4 * pieces.min(100_000) as usize, 0.0);
            walker.ground_room.as_mut_ptr()
        }
        None => core::ptr::null_mut(),
    }
}

/// Puts the walker on the ground written into `ground_room`, `pieces` pieces of it. Training goes on
/// from where it was, scoring on the new ground; the show and the crowd start again on it. With
/// zero pieces the ground is flat again. Returns 1 if it worked.
#[unsafe(no_mangle)]
pub extern "C" fn ground_set(pieces: u32) -> u32 {
    let Some(walker) = walker() else { return 0 };
    let pieces = (pieces as usize).min(walker.ground_room.len() / 4);
    let ground: Vec<Segment> = if pieces == 0 {
        flat_ground()
    } else {
        walker.ground_room.chunks_exact(4).take(pieces).map(|p| Segment { a: Vec2::new(p[0], p[1]), b: Vec2::new(p[2], p[3]) }).collect()
    };
    walker.trainer.set_ground(&ground);
    show_reset();
    if walker.crowd.is_some() {
        crowd_reset();
    }
    1
}

/// Trains for up to `runs` runs of one brain each, then returns the number of generations finished.
#[unsafe(no_mangle)]
pub extern "C" fn train(runs: u32) -> u32 {
    walker().map_or(0, |walker| walker.trainer.train(runs))
}

/// Room for `count` brains, one after another, to run for another trainer with `evaluate`.
#[unsafe(no_mangle)]
pub extern "C" fn evaluate_room(count: u32) -> *mut f32 {
    let Some(walker) = walker() else { return core::ptr::null_mut() };
    let length = walker.trainer.layout.weights() * count.min(1000) as usize;
    walker.evaluate_room.clear();
    walker.evaluate_room.resize(length, 0.0);
    walker.evaluate_room.as_mut_ptr()
}

/// Runs the `count` brains written into `evaluate_room` from this walker's start, as training runs
/// them, for a trainer elsewhere that hands out shares of its generation. Each one's score and
/// distance are then in `evaluated`. Returns how many were run.
#[unsafe(no_mangle)]
pub extern "C" fn evaluate(count: u32) -> u32 {
    let Some(walker) = walker() else { return 0 };
    let length = (walker.trainer.layout.weights() * count as usize).min(walker.evaluate_room.len());
    let brains = length / walker.trainer.layout.weights();
    walker.evaluated.clear();
    walker.evaluated.resize(2 * brains, 0.0);
    walker.trainer.evaluate(&walker.evaluate_room[..length], &mut walker.evaluated);
    brains as u32
}

/// The score and distance of each brain the last `evaluate` ran, two f32 a brain.
#[unsafe(no_mangle)]
pub extern "C" fn evaluated() -> *const f32 {
    pointer(walker().map(|walker| &walker.evaluated[..]))
}

/// 1 if member `index` of the current generation has been scored (or is one of the best few carried
/// over), else 0.
#[unsafe(no_mangle)]
pub extern "C" fn member_scored(index: u32) -> u32 {
    walker().map_or(0, |walker| walker.trainer.scored.get(index as usize).is_some_and(|scored| *scored) as u32)
}

/// Takes in the score and distance of member `index` of the current generation, run elsewhere. Once
/// every member is scored the next generation is bred, as `train` would. Returns the number of
/// generations finished.
#[unsafe(no_mangle)]
pub extern "C" fn record(index: u32, score: f32, distance: f32) -> u32 {
    let Some(walker) = walker() else { return 0 };
    walker.trainer.record(index as usize, score, distance);
    walker.trainer.generation
}

/// The number of generations finished.
#[unsafe(no_mangle)]
pub extern "C" fn generation() -> u32 {
    walker().map_or(0, |walker| walker.trainer.generation)
}

/// How many brains of the current generation have been run.
#[unsafe(no_mangle)]
pub extern "C" fn generation_runs() -> u32 {
    walker().map_or(0, |walker| walker.trainer.scored.iter().filter(|scored| **scored).count() as u32)
}

/// The best score so far, in metres; minus infinity before the first generation is finished.
#[unsafe(no_mangle)]
pub extern "C" fn best_score() -> f32 {
    walker().map_or(f32::NEG_INFINITY, |walker| walker.trainer.best_score)
}

/// How far the best brain so far took the torso forward in its run, in metres.
#[unsafe(no_mangle)]
pub extern "C" fn best_distance() -> f32 {
    walker().map_or(0.0, |walker| walker.trainer.best_distance)
}

/// The number of brains in a generation.
#[unsafe(no_mangle)]
pub extern "C" fn population_length() -> u32 {
    walker().map_or(0, |walker| walker.trainer.settings.population as u32)
}

/// Every brain of the current generation, one after another, `population_length` times
/// `weights_length` f32. A page training in a worker sends these to the page's own module for the
/// crowd (`crowd_room`, `crowd_start`).
#[unsafe(no_mangle)]
pub extern "C" fn population_weights() -> *const f32 {
    pointer(walker().map(|walker| &walker.trainer.population[..]))
}

/// The number of finished generations in the history.
#[unsafe(no_mangle)]
pub extern "C" fn history_length() -> u32 {
    walker().map_or(0, |walker| walker.trainer.history_best.len() as u32)
}

/// The best score of each finished generation, `history_length` f32.
#[unsafe(no_mangle)]
pub extern "C" fn history_best() -> *const f32 {
    pointer(walker().map(|walker| &walker.trainer.history_best[..]))
}

/// The average score of each finished generation, `history_length` f32.
#[unsafe(no_mangle)]
pub extern "C" fn history_mean() -> *const f32 {
    pointer(walker().map(|walker| &walker.trainer.history_mean[..]))
}

/// The number of weights in one brain.
#[unsafe(no_mangle)]
pub extern "C" fn weights_length() -> u32 {
    walker().map_or(0, |walker| walker.trainer.layout.weights() as u32)
}

/// The best brain's weights so far, `weights_length` f32.
#[unsafe(no_mangle)]
pub extern "C" fn best_weights() -> *const f32 {
    pointer(walker().map(|walker| &walker.trainer.best[..]))
}

/// Room for one brain's weights, `weights_length` f32, for the page to write a shared brain into
/// before calling `weights_load`.
#[unsafe(no_mangle)]
pub extern "C" fn weights_room() -> *mut f32 {
    walker().map_or(core::ptr::null_mut(), |walker| walker.weights_room.as_mut_ptr())
}

/// Takes in the brain written into `weights_room`: it becomes the best so far, joins the population,
/// and the show starts again with it. Returns 1 if it worked, 0 if any weight was not a number.
#[unsafe(no_mangle)]
pub extern "C" fn weights_load() -> u32 {
    let Some(walker) = walker() else { return 0 };
    let weights = walker.weights_room.clone();
    if !walker.trainer.load(&weights) {
        return 0;
    }
    show_reset();
    1
}

/// Starts the show again from the start, with the best brain so far (or a random one before the
/// first generation is finished).
#[unsafe(no_mangle)]
pub extern "C" fn show_reset() {
    let Some(walker) = walker() else { return };
    let trainer = &walker.trainer;
    let weights = if trainer.best_score > f32::NEG_INFINITY { &trainer.best[..] } else { trainer.weights(0) };
    walker.show = show_of(trainer, weights);
}

/// Takes in the brain written into `weights_room` as `weights_load` does, but an endless show does
/// not start again: the new brain takes over at the start of the walker's next stride. Returns 1 if
/// it worked.
#[unsafe(no_mangle)]
pub extern "C" fn weights_swap() -> u32 {
    let Some(walker) = walker() else { return 0 };
    let weights = walker.weights_room.clone();
    if !walker.trainer.load(&weights) {
        return 0;
    }
    if walker.show.judge.endless && !walker.show.judge.over {
        walker.show.pending = Some(weights);
    } else {
        show_reset();
    }
    1
}

/// Lays `pieces` more pieces of ground, written into `ground_room`, ahead of an endless show. They
/// are given from the walk's start, as the page made them; ground far behind the walker is dropped.
#[unsafe(no_mangle)]
pub extern "C" fn show_ground_extend(pieces: u32) {
    let Some(walker) = walker() else { return };
    let pieces: Vec<Segment> = walker.ground_room.chunks_exact(4).take(pieces as usize).map(|p| Segment { a: Vec2::new(p[0], p[1]), b: Vec2::new(p[2], p[3]) }).collect();
    walker.show.extend(&pieces);
}

/// How far an endless show's world has been moved back, in metres: add it to a body's x for where
/// it is from the start.
#[unsafe(no_mangle)]
pub extern "C" fn show_origin() -> f64 {
    walker().map_or(0.0, |walker| walker.show.origin)
}

/// 1 if the show is endless, else 0.
#[unsafe(no_mangle)]
pub extern "C" fn show_endless() -> u32 {
    walker().map_or(0, |walker| walker.show.judge.endless as u32)
}

/// Starts learning one walker at a time, live: the show is each attempt, the first a calm brain and
/// the second a random one. Returns 1 if it worked.
#[unsafe(no_mangle)]
pub extern "C" fn live_begin() -> u32 {
    let Some(walker) = walker() else { return 0 };
    // the climber's own randomness is seeded from the walker's, so the same seed climbs the same way
    let seed = walker.trainer.weights(0)[0].to_bits() as u64;
    let mut climber = Climber::new(walker.trainer.layout, walker.trainer.description, seed);
    walker.show = attempt_of(&walker.trainer, &climber.next());
    walker.live = Some(climber);
    1
}

/// Moves the live attempt on by `seconds`. When it ends (a fall, or the end of its run), it is kept
/// if it did better than the best so far, and the next attempt, a child of the best, starts at
/// once. Returns the number of the attempt now walking.
#[unsafe(no_mangle)]
pub extern "C" fn live_step(seconds: f32) -> u32 {
    let Some(walker) = walker() else { return 0 };
    let Some(live) = walker.live.as_mut() else { return 0 };
    walker.show.step(seconds);
    if walker.show.judge.over {
        let outcome = walker.show.outcome();
        live.report(&walker.show.weights, outcome);
        walker.show = attempt_of(&walker.trainer, &live.next());
    }
    live.attempt
}

/// The live attempt now walking, counting from 1.
#[unsafe(no_mangle)]
pub extern "C" fn live_attempt() -> u32 {
    walker().and_then(|walker| walker.live.as_ref()).map_or(0, |live| live.attempt)
}

/// The best live attempt's score, and the furthest a kept attempt has gone, which never goes down.
#[unsafe(no_mangle)]
pub extern "C" fn live_best_score() -> f32 {
    walker().and_then(|walker| walker.live.as_ref()).map_or(f32::NEG_INFINITY, |live| live.best_score)
}

#[unsafe(no_mangle)]
pub extern "C" fn live_best_distance() -> f32 {
    walker().and_then(|walker| walker.live.as_ref()).map_or(0.0, |live| live.furthest)
}

/// The best live attempt's weights, `weights_length` f32, to share.
#[unsafe(no_mangle)]
pub extern "C" fn live_best_weights() -> *const f32 {
    pointer(walker().and_then(|walker| walker.live.as_ref()).map(|live| &live.best[..]))
}

/// Stops learning live; the walker learns a generation at a time again.
#[unsafe(no_mangle)]
pub extern "C" fn live_stop() {
    if let Some(walker) = walker() {
        walker.live = None;
        show_reset();
    }
}

/// How long a run lasts for this walker's goal, in seconds.
#[unsafe(no_mangle)]
pub extern "C" fn run_seconds() -> f32 {
    walker().map_or(0.0, |walker| walker.trainer.settings.seconds)
}

/// 1 once the show's run has ended where its scored run ended, else 0. It then stands still until
/// `show_reset`.
#[unsafe(no_mangle)]
pub extern "C" fn show_over() -> u32 {
    walker().map_or(0, |walker| walker.show.judge.over as u32)
}

/// The show's run so far, scored as training scores it. At the end of an untouched run it is the
/// brain's score exactly.
#[unsafe(no_mangle)]
pub extern "C" fn show_score() -> f32 {
    walker().map_or(0.0, |walker| walker.show.outcome().score)
}

/// How long the show has been running, in seconds.
#[unsafe(no_mangle)]
pub extern "C" fn show_seconds() -> f32 {
    walker().map_or(0.0, |walker| walker.show.world.steps as f32 * crate::physics::STEP)
}

/// 1 if the show's walker has its torso on the ground, else 0.
#[unsafe(no_mangle)]
pub extern "C" fn show_fallen() -> u32 {
    walker().map_or(0, |walker| walker.show.creature.fallen(&walker.show.world) as u32)
}

/// Moves the show on by `seconds`, in whole steps of 1/60 s, and returns how many were taken.
#[unsafe(no_mangle)]
pub extern "C" fn show_step(seconds: f32) -> u32 {
    walker().map_or(0, |walker| walker.show.step(seconds))
}

/// Pushes the show's walker at the point (x, y) with an impulse in newton seconds, on whichever of
/// its bodies is nearest. Returns that body's number, or -1 with no walker.
#[unsafe(no_mangle)]
pub extern "C" fn show_push(x: f32, y: f32, impulse_x: f32, impulse_y: f32) -> i32 {
    walker().and_then(|walker| walker.show.push(Vec2::new(x, y), Vec2::new(impulse_x, impulse_y))).map_or(-1, |body| body as i32)
}

/// The walker's number of legs, and the number of the body that is the parcel it carries, or -1.
/// Bodies go: the body, each leg's upper and lower part, then for a carrier the two rims of its back
/// and the parcel.
#[unsafe(no_mangle)]
pub extern "C" fn legs_length() -> u32 {
    walker().map_or(0, |walker| walker.trainer.description.legs)
}

#[unsafe(no_mangle)]
pub extern "C" fn show_load() -> i32 {
    walker().and_then(|walker| walker.show.creature.load).map_or(-1, |load| load as i32)
}

/// The number of bodies in one walker.
#[unsafe(no_mangle)]
pub extern "C" fn body_count() -> u32 {
    walker().map_or(0, |walker| walker.show.world.bodies.len() as u32)
}

/// The show's bodies, six f32 each: x, y, angle, kind (0 circle, 1 capsule, 2 box), and two sizes
/// (a circle's radius and 0, a capsule's half length and radius, a box's half width and half height).
#[unsafe(no_mangle)]
pub extern "C" fn show_bodies() -> *const f32 {
    pointer(walker().map(|walker| &walker.show.drawn[..]))
}

/// How far the show's walker has gone forward, in metres.
#[unsafe(no_mangle)]
pub extern "C" fn show_distance() -> f32 {
    walker().map_or(0.0, |walker| walker.show.creature.distance(&walker.show.world))
}

/// The number of senses, hidden neurons in each layer, and outputs in a brain.
#[unsafe(no_mangle)]
pub extern "C" fn senses_length() -> u32 {
    walker().map_or(0, |walker| walker.trainer.layout.inputs as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn hidden_length() -> u32 {
    walker().map_or(0, |walker| walker.trainer.layout.hidden as u32)
}

#[unsafe(no_mangle)]
pub extern "C" fn outputs_length() -> u32 {
    walker().map_or(0, |walker| walker.trainer.layout.outputs as u32)
}

/// What the show's walker sensed last, `senses_length` f32, in the order `Creature::sense` gives.
#[unsafe(no_mangle)]
pub extern "C" fn show_senses() -> *const f32 {
    pointer(walker().map(|walker| &walker.show.senses[..]))
}

/// The number of memories the brain keeps from step to step.
#[unsafe(no_mangle)]
pub extern "C" fn memory_length() -> u32 {
    walker().map_or(0, |walker| walker.trainer.layout.memory as u32)
}

/// The number of hidden layers, 1 to 4.
#[unsafe(no_mangle)]
pub extern "C" fn layers_length() -> u32 {
    walker().map_or(0, |walker| walker.trainer.layout.layers as u32)
}

/// What its hidden neurons gave last, `hidden_length` times `layers_length` f32, the first layer
/// then the second, each from -1 to 1.
#[unsafe(no_mangle)]
pub extern "C" fn show_hidden() -> *const f32 {
    pointer(walker().map(|walker| &walker.show.brain.hidden[..]))
}

/// What the show's brain is keeping in memory for its next step, `memory_length` f32.
#[unsafe(no_mangle)]
pub extern "C" fn show_memory() -> *const f32 {
    pointer(walker().map(|walker| &walker.show.brain.memory[..]))
}

/// What its outputs gave last, `outputs_length` f32, each from -1 to 1, one for each joint.
#[unsafe(no_mangle)]
pub extern "C" fn show_outputs() -> *const f32 {
    pointer(walker().map(|walker| &walker.show.brain.outputs[..]))
}

/// The weights the show's walker runs on, `weights_length` f32, to draw the brain's connections.
#[unsafe(no_mangle)]
pub extern "C" fn show_weights() -> *const f32 {
    pointer(walker().map(|walker| &walker.show.weights[..]))
}

/// Starts the crowd: every brain of the current generation, each walking in its own world from the
/// start. Returns how many walkers there are.
#[unsafe(no_mangle)]
pub extern "C" fn crowd_reset() -> u32 {
    let Some(walker) = walker() else { return 0 };
    let trainer = &walker.trainer;
    let crowd = Crowd::new(&trainer.start, &trainer.creature, trainer.layout, &trainer.population, trainer.judge());
    let count = crowd.worlds.len() as u32;
    walker.crowd = Some(crowd);
    count
}

/// Room for `count` brains, one after another, for the page to write a generation into before
/// calling `crowd_start`.
#[unsafe(no_mangle)]
pub extern "C" fn crowd_room(count: u32) -> *mut f32 {
    let Some(walker) = walker() else { return core::ptr::null_mut() };
    let length = walker.trainer.layout.weights() * count.min(1000) as usize;
    walker.crowd_room.clear();
    walker.crowd_room.resize(length, 0.0);
    walker.crowd_room.as_mut_ptr()
}

/// Starts the crowd with the `count` brains written into `crowd_room` in place of this module's
/// own generation. Returns how many walkers there are.
#[unsafe(no_mangle)]
pub extern "C" fn crowd_start(count: u32) -> u32 {
    let Some(walker) = walker() else { return 0 };
    let length = (walker.trainer.layout.weights() * count as usize).min(walker.crowd_room.len());
    let trainer = &walker.trainer;
    let crowd = Crowd::new(&trainer.start, &trainer.creature, trainer.layout, &walker.crowd_room[..length], trainer.judge());
    let count = crowd.worlds.len() as u32;
    walker.crowd = Some(crowd);
    count
}

/// Moves the crowd on by `seconds`, in whole steps, and returns how many were taken.
#[unsafe(no_mangle)]
pub extern "C" fn crowd_step(seconds: f32) -> u32 {
    walker().and_then(|walker| walker.crowd.as_mut()).map_or(0, |crowd| crowd.step(seconds))
}

/// Where each walker in the crowd is, four f32 each: how far it has gone, the height of its body,
/// its body's angle, and 1 once its run is over (else 0). Each stops where its scored run stopped.
#[unsafe(no_mangle)]
pub extern "C" fn crowd_bodies() -> *const f32 {
    pointer(walker().and_then(|walker| walker.crowd.as_ref()).map(|crowd| &crowd.drawn[..]))
}

/// Stops the crowd and frees its worlds.
#[unsafe(no_mangle)]
pub extern "C" fn crowd_stop() {
    if let Some(walker) = walker() {
        walker.crowd = None;
    }
}
