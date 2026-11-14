//! What the creature's wants are held to (stage 2): moving and being awake spend energy and resting
//! gives it back; tired muscles are weaker and never stop; food in reach is eaten and restores energy,
//! food out of reach is not; hunger never ends a run; dropped food falls and lies on what is under it;
//! food is laid with the land without changing a piece of it; curiosity pays for what is new and, for
//! anything seen or visited again and again, a bounded sum; the moving eye turns within its limits at
//! its top speed, its rays close together in the middle, and sees food as food; and where it looks
//! changes nothing it is charged for.

use alloc::rc::Rc;
use alloc::vec;
use alloc::vec::Vec;

use super::curious::{Counts, Curiosity};
use super::envs::{End, Run};
use super::eyes::{self, GAZE_HIGH, GAZE_LOW, GAZE_REST, GAZE_SPEED, PER_RAY, RAYS, Seen};
use super::land::{FOOD_CHANCE, Land};
use super::needs::{self, Needs, FOOD, WEAKEST};
use super::practice::{Way, shaped};
use super::recipe::{Plan, Recipe};
use crate::math::Vec2;
use crate::physics::STEP;

fn flat_run(energy: f32) -> Run {
    let land = Rc::new(Land::new(Recipe { seed: 3, difficulty: 0.1, amounts: [0.0; 4] }, 60.0));
    let mut run = Run::new(land, 2, 60.0).unwrap();
    let way = Way { energy, appear: 0.0, play: 0.0, ..Way::of(2) };
    way.dress_run(&mut run, 3);
    // only the food a test puts out
    run.stage.feeds = false;
    run
}

/// Actions that hold each joint where it was built, the eye at `look`, and no hop.
fn standing(run: &Run, look: f32) -> Vec<f32> {
    let world = &run.stage.world;
    let mut actions: Vec<f32> = run.body.creature.joints.iter().map(|&joint| {
        let joint = &world.joints[joint as usize];
        2.0 * (joint.angle(&world.bodies) - joint.lower) / (joint.upper - joint.lower) - 1.0
    }).collect();
    actions.push(look);
    actions.push(-1.0);
    actions
}

fn step(run: &mut Run, actions: &[f32], steps: usize) {
    for _ in 0..steps {
        run.before_step(actions);
        run.stage.world.step();
        run.after_step();
        shaped(run, Way::of(2).shaping, actions);
    }
}

fn energy(run: &Run) -> f32 {
    run.body.needs.as_ref().unwrap().energy
}

#[test]
fn moving_and_being_awake_spend_energy_and_resting_gives_it_back() {
    // standing, it spends about what being awake costs and holding itself up, and rests a little
    let mut run = flat_run(0.5);
    let still = standing(&run, 0.0);
    step(&mut run, &still, 60);
    let settled = energy(&run);
    step(&mut run, &still, 600);
    let rested = energy(&run);
    assert!(rested > settled, "standing still it rests: {settled} then {rested}");
    // flailing, it spends far more than being awake does
    let mut flailing = flat_run(0.5);
    for k in 0..600 {
        let wild: Vec<f32> = (0..flailing.body.actions()).map(|j| if (k / 10 + j) % 2 == 0 { 1.0 } else { -1.0 }).collect();
        step(&mut flailing, &wild, 1);
    }
    assert!(energy(&flailing) < 0.5 - 600.0 * STEP * needs::AWAKE, "flailing for 10 s left {}", energy(&flailing));
    assert_eq!(flailing.body.needs.as_ref().unwrap().full, 10.0 * needs::FULL, "two legs weigh 10 kg");
}

#[test]
fn tired_muscles_are_weaker_down_to_a_floor_and_never_stop() {
    assert_eq!(Needs::new(1.0).vigour(), 1.0);
    assert_eq!(Needs::new(needs::TIRED).vigour(), 1.0);
    assert!((Needs::new(0.0).vigour() - WEAKEST).abs() < 1e-6);
    let mut last = 0.0;
    for k in 0..=40 {
        let vigour = Needs::new(k as f32 / 100.0).vigour();
        assert!(vigour >= last, "vigour falls smoothly as energy does");
        last = vigour;
    }
}

#[test]
fn food_in_reach_is_eaten_and_restores_energy_and_food_out_of_reach_is_not() {
    let mut run = flat_run(0.4);
    let foot = run.stage.world.bodies[run.body.creature.legs[0].lower as usize].position;
    run.stage.food.push(super::stage::Food { at: foot + Vec2::new(0.02, 0.0), falling: 0.0 });
    run.stage.food.push(super::stage::Food { at: foot + Vec2::new(3.0, 0.0), falling: 0.0 });
    let still = standing(&run, 0.0);
    step(&mut run, &still, 1);
    let needs = run.body.needs.as_ref().unwrap();
    assert_eq!(needs.eaten, 1);
    assert_eq!(needs.ate, 1.0);
    assert!((needs.energy - (0.4 + FOOD)).abs() < 0.01, "{}", needs.energy);
    assert_eq!(run.stage.food.len(), 1);
}

#[test]
fn hunger_never_ends_a_run_and_a_tired_creature_may_stand_still() {
    let mut run = flat_run(0.0);
    let still = standing(&run, 0.0);
    step(&mut run, &still, 900);
    assert_eq!(run.judge.end, End::Going, "15 s with no energy, standing still");
    assert!(energy(&run) > 0.0, "and it has rested some back");
    // a creature with energy to spare that stands still has its run ended for getting nowhere, as before
    let mut full = flat_run(1.0);
    step(&mut full, &still, 400);
    assert_eq!(full.judge.end, End::Stalled);
}

#[test]
fn dropped_food_falls_and_lies_on_what_is_under_it() {
    let mut run = flat_run(1.0);
    run.stage.drop_food(Vec2::new(2.0, 1.5));
    let still = standing(&run, 0.0);
    step(&mut run, &still, 120);
    let food = run.stage.food[0];
    assert_eq!(food.falling, 0.0);
    assert!((food.at.y - eyes::FOOD_RADIUS).abs() < 1e-4, "it lies on the ground: {:?}", food.at);
}

#[test]
fn food_is_laid_with_the_land_without_changing_a_piece_of_it() {
    let (mut pieces, mut food, mut length) = (0, 0, 0.0);
    for seed in 0..200 {
        let recipe = Recipe { seed, difficulty: 0.3, amounts: [1.0; 4] };
        let land = Land::new(recipe, 150.0);
        let mut plan = Plan::new(recipe);
        for laid in &land.pieces {
            let planned = plan.piece();
            assert_eq!(laid.kind, planned.kind);
            assert_eq!(laid.run, planned.run);
        }
        pieces += land.pieces.len();
        food += land.geometry.food.iter().filter(|food| food.x > land::START_AHEAD).count();
        length += land.reached.x;
        // every piece of food lies on the ground
        for at in &land.geometry.food {
            let lying = land.geometry.ground.iter().any(|piece| piece.a.y == piece.b.y && piece.a.x.min(piece.b.x) <= at.x && at.x <= piece.a.x.max(piece.b.x) && (piece.a.y + eyes::FOOD_RADIUS - at.y).abs() < 1e-4);
            assert!(lying, "food at {at:?} in world {seed}");
        }
    }
    let share = food as f32 / pieces as f32;
    std::println!("{share:.2} pieces of food a piece, one every {:.1} m", length / food as f32);
    assert!((share - FOOD_CHANCE).abs() < 0.08, "{share}");
}

use super::land;

#[test]
fn curiosity_pays_for_what_is_new_and_little_for_what_is_seen_or_visited_again_and_again() {
    let mut curiosity = Curiosity::default();
    curiosity.been(Vec2::new(0.1, 0.5));
    // going on: about one unit for each new half metre
    for k in 1..=20 {
        curiosity.been(Vec2::new(0.1 + 0.5 * k as f32, 0.5));
    }
    let going = curiosity.place;
    assert!((going - 20.0).abs() < 1e-3, "{going}");
    // stepping to and fro between two places a thousand times, or bounding up and down, earns little
    curiosity.place = 0.0;
    for k in 0..1000 {
        curiosity.been(Vec2::new(if k % 2 == 0 { 30.2 } else { 30.8 }, 0.5 + (k % 3) as f32));
    }
    assert!(curiosity.place < 3.4, "to and fro: {}", curiosity.place);
    // staring at the same things: a bounded sum; new things: one each
    let mut stared = 0.0;
    for _ in 0..500 {
        curiosity.saw(Vec2::ZERO, (0..16).map(|k| (Vec2::new(1.0 + 0.3 * k as f32, 0.0), 1)));
        stared += curiosity.sight;
    }
    assert!(stared < 16.0 * 1.7, "{stared}");
    curiosity.saw(Vec2::ZERO, (0..16).map(|k| (Vec2::new(20.0 + 0.3 * k as f32, 0.0), 1)));
    assert!((curiosity.sight - 16.0).abs() < 1e-3, "{}", curiosity.sight);
    // what is nothing is not seen
    curiosity.saw(Vec2::ZERO, (0..16).map(|k| (Vec2::new(40.0 + 0.3 * k as f32, 0.0), 0)));
    assert_eq!(curiosity.sight, 0.0);
}

#[test]
fn the_counts_keep_every_key_as_their_table_grows() {
    let mut counts = Counts::new(16);
    for round in 0..3u16 {
        for key in 1..5000u32 {
            assert_eq!(counts.bump(key * 7919), round);
        }
    }
    assert_eq!(counts.used, 4999);
}

#[test]
fn the_moving_eye_turns_within_its_limits_no_faster_than_its_top_speed_and_sees_food_as_food() {
    let fan = eyes::gazed(0.0);
    let gaps: Vec<f32> = fan.windows(2).map(|pair| pair[1] - pair[0]).collect();
    assert!(gaps[7] < gaps[0] / 5.0, "closer together in the middle: {gaps:?}");
    assert_eq!(eyes::gaze_wanted(0.0), GAZE_REST);
    assert_eq!(eyes::gaze_wanted(-1.0), GAZE_LOW);
    assert_eq!(eyes::gaze_wanted(1.0), GAZE_HIGH);
    let mut run = flat_run(1.0);
    let up = standing(&run, 1.0);
    let before = run.body.gaze;
    step(&mut run, &up, 6);
    assert!((run.body.gaze - before - 6.0 * GAZE_SPEED * STEP).abs() < 1e-4);
    step(&mut run, &up, 120);
    assert!((run.body.gaze - GAZE_HIGH).abs() < 1e-5);
    // food straight ahead of where it looks is seen as food by the middle rays
    let mut run = flat_run(1.0);
    let eye = eyes::eye(&run.stage, run.body.creature.torso);
    let (s, c) = crate::math::sin_cos(GAZE_REST);
    run.stage.food.push(super::stage::Food { at: eye + Vec2::new(c, s) * 0.6, falling: 0.0 });
    let mut senses = vec![0.0; run.senses()];
    run.sense(&mut senses);
    assert!(run.seen[7].1 == Seen::Food || run.seen[8].1 == Seen::Food, "{:?}", run.seen);
    let food = (0..RAYS).filter(|&k| senses[k * PER_RAY + 5] == 1.0).count();
    assert!(food >= 1);
}

#[test]
fn where_it_looks_changes_nothing_it_is_charged_for() {
    let recipe = Recipe { seed: 11, difficulty: 0.5, amounts: [1.0; 4] };
    let mut aheads = Vec::new();
    for look in [-1.0, 0.0, 1.0] {
        let mut run = Run::new(Rc::new(Land::new(recipe, 60.0)), 2, 30.0).unwrap();
        Way::of(2).dress_run(&mut run, 11);
        let mut senses = vec![0.0; run.senses()];
        let still = standing(&run, look);
        let mut seen = Vec::new();
        for _ in 0..40 {
            for _ in 0..4 {
                run.before_step(&still);
                run.stage.world.step();
                run.after_step();
            }
            run.sense(&mut senses);
            seen.push(run.ahead);
        }
        aheads.push(seen);
    }
    assert_eq!(aheads[0], aheads[1]);
    assert_eq!(aheads[1], aheads[2]);
}

