//! Whether a kept learner adapts when its world changes partway through a run (stage 4, walker/README.md
//! "A world that changes while it lives"). In each of the sixteen held-out worlds of the page's kind, it
//! walks as practice measures it; ten seconds in, the run is copied, and in each copy but one the world
//! changes at once and stays changed: ice, sticky ground, bouncy ground, soft ground, heavy gravity, light
//! gravity, a wind from ahead, a wind from behind, or night. Every copy goes on to twenty seconds, its brain
//! carried on as it was (its pool, its plastic connections, its predictor).
//!
//! `worlds=` sets how many held-out worlds (200 unless given; the first sixteen are the ones every other
//! measure uses).
//!
//! For each change it prints how far the changed copies went in each two and a half seconds after the
//! change, as a share of how far the unchanged copies went in the same time (over the worlds in which the
//! unchanged copy was still going at twenty seconds), the share of changed copies whose run ended, and
//! two summaries: the pace kept in the first five seconds and in the next five, and the recovery, the second
//! over the first; then the same over only the changed copies whose run did not end (`up_`), the pace kept
//! while it stays on its feet, so a fall does not hide whether it found its pace again. With `hears=0` the learner senses nothing of a changing world, as before stage 4.
//!
//!     cargo run --release --example adapt -- kept=<path> legs=2

use walker::generalist::changes::{Changes, Conditions};
use walker::generalist::envs::Run;
use walker::generalist::practice::{Changing, Way, Worlds, held_out, learner_of_form, shaped};
use walker::generalist::ppo::Settings;
use walker::generalist::recipe::Recipe;
use walker::physics::STEP;

fn read(path: &str) -> Vec<f64> {
    std::fs::read_to_string(path).unwrap().split_whitespace().map(|n| n.parse().unwrap()).collect()
}

/// One creature going: its run, its brain's state, the actions it holds, and what it senses.
#[derive(Clone)]
struct Going {
    run: Run,
    state: Vec<f32>,
    held: Vec<f32>,
    senses: Vec<f32>,
    asked: Vec<f32>,
}

fn main() {
    let (mut kept, mut legs, mut hears, mut count) = (String::new(), 2u32, true, 200usize);
    for arg in std::env::args().skip(1) {
        match arg.split_once('=') {
            Some(("kept", v)) => kept = v.to_string(),
            Some(("legs", v)) => legs = v.parse().unwrap(),
            Some(("hears", v)) => hears = v == "1",
            Some(("worlds", v)) => count = v.parse().unwrap(),
            _ => {}
        }
    }
    let kind = Recipe { seed: 0, difficulty: 0.2, amounts: [0.6, 0.4, 0.4, 0.4] };
    let way = Way { hears, changing: Changing::Still, energy: 0.7, play: 0.0, ..Way::of(legs) };
    let form: Vec<f32> = std::fs::read_to_string(format!("{kept}.form")).map(|f| f.split_whitespace().map(|n| n.parse().unwrap()).collect()).unwrap_or_else(|_| vec![0.0; 4]);
    let state: Vec<f32> = read(&format!("{kept}.state")).iter().map(|&n| n as f32).collect();
    let running = read(&format!("{kept}.running"));
    let changes: [(&str, Conditions); 9] = [
        ("ice", Conditions { grip: Conditions::ICE, ..Conditions::REST }),
        ("sticky", Conditions { grip: Conditions::STICKY, ..Conditions::REST }),
        ("bouncy", Conditions { bounce: Conditions::BOUNCIEST, ..Conditions::REST }),
        ("soft", Conditions { soft: 1.0, ..Conditions::REST }),
        ("heavy", Conditions { gravity: Conditions::HEAVIEST, ..Conditions::REST }),
        ("light", Conditions { gravity: Conditions::LIGHTEST, ..Conditions::REST }),
        ("headwind", Conditions { wind: -4.0, ..Conditions::REST }),
        ("tailwind", Conditions { wind: 4.0, ..Conditions::REST }),
        ("night", Conditions { light: 0.0, ..Conditions::REST }),
    ];
    let marks = [10.0f32, 12.5, 15.0, 17.5, 20.0];
    // for each change and each mark after the change: the distance gone by changed and unchanged copies
    let mut gone = vec![[0.0f64; 4]; changes.len()];
    let mut base = [0.0f64; 4];
    let mut ended = vec![0u32; changes.len()];
    // the same, over the copies whose run did not end: the pace kept while it stays up
    let mut gone_up = vec![[0.0f64; 4]; changes.len()];
    let mut base_up = vec![[0.0f64; 4]; changes.len()];
    let mut counted = 0u32;
    let seeds = held_out(count);
    for &seed in &seeds {
        let worlds = Worlds::alone(Recipe { seed, ..kind }, way, &[seed]).unwrap();
        let (senses, actions) = (worlds.runs[0].senses(), worlds.runs[0].body.actions());
        let mut learner = learner_of_form(&way, Settings::default(), &form, senses, actions, 1, 0).expect("a form that holds together");
        assert!(learner.load(&state, &running), "the kept learner does not fit this way (hears={hears})");
        let mut first = Going { run: worlds.runs[0].clone(), state: Vec::new(), held: vec![0.0; actions], senses: vec![0.0; senses], asked: vec![0.0; actions] };
        first.run.sense(&mut first.senses);
        // walks until `until` seconds, or its run ends
        let mut walk = |going: &mut Going, until: f32| {
            while (going.run.judge.steps as f32) * STEP < until - 1e-4 && !going.run.judge.over() {
                learner.act_as(&mut going.state, &going.senses, &mut going.asked);
                way.hold(&going.asked, &mut going.held);
                for _ in 0..way.skip {
                    going.run.before_step(&going.held);
                    going.run.stage.world.step();
                    going.run.after_step();
                    shaped(&mut going.run, way.shaping, &going.held);
                    if going.run.judge.over() {
                        break;
                    }
                }
                going.run.sense(&mut going.senses);
            }
            going.run.distance()
        };
        walk(&mut first, marks[0]);
        if first.run.judge.over() {
            continue;
        }
        let start = first.run.distance() as f64;
        let mut unchanged = first.clone();
        let mut plain = [0.0f64; 4];
        for m in 0..4 {
            plain[m] = walk(&mut unchanged, marks[m + 1]) as f64 - start;
        }
        if unchanged.run.judge.over() {
            continue;
        }
        counted += 1;
        for m in 0..4 {
            base[m] += plain[m];
        }
        for (c, (_, conditions)) in changes.iter().enumerate() {
            let mut changed = first.clone();
            let mut world = Changes::still(Conditions::REST);
            world.aim_at(*conditions, changed.run.judge.steps);
            changed.run.changes = Some(world);
            let mut went = [0.0f64; 4];
            for m in 0..4 {
                went[m] = walk(&mut changed, marks[m + 1]) as f64 - start;
                gone[c][m] += went[m];
            }
            ended[c] += u32::from(changed.run.judge.over());
            if !changed.run.judge.over() {
                for m in 0..4 {
                    gone_up[c][m] += went[m];
                    base_up[c][m] += plain[m];
                }
            }
        }
    }
    let windows = |g: &[f64; 4]| [g[0], g[1] - g[0], g[2] - g[1], g[3] - g[2]];
    let base_w = windows(&base);
    println!("adapt {kept} legs={legs} worlds={counted} unchanged_metres={:.2}/{:.2}/{:.2}/{:.2}", base_w[0] / counted as f64, base_w[1] / counted as f64, base_w[2] / counted as f64, base_w[3] / counted as f64);
    let (mut first_sum, mut second_sum) = (0.0, 0.0);
    let (mut first_up, mut second_up) = (0.0, 0.0);
    for (c, (name, _)) in changes.iter().enumerate() {
        let w = windows(&gone[c]);
        let share: Vec<f64> = (0..4).map(|m| w[m] / base_w[m].max(1e-6)).collect();
        let kept_first = (w[0] + w[1]) / (base_w[0] + base_w[1]).max(1e-6);
        let kept_second = (w[2] + w[3]) / (base_w[2] + base_w[3]).max(1e-6);
        first_sum += kept_first;
        second_sum += kept_second;
        let (u, b) = (windows(&gone_up[c]), windows(&base_up[c]));
        let up_first = (u[0] + u[1]) / (b[0] + b[1]).max(1e-6);
        let up_second = (u[2] + u[3]) / (b[2] + b[3]).max(1e-6);
        first_up += up_first;
        second_up += up_second;
        println!(
            "change {name} kept={:.2}/{:.2}/{:.2}/{:.2} first5={kept_first:.2} next5={kept_second:.2} recovery={:.2} ended={:.2} up_first5={up_first:.2} up_next5={up_second:.2}",
            share[0], share[1], share[2], share[3], kept_second / kept_first.max(1e-6), ended[c] as f64 / counted.max(1) as f64
        );
    }
    // every change together: the metres gone over the metres the unchanged copies went, summed, so a change
    // whose few runs went little cannot swing it
    let pooled = |gone: &[[f64; 4]], base: &[[f64; 4]]| {
        let first = gone.iter().map(|g| g[1]).sum::<f64>() / base.iter().map(|b| b[1]).sum::<f64>().max(1e-6);
        let next = gone.iter().map(|g| g[3] - g[1]).sum::<f64>() / base.iter().map(|b| b[3] - b[1]).sum::<f64>().max(1e-6);
        (first, next)
    };
    let every_base: Vec<[f64; 4]> = changes.iter().map(|_| base).collect();
    let (first, next) = pooled(&gone, &every_base);
    let (up_first, up_next) = pooled(&gone_up, &base_up);
    let _ = (first_sum, second_sum, first_up, second_up);
    println!("all first5={first:.3} next5={next:.3} recovery={:.3} up_first5={up_first:.3} up_next5={up_next:.3} up_recovery={:.3} ended={:.3}", next / first.max(1e-6), up_next / up_first.max(1e-6), ended.iter().sum::<u32>() as f64 / (counted.max(1) as f64 * changes.len() as f64));
}
