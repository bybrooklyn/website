//! What a changing world is held to (stage 4): at its rest it changes nothing, to the bit; ice lets the
//! feet slide, bouncy ground throws back what lands, soft ground lets the feet sink, gravity weighs and
//! the wind pushes; a world changing by itself keeps every condition within its limits, changes as often
//! as its setting asks, drops things near the creature, and does the same every time for the same world;
//! at night it sees less far; a landing is heard from the side it is on, louder the nearer, fading; and
//! the teacher's settings move to where the creature comes through about half its runs.

use alloc::rc::Rc;
use alloc::vec::Vec;

use super::changes::{self, Changes, Conditions, Setting};
use super::envs::Run;
use super::eyes::{PER_RAY, RAYS};
use super::land::Land;
use super::practice::Way;
use super::recipe::Recipe;
use super::teacher::Teacher;
use crate::learn::Random;
use crate::math::Vec2;

fn flat_run() -> Run {
    let land = Rc::new(Land::new(Recipe { seed: 3, difficulty: 0.1, amounts: [0.0; 4] }, 60.0));
    let mut run = Run::new(land, 2, 60.0).unwrap();
    let way = Way { appear: 0.0, play: 0.0, energy: 1.0, ..Way::of(2) };
    way.dress_run(&mut run, 3);
    run.stage.feeds = false;
    run
}

/// Actions that hold each joint where it was built, the eye a little down ahead, and no hop.
fn standing(run: &Run) -> Vec<f32> {
    let world = &run.stage.world;
    let mut actions: Vec<f32> = run.body.creature.joints.iter().map(|&joint| {
        let joint = &world.joints[joint as usize];
        2.0 * (joint.angle(&world.bodies) - joint.lower) / (joint.upper - joint.lower) - 1.0
    }).collect();
    actions.push(0.0);
    actions.push(-1.0);
    actions
}

fn step(run: &mut Run, actions: &[f32], steps: usize) {
    for _ in 0..steps {
        run.before_step(actions);
        run.stage.world.step();
        run.after_step();
        run.judge.after_step(&run.stage, &run.body, actions);
    }
}

fn torso(run: &Run) -> Vec2 {
    run.stage.world.bodies[run.body.creature.torso as usize].position
}

#[test]
fn a_world_at_its_rest_changes_nothing_to_the_bit() {
    let (mut plain, mut resting) = (flat_run(), flat_run());
    resting.changes = Some(Changes::still(Conditions::REST));
    let actions = standing(&plain);
    for _ in 0..200 {
        step(&mut plain, &actions, 1);
        step(&mut resting, &actions, 1);
        let bits = |run: &Run| run.stage.world.bodies.iter().map(|body| (body.position.x.to_bits(), body.position.y.to_bits(), body.angle().to_bits())).collect::<Vec<_>>();
        assert_eq!(bits(&plain), bits(&resting));
    }
}

#[test]
fn ice_lets_it_slide_bouncy_ground_throws_back_soft_ground_lets_it_sink_and_the_wind_pushes() {
    // standing still in a steady wind from behind: on ice its feet slide, on firm ground they hold
    let slid = |grip: f32| {
        let mut run = flat_run();
        run.changes = Some(Changes::still(Conditions { grip, wind: 2.0, ..Conditions::REST }));
        let actions = standing(&run);
        step(&mut run, &actions, 30);
        let before = torso(&run).x;
        step(&mut run, &actions, 30);
        torso(&run).x - before
    };
    let (firm, ice) = (slid(1.0), slid(Conditions::ICE));
    assert!(ice > 3.0 * firm.abs() && ice > 0.1, "in the wind it slid {ice} m on ice and {firm} m on firm ground");

    // dropped from a metre: on bouncy ground its feet are thrown back up
    let bounced = |bounce: f32| {
        let mut run = flat_run();
        run.changes = Some(Changes::still(Conditions { bounce, ..Conditions::REST }));
        for part in run.stage.world.bodies.iter_mut().take(5) {
            part.position.y += 1.0;
        }
        let actions = standing(&run);
        let feet: Vec<u32> = run.body.creature.legs.iter().map(|leg| leg.lower).collect();
        let mut fastest_up = 0.0f32;
        for _ in 0..90 {
            step(&mut run, &actions, 1);
            for &foot in &feet {
                fastest_up = fastest_up.max(run.stage.world.bodies[foot as usize].velocity.y);
            }
        }
        fastest_up
    };
    let (dead, bouncy) = (bounced(0.0), bounced(Conditions::BOUNCIEST));
    assert!(bouncy > dead + 1.0, "its feet were thrown up at {bouncy} m/s on bouncy ground and {dead} m/s on firm");

    // standing: on soft ground it stands lower
    let height = |soft: f32| {
        let mut run = flat_run();
        run.changes = Some(Changes::still(Conditions { soft, ..Conditions::REST }));
        let actions = standing(&run);
        step(&mut run, &actions, 120);
        torso(&run).y
    };
    let sank = height(0.0) - height(1.0);
    assert!(sank > 0.5 * crate::physics::GIVE, "on soft ground it stands {sank} m lower");

    // a wind from behind pushes it on, from ahead back
    let blown = |wind: f32| {
        let mut run = flat_run();
        run.changes = Some(Changes::still(Conditions { wind, grip: 0.5, ..Conditions::REST }));
        let actions = standing(&run);
        step(&mut run, &actions, 120);
        torso(&run).x
    };
    assert!(blown(Conditions::STRONGEST) > blown(0.0) + 0.05 && blown(-Conditions::STRONGEST) < blown(0.0) - 0.05);
}

#[test]
fn a_world_changing_by_itself_keeps_within_its_limits_and_drops_things_and_does_the_same_every_time() {
    let watch = || {
        let mut run = flat_run();
        run.stage.feeds = true;
        run.changes = Some(Changes::of(Setting { often: 1.0, drops: 1.0, ..Setting::TEST }, 7));
        let actions = standing(&run);
        let mut seen: Vec<[u32; 6]> = Vec::new();
        let (mut lowest, mut highest) = ([f32::MAX; 6], [f32::MIN; 6]);
        for _ in 0..60 * 60 {
            step(&mut run, &actions, 1);
            let now = run.changes.as_ref().unwrap().now.list();
            for k in 0..6 {
                lowest[k] = lowest[k].min(now[k]);
                highest[k] = highest[k].max(now[k]);
            }
            seen.push(now.map(f32::to_bits));
        }
        let changes = run.changes.as_ref().unwrap().changes;
        let boxes = run.stage.made.len();
        (seen, lowest, highest, changes, boxes, run.stage.food.len())
    };
    let (first, lowest, highest, changes, boxes, food) = watch();
    let limits = [(Conditions::ICE, Conditions::STICKY), (0.0, Conditions::BOUNCIEST), (0.0, 1.0), (Conditions::LIGHTEST, Conditions::HEAVIEST), (-Conditions::STRONGEST, Conditions::STRONGEST), (0.0, 1.0)];
    for k in 0..6 {
        assert!(lowest[k] >= limits[k].0 - 1e-4 && highest[k] <= limits[k].1 + 1e-4, "condition {k} went from {} to {}", lowest[k], highest[k]);
    }
    // about every 3 s at its most often, and things dropped about every 4 s
    assert!((10..=40).contains(&changes), "{changes} changes in a minute");
    assert!(boxes + food >= 6, "{boxes} boxes and {food} pieces of food dropped in a minute");
    assert!(lowest.iter().zip(&highest).filter(|(low, high)| *high - *low > 0.05).count() >= 4, "most conditions changed");
    assert_eq!(first, watch().0, "the same world changes the same way");
    // a still world never changes by itself
    let mut run = flat_run();
    run.changes = Some(Changes::of(Setting::STILL, 7));
    let actions = standing(&run);
    step(&mut run, &actions, 60 * 60);
    assert_eq!((run.changes.as_ref().unwrap().changes, run.stage.made.len()), (0, 0));
}

#[test]
fn at_night_it_sees_less_far() {
    let mut run = flat_run();
    let mut senses = alloc::vec![0.0; run.senses()];
    // looking level ahead and up, nothing near: by day a ray down meets the ground far off
    let far = |senses: &[f32]| (0..RAYS).map(|k| senses[k * PER_RAY]).filter(|&near| near > 0.0).fold(1.0f32, f32::min);
    run.sense(&mut senses);
    let day = far(&senses);
    run.changes = Some(Changes::still(Conditions { light: 0.0, ..Conditions::REST }));
    let actions = standing(&run);
    step(&mut run, &actions, 1);
    run.sense(&mut senses);
    let night = far(&senses);
    let nearest_at_night = 1.0 - changes::sight(0.0) / super::eyes::RANGE;
    assert!(night >= nearest_at_night - 1e-4 && day < nearest_at_night, "by day it sees as far as {day}, at night only {night}");
    // the light is a sense
    let light = senses[senses.len() - changes::SENSES + 2];
    assert_eq!(light, 0.0);
}

#[test]
fn a_landing_is_heard_from_its_side_louder_the_nearer_and_fades() {
    let heard = |side: f32, food: bool| {
        let mut run = flat_run();
        run.stage.feeds = true;
        let actions = standing(&run);
        step(&mut run, &actions, 30);
        let at = torso(&run) + Vec2::new(side, 0.6);
        if food {
            run.stage.drop_food(at);
        } else {
            run.stage.place_box(at, 0.15);
        }
        let mut loudest = [0.0f32; 2];
        for _ in 0..40 {
            step(&mut run, &actions, 1);
            loudest = [loudest[0].max(run.heard[0]), loudest[1].max(run.heard[1])];
        }
        step(&mut run, &actions, 120);
        (loudest, run.heard)
    };
    let (behind, faded) = heard(-1.5, true);
    assert!(behind[1] > 0.2 && behind[0] == 0.0, "food landing behind is heard behind: {behind:?}");
    assert!(faded[1] < 0.05, "and fades: {faded:?}");
    let (ahead, _) = heard(1.0, false);
    assert!(ahead[0] > behind[1] && ahead[1] == 0.0, "a box landing near ahead is heard ahead and louder: {ahead:?}");
    let (far, _) = heard(4.0, false);
    assert!(far[0] < ahead[0], "and a box further off more faintly: {far:?} against {ahead:?}");
}

#[test]
fn the_teacher_s_settings_go_to_where_the_creature_comes_through_about_half_its_runs() {
    // a creature that comes through a world if it asks less than its knack, and then not every time
    let mut teacher = Teacher::new(1);
    let knack = 0.45;
    let start = teacher.standing().0;
    let mut random = Random::new(5);
    for _ in 0..6000 {
        let which = teacher.draw();
        let asks = teacher.setting(which).amount();
        let chance = if asks < knack { 0.9 } else { 0.1 };
        teacher.tell(which, random.unit() < chance);
    }
    let (amount, share) = teacher.standing();
    assert!(start < 0.2, "it starts asking little: {start}");
    assert!((knack - 0.12..knack + 0.12).contains(&amount), "it came to ask {amount}, near the creature's knack of {knack}");
    assert!((0.25..0.75).contains(&share), "and the creature comes through {share} of its runs");
    assert!(teacher.bred > 50);
}
