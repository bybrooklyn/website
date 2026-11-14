//! What a kept learner does on the page, measured natively through the page's own show (`generalist::page`,
//! the same code the page's engine runs), in sixteen held-out worlds of the page's kind:
//!
//! - **life**: the page's one life in "meadow", run after run with its energy carried, for `minutes`;
//!   its energy on average, the share of the time under a tenth, how far each run got. With `fresh=1`
//!   every run starts full instead.
//! - **food**: 6 seconds into each run a piece of food is dropped 1.5 m behind it, and 16 seconds in one
//!   1.5 m ahead: whether it ate each within 8 seconds, and how much of the second and a half after each
//!   landed its eye was on it (the middle of its gaze within 10 degrees), and over the 8 seconds, against
//!   chance (20 degrees of the 280 its eye can look over); and whether it went back half a metre or more
//!   after the food behind.
//! - **slip**: 10 seconds into each run the ground goes slippery (`Run::slippery`), and the same runs
//!   without: how far it went in each five seconds from 5 to 25, so whether it slows and comes back.
//!
//!     cargo run --release --example watch -- kept=<path> legs=2 minutes=5

use walker::generalist::page::Page;
use walker::generalist::practice::SLIPPERY;
use walker::generalist::recipe::Recipe;
use walker::math::Vec2;
use walker::physics::STEP;

/// The page's own number for a typed seed (`seedNumber` in src/minis/roaming.ts): FNV-1a over its bytes.
fn seed_number(text: &str) -> u32 {
    let mut hash: u32 = 0x811c_9dc5;
    for byte in text.trim().to_lowercase().bytes() {
        hash = (hash ^ byte as u32).wrapping_mul(0x0100_0193);
    }
    hash
}

fn read(path: &str) -> Vec<f64> {
    std::fs::read_to_string(path).unwrap().split_whitespace().map(|n| n.parse().unwrap()).collect()
}

fn page_with(recipe: Recipe, legs: u32, path: &str) -> Page {
    let mut page = Page::new(recipe, legs, 8, 8, 1, 0, 30.0, 2).unwrap();
    page.form_room = std::fs::read_to_string(format!("{path}.form")).map(|f| f.split_whitespace().map(|n| n.parse().unwrap()).collect()).unwrap_or_else(|_| vec![0.0; 4]);
    page.state_room = read(&format!("{path}.state")).iter().map(|&n| n as f32).collect();
    page.running_room = read(&format!("{path}.running"));
    assert!(page.policy_load(), "the kept learner does not fit");
    page
}

/// The creature's torso and eye, in metres from the start.
fn torso(page: &Page) -> Vec2 {
    let body = &page.show.stage.world.bodies[page.show.body.creature.torso as usize];
    body.position + Vec2::new(page.show.stage.origin, 0.0)
}

fn eye(page: &Page) -> Vec2 {
    walker::generalist::eyes::eye(&page.show.stage, page.show.body.creature.torso) + Vec2::new(page.show.stage.origin, 0.0)
}


/// Whether its gaze is on a point, within 10 degrees.
fn looks_at(page: &Page, at: Vec2) -> bool {
    let from = eye(page);
    let toward = (at.y - from.y).atan2(at.x - from.x);
    let mut off = (toward - page.show.body.gaze).abs();
    if off > std::f32::consts::PI {
        off = 2.0 * std::f32::consts::PI - off;
    }
    off < 10f32.to_radians()
}

fn step(page: &mut Page) {
    page.show_step(STEP);
}

fn main() {
    let (mut kept, mut legs, mut minutes, mut fresh) = (String::new(), 2u32, 5.0f32, false);
    for arg in std::env::args().skip(1) {
        match arg.split_once('=') {
            Some(("kept", v)) => kept = v.to_string(),
            Some(("legs", v)) => legs = v.parse().unwrap(),
            Some(("minutes", v)) => minutes = v.parse().unwrap(),
            Some(("fresh", v)) => fresh = v == "1",
            _ => {}
        }
    }
    let kind = Recipe { seed: 0, difficulty: 0.2, amounts: [0.6, 0.4, 0.4, 0.4] };

    // the page's one life
    let mut page = page_with(Recipe { seed: seed_number("meadow"), ..kind }, legs, &kept);
    let (mut energy, mut low, mut samples, mut runs, mut got) = (0.0f64, 0u32, 0u32, 0u32, 0.0f64);
    let steps = (minutes * 60.0 / STEP) as u32;
    for k in 0..steps {
        step(&mut page);
        if k % 60 == 0 {
            let e = page.show.body.needs.as_ref().map_or(1.0, |needs| needs.energy);
            energy += e as f64;
            low += u32::from(e < 0.1);
            samples += 1;
        }
        if page.show.judge.over() {
            runs += 1;
            got += page.show.judge.furthest as f64;
            page.show_reset();
            if fresh && let Some(needs) = &mut page.show.body.needs {
                needs.energy = 1.0;
            }
        }
    }
    println!("life {legs} fresh={} energy={:.2} under_a_tenth={:.2} runs={runs} distance={:.1}", u8::from(fresh), energy / samples as f64, low as f64 / samples as f64, got / runs.max(1) as f64);

    // food behind and ahead, and the eye on it as it lands
    let (mut ate, mut on, mut looked, mut turned, mut on_long, mut looked_long) = ([0u32; 2], [0u32; 2], [0u32; 2], 0u32, [0u32; 2], [0u32; 2]);
    let worlds: Vec<u32> = (2..18).collect();
    for &seed in &worlds {
        let mut page = page_with(Recipe { seed, ..kind }, legs, &kept);
        for (which, (at, side)) in [(6.0f32, -1.5f32), (16.0, 1.5)].into_iter().enumerate() {
            while page.show.judge.steps < (at / STEP) as u32 && !page.show.judge.over() {
                step(&mut page);
            }
            if page.show.judge.over() {
                break;
            }
            let body = torso(&page);
            let drop_x = body.x + side;
            page.show_drop_food(Vec2::new(drop_x, body.y + 0.8));
            let dropped = page.show.stage.food.len() - 1;
            // that piece, by where it fell (straight down), if it is still there
            let there = |page: &Page| page.show.stage.food.iter().any(|food| (food.at.x + page.show.stage.origin - drop_x).abs() < 0.05);
            let mut had = false;
            let mut back = body.x;
            for k in 0..(8.0 / STEP) as u32 {
                step(&mut page);
                if page.show.judge.over() {
                    break;
                }
                had |= !there(&page);
                back = back.min(torso(&page).x);
                if k % 4 == 0 && let Some(food) = page.show.stage.food.get(dropped) {
                    let at = food.at + Vec2::new(page.show.stage.origin, 0.0);
                    on_long[which] += u32::from(looks_at(&page, at));
                    looked_long[which] += 1;
                }
                if k < (1.5 / STEP) as u32 && k % 4 == 0 {
                    // where that piece is now, if it is still there
                    if let Some(food) = page.show.stage.food.get(dropped) {
                        let at = food.at + Vec2::new(page.show.stage.origin, 0.0);
                        on[which] += u32::from(looks_at(&page, at));
                        looked[which] += 1;
                    }
                }
            }
            ate[which] += u32::from(had);
            if which == 0 && back < body.x - 0.5 {
                turned += 1;
            }
        }
    }
    let share = |a: u32, b: u32| a as f64 / b.max(1) as f64;
    println!(
        "food {legs} behind_eaten={:.2} ahead_eaten={:.2} turned_back={:.2} eye_on_behind={:.3} eye_on_ahead={:.3} over_8s={:.3}/{:.3} chance={:.3}",
        share(ate[0], worlds.len() as u32),
        share(ate[1], worlds.len() as u32),
        share(turned, worlds.len() as u32),
        share(on[0], looked[0]),
        share(on[1], looked[1]),
        share(on_long[0], looked_long[0]),
        share(on_long[1], looked_long[1]),
        20.0 / 280.0
    );

    // the ground goes slippery at 10 s, against the same run without, on level ground with nothing on it
    // (where a run lasts its whole time unless it falls): how far it went in each five seconds, a run
    // that ended going no further
    let flat = Recipe { seed: 1, difficulty: 0.2, amounts: [0.0; 4] };
    for slip in [false, true] {
        let mut page = page_with(flat, legs, &kept);
        let mut marks = [0.0f32; 5];
        for (m, mark) in marks.iter_mut().enumerate() {
            let until = ((5.0 + 5.0 * m as f32) / STEP) as u32;
            while page.show.judge.steps < until && !page.show.judge.over() {
                if slip && page.show.judge.steps == (10.0 / STEP) as u32 {
                    page.show.slippery(SLIPPERY);
                }
                step(&mut page);
            }
            *mark = torso(&page).x;
        }
        let spans: Vec<String> = (0..4).map(|s| format!("{:.2}", marks[s + 1] - marks[s])).collect();
        println!("{} {legs} 5-10={} 10-15={} 15-20={} 20-25={} ended={:?} at={:.1}", if slip { "slip" } else { "firm" }, spans[0], spans[1], spans[2], spans[3], page.show.judge.end, page.show.judge.steps as f32 * STEP);
    }
}
