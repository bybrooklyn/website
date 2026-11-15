//! A reason to look: a small predictor of what the creature will see next, inside its brain, learned by
//! practice beside the policy, and its surprise, how wrong the prediction was (stage 4 of the plan).
//!
//! At each decision it guesses, for each of its sixteen rays, how near what that ray meets will be at the
//! next decision and whether it will be food, from what that ray and its two neighbours see now, how far
//! its eye is about to turn (from the action it has just chosen), where its eye looks, how fast its body
//! goes, and where in the fan the ray is. One small network of `WEIGHTS` numbers serves every ray, as an
//! eye's cells share their wiring: 9 inputs, 4 hidden neurons, 2 outputs. Its surprise is the mean over
//! the rays of how far off each guess was, squared. Walking on, or turning its eye where it chose, it
//! soon learns to see coming; food landing, a box dropped, the light going, it does not.
//!
//! Surprise does two things. It is a sense, the last of what it senses of a changing world, which the
//! brain's moods read among the first (`practice::feelings`). And it is paid, a little, as a reason to
//! look (`Expecting::meet`): but only for surprise above what it has lately been used to, a level that
//! rises quickly while it keeps being surprised and falls slowly after. So staring at something it cannot
//! learn to predict pays once and then nothing: the level catches up within about a second, and a creature
//! that looks away and back again finds it still raised. Surprise it can learn away pays less and less as
//! the predictor learns it.

use super::eyes::{FAN_DEGREES, GAZE_SPEED, PER_RAY, RAYS, gaze_wanted};
use crate::math::{PI, clamp, tanh};
use crate::physics::STEP;

/// The predictor's inputs for each ray, its hidden neurons, its outputs, and all its weights.
pub const INPUTS: usize = 9;
pub const HIDDEN: usize = 4;
pub const OUTPUTS: usize = 2;
pub const WEIGHTS: usize = INPUTS * HIDDEN + HIDDEN + HIDDEN * OUTPUTS + OUTPUTS;
/// Its inputs and its guesses for all the rays of one decision.
pub const FEATURES: usize = RAYS * INPUTS;
pub const GUESSES: usize = RAYS * OUTPUTS;
/// How many numbers a creature's expectation is kept in (`Expecting::write`).
pub const KEPT: usize = GUESSES + 3;

/// How quickly the level of surprise it is used to rises toward a greater surprise, and falls toward a
/// lesser, each decision; and how much more than that level a surprise must be before it pays.
const RISE: f32 = 0.3;
const FALL: f32 = 0.02;
const MARGIN: f32 = 0.005;
/// The most surprise is sensed or paid as.
pub const MOST: f32 = 1.0;

/// Where the predictor finds what it needs: the sense of where the eye looks (over pi), of the body's
/// speed forward (up is the next), where it writes its surprise among the senses, the action that says
/// where to look, and how many steps of the physics a decision holds for.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Foresight {
    pub gaze: usize,
    pub speed: usize,
    pub surprise: usize,
    pub turn: usize,
    pub skip: u32,
}

/// The predictor's inputs for every ray, from what is sensed now (raw, as the body gives it) and the
/// action chosen, into `into` (`FEATURES` long).
pub fn features(look: &Foresight, senses: &[f32], actions: &[f32], into: &mut [f32]) {
    let gaze = senses[look.gaze] * PI;
    let most = GAZE_SPEED * STEP * look.skip.max(1) as f32;
    let turn = clamp(gaze_wanted(actions[look.turn]) - gaze, -most, most) / most;
    let (forward, up) = (senses[look.speed], senses[look.speed + 1]);
    let near = |k: usize| senses[k * PER_RAY];
    for k in 0..RAYS {
        let row = &mut into[k * INPUTS..(k + 1) * INPUTS];
        row[0] = near(k);
        row[1] = near(k.saturating_sub(1));
        row[2] = near((k + 1).min(RAYS - 1));
        row[3] = senses[k * PER_RAY + PER_RAY - 1];
        row[4] = turn;
        row[5] = gaze / PI;
        row[6] = forward;
        row[7] = up;
        row[8] = FAN_DEGREES[k] / 90.0;
    }
}

/// What it will see next, by ray: how near and whether food, from these weights and inputs (`FEATURES`
/// long), into `guesses` (`GUESSES` long); and each ray's hidden neurons into `hidden`, if given, for
/// learning.
pub fn predict(weights: &[f32], features: &[f32], guesses: &mut [f32], mut hidden: Option<&mut [f32]>) {
    let (first, rest) = weights.split_at(INPUTS * HIDDEN);
    let (bias, rest) = rest.split_at(HIDDEN);
    let (second, out_bias) = rest.split_at(HIDDEN * OUTPUTS);
    for k in 0..RAYS {
        let x = &features[k * INPUTS..(k + 1) * INPUTS];
        let mut h = [0.0f32; HIDDEN];
        for (j, h) in h.iter_mut().enumerate() {
            let mut sum = bias[j];
            for (i, &xi) in x.iter().enumerate() {
                sum += first[i * HIDDEN + j] * xi;
            }
            *h = tanh(sum);
        }
        for o in 0..OUTPUTS {
            let mut sum = out_bias[o];
            for (j, &hj) in h.iter().enumerate() {
                sum += second[j * OUTPUTS + o] * hj;
            }
            guesses[k * OUTPUTS + o] = sum;
        }
        if let Some(hidden) = hidden.as_deref_mut() {
            hidden[k * HIDDEN..(k + 1) * HIDDEN].copy_from_slice(&h);
        }
    }
}

/// What it actually saw, by ray, as the predictor guesses it: how near and whether food, into `into`.
pub fn seen(senses: &[f32], into: &mut [f32]) {
    for k in 0..RAYS {
        into[k * OUTPUTS] = senses[k * PER_RAY];
        into[k * OUTPUTS + 1] = senses[k * PER_RAY + PER_RAY - 1];
    }
}

/// How wrong the guesses were about what was seen: the mean over the rays of the squared misses.
pub fn surprise(guesses: &[f32], seen: &[f32]) -> f32 {
    guesses.iter().zip(seen).map(|(g, s)| (g - s) * (g - s)).sum::<f32>() / RAYS as f32
}

/// The slope of the squared misses of one decision, against every weight, added into `grads`; `scale`
/// each. Gives the misses' sum.
pub fn learn(weights: &[f32], features: &[f32], seen: &[f32], scale: f32, grads: &mut [f32]) -> f32 {
    let mut guesses = [0.0f32; GUESSES];
    let mut hidden = [0.0f32; RAYS * HIDDEN];
    predict(weights, features, &mut guesses, Some(&mut hidden));
    let second = &weights[INPUTS * HIDDEN + HIDDEN..INPUTS * HIDDEN + HIDDEN + HIDDEN * OUTPUTS];
    let (first_g, rest) = grads.split_at_mut(INPUTS * HIDDEN);
    let (bias_g, rest) = rest.split_at_mut(HIDDEN);
    let (second_g, out_bias_g) = rest.split_at_mut(HIDDEN * OUTPUTS);
    let mut missed = 0.0;
    for k in 0..RAYS {
        let x = &features[k * INPUTS..(k + 1) * INPUTS];
        let h = &hidden[k * HIDDEN..(k + 1) * HIDDEN];
        let mut blame_h = [0.0f32; HIDDEN];
        for o in 0..OUTPUTS {
            let miss = guesses[k * OUTPUTS + o] - seen[k * OUTPUTS + o];
            missed += miss * miss;
            let d = 2.0 * miss * scale;
            out_bias_g[o] += d;
            for j in 0..HIDDEN {
                second_g[j * OUTPUTS + o] += d * h[j];
                blame_h[j] += d * second[j * OUTPUTS + o];
            }
        }
        for j in 0..HIDDEN {
            let d = blame_h[j] * (1.0 - h[j] * h[j]);
            bias_g[j] += d;
            for (i, &xi) in x.iter().enumerate() {
                first_g[i * HIDDEN + j] += d * xi;
            }
        }
    }
    missed
}

/// First weights: small, drawn from `random`, with every output starting at nothing.
pub fn first(weights: &mut [f32], random: &mut crate::learn::Random) {
    let reach = 1.0 / crate::math::sqrt(INPUTS as f32);
    for w in &mut weights[..INPUTS * HIDDEN] {
        *w = reach * (2.0 * random.unit() - 1.0);
    }
    weights[INPUTS * HIDDEN..].fill(0.0);
    let second = INPUTS * HIDDEN + HIDDEN;
    for w in &mut weights[second..second + HIDDEN * OUTPUTS] {
        *w = 0.1 * (2.0 * random.unit() - 1.0);
    }
}

/// One creature's expectation: what it guessed it would see, whether it has guessed yet in this run,
/// the level of surprise it is used to, and its last surprise.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Expecting {
    pub guesses: [f32; GUESSES],
    pub ready: bool,
    pub usual: f32,
    pub last: f32,
}

impl Default for Expecting {
    fn default() -> Expecting {
        Expecting { guesses: [0.0; GUESSES], ready: false, usual: 0.0, last: 0.0 }
    }
}

impl Expecting {
    /// Meets what it now senses: how surprised it is, and what that is worth as a reason to look (only
    /// what is above the level it is used to). Nothing at a run's first look.
    pub fn meet(&mut self, senses: &[f32]) -> (f32, f32) {
        if !self.ready {
            self.last = 0.0;
            return (0.0, 0.0);
        }
        let mut now = [0.0f32; GUESSES];
        seen(senses, &mut now);
        let surprised = surprise(&self.guesses, &now).min(MOST);
        let worth = (surprised - self.usual - MARGIN).max(0.0);
        self.usual += (surprised - self.usual) * if surprised > self.usual { RISE } else { FALL };
        self.last = surprised;
        (surprised, worth)
    }

    /// Guesses what it will see next, from what it senses now and the action chosen.
    pub fn guess(&mut self, weights: &[f32], look: &Foresight, senses: &[f32], actions: &[f32], features_room: &mut [f32]) {
        features(look, senses, actions, features_room);
        predict(weights, features_room, &mut self.guesses, None);
        self.ready = true;
    }

    /// Written as `KEPT` numbers, and read back.
    pub fn write(&self, into: &mut [f32]) {
        into[..GUESSES].copy_from_slice(&self.guesses);
        into[GUESSES] = if self.ready { 1.0 } else { 0.0 };
        into[GUESSES + 1] = self.usual;
        into[GUESSES + 2] = self.last;
    }

    pub fn read(from: &[f32]) -> Expecting {
        let mut guesses = [0.0; GUESSES];
        guesses.copy_from_slice(&from[..GUESSES]);
        Expecting { guesses, ready: from[GUESSES] != 0.0, usual: from[GUESSES + 1], last: from[GUESSES + 2] }
    }
}
