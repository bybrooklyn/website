//! What a bigger brain costs practice: for each shape of pool, a learner of two legs practises in the
//! page's kind of world with 32 creatures on one core, and this prints the steps of the physics a second
//! and the share of the time its network took (the rest is the world).
//!
//! With `before=1`, as stage 3 practised: a world that does not change, nothing sensed of one, and no
//! predictor of what it will see. With `grow=1`, each pool adds and cuts its connections as it lives by
//! the rule the page carries (stage 5, `wiring`).
//!
//!     cargo run --release --example brain_cost -- updates=40 legs=2 most=8

use std::time::Instant;

use walker::generalist::pool::Shape;
use walker::generalist::ppo::Settings;
use walker::generalist::practice::{Changing, Practice, Way};
use walker::generalist::recipe::Recipe;

fn main() {
    let (mut updates, mut legs, mut most, mut before, mut grow) = (40usize, 2u32, usize::MAX, false, false);
    for arg in std::env::args().skip(1) {
        match arg.split_once('=') {
            Some(("updates", v)) => updates = v.parse().unwrap(),
            Some(("legs", v)) => legs = v.parse().unwrap(),
            Some(("most", v)) => most = v.parse().unwrap(),
            Some(("before", v)) => before = v == "1",
            Some(("grow", v)) => grow = v == "1",
            _ => {}
        }
    }
    let recipe = Recipe { seed: 1, difficulty: 0.2, amounts: [0.6, 0.4, 0.4, 0.4] };
    let shapes = [(0, 0, 0, 0), (32, 4, 4, 16), (64, 8, 4, 16), (128, 16, 4, 16), (128, 16, 4, 32), (256, 32, 4, 32), (512, 32, 4, 32), (512, 64, 4, 64)];
    for &(memory, rhythm, mood, reads) in shapes.iter().take(most) {
        let shape = Shape { memory, rhythm, mood, reads };
        let settings = Settings { shape, grow: grow.then_some(walker::generalist::wiring::Grow::PAGE), ..Settings::default() };
        let way = if before { Way { hears: false, changing: Changing::Still, ..Way::of(legs) } } else { Way::of(legs) };
        let mut practice = Practice::new(recipe, way, settings, 32, 1, 1).unwrap();
        practice.update();
        let began = Instant::now();
        let before = practice.worlds.steps;
        let mut thinking = 0.0;
        for _ in 0..updates {
            practice.ramp();
            practice.learner.collect(&mut practice.worlds);
            let epochs = Instant::now();
            practice.learner.epochs();
            thinking += epochs.elapsed().as_secs_f64();
            practice.learner.updated();
        }
        let took = began.elapsed().as_secs_f64();
        let steps = (practice.worlds.steps - before) as f64;
        println!(
            "memory {memory} rhythm {rhythm} mood {mood} reads {reads}: {} neurons, {} weights, {:.0} steps a second, learning {:.0}% of the time",
            128 + shape.neurons(),
            practice.learner.weights.len(),
            steps / took,
            100.0 * thinking / took
        );
    }
}
