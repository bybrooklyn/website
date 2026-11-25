//! A forest fire over the page's whole world (2,400 by 1,200), 600 steps, each timed, to judge a
//! change to the engine's speed by: `cargo run --release --example fire`.
use sand::materials::{DIRT, FIRE, WOOD};
use sand::world::World;
fn main() {
    let (wide, high) = (2400, 1200);
    let mut world = World::new(wide, high, 1);
    world.paint(DIRT, 0, high - 6, wide - 1, high - 1, 3, 100, false);
    let mut x = 4;
    while x < wide - 4 {
        world.paint(WOOD, x, high - 60, x, high - 7, 1, 100, false);
        world.paint(WOOD, x, high - 75, x, high - 75, 9, 100, false);
        x += 18;
    }
    world.paint(FIRE, 0, high - 70, wide - 1, high - 70, 2, 100, false);
    // each step timed on its own; on a busy machine the low end says more than the mean
    let mut took: Vec<f64> = (0..600)
        .map(|_| {
            let start = std::time::Instant::now();
            world.step();
            start.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    let mean = took.iter().sum::<f64>() / took.len() as f64;
    took.sort_by(f64::total_cmp);
    println!("a step: mean {mean:.2} ms, fifth fastest of each hundred (p20) {:.2} ms, median {:.2} ms; {} awake", took[120], took[300], world.awake());
}
