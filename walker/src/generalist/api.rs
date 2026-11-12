//! What the generalist's page calls, in `generalist.wasm`. Every function takes and gives plain
//! numbers; lists stay in the module's memory, a function giving a pointer to the first f32 and
//! another the length, as the Walker's do. A pointer is good until the next call. The work is all in
//! `page`; README.md lists each function.
//!
//! It is built only without the Walker (`--no-default-features --features generalist`), so the two
//! modules can use the same plain names.

use alloc::vec::Vec;

use super::page::Page;
use super::recipe::Recipe;
use crate::Shared;
use crate::math::Vec2;

static PAGE: Shared<Option<Page>> = Shared::new(None);
static LENGTH: Shared<usize> = Shared::new(0);

fn page() -> Option<&'static mut Page> {
    PAGE.get().as_mut()
}

/// A list for the page: its pointer, with its length kept for `length()`.
fn give(list: &[f32]) -> *const f32 {
    *LENGTH.get() = list.len();
    list.as_ptr()
}

/// The length of the list the last call gave, in f32.
#[unsafe(no_mangle)]
pub extern "C" fn length() -> u32 {
    *LENGTH.get() as u32
}

/// Makes a creature of `legs` legs (2 or 4) learning by evolution in the world of this recipe: a
/// seed, a difficulty from 0 to 1, and an amount from 0 to 1 of ground, hazards, boxes and moving
/// things. `population` brains a generation, brains of `layers` hidden layers of `hidden` neurons
/// with `memory` memories, runs of `seconds` (30 if 0), first brains from `brain_seed`. Returns the
/// number of weights in a brain, or 0 if the legs are not 2 or 4.
#[unsafe(no_mangle)]
pub extern "C" fn create(legs: u32, seed: u32, difficulty: f32, ground: f32, hazards: f32, boxes: f32, moving: f32, population: u32, hidden: u32, layers: u32, memory: u32, seconds: f32, brain_seed: u32) -> u32 {
    let recipe = Recipe { seed, difficulty, amounts: [ground, hazards, boxes, moving] };
    *PAGE.get() = Page::new(recipe, legs, population as usize, hidden as usize, layers as usize, memory as usize, seconds, brain_seed as u64);
    page().map_or(0, |page| page.evolution.layout.weights() as u32)
}

macro_rules! number {
    ($name:ident, $type:ty, $default:expr, |$page:ident| $body:expr) => {
        #[unsafe(no_mangle)]
        pub extern "C" fn $name() -> $type {
            page().map_or($default, |$page| $body)
        }
    };
}

macro_rules! list {
    ($name:ident, |$page:ident| $body:expr) => {
        #[unsafe(no_mangle)]
        pub extern "C" fn $name() -> *const f32 {
            match page() {
                Some($page) => give($body),
                None => give(&[]),
            }
        }
    };
}

// learning
/// Trains for up to `runs` runs; returns the number of generations finished.
#[unsafe(no_mangle)]
pub extern "C" fn train(runs: u32) -> u32 {
    page().map_or(0, |page| page.evolution.train(runs.min(10_000) as usize))
}
number!(generation, u32, 0, |page| page.evolution.generation);
number!(generation_runs, u32, 0, |page| page.evolution.scored.iter().filter(|s| **s).count() as u32);
number!(best_score, f32, f32::NEG_INFINITY, |page| page.evolution.best_score);
number!(best_distance, f32, 0.0, |page| page.evolution.best_distance);
number!(weights_length, u32, 0, |page| page.evolution.layout.weights() as u32);
number!(population_length, u32, 0, |page| page.evolution.size as u32);
number!(senses_length, u32, 0, |page| page.senses() as u32);
number!(actions_length, u32, 0, |page| page.actions() as u32);
number!(rays_length, u32, 0, |page| page.rays_length() as u32);
list!(best_weights, |page| &page.evolution.best);
list!(population_weights, |page| &page.evolution.population);
list!(history_best, |page| &page.evolution.history_best);
list!(history_mean, |page| &page.evolution.history_mean);
list!(history_distance, |page| &page.evolution.history_distance);

/// Room for `count` brains to run for another module's evolution.
#[unsafe(no_mangle)]
pub extern "C" fn evaluate_room(count: u32) -> *mut f32 {
    let Some(page) = page() else { return core::ptr::null_mut() };
    let length = page.evolution.layout.weights() * count.min(1000) as usize;
    page.evaluate_room.clear();
    page.evaluate_room.resize(length, 0.0);
    page.evaluate_room.as_mut_ptr()
}

/// Runs the brains in `evaluate_room` as training does; returns how many it ran.
#[unsafe(no_mangle)]
pub extern "C" fn evaluate(count: u32) -> u32 {
    let Some(page) = page() else { return 0 };
    let size = page.evolution.layout.weights();
    let count = (count as usize).min(page.evaluate_room.len() / size.max(1));
    let brains: Vec<f32> = page.evaluate_room[..count * size].to_vec();
    page.evaluated.clear();
    page.evaluated.resize(2 * count, 0.0);
    page.evolution.evaluate(&brains, &mut page.evaluated);
    count as u32
}

list!(evaluated, |page| &page.evaluated);

/// 1 if that member of this generation has its score, else 0.
#[unsafe(no_mangle)]
pub extern "C" fn member_scored(index: u32) -> u32 {
    page().map_or(0, |page| u32::from(page.evolution.scored.get(index as usize).copied().unwrap_or(false)))
}

/// Gives a member the score and distance a helper found; returns the generations finished.
#[unsafe(no_mangle)]
pub extern "C" fn record(index: u32, score: f32, distance: f32) -> u32 {
    let Some(page) = page() else { return 0 };
    page.evolution.record(index as usize, score, distance);
    page.evolution.generation
}

/// Room for one brain's weights, to load.
#[unsafe(no_mangle)]
pub extern "C" fn weights_room() -> *mut f32 {
    page().map_or(core::ptr::null_mut(), |page| page.weights_room.as_mut_ptr())
}

/// Takes in the brain in `weights_room` as the best so far, and starts the show with it. 1 if it
/// could, 0 if any weight was not a number.
#[unsafe(no_mangle)]
pub extern "C" fn weights_load() -> u32 {
    let Some(page) = page() else { return 0 };
    let weights = page.weights_room.clone();
    let loaded = page.evolution.load(&weights);
    if loaded {
        page.show_reset();
    }
    u32::from(loaded)
}

// the show
#[unsafe(no_mangle)]
pub extern "C" fn show_reset() {
    if let Some(page) = page() {
        page.show_reset();
    }
}

/// Moves the show on by `seconds`; returns the steps taken.
#[unsafe(no_mangle)]
pub extern "C" fn show_step(seconds: f32) -> u32 {
    page().map_or(0, |page| page.show_step(seconds))
}

number!(show_over, u32, 0, |page| u32::from(page.show.judge.over() && page.held.is_none()));
number!(show_end, u32, 0, |page| page.show.judge.end as u32);
number!(show_distance, f32, 0.0, |page| page.show.distance());
number!(show_furthest, f32, 0.0, |page| page.show.judge.furthest);
number!(show_score, f32, 0.0, |page| page.show.judge.score);
number!(show_seconds, f32, 0.0, |page| page.show.judge.steps as f32 * crate::physics::STEP);
number!(legs_length, u32, 0, |page| page.legs);
number!(show_hop, u32, 0, |page| u32::from(matches!(page.show.body.hop, super::body::Hop::Crouch(_) | super::body::Hop::Spring(_))));
list!(show_bodies, |page| page.bodies());
list!(show_things, |page| page.things());
list!(show_rays, |page| page.rays());
list!(ray_angles, |page| page.ray_angles());

/// Pushes the body or box nearest (x, y) with an impulse in newton seconds; its number, or -1.
#[unsafe(no_mangle)]
pub extern "C" fn show_push(x: f32, y: f32, impulse_x: f32, impulse_y: f32) -> i32 {
    page().map_or(-1, |page| page.show_push(Vec2::new(x, y), Vec2::new(impulse_x, impulse_y)))
}

/// Holds the creature's body toward (x, y), as a hand carrying it, until `show_drop`.
#[unsafe(no_mangle)]
pub extern "C" fn show_hold(x: f32, y: f32) {
    if let Some(page) = page() {
        page.held = Some(Vec2::new(x, y));
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn show_drop() {
    if let Some(page) = page() {
        page.held = None;
    }
}

// the world, to draw
/// The show's ground from piece `from` on, the world made at least to `until` metres: four f32 a
/// piece, x1, y1, x2, y2.
#[unsafe(no_mangle)]
pub extern "C" fn land_ground(until: f32, from: u32) -> *const f32 {
    match page() {
        Some(page) => give(page.ground(until.min(1.0e6), from as usize)),
        None => give(&[]),
    }
}

/// The floating platforms from number `from` on: lowest x and y, highest x and y.
#[unsafe(no_mangle)]
pub extern "C" fn land_blocks(from: u32) -> *const f32 {
    match page() {
        Some(page) => give(page.blocks(from as usize)),
        None => give(&[]),
    }
}

/// The hazards from number `from` on: lowest x and y, highest x and y, and 0 water or 1 spikes.
#[unsafe(no_mangle)]
pub extern "C" fn land_hazards(from: u32) -> *const f32 {
    match page() {
        Some(page) => give(page.hazards(from as usize)),
        None => give(&[]),
    }
}

/// What the show's creature would see as a picture: `count` greyscale pixels from 0 to 1.
#[unsafe(no_mangle)]
pub extern "C" fn picture(count: u32) -> *const f32 {
    match page() {
        Some(page) => give(page.picture(count as usize)),
        None => give(&[]),
    }
}

// many creatures for a learner
/// Makes `count` creatures (up to 4096) to step together; `alike` 1 puts them all in the recipe's
/// world, 0 each in the world of the seed plus its number. Returns how many.
#[unsafe(no_mangle)]
pub extern "C" fn envs_create(count: u32, alike: u32) -> u32 {
    page().map_or(0, |page| page.envs_create(count as usize, alike != 0) as u32)
}

/// Room for every creature's actions, `actions_length` f32 each, -1 to 1.
#[unsafe(no_mangle)]
pub extern "C" fn envs_actions() -> *mut f32 {
    match page().and_then(|page| page.envs.as_mut()) {
        Some(stepped) => {
            *LENGTH.get() = stepped.actions.len();
            stepped.actions.as_mut_ptr()
        }
        None => core::ptr::null_mut(),
    }
}

/// Steps every creature `steps` times; returns the steps taken by all together.
#[unsafe(no_mangle)]
pub extern "C" fn envs_step(steps: u32) -> u32 {
    page().map_or(0, |page| page.envs_step(steps as usize) as u32)
}

macro_rules! stepped {
    ($name:ident, $field:ident) => {
        #[unsafe(no_mangle)]
        pub extern "C" fn $name() -> *const f32 {
            match page().and_then(|page| page.envs.as_ref()) {
                Some(stepped) => give(&stepped.$field),
                None => give(&[]),
            }
        }
    };
}

stepped!(envs_observations, observations);
stepped!(envs_rewards, rewards);
stepped!(envs_done, done);
