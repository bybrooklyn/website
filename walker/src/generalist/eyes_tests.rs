//! What the eyes are held to: a ray cast the quick way meets what one cast past every piece, block and
//! body meets, to the bit; on level ground the rays land where they are aimed; each kind of thing is
//! seen as what it is; the picture is lit where the ground is; and seeing is quick.

use alloc::rc::Rc;

use super::body::Body;
use super::eyes::{self, PER_RAY, RANGE, RAYS, Seen};
use super::land::Land;
use super::recipe::{Kind, Piece, Recipe};
use super::stage::Stage;
use crate::learn::Random;
use crate::math::{Vec2, sin_cos};

/// A stage on a busy world with every thing within reach made, and a body in it.
fn busy(seed: u32) -> (Stage, Body) {
    let land = Rc::new(Land::new(Recipe { seed, difficulty: 0.7, amounts: [1.0; 4] }, 200.0));
    let mut stage = Stage::new(land);
    let body = Body::build(&mut stage.world, 2).unwrap();
    // things are made as the creature comes near; carried along by hand, all of the first 60 m are
    for x in 0..60 {
        stage.keep(x as f32 - 12.0);
    }
    (stage, body)
}

#[test]
fn a_ray_cast_the_quick_way_meets_what_casting_past_everything_meets() {
    let mut random = Random::new(4);
    let mut met = 0;
    for seed in 0..20 {
        let (stage, body) = busy(seed);
        let group = stage.world.bodies[body.creature.torso as usize].group;
        for _ in 0..2000 {
            let from = Vec2::new(-5.0 + 70.0 * random.unit(), -2.0 + 5.0 * random.unit());
            let (s, c) = sin_cos(random.unit() * core::f32::consts::TAU);
            let toward = Vec2::new(c, s);
            let skip = if random.unit() < 0.5 { group } else { 0 };
            let quick = stage.world.cast(from, toward, RANGE, skip);
            let slow = stage.world.cast_slowly(from, toward, RANGE, skip);
            assert_eq!(quick.map(|hit| (hit.distance.to_bits(), hit.struck)), slow.map(|hit| (hit.distance.to_bits(), hit.struck)), "from {from:?} toward {toward:?}");
            met += usize::from(quick.is_some());
        }
    }
    assert!(met > 10_000, "many rays met something: {met} of 40,000");
}

#[test]
fn on_level_ground_the_rays_down_land_where_they_are_aimed_and_the_rays_up_see_nothing() {
    let mut stage = Stage::new(Rc::new(Land::from_pieces(&[], 40.0)));
    let body = Body::build(&mut stage.world, 2).unwrap();
    let group = stage.world.bodies[body.creature.torso as usize].group;
    let from = eyes::eye(&stage, body.creature.torso);
    let mut into = alloc::vec![0.0; RAYS * PER_RAY];
    let mut seen = [(0.0, Seen::Nothing); RAYS];
    eyes::see(&stage, body.creature.torso, group, &mut into, &mut seen);
    for (k, angle) in eyes::angles().iter().enumerate() {
        let (distance, what) = seen[k];
        if k < 11 {
            assert_eq!(what, Seen::Ground, "ray {k}");
            let ahead = distance * sin_cos(*angle).1;
            let aimed = (0.3 + 0.35 * k as f32) * from.y;
            assert!((ahead - aimed).abs() < 1e-3, "ray {k} lands {ahead} ahead, aimed at {aimed}");
            assert!((into[k * PER_RAY] - (1.0 - distance / RANGE)).abs() < 1e-6);
            assert!(into[k * PER_RAY + 1..(k + 1) * PER_RAY].iter().all(|&flag| flag == 0.0));
        } else {
            assert_eq!(what, Seen::Nothing, "ray {k} looks up");
            assert_eq!(into[k * PER_RAY], 0.0);
        }
    }
}

/// What the ray from the eye at the angle nearest to `angle` sees, the creature standing `before`
/// metres short of a piece laid alone.
fn sees(piece: Piece, before: f32, angle: f32) -> (f32, Seen) {
    let land = Rc::new(Land::from_pieces_unchecked(&[piece], 40.0));
    let start = land.starts[0].x;
    let mut stage = Stage::new(land);
    let body = Body::build(&mut stage.world, 2).unwrap();
    for part in body.creature.torso as usize..stage.world.bodies.len() {
        stage.world.bodies[part].position.x += start - before;
    }
    stage.keep(start - before);
    let group = stage.world.bodies[body.creature.torso as usize].group;
    eyes::look(&stage, eyes::eye(&stage, body.creature.torso), angle, group)
}

#[test]
fn each_kind_of_thing_is_seen_as_what_it_is() {
    let level = 0.0;
    let down = |ahead: f32| -crate::math::atan2(1.0, ahead);
    // the ground just short of a gap is its edge, the ground well short is ground
    assert_eq!(sees(Piece::new(Kind::Gap, 1.0, 0.0, 3.0), 1.2, down(1.0)).1, Seen::Edge);
    assert_eq!(sees(Piece::new(Kind::Gap, 1.0, 0.0, 3.0), 2.2, down(0.6)).1, Seen::Ground);
    // and so is the top of a drop
    assert_eq!(sees(Piece::new(Kind::Drop, 0.8, 0.0, 3.0), 1.2, down(1.0)).1, Seen::Edge);
    // a step up is no edge
    assert_eq!(sees(Piece::new(Kind::Ledge, 0.1, 0.0, 3.0), 1.2, down(1.0)).1, Seen::Ground);
    assert_eq!(sees(Piece::new(Kind::Water, 1.0, 0.0, 3.0), 0.6, down(1.0)).1, Seen::Hazard);
    assert_eq!(sees(Piece::new(Kind::Spikes, 1.0, 0.0, 3.0), 0.6, down(1.0)).1, Seen::Hazard);
    assert_eq!(sees(Piece::new(Kind::Box, 0.2, 0.0, 3.0), 0.3, down(1.0)).1, Seen::Box);
    assert_eq!(sees(Piece::new(Kind::Seesaw, 1.5, 0.3, 3.0), 0.3, down(1.5)).1, Seen::Moving);
    assert_eq!(sees(Piece::new(Kind::Mover, 3.0, 0.5, 3.0), 0.6, down(0.8)).1, Seen::Moving);
    // a ledge too high to step is seen straight ahead, near
    let (distance, what) = sees(Piece::new(Kind::Ledge, 1.2, 0.0, 3.0), 1.0, level);
    assert_eq!(what, Seen::Ground);
    assert!(distance < 1.0);
}

#[test]
fn the_picture_is_lit_where_the_ground_is_and_brighter_where_a_wall_is_near() {
    let flat = {
        let mut stage = Stage::new(Rc::new(Land::from_pieces(&[], 40.0)));
        let body = Body::build(&mut stage.world, 2).unwrap();
        let group = stage.world.bodies[body.creature.torso as usize].group;
        let mut strip = alloc::vec![0.0; 64];
        eyes::picture(&stage, body.creature.torso, group, &mut strip);
        let mut again = alloc::vec![0.0; 64];
        eyes::picture(&stage, body.creature.torso, group, &mut again);
        assert_eq!(strip, again);
        strip
    };
    // the bottom of the strip looks down at the ground, the top up at the sky
    assert!(flat[..25].iter().all(|&p| p > 0.3), "{flat:?}");
    assert!(flat[40..].iter().all(|&p| p == 0.0), "{flat:?}");
    // a wall a metre ahead lights the strip around level, where the sky was
    let land = Rc::new(Land::from_pieces_unchecked(&[Piece::new(Kind::Ledge, 2.0, 0.0, 3.0)], 40.0));
    let start = land.starts[0].x;
    let mut stage = Stage::new(land);
    let body = Body::build(&mut stage.world, 2).unwrap();
    for part in body.creature.torso as usize..stage.world.bodies.len() {
        stage.world.bodies[part].position.x += start - 1.0;
    }
    let group = stage.world.bodies[body.creature.torso as usize].group;
    let mut wall = alloc::vec![0.0; 64];
    eyes::picture(&stage, body.creature.torso, group, &mut wall);
    assert!(wall[35..48].iter().all(|&p| p > 0.3), "{wall:?}");
}

// Natively, on the machine this was written on (a Ryzen 7 9700X, busy with other work), a creature in
// a busy world saw about 930,000 times a second (sixteen rays each) on one core, where casting past
// every piece, block and body there is would allow 535,000. The floor leaves room
// for a much slower machine.
const FLOOR: f64 = 60_000.0;

#[test]
fn seeing_is_quick() {
    let (stage, body) = busy(3);
    let group = stage.world.bodies[body.creature.torso as usize].group;
    let mut into = alloc::vec![0.0; RAYS * PER_RAY];
    let mut seen = [(0.0, Seen::Nothing); RAYS];
    let mut best = 0.0f64;
    let mut slow = f64::MAX;
    for _ in 0..3 {
        let started = std::time::Instant::now();
        for _ in 0..20_000 {
            eyes::see(&stage, body.creature.torso, group, &mut into, &mut seen);
        }
        best = best.max(20_000.0 / started.elapsed().as_secs_f64());
        let from = eyes::eye(&stage, body.creature.torso);
        let started = std::time::Instant::now();
        let angles = eyes::angles();
        let mut sum = 0.0;
        for _ in 0..2000 {
            for angle in angles {
                let (s, c) = sin_cos(angle);
                sum += stage.world.cast_slowly(from, Vec2::new(c, s), RANGE, group).map_or(0.0, |hit| hit.distance);
            }
        }
        slow = slow.min(started.elapsed().as_secs_f64() / 2000.0);
        assert!(sum > 0.0);
    }
    std::println!("seeing: {best:.0} times a second, sixteen rays each; casting the slow way would allow {:.0}", 1.0 / slow);
    assert!(best > FLOOR, "{best:.0} times a second, under the floor of {FLOOR}");
}
