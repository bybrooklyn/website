//! The Walker mini must go on exactly as it was when the generalist's world was added to the same
//! physics: static blocks, things that move by themselves, bodies taken out. This trains walkers of
//! every kind on every kind of ground for a few generations, and steps many together, and holds a
//! fingerprint of every number that came out to the one taken before any of that was written.

use walker::body::Description;
use walker::envs::Envs;
use walker::learn::{Goal, Settings, Trainer, flat_ground};
use walker::math::Vec2;
use walker::physics::Segment;

/// FNV-1a over the bits of every number, in order.
fn mix(hash: &mut u64, values: &[f32]) {
    for value in values {
        for byte in value.to_bits().to_le_bytes() {
            *hash ^= byte as u64;
            *hash = hash.wrapping_mul(0x100_0000_01b3);
        }
    }
}

/// Steps, gaps and slopes, as the obstacle course has them.
fn rough_ground() -> Vec<Segment> {
    let mut pieces = vec![Segment { a: Vec2::new(-20.0, 0.0), b: Vec2::new(3.0, 0.0) }];
    let (mut x, mut y) = (3.0f32, 0.0f32);
    for k in 0..60 {
        match k % 3 {
            0 => {
                let next = y + if k % 2 == 0 { 0.15 } else { -0.1 };
                pieces.push(Segment { a: Vec2::new(x, y), b: Vec2::new(x, next) });
                y = next;
                pieces.push(Segment { a: Vec2::new(x, y), b: Vec2::new(x + 2.0, y) });
                x += 2.0;
            }
            1 => {
                pieces.push(Segment { a: Vec2::new(x + 0.4, y), b: Vec2::new(x + 3.0, y) });
                x += 3.0;
            }
            _ => {
                pieces.push(Segment { a: Vec2::new(x, y), b: Vec2::new(x + 2.0, y + 0.3) });
                y += 0.3;
                x += 2.0;
            }
        }
    }
    pieces
}

#[test]
fn the_walker_learns_and_steps_exactly_as_before_the_world_was_added() {
    let mut hash = 0xcbf2_9ce4_8422_2325u64;
    for (legs, goal) in [(2, Goal::Far), (4, Goal::Fast), (1, Goal::Tall), (2, Goal::Jump), (4, Goal::Course), (2, Goal::Carry)] {
        for ground in [flat_ground(), rough_ground()] {
            let settings = Settings { goal, hidden: 16, layers: 2, memory: 4, population: 12, ..Settings::default() };
            let mut trainer = Trainer::new(Description { legs, carry: false, leap: false }, settings, &ground, 3).unwrap();
            while trainer.generation < 3 {
                trainer.train(12);
            }
            mix(&mut hash, &trainer.best);
            mix(&mut hash, &trainer.history_best);
            mix(&mut hash, &trainer.history_mean);
        }
    }
    let trainer = Trainer::new(Description { legs: 2, carry: false, leap: false }, Settings::default(), &rough_ground(), 1).unwrap();
    let mut envs = Envs::new(&trainer, 8);
    let (senses, wide) = (envs.senses(), envs.actions());
    let stride = trainer.description.stride();
    let (mut observations, mut actions, mut rewards, mut done) = (vec![0.0; 8 * senses], (0..8 * wide).map(|k| stride[k % wide]).collect::<Vec<f32>>(), vec![0.0; 8], vec![0.0; 8]);
    for step in 0..2000 {
        envs.step(&actions, &mut observations, &mut rewards, &mut done);
        mix(&mut hash, &observations);
        mix(&mut hash, &rewards);
        let at = step % actions.len();
        actions[at] = -actions[at];
    }
    println!("fingerprint {hash:#018x}");
    assert_eq!(hash, FINGERPRINT);
}

/// Taken on main before the generalist's physics was written.
const FINGERPRINT: u64 = 0xab02_6d5f_36b7_20f4;
