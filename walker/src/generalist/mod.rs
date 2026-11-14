//! The generalist: a creature that sees, learns and gets about a generated world by itself. It is a
//! second mini on the Walker's engine, sharing its physics, its body, its brain and its evolution,
//! and built into a module of its own (`bun run wasm` makes `generalist.wasm`), so the Walker's own
//! module is left as it was.
//!
//! - `recipe`: what a world is made from, a seed, a difficulty and an amount of each kind of thing,
//!   and the pieces a recipe is planned into, in order along the way.
//! - `land`: the pieces built into ground, blocks, hazards and the things that move.
//! - `check`: proof that a body of the creature's reach can get from the start to the end.
//! - `body`: the Walker's creature with a hop, and arms held out for balance.
//! - `eyes`: a fan of rays from its eye, and a picture from the same world for later.
//! - `envs`: many creatures in many worlds stepped together, for a learner, with the reward.
//! - `evolve`: learning by evolution, as the Walker learns, its runs going through `envs`.
//! - `ppo`: learning by practice, proximal policy optimisation over `net`.
//! - `practice`: the worlds it practises in, fresh for every run, and measuring on held-out worlds.
//! - `needs`: energy that runs down and is restored by food and rest; `curious`: something for reaching
//!   and seeing what it has not before.
//! - `gait`: how a creature moves, in numbers: on its feet or its belly, upright, taking turns.
//! - `mind`: a brain drawn as it thinks, whichever way it learns.
//! - `net`: a small network with its backward pass written by hand, and Adam, for gradient learning.
//! - `page` and `api`: what the page reaches, and the plain functions it calls in `generalist.wasm`.
//! - `stage`: a land put into the physics around one creature, laid ahead and dropped behind as it
//!   goes, its boxes, moving platforms and see-saws made as it comes near.
//!
//! README.md describes the recipe, the pieces and the table of what difficulty means.

#[cfg(not(feature = "walker"))]
pub mod api;
pub mod body;
pub mod check;
pub mod curious;
pub mod envs;
pub mod evolve;
pub mod eyes;
pub mod gait;
pub mod land;
pub mod mind;
pub mod needs;
pub mod net;
pub mod page;
pub mod ppo;
pub mod practice;
pub mod recipe;
pub mod stage;
pub mod tally;
pub mod touch;

#[cfg(test)]
mod body_tests;
#[cfg(test)]
mod envs_tests;
#[cfg(test)]
mod eyes_tests;
#[cfg(test)]
mod net_tests;
#[cfg(test)]
mod page_tests;
#[cfg(test)]
mod ppo_tests;
#[cfg(test)]
mod practice_tests;
#[cfg(test)]
mod stage_tests;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod touch_tests;
#[cfg(test)]
mod wants_tests;
