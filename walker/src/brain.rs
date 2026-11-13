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
    /// The weights it thinks with (`load`), laid out for adding up many neurons at once: each layer
    /// in blocks of up to `BLOCK` neurons, each block input by input, then the layer's biases.
    arranged: Vec<f32>,
}

/// How many neurons of a layer are added up side by side: four lanes of SIMD, four times over.
const BLOCK: usize = 16;

/// Lays out one layer's weights from the list's order (neuron by neuron, each its weight for every
/// input) into `into`, by blocks of neurons, input by input. Returns the weights it did not use.
fn arrange<'a>(weights: &'a [f32], inputs: usize, outputs: usize, into: &mut Vec<f32>) -> &'a [f32] {
    let (rows, rest) = weights.split_at(outputs * inputs);
    let (biases, rest) = rest.split_at(outputs);
    for first in (0..outputs).step_by(BLOCK) {
        let wide = (outputs - first).min(BLOCK);
        for i in 0..inputs {
            into.extend((first..first + wide).map(|j| rows[j * inputs + i]));
        }
    }
    into.extend_from_slice(biases);
    rest
}

/// One layer: every output is tanh of its weighted sum of the inputs plus its bias. Returns the
/// weights it did not use. Each neuron's sum is added up in the order one neuron at a time would
/// have it (its bias, then each input in turn), so the answer is the same to the bit; only the
/// neurons of a block are added up side by side, which the compiler turns into SIMD.
fn layer<'a>(arranged: &'a [f32], inputs: &[f32], outputs: &mut [f32]) -> &'a [f32] {
    let (mut blocks, rest) = arranged.split_at(outputs.len() * inputs.len());
    let (biases, rest) = rest.split_at(outputs.len());
    for (outputs, biases) in outputs.chunks_mut(BLOCK).zip(biases.chunks(BLOCK)) {
        let (block, after) = blocks.split_at(outputs.len() * inputs.len());
        blocks = after;
        if let (Ok(outputs), Ok(biases)) = (<&mut [f32; BLOCK]>::try_from(&mut *outputs), <&[f32; BLOCK]>::try_from(biases)) {
            // a whole block, its sums kept in registers
            let mut sums = *biases;
            for (row, &input) in block.chunks_exact(BLOCK).zip(inputs) {
                for (sum, &weight) in sums.iter_mut().zip(row) {
                    *sum += weight * input;
                }
            }
            for (output, sum) in outputs.iter_mut().zip(sums) {
                *output = tanh(sum);
            }
        } else {
            let wide = outputs.len();
            outputs.copy_from_slice(biases);
            for (row, &input) in block.chunks_exact(wide).zip(inputs) {
                for (sum, &weight) in outputs.iter_mut().zip(row) {
                    *sum += weight * input;
                }
            }
            for output in outputs.iter_mut() {
                *output = tanh(*output);
            }
        }
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
            arranged: vec![0.0; layout.weights()],
        }
    }

    /// A brain of this layout that thinks with these weights.
    pub fn with(layout: Layout, weights: &[f32]) -> Brain {
        let mut brain = Brain::new(layout);
        brain.load(weights);
        brain
    }

    /// Takes the weights to think with, in the list's order, and empties the memory, for the start
    /// of a run. The weights are laid out for thinking once here, not at every step.
    pub fn load(&mut self, weights: &[f32]) {
        let Layout { inputs, hidden, layers, outputs, memory } = self.layout;
        self.arranged.clear();
        let mut rest = arrange(weights, inputs + memory, hidden, &mut self.arranged);
        for _ in 1..layers {
            rest = arrange(rest, hidden, hidden, &mut self.arranged);
        }
        arrange(rest, hidden, outputs + memory, &mut self.arranged);
        self.forget();
    }

    /// Empties the memory, for the start of a run.
    pub fn forget(&mut self) {
        self.memory.iter_mut().for_each(|value| *value = 0.0);
        self.started = false;
    }

    /// Runs the senses and the memory through the network with the weights it was given (`load`).
    /// The answer is in `outputs`, and the memory is what it kept for next time.
    /// What came in at the last step: what it sensed, then what it had kept.
    pub fn incoming(&self) -> &[f32] {
        &self.incoming
    }

    pub fn think(&mut self, senses: &[f32]) {
        let Layout { inputs, hidden: size, layers, outputs, .. } = self.layout;
        self.incoming[..inputs].copy_from_slice(&senses[..inputs]);
        self.incoming[inputs..].copy_from_slice(&self.memory);
        let mut rest = layer(&self.arranged, &self.incoming, &mut self.hidden[..size]);
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

    /// One layer worked the plain way, a neuron at a time from the list's order, as the brain always
    /// did, to hold the quick way to.
    fn plain_layer<'a>(weights: &'a [f32], inputs: &[f32], outputs: &mut [f32]) -> &'a [f32] {
        let (rows, rest) = weights.split_at(outputs.len() * inputs.len());
        let (biases, rest) = rest.split_at(outputs.len());
        for (j, output) in outputs.iter_mut().enumerate() {
            let row = &rows[j * inputs.len()..(j + 1) * inputs.len()];
            *output = tanh(row.iter().zip(inputs).fold(biases[j], |sum, (w, x)| sum + w * x));
        }
        rest
    }

    #[test]
    fn neurons_added_up_side_by_side_give_what_one_at_a_time_gives_to_the_bit() {
        for (inputs, outputs) in [(1, 1), (3, 7), (22, 16), (19, 17), (64, 64), (72, 33), (5, 48)] {
            let weights: Vec<f32> = (0..outputs * (inputs + 1)).map(|i| ((i * 7919) % 2000) as f32 / 700.0 - 1.4).collect();
            let given: Vec<f32> = (0..inputs).map(|i| (i as f32 * 0.37).sin() * 1.3).collect();
            let mut arranged = Vec::new();
            arrange(&weights, inputs, outputs, &mut arranged);
            let (mut quick, mut plain) = (vec![0.0; outputs], vec![0.0; outputs]);
            layer(&arranged, &given, &mut quick);
            plain_layer(&weights, &given, &mut plain);
            assert_eq!(quick.iter().map(|x| x.to_bits()).collect::<Vec<_>>(), plain.iter().map(|x| x.to_bits()).collect::<Vec<_>>(), "{inputs} in, {outputs} out");
        }
    }

    #[test]
    fn the_brain_gives_the_same_outputs_for_the_same_inputs() {
        for layout in [Layout::new(17, 4), Layout::sized(21, 4, 24, 2, 0), Layout::sized(19, 12, 48, 4, 6)] {
            let weights: Vec<f32> = (0..layout.weights()).map(|i| ((i * 7919) % 200) as f32 / 100.0 - 1.0).collect();
            let senses: Vec<f32> = (0..layout.inputs).map(|i| (i as f32 * 0.37).sin()).collect();
            let mut one = Brain::with(layout, &weights);
            let mut two = Brain::with(layout, &weights);
            one.think(&senses);
            two.think(&vec![0.0; layout.inputs]);
            two.forget();
            two.think(&senses);
            assert_eq!(one.outputs.iter().map(|x| x.to_bits()).collect::<Vec<_>>(), two.outputs.iter().map(|x| x.to_bits()).collect::<Vec<_>>());
            assert!(one.outputs.iter().all(|x| x.abs() <= 1.0) && one.outputs.iter().any(|x| *x != 0.0));
            assert_eq!(one.hidden.len(), layout.neurons());
            // a brain with every weight zero is calm: every output is zero
            let mut calm = Brain::with(layout, &vec![0.0; layout.weights()]);
            calm.think(&senses);
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
        let mut brain = Brain::with(layout, &weights);
        brain.think(&[0.5, -0.2, 0.1]);
        let first = brain.outputs.clone();
        assert!(brain.memory.iter().any(|value| *value != 0.0));
        // the same senses give a different answer once there is something in memory
        brain.think(&[0.5, -0.2, 0.1]);
        assert_ne!(brain.outputs, first);
        brain.forget();
        brain.think(&[0.5, -0.2, 0.1]);
        assert_eq!(brain.outputs, first);
    }
}
