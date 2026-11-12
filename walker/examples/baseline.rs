//! How far evolution gets the generalist, the baseline gradient learning will be measured against.
//! Trains natively, from fixed seeds, on worlds of everything switched on at difficulties 0.1, 0.3,
//! 0.5 and 0.8, for both bodies, and prints the furthest any brain of each generation got through the
//! world, every so many generations, with the time it had taken on one core.
//!
//!     cargo run --release --example baseline [generations]
//!
//! Each world and body trains on a thread of its own, so the times are each one core's.

use std::time::Instant;

use walker::generalist::evolve::Evolution;
use walker::generalist::recipe::Recipe;

/// The page's settings: 32 brains of two layers of 16 with 4 memories, runs of up to 30 seconds.
const POPULATION: usize = 32;
const HIDDEN: usize = 16;
const LAYERS: usize = 2;
const MEMORY: usize = 4;
const SECONDS: f32 = 30.0;
/// The world's seed and the seed of the first brains.
const WORLD: u32 = 1;
const BRAINS: u64 = 1;

fn main() {
    let generations: u32 = std::env::args().nth(1).and_then(|n| n.parse().ok()).unwrap_or(200);
    let marks: Vec<u32> = [1, 10, 25, 50, 100, 200, 400].into_iter().filter(|&g| g <= generations).collect();
    let mut threads = Vec::new();
    for legs in [2, 4] {
        for difficulty in [0.1f32, 0.3, 0.5, 0.8] {
            let marks = marks.clone();
            threads.push(std::thread::spawn(move || {
                let recipe = Recipe { seed: WORLD, difficulty, amounts: [1.0; 4] };
                let mut evolution = Evolution::new(recipe, legs, POPULATION, HIDDEN, LAYERS, MEMORY, SECONDS, BRAINS).unwrap();
                let started = Instant::now();
                let mut rows = Vec::new();
                while evolution.generation < generations {
                    let before = evolution.generation;
                    evolution.train(1);
                    if evolution.generation == before {
                        continue;
                    }
                    if marks.contains(&evolution.generation) {
                        let g = evolution.generation as usize;
                        let furthest = evolution.history_distance[..g].iter().fold(0.0f32, |a, &b| a.max(b));
                        rows.push((evolution.generation, evolution.history_distance[g - 1], furthest, started.elapsed().as_secs_f32(), evolution.steps));
                    }
                }
                (legs, difficulty, rows)
            }));
        }
    }
    println!("legs  difficulty  generation  furthest this generation  furthest so far  seconds  steps");
    for thread in threads {
        let (legs, difficulty, rows) = thread.join().unwrap();
        for (generation, now, best, seconds, steps) in rows {
            println!("{legs}     {difficulty:.1}         {generation:>4}        {now:>6.1} m                  {best:>6.1} m        {seconds:>6.1}   {steps}");
        }
    }
}
