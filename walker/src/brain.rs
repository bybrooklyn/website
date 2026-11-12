//! The brain: a small network of one hidden layer. Each hidden neuron adds up the senses, each times
//! its own weight, plus a bias, and squashes the sum with tanh; each output does the same with the
//! hidden neurons, and is the target for one joint. All the weights sit in one flat list of f32, which
//! is what evolution changes and what a shared link carries.
//!
//! The list holds, in order: for each hidden neuron its weight for every sense; the hidden biases;
//! for each output its weight for every hidden neuron; the output biases.

use alloc::vec;
use alloc::vec::Vec;

use crate::math::tanh;

/// Hidden neurons in every brain. Enough for a gait, few enough to learn in minutes.
pub const HIDDEN: usize = 12;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Layout {
    pub inputs: usize,
    pub hidden: usize,
    pub outputs: usize,
}

impl Layout {
    pub fn new(inputs: usize, outputs: usize) -> Layout {
        Layout { inputs, hidden: HIDDEN, outputs }
    }

    /// How many weights a brain of this shape has.
    pub fn weights(&self) -> usize {
        self.hidden * (self.inputs + 1) + self.outputs * (self.hidden + 1)
    }
}

#[derive(Clone, Debug)]
pub struct Brain {
    pub layout: Layout,
    /// What each hidden neuron and each output gave last time, to draw the brain thinking.
    pub hidden: Vec<f32>,
    pub outputs: Vec<f32>,
}

impl Brain {
    pub fn new(layout: Layout) -> Brain {
        Brain { layout, hidden: vec![0.0; layout.hidden], outputs: vec![0.0; layout.outputs] }
    }

    /// Runs the senses through the network with the given weights. The answer is in `outputs`.
    pub fn think(&mut self, weights: &[f32], senses: &[f32]) {
        let Layout { inputs, hidden, outputs } = self.layout;
        let (first, rest) = weights.split_at(hidden * inputs);
        let (hidden_biases, rest) = rest.split_at(hidden);
        let (second, output_biases) = rest.split_at(outputs * hidden);
        for (j, neuron) in self.hidden.iter_mut().enumerate() {
            let row = &first[j * inputs..(j + 1) * inputs];
            let sum = row.iter().zip(senses).fold(hidden_biases[j], |sum, (w, x)| sum + w * x);
            *neuron = tanh(sum);
        }
        for (k, output) in self.outputs.iter_mut().enumerate() {
            let row = &second[k * hidden..(k + 1) * hidden];
            let sum = row.iter().zip(&self.hidden).fold(output_biases[k], |sum, (w, x)| sum + w * x);
            *output = tanh(sum);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_brain_gives_the_same_outputs_for_the_same_inputs() {
        let layout = Layout::new(17, 4);
        assert_eq!(layout.weights(), 12 * 18 + 4 * 13);
        let weights: Vec<f32> = (0..layout.weights()).map(|i| ((i * 7919) % 200) as f32 / 100.0 - 1.0).collect();
        let senses: Vec<f32> = (0..17).map(|i| (i as f32 * 0.37).sin()).collect();
        let mut one = Brain::new(layout);
        let mut two = Brain::new(layout);
        one.think(&weights, &senses);
        two.think(&weights, &[0.0; 17]);
        two.think(&weights, &senses);
        assert_eq!(one.outputs.iter().map(|x| x.to_bits()).collect::<Vec<_>>(), two.outputs.iter().map(|x| x.to_bits()).collect::<Vec<_>>());
        assert!(one.outputs.iter().all(|x| x.abs() <= 1.0) && one.outputs.iter().any(|x| *x != 0.0));
        // a brain with every weight zero is calm: every output is zero
        let mut calm = Brain::new(layout);
        calm.think(&vec![0.0; layout.weights()], &senses);
        assert!(calm.outputs.iter().all(|x| *x == 0.0));
    }
}
