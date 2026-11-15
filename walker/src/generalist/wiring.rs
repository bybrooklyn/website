//! A brain that adds and cuts its own connections while it lives (stage 5 of the plan, the risky bet).
//!
//! The pool keeps its neurons; what changes is which connections into its memory neurons exist. Each
//! memory neuron has `Shape::reads` places a connection may be, and practice trains a weight for every
//! place, as before. During a run each place either holds a connection or does not, and a rule of
//! `NUMBERS` numbers decides, every `PERIOD` decisions, where one is added and which is cut:
//!
//! - every place keeps a trace of what passes there: for a connection, how much it carries (its
//!   weight times what it reads); for an empty place, how much the two neurons it would join are
//!   active together (what it would read times what the neuron takes in);
//! - each memory neuron adds the empty place whose trace is greatest, if it is over the rule's
//!   threshold for growing, and cuts the connection whose trace is least, if it is under the threshold
//!   for cutting;
//! - surprise and having just eaten make it change more (growing comes easier and cutting sooner), each
//!   by as much as the rule says, or less, or not at all;
//! - short of energy it grows less and cuts more, so a hungry brain thins and costs less.
//!
//! Every connection costs energy each second (`Growth::price`, as a share of what being awake costs,
//! for the whole of them), taken from the body's own energy, which food restores. Nothing more is done
//! to it: a brain short of energy keeps fewer connections, and the creature tires and rests as it
//! always has. It never starves or dies of it.
//!
//! The rule is not learned by practice. Its numbers are found by evolution (`examples/rule.rs`), each
//! candidate rule given to a learner practising from scratch, while practice trains the weights. What
//! a connection does is never blamed on the rule: learning back through a window takes the connections
//! as they were, and a weight at an empty place learns nothing while it is empty.
//!
//! Its state, after the pool's own, for each creature: whether each place holds a connection (1 or 0),
//! each place's trace, and the decisions since the run began.

use crate::math::clamp;

/// How many numbers a rule has.
pub const NUMBERS: usize = 7;
/// How many decisions apart the rule acts, about half a second, and how many decisions a run waits
/// before it first does, so the traces have something in them.
pub const PERIOD: u32 = 8;
pub const WARM: u32 = 16;
/// The surprise taken as one unit when the rule reads it: about a usual surprise a look.
const SURPRISE_UNIT: f32 = 0.02;
/// How far surprise and eating may make it change: by e to the power of up to this, either way.
const LIVELY_REACH: f32 = 3.0;
/// Below this energy it counts as short of it (`needs::TIRED`, where its muscles start to weaken).
const SHORT: f32 = super::needs::TIRED;

/// A rule for adding and cutting connections, as its numbers: how long a trace keeps (a sigmoid of the
/// share kept each decision), the threshold for growing and for cutting (logarithms), how much surprise
/// and having just eaten make it change, how much more it thins short of energy (a logarithm), and the
/// share of places that hold a connection when a run begins (a sigmoid).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rule {
    pub numbers: [f32; NUMBERS],
}

impl Rule {
    /// The rule a candidate starts from before evolution: traces kept 0.9 a decision (about two thirds
    /// of a second), growing over a trace of 0.3, cutting under 0.05, surprise and eating ignored, short
    /// of energy four times as ready to cut, half the places joined at birth.
    pub const FIRST: Rule = Rule { numbers: [2.2, -1.2, -3.0, 0.0, 0.0, 1.4, 0.0] };

    /// The rule the page carries, found by evolution in the trials (walker/README.md, "The risky bet"):
    /// the mean of the best half after eight generations of eight. Traces kept 0.84 a decision, growing
    /// over a trace of 0.14, cutting under 0.026, a little readier to change when surprised and a little
    /// less just after eating, short of energy about three times as ready to cut, half the places joined
    /// at birth. Seven numbers are all that is shipped of it.
    pub const FOUND: Rule = Rule { numbers: [1.645, -1.993, -3.639, 0.198, -0.371, 1.178, 0.066] };

    fn sigmoid(x: f32) -> f32 {
        1.0 / (1.0 + exp(-x))
    }

    /// The share of a trace kept each decision.
    pub fn keep(&self) -> f32 {
        Rule::sigmoid(self.numbers[0])
    }

    /// How many of `places` hold a connection when a run begins: at least one.
    pub fn born(&self, places: usize) -> usize {
        let share = Rule::sigmoid(self.numbers[6]);
        ((share * places as f32 + 0.5) as usize).clamp(1, places.max(1))
    }

    /// The thresholds for growing and for cutting now, from the creature's energy, how recently it ate
    /// (1 the step it eats, fading) and its surprise.
    pub fn thresholds(&self, energy: f32, ate: f32, surprise: f32) -> (f32, f32) {
        let n = &self.numbers;
        let lively = exp(clamp(n[3] * surprise / SURPRISE_UNIT + n[4] * ate, -LIVELY_REACH, LIVELY_REACH));
        let short = 1.0 + exp(n[5]) * clamp((SHORT - energy) / SHORT, 0.0, 1.0);
        (exp(n[1]) * short / lively, exp(n[2]) * short * lively)
    }
}

/// e to the power of `x`, kept in one place in the module rather than written out at every use, which
/// costs the page's module more than the few calls cost in time.
#[inline(never)]
fn exp(x: f32) -> f32 {
    crate::math::exp(x)
}

/// A pool's growth: its rule, what a connection costs, and where among the senses it finds its energy,
/// whether it has just eaten and its surprise, which it reads as they were sensed, before rescaling.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Growth {
    pub rule: Rule,
    /// What every connection there could be costs together, each second, as a share of what being
    /// awake costs (`needs::AWAKE`); a brain with half its places joined costs half that.
    pub price: f32,
    pub signals: [usize; 3],
}

/// What a learner is told to grow by (`ppo::Settings::grow`): its rule and price. Where it finds its
/// signals is the learner's to know (from its predictor of what it will see).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Grow {
    pub rule: Rule,
    pub price: f32,
}

impl Grow {
    /// The page's: the rule found, and a whole brain costing as much as being awake.
    pub const PAGE: Grow = Grow { rule: Rule::FOUND, price: 1.0 };
}

impl Growth {
    /// How many numbers it keeps for each creature beside the pool's own, for `memory` neurons of
    /// `places` places each.
    pub fn state(memory: usize, places: usize) -> usize {
        2 * memory * places + 1
    }

    /// A run's start, in its part of a creature's state: each memory neuron with the rule's share of its
    /// places joined (each neuron starting at a place of its own, so they are not all alike), every trace
    /// empty, no decisions yet.
    pub fn fresh(&self, memory: usize, places: usize, state: &mut [f32]) {
        let born = self.rule.born(places);
        let (joined, rest) = state.split_at_mut(memory * places);
        for i in 0..memory {
            for n in 0..places {
                joined[i * places + n] = if (n + places - i % places) % places < born { 1.0 } else { 0.0 };
            }
        }
        rest.fill(0.0);
    }

    /// The signals a creature's rule reads, from what it sensed before rescaling: its energy, how
    /// recently it ate, and its surprise.
    pub fn signals_of(&self, sensed: &[f32], into: &mut [f32]) {
        for (into, &k) in into.iter_mut().zip(&self.signals) {
            *into = sensed.get(k).copied().unwrap_or(0.0);
        }
    }

    /// Each place's trace moves on by what passed there at this decision (`passing`, for every place).
    pub fn trace(&self, traces: &mut [f32], passing: &[f32]) {
        let keep = self.rule.keep();
        for (trace, &passed) in traces.iter_mut().zip(passing) {
            *trace = keep * *trace + (1.0 - keep) * passed;
        }
    }

    /// One memory neuron's places, when the rule acts: the empty place of the greatest trace is joined if
    /// that trace is over the threshold for growing, and the connection of the least trace is cut if
    /// under the threshold for cutting. Returns how many were added and cut.
    pub fn rewire(&self, joined: &mut [f32], traces: &[f32], thresholds: (f32, f32)) -> (u32, u32) {
        let (grow_at, cut_at) = thresholds;
        let (mut best, mut worst): (Option<usize>, Option<usize>) = (None, None);
        for (n, (&j, &trace)) in joined.iter().zip(traces).enumerate() {
            if j > 0.5 {
                if worst.is_none_or(|w| trace < traces[w]) {
                    worst = Some(n);
                }
            } else if best.is_none_or(|b| trace > traces[b]) {
                best = Some(n);
            }
        }
        let added = best.filter(|&b| traces[b] > grow_at);
        let cut = worst.filter(|&w| traces[w] < cut_at);
        if let Some(b) = added {
            joined[b] = 1.0;
        }
        if let Some(w) = cut {
            joined[w] = 0.0;
        }
        (u32::from(added.is_some()), u32::from(cut.is_some()))
    }

    /// What its connections cost each second now, as a share of all its energy, with `joined` of
    /// `places` places holding one.
    pub fn cost(&self, joined: usize, places: usize) -> f32 {
        self.price * super::needs::AWAKE * joined as f32 / places.max(1) as f32
    }
}

/// How many places of a creature's growth state hold a connection, of `memory * places`.
pub fn joined(state: &[f32], memory: usize, places: usize) -> usize {
    state[..memory * places].iter().filter(|&&j| j > 0.5).count()
}
