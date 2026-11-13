//! Learning by practice, natively, from fixed seeds: one learner in fresh worlds of a recipe's kind,
//! measured every so often on held-out worlds it never practised in. Prints a learning curve: steps of
//! the physics, seconds on one core, and how far it gets through the held-out worlds (their average,
//! acting without drawing).
//!
//!     cargo run --release --example practice -- legs=2 difficulty=0.1 steps=20000000 seed=1
//!
//! Any setting of `Settings`, `Way` and `Shaping` can be given as name=value (see `set` below), so
//! the measurements behind the settings can be made again.

use std::time::Instant;

use walker::generalist::net::Squash;
use walker::generalist::ppo::Settings;
use walker::generalist::practice::{Curriculum, Practice, Way, held_out};
use walker::generalist::recipe::Recipe;

fn main() {
    let mut legs = 2;
    let mut difficulty = 0.1f32;
    let mut budget: u64 = 10_000_000;
    let mut seed = 1u64;
    let mut count = 32usize;
    let mut every: u64 = 1_000_000;
    let mut held = 16usize;
    let mut settings = Settings::default();
    let mut way;
    let mut overrides = Vec::new();
    let mut timing = false;
    let mut workers = 1usize;
    let mut trace = false;
    let mut curriculum = false;
    let mut pretrain = 0u64;
    let mut pretrain_difficulty = 0.1f32;
    let (mut collect_time, mut train_time) = (0.0f64, 0.0f64);
    for arg in std::env::args().skip(1) {
        let Some((name, value)) = arg.split_once('=') else { continue };
        let number = || value.parse::<f64>().unwrap_or_else(|_| panic!("{arg}"));
        match name {
            "legs" => legs = number() as u32,
            "difficulty" => difficulty = number() as f32,
            "steps" => budget = number() as u64,
            "seed" => seed = number() as u64,
            "count" => count = number() as usize,
            "every" => every = number() as u64,
            "held" => held = number() as usize,
            "time" => timing = number() != 0.0,
            "workers" => workers = number() as usize,
            "trace" => trace = number() != 0.0,
            "curriculum" => curriculum = number() != 0.0,
            "pretrain" => pretrain = number() as u64,
            "pretrain_difficulty" => pretrain_difficulty = number() as f32,
            _ => overrides.push((name.to_string(), value.to_string())),
        }
    }
    way = Way::of(legs);
    for (name, value) in &overrides {
        let number = value.parse::<f64>().unwrap_or(0.0);
        match name.as_str() {
            "hidden" => settings.hidden = number as usize,
            "layers" => settings.layers = number as usize,
            "squash" => settings.squash = if value == "relu" { Squash::Relu } else { Squash::Tanh },
            "shared" => settings.shared = number != 0.0,
            "rollout" => settings.steps = number as usize,
            "epochs" => settings.epochs = number as usize,
            "minibatches" => settings.minibatches = number as usize,
            "rate" => settings.rate = number as f32,
            "floor" => settings.rate_floor = number as f32,
            "schedule" => settings.schedule = number as u32,
            "gamma" => settings.gamma = number as f32,
            "lambda" => settings.lambda = number as f32,
            "clip" => settings.clip = number as f32,
            "entropy" => settings.entropy_weight = number as f32,
            "norm" => settings.most_norm = number as f32,
            "spread" => settings.spread_start = number as f32,
            "scale" => settings.scale_rewards = number != 0.0,
            "direct" => way.direct = number != 0.0,
            "skip" => way.skip = number as u32,
            "seconds" => way.seconds = number as f32,
            "alive" => way.shaping.alive = number as f32,
            "energy" => way.shaping.energy = number as f32,
            "air" => way.shaping.air = number as f32,
            "hop" => way.hop = number != 0.0,
            "ramp" => way.ramp = number as u64,
            "ease" => way.ease = number as f32,
            "strength" => way.strength = number as f32,
            "tall" => way.shaping.tall = number != 0.0,
            "smooth" => way.shaping.smooth = number as f32,
            "fall" => way.shaping.fall = number as f32,
            _ => panic!("no setting called {name}"),
        }
    }
    let recipe = Recipe { seed: 0, difficulty, amounts: [1.0; 4] };
    let seeds = held_out(held);
    let mut practice = Practice::new(recipe, way, settings, count, seed, seed as u32).unwrap();
    if curriculum {
        practice = practice.with_curriculum(Curriculum::default());
    }
    // first practice this many steps in worlds of another difficulty, then count from nothing: does
    // what was learned there carry over?
    if pretrain > 0 {
        practice.worlds.recipe.difficulty = pretrain_difficulty;
        while practice.worlds.steps < pretrain {
            practice.update();
        }
        practice.worlds.recipe.difficulty = difficulty;
        practice.worlds.steps = 0;
        // the costs were brought in while it practised before; they stay as they are now
        practice.worlds.way.ramp = 0;
        practice.worlds.finished.clear();
    }
    // the page's workers, played one after another: each its own creatures and its own draws, all
    // starting from the first one's weights, averaged after every update
    let mut others: Vec<Practice> = (1..workers).map(|k| Practice::new(recipe, way, settings, count, seed + k as u64, (seed * 64 + k as u64) as u32).unwrap()).collect();
    for other in &mut others {
        other.learner.weights.copy_from_slice(&practice.learner.weights);
    }
    println!("# legs={legs} difficulty={difficulty} seed={seed} count={count} {settings:?} {way:?}");
    println!("steps  seconds  updates  held-out  practice  spread  difficulty  idle-air  joules-a-metre  shown-idle-air  shown-joules-a-metre");
    let mut last_steps = 0u64;
    let started = Instant::now();
    let mut next = 0;
    loop {
        let steps = practice.worlds.steps + others.iter().map(|other| other.worlds.steps).sum::<u64>();
        if steps >= next || steps >= budget {
            let seconds = started.elapsed().as_secs_f32();
            let measured = practice.measure(&seeds);
            let mean = measured.mean();
            let mut finished = std::mem::take(&mut practice.worlds.finished);
            for other in &mut others {
                finished.extend(std::mem::take(&mut other.worlds.finished));
            }
            let metres: f32 = finished.iter().sum();
            let joules = std::mem::take(&mut practice.worlds.joules) / (metres as f64).max(0.01);
            let trained = if finished.is_empty() { 0.0 } else { finished.iter().sum::<f32>() / finished.len() as f32 };
            let idle = std::mem::take(&mut practice.worlds.idle_air) as f64 / (steps - last_steps).max(1) as f64;
            last_steps = steps;
            println!("{steps} {seconds:.1} {} {mean:.2} {trained:.2} {:.3} {:.1} {:.3} {joules:.0} {:.3} {:.0}", practice.learner.updates, practice.learner.spread(), practice.worlds.recipe.difficulty, idle, measured.idle_air, measured.joules_per_metre);
            next += every;
            if steps >= budget {
                if trace {
                    show(&mut practice, seeds[0]);
                }
                break;
            }
        }
        if !others.is_empty() {
            let mut sensed = Vec::new();
            let mut returned = Vec::new();
            let mut total = vec![0.0f32; practice.learner.weights.len()];
            for one in std::iter::once(&mut practice).chain(others.iter_mut()) {
                one.ramp();
                one.learner.collect(&mut one.worlds);
                one.learner.epochs();
                one.learner.updated();
                sensed.push(one.learner.rollout_sensed.clone());
                returned.push(one.learner.rollout_returned.clone());
                for (t, w) in total.iter_mut().zip(&one.learner.weights) {
                    *t += w;
                }
            }
            for t in &mut total {
                *t /= workers as f32;
            }
            for one in std::iter::once(&mut practice).chain(others.iter_mut()) {
                one.learner.weights.copy_from_slice(&total);
                one.learner.take_in(&sensed, &returned);
            }
        } else if timing {
            // how an update's time divides between collecting a rollout and the epochs
            let began = Instant::now();
            practice.ramp();
            practice.learner.collect(&mut practice.worlds);
            let collected = began.elapsed().as_secs_f64();
            let (sensed, returned) = (practice.learner.rollout_sensed.clone(), practice.learner.rollout_returned.clone());
            practice.learner.take_in(&[sensed], &[returned]);
            for _ in 0..practice.learner.settings.epochs {
                practice.learner.shuffle();
                for which in 0..practice.learner.settings.minibatches {
                    practice.learner.gradient(which);
                    practice.learner.apply(None);
                }
            }
            practice.learner.updated();
            collect_time += collected;
            train_time += began.elapsed().as_secs_f64() - collected;
            if practice.learner.updates % 50 == 0 {
                println!("# collecting {:.0}% of the time, the epochs {:.0}%", 100.0 * collect_time / (collect_time + train_time), 100.0 * train_time / (collect_time + train_time));
            }
        } else {
            practice.update();
        }
    }
}

/// How the policy moves through a held-out world, acting without drawing, a line every tenth of a
/// second: where it is, how high its body is above the ground under it, which feet are down, whether it
/// is in the air with nothing ahead to clear, and the hop.
fn show(practice: &mut Practice, seed: u32) {
    use walker::generalist::ppo::Task;
    use walker::generalist::practice::{Worlds, clear_ahead};
    let mut worlds = Worlds::alone(practice.recipe, practice.worlds.way, &[seed]).unwrap();
    let (senses, wide) = (worlds.senses(), worlds.actions());
    let (mut sensed, mut actions, mut rewards, mut ends, mut last) = (vec![0.0; senses], vec![0.0; wide], vec![0.0; 1], vec![0u8; 1], vec![0.0; senses]);
    worlds.observe(&mut sensed);
    let mut decisions = 0;
    println!("# seconds  x  height  feet  idle-air  hop  actions");
    while worlds.going(0) {
        practice.learner.act(&sensed, &mut actions);
        worlds.step(&actions, &mut sensed, &mut rewards, &mut ends, &mut last);
        decisions += 1;
        let run = &worlds.runs[0];
        let world = &run.stage.world;
        let torso = &world.bodies[run.body.creature.torso as usize];
        if decisions % 2 == 0 {
            let feet: String = run.body.creature.legs.iter().map(|leg| if world.bodies[leg.lower as usize].touching { '#' } else { '.' }).collect();
            let height = torso.position.y - world.ground_height(torso.position.x).unwrap_or(f32::NAN);
            let idle = run.body.creature.flying(world) && !clear_ahead(run);
            let shown: Vec<String> = actions.iter().map(|a| format!("{a:+.1}")).collect();
            println!("{:.2} {:.2} {height:.2} {feet} {} {:?} {}", run.judge.steps as f32 / 60.0, run.judge.furthest, if idle { "AIR" } else { "-" }, run.body.hop, shown.join(" "));
        }
    }
}
