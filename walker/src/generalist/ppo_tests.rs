//! What learning by practice is held to before it ever meets the world: on a task of a few lines (a
//! point on a line that must reach a mark it is shown, the mark moved each run) it learns to go
//! straight there; advantages are worked out as by hand; merged running numbers are the numbers of
//! all of it; and the same seed learns the same way to the bit.

use alloc::vec;
use alloc::vec::Vec;

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
