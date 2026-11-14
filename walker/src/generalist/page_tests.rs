//! What the page's side is held to: the show plays the very run the best brain was scored on, a held
//! creature goes where the hand goes and falls when dropped, the world's lists come out as they are
//! made, and creatures stepped for a learner step.

use super::page::Page;
use super::recipe::Recipe;
use crate::math::Vec2;

fn page(legs: u32) -> Page {
    Page::new(Recipe { seed: 8, difficulty: 0.2, amounts: [1.0; 4] }, legs, 8, 8, 1, 0, 6.0, 2).unwrap()
}

#[test]
fn the_show_plays_the_very_run_the_best_brain_was_scored_on() {
    for legs in [2, 4] {
        let mut page = page(legs);
        while page.evolution.generation < 2 {
            page.evolution.train(8);
        }
        page.show_reset();
        while !page.show.judge.over() {
            page.show_step(0.1);
        }
        assert_eq!(page.show.judge.score.to_bits(), page.evolution.best_score.to_bits(), "{legs} legs");
        assert_eq!(page.show.judge.furthest.to_bits(), page.evolution.best_distance.to_bits());
        assert_eq!(page.show_step(1.0), 0, "an ended run stands still");
    }
}

#[test]
fn a_creature_taken_by_its_body_hangs_under_the_hand_and_falls_when_let_go() {
    let mut page = page(2);
    let torso = page.show.body.creature.torso as usize;
    let start = page.show.stage.world.bodies[torso].position;
    assert_eq!(page.show_under(start), 1);
    assert_eq!(page.show_grab(start), 1);
    let goal = start + Vec2::new(1.0, 1.5);
    page.show_hand(goal);
    for _ in 0..120 {
        page.show_step(1.0 / 60.0);
    }
    let lifted = page.show.stage.world.bodies[torso].position;
    assert!((lifted.x - goal.x).abs() < 0.1 && lifted.y < goal.y && lifted.y > goal.y - 0.2, "hangs just under the hand, at {lifted:?}");
    assert_eq!(page.show_held().0, 1);
    assert!(!page.show.judge.over(), "and its run is not ended in the air");
    page.show_let_go();
    assert_eq!(page.show_held().0, 0);
    for _ in 0..90 {
        page.show_step(1.0 / 60.0);
    }
    assert!(page.show.stage.world.bodies[torso].position.y < lifted.y - 0.8, "and fell when let go");
}

#[test]
fn a_creature_taken_by_a_foot_hangs_from_it_and_nothing_flies_off() {
    let mut page = page(4);
    let foot = page.show.body.creature.legs[0].lower as usize;
    let at = page.show.stage.world.bodies[foot].position;
    assert_eq!(page.show_grab(at), 1);
    page.show_hand(at + Vec2::new(0.0, 1.0));
    let (mut body, mut parts): (f32, f32) = (0.0, 0.0);
    for _ in 0..180 {
        page.show_step(1.0 / 60.0);
        body = body.max(page.show.stage.world.bodies[0].velocity.length());
        parts = page.show.stage.world.bodies.iter().take(9).fold(parts, |most, body| most.max(body.velocity.length()));
    }
    let world = &page.show.stage.world;
    assert!((world.bodies[foot].position.y - (at.y + 1.0)).abs() < 0.15, "the foot is up by the hand");
    assert!(world.bodies[0].position.y < world.bodies[foot].position.y + 0.3, "the rest hangs from it");
    // the hand goes at 4 m/s at most; its legs swing faster by their own motors, as they do on the ground
    assert!(body < 4.5 && parts < 10.0, "its body went at {body} m/s and its parts at {parts}");
}

#[test]
fn a_box_dragged_into_the_creature_pushes_it_and_a_moving_platform_taken_stays_where_it_is_let_go() {
    let mut page = page(2);
    let torso = page.show.body.creature.torso as usize;
    let start = page.show.stage.world.bodies[torso].position;
    let ground = page.show.stage.world.ground_height(start.x + 1.2).unwrap();
    let body = page.show.stage.place_box(Vec2::new(start.x + 1.2, ground + 0.16), 0.15);
    let at = page.show.stage.world.bodies[body as usize].position;
    assert_eq!(page.show_grab(at), 2);
    page.show_hand(Vec2::new(start.x - 1.0, at.y));
    for _ in 0..120 {
        page.show_step(1.0 / 60.0);
    }
    let world = &page.show.stage.world;
    assert!(world.bodies[torso].position.x < start.x - 0.2, "the creature was pushed back, to {:?}", world.bodies[torso].position);
    assert!(world.bodies[body as usize].position.x > world.bodies[torso].position.x, "and the box never went through it");
    page.show_let_go();
    // a moving platform: made dynamic while held, and still where it was let go
    let mut page = super::page::Page::new(Recipe { seed: 3, difficulty: 0.2, amounts: [0.0, 0.0, 0.0, 1.0] }, 2, 8, 8, 1, 0, 6.0, 2).unwrap();
    page.ground(60.0, 0);
    let mover = (0..600).find_map(|_| {
        page.show.stage.keep(page.show.stage.world.bodies[0].position.x + 10.0);
        page.show.stage.made.iter().find(|made| made.thing == super::stage::Thing::Mover).copied()
    });
    let mover = mover.expect("a world of things that move has a moving platform near the start");
    let at = page.show.stage.world.bodies[mover.body as usize].position;
    assert_eq!(page.show_grab(at + Vec2::new(page.show.stage.origin, 0.0)), 2);
    page.show_hand(at + Vec2::new(0.0, 0.5));
    for _ in 0..60 {
        page.show_step(1.0 / 60.0);
    }
    page.show_let_go();
    let left = page.show.stage.world.bodies[mover.body as usize].position;
    for _ in 0..60 {
        page.show.stage.world.step();
    }
    assert_eq!(page.show.stage.world.bodies[mover.body as usize].position, left, "it stays where it was let go of");
    assert!(left.y > at.y + 0.3, "and was lifted, to {left:?} from {at:?}");
}

#[test]
fn the_worlds_lists_come_out_as_it_is_made() {
    let mut page = page(4);
    let first = page.ground(100.0, 0).len();
    assert!(first.is_multiple_of(4) && first > 0);
    let more = page.ground(300.0, first / 4).len();
    assert!(more > 0 && page.show.stage.land.reached.x >= 300.0);
    assert_eq!(page.blocks(0).len() % 4, 0);
    assert_eq!(page.hazards(0).len() % 5, 0);
    assert!(!page.hazards(0).is_empty() && !page.blocks(0).is_empty());
    assert_eq!(page.bodies().len(), 6 * 9);
    assert_eq!(page.rays().len(), 2 + 2 * 16);
    assert_eq!(page.ray_angles().len(), 16);
    assert_eq!(page.picture(48).len(), 48);
    assert_eq!(page.things().len() % 6, 0);
}

/// The columns of a brain's picture, what each dot is lit by, and what flows between columns.
fn columns(picture: &[f32]) -> (Vec<usize>, Vec<Vec<f32>>, Vec<Vec<f32>>) {
    let count = picture[0] as usize;
    let sizes: Vec<usize> = picture[1..=count].iter().map(|&n| n as usize).collect();
    let mut at = 1 + count;
    let lit = sizes.iter().map(|&n| { at += n; picture[at - n..at].to_vec() }).collect();
    let flows = sizes.windows(2).map(|pair| { at += pair[0] * pair[1]; picture[at - pair[0] * pair[1]..at].to_vec() }).collect();
    assert_eq!(at, picture.len());
    (sizes, lit, flows)
}

#[test]
fn the_brain_is_drawn_as_it_thinks_whichever_way_it_learns() {
    for legs in [2, 4] {
        // evolution's brain: 8 neurons, no memory; each ray's six senses drawn as one dot
        let mut page = page(legs);
        page.show_step(0.5);
        let senses = page.senses();
        let (sizes, lit, flows) = columns(page.brain_picture());
        assert_eq!(sizes, vec![senses - 16 * 5, 8, page.actions()], "{legs} legs");
        // what flows into a hidden neuron, with its bias, is what it gave
        let weights = page.shown_weights.clone();
        for (j, &gave) in lit[1].iter().enumerate() {
            let sum: f32 = flows[0][j * sizes[0]..(j + 1) * sizes[0]].iter().sum();
            let bias = weights[senses * 8 + j];
            assert!((crate::math::tanh(sum + bias) - gave).abs() < 1e-4, "neuron {j}: {sum} + {bias} against {gave}");
        }

        // the policy practice trains, on show
        page.practice_create(4, 3, 3);
        let learner = &page.practice.as_ref().unwrap().learner;
        (page.state_room, page.running_room) = (learner.state(), learner.running());
        assert!(page.policy_load());
        for _ in 0..30 {
            page.show_step(1.0 / 60.0);
        }
        let (sizes, lit, flows) = columns(page.brain_picture());
        // a policy feels touch as well, so it senses more than evolution's brain
        assert_eq!(sizes, vec![page.show.senses() - 16 * 5, 64, 64, page.actions()]);
        let policy = page.policy.as_ref().unwrap();
        for (column, net_layer) in [(0, 0), (1, 1)] {
            let start = super::mind::layer_start(&policy.trunk, net_layer);
            let layer = policy.trunk.layers[net_layer];
            for (j, &gave) in lit[column + 1].iter().enumerate() {
                let sum: f32 = flows[column][j * sizes[column]..(j + 1) * sizes[column]].iter().sum();
                let bias = policy.weights[start + layer.inputs * layer.outputs + j];
                assert!((crate::math::tanh(sum + bias) - gave).abs() < 1e-3, "layer {column} neuron {j}");
            }
        }
    }
}

#[test]
fn creatures_stepped_for_a_learner_step() {
    let mut page = page(2);
    assert_eq!(page.envs_create(5, false), 5);
    assert_eq!(page.envs_step(30), 150);
    let stepped = page.envs.as_ref().unwrap();
    assert_eq!(stepped.observations.len(), 5 * page.senses());
    assert!(stepped.observations.iter().all(|x| x.is_finite()));
}

#[test]
fn a_policy_on_show_moves_exactly_as_it_would_in_practice() {
    use super::ppo::{GOING, Learner, Settings, Task};
    use super::practice::{Way, Worlds};
    use alloc::vec;
    for legs in [2, 4] {
        let recipe = Recipe { seed: 8, difficulty: 0.2, amounts: [1.0; 4] };
        let mut page = Page::new(recipe, legs, 8, 8, 1, 0, 30.0, 2).unwrap();
        page.practice_create(4, 5, 3);
        let learner = &page.practice.as_ref().unwrap().learner;
        let (mut state, running) = (learner.state(), learner.running());
        // the hop's middle pushed to its top, as noise in learning could drift it: practice has no hop,
        // so what is shown must not hop either
        let (hidden, senses, actions) = (learner.settings.hidden, learner.senses, learner.actions);
        state[learner.at[1] + hidden * actions + actions - 1] = 5.0;
        let mut policy = Learner::new(Settings::default(), senses, actions, 1, 0);
        assert!(policy.load(&state, &running));
        (page.state_room, page.running_room) = (state, running);
        assert!(page.policy_load());

        // the same policy in the same world, as practice and its measuring step it
        let way = Way::of(legs);
        let mut worlds = Worlds::alone(recipe, way, &[recipe.seed]).unwrap();
        let wide = worlds.actions();
        let (mut sensed, mut asked, mut rewards, mut ends, mut last) = (vec![0.0; senses], vec![0.0; wide], vec![0.0; 1], vec![GOING; 1], vec![0.0; senses]);
        worlds.observe(&mut sensed);
        let torso = page.show.body.creature.torso as usize;
        let at = |run: &super::envs::Run| {
            let body = &run.stage.world.bodies[torso];
            ((body.position.x + run.stage.origin).to_bits(), body.position.y.to_bits(), body.angle().to_bits())
        };
        let mut decisions = 0;
        while worlds.going(0) {
            policy.act(&sensed, &mut asked);
            worlds.step(&asked, &mut sensed, &mut rewards, &mut ends, &mut last);
            let mut taken = 0;
            while taken < way.skip && !page.show.judge.over() {
                taken += page.show_step(crate::physics::STEP);
            }
            assert_eq!(at(&page.show), at(&worlds.runs[0]), "{legs} legs: apart after {decisions} decisions");
            decisions += 1;
        }
        assert!(page.show.judge.over(), "{legs} legs: the show ends when practice's run does");
        assert_eq!(page.show.judge.end, worlds.runs[0].judge.end);
        assert!(decisions > 10, "{legs} legs: {decisions} decisions");
    }
}
