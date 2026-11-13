//! What the hand-written network is held to: its backward pass gives the gradient that nudging each
//! weight and each input shows (finite differences), for every kind of squash; a row of a batch gets
//! the same answer, to the bit, whatever rows are beside it; Adam finds the bottom of a bowl; a small
//! network learns a curve; and it is quick (`cargo test --release net_speed -- --ignored --nocapture`).

use alloc::vec;
use alloc::vec::Vec;

use super::net::{Adam, Net, Squash};
use crate::learn::Random;

/// A loss to check gradients with: the sum over every output of a fixed weight times the output.
fn loss(net: &Net, weights: &[f32], input: &[f32], batch: usize, mix: &[f32]) -> f64 {
    let mut work = net.work(batch);
    net.forward(weights, input, batch, &mut work);
    work.output().iter().zip(mix).map(|(&y, &m)| y as f64 * m as f64).sum()
}

fn random_list(random: &mut Random, count: usize, size: f32) -> Vec<f32> {
    (0..count).map(|_| (2.0 * random.unit() - 1.0) * size).collect()
}

#[test]
fn the_backward_pass_gives_the_gradient_nudging_shows() {
    for (squash, sizes) in [(Squash::Tanh, vec![5, 7, 6, 3]), (Squash::Relu, vec![4, 9, 3]), (Squash::Tanh, vec![19, 17, 2]), (Squash::Plain, vec![3, 4, 2])] {
        let net = Net::new(&sizes, squash, Squash::Plain);
        let mut random = Random::new(7);
        let mut weights = vec![0.0; net.weights()];
        net.first(&mut weights, &mut random, 1.0, 1.0);
        // biases away from zero, so a ReLU is not sat exactly on its corner
        for w in weights.iter_mut() {
            *w += 0.05 * (2.0 * random.unit() - 1.0);
        }
        let batch = 6;
        let input = random_list(&mut random, batch * net.inputs(), 1.0);
        let mix = random_list(&mut random, batch * net.outputs(), 1.0);
        let mut work = net.work(batch);
        net.forward(&weights, &input, batch, &mut work);
        net.blame(&mut work, batch).copy_from_slice(&mix);
        let mut grads = vec![0.0; net.weights()];
        let mut input_grads = vec![0.0; input.len()];
        net.backward(&weights, &input, batch, &mut work, &mut grads, Some(&mut input_grads));
        let h = 1e-2f32;
        let check = |found: f32, plus: f64, minus: f64, what: &str| {
            let wanted = (plus - minus) / (2.0 * h as f64);
            let error = (found as f64 - wanted).abs();
            assert!(error < 2e-3 + 1e-2 * wanted.abs(), "{squash:?} {sizes:?} {what}: backward {found}, nudging {wanted}");
        };
        for k in 0..weights.len() {
            let (mut up, mut down) = (weights.clone(), weights.clone());
            up[k] += h;
            down[k] -= h;
            check(grads[k], loss(&net, &up, &input, batch, &mix), loss(&net, &down, &input, batch, &mix), &format!("weight {k}"));
        }
        for k in 0..input.len() {
            let (mut up, mut down) = (input.clone(), input.clone());
            up[k] += h;
            down[k] -= h;
            check(input_grads[k], loss(&net, &weights, &up, batch, &mix), loss(&net, &weights, &down, batch, &mix), &format!("input {k}"));
        }
    }
}

#[test]
fn a_row_gets_the_same_answer_whatever_rows_are_beside_it() {
    let net = Net::new(&[114, 64, 64, 13], Squash::Tanh, Squash::Plain);
    let mut random = Random::new(3);
    let mut weights = vec![0.0; net.weights()];
    net.first(&mut weights, &mut random, 1.0, 1.0);
    let input = random_list(&mut random, 9 * 114, 2.0);
    let mut all = net.work(9);
    net.forward(&weights, &input, 9, &mut all);
    let mut one = net.work(1);
    for r in 0..9 {
        net.forward(&weights, &input[r * 114..(r + 1) * 114], 1, &mut one);
        assert_eq!(one.output().iter().map(|x| x.to_bits()).collect::<Vec<_>>(), all.output()[r * 13..(r + 1) * 13].iter().map(|x| x.to_bits()).collect::<Vec<_>>(), "row {r}");
    }
}

#[test]
fn adam_finds_the_bottom_of_a_bowl() {
    let centre = [3.0f32, -2.0, 0.5, 10.0];
    let mut x = vec![0.0f32; 4];
    let mut adam = Adam::new(4);
    for _ in 0..3000 {
        // a bowl stretched a hundred times more one way than another, which Adam does not mind
        let grads: Vec<f32> = x.iter().zip(&centre).enumerate().map(|(k, (x, c))| [1.0, 100.0, 0.01, 1.0][k] * 2.0 * (x - c)).collect();
        adam.step(&mut x, &grads, 0.05);
    }
    for (x, c) in x.iter().zip(&centre) {
        assert!((x - c).abs() < 0.05, "{x} for {c}");
    }
}

#[test]
fn a_small_network_learns_a_curve() {
    for squash in [Squash::Tanh, Squash::Relu] {
        let net = Net::new(&[1, 32, 32, 1], squash, Squash::Plain);
        let mut random = Random::new(1);
        let mut weights = vec![0.0; net.weights()];
        net.first(&mut weights, &mut random, if squash == Squash::Relu { 1.41 } else { 1.0 }, 1.0);
        let mut adam = Adam::new(net.weights());
        let batch = 64;
        let mut work = net.work(batch);
        let mut grads = vec![0.0; net.weights()];
        let curve = |x: f32| crate::math::sin_cos(3.0 * x).0 * 0.8 + 0.3 * x;
        let mut error = 0.0;
        for round in 0..2000 {
            let input: Vec<f32> = (0..batch).map(|_| 2.0 * random.unit() - 1.0).collect();
            net.forward(&weights, &input, batch, &mut work);
            let found: Vec<f32> = work.output().to_vec();
            error = 0.0;
            let blame = net.blame(&mut work, batch);
            for r in 0..batch {
                let miss = found[r] - curve(input[r]);
                error += miss * miss / batch as f32;
                blame[r] = 2.0 * miss / batch as f32;
            }
            grads.fill(0.0);
            net.backward(&weights, &input, batch, &mut work, &mut grads, None);
            adam.step(&mut weights, &grads, if round < 1500 { 3e-3 } else { 1e-3 });
        }
        assert!(error < 0.003, "{squash:?}: mean square error {error}");
    }
}

#[test]
#[ignore]
fn net_speed() {
    // the policy's size for two legs; a batch the size of a minibatch
    for (hidden, squash) in [(64, Squash::Tanh), (64, Squash::Relu), (32, Squash::Tanh)] {
        let net = Net::new(&[114, hidden, hidden, 13], squash, Squash::Plain);
        let mut random = Random::new(1);
        let mut weights = vec![0.0; net.weights()];
        net.first(&mut weights, &mut random, 1.0, 0.01);
        let batch = 512;
        let input = random_list(&mut random, batch * 114, 1.0);
        let mut work = net.work(batch);
        let mut grads = vec![0.0; net.weights()];
        let rounds = 400;
        let began = std::time::Instant::now();
        for _ in 0..rounds {
            net.forward(&weights, &input, batch, &mut work);
        }
        let forward = began.elapsed().as_secs_f64();
        let began = std::time::Instant::now();
        for _ in 0..rounds {
            net.forward(&weights, &input, batch, &mut work);
            net.blame(&mut work, batch).fill(0.01);
            net.backward(&weights, &input, batch, &mut work, &mut grads, None);
        }
        let both = began.elapsed().as_secs_f64();
        let samples = (rounds * batch) as f64;
        let flops = 2.0 * (114 * hidden + hidden * hidden + hidden * 13) as f64;
        std::println!("{hidden} {squash:?}: forward {:.0} rows/s ({:.2} GFLOP/s), forward and backward {:.0} rows/s ({:.2} GFLOP/s)", samples / forward, samples * flops / forward / 1e9, samples / both, 3.0 * samples * flops / both / 1e9);
    }
}
