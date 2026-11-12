//! What many creatures stepped together are held to: a creature's run depends on its world's seed and
//! its actions alone, however many are stepped beside it; its rewards add up to its score; a hazard
//! ends a run and costs; evolution learns the same way however its runs are shared out, and learns;
//! and stepping is quick. And a fingerprint of a few hundred steps, which the page's engine must give
//! too (`src/minis/generalist.test.ts`).

use alloc::rc::Rc;
use alloc::vec;
use alloc::vec::Vec;

use super::envs::{End, Envs, HAZARD_COST, Run};
use super::evolve::Evolution;
use super::land::Land;
use super::recipe::{Kind, Piece, Recipe};
use crate::math::sin_cos;

fn recipe(seed: u32, difficulty: f32) -> Recipe {
    Recipe { seed, difficulty, amounts: [1.0; 4] }
}

/// The action of creature i at a step: a wave of its own, the same whoever else is stepped.
fn action(i: usize, step: usize, k: usize) -> f32 {
    sin_cos(0.05 * step as f32 * (1.0 + 0.1 * k as f32) + i as f32 + 0.3 * k as f32).0 * if k == 12 { 1.2 } else { 0.9 }
}

/// An action made of whole numbers alone, so the page can make the very same one without a sine.
fn pattern(i: usize, step: usize, k: usize) -> f32 {
    (((i * 7 + step * 13 + k * 5) % 21) as f32 - 10.0) / 10.0
}

/// FNV-1a over the bits of numbers, in order.
fn mix(hash: &mut u64, values: &[f32]) {
    for value in values {
        for byte in value.to_bits().to_le_bytes() {
            *hash ^= byte as u64;
            *hash = hash.wrapping_mul(0x100_0000_01b3);
        }
    }
}

/// Every observation and reward of creature `which` over `steps` steps, among `count` stepped together.
fn trace(count: usize, which: usize, steps: usize) -> Vec<u32> {
    let mut envs = Envs::new(recipe(11, 0.5), 2, count, 20.0, false).unwrap();
    let (senses, wide) = (envs.senses(), envs.actions());
    let (mut observations, mut actions, mut rewards, mut done) = (vec![0.0; count * senses], vec![0.0; count * wide], vec![0.0; count], vec![0.0; count]);
    envs.observe(&mut observations);
    let mut out = Vec::new();
    for step in 0..steps {
        for i in 0..count {
            for k in 0..wide {
                actions[i * wide + k] = action(i, step, k);
            }
        }
        envs.step(&actions, &mut observations, &mut rewards, &mut done);
        out.extend(observations[which * senses..(which + 1) * senses].iter().map(|x| x.to_bits()));
        out.push(rewards[which].to_bits());
        out.push(done[which].to_bits());
    }
    out
}

#[test]
fn a_creatures_run_is_the_same_however_many_are_stepped_beside_it() {
    let alone = trace(1, 0, 900);
    assert_eq!(alone, trace(3, 0, 900));
    assert_eq!(alone, trace(8, 0, 900));
    assert_eq!(trace(3, 2, 900), trace(8, 2, 900));
    assert_ne!(trace(3, 1, 900), trace(3, 2, 900), "each in a world of its own");
}

#[test]
fn a_runs_rewards_add_up_to_its_score_which_is_how_far_it_got_less_what_it_cost() {
    let mut envs = Envs::new(recipe(2, 0.3), 4, 4, 15.0, false).unwrap();
    let (senses, wide) = (envs.senses(), envs.actions());
    assert_eq!((senses, wide), (124, 25));
    let (mut observations, mut actions, mut rewards, mut done) = (vec![0.0; 4 * senses], vec![0.0; 4 * wide], vec![0.0; 4], vec![0.0; 4]);
    let stride = crate::body::Description { legs: 4, carry: false, leap: false }.stride();
    let mut summed = [0.0f32; 4];
    let mut ended = [false; 4];
    for step in 0..2000 {
        for i in 0..4 {
            actions[i * wide..i * wide + stride.len()].copy_from_slice(stride);
            actions[i * wide + wide - 1] = if step % 70 == 35 { 1.0 } else { -1.0 };
        }
        envs.step(&actions, &mut observations, &mut rewards, &mut done);
        for i in 0..4 {
            if ended[i] {
                continue;
            }
            summed[i] += rewards[i];
            if done[i] == 1.0 {
                ended[i] = true;
                assert!((summed[i] - envs.finished[i]).abs() < 1e-3, "rewards add up to {}, the score is {}", summed[i], envs.finished[i]);
                assert!(envs.finished[i] <= envs.distances[i] + 1e-4);
                assert!(envs.distances[i] > 1.0, "the stride gets somewhere: {}", envs.distances[i]);
            }
        }
        assert!(observations.iter().all(|x| x.is_finite()));
    }
    assert!(ended.iter().all(|e| *e));
}

#[test]
fn a_hazard_ends_a_run_and_costs() {
    let land = Rc::new(Land::from_pieces_unchecked(&[Piece::new(Kind::Water, 3.0, 0.0, 3.0)], 40.0));
    let pool = land.geometry.hazards[0];
    let mut run = Run::new(land, 2, 20.0).unwrap();
    // set down over the middle of the pool
    let torso = run.body.creature.torso as usize;
    let dx = 0.5 * (pool.low.x + pool.high.x) - run.stage.world.bodies[torso].position.x;
    for part in torso..torso + 5 {
        run.stage.world.bodies[part].position.x += dx;
    }
    let actions = vec![0.0; run.body.actions()];
    let mut reward = 0.0;
    for _ in 0..120 {
        run.before_step(&actions);
        run.stage.world.step();
        reward = run.judge.after_step(&run.stage, &run.body, &actions);
        if run.judge.over() {
            break;
        }
    }
    assert_eq!(run.judge.end, End::Hazard);
    assert!(reward < -HAZARD_COST + 1.0, "the last step cost {reward}");
}

#[test]
fn evolution_learns_the_same_way_however_its_runs_are_shared_out_and_gets_further() {
    let world = recipe(5, 0.1);
    let mut alone = Evolution::new(world, 2, 12, 8, 1, 0, 8.0, 3).unwrap();
    while alone.generation < 4 {
        alone.train(5);
    }
    let mut lead = Evolution::new(world, 2, 12, 8, 1, 0, 8.0, 3).unwrap();
    let mut helper = Evolution::new(world, 2, 12, 8, 1, 0, 8.0, 99).unwrap();
    let count = lead.layout.weights();
    while lead.generation < 4 {
        let todo: Vec<usize> = (0..12).filter(|&i| !lead.scored[i]).collect();
        let brains: Vec<f32> = todo.iter().flat_map(|&i| lead.weights(i).to_vec()).collect();
        let mut found = vec![0.0; 2 * todo.len()];
        helper.evaluate(&brains, &mut found);
        for (k, &i) in todo.iter().enumerate().rev() {
            lead.record(i, found[2 * k], found[2 * k + 1]);
        }
        let _ = count;
    }
    assert_eq!(alone.best.iter().map(|w| w.to_bits()).collect::<Vec<_>>(), lead.best.iter().map(|w| w.to_bits()).collect::<Vec<_>>());
    assert_eq!(alone.history_best, lead.history_best);
    // and over more generations it gets further on an easy world
    while alone.generation < 25 {
        alone.train(12);
    }
    let first = alone.history_distance[0];
    let last = alone.history_distance[24];
    assert!(last > first && alone.best_distance > 1.5, "furthest {first} at first, {last} after 25 generations");
}

// Natively, on the machine this was written on (a Ryzen 7 9700X, busy with other work), 64 two-legged
// creatures, seeing with sixteen rays each, stepped about 340,000 times a second on one core.
const FLOOR: f64 = 30_000.0;

#[test]
fn many_creatures_step_quickly() {
    let mut envs = Envs::new(recipe(1, 0.5), 2, 64, 30.0, false).unwrap();
    let (senses, wide) = (envs.senses(), envs.actions());
    let (mut observations, mut actions, mut rewards, mut done) = (vec![0.0; 64 * senses], vec![0.0; 64 * wide], vec![0.0; 64], vec![0.0; 64]);
    let mut best = 0.0f64;
    for round in 0..3 {
        let started = std::time::Instant::now();
        let before = envs.steps;
        for step in 0..300 {
            for (k, a) in actions.iter_mut().enumerate() {
                *a = action(k / wide, step + 300 * round, k % wide);
            }
            envs.step(&actions, &mut observations, &mut rewards, &mut done);
        }
        best = best.max((envs.steps - before) as f64 / started.elapsed().as_secs_f64());
    }
    std::println!("64 creatures step {best:.0} times a second together, seeing as they go");
    assert!(best > FLOOR, "{best:.0} steps a second, under the floor of {FLOOR}");
}

/// What the page's engine must give too: every observation and reward of three creatures over 600
/// steps, and the best scores of three generations of evolution.
pub fn fingerprint() -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    let mut envs = Envs::new(recipe(7, 0.5), 2, 3, 5.0, false).unwrap();
    let (senses, wide) = (envs.senses(), envs.actions());
    let (mut observations, mut actions, mut rewards, mut done) = (vec![0.0; 3 * senses], vec![0.0; 3 * wide], vec![0.0; 3], vec![0.0; 3]);
    envs.observe(&mut observations);
    mix(&mut hash, &observations);
    for step in 0..600 {
        for (k, a) in actions.iter_mut().enumerate() {
            *a = pattern(k / wide, step, k % wide);
        }
        envs.step(&actions, &mut observations, &mut rewards, &mut done);
        mix(&mut hash, &observations);
        mix(&mut hash, &rewards);
        mix(&mut hash, &done);
    }
    let mut evolution = Evolution::new(recipe(7, 0.5), 2, 8, 8, 1, 0, 5.0, 1).unwrap();
    while evolution.generation < 3 {
        evolution.train(8);
    }
    mix(&mut hash, &evolution.history_best);
    hash
}

pub const FINGERPRINT: u64 = 0x1d45_39ff_bd3e_5f4d;

#[test]
fn the_fingerprint_is_the_one_the_page_holds_its_engine_to() {
    let made = fingerprint();
    std::println!("fingerprint {made:#018x}");
    assert_eq!(made, FINGERPRINT);
}
