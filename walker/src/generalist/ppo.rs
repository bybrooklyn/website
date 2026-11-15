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

use super::net::{Adam, Layer, Net, Squash, Work, length};
use super::pool::{Pool, Shape};
use super::wiring::Grow;
use crate::learn::Random;
use crate::math::{clamp, exp, ln, sin_cos, sqrt};

mod foresee;
mod recurrent;
pub use foresee::Foreseeing;
pub use recurrent::Shown;
use recurrent::Recurrent;

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
    /// What each one's brain costs each second while it acts on this decision, as a share of all its
    /// energy (a brain that grows its connections, `wiring`); a task without energy ignores it.
    fn brain(&mut self, _costs: &[f32]) {}
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
    /// The pool beside the plain neurons (`pool`): none for the plain network of two layers. With a
    /// pool, the value has its own layers whatever `shared` says.
    pub shape: Shape,
    /// How many decisions learning goes back through at once with a pool (the most that divides
    /// `steps`).
    pub window: usize,
    /// Whether the pool's memory reads are plastic (`Pool::plastic`): a trial's switch.
    pub plastic: bool,
    /// Whether a creature that senses a changing world has a predictor of what it will see next
    /// (`foreseeing`), and what a unit of its surprise above the usual is worth as a reason to look.
    pub foresee: bool,
    pub wonder: f32,
    /// Whether a pool's memory neurons add and cut their connections while it lives, by what rule and at
    /// what price (`wiring`, stage 5); none for stage 4's brain. It needs the predictor, whose surprise the
    /// rule reads.
    pub grow: Option<Grow>,
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
            shape: Shape::PLAIN,
            window: 16,
            plastic: true,
            foresee: true,
            wonder: 1.0,
            grow: None,
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
    /// The pool and everything practice with it needs, for a shape that has one.
    recurrent: Option<alloc::boxed::Box<Recurrent>>,
    /// The predictor of what its creatures will see next, and everything it needs, for a learner that
    /// has one (`foreseeing`).
    pub foresee: Option<alloc::boxed::Box<Foreseeing>>,
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
        Learner::with(settings, senses, actions, count, seed, &[], None)
    }

    /// The same, a pool's moods first reading the senses numbered in `feelings`, or the pool given (of
    /// the settings' shape) in place of one drawn afresh.
    pub fn with(settings: Settings, senses: usize, actions: usize, count: usize, seed: u64, feelings: &[usize], pool: Option<Pool>) -> Learner {
        let s = settings;
        let shape = s.shape;
        let pooled = !shape.is_plain();
        let mut sizes = vec![senses];
        sizes.extend(core::iter::repeat_n(s.hidden, s.layers));
        let mut trunk = Net::new(&sizes, s.squash, s.squash);
        let head = Net::new(&[s.hidden, actions], s.squash, Squash::Plain);
        let mut value_trunk = (!s.shared).then(|| trunk.clone());
        if pooled {
            // the second plain layer reads the pool too; the value reads what is sensed and the pool
            assert!(s.layers == 2, "a pool sits between two plain layers");
            trunk.layers[1] = Layer { inputs: s.hidden + shape.outputs(), ..trunk.layers[1] };
            let mut value_sizes = vec![senses + shape.outputs()];
            value_sizes.extend(core::iter::repeat_n(s.hidden, s.layers));
            value_trunk = Some(Net::new(&value_sizes, s.squash, s.squash));
        }
        let value_head = Net::new(&[s.hidden, 1], s.squash, Squash::Plain);
        let mut at = [0; 5];
        at[1] = trunk.weights();
        at[2] = at[1] + head.weights();
        at[3] = at[2] + value_trunk.as_ref().map_or(0, Net::weights);
        at[4] = at[3] + value_head.weights();
        let total = at[4] + actions + shape.weights();
        let mut random = Random::new(seed);
        let mut weights = vec![0.0; total];
        // hidden layers at a gain of one for tanh and the square root of two for ReLU, the policy's last
        // layer small so it starts near the middle of every action, the value's at one
        let gain = if s.squash == Squash::Relu { 1.414 } else { 1.0 };
        trunk.first(&mut weights[..at[1]], &mut random, gain, gain);
        head.first(&mut weights[at[1]..at[2]], &mut random, 0.01, 0.01);
        if let Some(net) = &value_trunk {
            net.first(&mut weights[at[2]..at[3]], &mut random, gain, gain);
        }
        value_head.first(&mut weights[at[3]..at[4]], &mut random, 1.0, 1.0);
        weights[at[4]..at[4] + actions].fill(s.spread_start);
        let samples = s.steps * count;
        let minibatch = (samples / s.minibatches.max(1)).max(1);
        let recurrent = pooled.then(|| {
            let mut recurrent = Recurrent::new(shape, pool, senses, s.hidden, count, s.steps, s.window, minibatch, at[4] + actions, feelings);
            recurrent.pool.plastic = s.plastic;
            recurrent.pool.first(&mut weights[at[4] + actions..], &mut random);
            alloc::boxed::Box::new(recurrent)
        });
        let works = |batch: usize| [trunk.work(batch), head.work(batch), if s.shared && !pooled { Work::empty() } else { value_trunk.as_ref().unwrap_or(&trunk).work(batch) }, value_head.work(batch)];
        Learner {
            recurrent,
            foresee: None,
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
            batch_in: vec![0.0; minibatch.max(count) * (senses + shape.outputs())],
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
        if self.recurrent.is_some() {
            self.collect_recurrent(task);
            return;
        }
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
            self.foresee_keep();
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
            self.foresee_before(t);
            task.step(&self.actions_now, &mut self.now, &mut self.step_rewards, &mut self.step_ends, &mut self.last);
            self.foresee_after(t);
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
        self.advantages_from_rollout(n, steps, gamma, lambda);
    }

    /// Generalised advantage estimation over the rollout, from the end back.
    fn advantages_from_rollout(&mut self, n: usize, steps: usize, gamma: f32, lambda: f32) {
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
        if self.recurrent.is_some() {
            self.shuffle_recurrent();
            return;
        }
        for i in (1..self.order.len()).rev() {
            let j = self.random.below(i + 1);
            self.order.swap(i, j);
        }
    }

    /// The gradient of the loss over minibatch `which` of the shuffled rollout, into `grads`.
    pub fn gradient(&mut self, which: usize) {
        if self.recurrent.is_some() {
            self.gradient_recurrent(which);
            return;
        }
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
        self.foresee_gradient(which, self.settings.minibatches.min(self.samples()));
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
            let count = if self.recurrent.is_some() { self.minibatches_recurrent().0 } else { self.settings.minibatches.min(self.samples()) };
            for which in 0..count {
                self.gradient(which);
                self.apply(None);
            }
        }
    }

    /// The policy's action for what one creature senses, without drawing: the middle of each curve,
    /// kept within -1 to 1.
    pub fn act(&mut self, senses: &[f32], into: &mut [f32]) {
        if self.foresee.is_some() {
            // its surprise written into what it senses, and, once it has chosen, its guess of what comes next
            let mut raw = senses[..self.senses].to_vec();
            self.foresee_meet(&mut raw);
            self.act_chosen(&raw, into);
            self.foresee_guess(&raw, into);
        } else {
            self.act_chosen(senses, into);
        }
    }

    /// `act`, its surprise (if it has a predictor) already written into what it senses.
    fn act_chosen(&mut self, senses: &[f32], into: &mut [f32]) {
        if self.recurrent.is_some() {
            self.act_recurrent(senses, into);
            return;
        }
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

    /// The learner's form, to keep beside its state: its pool's shape and every read (`Pool::form`), or
    /// four noughts for the plain network.
    pub fn form(&self) -> Vec<f32> {
        self.recurrent.as_ref().map_or_else(|| vec![0.0; 4], |r| r.pool.form())
    }

    /// The pool, if it has one.
    pub fn pool(&self) -> Option<&Pool> {
        self.recurrent.as_ref().map(|r| &r.pool)
    }

    /// Makes its pool add and cut connections while it lives by `grow`, or stop (none): kept in its
    /// settings, and put into its pool if it has one and a predictor to read surprise from. Nothing it
    /// learned changes, since a rule has no weights; every run goes on from a fresh pool.
    pub fn grow(&mut self, grow: Option<Grow>) {
        self.settings.grow = grow;
        let look = self.foresee.as_ref().map(|f| f.look);
        if let Some(r) = &mut self.recurrent {
            let growth = grow.zip(look).map(|(grow, look)| {
                // its energy is two before where its eye is sensed, and having just eaten one before
                let energy = look.gaze - 2;
                super::wiring::Growth { rule: grow.rule, price: grow.price, signals: [energy, energy + 1, look.surprise] }
            });
            if growth != r.pool.grow {
                r.regrow(growth);
            }
        }
    }

    /// What the brain of a creature whose state is kept in `state` (as `act_as` keeps it) costs each
    /// second, as a share of all its energy, and how many of its places hold a connection of how many.
    pub fn brain_cost(&self, state: &[f32]) -> (f32, usize, usize) {
        match &self.recurrent {
            Some(r) if r.pool.grow.is_some() && state.len() >= r.pool.state() => {
                let mine = &state[..r.pool.state()];
                let (joined, places) = r.pool.joined(mine);
                (r.pool.cost(mine), joined, places)
            }
            _ => (0.0, 0, 0),
        }
    }

    /// The same for the creature on show.
    pub fn show_cost(&self) -> (f32, usize, usize) {
        self.recurrent.as_ref().map_or((0.0, 0, 0), |r| self.brain_cost(&r.show_state))
    }

    /// The share of its places joined over its last rollout: 1 for a brain that does not grow.
    pub fn joined_share(&self) -> f32 {
        self.recurrent.as_ref().filter(|r| r.pool.grow.is_some()).map_or(1.0, |r| r.joined)
    }

    /// A learner of the form given (from `form`), otherwise as `Learner::with`; none if the form does
    /// not hold together for these senses.
    pub fn of_form(settings: Settings, form: &[f32], senses: usize, actions: usize, count: usize, seed: u64) -> Option<Learner> {
        let pool = Pool::from_form(form, senses, settings.hidden)?;
        let shape = pool.shape;
        Some(Learner::with(Settings { shape, ..settings }, senses, actions, count, seed, &[], (!shape.is_plain()).then_some(pool)))
    }

    /// Acts for one of several creatures, each with its pool's state kept by the caller in `state`
    /// (empty for a creature not yet begun, which starts afresh); for a plain learner, as `act`.
    /// With a predictor, its expectation is kept in the state too, after the pool's.
    pub fn act_as(&mut self, state: &mut Vec<f32>, senses: &[f32], into: &mut [f32]) {
        let pooled = self.recurrent.as_ref().map_or(0, |r| r.show_state.len());
        let kept = self.foresee_kept();
        if state.len() != pooled + kept {
            state.clear();
            state.resize(pooled + kept, 0.0);
            if let Some(r) = &self.recurrent {
                r.pool.fresh(&mut state[..pooled]);
            }
            if kept > 0 {
                super::expect::Expecting::default().write(&mut state[pooled..]);
            }
        }
        let mut pool_state = state.split_off(pooled);
        core::mem::swap(&mut pool_state, state);
        // `state` is now the expectation's part, and `pool_state` the pool's
        if let Some(r) = &mut self.recurrent {
            core::mem::swap(&mut r.show_state, &mut pool_state);
        }
        let shown = self.foresee.as_mut().map(|f| core::mem::replace(&mut f.show, super::expect::Expecting::read(state)));
        self.act(senses, into);
        if let Some(f) = &mut self.foresee {
            f.show.write(state);
            f.show = shown.unwrap_or_default();
        }
        if let Some(r) = &mut self.recurrent {
            core::mem::swap(&mut r.show_state, &mut pool_state);
        }
        pool_state.append(state);
        *state = pool_state;
    }

    /// What the creature on show sensed at its last decision, rescaled, as the policy took it.
    pub fn shown_input(&self) -> &[f32] {
        &self.shown_input
    }

    /// The middle of each action at the creature on show's last decision.
    pub fn shown_actions(&self) -> &[f32] {
        self.showing[1].output()
    }

    /// The creature on show starts a run: its pool afresh.
    pub fn forget_show(&mut self) {
        if let Some(f) = &mut self.foresee {
            f.show = super::expect::Expecting::default();
        }
        if let Some(r) = &mut self.recurrent {
            let mut state = core::mem::take(&mut r.show_state);
            r.pool.fresh(&mut state);
            r.show_state = state;
        }
    }

    /// What the creature on show last thought, with a pool, for its picture, and its pool's state now.
    pub fn shown(&self) -> Option<(&Shown, &[f32])> {
        self.recurrent.as_ref().map(|r| (&r.shown, r.show_state.as_slice()))
    }

    /// This learner reshaped to `shape` (`Pool::reshape`), keeping everything it can: the plain layers,
    /// the head, the value and the spreads as they are; neurons kept, with their reads and the weights
    /// that read them; new neurons read by nobody, so it acts as it did; Adam's averages carried with
    /// each weight and none for a new one; its updates, steps and running numbers. A pool's new reads are
    /// drawn from `seed`. The plain network has no pool to reshape from, so a pool grown out of it
    /// starts with every neuron new.
    pub fn reshaped(&self, shape: Shape, seed: u64) -> Learner {
        let s = self.settings;
        let mut random = Random::new(seed ^ 0x7265_7368_6170_6500);
        let (hidden, senses) = (s.hidden, self.senses);
        let old_p = self.settings.shape.outputs();
        let empty = Pool::new(Shape::PLAIN, senses, hidden, &[], &mut Random::new(0));
        let old_pool = self.pool().unwrap_or(&empty);
        // how much each output of the old pool counts for the rest: its weights into the second plain
        // layer and into the value
        let mut used = vec![0.0f32; old_p];
        let two_rows = self.trunk.layers[0].weights();
        for (o, u) in used.iter_mut().enumerate() {
            let row = two_rows + (hidden + o) * hidden;
            *u += self.weights[row..row + hidden].iter().map(|w| w.abs()).sum::<f32>();
            let row = self.at[2] + (senses + o) * hidden;
            *u += self.weights[row..row + hidden].iter().map(|w| w.abs()).sum::<f32>();
        }
        let mut fresh_pool = vec![0.0; shape.weights()];
        let (pool, outputs, carried) = old_pool.reshape(self.pool().map_or(&[][..], |_| &self.weights[self.at[4] + self.actions..]), &used, shape, &mut fresh_pool, &mut random);
        let mut learner = Learner::with(Settings { shape, ..s }, senses, self.actions, self.count, seed, &[], (!shape.is_plain()).then(|| pool.clone()));
        // where each of the new learner's weights comes from in the old, if anywhere
        let mut from: Vec<Option<usize>> = vec![None; learner.weights.len()];
        let new_p = shape.outputs();
        let old_two = self.trunk.layers[0].weights();
        let new_two = learner.trunk.layers[0].weights();
        // the first plain layer, the same
        for (k, f) in from.iter_mut().enumerate().take(new_two) {
            *f = Some(k);
        }
        // the second: its rows for the first layer, the pool's rows by `outputs`, then its biases
        for row in 0..hidden + new_p {
            let old_row = if row < hidden { Some(row) } else { outputs[row - hidden].map(|o| hidden + o) };
            if let Some(old_row) = old_row {
                for j in 0..hidden {
                    from[new_two + row * hidden + j] = Some(old_two + old_row * hidden + j);
                }
            } else {
                for j in 0..hidden {
                    from[new_two + row * hidden + j] = Some(usize::MAX);
                }
            }
        }
        for j in 0..hidden {
            from[new_two + (hidden + new_p) * hidden + j] = Some(old_two + (hidden + old_p) * hidden + j);
        }
        // the head
        for k in 0..learner.at[2] - learner.at[1] {
            from[learner.at[1] + k] = Some(self.at[1] + k);
        }
        // the value's first layer, by rows as the second plain layer, then the rest of it and its head
        let value_first = (senses + new_p + 1) * hidden;
        for row in 0..senses + new_p {
            let old_row = if row < senses { Some(row) } else { outputs[row - senses].map(|o| senses + o) };
            for j in 0..hidden {
                from[learner.at[2] + row * hidden + j] = Some(old_row.map_or(usize::MAX, |r| self.at[2] + r * hidden + j));
            }
        }
        for j in 0..hidden {
            from[learner.at[2] + (senses + new_p) * hidden + j] = Some(self.at[2] + (senses + old_p) * hidden + j);
        }
        let old_value_first = (senses + old_p + 1) * hidden;
        for k in 0..learner.at[4] + self.actions - learner.at[2] - value_first {
            from[learner.at[2] + value_first + k] = Some(self.at[2] + old_value_first + k);
        }
        // a weight from nowhere that reads a pool's output starts at nothing, so nothing changes at first;
        // the pool's own new weights are as `reshape` made them
        let pool_at = learner.at[4] + self.actions;
        for (k, f) in from.iter().enumerate() {
            match *f {
                Some(usize::MAX) => {
                    learner.weights[k] = 0.0;
                    learner.adam.mean[k] = 0.0;
                    learner.adam.square[k] = 0.0;
                }
                Some(old) => {
                    learner.weights[k] = self.weights[old];
                    learner.adam.mean[k] = self.adam.mean[old];
                    learner.adam.square[k] = self.adam.square[old];
                }
                None if k >= pool_at => {
                    learner.weights[k] = fresh_pool[k - pool_at];
                    learner.adam.mean[k] = 0.0;
                    learner.adam.square[k] = 0.0;
                }
                None => {}
            }
        }
        // the pool's weights that were carried: Adam's averages with them
        let old_pool_at = self.at[4] + self.actions;
        for (k, old) in carried.iter().enumerate() {
            if let Some(old) = *old {
                learner.adam.mean[pool_at + k] = self.adam.mean[old_pool_at + old];
                learner.adam.square[pool_at + k] = self.adam.square[old_pool_at + old];
            }
        }
        learner.adam.restart_at(self.adam.steps);
        // the predictor of what it will see, as it was
        if let Some(f) = &self.foresee {
            learner = learner.foreseeing(f.look, f.wonder);
            if let Some(g) = &learner.foresee {
                let (to, from, length) = (g.at, f.at, super::expect::WEIGHTS);
                learner.weights[to..to + length].copy_from_slice(&self.weights[from..from + length]);
                learner.adam.mean[to..to + length].copy_from_slice(&self.adam.mean[from..from + length]);
                learner.adam.square[to..to + length].copy_from_slice(&self.adam.square[from..from + length]);
            }
        }
        learner.updates = self.updates;
        learner.practised = self.practised;
        learner.decisions = self.decisions;
        learner.sensed = self.sensed.clone();
        learner.returned = self.returned.clone();
        learner.settle();
        learner
    }

    /// Each decision's advantage in the last rollout, creature by creature within each step.
    pub fn advantages_now(&self) -> &[f32] {
        &self.advantages
    }

    /// The average spread of the actions now.
    pub fn spread(&self) -> f32 {
        self.weights[self.at[4]..self.at[4] + self.actions].iter().map(|&log| exp(log)).sum::<f32>() / self.actions as f32
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
