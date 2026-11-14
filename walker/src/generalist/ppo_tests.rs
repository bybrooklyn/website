//! What learning by practice is held to before it ever meets the world: on a task of a few lines (a
//! point on a line that must reach a mark it is shown, the mark moved each run) it learns to go
//! straight there; advantages are worked out as by hand; merged running numbers are the numbers of
//! all of it; and the same seed learns the same way to the bit.

use alloc::vec;
use alloc::vec::Vec;

use super::pool::Shape;
use super::ppo::{CUT, GOING, Learner, OVER, Running, Settings, Task};
use crate::learn::Random;

/// Points on a line from -1 to 1, each to reach a mark. It senses where it is and where the mark is,
/// and moves by a tenth of its action (kept within -1 to 1) each decision. Each decision costs how far
/// it is from the mark. A run lasts twenty decisions and is then cut short, the point and the mark put
/// somewhere new.
struct Reach {
    at: Vec<f32>,
    mark: Vec<f32>,
    steps: Vec<u32>,
    random: Random,
}

impl Reach {
    fn new(count: usize, seed: u64) -> Reach {
        let mut reach = Reach { at: vec![0.0; count], mark: vec![0.0; count], steps: vec![0; count], random: Random::new(seed) };
        for i in 0..count {
            reach.place(i);
        }
        reach
    }

    fn place(&mut self, i: usize) {
        self.at[i] = 2.0 * self.random.unit() - 1.0;
        self.mark[i] = 2.0 * self.random.unit() - 1.0;
        self.steps[i] = 0;
    }
}

impl Task for Reach {
    fn count(&self) -> usize {
        self.at.len()
    }
    fn senses(&self) -> usize {
        2
    }
    fn actions(&self) -> usize {
        1
    }
    fn observe(&mut self, into: &mut [f32]) {
        for i in 0..self.count() {
            into[2 * i] = self.at[i];
            into[2 * i + 1] = self.mark[i];
        }
    }
    fn step(&mut self, actions: &[f32], into: &mut [f32], rewards: &mut [f32], ends: &mut [u8], last: &mut [f32]) {
        for i in 0..self.count() {
            self.at[i] = (self.at[i] + 0.1 * actions[i].clamp(-1.0, 1.0)).clamp(-1.0, 1.0);
            rewards[i] = -(self.at[i] - self.mark[i]).abs();
            self.steps[i] += 1;
            ends[i] = GOING;
            if self.steps[i] == 20 {
                ends[i] = CUT;
                last[2 * i] = self.at[i];
                last[2 * i + 1] = self.mark[i];
                self.place(i);
            }
        }
        self.observe(into);
    }
}

fn toy() -> Settings {
    Settings { hidden: 32, steps: 32, rate: 1e-3, schedule: 100, ..Settings::default() }
}

/// How far, on average, a policy's points end from their marks over many runs, acting without drawing.
fn miss(learner: &mut Learner) -> f32 {
    let mut random = Random::new(99);
    let mut total = 0.0;
    for _ in 0..200 {
        let (mut at, mark) = (2.0 * random.unit() - 1.0, 2.0 * random.unit() - 1.0);
        let mut action = [0.0];
        for _ in 0..20 {
            learner.act(&[at, mark], &mut action);
            at = (at + 0.1 * action[0]).clamp(-1.0, 1.0);
        }
        total += (at - mark).abs() / 200.0;
    }
    total
}

#[test]
fn it_learns_to_reach_a_mark() {
    let mut task = Reach::new(16, 5);
    let mut learner = Learner::new(toy(), 2, 1, 16, 1);
    learner.begin(&mut task);
    let before = miss(&mut learner);
    for _ in 0..60 {
        learner.update(&mut task);
    }
    let after = miss(&mut learner);
    // standing still ends about two thirds of a unit away; going straight there ends on the mark
    assert!(before > 0.4 && after < 0.08, "missed by {before} at first and {after} after learning");
}

#[test]
fn the_same_seed_learns_the_same_way() {
    let run = |seed: u64| {
        let mut task = Reach::new(8, 3);
        let mut learner = Learner::new(Settings { shared: true, ..toy() }, 2, 1, 8, seed);
        learner.begin(&mut task);
        for _ in 0..5 {
            learner.update(&mut task);
        }
        learner.weights.iter().map(|w| w.to_bits()).collect::<Vec<_>>()
    };
    assert_eq!(run(4), run(4));
    assert_ne!(run(4), run(5));
}

/// A task whose rewards and ends are set, to check advantages against a hand calculation.
struct Fixed {
    step: usize,
}

impl Task for Fixed {
    fn count(&self) -> usize {
        1
    }
    fn senses(&self) -> usize {
        1
    }
    fn actions(&self) -> usize {
        1
    }
    fn observe(&mut self, into: &mut [f32]) {
        into[0] = 0.0;
    }
    fn step(&mut self, _: &[f32], into: &mut [f32], rewards: &mut [f32], ends: &mut [u8], last: &mut [f32]) {
        rewards[0] = [1.0, 2.0, 3.0, 4.0][self.step];
        ends[0] = [GOING, OVER, GOING, CUT][self.step];
        last[0] = 0.0;
        into[0] = 0.0;
        self.step += 1;
    }
}

#[test]
fn advantages_are_worked_out_as_by_hand() {
    let settings = Settings { steps: 4, minibatches: 1, scale_rewards: false, gamma: 0.5, lambda: 0.5, ..Settings::default() };
    let mut learner = Learner::new(settings, 1, 1, 1, 1);
    // every value guess the same: the value's weights all zero but its bias
    let at = learner.at;
    learner.weights[at[3]..at[4]].fill(0.0);
    learner.weights[at[4] - 1] = 1.0;
    let mut task = Fixed { step: 0 };
    learner.begin(&mut task);
    learner.collect(&mut task);
    // with every value 1: surprises are r + 0.5 * next - 1, where next is 0 after an end and the cut
    // value 1 where cut; each advantage carries a quarter of the next unless its run ended
    let s = [1.0 + 0.5 - 1.0, 2.0 - 1.0, 3.0 + 0.5 - 1.0, 4.0 + 0.5 - 1.0];
    let wanted = [s[0] + 0.25 * s[1], s[1], s[2] + 0.25 * s[3], s[3]];
    let found = learner_advantages(&learner);
    for (w, f) in wanted.iter().zip(&found) {
        assert!((w - f).abs() < 1e-5, "{wanted:?} wanted, {found:?} found");
    }
}

fn learner_advantages(learner: &Learner) -> Vec<f32> {
    learner.advantages_now().to_vec()
}

#[test]
fn more_minibatches_asked_than_there_are_samples_is_a_minibatch_of_one_each() {
    let settings = Settings { steps: 2, minibatches: 64, ..toy() };
    let mut task = Reach::new(4, 1);
    let mut learner = Learner::new(settings, 2, 1, 4, 3);
    learner.begin(&mut task);
    learner.update(&mut task);
    assert!(learner.weights.iter().all(|w| w.is_finite()));
}

#[test]
fn a_number_that_is_not_finite_never_gets_into_what_is_learned() {
    // a running mean is not spoiled by one row with a NaN or an infinity in it
    let mut running = Running::new(2);
    running.add(&[1.0, 2.0]);
    running.add(&[f32::NAN, 5.0]);
    running.add(&[3.0, f32::INFINITY]);
    running.add(&[3.0, 4.0]);
    assert_eq!((running.count, running.mean[0], running.mean[1]), (2.0, 2.0, 3.0));
    // a sense that is not finite is taken as nothing out of the ordinary, and acting goes on
    let mut learner = Learner::new(toy(), 2, 1, 4, 3);
    let mut action = [0.0f32];
    learner.act(&[f32::NAN, f32::INFINITY], &mut action);
    assert!(action[0].is_finite());
    // a gradient that is not finite moves no weight
    let before = learner.weights.clone();
    let mut grads = vec![0.01f32; before.len()];
    grads[3] = f32::NAN;
    learner.apply(Some(&grads));
    assert_eq!(learner.weights, before);
    grads[3] = f32::INFINITY;
    learner.apply(Some(&grads));
    assert_eq!(learner.weights, before);
    assert!(learner.adam.mean.iter().chain(&learner.adam.square).all(|x| x.is_finite()));
}

#[test]
fn merged_running_numbers_are_the_numbers_of_all_of_it() {
    let values: Vec<[f32; 2]> = (0..50).map(|i| [(i as f32 * 0.37).sin() * 3.0, i as f32]).collect();
    let mut whole = Running::new(2);
    for v in &values {
        whole.add(v);
    }
    let (mut first, mut second) = (Running::new(2), Running::new(2));
    for v in &values[..17] {
        first.add(v);
    }
    for v in &values[17..] {
        second.add(v);
    }
    first.merge(&second);
    for k in 0..2 {
        assert!((first.mean[k] - whole.mean[k]).abs() < 1e-9 && (first.spread(k) - whole.spread(k)).abs() < 1e-9);
    }
    assert_eq!(Running::from_numbers(&whole.numbers(), 2), Some(whole));
}

/// The whole loss an update goes down, as `gradient` reports it: the policy's, the value's weighed,
/// less the entropy bonus.
fn whole_loss(learner: &Learner) -> f64 {
    let set = learner.settings;
    let entropy: f32 = learner.weights[learner.at[4]..learner.at[4] + learner.actions].iter().sum();
    learner.report.policy_loss as f64 + set.value_weight as f64 * learner.report.value_loss as f64 - set.entropy_weight as f64 * entropy as f64
}

#[test]
fn the_gradient_of_the_whole_loss_is_what_nudging_shows() {
    let settings = Settings { hidden: 8, steps: 8, minibatches: 2, entropy_weight: 0.01, ..toy() };
    let clipped = gradient_against_nudging(settings, 0.0, 1e-2);
    // every ratio starts at 1, so here the clipped branch is never the one taken
    assert_eq!(clipped, 0.0);
}

#[test]
fn the_gradient_is_what_nudging_shows_where_ratios_are_clipped_too() {
    // the weights moved after the rollout, as epochs move them, so some ratios are past 1 +- clip
    // and the loss there is flat; with the trunk shared between the policy and the value as well
    for shared in [false, true] {
        let settings = Settings { hidden: 8, steps: 16, minibatches: 2, entropy_weight: 0.01, shared, ..toy() };
        let clipped = gradient_against_nudging(settings, 0.6, 1e-3);
        assert!(clipped > 0.2 && clipped < 0.9, "shared {shared}: {clipped} of the samples clipped");
    }
}

/// Holds the gradient of the whole loss over a minibatch to finite differences of step `h`, the
/// weights moved by up to `moved` after the rollout was collected. Gives the share of the samples
/// whose ratio was clipped.
fn gradient_against_nudging(settings: Settings, moved: f32, h: f32) -> f32 {
    let mut task = Reach::new(4, 11);
    let mut learner = Learner::with(settings, 2, 1, 4, 3, &[1], None);
    // weights away from where they start, so the policy's means and spreads are not all alike
    let mut random = Random::new(5);
    for w in learner.weights.iter_mut() {
        *w += 0.1 * (2.0 * random.unit() - 1.0);
    }
    learner.begin(&mut task);
    learner.collect(&mut task);
    for w in learner.weights.iter_mut() {
        *w += moved * (2.0 * random.unit() - 1.0);
    }
    learner.shuffle();
    learner.gradient(1);
    let clipped = learner.report.clipped;
    let grads = learner.grads.clone();
    for (k, &grad) in grads.iter().enumerate() {
        let kept = learner.weights[k];
        learner.weights[k] = kept + h;
        learner.gradient(1);
        let up = whole_loss(&learner);
        learner.weights[k] = kept - h;
        learner.gradient(1);
        let down = whole_loss(&learner);
        learner.weights[k] = kept;
        let wanted = (up - down) / (2.0 * h as f64);
        let error = (grad as f64 - wanted).abs();
        assert!(error < 2e-3 + 2e-2 * wanted.abs(), "weight {k}: gradient {grad}, nudging {wanted}");
    }
    clipped
}

/// A small pool with every kind of neuron in it.
const EVERY_KIND: Shape = Shape { memory: 3, rhythm: 2, mood: 2, reads: 3 };

#[test]
fn with_a_pool_the_gradient_of_the_whole_loss_is_what_nudging_shows() {
    // windows of four decisions, two of them to a minibatch of each creature's; and a run ends inside a
    // window, since Reach cuts its runs every twenty decisions
    let settings = Settings { hidden: 8, steps: 24, minibatches: 2, entropy_weight: 0.01, shape: EVERY_KIND, window: 4, ..toy() };
    gradient_against_nudging(settings, 0.0, 1e-2);
    let clipped = gradient_against_nudging(settings, 0.3, 1e-3);
    assert!(clipped > 0.05 && clipped < 0.95, "{clipped} of the samples clipped");
}

#[test]
fn with_a_pool_the_same_seed_learns_the_same_way() {
    let run = |seed: u64| {
        let mut task = Reach::new(8, 3);
        let mut learner = Learner::new(Settings { shape: EVERY_KIND, window: 8, ..toy() }, 2, 1, 8, seed);
        learner.begin(&mut task);
        for _ in 0..5 {
            learner.update(&mut task);
        }
        learner.weights.iter().map(|w| w.to_bits()).collect::<Vec<_>>()
    };
    assert_eq!(run(4), run(4));
    assert_ne!(run(4), run(5));
}

/// The memory task: a sign is shown once, at a run's first decision, and asked for `DELAY` decisions
/// later, when the second sense says so; only that answer is paid (less how far it is from the sign),
/// and the run ends. Nothing in between says what the sign was, so a brain that holds nothing can do no
/// better than answer 0 and be a whole unit out every time.
const DELAY: u32 = 5;

struct Cue {
    sign: Vec<f32>,
    step: Vec<u32>,
    random: Random,
}

impl Cue {
    fn new(count: usize, seed: u64) -> Cue {
        let mut random = Random::new(seed);
        let sign = (0..count).map(|_| if random.unit() < 0.5 { -1.0 } else { 1.0 }).collect();
        Cue { sign, step: vec![0; count], random }
    }

    fn senses(sign: f32, step: u32) -> [f32; 2] {
        match step {
            0 => [sign, 0.0],
            s if s == DELAY + 1 => [0.0, 1.0],
            _ => [0.0, 0.0],
        }
    }
}

impl Task for Cue {
    fn count(&self) -> usize {
        self.sign.len()
    }
    fn senses(&self) -> usize {
        2
    }
    fn actions(&self) -> usize {
        1
    }
    fn observe(&mut self, into: &mut [f32]) {
        for i in 0..self.count() {
            into[2 * i..2 * i + 2].copy_from_slice(&Cue::senses(self.sign[i], self.step[i]));
        }
    }
    fn step(&mut self, actions: &[f32], into: &mut [f32], rewards: &mut [f32], ends: &mut [u8], _: &mut [f32]) {
        for i in 0..self.count() {
            rewards[i] = if self.step[i] == DELAY + 1 { -(actions[i].clamp(-1.0, 1.0) - self.sign[i]).abs() } else { 0.0 };
            self.step[i] += 1;
            ends[i] = GOING;
            if self.step[i] > DELAY + 1 {
                ends[i] = OVER;
                self.step[i] = 0;
                self.sign[i] = if self.random.unit() < 0.5 { -1.0 } else { 1.0 };
            }
        }
        self.observe(into);
    }
}

/// How far the answers are from the signs on average, acting without drawing, each run from a fresh pool.
fn cue_miss(learner: &mut Learner) -> f32 {
    let mut total = 0.0;
    for run in 0..200 {
        let sign = if run % 2 == 0 { -1.0 } else { 1.0 };
        learner.forget_show();
        let mut action = [0.0];
        for step in 0..=DELAY + 1 {
            learner.act(&Cue::senses(sign, step), &mut action);
        }
        total += (action[0] - sign).abs() / 200.0;
    }
    total
}

fn cue_learned(shape: Shape) -> f32 {
    let settings = Settings { hidden: 32, steps: 32, rate: 3e-3, schedule: 400, shape, window: 16, ..Settings::default() };
    let mut task = Cue::new(16, 5);
    let mut learner = Learner::new(settings, 2, 1, 16, 1);
    learner.begin(&mut task);
    for _ in 0..300 {
        learner.update(&mut task);
    }
    cue_miss(&mut learner)
}

#[test]
fn a_sign_shown_once_is_answered_later_by_a_brain_with_memory_and_not_by_the_plain_one() {
    let plain = cue_learned(Shape::PLAIN);
    let memory = cue_learned(Shape { memory: 8, rhythm: 0, mood: 0, reads: 6 });
    let every = cue_learned(Shape { memory: 8, rhythm: 2, mood: 2, reads: 6 });
    std::println!("the memory task, missed by: plain {plain:.3}, memory {memory:.3}, every kind {every:.3}");
    assert!(plain > 0.8, "the plain network missed by {plain}");
    assert!(memory < 0.3 && every < 0.3, "with memory it missed by {memory}, with every kind by {every} (plain {plain})");
}

#[test]
fn a_learner_reshaped_acts_as_it_did_and_takes_up_what_it_learned() {
    let senses = [0.3f32, -0.7];
    let shapes = [Shape { memory: 4, rhythm: 1, mood: 2, reads: 3 }, Shape { memory: 7, rhythm: 3, mood: 2, reads: 5 }];
    let mut task = Reach::new(8, 3);
    let mut learner = Learner::new(Settings { shape: shapes[0], window: 8, ..toy() }, 2, 1, 8, 2);
    learner.begin(&mut task);
    for _ in 0..4 {
        learner.update(&mut task);
    }
    let acts = |learner: &mut Learner| {
        learner.forget_show();
        let mut action = [0.0];
        (0..6).map(|_| {
            learner.act(&senses, &mut action);
            action[0]
        }).collect::<Vec<f32>>()
    };
    let before = acts(&mut learner);
    // grown: every kind more, and more reads each; and grown from the plain network
    let mut grown = learner.reshaped(shapes[1], 7);
    let after = acts(&mut grown);
    for (a, b) in before.iter().zip(&after) {
        assert!((a - b).abs() < 1e-5, "{before:?} became {after:?}");
    }
    assert_eq!((grown.updates, grown.practised, grown.adam.steps), (learner.updates, learner.practised, learner.adam.steps));
    let mut plain = Learner::new(toy(), 2, 1, 8, 2);
    plain.begin(&mut task);
    plain.update(&mut task);
    let before = acts(&mut plain);
    let mut pooled = plain.reshaped(shapes[0], 3);
    let after = acts(&mut pooled);
    for (a, b) in before.iter().zip(&after) {
        assert!((a - b).abs() < 1e-5, "{before:?} became {after:?}");
    }
    // a learner kept goes back into one of its own form, and practice goes on with either
    let mut back = Learner::of_form(toy(), &grown.form(), 2, 1, 8, 1).unwrap();
    assert!(back.load(&grown.state(), &grown.running()));
    assert_eq!(acts(&mut back), acts(&mut grown));
    grown.begin(&mut task);
    grown.update(&mut task);
    assert!(grown.weights.iter().all(|w| w.is_finite()));
    // shrunk: it still acts and learns
    let mut shrunk = grown.reshaped(Shape { memory: 2, rhythm: 0, mood: 1, reads: 2 }, 4);
    shrunk.begin(&mut task);
    shrunk.update(&mut task);
    assert!(shrunk.weights.iter().all(|w| w.is_finite()));
}
