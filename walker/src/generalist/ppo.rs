//! Learning by practice: proximal policy optimisation (PPO, Schulman and others, 2017), written for
//! the generalist over the hand-written network in `net`.
//!
//! A policy looks at what a creature senses and gives, for each action, the middle of a bell curve;
//! the action taken is drawn from that curve, its spread one learned number per action, the same
//! whatever is sensed. A value network guesses how much reward is still to come from where it is.
//! Many creatures act together for a while (a rollout); then how much better each action did than
//! the value expected (its advantage, by generalised advantage estimation) says which way to move the
//! policy, and the policy is moved a few times over minibatches of what happened, each time no further
//! than a clipped ratio of old and new chances allows, so one lucky rollout cannot throw it far. What
//! is sensed is rescaled by a running mean and spread, and rewards by the running spread of what they
//! add up to, both kept with the weights, so the network sees numbers of about one whatever their
//! units.
//!
//! Every number that shapes learning is in `Settings`, with why it is what it is. The same seed gives
//! the same learning, to the bit. Learning can be shared between workers: each collects its own
//! rollout and goes over it (`collect`, `epochs`), then every one takes the average of all their
//! weights and every worker's running numbers (`take_in`), so all go on from the same place.

use alloc::vec;
use alloc::vec::Vec;

use super::net::{Adam, Net, Squash, Work, length};
use crate::learn::Random;
use crate::math::{clamp, exp, ln, sin_cos, sqrt};

/// A run going on, a run over (nothing comes after), and a run cut short by its time (what would have
/// come after is guessed by the value of where it was cut).
pub const GOING: u8 = 0;
pub const OVER: u8 = 1;
pub const CUT: u8 = 2;

/// Many of something acting at once, one decision at a time.
pub trait Task {
    fn count(&self) -> usize;
    fn senses(&self) -> usize;
    fn actions(&self) -> usize;
    /// What each senses now, `senses()` numbers each, one after another.
    fn observe(&mut self, into: &mut [f32]);
    /// One decision of every one, by `actions` (`actions()` each). Writes what each senses after it,
    /// its reward, and how its run stands (`GOING`, `OVER` or `CUT`). One whose run ended has started
    /// again, so what it senses is its new run's first; for one cut short, what it sensed where it was
    /// cut goes into `last`, laid out as `into` is.
    fn step(&mut self, actions: &[f32], into: &mut [f32], rewards: &mut [f32], ends: &mut [u8], last: &mut [f32]);
}

/// Every number that shapes learning. `Settings::default()` is what was settled on for the
/// generalist; walker/README.md ("Learning by practice") gives the measurements behind each.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Settings {
    /// Neurons in each hidden layer, and how many hidden layers: two of 64, the usual size for
    /// bodies like these.
    pub hidden: usize,
    pub layers: usize,
    /// tanh, which learned twice as far as ReLU here, though ReLU's sums are quicker.
    pub squash: Squash,
    /// Whether the value shares the policy's hidden layers. Apart learned twice as far, and a shared
    /// trunk saves little time.
    pub shared: bool,
    /// Decisions each creature makes in a rollout.
    pub steps: usize,
    /// How many times a rollout is gone over, and in how many minibatches each time.
    pub epochs: usize,
    pub minibatches: usize,
    /// Adam's step, which falls in a straight line to `rate * rate_floor` over `schedule` updates
    /// and stays there.
    pub rate: f32,
    pub rate_floor: f32,
    pub schedule: u32,
    /// How much a reward a decision later is worth (per decision), and how far advantages look ahead.
    pub gamma: f32,
    pub lambda: f32,
    /// How far the new policy's chance of an action may move from the old's in one update.
    pub clip: f32,
    /// How much the value's error and the policy's spread (entropy) count beside the policy's gain.
    pub value_weight: f32,
    pub entropy_weight: f32,
    /// The longest a gradient may be; a longer one is shortened to this.
    pub most_norm: f32,
    /// The natural log of each action's spread at the start: about 0.37, where 0.61 learned less far
    /// and flung the body about more while it learned.
    pub spread_start: f32,
    /// Whether rewards are divided by the running spread of what they add up to.
    pub scale_rewards: bool,
}

impl Default for Settings {
    fn default() -> Settings {
        Settings {
            hidden: 64,
            layers: 2,
            squash: Squash::Tanh,
            shared: false,
            steps: 64,
            epochs: 4,
            minibatches: 4,
            rate: 3e-4,
            rate_floor: 0.3,
            schedule: 2000,
            gamma: 0.99,
            lambda: 0.95,
            clip: 0.2,
            value_weight: 0.5,
            entropy_weight: 0.0,
            most_norm: 0.5,
            spread_start: -1.0,
            scale_rewards: true,
        }
    }
}

/// A running count, mean and sum of squared differences from the mean, of several numbers at once,
/// in double precision, merged from batches by Chan's rule so the order of batches is all that
/// matters.
#[derive(Clone, Debug, PartialEq)]
pub struct Running {
    pub count: f64,
    pub mean: Vec<f64>,
    pub squares: Vec<f64>,
}

impl Running {
    pub fn new(width: usize) -> Running {
        Running { count: 0.0, mean: vec![0.0; width], squares: vec![0.0; width] }
    }

    pub fn clear(&mut self) {
        self.count = 0.0;
        self.mean.fill(0.0);
        self.squares.fill(0.0);
    }

    /// Takes in one more of each number. A row with a number that is not finite (a blow-up in the
    /// physics) is let go, so it cannot spoil the means for ever.
    pub fn add(&mut self, values: &[f32]) {
        if values.iter().any(|x| !x.is_finite()) {
            return;
        }
        self.count += 1.0;
        for ((mean, squares), &x) in self.mean.iter_mut().zip(&mut self.squares).zip(values) {
            let x = x as f64;
            let before = x - *mean;
            *mean += before / self.count;
            *squares += before * (x - *mean);
        }
    }

    /// Takes in another's numbers, as if they had been added here.
    pub fn merge(&mut self, other: &Running) {
        if other.count == 0.0 {
            return;
        }
        let total = self.count + other.count;
        for k in 0..self.mean.len() {
            let gap = other.mean[k] - self.mean[k];
            self.mean[k] += gap * other.count / total;
            self.squares[k] += other.squares[k] + gap * gap * self.count * other.count / total;
        }
        self.count = total;
    }

    /// The spread of number k (its standard deviation), never quite zero.
    pub fn spread(&self, k: usize) -> f64 {
        let variance = if self.count > 1.0 { self.squares[k] / self.count } else { 1.0 };
        crate::math::sqrt64(variance + 1e-8)
    }

    /// All of it as one list, for sending: the count, the means, then the squares.
    pub fn numbers(&self) -> Vec<f64> {
        let mut out = vec![self.count];
        out.extend_from_slice(&self.mean);
        out.extend_from_slice(&self.squares);
        out
    }

    pub fn from_numbers(numbers: &[f64], width: usize) -> Option<Running> {
        (numbers.len() == 1 + 2 * width && numbers.iter().all(|x| x.is_finite())).then(|| Running { count: numbers[0], mean: numbers[1..1 + width].to_vec(), squares: numbers[1 + width..].to_vec() })
    }
}

/// How the last update went, for a reader.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Report {
    pub policy_loss: f32,
    pub value_loss: f32,
    /// The average of how far the new policy has moved from the old (an estimate of the KL
    /// divergence), and the share of samples whose ratio was clipped.
    pub moved: f32,
    pub clipped: f32,
    /// The average spread of the actions.
    pub spread: f32,
}

/// Half the log of two pi, which every bell curve's log chance carries.
const HALF_LOG_TAU: f32 = 0.918_938_5;
/// How many numbers `Learner::state` gives after the weights and Adam's two lists: the updates, Adam's
/// steps, and the steps practised in two halves of `HALVES`.
pub const KEPT_AFTER: usize = 4;
const HALVES: u64 = 1 << 24;
/// Sensed numbers, once rescaled, are kept within this of zero.
const SENSE_LIMIT: f32 = 10.0;

pub struct Learner {
    pub settings: Settings,
    pub senses: usize,
    pub actions: usize,
    /// Creatures acting together.
    pub count: usize,
    /// The policy's hidden layers and the layer giving each action's middle; the value's own hidden
    /// layers (unless shared) and the layer giving the value.
    pub trunk: Net,
    pub head: Net,
    pub value_trunk: Option<Net>,
    pub value_head: Net,
    /// Where each part starts in `weights`, the last being each action's log spread.
    pub at: [usize; 5],
    pub weights: Vec<f32>,
    pub grads: Vec<f32>,
    pub adam: Adam,
    /// What has been sensed and what rewards have added up to, over all of learning, and over the
    /// last rollout alone (to be merged in by `take_in`).
    pub sensed: Running,
    pub returned: Running,
    pub rollout_sensed: Running,
    pub rollout_returned: Running,
    shift: Vec<f32>,
    scale: Vec<f32>,
    reward_scale: f32,
    random: Random,
    // the rollout: what was sensed (rescaled), done, its log chance, its value, the reward, how runs stood
    now: Vec<f32>,
    seen: Vec<f32>,
    taken: Vec<f32>,
    chances: Vec<f32>,
    values: Vec<f32>,
    cut_values: Vec<f32>,
    rewards: Vec<f32>,
    ends: Vec<u8>,
    advantages: Vec<f32>,
    returns: Vec<f32>,
    last: Vec<f32>,
    adding: Vec<f32>,
    step_rewards: Vec<f32>,
    step_ends: Vec<u8>,
    actions_now: Vec<f32>,
    order: Vec<u32>,
    // room for the networks' work: a rollout step, a minibatch, one creature on show
    acting: [Work; 4],
    training: [Work; 4],
    showing: [Work; 2],
    /// What the creature on show sensed at its last decision, rescaled, as the policy took it.
    shown_input: Vec<f32>,
    batch_in: Vec<f32>,
    blame_hidden: Vec<f32>,
    blame_value: Vec<f32>,
    pub updates: u32,
    /// Steps of the physics its task had taken by its last update, kept with it so that what is
    /// brought in by steps (`Practice::ramp`) goes on from where it was when it is taken back.
    pub practised: u64,
    /// Decisions made by all the creatures together.
    pub decisions: u64,
    pub report: Report,
}

impl Learner {
    /// A learner for `count` creatures sensing `senses` numbers and taking `actions`, its first weights
    /// drawn from `seed`.
    pub fn new(settings: Settings, senses: usize, actions: usize, count: usize, seed: u64) -> Learner {
        let s = settings;
        let mut sizes = vec![senses];
        sizes.extend(core::iter::repeat_n(s.hidden, s.layers));
        let trunk = Net::new(&sizes, s.squash, s.squash);
        let head = Net::new(&[s.hidden, actions], s.squash, Squash::Plain);
        let value_trunk = (!s.shared).then(|| trunk.clone());
        let value_head = Net::new(&[s.hidden, 1], s.squash, Squash::Plain);
        let mut at = [0; 5];
        at[1] = trunk.weights();
        at[2] = at[1] + head.weights();
        at[3] = at[2] + value_trunk.as_ref().map_or(0, Net::weights);
        at[4] = at[3] + value_head.weights();
        let total = at[4] + actions;
        let mut random = Random::new(seed);
        let mut weights = vec![0.0; total];
        // hidden layers at a gain of the square root of two, the policy's last layer small so it starts
        // near the middle of every action, the value's at one
        let gain = if s.squash == Squash::Relu { 1.414 } else { 1.0 };
        trunk.first(&mut weights[..at[1]], &mut random, gain, gain);
        head.first(&mut weights[at[1]..at[2]], &mut random, 0.01, 0.01);
        if let Some(net) = &value_trunk {
            net.first(&mut weights[at[2]..at[3]], &mut random, gain, gain);
        }
        value_head.first(&mut weights[at[3]..at[4]], &mut random, 1.0, 1.0);
        weights[at[4]..].fill(s.spread_start);
        let samples = s.steps * count;
        let minibatch = (samples / s.minibatches.max(1)).max(1);
        let works = |batch: usize| [trunk.work(batch), head.work(batch), if s.shared { Work::empty() } else { trunk.work(batch) }, value_head.work(batch)];
        Learner {
            settings,
            senses,
            actions,
            count,
            acting: works(count),
            training: works(minibatch),
            showing: [trunk.work(1), head.work(1)],
            shown_input: vec![0.0; senses],
            trunk,
            head,
            value_trunk,
            value_head,
            at,
            grads: vec![0.0; total],
            adam: Adam::new(total),
            weights,
            sensed: Running::new(senses),
            returned: Running::new(1),
            rollout_sensed: Running::new(senses),
            rollout_returned: Running::new(1),
            shift: vec![0.0; senses],
            scale: vec![1.0; senses],
            reward_scale: 1.0,
            random,
            now: vec![0.0; count * senses],
            seen: vec![0.0; samples * senses],
            taken: vec![0.0; samples * actions],
            chances: vec![0.0; samples],
            values: vec![0.0; samples + count],
            cut_values: vec![0.0; samples],
            rewards: vec![0.0; samples],
            ends: vec![0; samples],
            advantages: vec![0.0; samples],
            returns: vec![0.0; samples],
            last: vec![0.0; count * senses],
            adding: vec![0.0; count],
            step_rewards: vec![0.0; count],
            step_ends: vec![0; count],
            actions_now: vec![0.0; count * actions],
            order: (0..samples as u32).collect(),
            batch_in: vec![0.0; minibatch.max(count) * senses],
            blame_hidden: vec![0.0; minibatch.max(count) * s.hidden],
            blame_value: vec![0.0; minibatch.max(count) * s.hidden],
            updates: 0,
            practised: 0,
            decisions: 0,
            report: Report::default(),
        }
    }

    /// Samples in a rollout, and in a minibatch.
    pub fn samples(&self) -> usize {
        self.settings.steps * self.count
    }

    pub fn minibatch(&self) -> usize {
        (self.samples() / self.settings.minibatches.max(1)).max(1)
    }

    /// Starts acting: what the creatures sense first.
    pub fn begin(&mut self, task: &mut impl Task) {
        task.observe(&mut self.now);
    }

    /// Rescales what was sensed by the running mean and spread, in place.
    fn rescale(&self, values: &mut [f32]) {
        for row in values.chunks_exact_mut(self.senses) {
            for ((x, &shift), &scale) in row.iter_mut().zip(&self.shift).zip(&self.scale) {
                // a NaN is taken as the mean, an infinity as the limit
                let rescaled = (*x - shift) * scale;
                *x = if rescaled.is_nan() { 0.0 } else { clamp(rescaled, -SENSE_LIMIT, SENSE_LIMIT) };
            }
        }
    }

    /// The value of `batch` rescaled inputs, into `work`'s last list.
    fn value_forward(&self, input: &[f32], batch: usize, works: &mut [Work; 4]) {
        let w = &self.weights;
        match &self.value_trunk {
            Some(net) => {
                // the value's own hidden layers use the head's room for their work
                net.forward(&w[self.at[2]..self.at[3]], input, batch, &mut works[2]);
                let (from, to) = two(works, 2, 3);
                self.value_head.forward(&w[self.at[3]..self.at[4]], &from.output()[..batch * self.settings.hidden], batch, to);
            }
            None => {
                let (from, to) = two(works, 0, 3);
                self.value_head.forward(&w[self.at[3]..self.at[4]], &from.output()[..batch * self.settings.hidden], batch, to);
            }
        }
    }

    /// Collects a rollout: every creature acts `steps` times, drawing each action from the policy.
    /// Then works out each decision's advantage and the return the value should have guessed.
    pub fn collect(&mut self, task: &mut impl Task) {
        let (n, s, a, steps) = (self.count, self.senses, self.actions, self.settings.steps);
        let (gamma, lambda) = (self.settings.gamma, self.settings.lambda);
        self.rollout_sensed.clear();
        self.rollout_returned.clear();
        let mut works = core::mem::replace(&mut self.acting, [Work::empty(), Work::empty(), Work::empty(), Work::empty()]);
        let spreads: Vec<f32> = self.weights[self.at[4]..].iter().map(|&log| exp(log)).collect();
        for t in 0..steps {
            for row in self.now.chunks_exact(s) {
                self.rollout_sensed.add(row);
            }
            let mut input = core::mem::take(&mut self.now);
            self.rescale(&mut input);
            self.seen[t * n * s..(t + 1) * n * s].copy_from_slice(&input);
            self.trunk.forward(&self.weights[..self.at[1]], &input, n, &mut works[0]);
            let (from, to) = two(&mut works, 0, 1);
            self.head.forward(&self.weights[self.at[1]..self.at[2]], from.output(), n, to);
            for i in 0..n {
                let mut chance = 0.0;
                for (k, &spread) in spreads.iter().enumerate().take(a) {
                    let noise = self.bell();
                    let middle = works[1].output()[i * a + k];
                    self.actions_now[i * a + k] = middle + spread * noise;
                    chance += -0.5 * noise * noise - self.weights[self.at[4] + k] - HALF_LOG_TAU;
                }
                self.chances[t * n + i] = chance;
            }
            self.value_forward(&input, n, &mut works);
            for i in 0..n {
                self.values[t * n + i] = works[3].output()[i];
            }
            self.now = input;
            self.taken[t * n * a..(t + 1) * n * a].copy_from_slice(&self.actions_now);
            task.step(&self.actions_now, &mut self.now, &mut self.step_rewards, &mut self.step_ends, &mut self.last);
            self.decisions += n as u64;
            if self.step_ends.contains(&CUT) {
                let mut last = core::mem::take(&mut self.last);
                self.rescale(&mut last);
                self.trunk.forward(&self.weights[..self.at[1]], &last, n, &mut works[0]);
                self.value_forward(&last, n, &mut works);
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
                }
                self.rewards[t * n + i] = reward * self.reward_scale;
                self.ends[t * n + i] = self.step_ends[i];
            }
        }
        // the value of where each creature is now, to guess what comes after the rollout
        let mut input = self.now.clone();
        self.rescale(&mut input);
        self.trunk.forward(&self.weights[..self.at[1]], &input, n, &mut works[0]);
        self.value_forward(&input, n, &mut works);
        for i in 0..n {
            self.values[steps * n + i] = works[3].output()[i];
        }
        self.acting = works;
        // generalised advantage estimation, from the end back
        for i in 0..n {
            let mut ahead = 0.0;
            for t in (0..steps).rev() {
                let k = t * n + i;
                let (next, carried) = match self.ends[k] {
                    OVER => (0.0, 0.0),
                    CUT => (self.cut_values[k], 0.0),
                    _ => (self.values[k + n], ahead),
                };
                let surprise = self.rewards[k] + gamma * next - self.values[k];
                ahead = surprise + gamma * lambda * carried;
                self.advantages[k] = ahead;
                self.returns[k] = ahead + self.values[k];
            }
        }
    }

    /// A draw from a bell curve of spread 1 (Box and Muller's way), from the learner's own random
    /// numbers.
    fn bell(&mut self) -> f32 {
        let u = 1.0 - self.random.unit();
        let v = self.random.unit();
        sqrt(-2.0 * ln(u)) * sin_cos(2.0 * crate::math::PI * v).0
    }

    /// Takes in what was sensed and returned in every worker's last rollout, in the workers' order,
    /// so the rescaling of what is sensed and of rewards is the same everywhere.
    pub fn take_in(&mut self, sensed: &[Running], returned: &[Running]) {
        for batch in sensed {
            self.sensed.merge(batch);
        }
        for batch in returned {
            self.returned.merge(batch);
        }
        self.settle();
    }

    /// Works out the rescaling from the running numbers.
    pub fn settle(&mut self) {
        for k in 0..self.senses {
            self.shift[k] = self.sensed.mean[k] as f32;
            self.scale[k] = (1.0 / self.sensed.spread(k)) as f32;
        }
        self.reward_scale = if self.settings.scale_rewards && self.returned.count > 1.0 { (1.0 / self.returned.spread(0)) as f32 } else { 1.0 };
    }

    /// Shuffles the rollout's samples for a new epoch.
    pub fn shuffle(&mut self) {
        for i in (1..self.order.len()).rev() {
            let j = self.random.below(i + 1);
            self.order.swap(i, j);
        }
    }

    /// The gradient of the loss over minibatch `which` of the shuffled rollout, into `grads`.
    pub fn gradient(&mut self, which: usize) {
        let (s, a, h) = (self.senses, self.actions, self.settings.hidden);
        let batch = self.minibatch();
        let set = self.settings;
        let picks: Vec<usize> = self.order[which * batch..(which + 1) * batch].iter().map(|&k| k as usize).collect();
        for (r, &k) in picks.iter().enumerate() {
            self.batch_in[r * s..(r + 1) * s].copy_from_slice(&self.seen[k * s..(k + 1) * s]);
        }
        // advantages are rescaled within the minibatch to a mean of 0 and a spread of 1
        let mean = picks.iter().map(|&k| self.advantages[k]).sum::<f32>() / batch as f32;
        let spread = sqrt(picks.iter().map(|&k| (self.advantages[k] - mean) * (self.advantages[k] - mean)).sum::<f32>() / batch as f32) + 1e-8;
        self.grads.fill(0.0);
        let mut works = core::mem::replace(&mut self.training, [Work::empty(), Work::empty(), Work::empty(), Work::empty()]);
        let input = core::mem::take(&mut self.batch_in);
        let w = core::mem::take(&mut self.weights);
        let mut grads = core::mem::take(&mut self.grads);
        let (trunk_w, rest) = w.split_at(self.at[1]);
        let (head_w, rest) = rest.split_at(self.at[2] - self.at[1]);
        let (value_trunk_w, rest) = rest.split_at(self.at[3] - self.at[2]);
        let (value_head_w, log_spreads) = rest.split_at(self.at[4] - self.at[3]);
        let (trunk_g, rest) = grads.split_at_mut(self.at[1]);
        let (head_g, rest) = rest.split_at_mut(self.at[2] - self.at[1]);
        let (value_trunk_g, rest) = rest.split_at_mut(self.at[3] - self.at[2]);
        let (value_head_g, spread_g) = rest.split_at_mut(self.at[4] - self.at[3]);
        let spreads: Vec<f32> = log_spreads.iter().map(|&log| exp(log)).collect();

        // the policy
        self.trunk.forward(trunk_w, &input, batch, &mut works[0]);
        let (from, to) = two(&mut works, 0, 1);
        self.head.forward(head_w, from.output(), batch, to);
        let (mut policy_loss, mut moved, mut clipped) = (0.0, 0.0, 0.0);
        let middles = works[1].output()[..batch * a].to_vec();
        let blame = self.head.blame(&mut works[1], batch);
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
            policy_loss -= whole.min(cut) / batch as f32;
            moved += ((ratio - 1.0) - (chance - self.chances[k])) / batch as f32;
            // the loss's slope against this sample's log chance: nothing where the clipped term is the lesser
            let slope = if whole <= cut { -whole / batch as f32 } else { 0.0 };
            if whole > cut {
                clipped += 1.0 / batch as f32;
            }
            for j in 0..a {
                let z = (self.taken[k * a + j] - middles[r * a + j]) / spreads[j];
                blame[r * a + j] = slope * z / spreads[j];
                spread_g[j] += slope * (z * z - 1.0);
            }
        }
        // a wider spread is more entropy, which the loss rewards
        for g in spread_g.iter_mut() {
            *g -= set.entropy_weight;
        }
        let blame_hidden = &mut self.blame_hidden[..batch * h];
        let (from, to) = two(&mut works, 0, 1);
        self.head.backward(head_w, from.output(), batch, to, head_g, Some(blame_hidden));

        // the value
        let mut value_loss = 0.0;
        let value_in: &[f32] = match &self.value_trunk {
            Some(net) => {
                net.forward(value_trunk_w, &input, batch, &mut works[2]);
                &works[2].output()[..batch * h]
            }
            None => &works[0].output()[..batch * h],
        };
        let value_in = value_in.to_vec();
        self.value_head.forward(value_head_w, &value_in, batch, &mut works[3]);
        let guesses = works[3].output()[..batch].to_vec();
        let blame = self.value_head.blame(&mut works[3], batch);
        for (r, &k) in picks.iter().enumerate() {
            let miss = guesses[r] - self.returns[k];
            value_loss += 0.5 * miss * miss / batch as f32;
            blame[r] = set.value_weight * miss / batch as f32;
        }
        let blame_value = &mut self.blame_value[..batch * h];
        self.value_head.backward(value_head_w, &value_in, batch, &mut works[3], value_head_g, Some(blame_value));
        match &self.value_trunk {
            Some(net) => {
                net.blame(&mut works[2], batch).copy_from_slice(blame_value);
                net.backward(value_trunk_w, &input, batch, &mut works[2], value_trunk_g, None);
            }
            None => {
                for (x, &y) in blame_hidden.iter_mut().zip(blame_value.iter()) {
                    *x += y;
                }
            }
        }
        self.trunk.blame(&mut works[0], batch).copy_from_slice(blame_hidden);
        self.trunk.backward(trunk_w, &input, batch, &mut works[0], trunk_g, None);

        self.report = Report { policy_loss, value_loss, moved, clipped, spread: spreads.iter().sum::<f32>() / a as f32 };
        self.training = works;
        self.batch_in = input;
        self.weights = w;
        self.grads = grads;
    }

    /// Applies a gradient (this learner's own, or the average of every worker's), shortened if too
    /// long, at the scheduled rate.
    pub fn apply(&mut self, grads: Option<&[f32]>) {
        let mut grads = match grads {
            Some(given) => given.to_vec(),
            None => core::mem::take(&mut self.grads),
        };
        let norm = length(&grads);
        // a gradient that is not finite would make every weight NaN for good: that step is not taken
        if !norm.is_finite() {
            if self.grads.is_empty() {
                self.grads = grads;
            }
            return;
        }
        if norm > self.settings.most_norm {
            let shorten = self.settings.most_norm / norm;
            grads.iter_mut().for_each(|g| *g *= shorten);
        }
        let set = self.settings;
        let along = (self.updates as f32 / set.schedule.max(1) as f32).min(1.0);
        let rate = set.rate * (1.0 - along * (1.0 - set.rate_floor));
        self.adam.step(&mut self.weights, &grads, rate);
        if self.grads.is_empty() {
            self.grads = grads;
        }
    }

    /// Counts an update as done, for the rate's schedule.
    pub fn updated(&mut self) {
        self.updates += 1;
    }

    /// One whole update, alone: a rollout, the epochs, then the rescaling brought up to date for the
    /// next rollout (which is all it is used for).
    pub fn update(&mut self, task: &mut impl Task) {
        self.collect(task);
        self.epochs();
        let (sensed, returned) = (self.rollout_sensed.clone(), self.rollout_returned.clone());
        self.take_in(&[sensed], &[returned]);
        self.updated();
    }

    /// The epochs over the rollout collected: each a shuffle, then a step for each minibatch.
    pub fn epochs(&mut self) {
        for _ in 0..self.settings.epochs {
            self.shuffle();
            // never more minibatches than samples, each of which is then a minibatch of its own
            for which in 0..self.settings.minibatches.min(self.samples()) {
                self.gradient(which);
                self.apply(None);
            }
        }
    }

    /// The policy's action for what one creature senses, without drawing: the middle of each curve,
    /// kept within -1 to 1.
    pub fn act(&mut self, senses: &[f32], into: &mut [f32]) {
        let mut input = core::mem::take(&mut self.shown_input);
        input.copy_from_slice(&senses[..self.senses]);
        self.rescale(&mut input);
        self.trunk.forward(&self.weights[..self.at[1]], &input, 1, &mut self.showing[0]);
        self.shown_input = input;
        let hidden = self.showing[0].output().to_vec();
        self.head.forward(&self.weights[self.at[1]..self.at[2]], &hidden, 1, &mut self.showing[1]);
        for (out, &middle) in into.iter_mut().zip(self.showing[1].output()) {
            *out = clamp(middle, -1.0, 1.0);
        }
    }

    /// Everything learned, to keep: the weights, Adam's running averages, then the number of updates
    /// and of Adam's steps, then the steps practised in two whole numbers of 24 bits each (low, then
    /// high), so an f32 holds each exactly. `KEPT_AFTER` numbers follow the three lists.
    pub fn state(&self) -> Vec<f32> {
        let mut out = self.weights.clone();
        out.extend_from_slice(&self.adam.mean);
        out.extend_from_slice(&self.adam.square);
        let practised = self.practised.min(HALVES * HALVES - 1);
        out.extend_from_slice(&[self.updates as f32, self.adam.steps as f32, (practised % HALVES) as f32, (practised / HALVES) as f32]);
        out
    }

    /// The running numbers kept with the weights: what has been sensed, then what rewards added up to.
    pub fn running(&self) -> Vec<f64> {
        let mut out = self.sensed.numbers();
        out.extend(self.returned.numbers());
        out
    }

    /// Takes back what `state` and `running` gave. A state of the weights alone is taken too, as a
    /// policy to show, with Adam starting afresh. False, and nothing changed, if either does not fit;
    /// a state kept before the steps practised were kept with it (two numbers shorter) does not.
    pub fn load(&mut self, state: &[f32], running: &[f64]) -> bool {
        let count = self.weights.len();
        let width = 1 + 2 * self.senses;
        if !(state.len() == count || state.len() == 3 * count + KEPT_AFTER) || state.iter().any(|x| !x.is_finite()) || running.len() != width + 3 {
            return false;
        }
        let whole = |x: f32| (0.0..HALVES as f32).contains(&x) && x == (x as u64) as f32;
        if state.len() > count && !state[3 * count + 2..].iter().all(|&x| whole(x)) {
            return false;
        }
        let (Some(sensed), Some(returned)) = (Running::from_numbers(&running[..width], self.senses), Running::from_numbers(&running[width..], 1)) else { return false };
        self.weights.copy_from_slice(&state[..count]);
        self.adam = Adam::new(count);
        if state.len() > count {
            self.adam.mean.copy_from_slice(&state[count..2 * count]);
            self.adam.square.copy_from_slice(&state[2 * count..3 * count]);
            self.updates = state[3 * count] as u32;
            self.adam.restart_at(state[3 * count + 1] as u32);
            self.practised = state[3 * count + 2] as u64 + state[3 * count + 3] as u64 * HALVES;
        } else {
            self.practised = 0;
        }
        self.sensed = sensed;
        self.returned = returned;
        self.settle();
        true
    }

    /// Each decision's advantage in the last rollout, creature by creature within each step.
    pub fn advantages_now(&self) -> &[f32] {
        &self.advantages
    }

    /// The average spread of the actions now.
    pub fn spread(&self) -> f32 {
        self.weights[self.at[4]..].iter().map(|&log| exp(log)).sum::<f32>() / self.actions as f32
    }
}

/// One work's output to read and a later one's room to write, out of the same three.
fn two(works: &mut [Work; 4], from: usize, to: usize) -> (&Work, &mut Work) {
    let (before, after) = works.split_at_mut(to);
    (&before[from], &mut after[0])
}

/// The policy, drawn: what it sensed, its hidden layers, and the middle of each action.
impl super::mind::Drawn for Learner {
    fn columns(&self) -> Vec<usize> {
        let mut columns = vec![self.senses];
        columns.extend(core::iter::repeat_n(self.settings.hidden, self.settings.layers));
        columns.push(self.actions);
        columns
    }

    fn gave(&self, column: usize, into: &mut Vec<f32>) {
        into.clear();
        let layers = self.settings.layers;
        match column {
            0 => into.extend_from_slice(&self.shown_input),
            k if k <= layers => into.extend_from_slice(&self.showing[0].outs[k - 1]),
            _ => into.extend_from_slice(self.showing[1].output()),
        }
    }

    fn weight(&self, column: usize, i: usize, j: usize) -> f32 {
        // a net's weights are kept input by input, each input's row holding its weight for every output
        if column < self.settings.layers {
            let layer = self.trunk.layers[column];
            self.weights[super::mind::layer_start(&self.trunk, column) + i * layer.outputs + j]
        } else {
            self.weights[self.at[1] + i * self.actions + j]
        }
    }
}

impl Work {
    /// No room, to hold a place while the real room is lent out.
    pub fn empty() -> Work {
        Net { layers: Vec::new() }.work(0)
    }
}
