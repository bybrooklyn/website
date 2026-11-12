//! The brain: a small network of one to four hidden layers, with a little memory. Each hidden neuron
//! adds up what comes in, each times its own weight, plus a bias, and squashes the sum with tanh;
//! the next layer does the same with those, and the last gives the outputs. All the weights sit in
//! one flat list of f32, which is what evolution changes and what a shared link carries.
//!
//! Memory is a few extra outputs that are not sent to the legs but fed back in with the senses on
//! the next step, so the brain can keep a beat or react to what just happened. It starts at zero at
//! the start of every run (`forget`), so a run played again is the same run.
//!
//! The list holds, in order, for each layer from the inputs to the outputs: for each neuron its
//! weight for everything coming in, then that layer's biases. The inputs are the senses and then
//! the memory; the outputs are the legs' and then the memory's.

use alloc::vec;
use alloc::vec::Vec;

use crate::math::{clamp, tanh};

/// Hidden neurons in a layer when nothing else is asked for. Enough for a gait, few enough to learn in
/// minutes.
pub const HIDDEN: usize = 12;
/// The most hidden neurons a layer may have, hidden layers a brain may have, and memories.
pub const MOST_HIDDEN: usize = 64;
pub const MOST_LAYERS: usize = 4;
pub const MOST_MEMORY: usize = 16;
/// The most an output may change in one step, out of its range of 2: a full swing takes a fifth of a
/// second.
pub const MOST_CHANGE: f32 = 0.17;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Layout {
    pub inputs: usize,
    /// Neurons in each hidden layer.
    pub hidden: usize,
    /// One to four hidden layers.
    pub layers: usize,
    pub outputs: usize,
    /// Values the brain keeps from one step to the next.
    pub memory: usize,
}

impl Layout {
    pub fn new(inputs: usize, outputs: usize) -> Layout {
        Layout { inputs, hidden: HIDDEN, layers: 1, outputs, memory: 0 }
    }

    /// A layout with `hidden` neurons in each of `layers` hidden layers and `memory` memories, kept
    /// within what is allowed.
    pub fn sized(inputs: usize, outputs: usize, hidden: usize, layers: usize, memory: usize) -> Layout {
        Layout { inputs, hidden: hidden.clamp(2, MOST_HIDDEN), layers: layers.clamp(1, MOST_LAYERS), outputs, memory: memory.min(MOST_MEMORY) }
    }

    /// The size of each layer in turn, from what comes in to what goes out.
    fn sizes(&self) -> impl Iterator<Item = usize> + '_ {
        core::iter::once(self.inputs + self.memory).chain(core::iter::repeat_n(self.hidden, self.layers)).chain(core::iter::once(self.outputs + self.memory))
    }

    /// How large each first weight should be, weight by weight in the list's order: for a layer, the
    /// square root of one over what comes in to each neuron, so that a neuron's sum starts near the
    /// middle of tanh however wide the layer before it is. Biases start small, and so do the weights
    /// that make memory, so that memory fed back in does not grow on itself.
    pub fn scales(&self) -> Vec<f32> {
        let sizes: Vec<usize> = self.sizes().collect();
        let mut scales = Vec::with_capacity(self.weights());
        for (at, pair) in sizes.windows(2).enumerate() {
            let (incoming, neurons) = (pair[0], pair[1]);
            let weight = crate::math::sqrt(1.0 / incoming as f32);
            let last = at == sizes.len() - 2;
            for neuron in 0..neurons {
                let memory = last && neuron >= self.outputs;
                scales.extend(core::iter::repeat_n(if memory { 0.5 * weight } else { weight }, incoming));
            }
            scales.extend(core::iter::repeat_n(0.1, neurons));
        }
        scales
    }

    /// How many weights a brain of this shape has.
    pub fn weights(&self) -> usize {
        let sizes: Vec<usize> = self.sizes().collect();
        sizes.windows(2).map(|pair| pair[1] * (pair[0] + 1)).sum()
    }

    /// How many neurons are hidden, in all layers together.
    pub fn neurons(&self) -> usize {
        self.hidden * self.layers
    }
}

#[derive(Clone, Debug)]
pub struct Brain {
    pub layout: Layout,
    /// What each hidden neuron gave last time, layer after layer, and each output, to draw the brain
    /// thinking.
    pub hidden: Vec<f32>,
    pub outputs: Vec<f32>,
    /// What the brain is keeping for its next step.
    pub memory: Vec<f32>,
    /// Whether this brain's outputs have been given yet in this run; the first are taken as they are.
    started: bool,
    /// Room for what comes in, and for what the last layer gives before it is split.
    incoming: Vec<f32>,
    last: Vec<f32>,
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
        Brain {
            layout,
            hidden: vec![0.0; layout.neurons()],
            outputs: vec![0.0; layout.outputs],
            memory: vec![0.0; layout.memory],
            started: false,
            incoming: vec![0.0; layout.inputs + layout.memory],
            last: vec![0.0; layout.outputs + layout.memory],
        }
    }

    /// Empties the memory, for the start of a run.
    pub fn forget(&mut self) {
        self.memory.iter_mut().for_each(|value| *value = 0.0);
        self.started = false;
    }

    /// Runs the senses and the memory through the network with the given weights. The answer is in
    /// `outputs`, and the memory is what it kept for next time.
    pub fn think(&mut self, weights: &[f32], senses: &[f32]) {
        let Layout { inputs, hidden: size, layers, outputs, .. } = self.layout;
        self.incoming[..inputs].copy_from_slice(&senses[..inputs]);
        self.incoming[inputs..].copy_from_slice(&self.memory);
        let mut rest = layer(weights, &self.incoming, &mut self.hidden[..size]);
        for at in 1..layers {
            let (before, after) = self.hidden.split_at_mut(at * size);
            rest = layer(rest, &before[(at - 1) * size..], &mut after[..size]);
        }
        layer(rest, &self.hidden[(layers - 1) * size..], &mut self.last);
        // an output may move only so far in a step, as a muscle can only tighten so fast: a brain
        // that flips its answer every step moves the legs no faster than one that means it
        for (output, &wanted) in self.outputs.iter_mut().zip(&self.last[..outputs]) {
            *output = if self.started { *output + clamp(wanted - *output, -MOST_CHANGE, MOST_CHANGE) } else { wanted };
        }
        self.started = true;
        self.memory.copy_from_slice(&self.last[outputs..]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_brain_gives_the_same_outputs_for_the_same_inputs() {
        for layout in [Layout::new(17, 4), Layout::sized(21, 4, 24, 2, 0), Layout::sized(19, 12, 48, 4, 6)] {
            let weights: Vec<f32> = (0..layout.weights()).map(|i| ((i * 7919) % 200) as f32 / 100.0 - 1.0).collect();
            let senses: Vec<f32> = (0..layout.inputs).map(|i| (i as f32 * 0.37).sin()).collect();
            let mut one = Brain::new(layout);
            let mut two = Brain::new(layout);
            one.think(&weights, &senses);
            two.think(&weights, &vec![0.0; layout.inputs]);
            two.forget();
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
        assert_eq!(Layout::sized(21, 4, 24, 2, 0).weights(), 24 * 22 + 24 * 25 + 4 * 25);
        assert_eq!(Layout::sized(19, 12, 8, 3, 2).weights(), 8 * 22 + 8 * 9 + 8 * 9 + 14 * 9);
    }

    #[test]
    fn memory_carries_from_one_step_to_the_next_and_is_forgotten_on_request() {
        let layout = Layout::sized(3, 2, 6, 1, 2);
        let weights: Vec<f32> = (0..layout.weights()).map(|i| ((i * 31) % 17) as f32 / 8.0 - 1.0).collect();
        let mut brain = Brain::new(layout);
        brain.think(&weights, &[0.5, -0.2, 0.1]);
        let first = brain.outputs.clone();
        assert!(brain.memory.iter().any(|value| *value != 0.0));
        // the same senses give a different answer once there is something in memory
        brain.think(&weights, &[0.5, -0.2, 0.1]);
        assert_ne!(brain.outputs, first);
        brain.forget();
        brain.think(&weights, &[0.5, -0.2, 0.1]);
        assert_eq!(brain.outputs, first);
    }
}
