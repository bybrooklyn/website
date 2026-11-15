//! What a brain that adds and cuts its connections is held to (stage 5, `wiring`): with some places
//! empty, the gradient through a window is still what nudging shows, and an empty place learns nothing;
//! the rule joins the empty place of the greatest trace over its threshold and cuts the connection of the
//! least under its own; short of energy it grows less and cuts more; over a run connections come and go,
//! and a brain that grows pays for them from its energy and never more than its price; switched on, it
//! keeps nothing more with the learner, so a learner kept before opens as it was; and the same seed
//! practises the same way to the bit.

use alloc::vec;
use alloc::vec::Vec;

use super::page::BRAIN;
use super::pool::{Pool, Shape, Trace};
use super::ppo::Settings;
use super::practice::{Practice, Way};
use super::recipe::Recipe;
use super::wiring::{Grow, Growth, Rule};
use crate::learn::Random;

fn noise(random: &mut Random, count: usize, size: f32) -> Vec<f32> {
    (0..count).map(|_| (2.0 * random.unit() - 1.0) * size).collect()
}

fn growth(rule: Rule) -> Growth {
    Growth { rule, price: 1.0, signals: [0, 1, 2] }
}

#[test]
fn with_places_empty_the_gradient_through_a_window_is_what_nudging_shows_and_an_empty_place_learns_nothing() {
    let (senses, plain) = (3, 4);
    let shape = Shape { memory: 3, rhythm: 1, mood: 1, reads: 4 };
    let mut random = Random::new(11);
    let mut pool = Pool::new(shape, senses, plain, &[0, 2], &mut random);
    pool.grow = Some(growth(Rule::FIRST));
    let mut weights = vec![0.0; pool.weights()];
    pool.first(&mut weights, &mut random);
    for w in weights.iter_mut() {
        *w += 0.4 * (2.0 * random.unit() - 1.0);
    }
    let (steps, rows, wide) = (6, 2, pool.state());
    let x = noise(&mut random, steps * rows * senses, 1.0);
    let mut h1 = noise(&mut random, steps * rows * plain, 0.9);
    let signals = vec![0.5; steps * rows * 3];
    let mut start = vec![0.0; rows * wide];
    for r in 0..rows {
        pool.fresh(&mut start[r * wide..(r + 1) * wide]);
    }
    // half of every neuron's places empty, and the rule not yet warm, so the window keeps them so
    let joined = |state: &[f32], i: usize, n: usize| state[shape.state() + i * shape.reads + n] > 0.5;
    assert!((0..shape.memory).all(|i| (0..shape.reads).filter(|&n| joined(&start, i, n)).count() == 2));
    let mut fresh = vec![false; steps * rows];
    fresh[3 * rows] = true;
    let outs = shape.outputs();
    let coefficients = noise(&mut random, steps * rows * outs, 1.0);
    let mut out = vec![0.0; steps * rows * outs];
    let mut trace = Trace::default();
    let run = |weights: &[f32], h1: &[f32], out: &mut [f32], trace: &mut Trace| {
        pool.forward(weights, &x, h1, &signals, &start, &fresh, steps, rows, out, trace);
        out.iter().zip(&coefficients).map(|(&o, &c)| (c * o + 0.3 * o * o) as f64).sum::<f64>()
    };
    run(&weights, &h1, &mut out, &mut trace);
    let blame: Vec<f32> = out.iter().zip(&coefficients).map(|(&o, &c)| c + 0.6 * o).collect();
    let mut grads = vec![0.0; weights.len()];
    let mut h1_blame = vec![0.0; h1.len()];
    pool.backward(&weights, &trace, &blame, &mut grads, &mut h1_blame);
    let h = 1e-2f32;
    let check = |name: &str, k: usize, grad: f32, up: f64, down: f64| {
        let wanted = (up - down) / (2.0 * h as f64);
        assert!((grad as f64 - wanted).abs() < 3e-3 + 2e-2 * wanted.abs(), "{name} {k}: gradient {grad}, nudging {wanted}");
    };
    for k in 0..weights.len() {
        let kept = weights[k];
        weights[k] = kept + h;
        let up = run(&weights, &h1, &mut out, &mut trace);
        weights[k] = kept - h;
        let down = run(&weights, &h1, &mut out, &mut trace);
        weights[k] = kept;
        check("weight", k, grads[k], up, down);
    }
    for k in 0..h1.len() {
        let kept = h1[k];
        h1[k] = kept + h;
        let up = run(&weights, &h1, &mut out, &mut trace);
        h1[k] = kept - h;
        let down = run(&weights, &h1, &mut out, &mut trace);
        h1[k] = kept;
        check("plain neuron", k, h1_blame[k], up, down);
    }
    // a place empty in both creatures' starts learned nothing for its gate or its take-in
    let k = shape.reads;
    for i in 0..shape.memory {
        for n in 0..k {
            if !joined(&start, i, n) && !joined(&start[wide..], i, n) {
                let at = i * (3 * k + 2);
                assert_eq!((grads[at + n], grads[at + k + n]), (0.0, 0.0), "neuron {i} place {n}");
            }
        }
    }
}

#[test]
fn the_rule_joins_the_greatest_empty_place_over_its_threshold_and_cuts_the_least_connection_under_its_own() {
    let g = growth(Rule::FIRST);
    let mut joined = vec![1.0, 1.0, 0.0, 0.0];
    let traces = [0.5, 0.01, 0.2, 0.4];
    assert_eq!(g.rewire(&mut joined, &traces, (0.3, 0.05)), (1, 1));
    assert_eq!(joined, vec![1.0, 0.0, 0.0, 1.0]);
    // under the threshold for growing and over the threshold for cutting, nothing changes
    let mut joined = vec![1.0, 1.0, 0.0, 0.0];
    assert_eq!(g.rewire(&mut joined, &traces, (0.45, 0.005)), (0, 0));
    assert_eq!(joined, vec![1.0, 1.0, 0.0, 0.0]);
}

#[test]
fn short_of_energy_it_grows_less_and_cuts_more_and_surprise_moves_it_as_the_rule_says() {
    let rule = Rule::FIRST;
    let (grow_full, cut_full) = rule.thresholds(1.0, 0.0, 0.0);
    let (grow_short, cut_short) = rule.thresholds(0.05, 0.0, 0.0);
    assert!(grow_short > 2.0 * grow_full && cut_short > 2.0 * cut_full, "{grow_full} {cut_full} {grow_short} {cut_short}");
    // the first rule ignores surprise; one that heeds it grows sooner and cuts sooner when surprised
    assert_eq!(rule.thresholds(1.0, 0.0, 0.1), (grow_full, cut_full));
    let mut numbers = rule.numbers;
    numbers[3] = 0.5;
    let heeding = Rule { numbers };
    let (grow_surprised, cut_surprised) = heeding.thresholds(1.0, 0.0, 0.04);
    assert!(grow_surprised < grow_full && cut_surprised > cut_full);
}

#[test]
fn over_a_run_connections_come_and_go_and_cost_no_more_than_the_price() {
    let (senses, plain) = (5, 6);
    let shape = Shape { memory: 6, rhythm: 0, mood: 0, reads: 5 };
    let mut random = Random::new(5);
    let mut pool = Pool::new(shape, senses, plain, &[], &mut random);
    // a rule quick to grow and to cut, so a short run shows both
    pool.grow = Some(growth(Rule { numbers: [1.0, -2.5, -1.5, 0.0, 0.0, 1.4, 0.0] }));
    let mut weights = vec![0.0; pool.weights()];
    pool.first(&mut weights, &mut random);
    let mut state = vec![0.0; pool.state()];
    pool.fresh(&mut state);
    let first = pool.joined(&state);
    let mut out = vec![0.0; shape.outputs()];
    let (mut added, mut cut) = (0, 0);
    for _ in 0..300 {
        let before: Vec<bool> = (0..shape.memory * shape.reads).map(|p| state[shape.state() + p] > 0.5).collect();
        let x = noise(&mut random, senses, 1.5);
        let h1 = noise(&mut random, plain, 0.9);
        pool.step(&weights, &x, &h1, &[0.8, 0.0, 0.0], &mut state, &mut out, 1, None);
        for (p, &was) in before.iter().enumerate() {
            let now = state[shape.state() + p] > 0.5;
            added += usize::from(now && !was);
            cut += usize::from(was && !now);
        }
        let (joined, places) = pool.joined(&state);
        assert!(joined <= places);
        assert!(pool.cost(&state) <= super::needs::AWAKE + 1e-9);
    }
    assert_eq!(first, (shape.memory * shape.reads / 2 + 3, shape.memory * shape.reads));
    assert!(added > 5 && cut > 5, "added {added}, cut {cut}");
}

#[test]
fn switched_on_it_keeps_nothing_more_with_the_learner_and_practises_the_same_way_to_the_bit() {
    let recipe = Recipe { seed: 1, difficulty: 0.5, amounts: [1.0; 4] };
    let settings = Settings { shape: BRAIN, grow: Some(Grow::PAGE), ..Settings::default() };
    let still = Practice::new(recipe, Way::of(2), Settings { shape: BRAIN, ..Settings::default() }, 2, 7, 3).unwrap();
    let grows = |settings: Settings| {
        let mut practice = Practice::new(recipe, Way::of(2), settings, 2, 7, 3).unwrap();
        for _ in 0..2 {
            practice.update();
        }
        practice.learner.state().iter().map(|x| x.to_bits()).collect::<Vec<u32>>()
    };
    let first = grows(settings);
    assert_eq!(first.len(), still.learner.state().len());
    assert_eq!(first, grows(settings));
    assert!(still.learner.pool().is_some_and(|pool| pool.grow.is_none()));
}

#[test]
fn a_brain_that_grows_pays_for_its_connections_from_its_energy() {
    let recipe = Recipe { seed: 1, difficulty: 0.0, amounts: [0.0; 4] };
    let spend = |price: f32| {
        let settings = Settings { shape: BRAIN, grow: Some(Grow { rule: Rule::FIRST, price }), ..Settings::default() };
        let mut practice = Practice::new(recipe, Way { play: 0.0, appear: 0.0, visitor: 0.0, ..Way::of(2) }, settings, 4, 3, 9).unwrap();
        practice.update();
        practice.worlds.runs.iter().filter_map(|run| run.body.needs.as_ref().map(|needs| (needs.brain, needs.energy))).collect::<Vec<(f32, f32)>>()
    };
    let (free, dear) = (spend(0.0), spend(8.0));
    assert!(free.iter().all(|&(brain, _)| brain == 0.0));
    assert!(dear.iter().all(|&(brain, _)| brain > 0.0 && brain <= 8.0 * super::needs::AWAKE));
}
