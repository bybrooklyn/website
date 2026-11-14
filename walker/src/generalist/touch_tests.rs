//! What touch is held to: a creature that feels touch feels its weight on its feet and the pull of
//! gravity when it stands, a hand holding it and less weight when lifted, nothing when it falls, and a
//! box pushed into its body; while held nothing is paid and its run does not end; and practice's
//! visitor comes as often as asked, does each of its things, flings nothing, and does the same every
//! time for the same world.

use alloc::rc::Rc;
use alloc::vec;
use alloc::vec::Vec;

use super::envs::Run;
use super::eyes::{PER_RAY, RAYS};
use super::land::Land;
use super::practice::{Practice, Way, practice_seed, shaped};
use super::recipe::Recipe;
use super::touch::{self, Visit, Visits};
use super::ppo::Settings;
use crate::math::Vec2;

fn run(legs: u32, amounts: [f32; 4]) -> Run {
    let mut run = Run::new(Rc::new(Land::new(Recipe { seed: 5, difficulty: 0.2, amounts }, 60.0)), legs, 30.0).unwrap();
    Way::of(legs).dress_run(&mut run, 1);
    run
}

/// What the run feels of touch now: its body, its feet, held, the jolt.
fn felt(run: &mut Run) -> Vec<f32> {
    let mut senses = vec![0.0; run.senses()];
    run.sense(&mut senses);
    let count = touch::felt(run.body.legs());
    senses[senses.len() - count..].to_vec()
}

/// The actions that hold every joint at the angle it was built at, standing, the eye where it rests,
/// and no hop.
fn standing(run: &Run) -> Vec<f32> {
    let world = &run.stage.world;
    let mut actions: Vec<f32> = run.body.creature.joints.iter().map(|&joint| {
        let joint = &world.joints[joint as usize];
        2.0 * (joint.angle(&world.bodies) - joint.lower) / (joint.upper - joint.lower) - 1.0
    }).collect();
    if run.body.gazing {
        actions.push(0.0);
    }
    actions.push(-1.0);
    actions
}

fn step(run: &mut Run, steps: usize) {
    let still = standing(run);
    for _ in 0..steps {
        run.before_step(&still);
        run.stage.world.step();
        run.after_step();
    }
}

#[test]
fn a_creature_that_feels_touch_senses_more_and_one_that_does_not_senses_as_before() {
    for legs in [2, 4] {
        let touching = run(legs, [0.0; 4]);
        let mut plain = touching.clone();
        plain.body.touch = false;
        assert_eq!(touching.senses(), plain.senses() + touch::felt(legs as usize));
        // and its energy, whether it has just eaten, and where its eye looks
        assert_eq!(plain.senses(), RAYS * PER_RAY + 3 + if legs == 2 { 18 } else { 28 });
    }
}

#[test]
fn standing_it_feels_its_weight_on_its_feet_and_gravity_up_lifted_it_feels_the_hand_and_falling_nothing() {
    let mut run = run(2, [0.0; 4]);
    step(&mut run, 120);
    let standing = felt(&mut run);
    assert!(standing[0] < 0.05, "nothing on its body: {standing:?}");
    let on_feet = standing[1] + standing[2];
    assert!((on_feet - 1.0).abs() < 0.25, "its weight on its feet: {standing:?}");
    assert_eq!(standing[3], 0.0);
    assert!(standing[4].abs() < 0.1 && (standing[5] - 1.0).abs() < 0.1, "gravity felt as one up: {standing:?}");

    let torso = run.body.creature.torso;
    let at = run.stage.world.bodies[torso as usize].position;
    run.stage.world.hold(torso, at, touch::STIFFNESS, touch::DAMPING, touch::MOST_FORCE, touch::FASTEST);
    run.stage.world.hand.as_mut().unwrap().goal = at + Vec2::new(0.0, 1.0);
    step(&mut run, 4);
    let lifting = felt(&mut run);
    assert_eq!(lifting[3], 1.0, "held");
    assert!(lifting[5] > 1.3, "lifted, it feels pushed up: {lifting:?}");
    step(&mut run, 60);
    let up = felt(&mut run);
    assert!(up[1] + up[2] < 0.05, "nothing under its feet: {up:?}");

    run.stage.world.let_go(touch::THROW);
    step(&mut run, 8);
    let falling = felt(&mut run);
    assert_eq!(falling[3], 0.0);
    assert!(falling[5].abs() < 0.2, "falling, it feels nothing: {falling:?}");
}

#[test]
fn a_box_slid_into_it_presses_on_its_body() {
    let mut run = run(4, [0.0; 4]);
    step(&mut run, 60);
    let torso = run.stage.world.bodies[run.body.creature.torso as usize].position;
    let ground = run.stage.world.ground_height(torso.x + 1.3).unwrap();
    let at = Vec2::new(torso.x + 1.3, ground + 0.31);
    let body = run.stage.place_box(at, 0.3);
    run.stage.world.hold(body, at, touch::STIFFNESS, touch::DAMPING, touch::MOST_FORCE, 1.0);
    run.stage.world.hand.as_mut().unwrap().goal = Vec2::new(torso.x - 1.0, at.y);
    let mut most: f32 = 0.0;
    for _ in 0..120 {
        step(&mut run, 1);
        most = most.max(felt(&mut run)[0]);
    }
    assert!(most > 0.1, "the box pressed on its body with {most} of its weight");
}

#[test]
fn while_a_hand_holds_it_nothing_is_paid_and_its_run_does_not_end() {
    let mut run = run(2, [0.0; 4]);
    let shaping = Way::of(2).shaping;
    let still = vec![0.0; run.body.actions()];
    let foot = run.body.creature.legs[0].lower;
    let at = run.stage.world.bodies[foot as usize].position;
    run.stage.world.hold(foot, at, touch::STIFFNESS, touch::DAMPING, touch::MOST_FORCE, touch::FASTEST);
    // carried forward 3 m and upside down, by a foot
    run.stage.world.hand.as_mut().unwrap().goal = at + Vec2::new(3.0, 1.2);
    let mut paid = 0.0;
    for _ in 0..240 {
        run.before_step(&still);
        run.stage.world.step();
        run.after_step();
        let parts = shaped(&mut run, shaping, &still);
        paid += parts.run + parts.up + parts.posture + parts.air + parts.fall;
    }
    assert!(!run.judge.over(), "its run goes on");
    assert!(paid.abs() < 1e-3, "nothing was paid or charged but effort: {paid}");
    assert!(run.judge.furthest > 2.0, "but where it got to counts as where it has been");
}

/// Steps a run with practice's visitor coming every `every` seconds for `seconds`, the creature doing
/// nothing; what the visitor did, and the fastest anything of the creature went.
fn visited(seed: u32, every: f32, seconds: f32) -> (Vec<Visit>, f32, Vec<u32>) {
    let mut run = run(2, [0.0; 4]);
    let mut visits = Visits::new(seed);
    let still = standing(&run);
    let (mut done, mut fastest, mut bits) = (Vec::new(), 0.0f32, Vec::new());
    for _ in 0..(seconds * 60.0) as u32 {
        let (before, boxes) = (visits.doing(), run.stage.made.len());
        visits.before_step(&mut run, every, 1.0);
        if let Some(visit) = visits.doing().filter(|_| before.is_none()) {
            done.push(visit);
        }
        run.before_step(&still);
        run.stage.world.step();
        run.after_step();
        if run.stage.made.len() > boxes && visits.doing().is_none() {
            done.push(Visit::Drop);
        }
        for part in 0..5 {
            fastest = fastest.max(run.stage.world.bodies[part].velocity.length());
        }
        bits.push(run.stage.world.bodies[0].position.x.to_bits());
    }
    (done, fastest, bits)
}

#[test]
fn practices_visitor_comes_as_often_as_asked_does_each_of_its_things_and_flings_nothing() {
    let mut all = Vec::new();
    let mut fastest: f32 = 0.0;
    for seed in 0..12 {
        let (done, most, _) = visited(practice_seed(1, seed, 0), 3.0, 30.0);
        assert!((5..=14).contains(&done.len()), "a visit every 3 s or so in 30 s: {done:?}");
        all.extend(done);
        fastest = fastest.max(most);
    }
    for kind in [Visit::Leg, Visit::Nudge, Visit::Shove, Visit::Drop] {
        assert!(all.contains(&kind), "{kind:?} among {all:?}");
    }
    assert!(all.iter().any(|visit| matches!(visit, Visit::Lift { down: true })) && all.iter().any(|visit| matches!(visit, Visit::Lift { down: false })));
    assert!(fastest < 12.0, "the fastest any part went was {fastest} m/s");
    let (_, _, once) = visited(77, 3.0, 20.0);
    let (_, _, again) = visited(77, 3.0, 20.0);
    assert_eq!(once, again, "the same world, the same visits, to the bit");
}

#[test]
fn practice_with_a_visitor_learns_the_same_way_to_the_bit_and_without_one_has_none() {
    let recipe = Recipe { seed: 1, difficulty: 0.2, amounts: [1.0; 4] };
    let state = |way: Way| {
        let mut practice = Practice::new(recipe, way, Settings::default(), 4, 3, 2).unwrap();
        practice.update();
        assert_eq!(practice.worlds.runs.iter().all(|run| run.visits.is_some()), way.visitor > 0.0);
        practice.learner.state()
    };
    // four legs, whose runs last long enough for the visitor to come in one update
    let way = Way { ramp: 0, visitor: 2.0, ..Way::of(4) };
    let (once, again) = (state(way), state(way));
    assert!(once.iter().zip(&again).all(|(a, b)| a.to_bits() == b.to_bits()));
    let quiet = state(Way { visitor: 0.0, ..way });
    assert!(once.iter().zip(&quiet).any(|(a, b)| a.to_bits() != b.to_bits()), "the visitor changes what is learned");
}
