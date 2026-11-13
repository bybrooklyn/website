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
fn a_held_creature_goes_where_the_hand_goes_and_falls_when_dropped() {
    let mut page = page(2);
    let torso = page.show.body.creature.torso as usize;
    let start = page.show.stage.world.bodies[torso].position;
    page.held = Some(start + Vec2::new(1.0, 1.5));
    for _ in 0..90 {
        page.show_step(1.0 / 60.0);
    }
    let lifted = page.show.stage.world.bodies[torso].position;
    assert!((lifted - (start + Vec2::new(1.0, 1.5))).length() < 0.1, "held at {lifted:?}");
    page.held = None;
    for _ in 0..90 {
        page.show_step(1.0 / 60.0);
    }
    assert!(page.show.stage.world.bodies[torso].position.y < lifted.y - 0.8, "and fell when dropped");
    // a push moves it
    let before = page.show.stage.world.bodies[torso].velocity.x;
    let at = page.show.stage.world.bodies[torso].position;
    assert!(page.show_push(at, Vec2::new(20.0, 0.0)) >= 0);
    assert!(page.show.stage.world.bodies[torso].velocity.x > before + 1.0);
}

#[test]
fn the_worlds_lists_come_out_as_it_is_made() {
    let mut page = page(4);
    let first = page.ground(100.0, 0).len();
    assert!(first % 4 == 0 && first > 0);
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
        assert_eq!(sizes, vec![senses - 16 * 5, 64, 64, page.actions()]);
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
