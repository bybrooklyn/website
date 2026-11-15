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
use super::net::Net;
use super::pool::{self, Shape};
use super::ppo::Learner;
use crate::brain::{Brain, Layout};

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

/// A brain with a pool, drawn by kind. Its neurons are numbered one after another: what it senses
/// (each ray one dot, as above), the first plain layer, the memory neurons, the rhythms, the moods, the
/// second plain layer, and what it does.
struct Kinds {
    dots: usize,
    plain: usize,
    memory: usize,
    rhythm: usize,
    mood: usize,
    actions: usize,
}

impl Kinds {
    fn of(learner: &Learner) -> Kinds {
        let shape = learner.pool().map_or(Shape::PLAIN, |pool| pool.shape);
        let rays = if learner.senses >= RAYS * EACH_RAY { RAYS } else { 0 };
        Kinds { dots: learner.senses - rays * (EACH_RAY - 1), plain: learner.settings.hidden, memory: shape.memory, rhythm: shape.rhythm, mood: shape.mood, actions: learner.actions }
    }

    fn first_plain(&self) -> usize {
        self.dots
    }
    fn pool(&self) -> usize {
        self.dots + self.plain
    }
    fn second_plain(&self) -> usize {
        self.pool() + self.memory + self.rhythm + self.mood
    }
    fn acts(&self) -> usize {
        self.second_plain() + self.plain
    }
    fn count(&self) -> usize {
        self.acts() + self.actions
    }
    /// The dot a sense goes to.
    fn dot(&self, k: usize, senses: usize) -> usize {
        let rays = (senses - self.dots) / (EACH_RAY - 1);
        if k < rays * EACH_RAY { k / EACH_RAY } else { k - rays * (EACH_RAY - 1) }
    }
    /// The neuron a pool's read comes from.
    fn source(&self, code: u32, senses: usize) -> usize {
        let i = (code & 0xffff) as usize;
        match code >> 16 {
            pool::SENSED => self.dot(i, senses),
            pool::PLAIN => self.first_plain() + i,
            pool::MEMORY => self.pool() + i,
            pool::SINE | pool::COSINE => self.pool() + self.memory + i,
            _ => self.pool() + self.memory + self.rhythm + i,
        }
    }
}

/// One connection into a neuron: where from, its weight now, what it passed at the last decision, and
/// how much its weight has changed in this run by its fast weight (plastic reads only).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Into {
    pub from: usize,
    pub weight: f32,
    pub passed: f32,
    pub changed: f32,
}

/// Every connection into neuron `n` of a learner with a pool on show, as it last thought.
pub fn into(learner: &Learner, n: usize) -> Vec<Into> {
    let kinds = Kinds::of(learner);
    let Some((shown, state)) = learner.shown() else { return Vec::new() };
    let Some(pool) = learner.pool() else { return Vec::new() };
    let (s, h, a) = (learner.senses, kinds.plain, kinds.actions);
    let input = learner.shown_input();
    let w = &learner.weights;
    let mut out: Vec<Into> = Vec::new();
    let mut add = |from: usize, weight: f32, passed: f32, changed: f32| match out.iter_mut().find(|c| c.from == from) {
        Some(c) => {
            c.weight += weight;
            c.passed += passed;
            c.changed += changed;
        }
        None => out.push(Into { from, weight, passed, changed }),
    };
    if n < kinds.first_plain() {
        return Vec::new();
    } else if n < kinds.pool() {
        let j = n - kinds.first_plain();
        for k in 0..s {
            let weight = w[k * h + j];
            add(kinds.dot(k, s), weight, weight * input.get(k).copied().unwrap_or(0.0), 0.0);
        }
    } else if n < kinds.second_plain() {
        let p = n - kinds.pool();
        let k = pool.shape.reads;
        // what the pool read: what was sensed, the first layer, and the pool as it was before
        let mut before = alloc::vec![0.0; pool.shape.outputs()];
        if shown.before.len() == pool.shape.state() {
            pool.give(&shown.before, &mut before);
        }
        let pool_weights = &w[w.len() - pool.weights()..];
        for r in 0..k {
            let code = pool.reads[p * k + r];
            let i = (code & 0xffff) as usize;
            let value = match code >> 16 {
                pool::SENSED => input.get(i).copied().unwrap_or(0.0),
                pool::PLAIN => shown.plain_one.get(i).copied().unwrap_or(0.0),
                _ => before.get(pool.place(code) - s - h).copied().unwrap_or(0.0),
            };
            let weight = pool.read_weight(pool_weights, state, p, r);
            add(kinds.source(code, s), weight, weight * value, pool.changed(pool_weights, state, p, r));
        }
    } else if n < kinds.acts() {
        let j = n - kinds.second_plain();
        let start = learner.trunk.layers[0].weights();
        for i in 0..h {
            let weight = w[start + i * h + j];
            add(kinds.first_plain() + i, weight, weight * shown.plain_one.get(i).copied().unwrap_or(0.0), 0.0);
        }
        let shape = pool.shape;
        for o in 0..shape.outputs() {
            let weight = w[start + (h + o) * h + j];
            let from = if o < shape.memory {
                kinds.pool() + o
            } else if o < shape.memory + 2 * shape.rhythm {
                kinds.pool() + shape.memory + (o - shape.memory) % shape.rhythm
            } else {
                kinds.pool() + shape.memory + shape.rhythm + (o - shape.memory - 2 * shape.rhythm)
            };
            add(from, weight, weight * shown.pool.get(o).copied().unwrap_or(0.0), 0.0);
        }
    } else if n < kinds.count() {
        let j = n - kinds.acts();
        for i in 0..h {
            let weight = w[learner.at[1] + i * a + j];
            add(kinds.second_plain() + i, weight, weight * shown.plain_two.get(i).copied().unwrap_or(0.0), 0.0);
        }
    }
    out
}

/// The picture of a learner with a pool on show, given what it sensed (before rescaling), into `out`: -1
/// (so a reader knows it from `picture`'s), how many dots of what it senses, plain neurons in each plain
/// layer, memory neurons, rhythms, moods and actions; how lit each neuron is in the order `Kinds` numbers
/// them (a memory by what it holds, a rhythm by the sine of its phase, a mood by its level); how much each
/// memory and mood moved at the last decision, and each rhythm's phase; then for every neuron
/// after what it senses, the three connections into it passing the most just then (for the second plain
/// layer, the three from the pool), three numbers each:
/// where from (-1 for none), what it passed, and how much its weight has changed in this run.
pub fn pool_picture(learner: &Learner, senses: &[f32], out: &mut Vec<f32>) {
    let kinds = Kinds::of(learner);
    out.clear();
    let Some((shown, state)) = learner.shown() else { return };
    let Some(pool) = learner.pool() else { return };
    let shape = pool.shape;
    out.extend_from_slice(&[-1.0, kinds.dots as f32, kinds.plain as f32, kinds.memory as f32, kinds.rhythm as f32, kinds.mood as f32, kinds.actions as f32]);
    let s = learner.senses;
    let rays = (s - kinds.dots) / (EACH_RAY - 1);
    for k in 0..s {
        if k >= rays * EACH_RAY || k % EACH_RAY == 0 {
            out.push(senses.get(k).copied().unwrap_or(0.0));
        }
    }
    let lit = |list: &[f32], count: usize, out: &mut Vec<f32>| out.extend((0..count).map(|i| list.get(i).copied().unwrap_or(0.0)));
    lit(&shown.plain_one, kinds.plain, out);
    let have = state.len() == shape.state();
    for i in 0..shape.memory {
        out.push(if have { state[i] } else { 0.0 });
    }
    for j in 0..shape.rhythm {
        out.push(if have { crate::math::sin_cos(state[shape.memory + j]).0 } else { 0.0 });
    }
    for m in 0..shape.mood {
        out.push(if have { state[shape.memory + shape.rhythm + m] } else { 0.0 });
    }
    lit(&shown.plain_two, kinds.plain, out);
    let acts = learner.shown_actions();
    out.extend((0..kinds.actions).map(|i| acts.get(i).copied().unwrap_or(0.0).clamp(-1.0, 1.0)));
    let before = &shown.before;
    for i in 0..shape.memory + shape.rhythm + shape.mood {
        let moved = if i >= shape.memory && i < shape.memory + shape.rhythm {
            // a rhythm: its phase, so a picture can show it going round
            if have { state[i] } else { 0.0 }
        } else if have && before.len() == state.len() {
            state[i] - before[i]
        } else {
            0.0
        };
        out.push(moved);
    }
    for n in kinds.first_plain()..kinds.count() {
        let mut list = into(learner, n);
        // the second plain layer reads the first densely, and drawn those lines would bury the pool between
        // them: what it takes from the pool is drawn instead, so the picture shows the pool feeding what it does
        if n >= kinds.second_plain() && n < kinds.acts() {
            list.retain(|c| c.from >= kinds.pool() && c.from < kinds.second_plain());
        }
        let order = pool::strongest(&(0..list.len()).collect::<Vec<_>>(), &|k| list[k].passed.abs());
        for k in 0..3 {
            match order.get(k).map(|&k| &list[k]) {
                Some(c) => out.extend_from_slice(&[c.from as f32, c.passed, c.changed]),
                None => out.extend_from_slice(&[-1.0, 0.0, 0.0]),
            }
        }
    }
}
