//! Evolution against learning by practice, on the same worlds and the same budgets, for the article.
//! One run of one method, from one seed, on one core; it prints, at each mark of steps of the physics,
//! the seconds it had taken, how far its controller gets through sixteen held-out worlds (their
//! average and the furthest), how far through the baseline's world (seed 1), and how it moved in the
//! held-out worlds: the share of its time in the air with nothing ahead to clear, and the motors'
//! work for each metre.
//!
//!     cargo run --release --example compare -- method=evolution legs=2 difficulty=0.1 seed=1 steps=30000000
//!     cargo run --release --example compare -- method=practice legs=2 difficulty=0.1 seed=1 steps=30000000
//!
//! Evolution learns as the page has it: 32 brains of two layers of 16 with 4 memories, in the one
//! world of seed 1, brains drawn from `seed`. Practice learns with the settled `Settings` and `Way`,
//! in a fresh world for every run, its weights and its worlds from `seed`. Neither ever practises in
//! a held-out world (seeds 2 to 17). walker/README.md has the table these make, and the script.
//!
//! Practice's costs can be changed for a trial: `energy=` (each joule), `air=` (each second in the
//! air with nothing to clear), `fall=`, and `ramp=` (the steps over which effort and air come in).
//!
//! Each line ends with how it moved in the held-out worlds (`generalist::gait`): the share of the time
//! with its body or a knee on the ground (`low`) and its body alone (`belly`), the body's height as a
//! share of its standing height and its angle (each mean/spread), how its first two feet's being down
//! goes together (`together`, -1 taking turns), landings of each foot a second, the fewest landings of
//! a foot over the most, how much its strides vary, and whether all that counts as walking.
//!
//! The posture terms can be changed too: `knee=` (each second of a knee down), `upright=` (each second
//! carried tall), `turns=` (each second with one foot down going forward), `down=` (seconds the body may
//! be down before a run ends), `alive=`, `tall=1`; and `name=` labels the lines. `turns=0.5 clock=1
//! pace=0 stall=0 impact=0 lean=0` is how two legs practised until 13 November 2026, and with
//! `knee=0 upright=0 turns=0 down=1` as well, how they practised before the posture terms.
//!
//! The gait trials' settings too (walker/README.md, "How two legs came to walk"): `pace=` (the top
//! speed paid for), `stall=`, `impact=`, `lean=`, `spin=`, `bob=`, `swing=`, `torque=`, `smooth=`, `hip=`,
//! `clock=`, `skip=`, `ease=`, `strength=`, `seconds=`, touch's `touch=` (0 for a body that feels no
//! touch) and `visitor=` (seconds between practice's visitor's visits, 0 for none), and learning's `entropy=`, `rate=`, `spread=`,
//! `gamma=`. `amounts=a,b,c,d` sets the world's four amounts (1 each unless given). Each mark prints
//! an `open` line beside the main one, the gait on open ground in the same worlds, and with `flat=1` a
//! `flat` line, on level ground with nothing on it. `kept=<path>` measures a learner the page kept
//! (`<path>.state` and `<path>.running`, one number to a line) instead of practising.
//!
//! For the transfer measurement, `easy=0.1 switch=10000000` has practice spend its first ten million
//! steps in worlds of difficulty 0.1 and the rest in worlds of the difficulty asked, while it is
//! measured all along in held-out worlds of the difficulty asked:
//!
//!     cargo run --release --example compare -- method=practice legs=2 difficulty=0.8 seed=1 steps=20000000 easy=0.1 switch=10000000

use std::time::Instant;

use walker::brain::Brain;
use walker::generalist::evolve::Evolution;
use walker::generalist::ppo::Settings;
use walker::generalist::practice::{Measured, Practice, Shaping, Way, held_out, measure};
use walker::generalist::recipe::Recipe;

const MARKS: [u64; 8] = [1_000_000, 2_000_000, 5_000_000, 10_000_000, 20_000_000, 30_000_000, 40_000_000, 50_000_000];

fn main() {
    let mut method = String::from("practice");
    let (mut legs, mut difficulty, mut seed, mut budget) = (2u32, 0.1f32, 1u64, 30_000_000u64);
    let (mut energy, mut air, mut fall): (Option<f32>, Option<f32>, Option<f32>) = (None, None, None);
    let mut ramp: Option<u64> = None;
    let (mut easy, mut switch): (Option<f32>, u64) = (None, 0);
    let mut trials: Vec<(String, f32)> = Vec::new();
    let mut kept: Option<String> = None;
    let mut amounts = [1.0f32; 4];
    let mut flat = false;
    for arg in std::env::args().skip(1) {
        let Some((name, value)) = arg.split_once('=') else { continue };
        match name {
            "method" => method = value.to_string(),
            "legs" => legs = value.parse().unwrap(),
            "difficulty" => difficulty = value.parse().unwrap(),
            "seed" => seed = value.parse().unwrap(),
            "steps" => budget = value.parse().unwrap(),
            "energy" => energy = Some(value.parse().unwrap()),
            "air" => air = Some(value.parse().unwrap()),
            "ramp" => ramp = Some(value.parse().unwrap()),
            "fall" => fall = Some(value.parse().unwrap()),
            "easy" => easy = Some(value.parse().unwrap()),
            "switch" => switch = value.parse().unwrap(),
            "amounts" => amounts = value.split(',').map(|n| n.parse().unwrap()).collect::<Vec<f32>>().try_into().unwrap(),
            "name" => method = value.to_string(),
            "kept" => kept = Some(value.to_string()),
            "flat" => flat = value == "1",
            _ => trials.push((name.to_string(), value.parse().unwrap_or_else(|_| panic!("{arg}")))),
        }
    }
    let recipe = Recipe { seed: 1, difficulty, amounts };
    let seeds = held_out(16);
    let marks: Vec<u64> = MARKS.iter().copied().filter(|&m| m <= budget).collect();
    if let Some(easy) = easy {
        method = format!("{method}-from-{easy}");
    }
    let started = Instant::now();
    let say = |steps: u64, measured: Measured, own: f32| {
        let furthest = measured.distances.iter().fold(0.0f32, |a, &b| a.max(b));
        let g = measured.gait;
        println!(
            "{method} {legs} {difficulty} {seed} {steps} {:.1} {:.2} {furthest:.2} {own:.2} {:.3} {:.0} low={:.3} belly={:.3} height={:.2}/{:.2} pitch={:.2}/{:.2} together={:.2} cadence={:.2} balance={:.2} variation={:.2} walks={}",
            started.elapsed().as_secs_f32(),
            measured.mean(),
            measured.idle_air,
            measured.joules_per_metre,
            g.low,
            g.belly,
            g.height,
            g.height_spread,
            g.pitch,
            g.pitch_spread,
            g.together,
            g.cadence,
            g.balance,
            g.variation,
            u8::from(g.walks(legs as usize))
        );
    };
    let also = |kind: &str, steps: u64, measured: &Measured, g: walker::generalist::gait::Gait| {
        println!(
            "{method}-{kind} {legs} {difficulty} {seed} {steps} {:.1} {:.2} 0 0 {:.3} {:.0} low={:.3} belly={:.3} height={:.2}/{:.2} pitch={:.2}/{:.2} together={:.2} cadence={:.2} balance={:.2} variation={:.2} walks={}",
            started.elapsed().as_secs_f32(), measured.mean(), measured.idle_air, measured.joules_per_metre, g.low, g.belly, g.height, g.height_spread, g.pitch, g.pitch_spread, g.together, g.cadence, g.balance, g.variation, u8::from(g.walks(legs as usize))
        );
    };
    if method == "evolution" {
        let mut evolution = Evolution::new(recipe, legs, 32, 16, 2, 4, 30.0, seed).unwrap();
        // evolution's brains shape each joint's swing to the rhythm, decide every step, and may hop; and
        // they are measured by the rules they were bred under, the run's own (a second down ends it),
        // not practice's for two legs (the first touch of the body ends it)
        let shaping = Shaping { down: 1.0, ..Way::of(legs).shaping };
        let way = Way { skip: 1, direct: false, hop: true, shaping, ..Way::of(legs) };
        let layout = evolution.layout;
        for &mark in &marks {
            while evolution.steps < mark {
                evolution.train(1);
            }
            // the best brain so far, each world with a brain of its own, since a brain remembers
            let best = evolution.best.clone();
            let run = |worlds: &[u32]| {
                let mut brains: Vec<Brain> = worlds.iter().map(|_| Brain::with(layout, &best)).collect();
                measure(recipe, way, worlds, |i, senses, actions| {
                    brains[i].think(senses);
                    actions.copy_from_slice(&brains[i].outputs);
                })
            };
            let own = run(&[1]).distances[0];
            say(evolution.steps, run(&seeds), own);
        }
    } else {
        let mut way = Way::of(legs);
        way.shaping.energy = energy.unwrap_or(way.shaping.energy);
        way.shaping.air = air.unwrap_or(way.shaping.air);
        way.shaping.fall = fall.unwrap_or(way.shaping.fall);
        way.ramp = ramp.unwrap_or(way.ramp);
        let mut settings = Settings::default();
        for (name, value) in &trials {
            let (value, on) = (*value, *value != 0.0);
            match name.as_str() {
                "direct" => way.direct = on,
                "knee" => way.shaping.knee = value,
                "upright" => way.shaping.upright = value,
                "down" => way.shaping.down = value,
                "turns" => way.shaping.turns = value,
                "alive" => way.shaping.alive = value,
                "tall" => way.shaping.tall = on,
                "pace" => way.shaping.pace = value,
                "impact" => way.shaping.impact = value,
                "spin" => way.shaping.spin = value,
                "bob" => way.shaping.bob = value,
                "swing" => way.shaping.swing = value,
                "torque" => way.shaping.torque = value,
                "stall" => way.shaping.stall = value,
                "lean" => way.shaping.lean = value,
                "smooth" => way.shaping.smooth = value,
                "hip" => way.hip = value,
                "clock" => way.clock = on,
                "touch" => way.touch = on,
                "visitor" => way.visitor = value,
                "skip" => way.skip = value as u32,
                "ease" => way.ease = value,
                "strength" => way.strength = value,
                "seconds" => way.seconds = value,
                "entropy" => settings.entropy_weight = value,
                "rate" => settings.rate = value,
                "spread" => settings.spread_start = value,
                "gamma" => settings.gamma = value,
                _ => panic!("no setting called {name}"),
            }
        }
        // practising first in easier worlds, if asked, while measured in worlds of the difficulty asked
        let first = Recipe { difficulty: easy.unwrap_or(difficulty), ..recipe };
        let mut practice = Practice::new(first, way, settings, 32, seed, seed as u32).unwrap();
        practice.recipe = recipe;
        // a learner kept by the page, its state in `<kept>.state` and running numbers in
        // `<kept>.running`, one number to a line: measured as it is rather than practised further
        if let Some(path) = &kept {
            let read = |path: &str| -> Vec<f64> { std::fs::read_to_string(path).unwrap().split_whitespace().map(|n| n.parse().unwrap()).collect() };
            let state: Vec<f32> = read(&format!("{path}.state")).iter().map(|&n| n as f32).collect();
            let running = read(&format!("{path}.running"));
            assert!(practice.load(&state, &running), "the kept learner does not fit this way");
            let own = practice.evaluate(&[1])[0];
            let measured = practice.measure(&seeds);
            also("open", practice.worlds.steps, &measured, measured.open_gait);
            say(practice.worlds.steps, measured, own);
            practice.recipe = Recipe { amounts: [0.0; 4], ..recipe };
            let measured = practice.measure(&seeds);
            also("flat", practice.worlds.steps, &measured, measured.gait);
            return;
        }
        for &mark in &marks {
            while practice.worlds.steps < mark {
                if practice.worlds.steps >= switch {
                    practice.worlds.recipe.difficulty = difficulty;
                }
                practice.update();
            }
            let own = practice.evaluate(&[1])[0];
            let measured = practice.measure(&seeds);
            also("open", practice.worlds.steps, &measured, measured.open_gait);
            say(practice.worlds.steps, measured, own);
            // the same policy on level ground with nothing on it, where a stride has no reason to vary
            if flat {
                let recipe = practice.recipe;
                practice.recipe = Recipe { amounts: [0.0; 4], ..recipe };
                let measured = practice.measure(&seeds);
                practice.recipe = recipe;
                also("flat", practice.worlds.steps, &measured, measured.gait);
            }
        }
    }
}
