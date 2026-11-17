//! Films a scene: steps a world through a set of strokes and writes frames of it side by side as one
//! picture, so that how things fall, flow and burn can be looked at without the page.
//!
//! `cargo run --release --example film -- water out.ppm` writes a plain PPM picture. The scenes are
//! the ones the page was played with: a brush held still over a shelf and a bowl (`water`, `sand`,
//! `lava`, `oil`), and two hills with a lake between, a wooden house set alight and lava poured into
//! the lake (`lake`). Each cell is drawn in its material's color, moved by its shade, as the page
//! draws it but without light.

use sand::materials::{DIRT, FIRE, LAVA, MATERIALS, OIL, PALETTE, SAND, STONE, WATER, WOOD};
use sand::world::{World, material};

/// The ground the page draws the world on.
const GROUND: [u8; 3] = [16, 10, 26];

/// One frame of a world, as red, green and blue bytes, row after row.
fn frame(world: &World) -> Vec<u8> {
    let mut out = Vec::with_capacity((world.width * world.height * 3) as usize);
    for y in 0..world.height {
        for x in 0..world.width {
            let cell = world.get(x, y);
            let m = material(cell) as usize;
            if m == 0 || m >= MATERIALS.len() {
                out.extend_from_slice(&GROUND);
                continue;
            }
            let by = ((cell >> 8) & 255) as f32 / 255.0 - 0.5;
            for k in 0..3 {
                out.push((PALETTE[m * 4 + k] as f32 + by * PALETTE[1024 + m * 4 + k] as f32).clamp(0.0, 255.0) as u8);
            }
        }
    }
    out
}

/// A brush of `radius` held still at (x, y) for one step, as the page pours it: so many cells a step
/// whatever its size for a powder or lava, and twice its width for another liquid.
fn held(world: &mut World, of: u8, x: i32, y: i32, radius: i32) {
    let area = std::f32::consts::PI * (radius as f32 + 0.5) * (radius as f32 + 0.5);
    let cells = match of {
        LAVA => 36.0,
        SAND | DIRT => 40.0,
        _ => 2.0 * (2 * radius + 1) as f32,
    };
    world.paint(of, x, y, x, y, radius, (100.0 * cells / area).round().clamp(1.0, 45.0) as u32, false);
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let scene = args.get(1).map(String::as_str).unwrap_or("water");
    let path = args.get(2).cloned().unwrap_or_else(|| "film.ppm".into());
    let (wide, high) = (520, 420);
    let mut world = World::new(wide, high, 7);
    let mut frames: Vec<Vec<u8>> = vec![];
    let (every, count): (usize, usize) = match scene {
        "lake" => (60, 12),
        _ => (15, 12),
    };
    match scene {
        "lake" => {
            for x in [130, 370] {
                for _ in 0..200 {
                    held(&mut world, SAND, x, 120, 20);
                    world.step();
                }
            }
            for _ in 0..300 {
                held(&mut world, WATER, 250, 120, 20);
                world.step();
            }
            for _ in 0..150 {
                world.step();
            }
            world.paint(WOOD, 440, 410, 440, 300, 5, 100, false);
            world.paint(WOOD, 500, 410, 500, 300, 5, 100, false);
            world.paint(WOOD, 430, 300, 510, 300, 5, 100, false);
            world.paint(FIRE, 425, 405, 445, 405, 6, 45, false);
            for step in 0..every * count {
                if step < 240 {
                    held(&mut world, LAVA, 250, 100, 14);
                }
                world.step();
                if step % every == every - 1 {
                    frames.push(frame(&world));
                }
            }
        }
        _ => {
            let of = match scene {
                "sand" => SAND,
                "lava" => LAVA,
                "oil" => OIL,
                _ => WATER,
            };
            world.paint(STONE, 180, 230, 310, 230, 6, 100, false);
            world.paint(STONE, 110, 380, 110, 412, 6, 100, false);
            world.paint(STONE, 400, 380, 400, 412, 6, 100, false);
            for step in 0..every * count {
                if step < 90 {
                    held(&mut world, of, 245, 28, 14);
                }
                world.step();
                if step % every == every - 1 {
                    frames.push(frame(&world));
                }
            }
        }
    }
    // four frames across
    let across = 4;
    let down = frames.len().div_ceil(across);
    let (w, h) = (wide as usize, high as usize);
    let mut sheet = vec![0u8; across * w * down * h * 3];
    for (k, each) in frames.iter().enumerate() {
        let (left, top) = ((k % across) * w, (k / across) * h);
        for row in 0..h {
            let to = ((top + row) * across * w + left) * 3;
            sheet[to..to + w * 3].copy_from_slice(&each[row * w * 3..(row + 1) * w * 3]);
        }
    }
    let mut out = format!("P6\n{} {}\n255\n", across * w, down * h).into_bytes();
    out.extend_from_slice(&sheet);
    std::fs::write(&path, out).expect("the picture could not be written");
    println!("{scene}: {} frames, one every {every} steps, in {path}", frames.len());
}
