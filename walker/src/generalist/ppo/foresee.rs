//! The learner's predictor of what its creatures will see next (`super::super::expect`), and a learner
//! grown to sense more. The predictor's weights are the last of the learner's, so they are kept, sent,
//! averaged between workers and taken back with the rest; it learns by its own squared misses, in the
//! same steps as the policy, over the decisions of each rollout whose next look was in the same run.
//!
//! In a rollout, each decision: once the policy has chosen, each creature guesses what it will see next
//! (`before`); once the world has moved on, it meets what it sees (`after`): its surprise is written into
//! what it senses, and what is above what it is used to is paid, `wonder` a unit, beside the world's
//! reward. A creature whose run has just begun guesses nothing and is surprised by nothing.

use alloc::vec;
use alloc::vec::Vec;

use super::super::expect::{self, Expecting, FEATURES, Foresight, GUESSES, KEPT, WEIGHTS};
use super::super::net::Adam;
use super::super::pool::Pool;
use super::{GOING, Learner, Running};
use crate::learn::Random;

/// What the predictor needs beside its weights.
#[derive(Clone, Debug)]
pub struct Foreseeing {
    pub look: Foresight,
    /// What a unit of surprise above the usual is worth.
    pub wonder: f32,
    /// Where its weights start in the learner's.
    pub at: usize,
    /// Each creature's expectation, and the creature on show's.
    pub expecting: Vec<Expecting>,
    pub show: Expecting,
    /// What was sensed at this decision before it was rescaled; the rollout's inputs to the predictor,
    /// what was then seen, and whether that was in the same run.
    raw: Vec<f32>,
    inputs: Vec<f32>,
    seen: Vec<f32>,
    same: Vec<bool>,
    room: Vec<f32>,
    /// Over the last rollout: the surprise met, what was paid for it, and how many looks.
    pub surprised: f32,
    pub paid: f32,
    pub looks: u32,
    /// The squared misses of the last minibatch it learned from, for each ray's guess.
    pub missed: f32,
}

impl Learner {
    /// This learner with a predictor of what its creatures will see next, found where `look` says, its
    /// surprise above the usual paid `wonder` a unit. Its weights are added at the end, drawn afresh.
    pub fn foreseeing(mut self, look: Foresight, wonder: f32) -> Learner {
        if self.foresee.is_some() {
            return self;
        }
        let at = self.weights.len();
        self.weights.resize(at + WEIGHTS, 0.0);
        expect::first(&mut self.weights[at..], &mut Random::new(0x6578_7065_6374_0000));
        self.grads.resize(at + WEIGHTS, 0.0);
        let mut adam = Adam::new(at + WEIGHTS);
        adam.mean[..at].copy_from_slice(&self.adam.mean);
        adam.square[..at].copy_from_slice(&self.adam.square);
        adam.restart_at(self.adam.steps);
        self.adam = adam;
        let samples = self.samples();
        self.foresee = Some(alloc::boxed::Box::new(Foreseeing {
            look,
            wonder,
            at,
            expecting: vec![Expecting::default(); self.count],
            show: Expecting::default(),
            raw: vec![0.0; self.count * self.senses],
            inputs: vec![0.0; samples * FEATURES],
            seen: vec![0.0; samples * GUESSES],
            same: vec![false; samples],
            room: vec![0.0; FEATURES],
            surprised: 0.0,
            paid: 0.0,
            looks: 0,
            missed: 0.0,
        }));
        self
    }

    /// Before a decision's senses are rescaled: keeps them as they were, for the predictor.
    pub(super) fn foresee_keep(&mut self) {
        if let Some(f) = &mut self.foresee {
            f.raw.copy_from_slice(&self.now);
        }
    }

    /// Once the policy has chosen at decision `t`: each creature's guess of what it will see next.
    pub(super) fn foresee_before(&mut self, t: usize) {
        let Some(mut f) = self.foresee.take() else { return };
        let (n, s, a) = (self.count, self.senses, self.actions);
        let weights = &self.weights[f.at..f.at + WEIGHTS];
        for i in 0..n {
            let k = t * n + i;
            let inputs = &mut f.inputs[k * FEATURES..(k + 1) * FEATURES];
            expect::features(&f.look, &f.raw[i * s..(i + 1) * s], &self.actions_now[i * a..(i + 1) * a], inputs);
            expect::predict(weights, inputs, &mut f.expecting[i].guesses, None);
            f.expecting[i].ready = true;
        }
        self.foresee = Some(f);
    }

    /// Once the world has moved on from decision `t`: each creature meets what it sees, its surprise is
    /// written into what it senses and what is above the usual paid into its reward. A creature whose
    /// run ended starts afresh.
    pub(super) fn foresee_after(&mut self, t: usize) {
        let Some(mut f) = self.foresee.take() else { return };
        let (n, s) = (self.count, self.senses);
        if t == 0 {
            (f.surprised, f.paid, f.looks) = (0.0, 0.0, 0);
        }
        for i in 0..n {
            let k = t * n + i;
            let now = &mut self.now[i * s..(i + 1) * s];
            if self.step_ends[i] != GOING {
                f.expecting[i] = Expecting::default();
                f.same[k] = false;
                now[f.look.surprise] = 0.0;
                continue;
            }
            expect::seen(now, &mut f.seen[k * GUESSES..(k + 1) * GUESSES]);
            f.same[k] = true;
            let (surprised, worth) = f.expecting[i].meet(now);
            now[f.look.surprise] = surprised;
            self.step_rewards[i] += f.wonder * worth;
            f.surprised += surprised;
            f.paid += f.wonder * worth;
            f.looks += 1;
        }
        self.foresee = Some(f);
    }

    /// The slope of the predictor's misses over part `which` of `parts` of the rollout's decisions, added
    /// into `grads`.
    pub(super) fn foresee_gradient(&mut self, which: usize, parts: usize) {
        let Some(f) = self.foresee.take() else { return };
        let samples = self.samples();
        let each = samples / parts.max(1);
        let range = which * each..((which + 1) * each).min(samples);
        let same = range.clone().filter(|&k| f.same[k]).count();
        let mut missed = 0.0;
        if same > 0 {
            let scale = 1.0 / (same * super::super::eyes::RAYS) as f32;
            let (weights, grads) = (&self.weights[f.at..f.at + WEIGHTS], &mut self.grads[f.at..f.at + WEIGHTS]);
            for k in range.filter(|&k| f.same[k]) {
                missed += expect::learn(weights, &f.inputs[k * FEATURES..(k + 1) * FEATURES], &f.seen[k * GUESSES..(k + 1) * GUESSES], scale, grads);
            }
            missed *= scale;
        }
        let mut f = f;
        f.missed = missed;
        self.foresee = Some(f);
    }

    /// For one creature acting alone (the show, or one of several in `act_as`): meets what it senses,
    /// writing its surprise in; then, once `act` has chosen, guesses what comes next. `senses` is the raw
    /// list, changed in place.
    pub(super) fn foresee_meet(&mut self, senses: &mut [f32]) {
        if let Some(f) = &mut self.foresee {
            let (surprised, _) = f.show.meet(senses);
            senses[f.look.surprise] = surprised;
        }
    }

    pub(super) fn foresee_guess(&mut self, senses: &[f32], actions: &[f32]) {
        if let Some(f) = &mut self.foresee {
            let weights = &self.weights[f.at..f.at + WEIGHTS];
            let mut room = core::mem::take(&mut f.room);
            f.show.guess(weights, &f.look, senses, actions, &mut room);
            f.room = room;
        }
    }

    /// How many numbers a creature's expectation is kept in, for `act_as`: none without a predictor.
    pub(super) fn foresee_kept(&self) -> usize {
        if self.foresee.is_some() { KEPT } else { 0 }
    }

    /// The creature on show's last surprise, and the level it is used to.
    pub fn surprise(&self) -> (f32, f32) {
        self.foresee.as_ref().map_or((0.0, 0.0), |f| (f.show.last, f.show.usual))
    }

    /// This learner grown to sense `senses` numbers, more than it does, the new ones last (as stage 4's
    /// senses of a changing world come after touch): every weight it had kept, and Adam's averages with
    /// it; the weights reading a new sense start at nothing, so it acts as it did; a new sense is
    /// rescaled as if it had been seen with a mean of 0 and a spread of 1 until it is seen. None if it
    /// would sense fewer.
    pub fn grown(&self, senses: usize, feelings: &[usize]) -> Option<Learner> {
        let old = self.senses;
        if senses < old {
            return None;
        }
        let s = self.settings;
        let added = senses - old;
        let pool = self.pool().map(|pool| Pool::from_form(&pool.form(), senses, s.hidden)).map(|pool| pool.expect("a pool's own form holds together"));
        let mut learner = Learner::with(s, senses, self.actions, self.count, 0, feelings, pool);
        // the new learner's weights, from the old by inserting rows for the new senses where a layer reads them
        let h = s.hidden;
        let mut from: Vec<Option<usize>> = Vec::with_capacity(learner.weights.len());
        let copy = |from: &mut Vec<Option<usize>>, start: usize, length: usize| from.extend((start..start + length).map(Some));
        // the policy's first layer: the old senses' rows, nothing for the new, then its biases, the rest of
        // its trunk and its head as they were
        copy(&mut from, 0, old * h);
        from.extend(core::iter::repeat_n(None, added * h));
        copy(&mut from, old * h, self.at[2] - old * h);
        // the value's first layer reads the senses first too, if it has layers of its own
        if self.value_trunk.is_some() {
            copy(&mut from, self.at[2], old * h);
            from.extend(core::iter::repeat_n(None, added * h));
            copy(&mut from, self.at[2] + old * h, self.weights.len() - self.at[2] - old * h);
        } else {
            copy(&mut from, self.at[2], self.weights.len() - self.at[2]);
        }
        let carried = self.foresee.as_ref().map_or(0, |_| WEIGHTS);
        if from.len() != learner.weights.len() + carried {
            return None;
        }
        from.truncate(learner.weights.len());
        for (k, f) in from.iter().enumerate() {
            let (w, mean, square) = f.map_or((0.0, 0.0, 0.0), |old| (self.weights[old], self.adam.mean[old], self.adam.square[old]));
            learner.weights[k] = w;
            learner.adam.mean[k] = mean;
            learner.adam.square[k] = square;
        }
        learner.adam.restart_at(self.adam.steps);
        if let Some(f) = &self.foresee {
            let mut look = f.look;
            look.surprise += added;
            learner = learner.foreseeing(look, f.wonder);
            let at = learner.foresee.as_ref().map_or(0, |g| g.at);
            learner.weights[at..at + WEIGHTS].copy_from_slice(&self.weights[f.at..f.at + WEIGHTS]);
            learner.adam.mean[at..at + WEIGHTS].copy_from_slice(&self.adam.mean[f.at..f.at + WEIGHTS]);
            learner.adam.square[at..at + WEIGHTS].copy_from_slice(&self.adam.square[f.at..f.at + WEIGHTS]);
        }
        learner.updates = self.updates;
        learner.practised = self.practised;
        learner.decisions = self.decisions;
        learner.sensed = grown_running(&self.sensed, added);
        learner.returned = self.returned.clone();
        learner.settle();
        Some(learner)
    }
}

/// Running numbers of more senses than these, the new ones as if seen with a mean of 0 and a spread of 1.
fn grown_running(running: &Running, added: usize) -> Running {
    let mut grown = running.clone();
    grown.mean.extend(core::iter::repeat_n(0.0, added));
    grown.squares.extend(core::iter::repeat_n(running.count, added));
    grown
}
