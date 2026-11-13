//! A small network for gradient learning, with its backward pass written by hand: layers of neurons,
//! each the weighted sum of the layer before plus a bias, squashed (tanh or ReLU) or left as it is.
//! There is no general machinery for gradients; each layer knows how to send the blame for an error
//! back through itself, which is all a multilayer network needs. An Adam optimizer moves the weights.
//!
//! Everything works on many inputs at once (a batch), over flat lists of f32 the caller keeps, with
//! room made once (`Work`) so nothing is allocated while training. The sums are laid out so the
//! compiler turns them into SIMD: weights are kept input by input, each input's row holding its
//! weight for every output, so one input times its row adds into sixteen outputs side by side, and
//! four inputs of the batch share each row while it is in registers. Every sum is added in one fixed
//! order, so the same weights and inputs give the same answer to the bit, natively and in the browser.
//!
//! A network's weights, for each layer in turn: `inputs * outputs` weights (input by input, each its
//! row of outputs), then `outputs` biases.

use alloc::vec;
use alloc::vec::Vec;

use crate::learn::Random;
use crate::math::{sqrt, tanh};

/// What a layer does to each sum.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Squash {
    Tanh,
    Relu,
    /// Nothing: the sum as it is, for a layer that gives a policy's means or a value.
    Plain,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Layer {
    pub inputs: usize,
    pub outputs: usize,
    pub squash: Squash,
}

impl Layer {
    pub fn weights(&self) -> usize {
        (self.inputs + 1) * self.outputs
    }
}

/// A stack of layers. It holds no weights: they are a list given to each call.
#[derive(Clone, Debug, PartialEq)]
pub struct Net {
    pub layers: Vec<Layer>,
}

/// Room for one network's work on a batch of up to `batch` inputs: what each layer gave (kept for the
/// backward pass), and two lists the blame passes back through, one layer to the next.
#[derive(Clone, Debug)]
pub struct Work {
    pub batch: usize,
    pub outs: Vec<Vec<f32>>,
    blame: Vec<f32>,
    passed: Vec<f32>,
}

/// How many outputs are summed side by side, and how many inputs of a batch share a row of weights.
const WIDE: usize = 16;
const ROWS: usize = 4;

impl Net {
    /// Layers of the given sizes, from the inputs to the outputs: every layer but the last squashed
    /// by `hidden`, the last by `last`.
    pub fn new(sizes: &[usize], hidden: Squash, last: Squash) -> Net {
        let count = sizes.len() - 1;
        let layers = (0..count).map(|k| Layer { inputs: sizes[k], outputs: sizes[k + 1], squash: if k + 1 == count { last } else { hidden } }).collect();
        Net { layers }
    }

    pub fn inputs(&self) -> usize {
        self.layers[0].inputs
    }

    pub fn outputs(&self) -> usize {
        self.layers[self.layers.len() - 1].outputs
    }

    /// How many weights it has, biases included.
    pub fn weights(&self) -> usize {
        self.layers.iter().map(Layer::weights).sum()
    }

    /// First weights, drawn evenly with a spread of `gain` over the square root of what comes in to
    /// each neuron (so a sum starts with about the spread of one input, however wide the layer), and
    /// `last_gain` for the last layer, so a policy starts near its middle; biases start at zero.
    pub fn first(&self, weights: &mut [f32], random: &mut Random, gain: f32, last_gain: f32) {
        let mut at = 0;
        for (k, layer) in self.layers.iter().enumerate() {
            let spread = if k + 1 == self.layers.len() { last_gain } else { gain };
            // an even draw from -a to a has a spread of a over the square root of three
            let a = spread * sqrt(3.0 / layer.inputs as f32);
            for weight in &mut weights[at..at + layer.inputs * layer.outputs] {
                *weight = (2.0 * random.unit() - 1.0) * a;
            }
            at += layer.inputs * layer.outputs;
            weights[at..at + layer.outputs].fill(0.0);
            at += layer.outputs;
        }
    }

    /// Room for batches of up to `batch` inputs.
    pub fn work(&self, batch: usize) -> Work {
        let widest = self.layers.iter().map(|layer| layer.inputs.max(layer.outputs)).max().unwrap_or(0);
        Work { batch, outs: self.layers.iter().map(|layer| vec![0.0; batch * layer.outputs]).collect(), blame: vec![0.0; batch * widest], passed: vec![0.0; batch * widest] }
    }

    /// Runs `batch` inputs, one after another in `input`, through the network. What it gives is
    /// `work.outs`' last list, `outputs()` numbers for each input.
    pub fn forward(&self, weights: &[f32], input: &[f32], batch: usize, work: &mut Work) {
        let mut at = 0;
        for k in 0..self.layers.len() {
            let layer = self.layers[k];
            let (before, after) = work.outs.split_at_mut(k);
            let x = if k == 0 { &input[..batch * layer.inputs] } else { &before[k - 1][..batch * layer.inputs] };
            let y = &mut after[0][..batch * layer.outputs];
            let (w, rest) = weights[at..].split_at(layer.inputs * layer.outputs);
            forward_layer(w, &rest[..layer.outputs], x, y, batch, layer.inputs, layer.outputs);
            match layer.squash {
                Squash::Tanh => y.iter_mut().for_each(|value| *value = tanh(*value)),
                Squash::Relu => y.iter_mut().for_each(|value| *value = value.max(0.0)),
                Squash::Plain => {}
            }
            at += layer.weights();
        }
    }

    /// Where the blame for the last `forward`'s outputs is written before `backward`, `outputs()`
    /// numbers for each input: how much the loss grows for each unit each output grows.
    pub fn blame<'a>(&self, work: &'a mut Work, batch: usize) -> &'a mut [f32] {
        &mut work.blame[..batch * self.outputs()]
    }

    /// Sends the blame written into `blame` back through the network, after the `forward` of the same
    /// batch, adding each weight's share into `grads` (the gradient, laid out as the weights are). If
    /// `wanted` is given, the blame on each input is written there.
    pub fn backward(&self, weights: &[f32], input: &[f32], batch: usize, work: &mut Work, grads: &mut [f32], mut wanted: Option<&mut [f32]>) {
        let mut ends = Vec::with_capacity(self.layers.len());
        let mut at = 0;
        for layer in &self.layers {
            ends.push(at);
            at += layer.weights();
        }
        for k in (0..self.layers.len()).rev() {
            let layer = self.layers[k];
            let (ins, outs) = (layer.inputs, layer.outputs);
            let y = &work.outs[k][..batch * outs];
            let blame = &mut work.blame[..batch * outs];
            // through the squash: tanh's slope is one less the square of what it gave, ReLU's is 1 or 0
            match layer.squash {
                Squash::Tanh => blame.iter_mut().zip(y).for_each(|(b, &y)| *b *= 1.0 - y * y),
                Squash::Relu => blame.iter_mut().zip(y).for_each(|(b, &y)| *b = if y > 0.0 { *b } else { 0.0 }),
                Squash::Plain => {}
            }
            let x = if k == 0 { &input[..batch * ins] } else { &work.outs[k - 1][..batch * ins] };
            let start = ends[k];
            let (gw, gb) = grads[start..start + layer.weights()].split_at_mut(ins * outs);
            weight_blame(x, blame, gw, batch, ins, outs);
            for row in blame.chunks_exact(outs) {
                gb.iter_mut().zip(row).for_each(|(g, &b)| *g += b);
            }
            let w = &weights[start..start + ins * outs];
            if k > 0 {
                pass_back(w, blame, &mut work.passed[..batch * ins], batch, ins, outs);
                core::mem::swap(&mut work.blame, &mut work.passed);
            } else if let Some(into) = wanted.as_deref_mut() {
                pass_back(w, blame, &mut into[..batch * ins], batch, ins, outs);
            }
        }
    }
}

impl Work {
    /// What the network gave in the last `forward`, `outputs` numbers for each input.
    pub fn output(&self) -> &[f32] {
        &self.outs[self.outs.len() - 1]
    }
}

/// y = x times w, plus the biases, for `batch` rows of x.
fn forward_layer(w: &[f32], biases: &[f32], x: &[f32], y: &mut [f32], batch: usize, ins: usize, outs: usize) {
    let mut first = 0;
    while first < outs {
        let wide = (outs - first).min(WIDE);
        let mut r = 0;
        if wide == WIDE {
            // four rows at a time, their sixteen sums each kept in registers while a row of weights is read once
            while r + ROWS <= batch {
                let mut sums = [[0.0f32; WIDE]; ROWS];
                for sum in &mut sums {
                    sum.copy_from_slice(&biases[first..first + WIDE]);
                }
                for i in 0..ins {
                    let row: &[f32; WIDE] = w[i * outs + first..i * outs + first + WIDE].try_into().unwrap();
                    for (q, sum) in sums.iter_mut().enumerate() {
                        let xi = x[(r + q) * ins + i];
                        for j in 0..WIDE {
                            sum[j] += xi * row[j];
                        }
                    }
                }
                for (q, sum) in sums.iter().enumerate() {
                    y[(r + q) * outs + first..(r + q) * outs + first + WIDE].copy_from_slice(sum);
                }
                r += ROWS;
            }
        }
        // the rows left over, and a narrow last block, one row at a time
        while r < batch {
            let out = &mut y[r * outs + first..r * outs + first + wide];
            out.copy_from_slice(&biases[first..first + wide]);
            for i in 0..ins {
                let xi = x[r * ins + i];
                let row = &w[i * outs + first..i * outs + first + wide];
                out.iter_mut().zip(row).for_each(|(o, &weight)| *o += xi * weight);
            }
            r += 1;
        }
        first += wide;
    }
}

/// The gradient of each weight: for input i and output j, what i was times the blame on j, summed
/// over the batch.
fn weight_blame(x: &[f32], blame: &[f32], gw: &mut [f32], batch: usize, ins: usize, outs: usize) {
    let mut r = 0;
    while r + ROWS <= batch {
        let b: [&[f32]; ROWS] = core::array::from_fn(|q| &blame[(r + q) * outs..(r + q + 1) * outs]);
        for i in 0..ins {
            let xs: [f32; ROWS] = core::array::from_fn(|q| x[(r + q) * ins + i]);
            let g = &mut gw[i * outs..(i + 1) * outs];
            for j in 0..outs {
                g[j] += xs[0] * b[0][j] + xs[1] * b[1][j] + xs[2] * b[2][j] + xs[3] * b[3][j];
            }
        }
        r += ROWS;
    }
    while r < batch {
        let b = &blame[r * outs..(r + 1) * outs];
        for i in 0..ins {
            let xi = x[r * ins + i];
            gw[i * outs..(i + 1) * outs].iter_mut().zip(b).for_each(|(g, &b)| *g += xi * b);
        }
        r += 1;
    }
}

/// The blame on each input: for each row, input i's weights times the blame on every output, summed.
fn pass_back(w: &[f32], blame: &[f32], into: &mut [f32], batch: usize, ins: usize, outs: usize) {
    for r in 0..batch {
        let b = &blame[r * outs..(r + 1) * outs];
        for i in 0..ins {
            into[r * ins + i] = dot(&w[i * outs..(i + 1) * outs], b);
        }
    }
}

/// The sum of two lists multiplied, in eight sums side by side, then those eight added in a fixed order.
#[inline]
fn dot(a: &[f32], b: &[f32]) -> f32 {
    let mut sums = [0.0f32; 8];
    let (whole_a, rest_a) = a.split_at(a.len() / 8 * 8);
    let (whole_b, rest_b) = b.split_at(whole_a.len());
    for (ca, cb) in whole_a.as_chunks::<8>().0.iter().zip(whole_b.as_chunks::<8>().0) {
        for j in 0..8 {
            sums[j] += ca[j] * cb[j];
        }
    }
    let mut total = ((sums[0] + sums[4]) + (sums[1] + sums[5])) + ((sums[2] + sums[6]) + (sums[3] + sums[7]));
    for (x, y) in rest_a.iter().zip(rest_b) {
        total += x * y;
    }
    total
}

/// The length of a gradient, the square root of the sum of its squares.
pub fn length(grads: &[f32]) -> f32 {
    sqrt(dot(grads, grads))
}

/// Adam: each weight moves against its gradient, by a step scaled by how large its gradient has been
/// lately, so every weight learns at about the same pace whatever the size of its gradient.
#[derive(Clone, Debug)]
pub struct Adam {
    /// The running average of each gradient and of its square.
    pub mean: Vec<f32>,
    pub square: Vec<f32>,
    pub steps: u32,
    /// How much of the running averages each step keeps, as powers taken so far.
    kept_mean: f32,
    kept_square: f32,
}

pub const ADAM_MEAN: f32 = 0.9;
pub const ADAM_SQUARE: f32 = 0.999;
pub const ADAM_SMALL: f32 = 1e-5;

impl Adam {
    pub fn new(weights: usize) -> Adam {
        Adam { mean: vec![0.0; weights], square: vec![0.0; weights], steps: 0, kept_mean: 1.0, kept_square: 1.0 }
    }

    /// Takes up again after `steps` steps, its running averages already put back.
    pub fn restart_at(&mut self, steps: u32) {
        self.steps = 0;
        self.kept_mean = 1.0;
        self.kept_square = 1.0;
        while self.steps < steps {
            self.steps += 1;
            self.kept_mean *= ADAM_MEAN;
            self.kept_square *= ADAM_SQUARE;
        }
    }

    /// One step of size `rate` against the gradient.
    pub fn step(&mut self, weights: &mut [f32], grads: &[f32], rate: f32) {
        self.steps += 1;
        self.kept_mean *= ADAM_MEAN;
        self.kept_square *= ADAM_SQUARE;
        // the averages start at zero, so early on they are scaled up to make up for it
        let (fix_mean, fix_square) = (1.0 / (1.0 - self.kept_mean), 1.0 / (1.0 - self.kept_square));
        for (((weight, &grad), mean), square) in weights.iter_mut().zip(grads).zip(&mut self.mean).zip(&mut self.square) {
            *mean = ADAM_MEAN * *mean + (1.0 - ADAM_MEAN) * grad;
            *square = ADAM_SQUARE * *square + (1.0 - ADAM_SQUARE) * grad * grad;
            *weight -= rate * (*mean * fix_mean) / (sqrt(*square * fix_square) + ADAM_SMALL);
        }
    }
}
