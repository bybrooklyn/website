//! How a step's time grows as a held brush pours into the page's world (2400 by 1200), and how flat
//! water ends: a brush of radius 24 held at the top middle, pouring water (or sand) for 60 seconds of
//! steps, then let go for 20 seconds. Prints, each simulated second, the mean step, the slowest, the
//! cells of the material, the cells awake, and for water the spread of the surface's height across the
//! columns of the pool. `cargo run --release --example lag [water|sand]`.

use sand::materials::{SAND, WATER};
use sand::world::World;
use std::time::Instant;

fn main() {
    let what = std::env::args().nth(1).unwrap_or_else(|| "water".into());
    let of = if what == "sand" { SAND } else { WATER };
    let (wide, high) = (2400, 1200);
    let mut world = World::new(wide, high, 7);
    for second in 0..80 {
        let (mut total, mut slowest) = (0.0f64, 0.0f64);
        for _ in 0..60 {
            if second < 60 {
                world.paint(of, wide / 2, 60, wide / 2, 60, 24, 20, false);
            }
            let start = Instant::now();
            world.step();
            let took = start.elapsed().as_secs_f64() * 1000.0;
            total += took;
            slowest = slowest.max(took);
        }
        // the surface: for each column, the first row from the top holding the material
        let mut tops = Vec::new();
        for x in 0..wide {
            if let Some(y) = (0..high).find(|&y| sand::world::material(world.get(x, y)) == of) {
                tops.push(y as f64);
            }
        }
        let mean = tops.iter().sum::<f64>() / tops.len().max(1) as f64;
        let (low, top) = tops.iter().fold((f64::MAX, f64::MIN), |(a, b), &y| (a.min(y), b.max(y)));
        if second % 5 == 4 || second < 3 || (58..64).contains(&second) {
            println!("{:>3}s  mean {:>6.2} ms  slowest {:>6.2} ms  {:>8} cells  {:>8} awake  surface rows {:.0}..{:.0} (mean {:.1}) over {} columns", second + 1, total / 60.0, slowest, world.count(of), world.awake(), low, top, mean, tops.len());
        }
    }
}
