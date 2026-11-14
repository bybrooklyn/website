//! Whether being touched changes what a practised creature does, and whether it helps it: one learner,
//! practised from a seed (or a learner the page kept), walks held-out worlds; at a moment in each, one
//! copy of its run is touched (lifted by its body and let go, lifted and set down, nudged, a box slid
//! into it, a box dropped near it) and one is not. A third copy is touched the same way but its touch
//! senses are replaced by what the untouched copy felt then, so its brain is moved by what the touch did
//! to its body alone and not by feeling it.
//!
//!     cargo run --release --example touched -- legs=2 seed=1 steps=20000000
//!     cargo run --release --example touched -- legs=2 seed=1 steps=20000000 visitor=0
//!     cargo run --release --example touched -- legs=2 kept=/path/to/learner
//!
//! For each kind of touch it prints, over every world and moment: how far its actions over the second
//! after the touch ends are from the untouched copy's (the mean size of the difference, each action from
//! -1 to 1), and from the numb copy's, then the same while it is held; and the share of runs that end in
//! a fall within three seconds of the touch ending, touched, numb and untouched. `difficulty=`,
//! `amounts=a,b,c,d` and any `Way` setting that `compare.rs` takes for touch (`visitor=`, `touch=`) set
//! how it practises.

use std::rc::Rc;

use walker::generalist::envs::{End, Run};
use walker::generalist::land::Land;
use walker::generalist::ppo::{Learner, Settings};
use walker::generalist::practice::{Practice, Way, held_out, shaped};
use walker::generalist::recipe::Recipe;
use walker::generalist::touch;
use walker::math::Vec2;

#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    Lift,
    SetDown,
    Nudge,
    Shove,
    Drop,
}

/// How long each touch lasts, in steps of the physics.
fn lasts(kind: Kind) -> u32 {
    match kind {
        Kind::Lift => 60,
        Kind::SetDown => 72,
        Kind::Nudge => 18,
        Kind::Shove => 90,
        Kind::Drop => 1,
    }
}

/// A creature walking one world with a policy: the run, the actions it holds, and its senses.
#[derive(Clone)]
struct Walk {
    run: Run,
    held: Vec<f32>,
    senses: Vec<f32>,
    fell_at: Option<u32>,
}

impl Walk {
    fn new(recipe: Recipe, way: Way, seed: u32) -> Walk {
        let mut run = Run::new(Rc::new(Land::new(Recipe { seed, ..recipe }, 30.0)), way.legs, 60.0).unwrap();
        way.dress_run(&mut run);
        let mut senses = vec![0.0; run.senses()];
        run.sense(&mut senses);
        Walk { held: vec![0.0; run.body.actions()], senses, run, fell_at: None }
    }

    /// One step: decides first if it is time (with `felt`, its touch senses, replaced if given), then
    /// steps. Returns the actions it decided on, if it decided.
    fn step(&mut self, way: Way, learner: &mut Learner, felt: Option<&[f32]>) -> Option<Vec<f32>> {
        let mut decided = None;
        if self.run.stage.world.steps % way.skip == 0 {
            if let Some(felt) = felt {
                let at = self.senses.len() - felt.len();
                self.senses[at..].copy_from_slice(felt);
            }
            let mut asked = vec![0.0; self.held.len()];
            learner.act(&self.senses, &mut asked);
            way.hold(&asked, &mut self.held);
            decided = Some(self.held.clone());
        }
        if !self.run.judge.over() {
            self.run.before_step(&self.held);
            self.run.stage.world.step();
            self.run.after_step();
            shaped(&mut self.run, way.shaping, &self.held);
            if self.fell_at.is_none() && matches!(self.run.judge.end, End::Down | End::Fell | End::Hazard) {
                self.fell_at = Some(self.run.stage.world.steps);
            }
        }
        self.run.sense(&mut self.senses);
        decided
    }

    fn felt(&self) -> Vec<f32> {
        let count = touch::felt(self.run.body.legs());
        self.senses[self.senses.len() - count..].to_vec()
    }

    /// Starts a touch of this kind; false if there is no room for it here (a box needs level ground).
    fn touch(&mut self, kind: Kind) -> bool {
        let creature = self.run.body.creature.clone();
        let torso = self.run.stage.world.bodies[creature.torso as usize].position;
        let world = &mut self.run.stage.world;
        let hold = |world: &mut walker::physics::World, body: u32, at: Vec2, goal: Vec2, fastest: f32| {
            world.hold(body, at, touch::STIFFNESS, touch::DAMPING, touch::MOST_FORCE, fastest);
            world.hand.as_mut().unwrap().goal = goal;
        };
        match kind {
            Kind::Lift => hold(world, creature.torso, torso, torso + Vec2::new(0.0, 0.6), touch::FASTEST),
            Kind::SetDown => hold(world, creature.torso, torso, torso + Vec2::new(0.0, 0.3), touch::FASTEST),
            // a push back, against the way it goes
            Kind::Nudge => hold(world, creature.torso, torso, torso + Vec2::new(-0.45, 0.05), touch::FASTEST),
            Kind::Shove | Kind::Drop => {
                let x = torso.x + if kind == Kind::Shove { 1.3 } else { 0.9 };
                let half = 0.16;
                let Some(ground) = world.ground_height(x) else { return false };
                if world.ground_height(x - half).is_none_or(|g| (g - ground).abs() > 0.05) || world.ground_height(x + half).is_none_or(|g| (g - ground).abs() > 0.05) {
                    return false;
                }
                let at = Vec2::new(x, ground + half + 0.01 + if kind == Kind::Drop { 1.0 } else { 0.0 });
                if world.bodies.iter().any(|body| body.distance_to(at) < half * 1.5) {
                    return false;
                }
                let body = self.run.stage.place_box(at, half);
                if kind == Kind::Shove {
                    hold(&mut self.run.stage.world, body, at, Vec2::new(torso.x - 0.6, at.y), 1.0);
                }
            }
        }
        true
    }

    /// Goes on with a touch, `along` steps into it: a set-down lowers it toward the ground over its last
    /// part; at its end the hand lets go.
    fn touching(&mut self, kind: Kind, along: u32) {
        let world = &mut self.run.stage.world;
        if along + 1 >= lasts(kind) {
            world.let_go(touch::THROW);
            return;
        }
        if kind == Kind::SetDown && along > 36 {
            let torso = world.bodies[self.run.body.creature.torso as usize].position;
            if let (Some(ground), Some(hand)) = (world.ground_height(torso.x), world.hand.as_mut()) {
                hand.goal = Vec2::new(hand.goal.x, ground + self.run.body.creature.stand + 0.08);
            }
        }
    }
}

fn difference(a: &[Vec<f32>], b: &[Vec<f32>]) -> f32 {
    let (mut total, mut count) = (0.0, 0);
    for (x, y) in a.iter().zip(b) {
        for (p, q) in x.iter().zip(y) {
            total += (p - q).abs();
            count += 1;
        }
    }
    total / count.max(1) as f32
}

fn main() {
    let (mut legs, mut seed, mut budget, mut difficulty) = (2u32, 1u64, 20_000_000u64, 0.2f32);
    let mut amounts = [0.6f32, 0.4, 0.4, 0.4];
    let mut kept: Option<String> = None;
    let mut settings: Vec<(String, f32)> = Vec::new();
    for arg in std::env::args().skip(1) {
        let Some((name, value)) = arg.split_once('=') else { continue };
        match name {
            "legs" => legs = value.parse().unwrap(),
            "seed" => seed = value.parse().unwrap(),
            "steps" => budget = value.parse().unwrap(),
            "difficulty" => difficulty = value.parse().unwrap(),
            "amounts" => amounts = value.split(',').map(|n| n.parse().unwrap()).collect::<Vec<f32>>().try_into().unwrap(),
            "kept" => kept = Some(value.to_string()),
            _ => settings.push((name.to_string(), value.parse().unwrap())),
        }
    }
    let mut way = Way::of(legs);
    for (name, value) in &settings {
        match name.as_str() {
            "visitor" => way.visitor = *value,
            "touch" => way.touch = *value != 0.0,
            _ => panic!("no setting called {name}"),
        }
    }
    let recipe = Recipe { seed: 1, difficulty, amounts };
    let mut practice = Practice::new(recipe, way, Settings::default(), 32, seed, seed as u32).unwrap();
    if let Some(path) = &kept {
        let read = |path: &str| -> Vec<f64> { std::fs::read_to_string(path).unwrap().split_whitespace().map(|n| n.parse().unwrap()).collect() };
        let state: Vec<f32> = read(&format!("{path}.state")).iter().map(|&n| n as f32).collect();
        assert!(practice.load(&state, &read(&format!("{path}.running"))), "the kept learner does not fit");
    } else {
        while practice.worlds.steps < budget {
            practice.update();
        }
    }
    // measured as the costs are when practice is done, with no visitor
    let way = Way { visitor: 0.0, ..practice.worlds.way };
    let learner = &mut practice.learner;
    let visitor = settings.iter().find(|(n, _)| n == "visitor").map_or(touch_default(), |(_, v)| *v);
    let run = format!("legs={legs} seed={seed} steps={} visitor={visitor} kept={}", practice.worlds.steps, kept.is_some());
    for kind in [Kind::Lift, Kind::SetDown, Kind::Nudge, Kind::Shove, Kind::Drop] {
        let (mut after_untouched, mut after_numb, mut held_untouched, mut held_numb) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
        let (mut fell, mut fell_numb, mut fell_untouched, mut trials) = (0, 0, 0, 0);
        for world in held_out(16) {
            for moment in [3.0f32, 7.0, 11.0] {
                let mut walk = Walk::new(recipe, way, world);
                let start = (moment * 60.0) as u32;
                while walk.run.stage.world.steps < start && !walk.run.judge.over() {
                    walk.step(way, learner, None);
                }
                if walk.run.judge.over() {
                    continue;
                }
                let (mut touched, mut numb, mut untouched) = (walk.clone(), walk.clone(), walk);
                if !touched.touch(kind) {
                    continue;
                }
                numb.touch(kind);
                trials += 1;
                let (mut a, mut b, mut c) = (Vec::new(), Vec::new(), Vec::new());
                let end = lasts(kind);
                for along in 0..end + 180 {
                    if along < end {
                        touched.touching(kind, along);
                        numb.touching(kind, along);
                    }
                    let felt = untouched.felt();
                    let x = touched.step(way, learner, None);
                    let y = numb.step(way, learner, Some(&felt));
                    let z = untouched.step(way, learner, None);
                    if let (Some(x), Some(y), Some(z)) = (x, y, z) {
                        let window = if along < end { (&mut held_untouched, &mut held_numb) } else if along < end + 60 { (&mut after_untouched, &mut after_numb) } else { continue };
                        a.push(x.clone());
                        b.push(y);
                        c.push(z);
                        window.0.push(difference(&a[a.len() - 1..], &c[c.len() - 1..]));
                        window.1.push(difference(&a[a.len() - 1..], &b[b.len() - 1..]));
                    }
                }
                let fell_in = |walk: &Walk| walk.fell_at.is_some_and(|at| at <= start + end + 180);
                fell += usize::from(fell_in(&touched));
                fell_numb += usize::from(fell_in(&numb));
                fell_untouched += usize::from(fell_in(&untouched));
            }
        }
        let mean = |list: &[f32]| list.iter().sum::<f32>() / list.len().max(1) as f32;
        println!(
            "{run} {kind:?} trials={trials} after: from_untouched={:.3} from_numb={:.3} held: from_untouched={:.3} from_numb={:.3} fell: touched={:.2} numb={:.2} untouched={:.2}",
            mean(&after_untouched),
            mean(&after_numb),
            mean(&held_untouched),
            mean(&held_numb),
            fell as f32 / trials.max(1) as f32,
            fell_numb as f32 / trials.max(1) as f32,
            fell_untouched as f32 / trials.max(1) as f32
        );
    }
}

fn touch_default() -> f32 {
    walker::generalist::practice::VISITOR
}
