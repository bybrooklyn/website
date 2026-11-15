//! Practice with a pool (`super::super::pool`): the learner's policy when its shape has neurons that
//! carry something from one decision to the next. What is sensed goes through the first plain layer;
//! the pool reads that, what is sensed and itself as it was, and moves on; the second plain layer
//! reads the first and the pool, each of its neurons turned up or down by a mood; the head reads the
//! second. The value reads what is sensed and the pool as it was before the decision, from what was
//! kept in the rollout, and is not learned back through time.
//!
//! A rollout keeps each creature's pool state at the start of every window of decisions
//! (`Settings::window`); learning goes over whole windows in random order, from the state kept,
//! starting each run afresh where one ended inside a window, and back through the window. The policy
//! of the plain shape never comes here, so it learns exactly as it did.

use alloc::vec;
use alloc::vec::Vec;

use super::super::net::{Layer, Net, Squash, Work};
use super::super::pool::{Pool, Shape, Trace};
use super::{CUT, GOING, HALF_LOG_TAU, Learner, Task};
use crate::learn::Random;
use crate::math::{clamp, exp, sqrt, tanh};

/// The seed of every pool's reads: the same in every worker, so their weights mean the same.
const READS_SEED: u64 = 0x706f_6f6c_7265_6164;

/// Room for the policy's work on a batch: each layer's work, and the lists between them.
#[derive(Clone, Debug)]
struct Room {
    one: Work,
    two: Work,
    /// What the pool gave, the second layer's input (the first layer's then the pool's), its gains,
    /// what it gave, and the value's input (what is sensed, then the pool as it was).
    outs: Vec<f32>,
    mix: Vec<f32>,
    gains: Vec<f32>,
    h2: Vec<f32>,
    value_in: Vec<f32>,
}

impl Room {
    fn new(one: &Net, two: &Net, rows: usize, shape: Shape, senses: usize) -> Room {
        let (h, p) = (one.outputs(), shape.outputs());
        Room { one: one.work(rows), two: two.work(rows), outs: vec![0.0; rows * p], mix: vec![0.0; rows * (h + p)], gains: vec![1.0; rows * h], h2: vec![0.0; rows * h], value_in: vec![0.0; rows * (senses + p)] }
    }
}

/// What the creature on show last thought, for its picture.
#[derive(Clone, Debug, Default)]
pub struct Shown {
    pub plain_one: Vec<f32>,
    pub plain_two: Vec<f32>,
    pub pool: Vec<f32>,
    pub gains: Vec<f32>,
    /// The pool's state before and after its last decision, so the picture can say what just changed.
    pub before: Vec<f32>,
}

pub struct Recurrent {
    pub pool: Pool,
    /// Where the pool's weights start in the learner's.
    pub at: usize,
    one: Net,
    two: Net,
    pub window: usize,
    /// Each creature's state, carried from decision to decision, and whether its run has just started.
    pub state: Vec<f32>,
    restarted: Vec<bool>,
    /// The rollout: each creature's state at the start of each window (window by window, creature by
    /// creature), whether each decision began a fresh run, and the pool as it was before each.
    starts: Vec<f32>,
    fresh: Vec<bool>,
    prior: Vec<f32>,
    order: Vec<u32>,
    acting: Room,
    training: Room,
    showing: Room,
    trace: Trace,
    blame_pool: Vec<f32>,
    blame_one: Vec<f32>,
    blame_mix: Vec<f32>,
    rows_x: Vec<f32>,
    rows_start: Vec<f32>,
    rows_fresh: Vec<bool>,
    picks: Vec<usize>,
    /// The creature on show's state, and what it last thought.
    pub show_state: Vec<f32>,
    pub shown: Shown,
}

/// The largest number of decisions no more than `window` that a rollout of `steps` divides into.
fn window_of(steps: usize, window: usize) -> usize {
    (1..=window.clamp(1, steps.max(1))).rev().find(|w| steps.is_multiple_of(*w)).unwrap_or(1)
}

impl Recurrent {
    /// The pool part of a learner of this shape, its reads drawn from the fixed seed unless `pool` is
    /// given; `at` is where its weights start.
    pub fn new(shape: Shape, pool: Option<Pool>, senses: usize, hidden: usize, count: usize, steps: usize, window: usize, minibatch: usize, at: usize, feelings: &[usize]) -> Recurrent {
        let pool = pool.unwrap_or_else(|| Pool::new(shape, senses, hidden, feelings, &mut Random::new(READS_SEED)));
        let p = shape.outputs();
        let one = Net { layers: vec![Layer { inputs: senses, outputs: hidden, squash: Squash::Tanh }] };
        let two = Net { layers: vec![Layer { inputs: hidden + p, outputs: hidden, squash: Squash::Plain }] };
        let window = window_of(steps, window);
        let windows = count * steps / window;
        let mut recurrent = Recurrent {
            at,
            window,
            state: vec![0.0; count * shape.state()],
            restarted: vec![true; count],
            starts: vec![0.0; windows * shape.state()],
            fresh: vec![false; count * steps],
            prior: vec![0.0; count * steps * p],
            order: (0..windows as u32).collect(),
            acting: Room::new(&one, &two, count, shape, senses),
            training: Room::new(&one, &two, minibatch, shape, senses),
            showing: Room::new(&one, &two, 1, shape, senses),
            trace: Trace::default(),
            blame_pool: vec![0.0; minibatch * p],
            blame_one: vec![0.0; minibatch * hidden],
            blame_mix: vec![0.0; minibatch * (hidden + p)],
            rows_x: vec![0.0; minibatch * senses],
            rows_start: Vec::new(),
            rows_fresh: vec![false; minibatch],
            picks: vec![0; minibatch],
            show_state: vec![0.0; shape.state()],
            shown: Shown::default(),
            one,
            two,
            pool,
        };
        for i in 0..count {
            recurrent.pool.fresh(&mut recurrent.state[i * shape.state()..(i + 1) * shape.state()]);
        }
        recurrent.pool.fresh(&mut recurrent.show_state);
        recurrent
    }

    /// How many windows a rollout holds, and how many go into each minibatch.
    fn windows(&self) -> usize {
        self.order.len()
    }
}

/// The policy's means for `rows` rescaled inputs, the pool moving on from `state`: into `head_work`'s
/// output. The value's input (what is sensed, then the pool as it was) is left in the room.
#[allow(clippy::too_many_arguments)]
fn think(recurrent_pool: &Pool, one: &Net, two: &Net, weights: &[f32], at: &[usize; 5], pool_at: usize, head: &Net, input: &[f32], rows: usize, state: &mut [f32], room: &mut Room, head_work: &mut Work) {
    let shape = recurrent_pool.shape;
    let (s, h, p) = (one.inputs(), one.outputs(), shape.outputs());
    let wide = shape.state();
    for r in 0..rows {
        room.value_in[r * (s + p)..r * (s + p) + s].copy_from_slice(&input[r * s..(r + 1) * s]);
        recurrent_pool.give(&state[r * wide..(r + 1) * wide], &mut room.value_in[r * (s + p) + s..(r + 1) * (s + p)]);
    }
    let first = one.weights();
    one.forward(&weights[..first], input, rows, &mut room.one);
    let h1 = &room.one.outs[0][..rows * h];
    recurrent_pool.step(&weights[pool_at..pool_at + shape.weights()], input, h1, state, &mut room.outs, rows, None);
    mix_and_gain(recurrent_pool, two, &weights[first..at[1]], rows, room);
    head.forward(&weights[at[1]..at[2]], &room.h2[..rows * h], rows, head_work);
}

/// The second plain layer: it reads the first and the pool, and each neuron is squashed with its mood's
/// gain, into `room.h2`.
fn mix_and_gain(pool: &Pool, two: &Net, weights: &[f32], rows: usize, room: &mut Room) {
    let shape = pool.shape;
    let (h, p) = (two.outputs(), shape.outputs());
    let h1 = &room.one.outs[0];
    for r in 0..rows {
        room.mix[r * (h + p)..r * (h + p) + h].copy_from_slice(&h1[r * h..(r + 1) * h]);
        room.mix[r * (h + p) + h..(r + 1) * (h + p)].copy_from_slice(&room.outs[r * p..(r + 1) * p]);
    }
    two.forward(weights, &room.mix[..rows * (h + p)], rows, &mut room.two);
    let moods = shape.memory + 2 * shape.rhythm;
    for r in 0..rows {
        for j in 0..h {
            let gain = if shape.mood > 0 { 1.0 + room.outs[r * p + moods + j % shape.mood] } else { 1.0 };
            room.gains[r * h + j] = gain;
            room.h2[r * h + j] = tanh(gain * room.two.outs[0][r * h + j]);
        }
    }
}

impl Learner {
    /// Collects a rollout with the pool: as `collect`, each creature's pool carried from decision to
    /// decision and started afresh with each run.
    pub(super) fn collect_recurrent(&mut self, task: &mut impl Task) {
        let mut recurrent = self.recurrent.take().expect("a pool");
        let (n, s, a, steps) = (self.count, self.senses, self.actions, self.settings.steps);
        let (gamma, lambda) = (self.settings.gamma, self.settings.lambda);
        let shape = recurrent.pool.shape;
        let (p, wide, window) = (shape.outputs(), shape.state(), recurrent.window);
        self.rollout_sensed.clear();
        self.rollout_returned.clear();
        let mut works = core::mem::replace(&mut self.acting, [Work::empty(), Work::empty(), Work::empty(), Work::empty()]);
        let spreads: Vec<f32> = self.weights[self.at[4]..self.at[4] + a].iter().map(|&log| exp(log)).collect();
        for t in 0..steps {
            for row in self.now.chunks_exact(s) {
                self.rollout_sensed.add(row);
            }
            self.foresee_keep();
            let mut input = core::mem::take(&mut self.now);
            self.rescale(&mut input);
            self.seen[t * n * s..(t + 1) * n * s].copy_from_slice(&input);
            for i in 0..n {
                recurrent.fresh[t * n + i] = recurrent.restarted[i];
                recurrent.restarted[i] = false;
            }
            if t % window == 0 {
                let w = t / window;
                recurrent.starts[w * n * wide..(w + 1) * n * wide].copy_from_slice(&recurrent.state);
            }
            let Recurrent { pool, one, two, at: pool_at, state, acting, .. } = &mut *recurrent;
            think(pool, one, two, &self.weights, &self.at, *pool_at, &self.head, &input, n, state, acting, &mut works[1]);
            recurrent.prior[t * n * p..(t + 1) * n * p].copy_from_slice(&value_prior(&recurrent.acting.value_in, n, s, p));
            for i in 0..n {
                let mut chance = 0.0;
                for (k, &spread) in spreads.iter().enumerate() {
                    let noise = self.bell();
                    let middle = works[1].output()[i * a + k];
                    self.actions_now[i * a + k] = middle + spread * noise;
                    chance += -0.5 * noise * noise - self.weights[self.at[4] + k] - HALF_LOG_TAU;
                }
                self.chances[t * n + i] = chance;
            }
            let value_in = core::mem::take(&mut recurrent.acting.value_in);
            self.value_forward(&value_in, n, &mut works);
            recurrent.acting.value_in = value_in;
            for i in 0..n {
                self.values[t * n + i] = works[3].output()[i];
            }
            self.now = input;
            self.taken[t * n * a..(t + 1) * n * a].copy_from_slice(&self.actions_now);
            self.foresee_before(t);
            task.step(&self.actions_now, &mut self.now, &mut self.step_rewards, &mut self.step_ends, &mut self.last);
            self.foresee_after(t);
            self.decisions += n as u64;
            if self.step_ends.contains(&CUT) {
                // valued where it was cut, with the pool as it is after this decision
                let mut last = core::mem::take(&mut self.last);
                self.rescale(&mut last);
                let value_in = joined(&last, &recurrent, n, s, p);
                self.value_forward(&value_in, n, &mut works);
                for i in 0..n {
                    self.cut_values[t * n + i] = works[3].output()[i];
                }
                self.last = last;
            }
            for i in 0..n {
                let reward = self.step_rewards[i];
                self.adding[i] = self.adding[i] * gamma + reward;
                self.rollout_returned.add(&[self.adding[i]]);
                if self.step_ends[i] != GOING {
                    self.adding[i] = 0.0;
                    recurrent.pool.fresh(&mut recurrent.state[i * wide..(i + 1) * wide]);
                    recurrent.restarted[i] = true;
                }
                self.rewards[t * n + i] = reward * self.reward_scale;
                self.ends[t * n + i] = self.step_ends[i];
            }
        }
        let mut input = self.now.clone();
        self.rescale(&mut input);
        let value_in = joined(&input, &recurrent, n, s, p);
        self.value_forward(&value_in, n, &mut works);
        for i in 0..n {
            self.values[steps * n + i] = works[3].output()[i];
        }
        self.acting = works;
        self.recurrent = Some(recurrent);
        self.advantages_from_rollout(n, steps, gamma, lambda);
    }

    /// Shuffles the rollout's windows for a new epoch.
    pub(super) fn shuffle_recurrent(&mut self) {
        let mut recurrent = self.recurrent.take().expect("a pool");
        for i in (1..recurrent.order.len()).rev() {
            let j = self.random.below(i + 1);
            recurrent.order.swap(i, j);
        }
        self.recurrent = Some(recurrent);
    }

    /// How many minibatches an epoch has with the pool, and how many windows each.
    pub(super) fn minibatches_recurrent(&self) -> (usize, usize) {
        let windows = self.recurrent.as_ref().map_or(1, |r| r.windows());
        let count = self.settings.minibatches.clamp(1, windows);
        (count, windows / count)
    }

    /// The gradient of the loss over minibatch `which` of the shuffled windows, into `grads`: as
    /// `gradient`, and back through each window.
    pub(super) fn gradient_recurrent(&mut self, which: usize) {
        let (_, each) = self.minibatches_recurrent();
        let mut recurrent = self.recurrent.take().expect("a pool");
        let (s, a, h) = (self.senses, self.actions, self.settings.hidden);
        let (n, set) = (self.count, self.settings);
        let shape = recurrent.pool.shape;
        let (p, wide, window) = (shape.outputs(), shape.state(), recurrent.window);
        let rows = each * window;
        // the rows, decision by decision within the window, window by window within each decision
        recurrent.rows_start.clear();
        for b in 0..each {
            let w = recurrent.order[which * each + b] as usize;
            let (span, i) = (w / n, w % n);
            recurrent.rows_start.extend_from_slice(&recurrent.starts[w * wide..(w + 1) * wide]);
            for t in 0..window {
                let k = (span * window + t) * n + i;
                let r = t * each + b;
                recurrent.picks[r] = k;
                recurrent.rows_x[r * s..(r + 1) * s].copy_from_slice(&self.seen[k * s..(k + 1) * s]);
                recurrent.rows_fresh[r] = recurrent.fresh[k];
                let room = &mut recurrent.training;
                room.value_in[r * (s + p)..r * (s + p) + s].copy_from_slice(&self.seen[k * s..(k + 1) * s]);
                room.value_in[r * (s + p) + s..(r + 1) * (s + p)].copy_from_slice(&recurrent.prior[k * p..(k + 1) * p]);
            }
        }
        let picks: Vec<usize> = recurrent.picks[..rows].to_vec();
        let mean = picks.iter().map(|&k| self.advantages[k]).sum::<f32>() / rows as f32;
        let spread = sqrt(picks.iter().map(|&k| (self.advantages[k] - mean) * (self.advantages[k] - mean)).sum::<f32>() / rows as f32) + 1e-8;
        self.grads.fill(0.0);
        let mut works = core::mem::replace(&mut self.training, [Work::empty(), Work::empty(), Work::empty(), Work::empty()]);
        let w = core::mem::take(&mut self.weights);
        let mut grads = core::mem::take(&mut self.grads);
        let first = recurrent.one.weights();
        let pool_at = recurrent.at;
        let pool_weights = &w[pool_at..pool_at + shape.weights()];
        let log_spreads = &w[self.at[4]..self.at[4] + a];
        let spreads: Vec<f32> = log_spreads.iter().map(|&log| exp(log)).collect();

        // the policy, forward through the window
        let Recurrent { pool, one, two, training: room, trace, rows_x, rows_start, rows_fresh, .. } = &mut *recurrent;
        one.forward(&w[..first], &rows_x[..rows * s], rows, &mut room.one);
        pool.forward(pool_weights, &rows_x[..rows * s], &room.one.outs[0][..rows * h], rows_start, &rows_fresh[..rows], window, each, &mut room.outs, trace);
        mix_and_gain(pool, two, &w[first..self.at[1]], rows, room);
        self.head.forward(&w[self.at[1]..self.at[2]], &room.h2[..rows * h], rows, &mut works[1]);
        let (mut policy_loss, mut moved, mut clipped) = (0.0, 0.0, 0.0);
        let middles = works[1].output()[..rows * a].to_vec();
        let blame = self.head.blame(&mut works[1], rows);
        let spread_g_at = self.at[4];
        for (r, &k) in picks.iter().enumerate() {
            let advantage = (self.advantages[k] - mean) / spread;
            let mut chance = 0.0;
            for j in 0..a {
                let z = (self.taken[k * a + j] - middles[r * a + j]) / spreads[j];
                chance += -0.5 * z * z - log_spreads[j] - HALF_LOG_TAU;
            }
            let ratio = exp(chance - self.chances[k]);
            let kept = clamp(ratio, 1.0 - set.clip, 1.0 + set.clip);
            let (whole, cut) = (ratio * advantage, kept * advantage);
            policy_loss -= whole.min(cut) / rows as f32;
            moved += ((ratio - 1.0) - (chance - self.chances[k])) / rows as f32;
            let slope = if whole <= cut { -whole / rows as f32 } else { 0.0 };
            if whole > cut {
                clipped += 1.0 / rows as f32;
            }
            for j in 0..a {
                let z = (self.taken[k * a + j] - middles[r * a + j]) / spreads[j];
                blame[r * a + j] = slope * z / spreads[j];
                grads[spread_g_at + j] += slope * (z * z - 1.0);
            }
        }
        for g in grads[spread_g_at..spread_g_at + a].iter_mut() {
            *g -= set.entropy_weight;
        }
        // back: the head, the moods' gains, the second layer, the pool through the window, the first layer
        let blame_two = &mut recurrent.blame_one[..rows * h];
        {
            let (head_g, _) = grads[self.at[1]..].split_at_mut(self.at[2] - self.at[1]);
            self.head.backward(&w[self.at[1]..self.at[2]], &recurrent.training.h2[..rows * h], rows, &mut works[1], head_g, Some(blame_two));
        }
        let room = &mut recurrent.training;
        let blame_pool = &mut recurrent.blame_pool[..rows * p];
        blame_pool.fill(0.0);
        let moods = shape.memory + 2 * shape.rhythm;
        {
            let sums = room.two.outs[0][..rows * h].to_vec();
            let into = recurrent.two.blame(&mut room.two, rows);
            for r in 0..rows {
                for j in 0..h {
                    let (y, gain, before) = (room.h2[r * h + j], room.gains[r * h + j], sums[r * h + j]);
                    let slope = blame_two[r * h + j] * (1.0 - y * y);
                    into[r * h + j] = slope * gain;
                    if shape.mood > 0 {
                        blame_pool[r * p + moods + j % shape.mood] += slope * before;
                    }
                }
            }
        }
        let blame_mix = &mut recurrent.blame_mix[..rows * (h + p)];
        {
            let (_, rest) = grads.split_at_mut(first);
            recurrent.two.backward(&w[first..self.at[1]], &room.mix[..rows * (h + p)], rows, &mut room.two, &mut rest[..self.at[1] - first], Some(blame_mix));
        }
        let blame_one = recurrent.one.blame(&mut room.one, rows);
        for r in 0..rows {
            blame_one[r * h..(r + 1) * h].copy_from_slice(&blame_mix[r * (h + p)..r * (h + p) + h]);
            for o in 0..p {
                blame_pool[r * p + o] += blame_mix[r * (h + p) + h + o];
            }
        }
        {
            let mut h1_blame = recurrent.one.blame(&mut room.one, rows).to_vec();
            recurrent.pool.backward(pool_weights, &recurrent.trace, blame_pool, &mut grads[pool_at..pool_at + shape.weights()], &mut h1_blame);
            recurrent.one.blame(&mut room.one, rows).copy_from_slice(&h1_blame);
        }
        recurrent.one.backward(&w[..first], &recurrent.rows_x[..rows * s], rows, &mut room.one, &mut grads[..first], None);

        // the value, from what was sensed and the pool as it was, not back through time
        let mut value_loss = 0.0;
        let value_in = core::mem::take(&mut room.value_in);
        let value_trunk = self.value_trunk.as_ref().expect("a pool's value has its own layers");
        value_trunk.forward(&w[self.at[2]..self.at[3]], &value_in[..rows * (s + p)], rows, &mut works[2]);
        let hidden_value = works[2].output()[..rows * h].to_vec();
        self.value_head.forward(&w[self.at[3]..self.at[4]], &hidden_value, rows, &mut works[3]);
        let guesses = works[3].output()[..rows].to_vec();
        let blame = self.value_head.blame(&mut works[3], rows);
        for (r, &k) in picks.iter().enumerate() {
            let miss = guesses[r] - self.returns[k];
            value_loss += 0.5 * miss * miss / rows as f32;
            blame[r] = set.value_weight * miss / rows as f32;
        }
        let blame_value = &mut self.blame_value[..rows * h];
        {
            let (value_trunk_g, value_head_g) = grads[self.at[2]..self.at[4]].split_at_mut(self.at[3] - self.at[2]);
            self.value_head.backward(&w[self.at[3]..self.at[4]], &hidden_value, rows, &mut works[3], value_head_g, Some(blame_value));
            value_trunk.blame(&mut works[2], rows).copy_from_slice(blame_value);
            value_trunk.backward(&w[self.at[2]..self.at[3]], &value_in[..rows * (s + p)], rows, &mut works[2], value_trunk_g, None);
        }
        recurrent.training.value_in = value_in;
        self.report = super::Report { policy_loss, value_loss, moved, clipped, spread: spreads.iter().sum::<f32>() / a as f32 };
        self.training = works;
        self.weights = w;
        self.grads = grads;
        self.recurrent = Some(recurrent);
        self.foresee_gradient(which, self.minibatches_recurrent().0);
    }

    /// The policy's action for what the creature on show senses, its pool carried from its last
    /// decision (`forget_show` starts it afresh with each run).
    pub(super) fn act_recurrent(&mut self, senses: &[f32], into: &mut [f32]) {
        let mut recurrent = self.recurrent.take().expect("a pool");
        let mut input = core::mem::take(&mut self.shown_input);
        input.copy_from_slice(&senses[..self.senses]);
        self.rescale(&mut input);
        recurrent.shown.before.clone_from(&recurrent.show_state);
        let Recurrent { pool, one, two, at: pool_at, show_state, showing, .. } = &mut *recurrent;
        think(pool, one, two, &self.weights, &self.at, *pool_at, &self.head, &input, 1, show_state, showing, &mut self.showing[1]);
        let room = &recurrent.showing;
        recurrent.shown.plain_one.clone_from(&room.one.outs[0]);
        recurrent.shown.plain_two.clone_from(&room.h2);
        recurrent.shown.pool.clone_from(&room.outs);
        recurrent.shown.gains.clone_from(&room.gains);
        self.shown_input = input;
        for (out, &middle) in into.iter_mut().zip(self.showing[1].output()) {
            *out = clamp(middle, -1.0, 1.0);
        }
        self.recurrent = Some(recurrent);
    }
}

/// The pool as it was before a decision, out of the value's input rows.
fn value_prior(value_in: &[f32], rows: usize, s: usize, p: usize) -> Vec<f32> {
    let mut out = Vec::with_capacity(rows * p);
    for r in 0..rows {
        out.extend_from_slice(&value_in[r * (s + p) + s..(r + 1) * (s + p)]);
    }
    out
}

/// The value's input for these rescaled rows, with each creature's pool as it is now.
fn joined(input: &[f32], recurrent: &Recurrent, rows: usize, s: usize, p: usize) -> Vec<f32> {
    let wide = recurrent.pool.shape.state();
    let mut out = vec![0.0; rows * (s + p)];
    for r in 0..rows {
        out[r * (s + p)..r * (s + p) + s].copy_from_slice(&input[r * s..(r + 1) * s]);
        recurrent.pool.give(&recurrent.state[r * wide..(r + 1) * wide], &mut out[r * (s + p) + s..(r + 1) * (s + p)]);
    }
    out
}
