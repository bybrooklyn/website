//! Films a scene: steps a world through a set of strokes and writes frames of it side by side as one
//! picture, so that how things fall, flow and burn can be looked at without the page.
//!
//! `cargo run --release --example film -- water out.ppm` writes a plain PPM picture. The scenes are
//! the ones the page was played with: a brush held still over a shelf and a bowl (`water`, `sand`,
//! `lava`, `oil`), a liquid dragged onto a stone ramp (`ramp-water`, `ramp-lava`, `ramp-acid`), and two hills with a lake between, a wooden house set alight and lava poured into
//! the lake (`lake`), a wooden house and a pool of oil set alight (`fire`), and snow, salt, mud, a cloud and lightning (`weather`). Each cell is drawn in its material's color, moved by its shade, as the page
//! draws it but without light.

use sand::materials::{BOLT, CLOUD, DIRT, FIRE, ICE, LAVA, MATERIALS, MUD, OIL, PALETTE, SALT, SAND, SNOW, STONE, WATER, WOOD};
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
            if PALETTE[1024 + m * 4 + 3] & sand::materials::DRAW_FADE != 0 {
                // as faint as it has faded
                for k in 0..3 {
                    out.push((GROUND[k] as f32 + (by + 0.5) * (PALETTE[m * 4 + k] as f32 - GROUND[k] as f32)) as u8);
                }
                continue;
            }
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
        SAND | DIRT | SALT => 40.0,
        _ => 2.0 * (2 * radius + 1) as f32,
    };
    world.paint(of, x, y, x, y, radius, (100.0 * cells / area).round().clamp(1.0, 45.0) as u32, false);
}

/// The page's brush. Dragged, or at the press, it lays its own shape: all of it with a liquid and
/// 45 cells in 100 with a powder. Held still after that, a liquid goes on filling what of the shape
/// is empty, and a powder comes at one and a half grains a step for each cell of the brush's width,
/// what is left over of a share under one in 100 carried to the next step.
struct Brush {
    of: u8,
    radius: i32,
    carried: f32,
    pressed: bool,
}

impl Brush {
    fn new(of: u8, radius: i32) -> Self {
        Brush { of, radius, carried: 0.0, pressed: false }
    }

    fn powder(&self) -> bool {
        matches!(self.of, SAND | DIRT | SALT | SNOW)
    }

    /// One step of the brush held still at (x, y).
    fn held(&mut self, world: &mut World, x: i32, y: i32) {
        if !self.pressed || !self.powder() {
            self.pressed = true;
            world.paint(self.of, x, y, x, y, self.radius, if self.powder() { 45 } else { 100 }, false);
            return;
        }
        let area = std::f32::consts::PI * (self.radius as f32 + 0.5) * (self.radius as f32 + 0.5);
        let share = 100.0 * 1.5 * (2 * self.radius + 1) as f32 / area + self.carried;
        let fill = share.floor().min(45.0);
        self.carried = share - fill;
        if fill > 0.0 {
            world.paint(self.of, x, y, x, y, self.radius, fill as u32, false);
        }
    }

    /// The brush dragged from one cell to another between two steps.
    fn dragged(&mut self, world: &mut World, from: (i32, i32), to: (i32, i32)) {
        world.paint(self.of, from.0, from.1, to.0, to.1, self.radius, if self.powder() { 45 } else { 100 }, false);
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let scene = args.get(1).map(String::as_str).unwrap_or("water");
    let path = args.get(2).cloned().unwrap_or_else(|| "film.ppm".into());
    let (wide, high) = (520, 420);
    let mut world = World::new(wide, high, 7);
    let mut frames: Vec<Vec<u8>> = vec![];
    // The scenes the owner sent word of on 17 Nov 2026, filmed at the steps given: `start-<what>-<radius>`
    // a brush pressed and held still (what a pour looks like as it begins), `dig` a hole taken out of the
    // middle of a big pile of sand, `flood` the biggest brush of water dragged across over heaps of sand.
    let wanted: Option<(&str, Vec<usize>)> = if scene.starts_with("start-") {
        Some(("start", vec![1, 2, 3, 4, 6, 8, 12, 16, 24, 40, 60, 90]))
    } else if scene == "dig" {
        Some(("dig", vec![0, 2, 4, 6, 9, 12, 16, 20, 30, 45, 70, 120]))
    } else if scene == "flood" {
        Some(("flood", vec![10, 20, 30, 40, 50, 60, 80, 100, 130, 170, 230, 320]))
    } else {
        None
    };
    if let Some((kind, shots)) = wanted {
        let last = *shots.last().unwrap();
        let mut took = std::time::Duration::ZERO;
        match kind {
            "start" => {
                let mut parts = scene.split('-').skip(1);
                let of = match parts.next() {
                    Some("sand") => SAND,
                    Some("lava") => LAVA,
                    _ => WATER,
                };
                let radius: i32 = parts.next().and_then(|r| r.parse().ok()).unwrap_or(8);
                world.paint(STONE, 0, 415, 519, 415, 4, 100, false);
                let mut brush = Brush::new(of, radius);
                for step in 1..=last {
                    brush.held(&mut world, 260, 80);
                    world.step();
                    if shots.contains(&step) {
                        frames.push(frame(&world));
                    }
                }
            }
            "dig" => {
                // a pile that fills the lower two thirds of the world from wall to wall, come to rest
                for y in 140..420 {
                    world.paint(SAND, 0, y, 519, y, 0, 100, false);
                }
                for _ in 0..60 {
                    world.step();
                }
                for step in 0..=last {
                    if step == 0 {
                        world.paint(0, 260, 290, 260, 290, 36, 100, false);
                    } else {
                        world.step();
                    }
                    if shots.contains(&step) {
                        frames.push(frame(&world));
                    }
                }
            }
            _ => {
                // two heaps of sand, then the biggest brush of water dragged from left to right over a second
                let mut sand = Brush::new(SAND, 8);
                for x in [150, 330] {
                    for _ in 0..220 {
                        sand.held(&mut world, x, 200);
                        world.step();
                    }
                }
                for _ in 0..120 {
                    world.step();
                }
                let mut brush = Brush::new(WATER, 48);
                for step in 1..=last {
                    if step <= 60 {
                        let at = |k: usize| (70 + (k as i32) * 5, 70);
                        brush.dragged(&mut world, at(step - 1), at(step));
                    }
                    let began = std::time::Instant::now();
                    world.step();
                    took += began.elapsed();
                    if shots.contains(&step) {
                        frames.push(frame(&world));
                        println!("step {step}: {} cells have found their level so far, {} chunks awake", world.levelled, world.awake());
                    }
                }
                println!("flood: {:.2} ms a step on average over {last} steps", took.as_secs_f64() * 1000.0 / last as f64);
            }
        }
        write(&path, &frames, wide as usize, high as usize);
        println!("{scene}: {} frames at steps {shots:?}, in {path}", frames.len());
        return;
    }
    if let Some(of) = scene.strip_prefix("ramp-") {
        // what was done on the page on 26 Nov 2026: a stone ramp drawn down to the right, and a brush of
        // radius 10 of a liquid dragged across above its upper end, which lays a solid stroke of it
        let of = match of {
            "lava" => LAVA,
            "acid" => sand::materials::ACID,
            _ => WATER,
        };
        world.paint(STONE, 60, 200, 300, 280, 5, 100, false);
        let mut brush = Brush::new(of, 10);
        let shots = [1, 3, 5, 8, 12, 16, 20, 25, 30, 40, 55, 80];
        for step in 1..=80 {
            if step <= 6 {
                let at = |k: i32| (80 + k * 20, 140 + k * 3);
                brush.dragged(&mut world, at(step - 1), at(step));
            }
            world.step();
            if shots.contains(&(step as usize)) {
                frames.push(frame(&world));
            }
        }
        write(&path, &frames, wide as usize, high as usize);
        println!("{scene}: frames at steps {shots:?}, in {path}");
        return;
    }
    if let Some(name) = scene.strip_prefix("fx-") {
        effects(&mut world, name, &path);
        return;
    }
    let (every, count): (usize, usize) = match scene {
        "lake" => (60, 12),
        "slope" => (20, 12),
        "fire" => (40, 12),
        "weather" => (40, 12),
        _ => (15, 12),
    };
    match scene {
        "fire" => {
            // a wooden house, a pool of oil beside it, and fire set to both
            world.paint(STONE, 0, 415, 519, 415, 4, 100, false);
            world.paint(WOOD, 300, 405, 300, 300, 6, 100, false);
            world.paint(WOOD, 420, 405, 420, 300, 6, 100, false);
            world.paint(WOOD, 290, 300, 430, 300, 6, 100, false);
            world.paint(WOOD, 290, 300, 360, 230, 6, 100, false);
            world.paint(WOOD, 430, 300, 360, 230, 6, 100, false);
            world.paint(STONE, 40, 405, 40, 380, 3, 100, false);
            world.paint(STONE, 200, 405, 200, 380, 3, 100, false);
            for y in 392..408 {
                world.paint(OIL, 46, y, 194, y, 0, 100, false);
            }
            for step in 0..every * count {
                if step < 10 {
                    world.paint(FIRE, 280, 400, 292, 400, 4, 45, false);
                    world.paint(FIRE, 60, 388, 70, 388, 3, 45, false);
                }
                world.step();
                if step % every == every - 1 {
                    frames.push(frame(&world));
                    println!("step {step}: heard {} hisses and {} flames so far", world.heard(0), world.heard(1));
                }
            }
        }
        "weather" => {
            // a stone floor with a wooden hut, a heap of sand, a pond and a block of ice; snow from the left,
            // a cloud over the pond, salt on the ice, and lightning on the hut and the sand
            world.paint(STONE, 0, 415, 519, 415, 4, 100, false);
            world.paint(WOOD, 60, 405, 60, 350, 4, 100, false);
            world.paint(WOOD, 110, 405, 110, 350, 4, 100, false);
            world.paint(WOOD, 52, 350, 118, 350, 4, 100, false);
            world.paint(STONE, 250, 405, 250, 380, 3, 100, false);
            world.paint(STONE, 340, 405, 340, 380, 3, 100, false);
            for y in 388..410 {
                world.paint(WATER, 256, y, 334, y, 0, 100, false);
            }
            for y in 380..410 {
                world.paint(ICE, 420, y, 470, y, 0, 100, false);
            }
            for _ in 0..120 {
                held(&mut world, SAND, 180, 300, 8);
                world.step();
            }
            for y in 150..175 {
                world.paint(CLOUD, 240, y, 350, y, 0, 100, false);
            }
            for step in 0..every * count {
                if step < 240 {
                    world.paint(SNOW, 380 + (step as i32 % 9) * 12, 40, 380 + (step as i32 % 9) * 12, 40, 3, 20, false);
                }
                if (120..200).contains(&step) {
                    held(&mut world, SALT, 445, 330, 8);
                }
                if step == 60 || step == 200 {
                    world.paint(BOLT, 85, 200, 85, 200, 0, 100, false);
                }
                if step == 130 || step == 260 {
                    world.paint(BOLT, 180, 150, 180, 150, 0, 100, false);
                }
                if (300..360).contains(&step) {
                    held(&mut world, MUD, 30, 250, 8);
                }
                world.step();
                if step % every == every - 1 {
                    frames.push(frame(&world));
                }
            }
        }
        "slope" => {
            // the owner's picture of 24 Nov 2026: a tall heap of sand, and water poured onto its slope
            for _ in 0..900 {
                held(&mut world, SAND, 150, 40, 24);
                world.step();
            }
            for step in 0..every * count {
                if step < 120 {
                    held(&mut world, WATER, 230, 60, 10);
                }
                world.step();
                if step % every == every - 1 {
                    frames.push(frame(&world));
                }
            }
        }
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
                    println!("step {step}: heard {} hisses and {} flames so far", world.heard(0), world.heard(1));
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
    write(&path, &frames, wide as usize, high as usize);
    println!("{scene}: {} frames, one every {every} steps, in {path}", frames.len());
}

/// Writes frames side by side, four across, as one plain PPM picture.
fn write(path: &str, frames: &[Vec<u8>], w: usize, h: usize) {
    let across = 4;
    let down = frames.len().div_ceil(across);
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
    std::fs::write(path, out).expect("the picture could not be written");
}

/// The scenes the effects were judged by on 26 Nov 2026, each filmed in twelve frames with the counts
/// of what matters printed at each: `fx-candle` (a post lit at its top, another at its foot, a beam
/// over a flame), `fx-forest`, `fx-acid` (acid poured on stone, wood and dirt), `fx-snow` (snow in the
/// open, by a fire and by lava) and `fx-lava` (lava poured into water and onto wood).
fn effects(world: &mut World, name: &str, path: &str) {
    use sand::materials::{ACID, ASH, EMBER, ROCK, SMOKE, STEAM};
    let mut frames = vec![];
    let floor = |world: &mut World| world.paint(STONE, 0, 415, 519, 415, 4, 100, false);
    let (every, watch): (usize, Vec<(&str, u8)>) = match name {
        "candle" => {
            floor(world);
            world.paint(WOOD, 80, 410, 80, 330, 2, 100, false);
            world.paint(WOOD, 200, 410, 200, 300, 2, 100, false);
            world.paint(WOOD, 300, 330, 470, 330, 3, 100, false);
            world.paint(WOOD, 300, 410, 300, 334, 1, 100, false);
            world.paint(WOOD, 470, 410, 470, 334, 1, 100, false);
            world.paint(FIRE, 80, 329, 80, 329, 2, 100, false);
            world.paint(FIRE, 192, 408, 208, 408, 3, 100, false);
            world.paint(FIRE, 370, 408, 400, 408, 4, 100, false);
            (30, vec![("wood", WOOD), ("ember", EMBER), ("fire", FIRE), ("smoke", SMOKE), ("ash", ASH)])
        }
        "forest" => {
            world.paint(DIRT, 0, 412, 519, 419, 3, 100, false);
            let mut x = 20;
            while x < 500 {
                world.paint(WOOD, x, 405, x, 350, 1, 100, false);
                world.paint(WOOD, x, 340, x, 340, 9, 100, false);
                x += 24;
            }
            world.paint(FIRE, 10, 400, 10, 400, 4, 100, false);
            (60, vec![("wood", WOOD), ("ember", EMBER), ("fire", FIRE), ("smoke", SMOKE), ("ash", ASH)])
        }
        "acid" => {
            floor(world);
            world.paint(STONE, 40, 300, 160, 300, 3, 100, false);
            for y in 360..412 {
                world.paint(WOOD, 220, y, 300, y, 0, 100, false);
            }
            for y in 380..412 {
                world.paint(DIRT, 360, y, 480, y, 0, 100, false);
            }
            (30, vec![("stone", STONE), ("wood", WOOD), ("dirt", DIRT), ("acid", ACID), ("smoke", SMOKE)])
        }
        "dab" => {
            // what was done on the page: one press of the brush on a stone shelf, of snow alone, of snow
            // with acid beside it, and of acid alone
            for x in [40, 210, 380] {
                world.paint(STONE, x, 300, x + 100, 300, 3, 100, false);
            }
            let mut brush = Brush::new(SNOW, 8);
            brush.held(world, 90, 280);
            let mut brush = Brush::new(SNOW, 8);
            brush.held(world, 240, 280);
            world.paint(ACID, 285, 285, 285, 285, 6, 100, false);
            world.paint(ACID, 430, 285, 430, 285, 8, 100, false);
            (20, vec![("snow", SNOW), ("water", WATER), ("acid", ACID), ("stone", STONE), ("smoke", SMOKE)])
        }
        "snow" => {
            floor(world);
            world.paint(STONE, 330, 405, 330, 380, 3, 100, false);
            world.paint(STONE, 500, 405, 500, 380, 3, 100, false);
            for y in 395..412 {
                world.paint(LAVA, 336, y, 494, y, 0, 100, false);
            }
            world.paint(WOOD, 250, 410, 250, 360, 2, 100, false);
            world.paint(FIRE, 250, 359, 250, 359, 2, 100, false);
            (60, vec![("snow", SNOW), ("water", WATER), ("steam", STEAM), ("ice", ICE)])
        }
        _ => {
            floor(world);
            world.paint(STONE, 40, 405, 40, 360, 3, 100, false);
            world.paint(STONE, 240, 405, 240, 360, 3, 100, false);
            for y in 370..412 {
                world.paint(WATER, 46, y, 234, y, 0, 100, false);
            }
            for y in 380..412 {
                world.paint(WOOD, 330, y, 470, y, 0, 100, false);
            }
            (40, vec![("lava", LAVA), ("stone", STONE), ("rock", ROCK), ("steam", STEAM), ("water", WATER), ("wood", WOOD), ("ember", EMBER)])
        }
    };
    let mut snow = Brush::new(SNOW, 10);
    let mut took = std::time::Duration::ZERO;
    for step in 0..every * 12 {
        match name {
            "acid" if step < 90 => {
                held(world, ACID, 100, 200, 8);
                held(world, ACID, 260, 250, 8);
                held(world, ACID, 420, 250, 8);
            }
            "snow" if step < 200 => {
                for x in [60, 250, 415] {
                    snow.held(world, x, 60);
                }
            }
            "lava" if step < 120 => {
                held(world, LAVA, 140, 200, 8);
                held(world, LAVA, 400, 200, 8);
            }
            _ => {}
        }
        let began = std::time::Instant::now();
        world.step();
        took += began.elapsed();
        if step % every == every - 1 {
            frames.push(frame(world));
            let mut counts: Vec<String> = watch.iter().map(|(n, m)| format!("{n} {}", world.count(*m))).collect();
            if name == "candle" {
                // the post lit at its foot: how much of it stands, and how high it is alight
                let cells = || (196..=204).flat_map(|x| (300..=410).map(move |y| (x, y)));
                let standing = cells().filter(|&(x, y)| matches!(world.at(x, y), WOOD | EMBER)).count();
                let alight = cells().filter(|&(x, y)| world.at(x, y) == EMBER).map(|(_, y)| y).min().map_or(-1, |y| 410 - y);
                counts.push(format!("the post {standing} standing, alight {alight} up"));
            }
            println!("step {:4}: {}", step + 1, counts.join(", "));
        }
    }
    println!("{:.3} ms a step", took.as_secs_f64() * 1000.0 / (every * 12) as f64);
    write(path, &frames, world.width as usize, world.height as usize);
}
