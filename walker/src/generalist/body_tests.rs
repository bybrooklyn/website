//! What the body is held to: it does at least what the world's checker counts on (`check::REACH`).
//! It walks up a step that high with its legs held to the Walker's built-in stride; and from
//! standing it hops up on to a ledge that high and over a gap that wide, from some distance before
//! it. A walker that runs up to a jump does better; standing still is the plain measure. And a hop
//! goes crouch, spring, rest, as it says.

use alloc::rc::Rc;

use super::body::{Body, Hop, Hopping};
use super::check::REACH;
use super::land::Land;
use super::recipe::{Kind, Piece};
use super::stage::Stage;

/// A stage with level ground and then one piece, and a body of `legs` legs standing `before` metres
/// short of the piece. Returns them and where the piece starts and ends.
fn set(legs: u32, piece: Piece, before: f32) -> (Stage, Body, f32, f32) {
    let land = Rc::new(Land::from_pieces_unchecked(&[piece], 40.0));
    let start = land.starts[0].x;
    // the piece itself ends where the level ground after it begins
    let end = land.starts[1].x - land.pieces[0].run;
    let mut stage = Stage::new(land);
    let body = Body::build(&mut stage.world, legs).unwrap();
    let parts = body.creature.torso as usize..stage.world.bodies.len();
    for part in parts {
        stage.world.bodies[part].position.x += start - before;
    }
    (stage, body, start, end)
}

/// Whether the body is past the piece, upright, standing on whatever is beyond it.
fn over(stage: &Stage, body: &Body, end: f32) -> bool {
    let torso = stage.world.bodies[body.creature.torso as usize];
    torso.position.x > end + 0.05 && !body.creature.fallen(&stage.world) && torso.position.y > stage.land.reached.y + 0.4
}

/// Whether, standing `before` metres short of the piece, one hop and then standing still gets it
/// across.
fn hops_over(legs: u32, piece: Piece, before: f32) -> bool {
    let (mut stage, mut body, _, end) = set(legs, piece, before);
    for step in 0..240 {
        body.creature.hold(&mut stage.world);
        body.hop(&mut stage.world, step == 30);
        stage.world.step();
        if step > 60 && over(&stage, &body, end) && body.hop == Hop::Ready {
            return true;
        }
    }
    false
}

/// Whether, walking to the Walker's stride from two metres back and hopping once `at` metres short
/// of the piece, it gets across.
fn runs_and_hops_over(legs: u32, piece: Piece, at: f32) -> bool {
    let (mut stage, mut body, start, end) = set(legs, piece, 2.0);
    let stride = crate::body::Description { legs, carry: false, leap: false }.stride();
    let mut actions = alloc::vec![-1.0; body.actions()];
    actions[..stride.len()].copy_from_slice(stride);
    let hop = actions.len() - 1;
    let mut hopped = false;
    (0..480).any(|_| {
        let x = stage.world.bodies[body.creature.torso as usize].position.x;
        actions[hop] = if !hopped && x >= start - at { 1.0 } else { -1.0 };
        hopped |= actions[hop] > 0.0;
        body.drive(&mut stage.world, &actions);
        stage.world.step();
        hopped && body.hop == Hop::Ready && over(&stage, &body, end)
    })
}

/// Whether, from some distance before it, standing or walking up, one hop gets it across.
fn hops_over_from_somewhere(legs: u32, piece: Piece) -> bool {
    // no nearer than its body and feet reach, or it would start inside the piece
    let near = if legs == 2 { 0.45 } else { 0.7 };
    (0..40).any(|k| hops_over(legs, piece, near + 0.025 * k as f32) || runs_and_hops_over(legs, piece, 0.2 + 0.04 * k as f32))
}

/// Whether, walking to the Walker's stride from some distance before it, it walks over the piece.
fn walks_over(legs: u32, piece: Piece) -> bool {
    (0..12).any(|k| {
        let (mut stage, mut body, _, end) = set(legs, piece, 1.0 + 0.11 * k as f32);
        let stride = crate::body::Description { legs, carry: false, leap: false }.stride();
        let mut actions = alloc::vec![-1.0; body.actions()];
        actions[..stride.len()].copy_from_slice(stride);
        (0..480).any(|_| {
            body.drive(&mut stage.world, &actions);
            stage.world.step();
            over(&stage, &body, end)
        })
    })
}

/// The most of a piece's size the body gets over, to a centimetre.
fn most(legs: u32, kind: Kind, hopping: bool) -> f32 {
    let mut best = 0.0;
    for k in 1..150 {
        let size = 0.01 * k as f32;
        let piece = Piece::new(kind, size, 0.0, 3.0);
        if if hopping { hops_over_from_somewhere(legs, piece) } else { walks_over(legs, piece) } {
            best = size;
        } else if size > best + 0.08 {
            break;
        }
    }
    best
}

/// How a hop from standing on level ground goes with a way of hopping: the most the body tipped
/// before it had landed and settled, how far forward it went, and whether it ended up fallen.
fn try_hopping(legs: u32, hopping: Hopping) -> (f32, f32, bool) {
    let (mut stage, mut body, _, _) = set(legs, Piece::new(Kind::Flat, 10.0, 0.0, 3.0), 5.0);
    let torso = body.creature.torso as usize;
    stage.world.bodies[torso].inverse_inertia *= body.hopping.steadiness / hopping.steadiness;
    body.hopping = hopping;
    let start = stage.world.bodies[torso].position.x;
    let mut worst: f32 = 0.0;
    for step in 0..150 {
        body.creature.hold(&mut stage.world);
        body.hop(&mut stage.world, step == 30);
        stage.world.step();
        if step < 110 {
            worst = worst.max(stage.world.bodies[torso].angle().abs());
        }
    }
    (worst, stage.world.bodies[torso].position.x - start, body.creature.fallen(&stage.world))
}

#[test]
#[ignore]
fn find_how_each_body_should_hop_and_measure_what_it_can_do() {
    // cargo test --release find_how -- --ignored --nocapture
    for legs in [2, 4] {
        let mut tried = alloc::vec::Vec::new();
        for steadiness in [3.0, 6.0, 10.0] {
            for crouch in [-0.2, 0.0, 0.2] {
                for spring in [-0.3, -0.15, 0.0, 0.15, 0.3] {
                    for air in [-0.3, 0.0, 0.3] {
                        for lean in [-1.0, 0.0, 1.0, 2.0] {
                            let hopping = Hopping { steadiness, crouch, spring, air, lean };
                            tried.push((try_hopping(legs, hopping), hopping));
                        }
                    }
                }
            }
        }
        // the steadiest that went forward and stayed up
        tried.retain(|((worst, _, fallen), _)| *worst < 0.35 && !fallen);
        tried.sort_by(|a, b| b.0.1.total_cmp(&a.0.1));
        for ((worst, went, _), hopping) in tried.iter().take(5) {
            std::println!("{legs} legs: tipped {worst:.2}, went {went:.2} m: {hopping:?}");
        }
        std::println!("{legs} legs as built: walks up {:.2} m, hops up {:.2} m and over {:.2} m from standing", most(legs, Kind::Ledge, false), most(legs, Kind::Ledge, true), most(legs, Kind::Gap, true));
    }
}

/// How many worlds hold a piece that a body which cannot hop (as practice's cannot) may be unable to
/// cross: the checker run again with the reach the body has walking to the Walker's stride with no
/// hop (what it walks up, and over), against the reach it counts on, which is a hopping body's. A
/// policy that learns to bound may do more than the stride, so this counts what is in doubt, not
/// what is impossible. walker/README.md ("Every world can be crossed") gives the numbers.
/// `cargo test --release no_hop -- --ignored --nocapture`
#[test]
#[ignore]
fn count_the_worlds_a_body_with_no_hop_may_not_cross() {
    use super::check::{self, Reach};
    use super::recipe::Recipe;
    for legs in [2, 4] {
        let (up, over) = (most(legs, Kind::Ledge, false), most(legs, Kind::Gap, false));
        let walking = Reach { step: up.min(REACH.step), climb: up.min(REACH.step), leap: over };
        std::println!("{legs} legs with no hop: walks up {up:.2} m and over gaps of {over:.2} m; reach {walking:?}");
        let mut total = 0;
        for difficulty in [0.0, 0.25, 0.5, 0.75, 1.0] {
            let doubtful = (1..=100).filter(|&seed| {
                let land = Land::new(Recipe { seed, difficulty, amounts: [1.0; 4] }, 150.0);
                !check::possible(&land.geometry, -5.0, land.reached.x - 0.3, &walking)
            });
            let count = doubtful.count();
            total += count;
            std::println!("  difficulty {difficulty}: {count} of 100 worlds hold a piece beyond walking");
        }
        std::println!("  in all, {total} of 500");
    }
}

#[test]
fn each_body_hops_forward_and_lands_on_its_feet() {
    for legs in [2, 4] {
        let (worst, went, fallen) = try_hopping(legs, Hopping::of(legs));
        assert!(!fallen && worst < 0.35 && went > 0.2, "{legs} legs: tipped {worst}, went {went}, fallen {fallen}");
    }
}

#[test]
fn the_body_does_at_least_what_the_world_counts_on() {
    for legs in [2, 4] {
        let step = Piece::new(Kind::Ledge, REACH.step, 0.0, 3.0);
        assert!(walks_over(legs, step) || hops_over_from_somewhere(legs, step), "{legs} legs: gets up a step of {}", REACH.step);
        assert!(hops_over_from_somewhere(legs, Piece::new(Kind::Ledge, REACH.climb, 0.0, 3.0)), "{legs} legs: hops up a ledge of {}", REACH.climb);
        assert!(hops_over_from_somewhere(legs, Piece::new(Kind::Gap, REACH.leap, 0.0, 3.0)), "{legs} legs: hops over a gap of {}", REACH.leap);
    }
}

#[test]
fn a_hop_crouches_springs_and_rests_and_only_from_the_ground() {
    let (mut stage, mut body, _, _) = set(2, Piece::new(Kind::Flat, 10.0, 0.0, 3.0), 5.0);
    assert_eq!(body.actions(), 13);
    assert_eq!(body.feelings(), 18);
    for _ in 0..30 {
        body.creature.hold(&mut stage.world);
        body.hop(&mut stage.world, false);
        stage.world.step();
    }
    let mut seen = alloc::vec::Vec::new();
    let mut highest: f32 = 0.0;
    let ground = stage.world.bodies[body.creature.torso as usize].position.y;
    for _ in 0..120 {
        body.creature.hold(&mut stage.world);
        body.hop(&mut stage.world, true);
        stage.world.step();
        let now = match body.hop {
            Hop::Ready => 0,
            Hop::Crouch(_) => 1,
            Hop::Spring(_) => 2,
            Hop::Resting(_) => 3,
        };
        if seen.last() != Some(&now) {
            seen.push(now);
        }
        highest = highest.max(stage.world.bodies[body.creature.torso as usize].position.y - ground);
    }
    assert_eq!(&seen[..4], &[1, 2, 3, 0], "crouch, spring, rest, ready");
    assert!(highest > 0.2, "the body went up {highest} m");
    let mut feelings = alloc::vec![0.0; body.feelings()];
    body.feel(&stage.world, &mut feelings);
    assert!(feelings.iter().all(|x| x.is_finite() && x.abs() <= 3.0));
}
