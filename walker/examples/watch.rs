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
//! - **world** (stage 4): in each held-out world, at 6 seconds a box is dropped 1.5 m ahead of it (how much
//!   of the second and a half after its eye was on the box, against chance); at 12 seconds night falls
//!   (where its eye looked, on average, in the three seconds before and after, in degrees, and its surprise);
//!   at 18 seconds a wind of 4 m/s² starts from ahead (the same). And its surprise on average, and when food
//!   landed behind it, how loud it heard it.
//!
//!     cargo run --release --example watch -- kept=<path> legs=2 minutes=5

use walker::generalist::changes::Conditions;
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
                    // the grip every part had at stage 3's slip, as a share of the body's own
                    page.show_conditions(Conditions { grip: SLIPPERY / 0.6, ..Conditions::REST });
                }
                step(&mut page);
            }
            *mark = torso(&page).x;
        }
        let spans: Vec<String> = (0..4).map(|s| format!("{:.2}", marks[s + 1] - marks[s])).collect();
        println!("{} {legs} 5-10={} 10-15={} 15-20={} 20-25={} ended={:?} at={:.1}", if slip { "slip" } else { "firm" }, spans[0], spans[1], spans[2], spans[3], page.show.judge.end, page.show.judge.steps as f32 * STEP);
    }

    // the world changing: a box dropped ahead, night falling, a wind rising
    let (mut box_on, mut box_looked) = (0u32, 0u32);
    let mut gaze = [[0.0f64; 2]; 2];
    let mut surprise = [[0.0f64; 2]; 2];
    let mut samples = [[0u32; 2]; 2];
    let (mut heard, mut heard_count) = (0.0f64, 0u32);
    let mut shown_surprise = (0.0f64, 0u32);
    for &seed in &worlds {
        let mut page = page_with(Recipe { seed, ..kind }, legs, &kept);
        let until = |page: &mut Page, at: f32, mut each: Box<dyn FnMut(&mut Page) + '_>| {
            while page.show.judge.steps < (at / STEP) as u32 && !page.show.judge.over() {
                step(page);
                each(page);
            }
        };
        until(&mut page, 6.0, Box::new(|page: &mut Page| {
            shown_surprise.0 += page.world()[9] as f64;
            shown_surprise.1 += 1;
        }));
        if page.show.judge.over() {
            continue;
        }
        let body = torso(&page);
        page.show_drop_box(Vec2::new(body.x + 1.5, body.y + 0.9));
        let dropped = page.show.stage.made.len() - 1;
        until(&mut page, 7.5, Box::new(|page: &mut Page| {
            if page.show.judge.steps % 4 == 0 && let Some(made) = page.show.stage.made.get(dropped) {
                let at = page.show.stage.world.bodies[made.body as usize].position + Vec2::new(page.show.stage.origin, 0.0);
                box_on += u32::from(looks_at(page, at));
                box_looked += 1;
            }
        }));
        // night at 12 s, a wind from ahead at 18 s: where it looks before and after each, and its surprise
        for (which, (at, conditions)) in [(12.0f32, Conditions { light: 0.0, ..Conditions::REST }), (18.0, Conditions { light: 0.0, wind: -4.0, ..Conditions::REST })].into_iter().enumerate() {
            until(&mut page, at - 3.0, Box::new(|_| {}));
            for half in 0..2 {
                if half == 1 {
                    page.show_conditions(conditions);
                }
                until(&mut page, at + 3.0 * half as f32, Box::new(|page: &mut Page| {
                    gaze[which][half] += page.show.body.gaze.to_degrees() as f64;
                    surprise[which][half] += page.world()[9] as f64;
                    samples[which][half] += 1;
                }));
            }
        }
        // food landing behind it, heard
        let mut page = page_with(Recipe { seed, ..kind }, legs, &kept);
        until(&mut page, 5.0, Box::new(|_| {}));
        if !page.show.judge.over() {
            let body = torso(&page);
            page.show_drop_food(Vec2::new(body.x - 1.5, body.y + 0.8));
            let mut loudest = 0.0f32;
            until(&mut page, 7.0, Box::new(|page: &mut Page| loudest = loudest.max(page.world()[8])));
            heard += loudest as f64;
            heard_count += 1;
        }
    }
    let mean = |sum: f64, n: u32| sum / n.max(1) as f64;
    println!(
        "world {legs} box_eye_on={:.3} chance={:.3} night_gaze={:.0}/{:.0} night_surprise={:.4}/{:.4} wind_gaze={:.0}/{:.0} wind_surprise={:.4}/{:.4} surprise={:.4} heard_behind={:.2}",
        mean(box_on as f64, box_looked),
        20.0 / 280.0,
        mean(gaze[0][0], samples[0][0]),
        mean(gaze[0][1], samples[0][1]),
        mean(surprise[0][0], samples[0][0]),
        mean(surprise[0][1], samples[0][1]),
        mean(gaze[1][0], samples[1][0]),
        mean(gaze[1][1], samples[1][1]),
        mean(surprise[1][0], samples[1][0]),
        mean(surprise[1][1], samples[1][1]),
        mean(shown_surprise.0, shown_surprise.1),
        mean(heard, heard_count)
    );
}
