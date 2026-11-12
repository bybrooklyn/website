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
//! - `stage`: a land put into the physics around one creature, laid ahead and dropped behind as it
//!   goes, its boxes, moving platforms and see-saws made as it comes near.
//!
//! README.md describes the recipe, the pieces and the table of what difficulty means.

pub mod body;
pub mod check;
pub mod eyes;
pub mod land;
pub mod recipe;
pub mod stage;

#[cfg(test)]
mod body_tests;
#[cfg(test)]
mod eyes_tests;
#[cfg(test)]
mod stage_tests;
#[cfg(test)]
mod tests;
