//! The brain: a small network of one or two hidden layers. Each hidden neuron adds up what comes in,
//! each times its own weight, plus a bias, and squashes the sum with tanh; the next layer does the
//! same with those, and each output is the target for one joint. All the weights sit in one flat list
//! of f32, which is what evolution changes and what a shared link carries.
//!
//! The list holds, in order, for each layer from the senses to the outputs: for each neuron its
//! weight for everything coming in, then that layer's biases.

use alloc::vec;
use alloc::vec::Vec;

use crate::math::tanh;

/// Hidden neurons in a layer when nothing else is asked for. Enough for a gait, few enough to learn in
/// minutes.
pub const HIDDEN: usize = 12;
/// The most hidden neurons a layer may have.
pub const MOST_HIDDEN: usize = 64;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Layout {
    pub inputs: usize,
    /// Neurons in each hidden layer.
    pub hidden: usize,
    /// One or two hidden layers.
    pub layers: usize,
    pub outputs: usize,
}

impl Layout {
    pub fn new(inputs: usize, outputs: usize) -> Layout {
        Layout { inputs, hidden: HIDDEN, layers: 1, outputs }
    }

    /// A layout with `hidden` neurons in each of `layers` hidden layers, kept within what is allowed.
    pub fn sized(inputs: usize, outputs: usize, hidden: usize, layers: usize) -> Layout {
        Layout { inputs, hidden: hidden.clamp(2, MOST_HIDDEN), layers: layers.clamp(1, 2), outputs }
    }

    /// How many weights a brain of this shape has.
    pub fn weights(&self) -> usize {
        let middle = if self.layers == 2 { self.hidden * (self.hidden + 1) } else { 0 };
        self.hidden * (self.inputs + 1) + middle + self.outputs * (self.hidden + 1)
    }

    /// How many neurons are hidden, in all layers together.
    pub fn neurons(&self) -> usize {
        self.hidden * self.layers
    }
}

#[derive(Clone, Debug)]
pub struct Brain {
    pub layout: Layout,
    /// What each hidden neuron gave last time, the first layer then the second, and each output, to
    /// draw the brain thinking.
    pub hidden: Vec<f32>,
    pub outputs: Vec<f32>,
}

/// One layer: every output is tanh of its weighted sum of the inputs plus its bias. Returns the
/// weights it did not use.
fn layer<'a>(weights: &'a [f32], inputs: &[f32], outputs: &mut [f32]) -> &'a [f32] {
    let (rows, rest) = weights.split_at(outputs.len() * inputs.len());
    let (biases, rest) = rest.split_at(outputs.len());
    for (j, output) in outputs.iter_mut().enumerate() {
        let row = &rows[j * inputs.len()..(j + 1) * inputs.len()];
        let sum = row.iter().zip(inputs).fold(biases[j], |sum, (w, x)| sum + w * x);
        *output = tanh(sum);
    }
    rest
}

impl Brain {
    pub fn new(layout: Layout) -> Brain {
        Brain { layout, hidden: vec![0.0; layout.neurons()], outputs: vec![0.0; layout.outputs] }
    }

    /// Runs the senses through the network with the given weights. The answer is in `outputs`.
    pub fn think(&mut self, weights: &[f32], senses: &[f32]) {
        let size = self.layout.hidden;
        let (first, second) = self.hidden.split_at_mut(size);
        let rest = layer(weights, senses, first);
        if self.layout.layers == 2 {
            let rest = layer(rest, first, second);
            layer(rest, second, &mut self.outputs);
        } else {
            layer(rest, first, &mut self.outputs);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_brain_gives_the_same_outputs_for_the_same_inputs() {
        for layout in [Layout::new(17, 4), Layout::sized(21, 4, 24, 2)] {
            let weights: Vec<f32> = (0..layout.weights()).map(|i| ((i * 7919) % 200) as f32 / 100.0 - 1.0).collect();
            let senses: Vec<f32> = (0..layout.inputs).map(|i| (i as f32 * 0.37).sin()).collect();
            let mut one = Brain::new(layout);
            let mut two = Brain::new(layout);
            one.think(&weights, &senses);
            two.think(&weights, &vec![0.0; layout.inputs]);
            two.think(&weights, &senses);
            assert_eq!(one.outputs.iter().map(|x| x.to_bits()).collect::<Vec<_>>(), two.outputs.iter().map(|x| x.to_bits()).collect::<Vec<_>>());
            assert!(one.outputs.iter().all(|x| x.abs() <= 1.0) && one.outputs.iter().any(|x| *x != 0.0));
            assert_eq!(one.hidden.len(), layout.neurons());
            // a brain with every weight zero is calm: every output is zero
            let mut calm = Brain::new(layout);
            calm.think(&vec![0.0; layout.weights()], &senses);
            assert!(calm.outputs.iter().all(|x| *x == 0.0));
        }
        assert_eq!(Layout::new(17, 4).weights(), 12 * 18 + 4 * 13);
        assert_eq!(Layout::sized(21, 4, 24, 2).weights(), 24 * 22 + 24 * 25 + 4 * 25);
    }
}
