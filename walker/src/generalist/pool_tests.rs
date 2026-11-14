//! What the pool is held to: its gradient through a window of decisions is what nudging each weight
//! shows, for every kind of neuron (memory with its plastic reads, rhythm, mood), across a fresh start
//! in the middle of the window; its form reads back as it was; and a pool grown keeps doing what it did.

use alloc::vec;
use alloc::vec::Vec;

use super::pool::{Pool, Shape, Trace};
use crate::learn::Random;

fn noise(random: &mut Random, count: usize, size: f32) -> Vec<f32> {
    (0..count).map(|_| (2.0 * random.unit() - 1.0) * size).collect()
}

/// A loss of a window: each output at each decision times a fixed number, summed, and a square of
/// the outputs so the loss is not straight in them.
fn loss(out: &[f32], coefficients: &[f32]) -> f64 {
    out.iter().zip(coefficients).map(|(&o, &c)| (c * o + 0.3 * o * o) as f64).sum()
}

fn blame_of(out: &[f32], coefficients: &[f32]) -> Vec<f32> {
    out.iter().zip(coefficients).map(|(&o, &c)| c + 0.6 * o).collect()
}

#[test]
fn the_gradient_through_a_window_is_what_nudging_shows_for_every_kind() {
    let (senses, plain) = (3, 4);
    let shape = Shape { memory: 3, rhythm: 2, mood: 2, reads: 4 };
    let mut random = Random::new(7);
    let pool = Pool::new(shape, senses, plain, &[0, 2], &mut random);
    let mut weights = vec![0.0; pool.weights()];
    pool.first(&mut weights, &mut random);
    // away from where they start, plasticity included, so every term is alive
    for w in weights.iter_mut() {
        *w += 0.4 * (2.0 * random.unit() - 1.0);
    }
    let (steps, rows) = (6, 2);
    let x = noise(&mut random, steps * rows * senses, 1.0);
    let mut h1 = noise(&mut random, steps * rows * plain, 0.9);
    let mut start = vec![0.0; rows * shape.state()];
    for r in 0..rows {
        pool.fresh(&mut start[r * shape.state()..(r + 1) * shape.state()]);
    }
    // a second creature already some way into its run: something held, fast weights not nothing
    for v in start[shape.state()..].iter_mut() {
        *v += 0.3 * (2.0 * random.unit() - 1.0);
    }
    let mut fresh = vec![false; steps * rows];
    fresh[3 * rows] = true;
    let outs = shape.outputs();
    let coefficients = noise(&mut random, steps * rows * outs, 1.0);
    let mut out = vec![0.0; steps * rows * outs];
    let mut trace = Trace::default();
    let run = |weights: &[f32], h1: &[f32], out: &mut [f32], trace: &mut Trace| {
        pool.forward(weights, &x, h1, &start, &fresh, steps, rows, out, trace);
        loss(out, &coefficients)
    };
    run(&weights, &h1, &mut out, &mut trace);
    let blame = blame_of(&out, &coefficients);
    let mut grads = vec![0.0; weights.len()];
    let mut h1_blame = vec![0.0; h1.len()];
    pool.backward(&weights, &trace, &blame, &mut grads, &mut h1_blame);
    let h = 1e-2f32;
    let check = |name: &str, k: usize, grad: f32, up: f64, down: f64| {
        let wanted = (up - down) / (2.0 * h as f64);
        let error = (grad as f64 - wanted).abs();
        assert!(error < 3e-3 + 2e-2 * wanted.abs(), "{name} {k}: gradient {grad}, nudging {wanted}");
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
}

#[test]
fn a_fresh_start_owes_nothing_to_before_it() {
    let shape = Shape { memory: 2, rhythm: 1, mood: 1, reads: 3 };
    let mut random = Random::new(3);
    let pool = Pool::new(shape, 2, 3, &[0], &mut random);
    let mut weights = vec![0.0; pool.weights()];
    pool.first(&mut weights, &mut random);
    let (steps, rows) = (4, 1);
    let x = noise(&mut random, steps * 2, 1.0);
    let h1 = noise(&mut random, steps * 3, 0.9);
    let mut start = vec![0.0; shape.state()];
    pool.fresh(&mut start);
    let mut fresh = vec![false; steps];
    fresh[2] = true;
    let mut out = vec![0.0; steps * shape.outputs()];
    let mut trace = Trace::default();
    pool.forward(&weights, &x, &h1, &start, &fresh, steps, rows, &mut out, &mut trace);
    // blame only on the last decision, after a fresh start at decision 2: nothing reaches decisions 0 and 1
    let mut blame = vec![0.0; out.len()];
    blame[3 * shape.outputs()..].fill(1.0);
    let mut grads = vec![0.0; weights.len()];
    let mut h1_blame = vec![0.0; h1.len()];
    pool.backward(&weights, &trace, &blame, &mut grads, &mut h1_blame);
    assert!(h1_blame[..6].iter().all(|&b| b == 0.0), "{h1_blame:?}");
    assert!(h1_blame[6..].iter().any(|&b| b != 0.0));
}

#[test]
fn a_form_reads_back_as_it_was() {
    let mut random = Random::new(1);
    let pool = Pool::new(Shape { memory: 5, rhythm: 2, mood: 3, reads: 6 }, 10, 8, &[1, 4], &mut random);
    assert_eq!(Pool::from_form(&pool.form(), 10, 8).as_ref(), Some(&pool));
    // a read of a sense there is not, or a form cut short, is refused
    assert!(Pool::from_form(&pool.form(), 3, 8).is_none());
    assert!(Pool::from_form(&pool.form()[..10], 10, 8).is_none());
}

#[test]
fn a_mood_reads_the_feelings_first() {
    let mut random = Random::new(2);
    let shape = Shape { memory: 1, rhythm: 0, mood: 2, reads: 6 };
    let pool = Pool::new(shape, 10, 8, &[7, 9, 3], &mut random);
    for m in 0..2 {
        let reads = &pool.reads[(1 + m) * 6..(2 + m) * 6];
        assert_eq!(&reads[..3], &[7, 9, 3]);
    }
}

#[test]
fn a_pool_grown_does_what_it_did_and_a_pool_shrunk_keeps_its_most_used() {
    let (senses, plain) = (4, 5);
    let shape = Shape { memory: 3, rhythm: 2, mood: 1, reads: 4 };
    let mut random = Random::new(9);
    let pool = Pool::new(shape, senses, plain, &[0], &mut random);
    let mut weights = vec![0.0; pool.weights()];
    pool.first(&mut weights, &mut random);
    for w in weights.iter_mut() {
        *w += 0.3 * (2.0 * random.unit() - 1.0);
    }
    let (steps, rows) = (8, 1);
    let x = noise(&mut random, steps * senses, 1.0);
    let h1 = noise(&mut random, steps * plain, 0.9);
    let fresh = vec![false; steps];
    let outputs = |pool: &Pool, weights: &[f32]| {
        let mut start = vec![0.0; pool.shape.state()];
        pool.fresh(&mut start);
        let mut out = vec![0.0; steps * pool.shape.outputs()];
        pool.forward(weights, &x, &h1, &start, &fresh, steps, rows, &mut out, &mut Trace::default());
        out
    };
    let before = outputs(&pool, &weights);
    let used = vec![1.0; shape.outputs()];
    let bigger = Shape { memory: 5, rhythm: 3, mood: 2, reads: 6 };
    let mut grown = vec![0.0; bigger.weights()];
    let (pool2, map) = pool.reshape(&weights, &used, bigger, &mut grown, &mut random);
    let after = outputs(&pool2, &grown);
    // every old output is still given, the same to within rounding, by the neuron it maps to
    for (new, old) in map.iter().enumerate() {
        if let Some(old) = old {
            for t in 0..steps {
                let (a, b) = (before[t * shape.outputs() + old], after[t * bigger.outputs() + new]);
                assert!((a - b).abs() < 1e-5, "output {old} became {new}: {a} then {b} at decision {t}");
            }
        }
    }
    assert_eq!(map.iter().filter(|m| m.is_some()).count(), shape.outputs());
    // smaller: the memory used least goes, and the others' reads of it are taken by fresh sources
    let used = vec![3.0, 0.1, 2.0, 1.0, 1.0, 1.0, 1.0, 1.0];
    let smaller = Shape { memory: 2, rhythm: 2, mood: 1, reads: 3 };
    let mut shrunk = vec![0.0; smaller.weights()];
    let (pool3, map) = pool.reshape(&weights, &used, smaller, &mut shrunk, &mut random);
    assert_eq!(&map[..2], &[Some(0), Some(2)]);
    assert!(pool3.reads.iter().all(|&code| code >> 16 != super::pool::MEMORY || (code & 0xffff) < 2));
    assert_eq!(Pool::from_form(&pool3.form(), senses, plain).as_ref(), Some(&pool3));
}
