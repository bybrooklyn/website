//! Evolution of the rule by which a brain adds and cuts its connections while it lives (stage 5,
//! walker/README.md "The risky bet"), while practice trains the weights. Each generation, `population`
//! rules are drawn about the mean of the best so far (a cross-entropy search over the rule's seven
//! numbers, `wiring::Rule`); each is given to a learner of the page's brain practising from scratch for
//! `steps` steps of the physics, every one of a generation from the same seed so they meet the same luck,
//! a new seed each generation; and each is scored by how far it then goes in the sixteen held-out worlds,
//! still and changing (`Setting::TEST`), half each. The best half's numbers become the next mean, and the
//! spread narrows as they agree.
//!
//! `threads=` how many rules practise at once (4 unless given), `legs=`, `generations=`, `population=`,
//! `steps=`, `seed=`, `price=` (as `compare.rs` has it) and `from=a,b,c,d,e,f,g` to start somewhere other
//! than `Rule::FIRST`. Each rule's score is printed as it comes, and each generation's mean and spread.
//!
//!     cargo run --release --example rule -- legs=2 generations=8 population=8 steps=3000000

use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

use walker::generalist::page::BRAIN;
use walker::generalist::ppo::Settings;
use walker::generalist::practice::{Practice, Way, held_out};
use walker::generalist::recipe::Recipe;
use walker::generalist::wiring::{Grow, NUMBERS, Rule};
use walker::learn::Random;

/// How widely each number is searched at first: the thresholds and the share at birth by about a factor
/// of e, the trace's keeping and the pulls of surprise, eating and hunger by about as much again.
const FIRST_SPREAD: [f32; NUMBERS] = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
/// The least spread a number keeps, so the search never stops looking altogether.
const LEAST_SPREAD: f32 = 0.15;

fn main() {
    let (mut threads, mut legs, mut generations, mut population, mut steps, mut seed, mut price) = (4usize, 2u32, 8usize, 8usize, 3_000_000u64, 1u64, 1.0f32);
    let mut mean = Rule::FIRST.numbers;
    for arg in std::env::args().skip(1) {
        let Some((name, value)) = arg.split_once('=') else { continue };
        match name {
            "threads" => threads = value.parse().unwrap(),
            "legs" => legs = value.parse().unwrap(),
            "generations" => generations = value.parse().unwrap(),
            "population" => population = value.parse().unwrap(),
            "steps" => steps = value.parse().unwrap(),
            "seed" => seed = value.parse().unwrap(),
            "price" => price = value.parse().unwrap(),
            "from" => mean = value.split(',').map(|n| n.parse().unwrap()).collect::<Vec<f32>>().try_into().expect("seven numbers"),
            _ => panic!("no setting called {name}"),
        }
    }
    let recipe = Recipe { seed: 1, difficulty: 0.2, amounts: [0.6, 0.4, 0.4, 0.4] };
    let seeds = held_out(16);
    let mut spread = FIRST_SPREAD;
    let mut random = Random::new(seed ^ 0x7275_6c65_0000_0000);
    let started = std::time::Instant::now();
    for generation in 0..generations {
        // the mean itself is always one of them, so a generation never loses what the last had
        let rules: Vec<Rule> = (0..population)
            .map(|c| {
                let mut numbers = mean;
                if c > 0 {
                    for (n, number) in numbers.iter_mut().enumerate() {
                        *number += spread[n] * random.bell();
                    }
                }
                Rule { numbers }
            })
            .collect();
        let practice_seed = seed * 1000 + generation as u64;
        let scores = Mutex::new(vec![0.0f32; population]);
        let next = AtomicUsize::new(0);
        std::thread::scope(|scope| {
            for _ in 0..threads.max(1) {
                scope.spawn(|| {
                    loop {
                        let c = next.fetch_add(1, Ordering::SeqCst);
                        if c >= population {
                            break;
                        }
                        let settings = Settings { shape: BRAIN, grow: Some(Grow { rule: rules[c], price }), ..Settings::default() };
                        let mut practice = Practice::new(recipe, Way::of(legs), settings, 32, practice_seed, practice_seed as u32).unwrap();
                        while practice.worlds.steps < steps {
                            practice.update();
                        }
                        let still = practice.measure(&seeds).mean();
                        let changing = practice.measure_changing(&seeds).mean();
                        let score = 0.5 * (still + changing);
                        println!(
                            "rule {generation} {c} {:.0} score={score:.2} still={still:.2} changing={changing:.2} joined={:.3} practised={:.3} numbers={}",
                            started.elapsed().as_secs_f32(),
                            practice.joined,
                            practice.learner.joined_share(),
                            rules[c].numbers.iter().map(|n| format!("{n:.3}")).collect::<Vec<_>>().join(",")
                        );
                        scores.lock().unwrap()[c] = score;
                    }
                });
            }
        });
        let scores = scores.into_inner().unwrap();
        let mut order: Vec<usize> = (0..population).collect();
        order.sort_by(|&a, &b| scores[b].total_cmp(&scores[a]));
        let best: Vec<usize> = order[..population.div_ceil(2)].to_vec();
        for n in 0..NUMBERS {
            let values: Vec<f32> = best.iter().map(|&c| rules[c].numbers[n]).collect();
            let m = values.iter().sum::<f32>() / values.len() as f32;
            let s = (values.iter().map(|v| (v - m) * (v - m)).sum::<f32>() / values.len() as f32).sqrt();
            mean[n] = m;
            spread[n] = s.max(LEAST_SPREAD);
        }
        println!(
            "generation {generation} best={:.2} mean_score={:.2} mean={} spread={}",
            scores[order[0]],
            scores.iter().sum::<f32>() / population as f32,
            mean.iter().map(|n| format!("{n:.3}")).collect::<Vec<_>>().join(","),
            spread.iter().map(|n| format!("{n:.3}")).collect::<Vec<_>>().join(",")
        );
    }
}
