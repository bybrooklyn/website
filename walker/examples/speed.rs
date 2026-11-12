//! How fast the walker trains natively, and where the time goes, for each number of legs and each
//! size of brain. `cargo run --release --example speed`. Each line times generations 2 to 6 of a
//! walker going far from seed 1, and says how many walker-seconds of physics that was, so the same
//! runs timed in a browser (which gives the same numbers to the bit) can be put beside it.

use std::time::{Duration, Instant};

use walker::body::Description;
use walker::brain::Brain;
use walker::learn::{Settings, Trainer, flat_ground};

pub const SIZES: [(&str, usize, usize, usize); 4] = [("small", 8, 1, 0), ("medium", 16, 2, 4), ("large", 32, 3, 8), ("own 64x4 m8", 64, 4, 8)];

fn main() {
    println!("legs size          gen/s  walker-s/s  ms/gen | physics contacts brain  sense+drive judge (share of a run)");
    let mut steps_json = Vec::new();
    for legs in [1, 2, 4] {
        for (name, hidden, layers, memory) in SIZES {
            let settings = Settings { hidden, layers, memory, ..Settings::default() };
            let mut trainer = Trainer::new(Description { legs, carry: false, leap: false }, settings, &flat_ground(), 1).unwrap();
            while trainer.generation < 2 {
                trainer.train(64);
            }
            let (first, before) = (trainer.generation, trainer.steps);
            let began = Instant::now();
            while trainer.generation < first + 5 {
                trainer.train(64);
            }
            let wall = began.elapsed().as_secs_f64();
            let steps = trainer.steps - before;
            steps_json.push(format!("\"{legs} {name}\": {steps}"));
            // where the time goes, over the current population, run by hand as Trainer::run does
            let (mut physics, mut contacts, mut brain_t, mut body, mut judging) = (Duration::ZERO, Duration::ZERO, Duration::ZERO, Duration::ZERO, Duration::ZERO);
            let mut brain = Brain::new(trainer.layout);
            let mut senses = vec![0.0; trainer.layout.inputs];
            for index in 0..trainer.settings.population {
                let weights = trainer.weights(index).to_vec();
                let mut world = trainer.start.clone();
                brain.forget();
                let creature = trainer.creature.clone();
                let mut judge = trainer.judge();
                loop {
                    let t = Instant::now();
                    creature.sense(&world, &mut senses);
                    let t1 = Instant::now();
                    brain.think(&weights, &senses);
                    let t2 = Instant::now();
                    creature.drive(&mut world, &brain.outputs);
                    let t3 = Instant::now();
                    let mut probe = world.clone();
                    let t4 = Instant::now();
                    probe.find_contacts();
                    let t5 = Instant::now();
                    world.step();
                    let t6 = Instant::now();
                    let over = judge.after_step(&creature, &world, &brain.outputs);
                    let t7 = Instant::now();
                    body += (t1 - t) + (t3 - t2);
                    brain_t += t2 - t1;
                    contacts += t5 - t4;
                    physics += t6 - t5;
                    judging += t7 - t6;
                    if over {
                        break;
                    }
                }
            }
            let total = (physics + brain_t + body + judging).as_secs_f64();
            let share = |part: Duration| 100.0 * part.as_secs_f64() / total;
            println!(
                "{legs}    {name:<13} {:6.1} {:10.0} {:7.1} | {:5.0}% {:5.0}%   {:5.0}% {:5.0}%      {:5.0}%",
                5.0 / wall,
                steps as f64 / 60.0 / wall,
                1000.0 * wall / 5.0,
                share(physics),
                share(contacts),
                share(brain_t),
                share(body),
                share(judging),
            );
        }
    }
    println!("steps in generations 2 to 6: {{{}}}", steps_json.join(", "));
}
