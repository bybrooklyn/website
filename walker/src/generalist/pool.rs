//! The brain's pool: neurons that carry something from one decision to the next, beside the plain
//! neurons of `net`, which carry nothing. Three kinds, each reading a few others (`Shape::reads` of
//! them, chosen when the neuron is made), so a bigger pool costs connections, not a full matrix:
//!
//! - **Memory**, a neuron with its own memory and timing: it moves from what it holds toward what it
//!   reads, by a share its gate decides at each decision (`z`). The gate's bias is its own time
//!   constant (some neurons start quick, some slow), and what it reads can open the gate at once, so it
//!   can take something in at one decision and hold it for many. Its reads into what it takes in are
//!   plastic: each carries a fast weight `F`, changed during a run by a Hebbian rule (what was read
//!   times what the neuron takes in, kept by a decay), so the same input means more or less as the
//!   run goes on. The rule's rate and decay are learned for each of four groups of neurons, and how
//!   much each connection follows its fast weight is learned for each connection, starting at none.
//!   Fast weights start at nothing every run.
//! - **Rhythm**, an oscillator the brain conducts: a phase that goes round at a pace of its own,
//!   which what it reads speeds up or slows down (by up to two thirds either way). It gives the sine
//!   and cosine of its phase to the rest, which may follow it or not.
//! - **Mood**, a slow neuron that moves toward what it reads at a rate of its own, starting slow, and
//!   turns a group of the plain neurons up or down: the second plain layer's neuron j is squashed with
//!   a gain of 1 plus mood `j % moods`, so a mood near -1 quietens its group and one near 1 sharpens it.
//!
//! Each reads from one list of sources: what is sensed (rescaled), the first plain layer, and every
//! pool neuron's output as it was before this decision. So the pool never waits on itself within a
//! decision, and learning goes back through time over a window of decisions (`Pool::backward`).
//!
//! Its weights are a flat list (`Pool::weights` long), neuron by neuron: each memory neuron's gate
//! reads, take-in reads and plasticity, then its two biases; the four groups' rate and decay; each
//! rhythm neuron's reads, bias and pace; each mood's reads, bias and rate. Its state, for each
//! creature: each memory, each phase, each mood, then each memory neuron's fast weights.

use alloc::vec;
use alloc::vec::Vec;

use crate::learn::Random;
use crate::math::{PI, exp, sin_cos, sqrt, tanh};

/// The groups whose plastic connections share a rate and a decay.
pub const PLASTIC_GROUPS: usize = 4;
/// Where a read comes from, as the high bits of its code: what is sensed, the first plain layer, a
/// memory, a rhythm's sine or cosine, a mood. The low sixteen bits are which one.
pub const SENSED: u32 = 0;
pub const PLAIN: u32 = 1;
pub const MEMORY: u32 = 2;
pub const SINE: u32 = 3;
pub const COSINE: u32 = 4;
pub const MOOD: u32 = 5;

/// How many neurons of each kind, and how many others each reads.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Shape {
    pub memory: usize,
    pub rhythm: usize,
    pub mood: usize,
    pub reads: usize,
}

impl Shape {
    /// No pool: the plain network alone.
    pub const PLAIN: Shape = Shape { memory: 0, rhythm: 0, mood: 0, reads: 0 };

    pub fn neurons(&self) -> usize {
        self.memory + self.rhythm + self.mood
    }

    pub fn is_plain(&self) -> bool {
        self.neurons() == 0
    }

    /// What the pool gives the rest: each memory, each rhythm's sine and cosine, each mood.
    pub fn outputs(&self) -> usize {
        self.memory + 2 * self.rhythm + self.mood
    }

    /// The state it carries for each creature.
    pub fn state(&self) -> usize {
        self.memory + self.rhythm + self.mood + self.memory * self.reads
    }

    /// Where each part of its weights starts: memory, the groups, rhythm, mood, and the end.
    fn starts(&self) -> [usize; 5] {
        let k = self.reads;
        let memory = 0;
        let groups = memory + self.memory * (3 * k + 2);
        let rhythm = groups + if self.memory > 0 { 2 * PLASTIC_GROUPS } else { 0 };
        let mood = rhythm + self.rhythm * (k + 2);
        [memory, groups, rhythm, mood, mood + self.mood * (k + 2)]
    }

    pub fn weights(&self) -> usize {
        self.starts()[4]
    }
}

/// A pool of a shape, reading from `senses` sensed numbers and `plain` plain neurons.
#[derive(Clone, Debug, PartialEq)]
pub struct Pool {
    pub shape: Shape,
    pub senses: usize,
    pub plain: usize,
    /// What each neuron reads, as codes (part and number), neuron by neuron: memory, rhythm, mood.
    pub reads: Vec<u32>,
    /// The same, as places in the list of sources.
    from: Vec<u32>,
}

/// The rate per decision of the slowest and quickest rhythm at the start, in turns a second for a
/// decision every fifteenth of a second.
const SLOWEST: f32 = 0.5;
const QUICKEST: f32 = 3.0;
const DECISIONS_A_SECOND: f32 = 15.0;
/// How far what a rhythm reads can change its pace: by e to the power of up to this, either way.
const PACE_REACH: f32 = 0.5;
/// The golden angle, in radians: the phases rhythms start at, one after another.
const GOLDEN: f32 = 2.399_963;

fn sigmoid(x: f32) -> f32 {
    1.0 / (1.0 + exp(-x))
}

impl Pool {
    /// A pool whose reads are drawn from `random`: each neuron reads distinct sources, from what is
    /// sensed, the first plain layer and the pool. A mood first reads the senses in `feelings` (energy,
    /// touch and the like), as many as it has room for.
    pub fn new(shape: Shape, senses: usize, plain: usize, feelings: &[usize], random: &mut Random) -> Pool {
        let mut pool = Pool { shape, senses, plain, reads: Vec::new(), from: Vec::new() };
        let all = pool.codes();
        for kind in 0..3 {
            let count = [shape.memory, shape.rhythm, shape.mood][kind];
            for _ in 0..count {
                let mut mine: Vec<u32> = Vec::with_capacity(shape.reads);
                if kind == 2 {
                    mine.extend(feelings.iter().take(shape.reads / 2).map(|&f| (SENSED << 16) | f as u32));
                }
                pool.draw(&all, &mut mine, random);
                pool.reads.extend_from_slice(&mine);
            }
        }
        pool.resolve();
        pool
    }

    /// Fills a neuron's reads with distinct sources drawn evenly from `all`, up to the shape's count.
    fn draw(&self, all: &[u32], mine: &mut Vec<u32>, random: &mut Random) {
        let wanted = self.shape.reads.min(all.len());
        while mine.len() < wanted {
            let code = all[random.below(all.len())];
            if !mine.contains(&code) {
                mine.push(code);
            }
        }
    }

    /// Every source there is, as codes.
    fn codes(&self) -> Vec<u32> {
        let s = self.shape;
        let parts = [(SENSED, self.senses), (PLAIN, self.plain), (MEMORY, s.memory), (SINE, s.rhythm), (COSINE, s.rhythm), (MOOD, s.mood)];
        parts.iter().flat_map(|&(part, count)| (0..count as u32).map(move |i| (part << 16) | i)).collect()
    }

    /// The place in the list of sources of a code.
    pub fn place(&self, code: u32) -> usize {
        let s = self.shape;
        let (part, i) = (code >> 16, (code & 0xffff) as usize);
        let base = match part {
            SENSED => 0,
            PLAIN => self.senses,
            MEMORY => self.senses + self.plain,
            SINE => self.senses + self.plain + s.memory,
            COSINE => self.senses + self.plain + s.memory + s.rhythm,
            _ => self.senses + self.plain + s.memory + 2 * s.rhythm,
        };
        base + i
    }

    fn resolve(&mut self) {
        self.from = self.reads.iter().map(|&code| self.place(code) as u32).collect();
    }

    /// How long the list of sources is.
    pub fn sources(&self) -> usize {
        self.senses + self.plain + self.shape.outputs()
    }

    pub fn weights(&self) -> usize {
        self.shape.weights()
    }

    /// First weights: reads drawn evenly at a spread of about one over the square root of how many,
    /// plasticity at none, memory gates from quick to slow, rhythms from slow to quick, moods slow.
    pub fn first(&self, weights: &mut [f32], random: &mut Random) {
        let s = self.shape;
        let k = s.reads;
        let [memory, groups, rhythm, mood, _] = s.starts();
        let a = sqrt(3.0 / k.max(1) as f32);
        let mut draw = |weights: &mut [f32], gain: f32| weights.iter_mut().for_each(|w| *w = (2.0 * random.unit() - 1.0) * a * gain);
        for i in 0..s.memory {
            let at = memory + i * (3 * k + 2);
            draw(&mut weights[at..at + 2 * k], 1.0);
            weights[at + 2 * k..at + 3 * k].fill(0.0);
            // the gate's bias: from a quarter of the way a decision to under a fiftieth
            weights[at + 3 * k] = -1.0 - 3.0 * i as f32 / s.memory.max(2).saturating_sub(1) as f32;
            weights[at + 3 * k + 1] = 0.0;
        }
        if s.memory > 0 {
            // decay 0.9 and rate 0.1 a decision
            weights[groups..groups + PLASTIC_GROUPS].fill(2.2);
            weights[groups + PLASTIC_GROUPS..groups + 2 * PLASTIC_GROUPS].fill(-2.2);
        }
        for j in 0..s.rhythm {
            let at = rhythm + j * (k + 2);
            draw(&mut weights[at..at + k], 0.5);
            weights[at + k] = 0.0;
            let along = if s.rhythm > 1 { j as f32 / (s.rhythm - 1) as f32 } else { 0.5 };
            let turns = SLOWEST + (QUICKEST - SLOWEST) * along;
            weights[at + k + 1] = crate::math::ln(2.0 * PI * turns / DECISIONS_A_SECOND);
        }
        for q in 0..s.mood {
            let at = mood + q * (k + 2);
            draw(&mut weights[at..at + k], 0.5);
            weights[at + k] = 0.0;
            // a twentieth of the way a decision: about a second and a third to settle
            weights[at + k + 1] = -2.94;
        }
    }

    /// The state a run starts with, for one creature: nothing held, each rhythm at its own phase, every
    /// mood at rest, no fast weight.
    pub fn fresh(&self, state: &mut [f32]) {
        let s = self.shape;
        state.fill(0.0);
        for j in 0..s.rhythm {
            // each its own phase, by the golden angle, so a rhythm added later does not move the others
            state[s.memory + j] = (j as f32 * GOLDEN) % (2.0 * PI);
        }
    }

    /// What the pool gives the rest, from a creature's state.
    pub fn give(&self, state: &[f32], out: &mut [f32]) {
        let s = self.shape;
        out[..s.memory].copy_from_slice(&state[..s.memory]);
        for j in 0..s.rhythm {
            let (sin, cos) = sin_cos(state[s.memory + j]);
            out[s.memory + j] = sin;
            out[s.memory + s.rhythm + j] = cos;
        }
        let moods = s.memory + s.rhythm;
        out[s.memory + 2 * s.rhythm..s.outputs()].copy_from_slice(&state[moods..moods + s.mood]);
    }

    /// One decision for `rows` creatures: each reads what it senses (`x`, rescaled), the first plain
    /// layer (`h1`) and the pool as it was (`state`), and its state moves on in place. What the pool
    /// gives after it goes into `out`. With `trace`, what backward needs is kept.
    #[allow(clippy::too_many_arguments)]
    pub fn step(&self, weights: &[f32], x: &[f32], h1: &[f32], state: &mut [f32], out: &mut [f32], rows: usize, mut trace: Option<&mut Trace>) {
        let s = self.shape;
        let (k, q, wide, outs) = (s.reads, self.sources(), s.state(), s.outputs());
        let [memory, groups, rhythm, mood, _] = s.starts();
        let mut source = vec![0.0; q];
        for r in 0..rows {
            let state = &mut state[r * wide..(r + 1) * wide];
            source[..self.senses].copy_from_slice(&x[r * self.senses..(r + 1) * self.senses]);
            source[self.senses..self.senses + self.plain].copy_from_slice(&h1[r * self.plain..(r + 1) * self.plain]);
            self.give(state, &mut source[self.senses + self.plain..]);
            if let Some(trace) = trace.as_deref_mut() {
                trace.sources.extend_from_slice(&source);
                trace.before.extend_from_slice(state);
            }
            let (held, rest) = state.split_at_mut(s.memory);
            let (phases, rest) = rest.split_at_mut(s.rhythm);
            let (moods, fast) = rest.split_at_mut(s.mood);
            for i in 0..s.memory {
                let at = memory + i * (3 * k + 2);
                let reads = &self.from[i * k..(i + 1) * k];
                let (wz, wc, plastic) = (&weights[at..at + k], &weights[at + k..at + 2 * k], &weights[at + 2 * k..at + 3 * k]);
                let f = &mut fast[i * k..(i + 1) * k];
                let (mut gate, mut take) = (weights[at + 3 * k], weights[at + 3 * k + 1]);
                for n in 0..k {
                    let read = source[reads[n] as usize];
                    gate += wz[n] * read;
                    take += (wc[n] + plastic[n] * f[n]) * read;
                }
                let (z, c) = (sigmoid(gate), tanh(take));
                held[i] += z * (c - held[i]);
                let g = i % PLASTIC_GROUPS;
                let (decay, rate) = (sigmoid(weights[groups + g]), sigmoid(weights[groups + PLASTIC_GROUPS + g]));
                for n in 0..k {
                    f[n] = decay * f[n] + rate * c * source[reads[n] as usize];
                }
                if let Some(trace) = trace.as_deref_mut() {
                    trace.gates.push(z);
                    trace.takes.push(c);
                }
            }
            for j in 0..s.rhythm {
                let at = rhythm + j * (k + 2);
                let reads = &self.from[(s.memory + j) * k..(s.memory + j + 1) * k];
                let mut u = weights[at + k];
                for n in 0..k {
                    u += weights[at + n] * source[reads[n] as usize];
                }
                let pull = tanh(u);
                let pace = exp(weights[at + k + 1] + PACE_REACH * pull);
                // kept within one turn: the gradient does not care, and an f32 keeps its precision
                let mut phase = phases[j] + pace;
                if phase > 2.0 * PI {
                    phase -= 2.0 * PI;
                }
                phases[j] = phase;
                if let Some(trace) = trace.as_deref_mut() {
                    trace.pulls.push(pull);
                    trace.paces.push(pace);
                }
            }
            for m in 0..s.mood {
                let at = mood + m * (k + 2);
                let reads = &self.from[(s.memory + s.rhythm + m) * k..(s.memory + s.rhythm + m + 1) * k];
                let mut v = weights[at + k];
                for n in 0..k {
                    v += weights[at + n] * source[reads[n] as usize];
                }
                let toward = tanh(v);
                moods[m] += sigmoid(weights[at + k + 1]) * (toward - moods[m]);
                if let Some(trace) = trace.as_deref_mut() {
                    trace.towards.push(toward);
                }
            }
            self.give(state, &mut out[r * outs..(r + 1) * outs]);
        }
    }

    /// A window of `steps` decisions for `rows` creatures, row by row within each decision (`x` and
    /// `h1` laid out so: decision 0's rows, then decision 1's). `start` is each creature's state at the
    /// window's start, and `fresh[t * rows + r]` says that creature's run started again just before
    /// decision t, so it begins that decision from a fresh state. What the pool gives at each decision
    /// goes into `out`, laid out as `x` is, and `trace` keeps what `backward` needs.
    #[allow(clippy::too_many_arguments)]
    pub fn forward(&self, weights: &[f32], x: &[f32], h1: &[f32], start: &[f32], fresh: &[bool], steps: usize, rows: usize, out: &mut [f32], trace: &mut Trace) {
        let (wide, outs) = (self.shape.state(), self.shape.outputs());
        trace.clear();
        trace.rows = rows;
        trace.steps = steps;
        let mut state = start[..rows * wide].to_vec();
        for t in 0..steps {
            for r in 0..rows {
                if fresh[t * rows + r] {
                    self.fresh(&mut state[r * wide..(r + 1) * wide]);
                }
            }
            let span = t * rows..(t + 1) * rows;
            self.step(weights, &x[span.start * self.senses..span.end * self.senses], &h1[span.start * self.plain..span.end * self.plain], &mut state, &mut out[span.start * outs..span.end * outs], rows, Some(trace));
        }
        trace.fresh.clear();
        trace.fresh.extend_from_slice(&fresh[..steps * rows]);
    }

    /// Learning back through the window `forward` kept in `trace`: `blame` is how much the loss grows
    /// for each unit each output grows, at each decision (laid out as `out` was). Each weight's share is
    /// added into `grads`, and the blame on the first plain layer into `h1_blame` (added, laid out as
    /// `h1` was). What came before the window's start, or before a fresh start, is not blamed.
    pub fn backward(&self, weights: &[f32], trace: &Trace, blame: &[f32], grads: &mut [f32], h1_blame: &mut [f32]) {
        let s = self.shape;
        let (k, q, wide, outs) = (s.reads, self.sources(), s.state(), s.outputs());
        let [memory, groups, rhythm, mood, _] = s.starts();
        let (rows, steps) = (trace.rows, trace.steps);
        // the blame carried back on each creature's state, from the decision after
        let mut carry = vec![0.0f32; rows * wide];
        let mut ds = vec![0.0f32; q];
        let mut back = vec![0.0f32; wide];
        let decays: Vec<f32> = (0..PLASTIC_GROUPS).map(|g| if s.memory > 0 { sigmoid(weights[groups + g]) } else { 0.0 }).collect();
        let rates: Vec<f32> = (0..PLASTIC_GROUPS).map(|g| if s.memory > 0 { sigmoid(weights[groups + PLASTIC_GROUPS + g]) } else { 0.0 }).collect();
        for t in (0..steps).rev() {
            for r in 0..rows {
                let row = t * rows + r;
                let source = &trace.sources[row * q..(row + 1) * q];
                let before = &trace.before[row * wide..(row + 1) * wide];
                let blamed = &blame[row * outs..(row + 1) * outs];
                // the blame on the state after this decision: carried, and on what it gave
                let g = &mut carry[r * wide..(r + 1) * wide];
                for i in 0..s.memory {
                    g[i] += blamed[i];
                }
                for j in 0..s.rhythm {
                    let phase = before[s.memory + j] + trace.paces[row * s.rhythm + j];
                    let (sin, cos) = sin_cos(phase);
                    g[s.memory + j] += blamed[s.memory + j] * cos - blamed[s.memory + s.rhythm + j] * sin;
                }
                for m in 0..s.mood {
                    g[s.memory + s.rhythm + m] += blamed[s.memory + 2 * s.rhythm + m];
                }
                ds.fill(0.0);
                back.fill(0.0);
                let fast_at = s.memory + s.rhythm + s.mood;
                for i in 0..s.memory {
                    let at = memory + i * (3 * k + 2);
                    let reads = &self.from[i * k..(i + 1) * k];
                    let (z, c) = (trace.gates[row * s.memory + i], trace.takes[row * s.memory + i]);
                    let held = before[i];
                    let gm = g[i];
                    let group = i % PLASTIC_GROUPS;
                    let (decay, rate) = (decays[group], rates[group]);
                    let f_before = &before[fast_at + i * k..fast_at + (i + 1) * k];
                    let gf = &g[fast_at + i * k..fast_at + (i + 1) * k];
                    back[i] += gm * (1.0 - z);
                    let dz = gm * (c - held);
                    let mut dc = gm * z;
                    let (mut d_decay, mut d_rate) = (0.0, 0.0);
                    for n in 0..k {
                        let read = source[reads[n] as usize];
                        back[fast_at + i * k + n] += gf[n] * decay;
                        d_decay += gf[n] * f_before[n];
                        d_rate += gf[n] * c * read;
                        ds[reads[n] as usize] += gf[n] * rate * c;
                        dc += gf[n] * rate * read;
                    }
                    grads[groups + group] += d_decay * decay * (1.0 - decay);
                    grads[groups + PLASTIC_GROUPS + group] += d_rate * rate * (1.0 - rate);
                    let d_gate = dz * z * (1.0 - z);
                    let d_take = dc * (1.0 - c * c);
                    grads[at + 3 * k] += d_gate;
                    grads[at + 3 * k + 1] += d_take;
                    for n in 0..k {
                        let read = source[reads[n] as usize];
                        let (wz, wc, plastic) = (weights[at + n], weights[at + k + n], weights[at + 2 * k + n]);
                        grads[at + n] += d_gate * read;
                        grads[at + k + n] += d_take * read;
                        grads[at + 2 * k + n] += d_take * f_before[n] * read;
                        ds[reads[n] as usize] += d_gate * wz + d_take * (wc + plastic * f_before[n]);
                        back[fast_at + i * k + n] += d_take * plastic * read;
                    }
                }
                for j in 0..s.rhythm {
                    let at = rhythm + j * (k + 2);
                    let reads = &self.from[(s.memory + j) * k..(s.memory + j + 1) * k];
                    let gp = g[s.memory + j];
                    back[s.memory + j] += gp;
                    let pace = trace.paces[row * s.rhythm + j];
                    let pull = trace.pulls[row * s.rhythm + j];
                    let d_pace = gp * pace;
                    grads[at + k + 1] += d_pace;
                    let du = d_pace * PACE_REACH * (1.0 - pull * pull);
                    grads[at + k] += du;
                    for n in 0..k {
                        grads[at + n] += du * source[reads[n] as usize];
                        ds[reads[n] as usize] += du * weights[at + n];
                    }
                }
                for m in 0..s.mood {
                    let at = mood + m * (k + 2);
                    let reads = &self.from[(s.memory + s.rhythm + m) * k..(s.memory + s.rhythm + m + 1) * k];
                    let gd = g[s.memory + s.rhythm + m];
                    let rate = sigmoid(weights[at + k + 1]);
                    let toward = trace.towards[row * s.mood + m];
                    let before_mood = before[s.memory + s.rhythm + m];
                    back[s.memory + s.rhythm + m] += gd * (1.0 - rate);
                    grads[at + k + 1] += gd * (toward - before_mood) * rate * (1.0 - rate);
                    let dv = gd * rate * (1.0 - toward * toward);
                    grads[at + k] += dv;
                    for n in 0..k {
                        grads[at + n] += dv * source[reads[n] as usize];
                        ds[reads[n] as usize] += dv * weights[at + n];
                    }
                }
                // what was read: the first plain layer's share goes to it, the pool's to its state before
                let h1 = &mut h1_blame[row * self.plain..(row + 1) * self.plain];
                h1.iter_mut().zip(&ds[self.senses..self.senses + self.plain]).for_each(|(b, &d)| *b += d);
                let prior = &ds[self.senses + self.plain..];
                for i in 0..s.memory {
                    back[i] += prior[i];
                }
                for j in 0..s.rhythm {
                    let (sin, cos) = sin_cos(before[s.memory + j]);
                    back[s.memory + j] += prior[s.memory + j] * cos - prior[s.memory + s.rhythm + j] * sin;
                }
                for m in 0..s.mood {
                    back[s.memory + s.rhythm + m] += prior[s.memory + 2 * s.rhythm + m];
                }
                // a run that started afresh here owes nothing to what came before
                if trace.fresh[row] {
                    back.fill(0.0);
                }
                g.copy_from_slice(&back);
            }
        }
    }

    /// The pool reshaped to `shape`, keeping what it can, with `weights` mapped from this pool's into
    /// `into` (which must be `shape.weights()` long). Neurons kept keep their reads and weights; new
    /// neurons read sources drawn from `random` with small weights of their own and are read by nobody,
    /// so nothing changes at first; fewer neurons drop those least used (`used`: how much each neuron's
    /// outputs count for the rest, given by the caller from the weights that read them). Reads of a
    /// neuron dropped, and reads added, start at a weight of 0 from a fresh source; fewer reads drop each
    /// neuron's weakest. Gives the pool and, for each output of the new pool, which output of the old it
    /// was (or none), so the caller can carry the weights that read it.
    pub fn reshape(&self, weights: &[f32], used: &[f32], shape: Shape, into: &mut [f32], random: &mut Random) -> (Pool, Vec<Option<usize>>) {
        let old = self.shape;
        let (ok, nk) = (old.reads, shape.reads);
        // which old neuron of each kind each new one is: the most used kept, in their old order
        let keep = |count: usize, new: usize, width: &dyn Fn(usize) -> f32| -> Vec<Option<usize>> {
            let mut order: Vec<usize> = (0..count).collect();
            order.sort_by(|&a, &b| width(b).partial_cmp(&width(a)).unwrap_or(core::cmp::Ordering::Equal).then(a.cmp(&b)));
            let mut kept: Vec<usize> = order.into_iter().take(new).collect();
            kept.sort();
            (0..new).map(|n| kept.get(n).copied()).collect()
        };
        let memory_used = |i: usize| used[i];
        let rhythm_used = |j: usize| used[old.memory + j] + used[old.memory + old.rhythm + j];
        let mood_used = |m: usize| used[old.memory + 2 * old.rhythm + m];
        let memories = keep(old.memory, shape.memory, &memory_used);
        let rhythms = keep(old.rhythm, shape.rhythm, &rhythm_used);
        let moods = keep(old.mood, shape.mood, &mood_used);
        // each new output's old output
        let mut outputs: Vec<Option<usize>> = Vec::with_capacity(shape.outputs());
        outputs.extend(memories.iter().copied());
        outputs.extend(rhythms.iter().map(|o| o.map(|j| old.memory + j)));
        outputs.extend(rhythms.iter().map(|o| o.map(|j| old.memory + old.rhythm + j)));
        outputs.extend(moods.iter().map(|o| o.map(|m| old.memory + 2 * old.rhythm + m)));
        // an old code in the new pool's numbering, if its neuron is kept
        let renumber = |code: u32| -> Option<u32> {
            let (part, i) = (code >> 16, (code & 0xffff) as usize);
            let found = match part {
                SENSED | PLAIN => return Some(code),
                MEMORY => memories.iter().position(|&o| o == Some(i)),
                SINE | COSINE => rhythms.iter().position(|&o| o == Some(i)),
                _ => moods.iter().position(|&o| o == Some(i)),
            };
            found.map(|n| (part << 16) | n as u32)
        };
        let mut pool = Pool { shape, senses: self.senses, plain: self.plain, reads: Vec::new(), from: Vec::new() };
        let all = pool.codes();
        let fresh_weights = {
            let mut w = vec![0.0; shape.weights()];
            pool.reads = vec![0; shape.neurons() * nk];
            pool.first(&mut w, random);
            w
        };
        into.copy_from_slice(&fresh_weights);
        let [o_memory, o_groups, o_rhythm, o_mood, _] = old.starts();
        let [n_memory, n_groups, n_rhythm, n_mood, _] = shape.starts();
        if shape.memory > 0 && old.memory > 0 {
            into[n_groups..n_groups + 2 * PLASTIC_GROUPS].copy_from_slice(&weights[o_groups..o_groups + 2 * PLASTIC_GROUPS]);
        }
        let mut reads = Vec::with_capacity(shape.neurons() * nk);
        // (kind, sets of reads per weight, the old start and stride, the new start and stride, which old)
        let kinds: [(usize, &[Option<usize>], usize, usize, usize, usize); 3] = [
            (3, &memories, o_memory, 3 * ok + 2, n_memory, 3 * nk + 2),
            (1, &rhythms, o_rhythm, ok + 2, n_rhythm, nk + 2),
            (1, &moods, o_mood, ok + 2, n_mood, nk + 2),
        ];
        let neuron_base = [0, old.memory, old.memory + old.rhythm];
        for (kind, &(sets, which, o_start, o_stride, n_start, n_stride)) in kinds.iter().enumerate() {
            for (n, from) in which.iter().enumerate() {
                let new_at = n_start + n * n_stride;
                let mut mine: Vec<u32> = Vec::with_capacity(nk);
                let mut columns: Vec<Option<usize>> = Vec::with_capacity(nk);
                if let Some(o) = *from {
                    let old_at = o_start + o * o_stride;
                    let old_reads = &self.reads[(neuron_base[kind] + o) * ok..(neuron_base[kind] + o + 1) * ok];
                    // the old reads still there, strongest first, as many as fit
                    let strength = |r: usize| (0..sets).map(|set| weights[old_at + set * ok + r].abs()).sum::<f32>();
                    let mut order: Vec<usize> = (0..ok).filter(|&r| renumber(old_reads[r]).is_some()).collect();
                    order.sort_by(|&a, &b| strength(b).partial_cmp(&strength(a)).unwrap_or(core::cmp::Ordering::Equal).then(a.cmp(&b)));
                    order.truncate(nk);
                    order.sort();
                    for &r in &order {
                        mine.push(renumber(old_reads[r]).unwrap());
                        columns.push(Some(r));
                    }
                    // its biases and own numbers after the reads
                    let tail = o_stride - sets * ok;
                    into[new_at + sets * nk..new_at + sets * nk + tail].copy_from_slice(&weights[old_at + sets * ok..old_at + sets * ok + tail]);
                }
                pool.draw(&all, &mut mine, random);
                columns.resize(mine.len(), None);
                for (r, column) in columns.iter().enumerate() {
                    for set in 0..sets {
                        into[new_at + set * nk + r] = match (*from, column) {
                            (Some(o), Some(c)) => weights[o_start + o * o_stride + set * ok + c],
                            // a read added to a neuron kept starts at nothing, so nothing changes
                            (Some(_), None) => 0.0,
                            // a new neuron's reads keep their small first weights, plasticity none
                            (None, _) => if set == 2 { 0.0 } else { into[new_at + set * nk + r] },
                        };
                    }
                }
                reads.extend_from_slice(&mine);
            }
        }
        pool.reads = reads;
        pool.resolve();
        (pool, outputs)
    }

    /// The pool's form, to keep with its weights: the shape, then every read's code.
    pub fn form(&self) -> Vec<f32> {
        let s = self.shape;
        let mut out = vec![s.memory as f32, s.rhythm as f32, s.mood as f32, s.reads as f32];
        out.extend(self.reads.iter().map(|&code| code as f32));
        out
    }

    /// A pool back from its form, if the form is whole and every read names a source there is.
    pub fn from_form(form: &[f32], senses: usize, plain: usize) -> Option<Pool> {
        let whole = |x: f32| x.is_finite() && x >= 0.0 && x < 16_777_216.0 && x == (x as u32) as f32;
        if form.len() < 4 || !form.iter().all(|&x| whole(x)) {
            return None;
        }
        let shape = Shape { memory: form[0] as usize, rhythm: form[1] as usize, mood: form[2] as usize, reads: form[3] as usize };
        if shape.neurons() > 4096 || shape.reads > 256 || form.len() != 4 + shape.neurons() * shape.reads {
            return None;
        }
        let mut pool = Pool { shape, senses, plain, reads: form[4..].iter().map(|&x| x as u32).collect(), from: Vec::new() };
        let all = pool.codes();
        if !pool.reads.iter().all(|code| all.contains(code)) {
            return None;
        }
        pool.resolve();
        Some(pool)
    }

    /// Where neuron `n`'s reads start in `reads` (memory, then rhythm, then mood), and the weight of its
    /// read `r` that the brain's picture draws: a memory's take-in weight as it stands with its fast
    /// weight now, a rhythm's or a mood's own.
    pub fn read_weight(&self, weights: &[f32], state: &[f32], n: usize, r: usize) -> f32 {
        let s = self.shape;
        let k = s.reads;
        let [memory, _, rhythm, mood, _] = s.starts();
        if n < s.memory {
            let at = memory + n * (3 * k + 2);
            let fast = state.get(s.memory + s.rhythm + s.mood + n * k + r).copied().unwrap_or(0.0);
            weights[at + k + r] + weights[at + 2 * k + r] * fast
        } else if n < s.memory + s.rhythm {
            weights[rhythm + (n - s.memory) * (k + 2) + r]
        } else {
            weights[mood + (n - s.memory - s.rhythm) * (k + 2) + r]
        }
    }

    /// How much a memory neuron's read `r` has changed in this run by its fast weight (its plasticity
    /// times its fast weight now).
    pub fn changed(&self, weights: &[f32], state: &[f32], n: usize, r: usize) -> f32 {
        let s = self.shape;
        if n >= s.memory {
            return 0.0;
        }
        let k = s.reads;
        let at = n * (3 * k + 2);
        weights[at + 2 * k + r] * state.get(s.memory + s.rhythm + s.mood + n * k + r).copied().unwrap_or(0.0)
    }
}

/// What a window of decisions kept for learning back through it.
#[derive(Clone, Debug, Default)]
pub struct Trace {
    pub rows: usize,
    pub steps: usize,
    sources: Vec<f32>,
    before: Vec<f32>,
    gates: Vec<f32>,
    takes: Vec<f32>,
    pulls: Vec<f32>,
    paces: Vec<f32>,
    towards: Vec<f32>,
    fresh: Vec<bool>,
}

impl Trace {
    fn clear(&mut self) {
        self.sources.clear();
        self.before.clear();
        self.gates.clear();
        self.takes.clear();
        self.pulls.clear();
        self.paces.clear();
        self.towards.clear();
    }
}
