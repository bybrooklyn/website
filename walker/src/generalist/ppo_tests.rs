//! What learning by practice is held to before it ever meets the world: on a task of a few lines (a
//! point on a line that must reach a mark it is shown, the mark moved each run) it learns to go
//! straight there; advantages are worked out as by hand; merged running numbers are the numbers of
//! all of it; and the same seed learns the same way to the bit.

use alloc::vec;
use alloc::vec::Vec;

use super::ppo::{CUT, GOING, Learner, Mirror, OVER, Running, Settings, Task};
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

/// Two points on a line, each to reach its own mark, the same task both ways round: swapping the
/// points (and their marks and actions) is its mirror image. Lopsided, the second point is always put
/// back on its mark, so only the first is ever seen away from it.
struct Pair {
    reach: Reach,
    lopsided: bool,
}

impl Pair {
    fn new(points: usize, seed: u64, lopsided: bool) -> Pair {
        let mut pair = Pair { reach: Reach::new(points, seed), lopsided };
        pair.settle();
        pair
    }

    fn settle(&mut self) {
        if self.lopsided {
            for j in (1..self.reach.count()).step_by(2) {
                self.reach.at[j] = self.reach.mark[j];
            }
        }
    }
}

impl Task for Pair {
    fn count(&self) -> usize {
        self.reach.count() / 2
    }
    fn senses(&self) -> usize {
        4
    }
    fn actions(&self) -> usize {
        2
    }
    fn observe(&mut self, into: &mut [f32]) {
        let mut both = vec![0.0; 2 * self.reach.count()];
        self.reach.observe(&mut both);
        for i in 0..self.count() {
            into[4 * i..4 * i + 4].copy_from_slice(&[both[4 * i], both[4 * i + 2], both[4 * i + 1], both[4 * i + 3]]);
        }
    }
    fn step(&mut self, actions: &[f32], into: &mut [f32], rewards: &mut [f32], ends: &mut [u8], last: &mut [f32]) {
        let n = self.reach.count();
        let (mut both_rewards, mut both_ends, mut both_last, mut both_into) = (vec![0.0; n], vec![GOING; n], vec![0.0; 2 * n], vec![0.0; 2 * n]);
        self.reach.step(actions, &mut both_into, &mut both_rewards, &mut both_ends, &mut both_last);
        self.settle();
        for i in 0..self.count() {
            rewards[i] = both_rewards[2 * i] + both_rewards[2 * i + 1];
            ends[i] = both_ends[2 * i];
            last[4 * i..4 * i + 4].copy_from_slice(&[both_last[4 * i], both_last[4 * i + 2], both_last[4 * i + 1], both_last[4 * i + 3]]);
        }
        self.observe(into);
    }
}

fn pair_mirror() -> Mirror {
    Mirror { senses: vec![(1, 1.0), (0, 1.0), (3, 1.0), (2, 1.0)], actions: vec![1, 0] }
}

/// The whole loss an update goes down, as `gradient` reports it: the policy's, the value's weighed,
/// less the entropy bonus.
fn whole_loss(learner: &Learner) -> f64 {
    let set = learner.settings;
    let entropy: f32 = learner.weights[learner.at[4]..].iter().sum();
    learner.report.policy_loss as f64 + set.value_weight as f64 * learner.report.value_loss as f64 - set.entropy_weight as f64 * entropy as f64 + learner.report.symmetry as f64
}

#[test]
fn the_gradient_of_the_whole_loss_is_what_nudging_shows_with_a_mirror_and_memory_or_without() {
    for (mirrored, memory) in [(false, 0), (true, 0), (false, 3), (true, 2)] {
        let settings = Settings { hidden: 8, steps: 8, minibatches: 2, entropy_weight: 0.01, mirror: if mirrored { 1.0 } else { 0.0 }, memory, ..toy() };

        let mut task = Pair::new(8, 11, false);
        let mut learner = Learner::new(settings, 4, 2, 4, 3);
        if mirrored {
            learner.with_mirror(pair_mirror());
        }
        // weights away from where they start, so the policy's means and spreads are not all alike
        let mut random = Random::new(5);
        for w in learner.weights.iter_mut() {
            *w += 0.1 * (2.0 * random.unit() - 1.0);
        }
        learner.begin(&mut task);
        learner.collect(&mut task);
        learner.shuffle();
        learner.gradient(1);
        let grads = learner.grads.clone();
        let h = 1e-2f32;
        let mut worst = 0.0f64;
        for k in (0..learner.weights.len()).step_by(3) {
            let kept = learner.weights[k];
            learner.weights[k] = kept + h;
            learner.gradient(1);
            let up = whole_loss(&learner);
            learner.weights[k] = kept - h;
            learner.gradient(1);
            let down = whole_loss(&learner);
            learner.weights[k] = kept;
            let wanted = (up - down) / (2.0 * h as f64);
            let error = (grads[k] as f64 - wanted).abs();
            worst = worst.max(error);
            assert!(error < 2e-3 + 2e-2 * wanted.abs(), "mirror {mirrored}, memory {memory}, weight {k}: gradient {}, nudging {wanted}", grads[k]);
        }
        std::println!("mirror {mirrored}, memory {memory}: worst error {worst:e}");
    }
}

#[test]
fn a_mirror_teaches_what_was_only_ever_seen_the_other_way_round() {
    // practised with only the first point ever away from its mark, how often the policy moves the
    // second toward its mark when it is the one away
    let learn = |mirrored: bool| {
        let mut task = Pair::new(16, 5, true);
        let mut learner = Learner::new(Settings { mirror: if mirrored { 1.0 } else { 0.0 }, ..toy() }, 4, 2, 8, 1);
        if mirrored {
            learner.with_mirror(pair_mirror());
        }
        learner.begin(&mut task);
        for _ in 0..60 {
            learner.update(&mut task);
        }
        let mut random = Random::new(17);
        let mut right = 0;
        for _ in 0..200 {
            let (at, mark, other) = (2.0 * random.unit() - 1.0, 2.0 * random.unit() - 1.0, 2.0 * random.unit() - 1.0);
            let mut acted = [0.0; 2];
            learner.act(&[other, at, other, mark], &mut acted);
            right += usize::from((acted[1] > 0.0) == (mark > at));
        }
        right as f32 / 200.0
    };
    let (without, with) = (learn(false), learn(true));
    std::println!("the second point moved toward its mark {without} of the time without a mirror, {with} with");
    assert!(with > 0.9 && with > without + 0.2, "{with} with a mirror against {without} without");
}

/// A sign shown once, at the first of five decisions, then hidden: each later decision earns what the
/// action has of the sign (kept within -1 to 1). Only a learner that keeps something can do better than
/// nothing after the first.
struct Recall {
    sign: Vec<f32>,
    step: Vec<u32>,
    random: Random,
}

impl Task for Recall {
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
            let first = self.step[i] == 0;
            into[2 * i] = if first { self.sign[i] } else { 0.0 };
            into[2 * i + 1] = if first { 1.0 } else { 0.0 };
        }
    }
    fn step(&mut self, actions: &[f32], into: &mut [f32], rewards: &mut [f32], ends: &mut [u8], _: &mut [f32]) {
        for i in 0..self.count() {
            rewards[i] = if self.step[i] > 0 { self.sign[i] * actions[i].clamp(-1.0, 1.0) } else { 0.0 };
            self.step[i] += 1;
            ends[i] = GOING;
            if self.step[i] == 5 {
                ends[i] = OVER;
                self.step[i] = 0;
                self.sign[i] = if self.random.unit() < 0.5 { -1.0 } else { 1.0 };
            }
        }
        self.observe(into);
    }
}

#[test]
fn memory_keeps_what_was_seen_once() {
    let learn = |memory: usize| {
        let mut task = Recall { sign: vec![1.0; 16], step: vec![0; 16], random: Random::new(3) };
        let mut learner = Learner::new(Settings { memory, ..toy() }, 2, 1, 16, 1);
        learner.begin(&mut task);
        for _ in 0..80 {
            learner.update(&mut task);
        }
        // acting without drawing, what each later decision earns on average
        let mut earned = 0.0;
        for sign in [-1.0, 1.0] {
            learner.forget();
            let mut action = [0.0];
            learner.act(&[sign, 1.0], &mut action);
            for _ in 0..4 {
                learner.act(&[0.0, 0.0], &mut action);
                earned += sign * action[0] / 8.0;
            }
        }
        earned
    };
    let (without, with) = (learn(0), learn(4));
    std::println!("earned each decision after the sign: {without} without memory, {with} with");
    assert!(without.abs() < 0.2 && with > 0.6, "{with} with memory against {without} without");
}
