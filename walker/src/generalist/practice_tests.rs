//! What learning by practice in generated worlds is held to: practice worlds are never held-out
//! worlds; every run is in a fresh world; the same seed learns the same way to the bit, which the
//! page's engine must match (the fingerprint, `src/minis/generalist.test.ts`); a learner kept and
//! taken back goes on as if never stopped; and, from a fixed seed, it learns to get well past the
//! level start of worlds it never practised in, which fails if a change stops it improving.

use alloc::vec::Vec;

use super::ppo::{Learner, Settings};
use super::practice::{Practice, Way, held_out, practice_seed};
use super::recipe::Recipe;

fn recipe(difficulty: f32) -> Recipe {
    Recipe { seed: 1, difficulty, amounts: [1.0; 4] }
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

/// The fingerprint of a small learner's state after two updates, which the page's engine must give.
pub const FINGERPRINT: u64 = 0xb4ea_800f_279a_20e8;

fn fingerprint() -> u64 {
    let mut practice = Practice::new(recipe(0.5), Way::of(2), Settings::default(), 2, 7, 3).unwrap();
    let mut hash = 0xcbf2_9ce4_8422_2325;
    for _ in 0..2 {
        practice.update();
        mix(&mut hash, &practice.learner.state());
    }
    hash
}

#[test]
fn practice_worlds_are_never_held_out_worlds_and_each_run_is_fresh() {
    let mut seen = Vec::new();
    for creature in 0..50 {
        for run in 0..50 {
            let seed = practice_seed(9, creature, run);
            assert!(seed >= 0x8000_0000);
            seen.push(seed);
        }
    }
    seen.sort();
    seen.dedup();
    assert_eq!(seen.len(), 2500);
    assert!(held_out(1000).iter().all(|&seed| seed > 1 && seed < 0x8000_0000));
}

#[test]
fn the_same_seed_practises_the_same_way_to_the_bit() {
    let first = fingerprint();
    assert_eq!(first, fingerprint());
    std::println!("practice fingerprint {first:#x}");
    if FINGERPRINT != 0 {
        assert_eq!(first, FINGERPRINT);
    }
}

#[test]
fn a_learner_kept_and_taken_back_goes_on_as_if_never_stopped() {
    let settings = Settings { steps: 16, ..Settings::default() };
    let mut whole = Practice::new(recipe(0.3), Way::of(4), settings, 4, 2, 2).unwrap();
    let mut halves = Practice::new(recipe(0.3), Way::of(4), settings, 4, 2, 2).unwrap();
    whole.update();
    halves.update();
    let (state, running) = (halves.learner.state(), halves.learner.running());
    let mut taken = Learner::new(settings, halves.learner.senses, halves.learner.actions, 4, 2);
    assert!(taken.load(&state, &running));
    assert_eq!(taken.state(), state);
    assert_eq!(taken.running(), running);
    // and a list that does not fit is turned away
    assert!(!taken.load(&state[1..], &running));
}

#[test]
fn it_learns_to_get_past_the_start_of_worlds_it_never_practised_in() {
    let mut practice = Practice::new(recipe(0.1), Way::of(2), Settings::default(), 32, 1, 1).unwrap();
    let seeds = held_out(16);
    let mean = |distances: Vec<f32>| distances.iter().sum::<f32>() / distances.len() as f32;
    let before = mean(practice.evaluate(&seeds));
    while practice.worlds.steps < 2_500_000 {
        practice.update();
    }
    let after = mean(practice.evaluate(&seeds));
    std::println!("held out: {before:.2} m at first, {after:.2} m after 2.5 million steps");
    // the start is 4 m of level ground; at first it falls within a metre or two
    assert!(before < 2.5 && after > LEARNED, "{before} m at first, {after} m after practice");
}

/// How far, on average, it must get through the held-out worlds after 2.5 million steps. It got
/// 10.9 m when this was written (5.2 m before the costs on effort, flight and falls, and the smaller
/// first spread); this leaves room for small changes that shift learning a little.
const LEARNED: f32 = 8.0;

#[test]
fn both_bodies_can_step_forward_without_leaving_the_ground_and_it_costs_less_than_hopping() {
    // the best hand-written swings that keep a foot down, found by `stepping_and_hopping_compared`
    for (legs, shape, least) in [(2u32, [0.8f32, 0.4, 0.3, 0.3, 0.0], 5.0f32), (4, [2.2, 0.4, 0.3, 0.6, 0.0], 12.0)] {
        let way = Way { hop: true, ..Way::of(legs) };
        let walked = gait_cost(way, 10.0, stepping(legs, shape));
        assert!(walked.up && walked.distance > least && walked.air < 0.02, "{legs} legs: {walked:?}");
        let hopped = gait_cost(way, 10.0, hopping(0.3, 0.5));
        assert!(hopped.air > 0.2 && hopped.joules_per_metre > 1.5 * walked.joules_per_metre, "{legs} legs: stepping {walked:?}, hopping {hopped:?}");
    }
}

/// What a gait costs on flat ground over a run of `seconds`: how far it went, the share of its time with
/// nothing of it touching the ground, the motors' work for each metre, and whether it stayed up.
#[derive(Clone, Copy, Debug)]
pub struct Cost {
    pub distance: f32,
    pub air: f32,
    pub joules_per_metre: f32,
    pub up: bool,
}

/// Runs a controller written by hand, `act(seconds, actions)`, on flat ground with nothing in the way,
/// deciding every step, and measures what it costs.
pub fn gait_cost(way: Way, seconds: f32, mut act: impl FnMut(f32, &mut [f32])) -> Cost {
    use super::ppo::Task;
    let flat = Recipe { seed: 1, difficulty: 0.0, amounts: [0.0; 4] };
    let way = Way { skip: 1, seconds, ..way };
    let mut worlds = super::practice::Worlds::alone(flat, way, &[1]).unwrap();
    let (senses, wide) = (worlds.senses(), worlds.actions());
    let (mut sensed, mut actions, mut rewards, mut ends, mut last) = (vec![0.0; senses], vec![0.0; wide], vec![0.0; 1], vec![0u8; 1], vec![0.0; senses]);
    let (mut steps, mut flying, mut joules) = (0u32, 0u32, 0.0f32);
    while worlds.going(0) {
        act(steps as f32 * crate::physics::STEP, &mut actions);
        worlds.step(&actions, &mut sensed, &mut rewards, &mut ends, &mut last);
        let run = &worlds.runs[0];
        steps += 1;
        joules += run.body.creature.effort(&run.stage.world);
        if run.body.creature.flying(&run.stage.world) {
            flying += 1;
        }
    }
    let run = &worlds.runs[0];
    let distance = run.judge.furthest;
    Cost { distance, air: flying as f32 / steps.max(1) as f32, joules_per_metre: joules / distance.max(0.01), up: run.judge.end == super::envs::End::Time }
}

/// A stepping controller written by hand, for direct actions: each hip swings as a sine about a
/// centre at `pace` strides a second, each knee bends most as its leg swings forward so the foot
/// clears the ground, the legs half a stride apart (diagonal pairs for four legs). No hop.
pub fn stepping(legs: u32, [pace, centre, swing, bend, lead]: [f32; 5]) -> impl FnMut(f32, &mut [f32]) {
    use crate::math::{PI, sin_cos};
    move |t, actions| {
        let joints = (actions.len() - 1) / 2;
        for leg in 0..joints {
            let shift = if legs == 2 { leg as f32 * 0.5 } else { [0.0, 0.5, 0.5, 0.0][leg] };
            let phase = 2.0 * PI * (pace * t + shift);
            let hip = centre + swing * sin_cos(phase).0;
            let knee = -0.2 - bend * (0.5 + 0.5 * sin_cos(phase + 2.0 * PI * lead).1);
            // from angles to actions: the hips go from -1 to 1.3 radians, the knees from -2 to 0
            actions[2 * leg] = (2.0 * (hip + 1.0) / 2.3 - 1.0).clamp(-1.0, 1.0);
            actions[2 * leg + 1] = (2.0 * (knee + 2.0) / 2.0 - 1.0).clamp(-1.0, 1.0);
        }
        actions[actions.len() - 1] = -1.0;
    }
}

/// Every hand-written stepping swing tried, best first by distance.
fn steppings(way: Way) -> Vec<([f32; 5], Cost)> {
    let legs = way.legs;
    let mut all = Vec::new();
    for &pace in &[0.8f32, 1.2, 1.6, 2.2] {
        for &centre in &[-0.2f32, 0.0, 0.2, 0.4] {
            for &swing in &[0.3f32, 0.5, 0.7] {
                for &bend in &[0.3f32, 0.6, 1.0] {
                    for &lead in &[0.0f32, 0.25, 0.5] {
                        let shape = [pace, centre, swing, bend, lead];
                        all.push((shape, gait_cost(way, 10.0, stepping(legs, shape))));
                    }
                }
            }
        }
    }
    all.sort_by(|a, b| b.1.distance.total_cmp(&a.1.distance));
    all
}

/// Hopping written by hand: the joints held at a pose, the hop asked for whenever it can go.
fn hopping(hip: f32, knee: f32) -> impl FnMut(f32, &mut [f32]) {
    move |_, actions| {
        let joints = (actions.len() - 1) / 2;
        for leg in 0..joints {
            actions[2 * leg] = hip;
            actions[2 * leg + 1] = knee;
        }
        actions[actions.len() - 1] = 1.0;
    }
}

/// Whether the legs can walk the body forward with no hop at all, and what that costs beside hopping:
/// many hand-written stepping swings and hopping poses, on flat ground for 10 s each.
/// `cargo test --release stepping_and_hopping -- --ignored --nocapture`
#[test]
#[ignore]
fn stepping_and_hopping_compared() {
    let strength: f32 = std::env::var("STRENGTH").map_or(1.0, |value| value.parse().unwrap());
    for legs in [2u32, 4] {
        let way = Way { strength, hop: true, ..Way::of(legs) };
        let all = steppings(way);
        let walked = all.iter().filter(|(_, cost)| cost.up && cost.distance > 1.0).count();
        let grounded: Vec<_> = all.iter().filter(|(_, cost)| cost.up && cost.distance > 1.0 && cost.air < 0.02).collect();
        std::println!("{legs} legs: {walked} of {} stepping swings stay up and go more than 1 m in 10 s; {} of them with under 2% of the time in the air", all.len(), grounded.len());
        for (shape, cost) in all.iter().filter(|(_, cost)| cost.up).take(3) {
            std::println!("  stepping {shape:?}: {:.1} m, {:.0}% in the air, {:.0} J a metre", cost.distance, 100.0 * cost.air, cost.joules_per_metre);
        }
        for (shape, cost) in grounded.iter().take(3) {
            std::println!("  stepping, grounded {shape:?}: {:.1} m, {:.0}% in the air, {:.0} J a metre", cost.distance, 100.0 * cost.air, cost.joules_per_metre);
        }
        let mut hops: Vec<_> = [-0.6f32, -0.3, 0.0, 0.3, 0.6].iter().flat_map(|&hip| [-0.5f32, 0.0, 0.5].map(|knee| ((hip, knee), gait_cost(way, 10.0, hopping(hip, knee))))).collect();
        hops.sort_by(|a, b| b.1.distance.total_cmp(&a.1.distance));
        for (pose, cost) in hops.iter().take(4) {
            std::println!("  hopping {pose:?}: {:.1} m, up {}, {:.0}% in the air, {:.0} J a metre", cost.distance, cost.up, 100.0 * cost.air, cost.joules_per_metre);
        }
    }
}
