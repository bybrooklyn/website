//! What the predictor of what it will see next is held to (stage 4): its gradient is what nudging each
//! weight shows; it learns to see a steady scene coming, so its surprise falls; surprise it cannot learn
//! away pays once and then hardly anything, however long it stares; a learner with it keeps it, sends it
//! and takes it back with the rest; and a learner kept before the creature sensed a changing world, grown
//! to sense it, acts exactly as it did.

use alloc::vec;
use alloc::vec::Vec;

use super::expect::{self, Expecting, FEATURES, Foresight, GUESSES, WEIGHTS};
use super::eyes::{PER_RAY, RAYS};
use crate::learn::Random;

fn look() -> Foresight {
    Foresight { gaze: RAYS * PER_RAY, speed: RAYS * PER_RAY + 1, surprise: RAYS * PER_RAY + 3, turn: 0, skip: 4 }
}

/// What a creature walking on level ground at `speed` might sense: each ray's nearness from where it
/// falls on the ground, food in one ray now and then, the eye at rest.
fn walking(t: usize, random: &mut Random) -> Vec<f32> {
    let mut senses = vec![0.0; RAYS * PER_RAY + 4];
    for k in 0..RAYS {
        let near = if k < 8 { 0.9 - 0.08 * k as f32 } else { 0.0 };
        senses[k * PER_RAY] = near + 0.02 * crate::math::sin_cos(0.3 * t as f32 + k as f32).0;
    }
    senses[RAYS * PER_RAY] = -30.0 / 180.0;
    senses[RAYS * PER_RAY + 1] = 0.25;
    if random.unit() < 0.02 {
        senses[3 * PER_RAY + PER_RAY - 1] = 1.0;
    }
    senses
}

#[test]
fn the_predictor_s_gradient_is_what_nudging_shows() {
    let mut random = Random::new(3);
    let mut weights = vec![0.0; WEIGHTS];
    expect::first(&mut weights, &mut random);
    for w in &mut weights {
        *w += 0.1 * (random.unit() - 0.5);
    }
    let senses = walking(4, &mut random);
    let mut features = vec![0.0; FEATURES];
    expect::features(&look(), &senses, &[0.3], &mut features);
    let next = walking(5, &mut random);
    let mut seen = vec![0.0; GUESSES];
    expect::seen(&next, &mut seen);
    let mut grads = vec![0.0; WEIGHTS];
    expect::learn(&weights, &features, &seen, 1.0, &mut grads);
    let loss = |w: &[f32]| {
        let mut guesses = vec![0.0; GUESSES];
        expect::predict(w, &features, &mut guesses, None);
        guesses.iter().zip(&seen).map(|(g, s)| ((g - s) * (g - s)) as f64).sum::<f64>()
    };
    let h = 1e-3;
    for k in 0..WEIGHTS {
        let (mut up, mut down) = (weights.clone(), weights.clone());
        up[k] += h;
        down[k] -= h;
        let nudged = (loss(&up) - loss(&down)) / (2.0 * h as f64);
        assert!((nudged - grads[k] as f64).abs() < 2e-3 * (1.0 + nudged.abs()), "weight {k}: {} against nudging {nudged}", grads[k]);
    }
}

#[test]
fn it_learns_to_see_a_steady_scene_coming_and_its_surprise_falls() {
    let mut random = Random::new(1);
    let mut weights = vec![0.0; WEIGHTS];
    expect::first(&mut weights, &mut Random::new(2));
    let mut adam = super::net::Adam::new(WEIGHTS);
    let mut features = vec![0.0; FEATURES];
    let mut seen = vec![0.0; GUESSES];
    let surprised = |weights: &[f32], random: &mut Random, from: usize| {
        let mut features = vec![0.0; FEATURES];
        let mut expecting = Expecting::default();
        let mut total = 0.0;
        for t in from..from + 200 {
            let senses = walking(t, random);
            total += expecting.meet(&senses).0;
            expecting.guess(weights, &look(), &senses, &[0.0], &mut features);
        }
        total / 200.0
    };
    let before = surprised(&weights, &mut random, 0);
    for round in 0..400 {
        let mut grads = vec![0.0; WEIGHTS];
        for t in 0..32 {
            let at = round * 32 + t;
            let (now, next) = (walking(at, &mut random), walking(at + 1, &mut random));
            expect::features(&look(), &now, &[0.0], &mut features);
            expect::seen(&next, &mut seen);
            expect::learn(&weights, &features, &seen, 1.0 / (32.0 * RAYS as f32), &mut grads);
        }
        adam.step(&mut weights, &grads, 3e-3);
    }
    let after = surprised(&weights, &mut random, 50_000);
    assert!(after < 0.3 * before, "its surprise went from {before} to {after}");
}

#[test]
fn surprise_it_cannot_learn_away_pays_once_and_then_hardly_anything() {
    // staring at noise: what it sees is drawn afresh at every look, whatever it guessed
    let mut random = Random::new(9);
    let mut expecting = Expecting::default();
    let mut weights = vec![0.0; WEIGHTS];
    expect::first(&mut weights, &mut Random::new(2));
    let mut features = vec![0.0; FEATURES];
    let (mut first, mut later, mut met) = (0.0, 0.0, 0.0);
    for t in 0..3000 {
        let mut senses = vec![0.0; RAYS * PER_RAY + 4];
        for k in 0..RAYS {
            senses[k * PER_RAY] = random.unit();
            senses[k * PER_RAY + PER_RAY - 1] = if random.unit() < 0.5 { 1.0 } else { 0.0 };
        }
        let (surprised, worth) = expecting.meet(&senses);
        if t < 30 {
            first += worth;
        } else {
            later += worth;
            met += surprised;
        }
        expecting.guess(&weights, &look(), &senses, &[0.0], &mut features);
    }
    let per_look = later / 2970.0;
    assert!(first > 0.2, "the first second of noise pays {first}");
    assert!(per_look < 0.05 * met / 2970.0, "after that it pays {per_look} a look, against a surprise of {} a look", met / 2970.0);
    // and looking away and back again: the level it is used to is still raised a second later
    let mut used = Expecting { ready: true, usual: 0.5, ..Expecting::default() };
    for _ in 0..15 {
        let calm = vec![0.0; RAYS * PER_RAY + 4];
        used.guesses = [0.0; GUESSES];
        used.meet(&calm);
    }
    assert!(used.usual > 0.3, "a second after looking away the level is {}", used.usual);
}

#[test]
fn a_learner_with_a_predictor_keeps_it_and_one_kept_before_it_sensed_a_changing_world_grows_into_it() {
    use super::ppo::Settings;
    use super::practice::{Practice, Way, foreseeing};
    use super::recipe::Recipe;
    let recipe = Recipe { seed: 1, difficulty: 0.3, amounts: [1.0; 4] };
    let settings = Settings { steps: 16, shape: super::page::BRAIN, ..Settings::default() };
    let mut practice = Practice::new(recipe, Way::of(2), settings, 4, 2, 2).unwrap();
    practice.update();
    let learner = &practice.learner;
    let at = learner.foresee.as_ref().expect("a predictor").at;
    assert_eq!(learner.weights.len(), at + WEIGHTS);
    assert!(learner.foresee.as_ref().unwrap().looks > 0);
    // its predictor's weights moved with learning
    let mut fresh = vec![0.0; WEIGHTS];
    expect::first(&mut fresh, &mut Random::new(0x6578_7065_6374_0000));
    assert_ne!(&learner.weights[at..], &fresh[..]);

    // a learner as stage 3 kept it, sensing nothing of a changing world and with no predictor
    let old_way = Way { hears: false, changing: super::practice::Changing::Still, ..Way::of(2) };
    let mut old = Practice::new(recipe, old_way, settings, 4, 2, 2).unwrap();
    old.update();
    let senses = old.learner.senses + super::changes::SENSES;
    let grown = old.learner.grown(senses, &super::practice::feelings(2, senses)).unwrap();
    let mut grown = foreseeing(grown, &Way::of(2));
    let mut was = super::practice::learner_of_form(&old_way, settings, &old.learner.form(), old.learner.senses, old.learner.actions, 1, 0).unwrap();
    assert!(was.load(&old.learner.state(), &old.learner.running()));
    let mut random = Random::new(4);
    let (mut a, mut b) = (vec![0.0; was.actions], vec![0.0; was.actions]);
    let (mut state_a, mut state_b) = (Vec::new(), Vec::new());
    for _ in 0..6 {
        let sensed: Vec<f32> = (0..senses).map(|_| random.unit() - 0.5).collect();
        was.act_as(&mut state_a, &sensed[..was.senses], &mut a);
        grown.act_as(&mut state_b, &sensed, &mut b);
        for (x, y) in a.iter().zip(&b) {
            assert!((x - y).abs() < 1e-5, "{a:?} became {b:?}");
        }
    }
    assert_eq!(grown.updates, old.learner.updates);
    assert_eq!(grown.practised, old.learner.practised);
}
