//! The generalist: a creature that sees, learns and gets about a generated world by itself. It is a
//! second mini on the Walker's engine, sharing its physics, its body, its brain and its evolution,
//! and built into a module of its own (`bun run wasm` makes `generalist.wasm`), so the Walker's own
//! module is left as it was.
//!
//! - `recipe`: what a world is made from, a seed, a difficulty and an amount of each kind of thing,
//!   and the pieces a recipe is planned into, in order along the way.
//! - `land`: the pieces built into ground, blocks, hazards and the things that move.
//! - `check`: proof that a body of the creature's reach can get from the start to the end.
//!
//! README.md describes the recipe, the pieces and the table of what difficulty means.

pub mod check;
pub mod land;
pub mod recipe;

#[cfg(test)]
mod tests;
