//! A brain drawn as it thinks, for the page: its columns of neurons, from what it senses to what it
//! does, how brightly each neuron is lit, and how much passes along each connection (the weight times
//! what its neuron gave). Any brain that can say these three things (`Drawn`) can be drawn, whatever
//! its layers and kinds of neuron: the policy that practice trains and the brain evolution breeds both
//! do, so the page draws either the same way.
//!
//! What it senses is a long list (sixteen rays of six numbers each, then the body), too long to draw
//! a dot for each, so each ray's six are drawn as one dot, lit by how near what the ray meets is, and
//! what passes from it is the sum of what passes from its six.

use alloc::vec::Vec;

use super::eyes::RAYS;
use crate::brain::{Brain, Layout};
use super::net::Net;

/// A brain that can be drawn.
pub trait Drawn {
    /// How many neurons in each column, what comes in first and what goes out last.
    fn columns(&self) -> Vec<usize>;
    /// What the neurons of column `column` gave at the last decision, into `into`; for the first,
    /// what came in, as the first layer took it.
    fn gave(&self, column: usize, into: &mut Vec<f32>);
    /// The weight from neuron `i` of column `column` to neuron `j` of the next.
    fn weight(&self, column: usize, i: usize, j: usize) -> f32;
}

/// Numbers each ray gives a brain (`eyes::sense`).
const EACH_RAY: usize = 6;

/// The picture of `brain`, given what it senses as it sensed it (`senses`, before any rescaling), into
/// `out`: the number of columns, the number of dots in each, how lit each dot is (column after
/// column), then for each column after the first what passes into each of its dots from each dot of
/// the column before (dot by dot of the later column, each a row over the earlier).
pub fn picture(brain: &impl Drawn, senses: &[f32], out: &mut Vec<f32>) {
    let columns = brain.columns();
    let inputs = columns[0];
    let rays = if senses.len() >= RAYS * EACH_RAY && inputs >= RAYS * EACH_RAY { RAYS } else { 0 };
    // which drawn dot each input goes to
    let dot = |k: usize| if k < rays * EACH_RAY { k / EACH_RAY } else { k - rays * (EACH_RAY - 1) };
    let mut drawn = columns.clone();
    drawn[0] = inputs - rays * (EACH_RAY - 1);
    out.clear();
    out.push(drawn.len() as f32);
    out.extend(drawn.iter().map(|&count| count as f32));
    let mut gave: Vec<Vec<f32>> = (0..columns.len()).map(|_| Vec::new()).collect();
    for (column, into) in gave.iter_mut().enumerate() {
        brain.gave(column, into);
    }
    // the first column lit as it was sensed: each ray by its nearness, the rest as they came
    for k in 0..inputs {
        if k < rays * EACH_RAY {
            if k % EACH_RAY == 0 {
                out.push(senses[k]);
            }
        } else {
            out.push(senses.get(k).copied().unwrap_or(gave[0][k]));
        }
    }
    let last = columns.len() - 1;
    for (column, values) in gave.iter().enumerate().skip(1) {
        out.extend(values.iter().map(|&value| if column == last { value.clamp(-1.0, 1.0) } else { value }));
    }
    for column in 0..last {
        let (from, to) = (drawn[column], columns[column + 1]);
        let start = out.len();
        out.resize(start + from * to, 0.0);
        let flows = &mut out[start..];
        for j in 0..to {
            for (i, &given) in gave[column].iter().enumerate() {
                let at = if column == 0 { dot(i) } else { i };
                flows[j * from + at] += brain.weight(column, i, j) * given;
            }
        }
    }
}

/// Where layer `k`'s weights start in a `Net`'s list.
pub fn layer_start(net: &Net, k: usize) -> usize {
    net.layers[..k].iter().map(|layer| layer.weights()).sum()
}

/// Evolution's brain, drawn: what it sensed and what it had kept, its hidden layers, and what it
/// does and keeps. Its weights are kept neuron by neuron, each its weight for every input, then the
/// layer's biases (`brain::Brain`).
pub struct Bred<'a> {
    pub brain: &'a Brain,
    pub weights: &'a [f32],
}

impl Bred<'_> {
    /// How many neurons column `k` has: what comes in, each hidden layer, then what goes out.
    fn size(&self, k: usize) -> usize {
        let Layout { inputs, hidden, layers, outputs, memory } = self.brain.layout;
        if k == 0 { inputs + memory } else if k <= layers { hidden } else { outputs + memory }
    }
}

impl Drawn for Bred<'_> {
    fn columns(&self) -> Vec<usize> {
        (0..self.brain.layout.layers + 2).map(|k| self.size(k)).collect()
    }

    fn gave(&self, column: usize, into: &mut Vec<f32>) {
        into.clear();
        let Layout { hidden, layers, .. } = self.brain.layout;
        match column {
            0 => into.extend_from_slice(self.brain.incoming()),
            k if k <= layers => into.extend_from_slice(&self.brain.hidden[(k - 1) * hidden..k * hidden]),
            _ => {
                into.extend_from_slice(&self.brain.outputs);
                into.extend_from_slice(&self.brain.memory);
            }
        }
    }

    // asked for every connection drawn, each frame, so it makes no list of its own
    fn weight(&self, column: usize, i: usize, j: usize) -> f32 {
        let start: usize = (0..column).map(|k| (self.size(k) + 1) * self.size(k + 1)).sum();
        self.weights.get(start + j * self.size(column) + i).copied().unwrap_or(0.0)
    }
}
